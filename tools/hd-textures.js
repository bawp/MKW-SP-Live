// The fork's HD textures, made from your own game files into a WiiCompiled texture pack folder
// (UserData\texture_replacements), named the way aurora looks replacements up (tex1_<w>x<h>_<xxh64>_<fmt>):
//   * Globe/   the globe's CMPR tiles as BC1 DDS (tools/globe-bc1/gen.js): no first-use decode hitch
//   * UI/Menu/Main/   the Competitions bars, 8x (tools/obi-hd/gen.js), for the Esports menu
//   * UI/Menu/Main/   the channel buttons' Rankings / Esports icons, 8x, with Real-ESRGAN
//     (realesrgan-ncnn-vulkan, model realesrgan-x4plus-anime; the recipe of tools/channel-icons-hd/):
//     colour and alpha mask upscaled 4x separately, the Esports icon's colour given the original's
//     detail back (the difference to the original, upsampled), then 4x once more and halved. Skipped
//     when no Real-ESRGAN folder is given.
// usage: node hd-textures.js <game files dir (…/DATA/files)> <pack dir> [<realesrgan dir>]
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const { execFileSync } = require('child_process');
const [, , filesDir, packDir, esrganDir] = process.argv;
if (!filesDir || !packDir) { console.error('usage: node hd-textures.js <game files dir> <pack dir> [<realesrgan dir>]'); process.exit(1); }
const here = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkwsp-hd-'));

// ---- XXH64, Yaz0, U8, TPL (as tools/texhash.js) ----
const M = (1n << 64n) - 1n, P1 = 11400714785074694791n, P2 = 14029467366897019727n, P3 = 1609587929392839161n, P4 = 9650029242287828579n, P5 = 2870177450012600261n;
const rotl = (x, r) => ((x << BigInt(r)) | (x >> BigInt(64 - r))) & M;
const round = (a, i) => rotl((a + i * P2) & M, 31) * P1 & M;
const merge = (a, v) => (((a ^ round(0n, v)) * P1) & M) + P4 & M;
function xxh64(b) {
  const n = b.length; let p = 0, h;
  if (n >= 32) {
    let v1 = (P1 + P2) & M, v2 = P2, v3 = 0n, v4 = (-P1) & M;
    while (p + 32 <= n) { v1 = round(v1, b.readBigUInt64LE(p)); v2 = round(v2, b.readBigUInt64LE(p + 8)); v3 = round(v3, b.readBigUInt64LE(p + 16)); v4 = round(v4, b.readBigUInt64LE(p + 24)); p += 32; }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) & M; h = merge(h, v1); h = merge(h, v2); h = merge(h, v3); h = merge(h, v4);
  } else h = P5;
  h = (h + BigInt(n)) & M;
  while (p + 8 <= n) { h ^= round(0n, b.readBigUInt64LE(p)); h = (rotl(h, 27) * P1 + P4) & M; p += 8; }
  if (p + 4 <= n) { h ^= (BigInt(b.readUInt32LE(p)) * P1) & M; h = (rotl(h, 23) * P2 + P3) & M; p += 4; }
  while (p < n) { h ^= (BigInt(b[p]) * P5) & M; h = rotl(h, 11) * P1 & M; p++; }
  h ^= h >> 33n; h = h * P2 & M; h ^= h >> 29n; h = h * P3 & M; h ^= h >> 32n; return h;
}
function yaz0(b) {
  if (b.toString('latin1', 0, 4) !== 'Yaz0') return b;
  const size = b.readUInt32BE(4), o = Buffer.alloc(size); let s = 16, d = 0;
  while (d < size) {
    const code = b[s++];
    for (let i = 0; i < 8 && d < size; i++) {
      if (code & (0x80 >> i)) { o[d++] = b[s++]; continue; }
      const b1 = b[s++], b2 = b[s++], dist = ((b1 & 15) << 8 | b2) + 1;
      let len = b1 >> 4; len = len ? len + 2 : b[s++] + 0x12;
      for (let k = 0; k < len; k++, d++) o[d] = o[d - dist];
    }
  }
  return o;
}
function u8Files(b) {   // path -> data
  const out = new Map();
  if (b.readUInt32BE(0) !== 0x55AA382D) return out;
  const root = b.readUInt32BE(4), n = b.readUInt32BE(root + 8), st = root + n * 12;
  const name = o => { let e = st + o; while (b[e]) e++; return b.toString('latin1', st + o, e); };
  const stack = [[n, '']];
  for (let i = 1; i < n; i++) {
    while (i >= stack[stack.length - 1][0]) stack.pop();
    const e = root + i * 12, p = stack[stack.length - 1][1] + '/' + name(b.readUIntBE(e + 1, 3));
    if (b[e] === 1) stack.push([b.readUInt32BE(e + 8), p]);
    else out.set(p, b.subarray(b.readUInt32BE(e + 4), b.readUInt32BE(e + 4) + b.readUInt32BE(e + 8)));
  }
  return out;
}
// The replacement name of a TPL's first image (RGB5A3 / CMPR / ... without a palette).
const BPP = { 0: 4, 1: 8, 2: 8, 3: 16, 4: 16, 5: 16, 6: 32, 14: 4 }, BW = { 0: 8, 1: 8, 2: 8, 3: 4, 4: 4, 5: 4, 6: 4, 14: 8 }, BH = { 0: 8, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 14: 8 };
function tplName(b) {
  const ih = b.readUInt32BE(b.readUInt32BE(8));
  const h = b.readUInt16BE(ih), w = b.readUInt16BE(ih + 2), f = b.readUInt32BE(ih + 4), off = b.readUInt32BE(ih + 8);
  const size = Math.ceil(w / BW[f]) * BW[f] * Math.ceil(h / BH[f]) * BH[f] * BPP[f] / 8;
  return `tex1_${w}x${h}_${xxh64(b.subarray(off, off + size)).toString(16).padStart(16, '0')}_${f}`;
}

// ---- PNG ----
const { tplRGB5A3, writePNG } = require(path.join(here, 'obi-hd', 'img.js'));
function readPNG(f) {
  const b = fs.readFileSync(f); let p = 8, w, h, ct; const id = [];
  while (p < b.length) {
    const l = b.readUInt32BE(p), t = b.toString('latin1', p + 4, p + 8);
    if (t === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); ct = b[p + 17]; }
    if (t === 'IDAT') id.push(b.subarray(p + 8, p + 8 + l));
    p += 12 + l;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(id)), stride = w * bpp, out = new Uint8ClampedArray(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b2 = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b2; else if (f === 3) v += (a + b2) >> 1;
      else if (f === 4) { const pp = a + b2 - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b2), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { for (let c = 0; c < 3; c++) out[(y * w + x) * 4 + c] = line[x * bpp + c]; out[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255; }
    prev = line;
  }
  return { w, h, px: out };
}

const channel = u8Files(yaz0(fs.readFileSync(path.join(filesDir, 'Scene', 'UI', 'Channel.szs'))));
const tplOf = p => { const k = [...channel.keys()].find(n => n.endsWith(p)); if (!k) throw new Error('Channel.szs has no ' + p); return channel.get(k); };
const menuDir = path.join(packDir, 'UI', 'Menu', 'Main');
fs.mkdirSync(menuDir, { recursive: true });

// ---- globe ----
execFileSync(process.execPath, [path.join(here, 'globe-bc1', 'gen.js'), filesDir, path.join(packDir, 'Globe')], { stdio: 'inherit' });

// ---- Competitions bars ----
{
  const timg = path.join(tmp, 'timg'), bars = path.join(tmp, 'bars');
  fs.mkdirSync(timg, { recursive: true });
  const names = [...channel.keys()].filter(p => /\/bg\/timg\/tk_obi_.*_gp\.tpl$/.test(p));
  for (const p of names) fs.writeFileSync(path.join(timg, path.basename(p)), channel.get(p));
  execFileSync(process.execPath, [path.join(here, 'obi-hd', 'gen.js'), timg, bars], { cwd: timg, stdio: 'ignore' });
  for (const p of names) fs.copyFileSync(path.join(bars, path.basename(p).replace('.tpl', '.png')), path.join(menuDir, tplName(channel.get(p)) + '.png'));
  console.log(`${names.length} HD bar textures -> ${menuDir}`);
}

// ---- channel icons (Real-ESRGAN) ----
const exe = esrganDir && path.join(esrganDir, 'realesrgan-ncnn-vulkan.exe');
if (!exe || !fs.existsSync(exe)) {
  console.log('channel icons: no Real-ESRGAN, skipped');
} else {
  const ai = path.join(tmp, 'ai');
  fs.mkdirSync(ai, { recursive: true });
  const x4 = (name, img) => {   // Real-ESRGAN 4x (anime model) of an image -> image
    const i = path.join(ai, name + '.png'), o = path.join(ai, name + '_x4.png');
    writePNG(i, img);
    execFileSync(exe, ['-i', i, '-o', o, '-n', 'realesrgan-x4plus-anime', '-s', '4', '-m', path.join(esrganDir, 'models')], { stdio: 'ignore' });
    return readPNG(o);
  };
  const opaque = im => { const o = { w: im.w, h: im.h, px: new Uint8ClampedArray(im.px) }; for (let i = 3; i < o.px.length; i += 4) o.px[i] = 255; return o; };
  // a mask as a grey image: from an image's alpha (channel 3) or from a grey image (channel 0)
  const grey = (im, channel, f = a => a) => { const o = { w: im.w, h: im.h, px: new Uint8ClampedArray(im.px.length) }; for (let i = 0; i < o.px.length; i += 4) { const a = f(im.px[i + channel]); o.px.set([a, a, a, 255], i); } return o; };
  const cut = a => a > 245 ? 255 : a < 10 ? 0 : a;
  const half = im => { const w = im.w / 2, h = im.h / 2, o = { w, h, px: new Uint8ClampedArray(w * h * 4) }; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) { let s = 0; for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) s += im.px[((2 * y + j) * im.w + 2 * x + i) * 4 + c]; o.px[(y * w + x) * 4 + c] = s / 4; } return o; };
  const cr = u => { u = Math.abs(u); return u < 1 ? 1.5 * u ** 3 - 2.5 * u ** 2 + 1 : u < 2 ? -0.5 * u ** 3 + 2.5 * u ** 2 - 4 * u + 2 : 0; };
  // HD + the bicubically upsampled difference between the original and the box-downsampled HD
  function restore(hd, orig) {
    const S = hd.w / orig.w, w = orig.w, h = orig.h, res = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const q = ((y * S + j) * hd.w + x * S + i) * 4; for (let c = 0; c < 3; c++) acc[c] += hd.px[q + c]; }
      for (let c = 0; c < 3; c++) res[(y * w + x) * 3 + c] = orig.px[(y * w + x) * 4 + c] - acc[c] / (S * S);
    }
    const out = { w: hd.w, h: hd.h, px: new Uint8ClampedArray(hd.px) };
    for (let Y = 0; Y < hd.h; Y++) for (let X = 0; X < hd.w; X++) {
      const x = (X + 0.5) / S - 0.5, y = (Y + 0.5) / S - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), acc = [0, 0, 0];
      for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) {
        const wgt = cr(x - x0 - i) * cr(y - y0 - j); if (!wgt) continue;
        const xx = Math.min(w - 1, Math.max(0, x0 + i)), yy = Math.min(h - 1, Math.max(0, y0 + j));
        for (let c = 0; c < 3; c++) acc[c] += wgt * res[(yy * w + xx) * 3 + c];
      }
      for (let c = 0; c < 3; c++) out.px[(Y * hd.w + X) * 4 + c] = hd.px[(Y * hd.w + X) * 4 + c] + acc[c];
    }
    return out;
  }
  const icon = f => tplOf(`/button/timg/tt_mariokart_channel_top_menu_image_${f}.tpl`);
  const ranking = tplRGB5A3(icon('ranking')), event = tplRGB5A3(icon('event'));
  const mask = x4('alpha_x4', grey(x4('alpha', grey(ranking, 3)), 0, cut));   // the shared checkered fade, 16x
  const colour = {
    ranking: x4('ranking2', opaque(x4('ranking', opaque(ranking)))),
    event: x4('event2', opaque(restore(x4('event', opaque(event)), event))),
  };
  const alpha = half(mask);
  for (const f of ['ranking', 'event']) {
    const im = half(colour[f]);
    for (let i = 0; i < im.px.length; i += 4) im.px[i + 3] = cut(alpha.px[i]);
    writePNG(path.join(menuDir, tplName(icon(f)) + '.png'), im);
  }
  console.log(`2 HD channel icons (${colour.ranking.w / 2}x${colour.ranking.h / 2}) -> ${menuDir}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
