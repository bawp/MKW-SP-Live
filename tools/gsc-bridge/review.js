const fs=require('fs'),path=require('path');const dir=process.argv[2];
const b=JSON.parse(fs.readFileSync(path.join(dir,'bridge.json')));
const loose=s=>(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'');
// mkw-stats player -> team ids and tags (S15/S16, every division)
const msTeamsOf=new Map(),msTagsOf=new Map();
for(const f of fs.readdirSync(dir).filter(f=>f.startsWith('ms_st_'))){const st=JSON.parse(fs.readFileSync(path.join(dir,f)));const entryTeam=new Map((st.standings||[]).map(t=>[t.team_season_entry_id,t.team_id]));
 for(const p of st.leaderboard||[]){if(!msTeamsOf.has(p.player_id)){msTeamsOf.set(p.player_id,new Set());msTagsOf.set(p.player_id,new Set())}msTeamsOf.get(p.player_id).add(entryTeam.get(p.team_season_entry_id));msTagsOf.get(p.player_id).add(p.team_tag)}}
// TF player -> clans/tags
const tfOf=new Map();const divs={1:190,2:189,3:222,4:220,5:211,6:219,7:229,8:160,9:210,10:209,11:208,12:239,13:267,14:263};
for(const [s,d] of Object.entries(divs)){const j=JSON.parse(fs.readFileSync(path.join(dir,'d'+d+'.json')));for(const st of j.clanStandings){const p=st.participant;for(const m of p.members||[]){if(!tfOf.has(m.player_id))tfOf.set(m.player_id,[]);tfOf.get(m.player_id).push({s:+s,clan:p.clan_id,tag:p.tag})}}}
const teamMap=new Map(b.teams.filter(t=>t.ms).map(t=>[t.clan+'|'+t.tag,t.ms]));
const msCount=new Map();for(const m of b.matched)msCount.set(m.ms,(msCount.get(m.ms)||0)+1);
const sure=[],review=[];
for(const m of b.matched){
  const tf=tfOf.get(m.tf)||[];const tags=new Set(tf.map(x=>loose(x.tag)));const mapped=new Set(tf.map(x=>teamMap.get(x.clan+'|'+x.tag)).filter(Boolean));
  const msTeams=msTeamsOf.get(m.ms)||new Set(),msTags=[...(msTagsOf.get(m.ms)||[])].map(loose);
  const together=msTags.some(t=>tags.has(t))||[...msTeams].some(t=>mapped.has(t));
  const ok=m.how==='fc'||(together&&msCount.get(m.ms)===1);
  (ok?sure:review).push({...m,why:m.how==='fc'?'friend code':together?(msCount.get(m.ms)>1?'shares mkw-stats player with another':'') :'no shared team',tf_teams:tf.map(x=>'S'+x.s+' '+x.tag).join(', '),ms_teams:[...(msTagsOf.get(m.ms)||[])].join(', ')});
}
fs.writeFileSync(path.join(dir,'bridge_sure.json'),JSON.stringify(sure));
fs.writeFileSync(path.join(dir,'bridge_review.json'),JSON.stringify(review,null,1));
console.log('sure',sure.length,'review',review.length);
for(const r of review)console.log(`${r.how.padEnd(8)} TF ${r.tf} ${r.tfName} [${r.tf_teams}]  ->  mkw-stats ${r.ms} ${r.msName} [${r.ms_teams}]  (${r.why})`);
