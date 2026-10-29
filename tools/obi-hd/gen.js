// HD (8x) versions of vanilla's Competitions bar textures (Channel.szs bg/timg/tk_obi_*_gp.tpl),
// rebuilt from the originals: each bar is one vertical cross-section (white, grey ramp, gold tube,
// shadow) repeated (left / right pieces) or swept along an S-curve (curve pieces). The cross-section
// is rebuilt at high resolution with hard edges kept hard and gradients smoothed; the curve's centre
// line is measured from the gold in each column and smoothed. The checker is upscaled bicubically.
// usage: node gen.js <timg dir> <out dir>
const fs = require('fs'), path = require('path');
const { tplRGB5A3, writePNG } = require('./img.js');
const S = 8;          // output scale
const [, , inDir, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const load = f => tplRGB5A3(fs.readFileSync(path.join(inDir, f)));

// ---- cross-section ------------------------------------------------------------------------------
const luma = v => 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2];
const lerp4 = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);

// Column-averaged samples of a side piece: [r,g,b,a] per row (straight colour).
function columnProfile(t) {
  const out = [];
  for (let y = 0; y < t.h; y++) {
    const acc = [0, 0, 0, 0];
    for (let x = 0; x < t.w; x++) for (let c = 0; c < 4; c++) acc[c] += t.px[(y * t.w + x) * 4 + c];
    out.push(acc.map(v => v / t.w));
  }
  return out;
}

// Monotone cubic (Fritsch-Carlson) through (xs, ys).
function pchip(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// The cross-section as a function of s (source pixels from the top, continuous) -> [r,g,b,a]
// premultiplied, with its hard edges at sub-pixel positions.
function buildProfile(samples) {
  const n = samples.length;
  const hard = i => {   // edge between i and i+1?
    const a = samples[i], b = samples[i + 1];
    return Math.abs(luma(a) - luma(b)) > 50 || Math.abs(a[3] - b[3]) > 60;
  };
  // Segments of rows between hard edges; a lone row between two edges is a partly covered pixel:
  // it moves the edge inside that row instead of being a segment of its own.
  const segs = [];   // { from, to (row indices, inclusive), start, end (edge positions) }
  let from = 0, start = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) { segs.push({ from, to: i, start, end: n }); break; }
    if (!hard(i)) continue;
    if (i + 1 < n - 1 && hard(i + 1) && i + 1 > from) {
      // row i+1 lone: coverage of the segment after it
      const A = samples[i], B = samples[i + 2], v = samples[i + 1];
      let best = 3, span = Math.abs(B[3] - A[3]);
      for (let c = 0; c < 3; c++) if (Math.abs(B[c] - A[c]) > span) { span = Math.abs(B[c] - A[c]); best = c; }
      const t = span > 1 ? Math.min(1, Math.max(0, (v[best] - A[best]) / (B[best] - A[best]))) : 0.5;
      const edge = i + 1 + (1 - t);
      segs.push({ from, to: i, start, end: edge });
      from = i + 2; start = edge; i++;
      continue;
    }
    segs.push({ from, to: i, start, end: i + 1 });
    from = i + 1; start = i + 1;
  }
  // Per segment: smoothed (translucent ones: alpha is only 3 bits) premultiplied curves.
  for (const g of segs) {
    let vals = samples.slice(g.from, g.to + 1).map(v => [v[0] * v[3] / 255, v[1] * v[3] / 255, v[2] * v[3] / 255, v[3]]);
    const translucent = vals.some(v => v[3] < 250);
    if (translucent && vals.length >= 4)
      for (let pass = 0; pass < 2; pass++)
        vals = vals.map((v, k) => { const a = vals[Math.max(0, k - 1)], b = vals[Math.min(vals.length - 1, k + 1)]; return v.map((x, c) => (a[c] + 2 * x + b[c]) / 4); });
    const xs = vals.map((_, k) => g.from + k + 0.5);
    g.f = [0, 1, 2, 3].map(c => pchip(xs, vals.map(v => v[c])));
  }
  const at = s => {
    s = Math.min(n - 1e-6, Math.max(0, s));
    const g = segs.find(g => s < g.end) || segs[segs.length - 1];
    return g.f.map(f => f(s));
  };
  return { at, segs, n };
}

// Box-filtered value over [s0, s1] (exact at edges, by sub-sampling).
function profileBox(P, s0, s1, k = 8) {
  const acc = [0, 0, 0, 0];
  for (let i = 0; i < k; i++) { const v = P.at(s0 + (s1 - s0) * (i + 0.5) / k); for (let c = 0; c < 4; c++) acc[c] += v[c]; }
  return acc.map(v => v / k);
}

// Prefix-summed fine table of the profile, for exact box samples in O(1).
function profileTable(P, lo, hi, r = 32) {
  const n = Math.ceil((hi - lo) * r), F = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)];
  for (let i = 0; i < n; i++) { const v = P.at(lo + (i + 0.5) / r); for (let c = 0; c < 4; c++) F[c][i + 1] = F[c][i] + v[c] / r; }
  const at = (c, s) => { const u = Math.min(n, Math.max(0, (s - lo) * r)), i = Math.floor(u), f = u - i; return F[c][i] + (i < n ? (F[c][i + 1] - F[c][i]) * f : 0) + (s < lo ? (s - lo) * (F[c][1] - F[c][0]) * r : 0) + (s > hi ? (s - hi) * (F[c][n] - F[c][n - 1]) * r : 0); };
  return { box: (s0, s1) => [0, 1, 2, 3].map(c => (at(c, s1) - at(c, s0)) / (s1 - s0)) };
}
const premul = v => [v[0] * v[3] / 255, v[1] * v[3] / 255, v[2] * v[3] / 255, v[3]];

// Where a column (rows of straight RGBA) has the cross-section's centre p0 (and how stretched it is:
// a sloped band crosses a column 1/cos as tall): least squares over centre and stretch.
function fitColumn(T, p0, col, guess, stretch = [1, 2.6]) {
  const pm = col.map(premul);
  let best = Infinity, bc = guess, bk = 1;
  const sse = (c, k) => { let e = 0; for (let y = 0; y < pm.length; y++) { const v = T.box(p0 + (y - c) / k, p0 + (y + 1 - c) / k); for (let q = 0; q < 4; q++) { const d = v[q] - pm[y][q]; e += d * d; } } return e; };
  for (let k = stretch[0]; k <= stretch[1] + 1e-9; k += 0.04) for (let c = guess - 6; c <= guess + 6; c += 0.1) { const e = sse(c, k); if (e < best) { best = e; bc = c; bk = k; } }
  for (let k = Math.max(stretch[0], bk - 0.04); k <= Math.min(stretch[1], bk + 0.04) + 1e-9; k += 0.01) for (let c = bc - 0.1; c <= bc + 0.1; c += 0.01) { const e = sse(c, k); if (e < best) { best = e; bc = c; bk = k; } }
  return { c: bc, k: bk };
}

// Adds the bicubically upsampled difference between the original and the box-downsampled result,
// so whatever the model misses (shading in the bends) comes back, smoothly.
function addResidual(src, img) {
  const res = new Float32Array(src.w * src.h * 4);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const acc = [0, 0, 0, 0];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = ((y * S + j) * img.w + x * S + i) * 4; const v = premul([img.px[k], img.px[k + 1], img.px[k + 2], img.px[k + 3]]); for (let c = 0; c < 4; c++) acc[c] += v[c]; }
    const k = (y * src.w + x) * 4, sv = premul([src.px[k], src.px[k + 1], src.px[k + 2], src.px[k + 3]]);
    for (let c = 0; c < 4; c++) { const d = sv[c] - acc[c] / (S * S); res[k + c] = Math.abs(d) < 6 ? 0 : d; }   // leave quantisation noise
  }
  const cr = u => { u = Math.abs(u); return u < 1 ? 1.5 * u ** 3 - 2.5 * u ** 2 + 1 : u < 2 ? -0.5 * u ** 3 + 2.5 * u ** 2 - 4 * u + 2 : 0; };
  const R = (x, y, c) => res[(Math.min(src.h - 1, Math.max(0, y)) * src.w + Math.min(src.w - 1, Math.max(0, x))) * 4 + c];
  for (let Y = 0; Y < img.h; Y++) for (let X = 0; X < img.w; X++) {
    const x = (X + 0.5) / S - 0.5, y = (Y + 0.5) / S - 0.5, x0 = Math.floor(x), y0 = Math.floor(y);
    const d = [0, 0, 0, 0];
    for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) { const w = cr(x - (x0 + i)) * cr(y - (y0 + j)); if (!w) continue; for (let c = 0; c < 4; c++) d[c] += w * R(x0 + i, y0 + j, c); }
    if (!d.some(v => v)) continue;
    const k = (Y * img.w + X) * 4, v = premul([img.px[k], img.px[k + 1], img.px[k + 2], img.px[k + 3]]).map((v, c) => v + d[c]);
    v[3] = Math.min(255, Math.max(0, v[3])); for (let c = 0; c < 3; c++) v[c] = Math.min(v[3], Math.max(0, v[c]));
    img.px.set(unpremul(v).map(Math.round), k);
  }
}

const unpremul = v => v[3] > 0.5 ? [v[0] * 255 / v[3], v[1] * 255 / v[3], v[2] * 255 / v[3], v[3]] : [0, 0, 0, 0];

// Gold-band centre of a column of samples (the same measure for the profile and the curve).
function goldCentre(col) {
  let sw = 0, sy = 0;
  col.forEach((v, y) => { if (v[3] < 250) return; const w = Math.min(1, Math.max(0, (v[0] - v[2] - 15) / 20)); sw += w; sy += w * (y + 0.5); });
  return sw > 0.5 ? sy / sw : null;
}

// ---- pieces -------------------------------------------------------------------------------------
function sidePiece(file, P) {
  const t = load(file);
  const W = t.w * S, H = t.h * S, px = new Uint8ClampedArray(W * H * 4);
  for (let Y = 0; Y < H; Y++) {
    const v = unpremul(profileBox(P, Y / S, (Y + 1) / S));
    for (let X = 0; X < W; X++) px.set(v.map(Math.round), (Y * W + X) * 4);
  }
  return { src: t, img: { w: W, h: H, px } };
}

function curvePiece(file, P, p0) {
  const t = load(file);
  const T = profileTable(P, -300, P.n + 300);
  // Measured centre per column, then smoothed (Gaussian, sigma 1.5 px) with flat ends kept.
  const raw = [];
  for (let x = 0; x < t.w; x++) {
    const col = []; for (let y = 0; y < t.h; y++) col.push([...t.px.slice((y * t.w + x) * 4, (y * t.w + x) * 4 + 4)]);
    let g = goldCentre(col);
    if (g === null) g = raw.length ? raw[raw.length - 1] : p0;
    raw.push(fitColumn(T, p0, col, g).c);
  }
  const sm = raw.map((_, x) => { let a = 0, w = 0; for (let k = -5; k <= 5; k++) { const i = Math.min(t.w - 1, Math.max(0, x + k)), g = Math.exp(-k * k / (2 * 1.5 * 1.5)); a += g * raw[i]; w += g; } return a / w; });
  const yc = pchip(sm.map((_, x) => x + 0.5), sm);
  // Dense table of the centre line for the nearest-point search.
  const step = 1 / 16, tab = [];
  for (let x = -2; x <= t.w + 2; x += step) tab.push([x, yc(x)]);
  const signedDist = (x, y) => {
    // nearest table point within +-24 px horizontally
    const i0 = Math.max(0, Math.floor((x - 24 + 2) / step)), i1 = Math.min(tab.length - 1, Math.ceil((x + 24 + 2) / step));
    let best = Infinity, bi = i0;
    for (let i = i0; i <= i1; i += 4) { const dx = tab[i][0] - x, dy = tab[i][1] - y, d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } }
    for (let i = Math.max(i0, bi - 4); i <= Math.min(i1, bi + 4); i++) { const dx = tab[i][0] - x, dy = tab[i][1] - y, d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } }
    return Math.sign(y - tab[bi][1]) * Math.sqrt(best);
  };
  const W = t.w * S, H = t.h * S, px = new Uint8ClampedArray(W * H * 4);
  const SS = 4;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const acc = [0, 0, 0, 0];
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const x = (X + (i + 0.5) / SS) / S, y = (Y + (j + 0.5) / SS) / S;
      const far = Math.abs(y - yc(x)) > 40;
      const v = P.at(p0 + (far ? y - yc(x) : signedDist(x, y)));
      for (let c = 0; c < 4; c++) acc[c] += v[c];
    }
    px.set(unpremul(acc.map(v => v / (SS * SS))).map(Math.round), (Y * W + X) * 4);
  }
  const img = { w: W, h: H, px };
  addResidual(t, img);
  return { src: t, img, centre: [sm[0], sm[t.w - 1]] };
}

function bicubicPiece(file) {
  const t = load(file);
  const W = t.w * S, H = t.h * S, px = new Uint8ClampedArray(W * H * 4);
  const pm = (x, y) => { x = Math.min(t.w - 1, Math.max(0, x)); y = Math.min(t.h - 1, Math.max(0, y)); const i = (y * t.w + x) * 4, a = t.px[i + 3]; return [t.px[i] * a / 255, t.px[i + 1] * a / 255, t.px[i + 2] * a / 255, a]; };
  const cr = u => { u = Math.abs(u); return u < 1 ? 1.5 * u ** 3 - 2.5 * u ** 2 + 1 : u < 2 ? -0.5 * u ** 3 + 2.5 * u ** 2 - 4 * u + 2 : 0; };
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const x = (X + 0.5) / S - 0.5, y = (Y + 0.5) / S - 0.5, x0 = Math.floor(x), y0 = Math.floor(y);
    const acc = [0, 0, 0, 0];
    for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) { const w = cr(x - (x0 + i)) * cr(y - (y0 + j)), v = pm(x0 + i, y0 + j); for (let c = 0; c < 4; c++) acc[c] += w * v[c]; }
    px.set(unpremul(acc.map(v => Math.min(255, Math.max(0, v)))).map(Math.round), (Y * W + X) * 4);
  }
  return { src: t, img: { w: W, h: H, px } };
}

// Box-downsampled HD vs the original: mean / max error per channel (straight colour where opaque).
function check(name, { src, img }) {
  let sum = 0, max = 0, cnt = 0;
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const acc = [0, 0, 0, 0];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = ((y * S + j) * img.w + x * S + i) * 4, a = img.px[k + 3]; acc[0] += img.px[k] * a; acc[1] += img.px[k + 1] * a; acc[2] += img.px[k + 2] * a; acc[3] += a; }
    const k = (y * src.w + x) * 4, a = acc[3] / (S * S);
    const v = a > 0 ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3], a] : [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      if (c < 3 && (src.px[k + 3] < 128 || a < 128)) continue;
      const e = Math.abs(v[c] - src.px[k + c]); sum += e; cnt++; if (e > max) max = e;
    }
  }
  console.log(name.padEnd(28), 'mean error', (sum / cnt).toFixed(2), 'max', max.toFixed(0));
}

module.exports = { buildProfile, columnProfile, goldCentre, sidePiece, curvePiece, bicubicPiece, check, load, S };

if (require.main === module) {
  const out = [];
  for (const bar of ['top', 'bottom']) {
    const left = load(`tk_obi_${bar}_left_gp.tpl`);
    const prof = columnProfile(left);
    const P = buildProfile(prof);
    const p0 = goldCentre(prof);
    console.log(bar, 'profile edges', P.segs.map(g => g.end.toFixed(2)).join(' '), 'gold centre', p0.toFixed(2));
    for (const side of ['left', 'right']) {
      const file = `tk_obi_${bar}_${side}_gp.tpl`;
      const t = load(file), sp = columnProfile(t);
      const c = fitColumn(profileTable(P, -300, P.n + 300), p0, sp, goldCentre(sp), [1, 1]).c;
      console.log(file, 'centre', c.toFixed(2));
      // the right piece is the same cross-section shifted: render it from the left one
      const shifted = { at: s => P.at(s + (p0 - c)) };
      const r = sidePiece(file, shifted);
      addResidual(r.src, r.img);
      out.push([file, r]);
    }
    const file = `tk_obi_${bar}_curve_gp.tpl`;
    const cp = curvePiece(file, P, p0);
    console.log(file, 'centre line', cp.centre.map(v => v.toFixed(2)).join(' -> '));
    out.push([file, cp]);
  }
  out.push(['tk_obi_check_gp.tpl', bicubicPiece('tk_obi_check_gp.tpl')]);
  for (const [file, r] of out) { check(file, r); writePNG(path.join(outDir, file.replace('.tpl', '.png')), r.img); }
}
