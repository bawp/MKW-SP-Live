// bridge_sure.json / bridge.json -> C++ tables (kEsPlayerBridge, kEsTeamBridge).
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const sure = JSON.parse(fs.readFileSync(path.join(dir, 'bridge_sure.json')));
const b = JSON.parse(fs.readFileSync(path.join(dir, 'bridge.json')));
const rows = sure.map(m => [m.ms, m.tf, m.tfName, m.msName]);
rows.push([58, 164, 'Luke', 'LukeGB']);   // Daisy Squad in both (luke the toolbox, the other match, is not him)
// Decided by hand (decisions.json): yes pairs added, no pairs left out.
const decisions = JSON.parse(fs.readFileSync(path.join(__dirname, 'decisions.json')));
for (const [tf, ms] of Object.entries(decisions.yes)) if (!rows.some(r => r[1] === +tf)) rows.push([ms, +tf, '', '']);
for (let i = rows.length - 1; i >= 0; i--) if (decisions.no.includes(rows[i][1])) rows.splice(i, 1);
rows.sort((a, b) => a[0] - b[0]);
const quote = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const comment = (ms, tf) => (ms === tf ? ms : `${ms} (${tf} there)`);
let out = "// Players in both: { mkw-stats player, Toad's Factory player } (tools: friend codes, else the same\n// name or alternative name on a team both list).\nconstexpr std::pair<int, int> kEsPlayerBridge[] = {\n";
for (const r of rows) out += `    {${r[0]}, ${r[1]}},`.padEnd(18) + `// ${comment(r[3], r[2])}\n`;
out += "};\n\n// Teams in both: Toad's Factory clan and tag -> mkw-stats team.\nstruct EsTeamLink {\n    int clan;\n    const char* tag;\n    int team;\n};\nconst EsTeamLink kEsTeamBridge[] = {\n";
for (const t of b.teams.filter(t => t.ms)) out += `    {${t.clan}, "${quote(t.tag)}", ${t.ms}},`.padEnd(30) + `// ${t.name}\n`;
out += '};\n';
fs.writeFileSync(path.join(dir, '..', 'bridge_tables.cpp'), out);
console.log(rows.length, 'players,', b.teams.filter(t => t.ms).length, 'teams');
