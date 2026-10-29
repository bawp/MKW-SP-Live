// Convert the MKW-SP PAL payload (absolutely linked for MKW-SP's relocated memory layout) into a
// Pulsar-style Code.pul (Kamek v2 blob) targeting the vanilla RMCP01 layout used by WiiCompiled.
//
//   node tools/convert.js [outDir]
//
// Layout assumptions (see README.md):
//   * WiiCompiled places the Kamek code blob at MODULE_BASE (profile module_guest_base).
//   * PAD bytes of zeros are prepended so the payload lands at an address congruent to its link
//     address (0x8076F000) modulo 64 KiB. Low halves of every absolute address therefore stay valid
//     even where the relocation analysis cannot see a lis/lo pair.
const fs = require('fs'), path = require('path');
const C = require('./common.js');
const A = require('./analyze.js');
const V = require('./vanilla.js');
const PATCHES = require('./patches.js');
const { decode, sx16 } = require('./ppc.js');

const MODULE_BASE = 0x81800000;
const PAD = ((C.P0 - MODULE_BASE) & 0xFFFF) >>> 0;           // 0xF000
const NEW_P0 = MODULE_BASE + PAD;                              // 0x8180F000
const SHIFT = (NEW_P0 - C.P0) >>> 0;                           // 0x010A0000
const CODE_END = A.CODE_END, TABLES_END = 0x807FE880, RODATA = 0x807FE880, PEND = C.PEND;
const off = a => PAD + (a - C.P0);                             // payload address -> blob offset

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const RANKINGS = process.argv.includes('--rankings');   // MKW-SP Rankings fork (tools/rankings.js)
const RK = RANKINGS ? require('./rankings.js') : null;
const outDir = path.resolve(args[0] || path.join(C.ROOT, 'build', RANKINGS ? 'MKW-SP-Rankings' : 'MKW-SP'));
const code = Buffer.concat([Buffer.alloc(PAD), Buffer.from(C.pay)]);
const w32 = (a, v) => code.writeUInt32BE(v >>> 0, off(a));
const r32 = a => code.readUInt32BE(off(a));
const sym = n => { const s = C.smap.find(x => x.n === n); if (!s) throw new Error('no symbol ' + n); return s.a; };
const report = [];
const log = (...x) => report.push(x.join(' '));

// ---------------------------------------------------------------- relocation command collection
const relocs = [];   // {t, offset, target(abs or blob-relative)}
const TYPES = { Addr32: 1, Addr16Lo: 4, Addr16Hi: 5, Addr16Ha: 6, Rel24: 10 };
const relTarget = a => C.seg(a) === 'pay' ? off(a) : C.mapAddr(a);   // relative offsets have bit 31 clear
function addReloc(t, at, target) { relocs.push({ t: TYPES[t], at, target: target >>> 0 }); }

// ---------------------------------------------------------------- 1. static code edits
const NOP = 0x60000000, BLR = 0x4e800020;
const stubbed = new Set();
function stub(name, retVal) {
  const a = sym(name);
  if (retVal === undefined) w32(a, BLR); else { w32(a, 0x38600000 | (retVal & 0xffff)); w32(a + 4, BLR); }
  stubbed.add(a); log('stub', name, retVal === undefined ? '' : 'return ' + retVal);
}
// Privileged / hardware-only routines a recompiler cannot (and need not) execute.
for (const n of ['SP::PageTable::Init()', 'RealModeTrampoline', 'Memory_SetSDR1', 'Memory_InitSRs',
  'Memory_InvalidateAllIBATs', 'SP::Memory::InvalidateAllIBATs()', 'OSSetTime', 'dst___init_registers_0x8C',
  'StackCanary_Init', 'SP::StackCanary::AddLinkRegisterPatches(unsigned int*, unsigned int*)',
  'SP::Function::KillBlacklistedFunction(unsigned int*, unsigned int*)', 'Host_SetCPUID',
  'SP::Heap::RandomizeMEM1Heaps()', 'SP::Heap::RandomizeMEM2Heaps()',
  'VI::Init()', 'Console::Init()', 'Usb_init', 'SIKeyboard_InitSimple',
  'SP::Time::Init()']) stub(n);   // RTC over EXI: the runtime's OS clock already follows the host
stub('SP::Memory::ProtectRange(unsigned int, void*, void*, unsigned int)');
// Payload_Init: skip the MKW-SP-layout-specific steps.
{
  const pi = sym('Payload_Init');
  const edits = [];
  for (let a = pi; a < pi + 0x400; a += 4) {
    const d = decode(r32(a), a);
    if (d.kind === 'b' && d.lk) {
      const t = d.target, n = C.symAt(t);
      if (t === 0x801a10ec) { w32(a, NOP); edits.push('OSSetMEM1ArenaLo'); }                 // arena lo past payload
      else if ([0x801b94a4, 0x801bab2c, 0x801ba9a4, 0x801b99ec].includes(t)) { w32(a, NOP); edits.push(n); } // VI re-init for SP console
      else if (n === 'memset' && a > sym('SP::Rel::Load()') - 0x100000 && edits.includes('VIWaitForRetrace')) { w32(a, NOP); edits.push('arena memset'); }
      else if (n === 'SP::Rel::Load()') { w32(a, 0x3c800100); edits.push('Rel::Load -> ok'); } // lis r4,0x100: 'rlwinm. r4,r4,8,24,31' tests the top byte
    }
    if (d.kind === 'bclr' || (d.kind === 'b' && !d.lk && t_isRichPresence(d.target))) break;
  }
  function t_isRichPresence(t) { return C.symAt(t).startsWith('System::RichPresenceManager::Init'); }
  // the Rel::Load result test is a bc right after 'mr r30,r3'
  for (let a = pi; a < pi + 0x400; a += 4) { const d = decode(r32(a), a); if (d.kind === 'bc' && r32(a - 8) === 0x38800001) { /* r4 forced to 1 */ } }
  log('Payload_Init edits:', edits.join(', '));
}
// Special-purpose registers used as secrets / CPU ids: read as 0, ignore writes.
let sprEdits = 0;
for (let i = 0; i < A.ins.length; i++) {
  const a = C.P0 + i * 4, w = r32(a), op = w >>> 26, xo = (w >>> 1) & 0x3ff;
  if (A.ins[i].kind === 'data') continue;
  if (op === 31 && (xo === 339 || xo === 467)) {
    const spr = (((w >>> 11) & 31) << 5) | ((w >>> 16) & 31);
    if ([1010, 924, 925, 926, 927, 284, 285].includes(spr)) {
      w32(a, xo === 339 ? (0x38000000 | (((w >>> 21) & 31) << 21)) : NOP); sprEdits++;
    }
  }
}
log('spr edits', sprEdits);
// Logging: MKW-SP's OSReport and console printing go to the game's OSReport, which the runtime logs.
{
  const gameOSReport = 0x801a25d0;
  for (const n of ['OSReport', 'Console::Print(char const*)']) {
    const a = C.smap.filter(s => s.n === n && s.a >= C.P0 && s.a < CODE_END).map(s => s.a)[0];
    w32(a, 0x48000000); addReloc('Rel24', off(a), gameOSReport);
    log('route', n, 'to game OSReport');
  }
}

// Boot order: MKW-SP's loader runs the payload entry (static constructors) before the game starts and
// Payload_Init later from OSInit. Reproduce that: the OSInit hook enters the payload entry, which runs
// the constructors and then tail-calls Payload_Init instead of the runtime patcher.
{
  const entry = C.P0, tail = 0x8076f0c0;
  if (decode(r32(tail), tail).target !== sym('Patcher_patch')) throw new Error('payload entry layout changed');
  w32(tail, 0x48000000 | ((sym('Payload_Init') - tail) & 0x3fffffc));
  // The Kamek ctor range must stay populated so the translator registers every constructor as a
  // function entry, but the runtime runs that range again after the REL prolog (skipping zero
  // entries). Clear the table once the entry has run it, in place of the stack-canary setup calls.
  const ctors = 0x807FBC74, at = 0x8076f098, memset = sym('memset');
  if (decode(r32(at), at).target !== sym('StackCanary_Init') || decode(r32(at + 0x14), at + 0x14).target !== sym('SP::StackCanary::AddLinkRegisterPatches(unsigned int*, unsigned int*)')) throw new Error('payload entry layout changed');
  w32(at, 0x3c600000 | (((ctors + 0x8000) >>> 16) & 0xffff)); addReloc('Addr16Ha', off(at) + 2, off(ctors));      // lis r3,ctors@ha
  w32(at + 4, 0x38630000 | (ctors & 0xffff)); addReloc('Addr16Lo', off(at + 4) + 2, off(ctors));                 // addi r3,r3,ctors@l
  w32(at + 8, 0x38800000);                                                                                        // li r4,0
  w32(at + 12, 0x38a00020);                                                                                       // li r5,32
  w32(at + 16, 0x48000001 | ((memset - (at + 16)) & 0x3fffffc));                                                  // bl memset
  w32(at + 20, NOP);
  log('payload entry now runs ctors, clears the table, then tail-calls Payload_Init');
}

// MEM1 layout: StaticR is translated for 0x805102E0, so nothing may be carved off the bottom of the
// MEM1 arena before the game creates its heaps. NANDArchiveStorage takes its contents.arc index
// from OSAllocFromMEM1ArenaLo; serve it from the MEM2 arena instead via a small helper placed in
// the body of the stubbed SP::PageTable::Init (which keeps its leading blr).
{
  const helper = sym('SP::PageTable::Init()') + 8;
  const getLo = 0x801A10C4, setLo = 0x801A10F4;
  const rlwinmAlign32 = (rS, rA) => ((21 << 26) | (rS << 21) | (rA << 16) | (0 << 11) | (0 << 6) | (26 << 1)) >>> 0;
  const code = [
    0x9421FFF0,                 // stwu r1,-16(r1)
    0x7C0802A6,                 // mflr r0
    0x90010014,                 // stw  r0,20(r1)
    0x93E1000C,                 // stw  r31,12(r1)
    0x3BE3001F,                 // addi r31,r3,31
    rlwinmAlign32(31, 31),      // clrrwi r31,r31,5        (size rounded to 32)
    'bl getLo',                 // bl   OSGetMEM2ArenaLo
    0x3863001F,                 // addi r3,r3,31
    rlwinmAlign32(3, 3),        // clrrwi r3,r3,5          (32-byte aligned block)
    0x90610008,                 // stw  r3,8(r1)
    0x7C63FA14,                 // add  r3,r3,r31
    'bl setLo',                 // bl   OSSetMEM2ArenaLo
    0x80610008,                 // lwz  r3,8(r1)
    0x83E1000C,                 // lwz  r31,12(r1)
    0x80010014,                 // lwz  r0,20(r1)
    0x7C0803A6,                 // mtlr r0
    0x38210010,                 // addi r1,r1,16
    0x4E800020,                 // blr
  ];
  code.forEach((w, k) => {
    const a = helper + k * 4;
    if (typeof w === 'string') { w32(a, 0x48000001); addReloc('Rel24', off(a), w.endsWith('getLo') ? getLo : setLo); }
    else w32(a, w);
  });
  const call = 0x807da14c;
  if (decode(r32(call), call).target !== 0x801A1104) throw new Error('NANDArchiveStorage layout changed');
  w32(call, 0x48000001 | ((helper - call) & 0x3fffffc));
  log('NANDArchiveStorage index buffer moved from the MEM1 arena to the MEM2 arena');
}
if (RK) RK.applyPayload({ r32, w32, log });

// ---------------------------------------------------------------- 1b. translator compatibility
// (a) bso/bns after a self-compare (NaN test): unordered <=> !equal for fcmpu x,x.
let nanEdits = 0;
for (let i = 1; i < A.ins.length; i++) {
  const a = C.P0 + i * 4, w = r32(a);
  if (A.ins[i].kind === 'data' || (w >>> 26) !== 16) continue;
  const bo = (w >>> 21) & 31, bi = (w >>> 16) & 31;
  if ((bi & 3) !== 3) continue;
  const p = r32(a - 4), crf = (p >>> 23) & 7;
  const isSelfCmp = (p >>> 26) === 63 && ((p >>> 1) & 0x3ff) === 0 && crf === (bi >> 2) && ((p >>> 16) & 31) === ((p >>> 11) & 31);
  if (!isSelfCmp) { log('WARN summary-overflow branch without self fcmpu at', C.hex(a)); continue; }
  const taken = (bo & 0x1c) === 0x0c;                                  // branch-if-true
  const nbo = taken ? 4 : 12, nbi = (bi & ~3) | 2;                     // unordered -> !EQ ; ordered -> EQ
  w32(a, (w & 0xfc00ffff) | (nbo << 21) | (nbi << 16)); nanEdits++;
}
log('NaN-test branch rewrites', nanEdits);
// (b) calls to noreturn functions become plain branches so control flow never falls through
//     into the next function or into data.
const NORETURN = new Set(['panic', '__assert_func', '__stack_chk_fail'].map(sym));
let nrEdits = 0;
for (let i = 0; i < A.ins.length; i++) {
  const a = C.P0 + i * 4, d = decode(r32(a), a);
  if (A.ins[i].kind !== 'data' && d.kind === 'b' && d.lk && NORETURN.has(d.target)) { w32(a, r32(a) & ~1); nrEdits++; }
}
log('noreturn bl -> b', nrEdits);
// (c) clang's position-independent jump tables (entries are offsets from the table, dispatched with
//     lwzx/add/mtctr/bctr) become absolute tables (lwzx/mtctr/bctr), the form the translator
//     recognises. The table words then hold payload addresses and get Addr32 relocations in pass 3.
let nTables = 0;
for (let i = 8; i < A.ins.length; i++) {
  const d = A.ins[i]; if (d.kind !== 'bcctr' || d.lk || !d.uncond) continue;
  const at = k => C.P0 + (i - k) * 4;
  const wMt = r32(at(1)), wAdd = r32(at(2)), wLd = r32(at(3));
  const isMtctr = (wMt & 0xfc1fffff) === 0x7c0903a6;
  const isAdd = (wAdd >>> 26) === 31 && ((wAdd >>> 1) & 0x1ff) === 266;
  const isLwzx = (wLd >>> 26) === 31 && ((wLd >>> 1) & 0x3ff) === 23;
  if (!(isMtctr && isAdd && isLwzx)) continue;
  const rT = (wMt >>> 21) & 31, rX = (wLd >>> 21) & 31, rB = (wLd >>> 16) & 31, rI = (wLd >>> 11) & 31;
  const aA = (wAdd >>> 16) & 31, aB = (wAdd >>> 11) & 31;
  if (((wAdd >>> 21) & 31) !== rT || !((aA === rX && aB === rB) || (aA === rB && aB === rX))) { log('WARN odd jump-table add at', C.hex(at(2))); continue; }
  // table base: lis rB / addi rB,rB ; bound: nearest cmplwi
  let hi = null, lo = null, bound = null;
  for (let k = 4; k < 80 && at(k) >= C.P0 && (hi === null || lo === null || bound === null); k++) {
    const e = decode(r32(at(k)), at(k));
    if (lo === null && e.kind === 'addi' && e.rD === rB && e.rA === rB) lo = e.simm;
    else if (hi === null && e.kind === 'addis' && e.rA === 0 && e.rD === rB) hi = e.imm;
    if (bound === null && (r32(at(k)) >>> 26) === 10) bound = r32(at(k)) & 0xffff;
  }
  if (hi === null || lo === null || bound === null) { log('WARN unresolved jump table at', C.hex(at(0))); continue; }
  const table = ((hi << 16) + lo) >>> 0, count = bound + 1;
  const fnStart = C.sorted.filter(s => s.a <= at(0) && s.a >= C.P0).pop().a;
  const targets = [];
  for (let k = 0; k < count; k++) targets.push((table + (C.pay.readInt32BE(table - C.P0 + k * 4))) >>> 0);
  if (targets.some(t => t < fnStart || t >= CODE_END)) { log('WARN jump table targets outside function at', C.hex(at(0))); continue; }
  targets.forEach((t, k) => w32(table + k * 4, t));
  w32(at(3), (wLd & ~(31 << 21)) | (rT << 21));   // lwzx rT,rB,rI
  w32(at(2), NOP);
  nTables++;
}
log('relative jump tables converted', nTables);
// (d) NoFont: 'bl endStr' over an inline string -> load the string address explicitly.
{
  const noFont = sym('NoFont'), endStr = sym('endStr'), str = noFont + 8, pad = 0x807e59e4;
  if (r32(noFont + 4) !== 0x48000031 || r32(endStr) !== 0x7c6802a6 || r32(pad) || r32(pad + 4) || r32(pad + 8)) throw new Error('NoFont layout changed');
  w32(noFont + 4, 0x48000000 | ((pad - (noFont + 4)) & 0x3fffffc));   // b pad
  w32(pad, 0x3c600000 | (((str + 0x8000) >>> 16) & 0xffff));           // lis r3,str@ha
  w32(pad + 4, 0x38630000 | (str & 0xffff));                           // addi r3,r3,str@l
  w32(pad + 8, NOP); w32(endStr, NOP);                                 // fall into 'bl OSReport'
  addReloc('Addr16Ha', off(pad) + 2, off(str)); addReloc('Addr16Lo', off(pad + 4) + 2, off(str));
  log('NoFont inline string rewritten');
}

// ---------------------------------------------------------------- 2. code relocations
// 2a. lis/lo pairs
const hiFix = new Map();   // lis index -> {targets:Set(seg), sample addr, ori}
for (const u of A.users) {
  const s = C.seg(u.v);
  if (s === 'other' || s === 'dol') continue;
  if (!hiFix.has(u.hi)) hiFix.set(u.hi, { segs: new Set(), v: u.v, ori: false, users: [] });
  const h = hiFix.get(u.hi); h.segs.add(s); h.users.push(u); if (u.kind === 'ori') h.ori = true;
}
let nHa = 0, nLo = 0, nRemap = 0, conflicts = 0;
for (const [hi, h] of hiFix) {
  const la = C.P0 + hi * 4;
  if (stubbedRange(la)) continue;
  if (h.segs.size > 1) { conflicts++; log('CONFLICT lis', C.hex(la), [...h.segs]); continue; }
  const s = [...h.segs][0];
  if (s === 'pay') {
    if (h.ori) { if (h.users.some(u => (u.v & 0xffff) >= 0x8000)) log('WARN ori/hi with lo>=0x8000 at', C.hex(la)); }
    addReloc('Addr16Ha', off(la) + 2, off(h.v)); nHa++;
    for (const u of h.users) { addReloc('Addr16Lo', off(C.P0 + u.lo * 4) + 2, off(u.v)); nLo++; }
  } else { // rel / relbss: rewrite statically for vanilla layout
    const nv = C.mapAddr(h.v); const nh = h.ori ? (nv >>> 16) : ((nv + 0x8000) >>> 16);
    w32(la, (r32(la) & 0xffff0000) | nh);
    for (const u of h.users) { const ua = C.P0 + u.lo * 4; const nu = C.mapAddr(u.v); w32(ua, (r32(ua) & 0xffff0000) | (nu & 0xffff)); }
    nRemap++;
  }
}
function stubbedRange(a) { for (const s of stubbed) if (a >= s && a < s + 0x400 && C.symAt(a).startsWith(C.symAt(s).replace(/\+0x.*/, ''))) return true; return false; }
// 2b. lis with no visible users (hand-written trampolines that jump back into game code which
//     consumes the register). Resolve the consumer via vanilla REL relocation targets.
const usedHi = new Set(A.users.map(u => u.hi));
let trampolines = 0, unresolvedHi = [];
for (let i = 0; i < A.ins.length; i++) {
  const d = A.ins[i]; if (!(d.kind === 'addis' && d.rA === 0) || usedHi.has(i)) continue;
  const la = C.P0 + i * 4; if (stubbedRange(la)) continue;
  const hiv = d.imm;
  if (hiv < 0x8039 || hiv > 0x808d) continue;             // not an address in any relocatable segment
  // follow straight-line to an unconditional branch into the game
  let j = i + 1, target = null;
  for (; j < Math.min(A.ins.length, i + 8); j++) { const e = A.ins[j]; if (e.defs.includes(d.rD) && !(e.kind === 'b')) break; if (e.kind === 'b' && !e.lk) { target = e.target; break; } if (e.kind === 'bclr' || e.kind === 'bc') break; }
  if (target === null) { // hook entered via bl from game code: the consumer follows the hook site
    const fn = C.sorted.filter(s => s.a <= la).pop();
    const pe = fn && PATCHES.find(p => p.w[0] === 1 && p.w[2] === fn.a && ((p.w[3] >>> 24) & 1));
    if (pe) target = pe.w[1] + 4;
  }
  if (target !== null && C.seg(target) !== 'pay') {
    const vt = C.mapAddr(target);
    let resolved = null;
    for (let k = 0; k < 12 && !resolved; k++) {
      const ia = vt + k * 4, vd = decode(V.read32(ia), ia);
      const base = vd.kind === 'mem' || vd.kind === 'addi' ? vd.rA : vd.kind === 'ori' ? vd.rD : -1;
      if (base === d.rD) { const rt = V.relTargets.get(ia + 2); if (rt) resolved = rt.S; else resolved = 'norel'; }
      else if (vd.defs.includes(d.rD) || vd.kind === 'b' || vd.kind === 'bc' || vd.kind === 'bclr') break;
    }
    if (typeof resolved === 'number') {
      w32(la, (r32(la) & 0xffff0000) | (((resolved + 0x8000) >>> 16) & 0xffff)); trampolines++;
      log('trampoline lis', C.hex(la), 'r' + d.rD, '->', C.hex(resolved), 'via', C.hex(vt));
      continue;
    }
  }
  if (hiv >= 0x8078 && hiv <= 0x808c) { // unambiguous payload high half; consumer unseen (merge points etc.)
    addReloc('Addr16Ha', off(la) + 2, off((hiv << 16) >>> 0)); nHa++; continue;
  }
  unresolvedHi.push(C.hex(la) + ' ' + d.text + ' ' + C.symAt(la).slice(0, 60));
}
// 2b'. The reverse case: a hook trampoline replays a game instruction whose base register was set
//      by the game's own `lis` before the hook site (e.g. `lwz r3,s_raceConfig@l(r30)`). The low half
//      in the payload is for MKW-SP's layout; recompute it against the vanilla high half.
const invMap = v => (v >= 0x805102E0 && v < 0x808DD3E0) ? (v - C.REL_D) >>> 0 : (v >= 0x809BD6E0 && v < 0x809C4F90) ? (v - C.BSS_D) >>> 0 : null;
let liveInFixes = 0;
for (const e of PATCHES) {
  if (e.w[0] !== 1 || C.seg(e.w[2]) !== 'pay') continue;
  const hookV = C.mapAddr(e.w[1]);
  const defined = new Set([1, 2, 13]);
  for (let k = 0, a = e.w[2]; k < 48; k++, a += 4) {
    const d = decode(r32(a), a);
    const base = (d.kind === 'mem' || (d.kind === 'addi' && d.rA)) ? d.rA : -1;
    if (base > 0 && !defined.has(base)) {
      // find what defines `base` in the game code leading up to the hook site
      for (let j = 1; j <= 64; j++) {
        const va = hookV - j * 4, vd = decode(V.read32(va), va);
        if (!vd.defs.includes(base)) continue;
        const rt = V.relTargets.get(va + 2);
        if (vd.kind === 'addis' && vd.rA === 0 && rt && rt.type === 6) {
          const spSym = invMap(rt.S);
          if (spSym !== null) {
            const spTarget = ((((spSym + 0x8000) >>> 16) << 16) + d.simm) >>> 0;
            if (C.seg(spTarget) === 'rel' || C.seg(spTarget) === 'relbss') {
              const lo = (C.mapAddr(spTarget) - (vd.imm << 16)) | 0;
              if (lo >= -0x8000 && lo < 0x8000) { w32(a, (r32(a) & 0xffff0000) | (lo & 0xffff)); liveInFixes++; log('live-in lo', C.hex(a), C.symAt(a).slice(0, 40), 'r' + base, C.hex(spTarget), '->', C.hex(C.mapAddr(spTarget))); }
              else log('WARN live-in lo out of range at', C.hex(a));
            }
          }
        }
        break;
      }
    }
    for (const r of d.defs) defined.add(r);
    if (d.kind === 'b' && !d.lk) break;
    if (d.kind === 'bclr' && d.uncond) break;
  }
}
log('lis relocated(Ha)', nHa, 'lo', nLo, 'rel-remapped lis', nRemap, 'conflicts', conflicts, 'trampolines', trampolines, 'live-in lo fixes', liveInFixes);
for (const u of unresolvedHi) log('UNRESOLVED lis', u);

// 2c. branches leaving the payload
let nRel24 = 0;
for (let i = 0; i < A.ins.length; i++) {
  const a = C.P0 + i * 4; if (A.ins[i].kind === 'data') continue; const d = decode(r32(a), a);
  if (d.kind === 'b' && !d.aa && C.seg(d.target) !== 'pay') { addReloc('Rel24', off(a), C.mapAddr(d.target)); nRel24++; }
  if (d.kind === 'bc' && C.seg(d.target) !== 'pay') log('WARN external bc at', C.hex(a), C.hex(d.target));
}
log('external branches (Rel24)', nRel24);

// ---------------------------------------------------------------- 2d. function-entry hints
// The translator only makes an address dispatchable if it discovers it as a function entry. Code
// reached solely through vtables or stored function pointers can be missed (e.g. a function that
// follows one ending in a tail call is merged into it). Every address in the Kamek ctor range is
// registered as an entry, and the payload entry clears that whole range after running the eight
// real constructors, so list all pointer-referenced code addresses right after the real ctors, in
// the space of MKW-SP's (now unused) runtime patch table.
const PATCH_TABLE = 0x807FBC94, PATCH_TABLE_END = 0x807FE7F0;
const entryHints = new Set();
for (let a = CODE_END; a + 4 <= PEND; a += 4) {
  if (a >= PATCH_TABLE && a < PATCH_TABLE_END) continue;
  const v = C.u32(a); if (v >= C.P0 && v < CODE_END && !(v & 3) && !A.isData(v)) entryHints.add(v);
}
const smapSet = new Set(C.smap.map(s => s.a));
for (const u of A.users) if (u.v >= C.P0 && u.v < CODE_END && smapSet.has(u.v)) entryHints.add(u.v);
const hintList = [...entryHints].sort((x, y) => x - y);
if (PATCH_TABLE + hintList.length * 4 > PATCH_TABLE_END) throw new Error('too many entry hints');
hintList.forEach((v, k) => w32(PATCH_TABLE + k * 4, v));
// Fork functions only reached through pointers (tools/rankings.js FORK_ENTRIES) get hint slots too;
// their addresses are filled in once the fork code is emitted.
const forkEntrySlots = PATCH_TABLE + hintList.length * 4;
const CTOR_RANGE_END = forkEntrySlots + (RK ? RK.FORK_ENTRIES.length : 0) * 4;
{ // widen the entry's clearing memset to the whole range
  const li = 0x8076f098 + 12;
  if (r32(li) !== 0x38a00020) throw new Error('ctor clear layout changed');
  w32(li, 0x38a00000 | ((CTOR_RANGE_END - 0x807FBC74) & 0xffff));
}
log('function-entry hints', hintList.length);

// ---------------------------------------------------------------- 2e. call-entered hooks that leave by jumping
// The translator models a `bl` hook as a call that returns to hook+4. Some MKW-SP trampolines are
// entered by `bl` but may leave with `b` into the middle of the hooked game function; translated, that
// continuation would return into the overlay, which then also runs from hook+4. Rewrite those as
// `b`-entered hooks: a copy of the trampoline in free module space where every return becomes an
// explicit branch back to hook+4.
const mapFnSet = new Set(fs.readFileSync(path.join(V.INSTALL, 'BuildWorkspace/projects/mkwii/MAP.txt'), 'latin1').split('\n').map(l => parseInt(l.split(' ')[0], 16)).filter(x => x));
const TRAMP_START = CTOR_RANGE_END; let trampCursor = TRAMP_START;
const rewrittenHooks = new Map();   // payload src -> new trampoline address
for (const e of PATCHES) {
  const [type, dst, src, x] = e.w;
  if (type !== 1 || !((x >>> 24) & 1) || C.seg(src) !== 'pay') continue;
  // collect the linear trampoline
  const body = []; let midFunctionExit = false;
  for (let a = src; a < src + 4 * 64; a += 4) {
    const d = decode(r32(a), a); body.push(a);
    if (d.kind === 'b' && !d.lk) { midFunctionExit = C.seg(d.target) !== 'pay' && !mapFnSet.has(C.mapAddr(d.target)); break; }
    if ((d.kind === 'bclr' && d.uncond) || (d.kind === 'bcctr' && !d.lk)) break;
  }
  if (!midFunctionExit) continue;
  const back = C.mapAddr(dst) + 4;
  const start = trampCursor; const posOf = new Map(); const fixups = [];
  const emit = w => { w32(trampCursor, w); trampCursor += 4; return trampCursor - 4; };
  let ok = true;
  for (const a of body) {
    const w = r32(a), d = decode(w, a); posOf.set(a, trampCursor);
    // carry this instruction's relocations along
    for (const rl of relocs.filter(r => r.at >= off(a) && r.at < off(a) + 4)) relocs.push({ t: rl.t, at: off(trampCursor) + (rl.at - off(a)), target: rl.target });
    if (d.kind === 'bclr' && !d.lk) {
      if (d.uncond) { const at = emit(0x48000000); addReloc('Rel24', off(at), back); continue; }
      const bo = (w >>> 21) & 31, bi = (w >>> 16) & 31;
      if ((bo & 0x14) !== 0x04) { ok = false; break; }                       // only plain condition tests
      emit(0x40000000 | ((bo ^ 8) << 21) | (bi << 16) | 8);                     // b!cond +8
      const at = emit(0x48000000); addReloc('Rel24', off(at), back); continue;
    }
    if (d.kind === 'b') {
      const at = emit(w & 0xfc000003);
      addReloc('Rel24', off(at), C.seg(d.target) === 'pay' ? off(d.target) : C.mapAddr(d.target));
      continue;
    }
    if (d.kind === 'bc') { if (d.target >= body[0] && d.target <= body[body.length - 1]) fixups.push([emit(w), d.target]); else ok = false; continue; }
    emit(w);
  }
  if (!ok) { log('WARN could not rewrite bl-hook trampoline', C.hex(src)); trampCursor = start; continue; }
  for (const [at, tgt] of fixups) w32(at, (r32(at) & 0xffff0003) | ((posOf.get(tgt) - at) & 0xfffc));
  rewrittenHooks.set(src, start);
  log('bl-hook rewritten as b-hook', C.symAt(dst).slice(0, 50), C.hex(src), '->', C.hex(start));
}
// Rankings fork hooks (tools/rankings.js): game-code hooks get a trampoline (code, then the replaced
// instruction and a branch back); payload call sites are pointed at a stub.
const forkBranches = [];
// Payload code symbol: some names also have an entry in the old patch table, which now holds hints and trampolines.
const codeSym = n => { const s = C.smap.find(x => x.n === n && x.a >= C.P0 && x.a < PATCH_TABLE); if (!s) throw new Error('no code symbol ' + n); return s.a; };
const forkEntries = new Map();   // name -> payload address of the emitted entry
function emitForkCode(code) {
  const start = trampCursor;
  for (const e of code) {
    const at = trampCursor, w = typeof e === 'number' ? e : e.w;
    if (typeof e === 'number') w32(at, w);
    else if (e.rel24 !== undefined) { w32(at, w); addReloc('Rel24', off(at), e.rel24); }
    else if (e.pay !== undefined) { w32(at, (w & 0xfc000003) | ((codeSym(e.pay) - at) & 0x3fffffc)); }
    else if (e.ha !== undefined) { w32(at, w); addReloc('Addr16Ha', off(at) + 2, e.ha - MODULE_BASE); }
    else if (e.lo !== undefined) { w32(at, w); addReloc('Addr16Lo', off(at) + 2, e.lo - MODULE_BASE); }
    else if (e.payAt !== undefined) { w32(at, (w & 0xfc000003) | ((e.payAt - at) & 0x3fffffc)); }
    else if (e.entryHa !== undefined || e.entryLo !== undefined) {
      const target = forkEntries.get(e.entryHa !== undefined ? e.entryHa : e.entryLo);
      if (target === undefined) throw new Error('rankings: unknown fork entry');
      w32(at, w); addReloc(e.entryHa !== undefined ? 'Addr16Ha' : 'Addr16Lo', off(at) + 2, off(target));
    }
    else throw new Error('rankings: bad code entry');
    trampCursor += 4;
  }
  return start;
}
(RK ? RK.FORK_ENTRIES : []).forEach((e, k) => {
  const start = emitForkCode(e.code);
  forkEntries.set(e.name, start);
  w32(forkEntrySlots + k * 4, start);
  log('rankings: fork entry', C.hex(start), '-', e.what);
});
for (const h of (RK ? RK.PAYLOAD_SITE_HOOKS : [])) {
  if (r32(h.at) !== h.expect) throw new Error('rankings: payload hook site changed at ' + C.hex(h.at));
  const start = emitForkCode([...h.code, h.expect, { w: 0x48000000, payAt: h.at + 4 }]);
  w32(h.at, 0x48000000 | ((start - h.at) & 0x3fffffc));
  log('rankings: payload site hook', C.hex(h.at), '->', C.hex(start), '-', h.what);
}
for (const h of (RK ? RK.HOOKS : [])) {
  if ((V.read32(h.at) >>> 0) !== h.expect) throw new Error('rankings: hook site changed at ' + C.hex(h.at));
  const start = emitForkCode(h.replay === false ? h.code : [...h.code, h.expect]);
  emitForkCode([{ w: 0x48000000, rel24: h.replay === false ? h.back : h.at + 4 }]);
  forkBranches.push({ abs: h.at, tramp: start });
  log('rankings: hook', C.hex(h.at), '->', C.hex(start), '-', h.what);
}
for (const h of (RK ? RK.PAYLOAD_HOOKS : [])) {
  const d = decode(r32(h.at), h.at);
  if (!(d.kind === 'b' && d.lk && d.target === codeSym(h.target))) throw new Error('rankings: payload call site changed at ' + C.hex(h.at));
  const start = emitForkCode(h.code);
  w32(h.at, 0x48000001 | ((start - h.at) & 0x3fffffc));
  log('rankings: payload hook', C.hex(h.at), '->', C.hex(start), '-', h.what);
}
if (RK) {   // after-time-trial menu buttons (tools/rankings.js)
  const m = RK.AFTER_TA_MENU;
  if (r32(m.count.at) !== m.count.was || r32(m.ret.at) !== m.ret.was) throw new Error('rankings: AfterTaRaceMenuPage layout changed');
  const table = emitForkCode(m.buttons), tableMod = MODULE_BASE + off(table);
  const stub = emitForkCode([{ w: 0x3c600000, ha: tableMod }, { w: 0x38630000, lo: tableMod }, 0x4e800020]);
  w32(m.ret.at, 0x48000000 | ((stub - m.ret.at) & 0x3fffffc));
  w32(m.count.at, m.count.now);
  log('rankings: after-time-trial menu buttons', m.buttons.join(','), 'at', C.hex(table));
}
const TRAMP_END = trampCursor;
if (TRAMP_END > PATCH_TABLE_END) throw new Error('trampoline space exhausted');

// ---------------------------------------------------------------- 3. data pointers
const mapFns = new Set(fs.readFileSync(path.join(V.INSTALL, 'BuildWorkspace/projects/mkwii/MAP.txt'), 'latin1').split('\n').map(l => parseInt(l.split(' ')[0], 16)).filter(x => x));
const smapAddrs = new Set(C.smap.map(s => s.a));
let nA32 = 0, nDataRemap = 0, skipped = [];
for (let a = CODE_END; a + 4 <= PEND; a += 4) {
  if (a >= TRAMP_START && a < TRAMP_END) continue;
  const v = r32(a), s = C.seg(v);
  if (s === 'pay') { addReloc('Addr32', off(a), off(v)); nA32++; }
  else if (s === 'rel' || s === 'relbss') {
    const nv = C.mapAddr(v);
    if (mapFns.has(nv) || smapAddrs.has(v)) { w32(a, nv); nDataRemap++; }
    else if (skipped.length < 4000) skipped.push(a);
  }
}
log('data Addr32', nA32, 'data REL remaps', nDataRemap, 'REL-range words left alone', skipped.length);

// ---------------------------------------------------------------- 4. thunks + patch table -> Kamek patch commands
const patchCmds = [];   // {t, abs, args}
const PT = { Write32: 32, Write16: 33, Write8: 34, Branch: 64, BranchLink: 65, Addr32: 1 };
const DROP = new Map([
  ['System::RkSystem::initialize()+0x360', 'removes a vanilla 10 MiB heap to make room for MKW-SP\'s layout'],
  ['__init_registers+0x8c', 'stack-canary stack re-alignment at boot'],
  ['OSReport', 'MKW-SP OSReport is routed to the game OSReport instead (runtime log)'],
  // The runtime implements these natively; an MKW-SP replacement would bypass the runtime's version
  // (e.g. threads created through the original OSCreateThread body never get a host fiber).
  ['OSCreateThread', 'runtime-native thread creation'],
  // StaticR is translated for 0x805102E0, so the game's REL buffer must be allocated exactly where
  // vanilla allocates it: keep the vanilla system heap sizes.
  ['EGG_ConfigurationData_initMemory+0x158', 'MKW-SP heap resize; WiiCompiled needs the vanilla heap layout'],
  ['EGG::Exception::create(unsigned short, unsigned short, unsigned short, EGG::Heap*, unsigned int)', 'larger exception console would shift the REL allocation'],
  ['RkSystem_main+0x90', 'MKW-SP jumps into its own pre-loaded REL here; WiiCompiled loads StaticR on the vanilla path'],
  ['OSPanic', 'runtime-native panic reporting'],
  ['EGG::AsyncDisplay::endRender()', 'runtime-native frame presentation'],
  ...(RK ? RK.DROP : []),
]);
let nBranch = 0, nWrite = 0, nThunk = 0, dropped = 0;
function remapInsn(w, atSp) {           // fix a game-code instruction that will live at map(atSp)
  const d = decode(w, atSp);
  if (d.kind === 'b' && !d.aa) { const nt = C.mapAddr(d.target), na = C.mapAddr(atSp); return (w & 0xfc000003) | ((nt - na) & 0x3fffffc); }
  if (d.kind === 'bc' && !d.aa) { const nt = C.mapAddr(d.target), na = C.mapAddr(atSp); if (((nt - na) | 0) !== ((d.target - atSp) | 0)) log('WARN bc distance changed at', C.hex(atSp)); return (w & 0xffff0003) | ((nt - na) & 0xfffc); }
  return w;
}
for (const e of PATCHES) {
  const [type, dst, src, x, thunk] = e.w;
  const where = C.symAt(dst);
  if (DROP.has(where)) {
    log('DROP patch', where, '-', DROP.get(where)); dropped++;
    // MKW-SP code may still call its replacement directly, which calls the original through this
    // thunk: make the thunk enter the (unpatched, possibly runtime-native) game function itself.
    if (type === 1 && thunk) { w32(thunk, 0x48000000); addReloc('Rel24', off(thunk), C.mapAddr(dst)); w32(thunk + 4, NOP); log('  thunk', C.hex(thunk), '-> b', C.hex(C.mapAddr(dst))); }
    continue;
  }
  const vdst = C.mapAddr(dst);
  if (type === 1) {
    const link = (x >>> 24) & 1;
    if (thunk) { // thunk = original first instruction + branch back
      const orig = V.read32(vdst);
      const od = decode(orig, vdst);
      if (od.kind === 'b' || od.kind === 'bc') {
        if (od.kind === 'b' && !od.aa) { w32(thunk, orig & 0xfc000003); addReloc('Rel24', off(thunk), od.target); }
        else log('WARN thunk original is a conditional branch', where);
      } else w32(thunk, orig);
      w32(thunk + 4, 0x48000000); addReloc('Rel24', off(thunk + 4), vdst + 4); nThunk++;
    }
    const tgt = src === sym('Payload_Init') ? C.P0 : src;   // run constructors first (see boot order)
    if (rewrittenHooks.has(src)) { patchCmds.push({ t: PT.Branch, abs: vdst, args: [off(rewrittenHooks.get(src))] }); nBranch++; continue; }
    patchCmds.push({ t: link ? PT.BranchLink : PT.Branch, abs: vdst, args: [relTarget(tgt)] }); nBranch++;
  } else if (type === 0) {
    const size = x; let k = 0;
    // lis/lo pairs inside written code that point at REL data (MKW-SP layout) -> vanilla
    const buf = Buffer.from(C.pay.subarray(src - C.P0, src - C.P0 + size));
    for (let q = 0; q + 4 <= size; q += 4) {
      const d = decode(buf.readUInt32BE(q), dst + q);
      if (d.kind === 'addis' && d.rA === 0 && d.imm >= 0x8039 && d.imm <= 0x808d) {
        for (let q2 = q + 4; q2 + 4 <= size; q2 += 4) {
          const u = decode(buf.readUInt32BE(q2), dst + q2);
          const base = u.kind === 'mem' || u.kind === 'addi' ? u.rA : u.kind === 'ori' ? u.rD : -1;
          if (base === d.rD) {
            const full = ((d.imm << 16) + (u.kind === 'ori' ? u.imm : u.simm)) >>> 0, s = C.seg(full);
            if (s === 'rel' || s === 'relbss') { const nv = C.mapAddr(full); buf.writeUInt16BE(((nv + 0x8000) >>> 16) & 0xffff, q + 2); buf.writeUInt16BE(nv & 0xffff, q2 + 2); log('patch-data REL pair', where, C.hex(full), '->', C.hex(nv)); }
            else if (s === 'pay') { const nv = (full + SHIFT) >>> 0; buf.writeUInt16BE(((nv + 0x8000) >>> 16) & 0xffff, q + 2); buf.writeUInt16BE(nv & 0xffff, q2 + 2); log('patch-data payload pair (static, assumes module base)', where, C.hex(full), '->', C.hex(nv)); }
            break;
          }
          if (u.defs.includes(d.rD)) break;
        }
      }
    }
    for (; k + 4 <= size; k += 4) {
      let v = buf.readUInt32BE(k);
      // Words written into game code are instructions (e.g. 0x80770044 = lwz r3,0x44(r23)), never pointers.
      const intoCode = (vdst + k >= 0x800072C0 && vdst + k < 0x80244DE0) || (vdst + k >= 0x805103B4 && vdst + k < 0x8088F400);
      if (!intoCode && C.seg(v) === 'pay') { patchCmds.push({ t: PT.Addr32, abs: vdst + k, args: [off(v)] }); nWrite++; continue; }
      v = remapInsn(v, dst + k);
      patchCmds.push({ t: PT.Write32, abs: vdst + k, args: [v >>> 0] }); nWrite++;
    }
    if (k + 2 <= size) { patchCmds.push({ t: PT.Write16, abs: vdst + k, args: [buf.readUInt16BE(k)] }); k += 2; nWrite++; }
    if (k < size) { patchCmds.push({ t: PT.Write8, abs: vdst + k, args: [buf[k]] }); nWrite++; }
  } else throw new Error('unknown patch type ' + type);
}
log('patch table:', PATCHES.length, 'entries ->', nBranch, 'branches,', nWrite, 'writes,', nThunk, 'thunks,', dropped, 'dropped');
if (RK) {
  const gw = RK.gameWrites(V, log);
  for (const g of gw) patchCmds.push({ t: PT.Write32, abs: g.abs, args: [g.w >>> 0] });
  for (const b of forkBranches) patchCmds.push({ t: PT.Branch, abs: b.abs, args: [off(b.tramp)] });
  log('rankings: game code writes', gw.length, ', hooks', forkBranches.length);
}

// ---------------------------------------------------------------- 4b. kill feed data block
// The runtime kill feed (runtime/src/kill_feed.cpp) turns the unused RoomCodeLow setting into
// Settings > Race > Kill Feed at boot. The name and message IDs that entry points at live here,
// past the payload's bss: magic, explanation IDs [Disable, Enable], title ID, "KillFeed\0".
const KF = require('./killfeed.js');
const kfOff = (code.length + 31) & ~31;
const kfBlock = Buffer.alloc(32);
kfBlock.writeUInt32BE(KF.DATA_MAGIC, 0); kfBlock.writeUInt32BE(KF.MSG_EXPL_DISABLE, 4);
kfBlock.writeUInt32BE(KF.MSG_EXPL_ENABLE, 8); kfBlock.writeUInt32BE(KF.MSG_TITLE, 12);
kfBlock.write(KF.NAME + '\0', 16, 'latin1');
if (MODULE_BASE + kfOff !== KF.DATA_ADDR) throw new Error('kill feed data block moved to ' + C.hex(MODULE_BASE + kfOff) + '; update DATA_ADDR and kill_feed.cpp');
const blobParts = [code, Buffer.alloc(kfOff - code.length), kfBlock];
log('kill feed data block at', C.hex(MODULE_BASE + kfOff));
if (RK) {   // champion ghost slot (tools/rankings.js, runtime/src/mkwlb_rankings.cpp)
  if (MODULE_BASE + kfOff + kfBlock.length !== RK.CHAMPION_SLOT) throw new Error('rankings: champion slot moved to ' + C.hex(MODULE_BASE + kfOff + kfBlock.length));
  blobParts.push(Buffer.alloc(RK.CHAMPION_SLOT_SIZE));
  log('rankings: champion ghost slot at', C.hex(RK.CHAMPION_SLOT));
  // Settings > Rankings: category tables and the Continental Region setting's names / messages
  if (RK.CHAMPION_SLOT + RK.CHAMPION_SLOT_SIZE !== RK.SETTINGS_BLOCK) throw new Error('rankings: settings block moved');
  blobParts.push(RK.settingsBlock(a => C.u32(a), a => (MODULE_BASE + off(a)) >>> 0));
  const S = RK.RANKINGS_SETTINGS;
  for (const ref of RK.CATEGORY_REFS) {
    const target = RK.SETTINGS_BLOCK - MODULE_BASE + S.at[ref.table];
    const hit = relocs.filter(r => r.at === off(ref.lis) + 2 || r.at === off(ref.lo) + 2);
    if (hit.length !== 2) throw new Error('rankings: no relocations for ' + ref.what + ' at ' + C.hex(ref.lis));
    for (const r of hit) r.target = target;
    log('rankings:', ref.what, 'loads', ref.table, 'from the settings block');
  }
  log('rankings: settings block at', C.hex(RK.SETTINGS_BLOCK));
  // the notification bar's names, message info and text (runtime/src/mkwlb_rankings.cpp kNotifyBlock)
  if (RK.NOTIFY.block !== RK.SETTINGS_BLOCK + RK.SETTINGS_BLOCK_SIZE) throw new Error('rankings: notification block moved');
  blobParts.push(RK.notifyBlock());
  log('rankings: notification block at', C.hex(RK.NOTIFY.block));
}
const blob = Buffer.concat(blobParts);

// ---------------------------------------------------------------- 5. emit Kamek + Code.pul
const ctorStart = off(0x807FBC74), ctorEnd = off(CTOR_RANGE_END);   // real ctors + entry hints; cleared by the payload entry
const cmds = [];
const pushCmd = (t, at, abs, args) => {
  if (abs) { cmds.push((t << 24 | 0xFFFFFE) >>> 0, at >>> 0); } else { if (at >= 0xFFFFFE) throw new Error('offset too large'); cmds.push(((t << 24) | at) >>> 0); }
  for (const a of args) cmds.push(a >>> 0);
};
relocs.sort((x, y) => x.at - y.at);
for (const r of relocs) pushCmd(r.t, r.at, false, [r.target]);
for (const p of patchCmds) pushCmd(p.t, p.abs, true, p.args);
const hdr = Buffer.alloc(0x20); hdr.write('Kamek\0', 0, 'latin1'); hdr.writeUInt16BE(2, 6);
hdr.writeUInt32BE(0, 8); hdr.writeUInt32BE(blob.length, 12); hdr.writeUInt32BE(ctorStart, 16); hdr.writeUInt32BE(ctorEnd, 20);
const cmdBuf = Buffer.alloc(cmds.length * 4); cmds.forEach((v, i) => cmdBuf.writeUInt32BE(v, i * 4));
const kamek = Buffer.concat([hdr, blob, cmdBuf]);
const pulHdr = Buffer.alloc(16); pulHdr.writeUInt32BE(kamek.length, 0); pulHdr.writeUInt32BE(kamek.length, 4); pulHdr.writeUInt32BE(kamek.length, 8);
const pul = Buffer.concat([pulHdr, kamek, kamek, kamek]);   // P, E, J slots (only P is meaningful)
fs.mkdirSync(path.join(outDir, 'Binaries'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'Binaries', 'Code.pul'), pul);
fs.writeFileSync(path.join(outDir, 'payloadP.kmk'), kamek);
log('kamek blob', kamek.length, 'bytes; code', code.length, '; commands', cmds.length, 'words; relocs', relocs.length, '; patches', patchCmds.length);
log('module placement: blob base', C.hex(MODULE_BASE), 'payload at', C.hex(NEW_P0), 'end', C.hex(MODULE_BASE + blob.length));
fs.writeFileSync(path.join(outDir, 'convert-report.txt'), report.join('\n') + '\n');
console.log(report.filter(l => !l.startsWith('trampoline') && !l.startsWith('patch-data') && !l.startsWith('stub')).join('\n'));
