// Rankings fork UI data:
//   * the menu after a time trial gets vanilla's Rankings button back (see AFTER_TA_MENU in
//     rankings.js), so MKW-SP's 6-button layout (button/ctrl/AfterMenuTimeAttack.brctr in
//     Scene/UI/RaceSP.arc) becomes a 7-button one: Rankings is added before Quit and the buttons are
//     spread over vanilla's span (y +175 .. -175, as vanilla's 6-button menu),
//   * the MKW-SP Channel's button layout (button/ctrl/ServicePackChannelButton.brctr in
//     Scene/UI/ChannelSP.arc) gets an Esports variant below Rankings (ESPORTS in rankings.js), the
//     two centred on the globe,
//   * with the game's Channel.szs at hand, the MKW-SP Channel's two buttons become vanilla's Mario
//     Kart Channel menu buttons, icons included: its button/ctrl/ChannelMenu.brctr (layout
//     common_w095_mariokart_channel_top_menu, icons from mariokart_channel_top_menu_image_common,
//     both in Channel.szs, which the section loads) with its Ranking variant as Rankings (the "10"
//     medal) and its TrialEvent variant (Tournament: the checkered flag) as Esports. It is made from
//     the disc each time, so the shared kit's contents.arc (made with --no-vanilla) has none of it,
//   * the Settings > Rankings texts (RANKINGS_SETTINGS in rankings.js) and the Esports button's text
//     are added to every message/Menu.bmg (English for every language, as the kill feed's),
//   * the MKW-SP Channel is called the Mario Kart Channel: its name (0x28BC) points at the game's own
//     "Mario Kart Channel" (0x1388) in each Menu.bmg, so it is in that file's language.
//
//   node tools/rankings-ui.js [--no-vanilla] [contents.arc ...]
//
// Without arguments it patches out/nand-rankings. The first run keeps the file it found as
// contents.arc.pre-rankings and every run starts from that, so re-running is safe.
const fs = require('fs'), path = require('path');
const { u8Parse, u8Build, lzma, bmgAddMessages } = require('./killfeed-messages.js');
const { RANKINGS_SETTINGS: S, ESPORTS, NOTIFY } = require('./rankings.js');
const MESSAGES = [
  { id: S.msg.category, text: S.text.category, attrsFrom: 0x2786 },   // like the "Race" category
  { id: S.msg.title, text: S.text.title, attrsFrom: 0x27B6 },         // like "Vanilla Mode"
  ...S.values.map((v, k) => ({ id: S.msg.values[k], text: v, attrsFrom: 0x27B7 })),   // like its values
  ...S.text.explanations.map((t, k) => ({ id: S.msg.explanations[k], text: t, attrsFrom: 0x27B9 })),
  { id: ESPORTS.message, text: ESPORTS.text, attrsFrom: 0x28BD },   // like the Rankings button's text
  // The notification bar's text: {arg string|0} (escape 0x1A, tag 0x08020020, string 0), as MKW-SP's own.
  { id: NOTIFY.message, text: '\u001A\u0802\u0020\u0000', attrsFrom: 0x28BD },
  ...S.extra.flatMap(x => [
    { id: x.msg.title, text: x.text.title, attrsFrom: 0x27B6 },
    ...x.values.map((v, k) => ({ id: x.msg.values[k], text: v, attrsFrom: 0x27B7 })),
    ...x.text.explanations.map((t, k) => ({ id: x.msg.explanations[k], text: t, attrsFrom: 0x27B9 })),
  ]),
];
const ROOT = path.join(__dirname, '..');
const DEFAULT_TARGETS = [path.join(ROOT, 'out/nand-rankings/title/00010001/53505350/data/contents.arc')];

const ARCHIVE = 'Scene/UI/RaceSP.arc.lzma', LAYOUT = 'button/ctrl/AfterMenuTimeAttack.brctr';
const RANKING = { name: 'ButtonRanking', message: 0x3F7, before: 'ButtonQuit' };   // vanilla's Rankings button text
const SPAN = 175, RECORD = 0x3C, RECORDS = 0xB4, BLOCK = 0xA8;

// BRCTR: header (string table offset at 0x10), at 0xA8 { u16 ?, u16 count, u16 records end, u16 count,
// u16 strings, u16 0 }, `count` 0x3C-byte button records { u16 name, ..., f32 delay @8, f32 y @0x10 and
// @0x24 (4:3 / 16:9), u16 index @0x34 }, then { u32 0, u32 message } per button, then the strings.
function addRankingButton(b) {
  if (b.toString('latin1', 0, 4) !== 'bctr') throw new Error('not a BRCTR');
  const strings = b.readUInt16BE(0x10), count = b.readUInt16BE(BLOCK + 2), msgs = BLOCK + b.readUInt16BE(BLOCK + 4);
  if (msgs !== RECORDS + count * RECORD || BLOCK + b.readUInt16BE(BLOCK + 8) !== strings || msgs + count * 8 !== strings) throw new Error('unexpected BRCTR layout');
  const name = off => { let e = strings + off; while (b[e]) e++; return b.toString('latin1', strings + off, e); };
  const recs = [], ids = [];
  for (let k = 0; k < count; k++) { recs.push(Buffer.from(b.subarray(RECORDS + k * RECORD, RECORDS + (k + 1) * RECORD))); ids.push(b.readUInt32BE(msgs + 8 * k + 4)); }
  const names = recs.map(r => name(r.readUInt16BE(0)));
  if (names.includes(RANKING.name)) return null;
  const at = names.indexOf(RANKING.before);
  if (at < 0) throw new Error('no ' + RANKING.before);
  const rec = Buffer.from(recs[at]);
  rec.writeUInt16BE(b.length - strings, 0);   // the new name goes at the end of the string table
  recs.splice(at, 0, rec); ids.splice(at, 0, RANKING.message);
  const n = recs.length;
  recs.forEach((r, k) => {
    const y = SPAN - (2 * SPAN * k) / (n - 1);
    r.writeFloatBE(k, 8); r.writeFloatBE(y, 0x10); r.writeFloatBE(y, 0x24); r.writeUInt16BE(k, 0x34);
  });
  const newMsgs = RECORDS + n * RECORD, newStrings = newMsgs + n * 8;
  const header = Buffer.from(b.subarray(0, RECORDS));
  header.writeUInt16BE(newStrings, 0x10);
  header.writeUInt16BE(n, BLOCK + 2); header.writeUInt16BE(newMsgs - BLOCK, BLOCK + 4);
  header.writeUInt16BE(n, BLOCK + 6); header.writeUInt16BE(newStrings - BLOCK, BLOCK + 8);
  const table = Buffer.alloc(n * 8); ids.forEach((id, k) => table.writeUInt32BE(id, 8 * k + 4));
  return Buffer.concat([header, ...recs, table, b.subarray(strings), Buffer.from(RANKING.name + '\0', 'latin1')]);
}

// Adds a variant to a BRCTR (layout as above): a copy of `copyFrom` named `name` with its own
// message, placed after it, then sets each listed variant's y (4:3 and 16:9).
const CHANNEL = { archive: 'Scene/UI/ChannelSP.arc.lzma', layout: 'button/ctrl/ServicePackChannelButton.brctr' };
// Vanilla's channel menu buttons: which of ChannelMenu.brctr's variants become MKW-SP's, with MKW-SP's
// texts (Rankings 0x28BD, Esports) and the two centred on the globe as before.
const CHANNEL_MENU = {
  path: 'button/ctrl/ChannelMenu.brctr',
  buttons: [
    { from: 'Ranking', name: 'Rankings', message: 0x28BD, y: 35, delay: 1 },
    { from: 'TrialEvent', name: 'Esports', message: ESPORTS.message, y: -35, delay: 2 },
  ],
};
function addVariant(b, { name, message, copyFrom, y }) {
  if (b.toString('latin1', 0, 4) !== 'bctr') throw new Error('not a BRCTR');
  const strings = b.readUInt16BE(0x10), count = b.readUInt16BE(BLOCK + 2), msgs = BLOCK + b.readUInt16BE(BLOCK + 4);
  if (msgs !== RECORDS + count * RECORD || BLOCK + b.readUInt16BE(BLOCK + 8) !== strings || msgs + count * 8 !== strings) throw new Error('unexpected BRCTR layout');
  const nameAt = off => { let e = strings + off; while (b[e]) e++; return b.toString('latin1', strings + off, e); };
  const recs = [], ids = [];
  for (let k = 0; k < count; k++) { recs.push(Buffer.from(b.subarray(RECORDS + k * RECORD, RECORDS + (k + 1) * RECORD))); ids.push(b.readUInt32BE(msgs + 8 * k + 4)); }
  const names = recs.map(r => nameAt(r.readUInt16BE(0)));
  if (names.includes(name)) return null;
  const from = names.indexOf(copyFrom);
  if (from < 0) throw new Error('no ' + copyFrom);
  const rec = Buffer.from(recs[from]);
  rec.writeUInt16BE(b.length - strings, 0);
  recs.splice(from + 1, 0, rec); ids.splice(from + 1, 0, message); names.splice(from + 1, 0, name);
  recs.forEach((r, k) => {
    r.writeUInt16BE(k, 0x34);
    if (y[names[k]] !== undefined) { r.writeFloatBE(y[names[k]], 0x10); r.writeFloatBE(y[names[k]], 0x24); }
  });
  const n = recs.length, newMsgs = RECORDS + n * RECORD, newStrings = newMsgs + n * 8;
  const header = Buffer.from(b.subarray(0, RECORDS));
  header.writeUInt16BE(newStrings, 0x10);
  header.writeUInt16BE(n, BLOCK + 2); header.writeUInt16BE(newMsgs - BLOCK, BLOCK + 4);
  header.writeUInt16BE(n, BLOCK + 6); header.writeUInt16BE(newStrings - BLOCK, BLOCK + 8);
  const table = Buffer.alloc(n * 8); ids.forEach((id, k) => table.writeUInt32BE(id, 8 * k + 4));
  return Buffer.concat([header, ...recs, table, b.subarray(strings), Buffer.from(name + '\0', 'latin1')]);
}

// The game's Channel.szs (Yaz0 U8), from the WiiCompiled install the converter uses.
function vanillaChannel() {
  const install = process.env.MKWSP_WIICOMPILED_INSTALL || path.join(process.env.APPDATA || '', 'CT-MKWII/Recomp/Install');
  const file = path.join(install, 'GameAssets/DATA/files/Scene/UI/Channel.szs');
  if (!fs.existsSync(file)) return null;
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'Yaz0') return u8Parse(b);
  const size = b.readUInt32BE(4), o = Buffer.alloc(size);
  let s = 16, d = 0;
  while (d < size) {
    const code = b[s++];
    for (let i = 0; i < 8 && d < size; i++) {
      if (code & (0x80 >> i)) { o[d++] = b[s++]; continue; }
      const b1 = b[s++], b2 = b[s++], dist = ((b1 & 15) << 8 | b2) + 1;
      let n = b1 >> 4;
      n = n ? n + 2 : b[s++] + 0x12;
      for (let k = 0; k < n; k++, d++) o[d] = o[d - dist];
    }
  }
  return u8Parse(o);
}

// ChannelMenu.brctr (layout as above, plus a pane-picture table after the messages: { u16 pane,
// u16 material } per entry, records ending in { u16 message first, count, picture first, count })
// reduced to CHANNEL_MENU's buttons. Its string table is kept as it is; the new names are appended.
function channelMenuButtons(b) {
  if (b.toString('latin1', 0, 4) !== 'bctr') throw new Error('not a BRCTR');
  const strings = b.readUInt16BE(0x10), count = b.readUInt16BE(BLOCK + 2);
  const msgs = BLOCK + b.readUInt16BE(BLOCK + 4), pics = BLOCK + b.readUInt16BE(BLOCK + 8), picCount = b.readUInt16BE(BLOCK + 10);
  if (msgs !== RECORDS + count * RECORD || pics !== msgs + count * 8 || pics + picCount * 4 !== strings) throw new Error('unexpected ChannelMenu.brctr layout');
  const nameAt = off => { let e = strings + off; while (b[e]) e++; return b.toString('latin1', strings + off, e); };
  const recs = [], ids = [], pictures = [];
  let extra = b.length - strings;
  const appended = [];
  for (const btn of CHANNEL_MENU.buttons) {
    let k = 0;
    while (k < count && nameAt(b.readUInt16BE(RECORDS + k * RECORD)) !== btn.from) k++;
    if (k === count) throw new Error('ChannelMenu.brctr has no ' + btn.from);
    const rec = Buffer.from(b.subarray(RECORDS + k * RECORD, RECORDS + (k + 1) * RECORD));
    const picFirst = rec.readUInt16BE(0x38), picN = rec.readUInt16BE(0x3A);
    rec.writeUInt16BE(extra, 0);
    appended.push(Buffer.from(btn.name + ' ', 'latin1'));
    extra += btn.name.length + 1;
    rec.writeFloatBE(btn.delay, 8);
    rec.writeFloatBE(btn.y, 0x10); rec.writeFloatBE(btn.y, 0x24);
    rec.writeUInt16BE(recs.length, 0x34); rec.writeUInt16BE(1, 0x36);
    rec.writeUInt16BE(pictures.length, 0x38); rec.writeUInt16BE(picN, 0x3A);
    for (let q = 0; q < picN; q++) pictures.push(b.subarray(pics + (picFirst + q) * 4, pics + (picFirst + q + 1) * 4));
    recs.push(rec); ids.push(btn.message);
  }
  const n = recs.length, newMsgs = RECORDS + n * RECORD, newPics = newMsgs + n * 8, newStrings = newPics + pictures.length * 4;
  const header = Buffer.from(b.subarray(0, RECORDS));
  header.writeUInt16BE(newStrings, 0x10);
  header.writeUInt16BE(n, BLOCK + 2); header.writeUInt16BE(newMsgs - BLOCK, BLOCK + 4);
  header.writeUInt16BE(n, BLOCK + 6); header.writeUInt16BE(newPics - BLOCK, BLOCK + 8);
  header.writeUInt16BE(pictures.length, BLOCK + 10);
  const table = Buffer.alloc(n * 8); ids.forEach((id, k) => table.writeUInt32BE(id, 8 * k + 4));
  return Buffer.concat([header, ...recs, table, ...pictures, b.subarray(strings), ...appended]);
}

const CHANNEL_NAME = { id: 0x28BC, sameAs: 0x1388 };
// Points message `id`'s INF1 entry at message `sameAs`'s text (both stay); null when unchanged.
function bmgAlias(b, id, sameAs) {
  if (b.toString('latin1', 0, 8) !== 'MESGbmg1') throw new Error('not a BMG');
  const at = {};
  for (let o = 0x20, i = 0, n = b.readUInt32BE(12); i < n; i++) { at[b.toString('latin1', o, o + 4)] = o; o += b.readUInt32BE(o + 4); }
  if (at.INF1 === undefined || at.MID1 === undefined) return null;
  const count = b.readUInt16BE(at.INF1 + 8), esz = b.readUInt16BE(at.INF1 + 10);
  let target = -1, source = -1;
  for (let i = 0; i < count; i++) {
    const m = b.readUInt32BE(at.MID1 + 16 + i * 4);
    if (m === id) target = i;
    if (m === sameAs) source = i;
  }
  if (target < 0 || source < 0) return null;
  const textOf = i => b.readUInt32BE(at.INF1 + 16 + i * esz);
  if (textOf(target) === textOf(source)) return null;
  const out = Buffer.from(b);
  out.writeUInt32BE(textOf(source), at.INF1 + 16 + target * esz);
  return out;
}

// Settings > Rankings > Sub-Region: the Continental rankings' texts as "Regional" ones, under the IDs
// the runtime answers for them while a sub-region is picked (kRegionalTexts in mkwlb_rankings.cpp).
// Each is the file's own text with Continental / continental replaced (unchanged where the language
// doesn't use the word), with the original's attributes.
const REGIONAL_TEXTS = [[6002, 0x2F48], [6006, 0x2F49], [6020, 0x2F4A], [6054, 0x2F4B], [6058, 0x2F4C], [6252, 0x2F4D], [6256, 0x2F4E], [6260, 0x2F4F]];
// A message's text as UTF-16 code units in a string (escape sequences kept whole), or null.
function bmgText(b, id) {
  const at = {};
  for (let o = 0x20, i = 0, n = b.readUInt32BE(12); i < n; i++) { at[b.toString('latin1', o, o + 4)] = o; o += b.readUInt32BE(o + 4); }
  const count = b.readUInt16BE(at.INF1 + 8), esz = b.readUInt16BE(at.INF1 + 10);
  for (let i = 0; i < count; i++) {
    if (b.readUInt32BE(at.MID1 + 16 + i * 4) !== id) continue;
    let p = at.DAT1 + 8 + b.readUInt32BE(at.INF1 + 16 + i * esz), s = '';
    for (;;) {
      const c = b.readUInt16BE(p);
      if (c === 0) return s;
      if (c === 0x1A) {   // escape: its size in bytes follows, the whole sequence is copied
        const size = b[p + 2];
        for (let k = 0; k < size; k += 2) s += String.fromCharCode(b.readUInt16BE(p + k));
        p += size;
      } else { s += String.fromCharCode(c); p += 2; }
    }
  }
  return null;
}
function regionalMessages(b) {
  return REGIONAL_TEXTS.flatMap(([from, to]) => {
    const text = bmgText(b, from);
    return text === null ? [] : [{ id: to, text: text.replace(/Continental/g, 'Regional').replace(/continental/g, 'regional'), attrsFrom: from }];
  });
}

function patchContents(file, useVanilla) {
  const orig = file + '.pre-rankings';
  if (!fs.existsSync(orig)) fs.copyFileSync(file, orig);
  const arc = u8Parse(fs.readFileSync(orig));
  const node = arc.nodes.find(x => x.type === 0 && x.path.endsWith('/' + ARCHIVE));
  if (!node) throw new Error('no ' + ARCHIVE);
  const inner = u8Parse(lzma(node.data, true));
  const layout = inner.nodes.find(x => x.type === 0 && x.path.endsWith('/' + LAYOUT));
  if (!layout) throw new Error('no ' + LAYOUT);
  const patched = addRankingButton(layout.data);
  if (patched) { layout.data = patched; node.data = lzma(u8Build(inner), false); }
  const channel = arc.nodes.find(x => x.type === 0 && x.path.endsWith('/' + CHANNEL.archive));
  if (!channel) throw new Error('no ' + CHANNEL.archive);
  const channelFiles = u8Parse(lzma(channel.data, true));
  const channelLayout = channelFiles.nodes.find(x => x.type === 0 && x.path.endsWith('/' + CHANNEL.layout));
  if (!channelLayout) throw new Error('no ' + CHANNEL.layout);
  const vanilla = useVanilla ? vanillaChannel() : null;
  const menu = vanilla && vanilla.nodes.find(x => x.type === 0 && x.path.endsWith('/' + CHANNEL_MENU.path));
  const buttons = menu ? channelMenuButtons(menu.data)
    : addVariant(channelLayout.data, { name: 'Esports', message: ESPORTS.message, copyFrom: 'Rankings', y: { Rankings: 35, Esports: -35 } });
  if (buttons && !buttons.equals(channelLayout.data)) { channelLayout.data = buttons; channel.data = lzma(u8Build(channelFiles), false); }
  console.log(menu ? 'MKW-SP Channel buttons: vanilla Mario Kart Channel menu buttons (Rankings, Esports)' : 'MKW-SP Channel buttons: MKW-SP\'s (Rankings, Esports)');
  let bmgs = 0;
  for (const archive of arc.nodes) {
    if (archive.type !== 0 || !archive.path.endsWith('.arc.lzma')) continue;
    const files = u8Parse(lzma(archive.data, true));
    let changed = false;
    for (const f of files.nodes) {
      if (f.type !== 0 || !/\/message\/Menu\.bmg$/.test(f.path)) continue;
      const withTexts = bmgAddMessages(f.data, [...MESSAGES, ...regionalMessages(f.data)]);
      if (withTexts) { f.data = withTexts; changed = true; bmgs++; }
      const renamed = bmgAlias(f.data, CHANNEL_NAME.id, CHANNEL_NAME.sameAs);
      if (renamed) { f.data = renamed; changed = true; }
    }
    if (changed) archive.data = lzma(u8Build(files), false);
  }
  const out = u8Build(arc);
  if (fs.readFileSync(file).equals(out)) { console.log(`${path.relative(ROOT, file)}: ${LAYOUT} up to date`); return; }
  fs.writeFileSync(file, out);
  console.log(`${path.relative(ROOT, file)}: ${LAYOUT} ${patched ? 'has 7 buttons' : 'already had Rankings'}, Rankings settings texts in ${bmgs} Menu.bmg (original kept as ${path.basename(orig)})`);
}

module.exports = { addRankingButton, addVariant, channelMenuButtons };
if (require.main === module) {
  const args = process.argv.slice(2), useVanilla = !args.includes('--no-vanilla');
  const files = args.filter(a => a !== '--no-vanilla');
  for (const t of files.length ? files : DEFAULT_TARGETS) patchContents(path.resolve(t), useVanilla);
}
