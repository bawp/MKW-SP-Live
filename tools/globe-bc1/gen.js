// BC1 (DXT1) DDS replacements for the globe's CMPR textures, for WiiCompiled's texture pack.
//
// aurora decodes a CMPR texture to RGBA8 on the CPU the first time it is drawn (4 MiB for each
// 1024x1024 tile) and keeps the result; the Rankings' Continental view zooms the globe into its region
// tiles, so the first switch to it decodes a batch of them in one frame (a noticeable hitch). A DDS
// replacement in a GPU format is uploaded as it is. CMPR is BC1 with another block order (8x8 tiles
// of four 4x4 blocks), big-endian colours and the 2-bit indices in the other order, so this converts
// them losslessly: the same picture, no decode at run time.
//
// usage: node tools/globe-bc1/gen.js <game files dir (…/DATA/files)> <out dir>
// It reads contents/globe.arc (earth.brres.LZ) and Scene/Model/Earth.szs from the disc; the DDS
// files are named as aurora looks them up (tex1_<w>x<h>_<xxh64>_14.dds).
const fs = require('fs'), path = require('path');
const [, , filesDir, outDir] = process.argv;
if (!filesDir || !outDir) { console.error('usage: node gen.js <game files dir> <out dir>'); process.exit(1); }

// ---- XXH64 (as tools/texhash.js) ----
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

// ---- archives ----
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
function lz77(b) {   // Nintendo LZ77 (type 0x10), with the extended size header
  let size = b.readUInt32LE(0) >>> 8, s = 4;
  if (!size) { size = b.readUInt32LE(4); s = 8; }
  const o = Buffer.alloc(size); let d = 0;
  while (d < size) {
    const flags = b[s++];
    for (let i = 0; i < 8 && d < size; i++) {
      if (!(flags & (0x80 >> i))) { o[d++] = b[s++]; continue; }
      const b1 = b[s++], b2 = b[s++], len = (b1 >> 4) + 3, dist = ((b1 & 15) << 8 | b2) + 1;
      for (let k = 0; k < len; k++, d++) o[d] = o[d - dist];
    }
  }
  return o;
}
function u8Files(b) {
  if (b.readUInt32BE(0) !== 0x55AA382D) return [];
  const root = b.readUInt32BE(4), n = b.readUInt32BE(root + 8), st = root + n * 12, out = [];
  const name = o => { let e = st + o; while (b[e]) e++; return b.toString('latin1', st + o, e); };
  for (let i = 1; i < n; i++) {
    const e = root + i * 12;
    if (b[e] === 0) out.push({ name: name(b.readUIntBE(e + 1, 3)), data: b.subarray(b.readUInt32BE(e + 4), b.readUInt32BE(e + 4) + b.readUInt32BE(e + 8)) });
  }
  return out;
}

// ---- CMPR -> BC1 ----
function cmprToBc1(src, w, h) {
  const bw = w / 4, out = Buffer.alloc(w * h / 2);
  let p = 0;
  for (let ty = 0; ty < h; ty += 8)
    for (let tx = 0; tx < w; tx += 8)
      for (let sy = 0; sy < 8; sy += 4)
        for (let sx = 0; sx < 8; sx += 4, p += 8) {
          const o = (((ty + sy) / 4) * bw + (tx + sx) / 4) * 8;
          out.writeUInt16LE(src.readUInt16BE(p), o);
          out.writeUInt16LE(src.readUInt16BE(p + 2), o + 2);
          for (let r = 0; r < 4; r++) {
            const v = src[p + 4 + r];   // GX: pixel 0 in the top bits; BC1: in the bottom bits
            out[o + 4 + r] = ((v >> 6) & 3) | (((v >> 4) & 3) << 2) | (((v >> 2) & 3) << 4) | ((v & 3) << 6);
          }
        }
  return out;
}
function dds(w, h, bc1) {
  const hdr = Buffer.alloc(128);
  hdr.write('DDS ', 0, 'latin1');
  hdr.writeUInt32LE(124, 4);                                   // header size
  hdr.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, 8);    // caps, height, width, pixel format, linear size
  hdr.writeUInt32LE(h, 12); hdr.writeUInt32LE(w, 16);
  hdr.writeUInt32LE(bc1.length, 20);
  hdr.writeUInt32LE(1, 28);                                    // mip count
  hdr.writeUInt32LE(32, 76); hdr.writeUInt32LE(0x4, 80);       // pixel format: FourCC
  hdr.write('DXT1', 84, 'latin1');
  hdr.writeUInt32LE(0x1000, 108);                              // caps: texture
  return Buffer.concat([hdr, bc1]);
}

// ---- TEX0 in BRRES ----
function tex0s(brres) {
  const out = [];
  for (let i = brres.indexOf('TEX0'); i >= 0; i = brres.indexOf('TEX0', i + 1)) {
    const version = brres.readUInt32BE(i + 8);
    if (version !== 1 && version !== 3) continue;
    const w = brres.readUInt16BE(i + 0x1C), h = brres.readUInt16BE(i + 0x1E), format = brres.readUInt32BE(i + 0x20), mips = brres.readUInt32BE(i + 0x24);
    const data = i + brres.readInt32BE(i + 0x10);
    let name = ''; for (let k = i + brres.readInt32BE(i + 0x14); k < brres.length && brres[k]; k++) name += String.fromCharCode(brres[k]);
    out.push({ name, w, h, format, mips, data });
  }
  return out;
}

const sources = [];
const globeArc = path.join(filesDir, 'contents', 'globe.arc');
if (fs.existsSync(globeArc))
  for (const f of u8Files(fs.readFileSync(globeArc))) sources.push({ from: 'globe.arc/' + f.name, brres: f.name.endsWith('.LZ') ? lz77(f.data) : f.data });
const earthSzs = path.join(filesDir, 'Scene', 'Model', 'Earth.szs');
if (fs.existsSync(earthSzs))
  for (const f of u8Files(yaz0(fs.readFileSync(earthSzs)))) if (f.name.endsWith('.brres')) sources.push({ from: 'Earth.szs/' + f.name, brres: f.data });

fs.mkdirSync(outDir, { recursive: true });
let written = 0, bytes = 0;
const seen = new Set();
for (const s of sources)
  for (const t of tex0s(s.brres)) {
    if (t.format !== 14 || t.mips !== 1 || t.w % 8 || t.h % 8 || t.w < 64) continue;   // CMPR, one level, the big ones
    const raw = s.brres.subarray(t.data, t.data + t.w * t.h / 2);
    const name = `tex1_${t.w}x${t.h}_${xxh64(raw).toString(16).padStart(16, '0')}_14`;
    if (seen.has(name)) continue;
    seen.add(name);
    const file = dds(t.w, t.h, cmprToBc1(raw, t.w, t.h));
    fs.writeFileSync(path.join(outDir, name + '.dds'), file);
    written++; bytes += file.length;
  }
console.log(`${written} BC1 textures (${(bytes / 1048576).toFixed(1)} MiB) from ${sources.map(s => s.from).join(', ')} -> ${outDir}`);
