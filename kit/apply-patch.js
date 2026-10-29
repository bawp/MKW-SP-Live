// Applies git-style unified diffs (patches/000*.patch) to a WiiCompiled BuildWorkspace, so the kit
// does not need git. Every hunk must match exactly (line endings aside); nothing is written unless
// all hunks of all patches apply. A marker file records the applied set: running again with the
// same patches does nothing, a different set asks for a fresh workspace.
//
//   node apply-patch.js <BuildWorkspace> <a.patch> [<b.patch> ...]
const fs = require('fs'), path = require('path');

// Hunk bodies are read by their line counts, so "--- " / "+++ " only start a file outside a hunk
// (the patches mix plain and git-style diffs).
function parse(text) {
  const files = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let file = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1].startsWith('+++ ')) {
      const from = line.slice(4).split('\t')[0], to = lines[i + 1].slice(4).split('\t')[0];
      file = { from: from === '/dev/null' ? null : from.replace(/^a\//, ''), to: to.replace(/^b\//, ''), hunks: [] };
      files.push(file);
      i++;
      continue;
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m || !file) continue;
    let oldLeft = m[2] === undefined ? 1 : +m[2], newLeft = m[4] === undefined ? 1 : +m[4];
    const hunk = { oldStart: +m[1], lines: [] };
    while ((oldLeft > 0 || newLeft > 0) && i + 1 < lines.length) {
      const l = lines[++i];
      if (l === '\\ No newline at end of file') continue;
      const kind = l === '' ? ' ' : l[0];
      const body = l === '' ? ' ' : l;
      if (kind === ' ') { oldLeft--; newLeft--; } else if (kind === '-') oldLeft--; else if (kind === '+') newLeft--; else throw new Error('bad hunk line: ' + l);
      hunk.lines.push(body);
    }
    file.hunks.push(hunk);
  }
  return files;
}

function applyFile(lines, file) {
  let out = lines.slice(), shift = 0;
  for (const h of file.hunks) {
    const before = h.lines.filter(l => l[0] !== '+').map(l => l.slice(1));
    const after = h.lines.filter(l => l[0] !== '-').map(l => l.slice(1));
    const want = h.oldStart - 1 + shift;
    const matchesAt = at => at >= 0 && before.every((l, k) => out[at + k] === l);
    let at = -1;
    for (let d = 0; d <= 200 && at < 0; d++) { if (matchesAt(want + d)) at = want + d; else if (matchesAt(want - d)) at = want - d; }
    if (at < 0 && before.length === 0) at = Math.max(0, Math.min(want, out.length));
    if (at < 0) return null;
    out.splice(at, before.length, ...after);
    shift += after.length - before.length;
  }
  return out;
}

// A new file's lines, ending with the empty string after its last newline (as split() gives).
const newFileLines = f => [...f.hunks.flatMap(h => h.lines.filter(l => l[0] === '+').map(l => l.slice(1))), ''];

const [, , root, ...patches] = process.argv;
if (!root || !patches.length) throw new Error('usage: node apply-patch.js <BuildWorkspace> <patch>...');
const marker = path.join(root, '.mkwsp-kit-patches');
const sha256 = file => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const wanted = patches.map(p => `${path.basename(p)} ${sha256(p)}\n`).join('');
if (fs.existsSync(marker)) {
  if (fs.readFileSync(marker, 'utf8') === wanted) { console.log('patches already applied to', root); process.exit(0); }
  throw new Error(root + ' was patched with other patches; delete it and run the build again');
}
const pending = new Map();   // path -> { lines, eol, isNew }
const load = rel => {
  if (pending.has(rel)) return pending.get(rel);
  const full = path.join(root, rel);
  const exists = fs.existsSync(full);
  const text = exists ? fs.readFileSync(full, 'utf8') : '';
  const entry = { lines: exists ? text.replace(/\r\n/g, '\n').split('\n') : null, eol: /\r\n/.test(text) ? '\r\n' : '\n' };
  pending.set(rel, entry);
  return entry;
};
for (const patch of patches) {
  const files = parse(fs.readFileSync(patch, 'utf8'));
  for (const f of files) {
    const e = load(f.to);
    if (f.from === null && e.lines) throw new Error(`${path.basename(patch)}: ${f.to} already exists`);
    const result = f.from === null ? newFileLines(f) : e.lines ? applyFile(e.lines, f) : null;
    if (!result) throw new Error(`${path.basename(patch)}: does not apply to ${f.to} (is this WiiCompiled 0.9.2?)`);
    e.lines = result;
    e.touched = true;
  }
  console.log('applies:', path.basename(patch));
}
for (const [rel, e] of pending) {
  if (!e.touched) continue;
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, e.lines.join(e.eol));
}
fs.writeFileSync(marker, wanted);
console.log('patches applied to', root);
