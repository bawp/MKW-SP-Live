// Add the Settings > Race > Kill Feed texts (title + Disable/Enable explanations, see killfeed.js)
// to MKW-SP's message files: every message/Menu.bmg inside the *.arc.lzma archives of contents.arc.
// English text is used for every language. Needs xz (Git for Windows ships it).
//
//   node tools/killfeed-messages.js [contents.arc ...]
//
// Without arguments it patches build/nand and out/nand. The first run keeps the original next to
// each file as contents.arc.orig and every run starts from that, so re-running is safe.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const KF = require('./killfeed.js');
const ROOT = path.join(__dirname, '..');
const DEFAULT_TARGETS = ['build/nand', 'out/nand'].map(d => path.join(ROOT, d, 'title/00010001/53505350/data/contents.arc'));
const align = (v, a) => (v + a - 1) & ~(a - 1);

// ---- U8: keep the node table and string table as they are, re-lay the file data.
function u8Parse(b) {
  if (b.readUInt32BE(0) !== 0x55AA382D) throw new Error('not a U8 archive');
  const root = b.readUInt32BE(4), headerSize = b.readUInt32BE(8), dataOffset = b.readUInt32BE(12);
  const n = b.readUInt32BE(root + 8), strTab = root + n * 12;
  const name = o => { let e = strTab + o; while (b[e]) e++; return b.toString('latin1', strTab + o, e); };
  const nodes = [], stack = [[n, '']];
  for (let i = 0; i < n; i++) {
    while (i > 0 && i >= stack[stack.length - 1][0]) stack.pop();
    const e = root + i * 12, type = b[e], a = b.readUInt32BE(e + 4), c = b.readUInt32BE(e + 8);
    const p = i === 0 ? '' : stack[stack.length - 1][1] + '/' + name(b.readUIntBE(e + 1, 3));
    nodes.push({ type, path: p, data: type === 0 ? Buffer.from(b.subarray(a, a + c)) : null });
    if (type === 1 && i > 0) stack.push([c, p]);
  }
  return { header: Buffer.from(b.subarray(0, dataOffset)), root, headerSize, dataOffset, nodes };
}
function u8Build(arc) {
  const parts = [arc.header];
  let pos = arc.dataOffset;
  arc.nodes.forEach((node, i) => {
    if (node.type !== 0) return;
    const e = arc.root + i * 12;
    arc.header.writeUInt32BE(pos, e + 4); arc.header.writeUInt32BE(node.data.length, e + 8);
    parts.push(node.data); pos += node.data.length;
    const padded = align(pos, 0x20); parts.push(Buffer.alloc(padded - pos)); pos = padded;
  });
  return Buffer.concat(parts);
}

// ---- BMG (MKW: INF1 entries of 8 bytes, DAT1 UTF-16BE, MID1 sorted u32 IDs)
function bmgAddMessages(b, add) {
  if (b.toString('latin1', 0, 8) !== 'MESGbmg1') throw new Error('not a BMG');
  const sections = [];
  for (let o = 0x20, i = 0, n = b.readUInt32BE(12); i < n; i++) {
    const size = b.readUInt32BE(o + 4); sections.push({ magic: b.toString('latin1', o, o + 4), data: Buffer.from(b.subarray(o, o + size)) }); o += size;
  }
  const sec = m => { const s = sections.find(x => x.magic === m); if (!s) throw new Error('BMG without ' + m); return s; };
  const inf = sec('INF1'), dat = sec('DAT1'), mid = sec('MID1');
  const count = inf.data.readUInt16BE(8), esz = inf.data.readUInt16BE(10);
  if (mid.data.readUInt16BE(8) !== count) throw new Error('INF1/MID1 count mismatch');
  const entries = [];
  for (let i = 0; i < count; i++) entries.push({ id: mid.data.readUInt32BE(16 + i * 4), inf: Buffer.from(inf.data.subarray(16 + i * esz, 16 + (i + 1) * esz)) });
  // Existing texts stay byte-for-byte (escape sequences can contain zero halfwords); append after them.
  let datBody = Buffer.from(dat.data.subarray(8));
  let added = 0;
  for (const m of add) {
    if (entries.some(e => e.id === m.id)) continue;
    const like = entries.find(e => e.id === m.attrsFrom);
    if (!like) throw new Error('no message 0x' + m.attrsFrom.toString(16) + ' to copy attributes from');
    const text = Buffer.alloc(m.text.length * 2 + 2);
    for (let k = 0; k < m.text.length; k++) text.writeUInt16BE(m.text.charCodeAt(k), k * 2);
    const infEntry = Buffer.from(like.inf); infEntry.writeUInt32BE(datBody.length, 0);
    datBody = Buffer.concat([datBody, text]);
    entries.push({ id: m.id, inf: infEntry }); added++;
  }
  if (!added) return null;
  entries.sort((x, y) => x.id - y.id);
  const pad = buf => Buffer.concat([buf, Buffer.alloc(align(buf.length, 0x20) - buf.length)]);
  const withSize = buf => { buf.writeUInt32BE(buf.length, 4); return buf; };
  const infHdr = Buffer.from(inf.data.subarray(0, 16)); infHdr.writeUInt16BE(entries.length, 8);
  inf.data = withSize(pad(Buffer.concat([infHdr, ...entries.map(e => e.inf)])));
  dat.data = withSize(pad(Buffer.concat([dat.data.subarray(0, 8), datBody])));
  const midHdr = Buffer.from(mid.data.subarray(0, 16)); midHdr.writeUInt16BE(entries.length, 8);
  const ids = Buffer.alloc(entries.length * 4); entries.forEach((e, i) => ids.writeUInt32BE(e.id, i * 4));
  mid.data = withSize(pad(Buffer.concat([midHdr, ids])));
  const header = Buffer.from(b.subarray(0, 0x20));
  const out = Buffer.concat([header, ...sections.map(s => s.data)]);
  out.writeUInt32BE(out.length, 8);
  return out;
}

const MESSAGES = [
  { id: KF.MSG_TITLE, text: KF.TEXT.title, attrsFrom: 0x27B6 },          // like "Vanilla Mode"
  { id: KF.MSG_EXPL_DISABLE, text: KF.TEXT.disable, attrsFrom: 0x27B9 },  // like its explanations
  { id: KF.MSG_EXPL_ENABLE, text: KF.TEXT.enable, attrsFrom: 0x27BA },
];
const lzma = (buf, decompress) => execFileSync('xz', ['--format=lzma', decompress ? '-dc' : '-6c'], { input: buf, maxBuffer: 1 << 28 });

function patchContents(file) {
  const orig = file + '.orig';
  if (!fs.existsSync(orig)) fs.copyFileSync(file, orig);
  const arc = u8Parse(fs.readFileSync(orig));
  let archives = 0, bmgs = 0;
  for (const node of arc.nodes) {
    if (node.type !== 0 || !node.path.endsWith('.arc.lzma')) continue;
    const inner = u8Parse(lzma(node.data, true));
    let changed = false;
    for (const f of inner.nodes) {
      if (f.type !== 0 || !/\/message\/Menu\.bmg$/.test(f.path)) continue;
      const patched = bmgAddMessages(f.data, MESSAGES);
      if (patched) { f.data = patched; changed = true; bmgs++; }
    }
    if (changed) { node.data = lzma(u8Build(inner), false); archives++; }
  }
  fs.writeFileSync(file, u8Build(arc));
  console.log(`${path.relative(ROOT, file)}: ${bmgs} Menu.bmg in ${archives} archives updated (original kept as ${path.basename(orig)})`);
}

module.exports = { u8Parse, u8Build, lzma, bmgAddMessages };
if (require.main === module) {
  const targets = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TARGETS;
  for (const t of targets) patchContents(path.resolve(t));
}
