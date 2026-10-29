// Offline: match Toad's Factory's GSC Division 1 (Seasons 1-14) players and teams to mkw-stats'.
// Writes bridge.json (matches + reports) next to the cached data in the work dir (argv[2]).
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const TF = 'http://toadsfactory.mkw.gg', MS = 'https://mkw-stats.web.app';
const divisions = {1: 190, 2: 189, 3: 222, 4: 220, 5: 211, 6: 219, 7: 229, 8: 160, 9: 210, 10: 209, 11: 208, 12: 239, 13: 267, 14: 263};

async function get(url, file) {
  const at = file && path.join(dir, file);
  if (at && fs.existsSync(at)) return JSON.parse(fs.readFileSync(at, 'utf8'));
  for (let tries = 0; tries < 3; tries++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      const text = await res.text();
      const json = JSON.parse(text);
      if (at) fs.writeFileSync(at, text);
      return json;
    } catch (e) { await new Promise(r => setTimeout(r, 800)); }
  }
  return null;
}
const loose = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const digits = s => (s || '').replace(/\D/g, '');

(async () => {
  // ---- Toad's Factory side
  const tfPlayers = new Map();   // id -> { id, name, seasons: [{season, tag, team, clan}] }
  const tfTeams = new Map();     // clan|tag -> { clan, name, tag, seasons: [] }
  for (const [season, div] of Object.entries(divisions)) {
    const d = await get(`${TF}/api/division/${div}/standing`, `d${div}.json`);
    for (const st of d.clanStandings) {
      const p = st.participant;
      const key = `${p.clan_id}|${p.tag}`;
      if (!tfTeams.has(key)) tfTeams.set(key, {clan: p.clan_id, name: p.name, tag: p.tag, seasons: []});
      tfTeams.get(key).seasons.push(+season);
      for (const m of p.members || []) {
        if (!tfPlayers.has(m.player_id)) tfPlayers.set(m.player_id, {id: m.player_id, name: m.name, seasons: []});
        tfPlayers.get(m.player_id).seasons.push({season: +season, tag: p.tag, team: p.name});
      }
    }
  }
  console.log('TF players', tfPlayers.size, 'TF teams', tfTeams.size);
  // details: alternative names, friend codes
  const ids = [...tfPlayers.keys()];
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async id => {
      const j = await get(`${TF}/api/player/${id}`, `tfp_${id}.json`);
      const p = tfPlayers.get(id);
      p.alt = (j && j.altNames || []).map(a => a.name);
      p.fcs = (j && j.fcs || []).map(f => digits(f.fc)).filter(x => x.length === 12);
      p.mii = j && j.mii;
    }));
  }

  // ---- mkw-stats side: every division of Seasons 15 and 16
  const msPlayers = new Map();   // id -> { id, name, teams: Set }
  const msTeams = new Map();     // team id -> { id, names: Set, tags: Set }
  for (const season of ['s15', 's16']) {
    const divs = await get(`${MS}/api/divisions?league=gsc&season=${season}`, `ms_div_${season}.json`);
    for (const dv of divs || []) {
      const st = await get(`${MS}/api/standings?league=gsc&season=${season}&division=${dv.division}`, `ms_st_${season}_${dv.division}.json`);
      if (!st) continue;
      for (const t of st.standings || []) {
        if (!msTeams.has(t.team_id)) msTeams.set(t.team_id, {id: t.team_id, names: new Set(), tags: new Set()});
        msTeams.get(t.team_id).names.add(t.name); msTeams.get(t.team_id).tags.add(t.tag);
      }
      for (const p of st.leaderboard || []) {
        if (!msPlayers.has(p.player_id)) msPlayers.set(p.player_id, {id: p.player_id, name: p.name, tags: new Set()});
        msPlayers.get(p.player_id).tags.add(p.team_tag);
      }
    }
  }
  console.log('MS players', msPlayers.size, 'MS teams', msTeams.size);
  const byName = new Map();
  for (const p of msPlayers.values()) {
    for (const part of [p.name, ...p.name.split('/')]) {
      const k = loose(part); if (!k) continue;
      if (!byName.has(k)) byName.set(k, new Set());
      byName.get(k).add(p.id);
    }
  }
  const msFcs = async id => {
    const j = await get(`${MS}/api/players/${id}/overview?league=gsc`, `msp_${id}.json`);
    return ((j && j.identity && j.identity.friend_codes) || []).map(digits);
  };
  const msAliases = async id => {
    const j = await get(`${MS}/api/players/${id}/overview?league=gsc`, `msp_${id}.json`);
    const a = (j && j.identity && j.identity.aliases) || {};
    return Object.values(a).flat().map(String);
  };

  // ---- players
  const matched = [], ambiguous = [], none = [];
  for (const p of tfPlayers.values()) {
    const names = [p.name, ...p.alt];
    const cands = new Set();
    for (const n of names) for (const id of byName.get(loose(n)) || []) cands.add(id);
    let pick = null, how = '';
    // friend codes decide when they overlap
    for (const id of cands) {
      const f = await msFcs(id);
      if (f.some(x => p.fcs.includes(x))) { pick = id; how = 'fc'; break; }
    }
    if (!pick && cands.size === 1) { pick = [...cands][0]; how = names.some(n => loose(n) === loose(p.name) && loose(msPlayers.get(pick).name) === loose(n)) ? 'name' : 'alt'; }
    if (pick) { matched.push({tf: p.id, ms: pick, tfName: p.name, msName: msPlayers.get(pick).name, how}); continue; }
    if (cands.size > 1) { ambiguous.push({tf: p.id, tfName: p.name, alt: p.alt, seasons: p.seasons, candidates: [...cands].map(id => ({id, name: msPlayers.get(id).name, tags: [...msPlayers.get(id).tags]}))}); continue; }
    none.push({tf: p.id, tfName: p.name, alt: p.alt, last: Math.max(...p.seasons.map(s => s.season)), seasons: p.seasons.map(s => `S${s.season} ${s.tag}`)});
  }
  // also: mkw-stats aliases (lounge / table / mii names) for players still without a match
  const msByAlias = new Map();
  for (const p of msPlayers.values()) {
    if (matched.some(m => m.ms === p.id)) continue;
    for (const a of await msAliases(p.id)) { const k = loose(a); if (k) { if (!msByAlias.has(k)) msByAlias.set(k, new Set()); msByAlias.get(k).add(p.id); } }
  }
  for (let i = none.length - 1; i >= 0; i--) {
    const p = none[i];
    const c = new Set();
    for (const n of [p.tfName, ...p.alt]) for (const id of msByAlias.get(loose(n)) || []) c.add(id);
    if (c.size === 1) { const id = [...c][0]; matched.push({tf: p.tf, ms: id, tfName: p.tfName, msName: msPlayers.get(id).name, how: 'ms-alias'}); none.splice(i, 1); }
  }

  // ---- teams: by name (letters/digits), else by tag
  const teams = [];
  for (const t of tfTeams.values()) {
    let pick = null, how = '';
    for (const m of msTeams.values()) if ([...m.names].some(n => loose(n) === loose(t.name))) { pick = m.id; how = 'name'; }
    if (!pick) for (const m of msTeams.values()) if ([...m.tags].some(g => g === t.tag)) { pick = m.id; how = 'tag'; }
    teams.push({clan: t.clan, name: t.name, tag: t.tag, seasons: t.seasons, ms: pick, how});
  }
  fs.writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify({matched, ambiguous, none, teams}, null, 1));
  console.log('matched', matched.length, 'ambiguous', ambiguous.length, 'not on mkw-stats', none.length);
  console.log('match kinds', matched.reduce((o, m) => (o[m.how] = (o[m.how] || 0) + 1, o), {}));
  console.log('teams mapped', teams.filter(t => t.ms).length, '/', teams.length);
})();
