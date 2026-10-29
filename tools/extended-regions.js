// Extended Regions v1.2 (assets/extended-regions): flags and names for every Wii country code
// (1-254), where the game has 64. Its files go into MKW-SP's own archives in contents.arc, which
// the game reads after (and in place of) the disc's, so nothing on the disc is touched:
//   * the four layouts that show a flag (national_flag, chara_flag_machine_picture_common,
//     common_w075_ghost_data, common_w086_earth_mii_name), whose flag panes are named by country
//     code (the game looks them up with "%03d"), into the <Scene>SP.arc of each scene that has them,
//     with the 254 flags (001.tpl ... 254.tpl) in each of those layouts' timg folders,
//   * the country names (messages 0x15E0 + code) into every message/Menu.bmg, in its language
//     (Dutch takes the English names, as the mod has none),
//   * the flags once more as plain files under ExtendedRegions/flags/, for the runtime's Esports
//     menu (it can't read MKW-SP's LZMA archives).
// Needs xz (Git for Windows ships it).
//
//   node tools/extended-regions.js [contents.arc ...]
//
// Without arguments it patches out/nand-rankings (contents.arc and contents.arc.pre-rankings, which
// rankings-ui.js starts from). Running it again changes nothing.
const fs = require('fs'), path = require('path');
const { lzma } = require('./killfeed-messages.js');
const ROOT = path.join(__dirname, '..');
const MOD = fs.existsSync(path.join(__dirname, '..', 'extended-regions')) ? path.join(__dirname, '..', 'extended-regions') : path.join(ROOT, 'assets', 'extended-regions');
const DATA = 'title/00010001/53505350/data';
const align = (v, a) => (v + a - 1) & ~(a - 1);

// Where vanilla keeps these layouts: scene archive -> folders -> layouts there.
const PLACES = {
  Channel: { button: ['national_flag'], control: ['chara_flag_machine_picture_common', 'common_w075_ghost_data'], globe: ['common_w086_earth_mii_name', 'national_flag'], ranking: ['national_flag'] },
  Globe: { globe: ['common_w086_earth_mii_name', 'national_flag'] },
  MenuOther: { control: ['national_flag'] },
  MenuSingle: { control: ['chara_flag_machine_picture_common', 'common_w075_ghost_data'] },
  Title: { button: ['national_flag'] },
};
// MKW-SP's languages -> the mod's text files.
const TEXTS = { E: 'E', F: 'FQ', Q: 'FQ', G: 'G', I: 'I', J: 'J', K: 'K', M: 'SM', S: 'SM', U: 'U', N: 'E' };
const MSG_BASE = 0x15E0;

// ---- U8 as a tree, so files can be added: { name, dir, children | data }
function u8Read(b) {
  if (b.readUInt32BE(0) !== 0x55AA382D) throw new Error('not a U8 archive');
  const root = b.readUInt32BE(4), n = b.readUInt32BE(root + 8), strTab = root + n * 12;
  const name = o => { let e = strTab + o; while (b[e]) e++; return b.toString('latin1', strTab + o, e); };
  let i = 0;
  const node = () => {
    const e = root + i * 12, isDir = b[e] === 1, nm = name(b.readUIntBE(e + 1, 3)), a = b.readUInt32BE(e + 4), c = b.readUInt32BE(e + 8);
    i++;
    if (!isDir) return { name: nm, dir: false, data: Buffer.from(b.subarray(a, a + c)) };
    const children = [];
    while (i < c) children.push(node());
    return { name: nm, dir: true, children };
  };
  return node();
}
function u8Write(tree) {
  const flat = [];
  const walk = (nd, parent) => {
    const at = flat.length;
    flat.push({ nd, parent });
    if (nd.dir) for (const ch of nd.children) walk(ch, at);
    flat[at].end = flat.length;
  };
  walk(tree, 0);
  const names = [], offsets = [];
  let strLen = 0;
  for (const { nd } of flat) { offsets.push(strLen); const s = Buffer.from(nd.name + '\0', 'latin1'); names.push(s); strLen += s.length; }
  const headerSize = flat.length * 12 + strLen, dataOffset = align(0x20 + headerSize, 0x20);
  const head = Buffer.alloc(dataOffset);
  head.writeUInt32BE(0x55AA382D, 0); head.writeUInt32BE(0x20, 4); head.writeUInt32BE(headerSize, 8); head.writeUInt32BE(dataOffset, 12);
  Buffer.concat(names).copy(head, 0x20 + flat.length * 12);
  const parts = [head];
  let pos = dataOffset;
  flat.forEach(({ nd, parent, end }, k) => {
    const e = 0x20 + k * 12;
    head[e] = nd.dir ? 1 : 0; head.writeUIntBE(offsets[k], e + 1, 3);
    if (nd.dir) { head.writeUInt32BE(parent, e + 4); head.writeUInt32BE(end, e + 8); return; }
    head.writeUInt32BE(pos, e + 4); head.writeUInt32BE(nd.data.length, e + 8);
    parts.push(nd.data); pos += nd.data.length;
    const padded = align(pos, 0x20); parts.push(Buffer.alloc(padded - pos)); pos = padded;
  });
  return Buffer.concat(parts);
}
// The archive's top folder ("."), where its paths start.
const top = tree => tree.children.find(c => c.dir && c.name === '.') || tree;
function find(dir, rel) {
  let nd = dir;
  for (const part of rel.split('/')) { nd = nd && nd.dir ? nd.children.find(c => c.name === part) : null; if (!nd) return null; }
  return nd;
}
// Puts data at rel (folders made as needed); true when that changed anything.
function put(dir, rel, data) {
  const parts = rel.split('/');
  let nd = dir;
  for (const part of parts.slice(0, -1)) {
    let next = nd.children.find(c => c.name === part);
    if (!next) { next = { name: part, dir: true, children: [] }; nd.children.push(next); }
    nd = next;
  }
  const file = parts[parts.length - 1], old = nd.children.find(c => c.name === file);
  if (old && old.data.equals(data)) return false;
  if (old) old.data = data; else nd.children.push({ name: file, dir: false, data });
  return true;
}

// ---- The mod's texts (Wiimm's BMG text: "  15e1 = Japan", \NNN octal escapes)
function readTexts(lang) {
  const raw = fs.readFileSync(path.join(MOD, 'texts', `Menu_patch_${lang}.txt`));
  let text = raw.toString('utf8');
  if (text.includes('�')) text = raw.toString('latin1');   // the U file is Latin-1
  const out = new Map();
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*([0-9a-fA-F]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/\\([0-7]{3}|n|\\)/g, (_, e) => e === 'n' ? '\n' : e === '\\' ? '\\' : String.fromCharCode(parseInt(e, 8)));
    out.set(parseInt(m[1], 16), value);
  }
  return out;
}

// ---- BMG: set messages (new ones take the attributes of 0x15E1, the first country's name)
function bmgSet(b, texts) {
  if (b.toString('latin1', 0, 8) !== 'MESGbmg1') throw new Error('not a BMG');
  const sections = [];
  for (let o = 0x20, i = 0, n = b.readUInt32BE(12); i < n; i++) {
    const size = b.readUInt32BE(o + 4); sections.push({ magic: b.toString('latin1', o, o + 4), data: Buffer.from(b.subarray(o, o + size)) }); o += size;
  }
  const sec = m => { const s = sections.find(x => x.magic === m); if (!s) throw new Error('BMG without ' + m); return s; };
  const inf = sec('INF1'), dat = sec('DAT1'), mid = sec('MID1');
  const count = inf.data.readUInt16BE(8), esz = inf.data.readUInt16BE(10);
  const entries = [];
  for (let i = 0; i < count; i++) entries.push({ id: mid.data.readUInt32BE(16 + i * 4), inf: Buffer.from(inf.data.subarray(16 + i * esz, 16 + (i + 1) * esz)) });
  const body = Buffer.from(dat.data.subarray(8));
  const textAt = off => { let e = off; while (e + 1 < body.length && body.readUInt16BE(e)) e += 2; return body.subarray(off, e); };
  const like = entries.find(e => e.id === MSG_BASE + 1);
  if (!like) throw new Error('no message 0x15e1');
  const extra = [];
  let datLen = body.length, changed = false;
  for (const [id, value] of texts) {
    const utf16 = Buffer.alloc(value.length * 2);
    for (let k = 0; k < value.length; k++) utf16.writeUInt16BE(value.charCodeAt(k), k * 2);
    let entry = entries.find(e => e.id === id);
    if (entry && textAt(entry.inf.readUInt32BE(0)).equals(utf16)) continue;
    if (!entry) { entry = { id, inf: Buffer.from(like.inf) }; entries.push(entry); }
    entry.inf.writeUInt32BE(datLen, 0);
    extra.push(utf16, Buffer.alloc(2)); datLen += utf16.length + 2;
    changed = true;
  }
  if (!changed) return null;
  entries.sort((x, y) => x.id - y.id);
  const pad = buf => Buffer.concat([buf, Buffer.alloc(align(buf.length, 0x20) - buf.length)]);
  const withSize = buf => { buf.writeUInt32BE(buf.length, 4); return buf; };
  const infHdr = Buffer.from(inf.data.subarray(0, 16)); infHdr.writeUInt16BE(entries.length, 8);
  inf.data = withSize(pad(Buffer.concat([infHdr, ...entries.map(e => e.inf)])));
  dat.data = withSize(pad(Buffer.concat([dat.data.subarray(0, 8), body, ...extra])));
  const midHdr = Buffer.from(mid.data.subarray(0, 16)); midHdr.writeUInt16BE(entries.length, 8);
  const ids = Buffer.alloc(entries.length * 4); entries.forEach((e, i) => ids.writeUInt32BE(e.id, i * 4));
  mid.data = withSize(pad(Buffer.concat([midHdr, ids])));
  const out = Buffer.concat([Buffer.from(b.subarray(0, 0x20)), ...sections.map(s => s.data)]);
  out.writeUInt32BE(out.length, 8);
  return out;
}

function patchContents(file) {
  const flags = [];
  for (let code = 1; code <= 254; code++) flags.push([String(code).padStart(3, '0') + '.tpl', fs.readFileSync(path.join(MOD, 'tpls', String(code).padStart(3, '0') + '.tpl'))]);
  const layout = name => fs.readFileSync(path.join(MOD, 'brlyts', name + '.brlyt'));
  const texts = {};
  for (const lang of new Set(Object.values(TEXTS))) texts[lang] = readTexts(lang);

  const arc = u8Read(fs.readFileSync(file)), dir = top(arc);
  const scenes = find(dir, 'Scene/UI');
  if (!scenes) throw new Error('no Scene/UI in ' + file);
  let archives = 0, bmgs = 0;
  for (const nd of scenes.children) {
    const m = /^(\w+?)SP(?:_([A-Z]))?\.arc\.lzma$/.exec(nd.name);
    if (nd.dir || !m) continue;
    const [, scene, lang] = m;
    const inner = u8Read(lzma(nd.data, true)), idir = top(inner);
    let changed = false;
    if (!lang && PLACES[scene]) {
      for (const [folder, layouts] of Object.entries(PLACES[scene])) {
        for (const l of layouts) changed = put(idir, `${folder}/blyt/${l}.brlyt`, layout(l)) || changed;
        for (const [name, data] of flags) changed = put(idir, `${folder}/timg/${name}`, data) || changed;
      }
    }
    const bmg = lang && find(idir, 'message/Menu.bmg');
    if (bmg && TEXTS[lang]) {
      const set = bmgSet(bmg.data, texts[TEXTS[lang]]);
      if (set) { bmg.data = set; changed = true; bmgs++; }
    }
    if (changed) { nd.data = lzma(u8Write(inner), false); archives++; }
  }
  for (const [name, data] of flags) put(dir, `ExtendedRegions/flags/${name}`, data);
  const out = u8Write(arc);
  if (fs.readFileSync(file).equals(out)) { console.log(`${path.relative(ROOT, file)}: Extended Regions up to date`); return; }
  fs.writeFileSync(file, out);
  console.log(`${path.relative(ROOT, file)}: Extended Regions in ${archives} archives (${bmgs} Menu.bmg)`);
}

module.exports = { patchContents };
if (require.main === module) {
  const data = path.join(ROOT, 'out/nand-rankings', DATA);
  const targets = process.argv.length > 2 ? process.argv.slice(2) : ['contents.arc', 'contents.arc.pre-rankings'].map(f => path.join(data, f)).filter(f => fs.existsSync(f));
  for (const t of targets) patchContents(path.resolve(t));
}
