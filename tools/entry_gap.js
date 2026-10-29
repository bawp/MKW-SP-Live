// Which payload code addresses are referenced as pointers (data words or lis/lo pairs) but are not
// registered as translator function entries?
const fs=require('fs');const C=require('./common.js');const A=require('./analyze.js');
const prof=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const SHIFT=0x010A0000;const entries=new Set(prof.Entries.map(e=>e.Address>>>0));
const codeEnd=A.CODE_END;const refs=new Map();
const add=(t,why)=>{if(t>=C.P0&&t<codeEnd&&!(t&3)){if(!refs.has(t))refs.set(t,why)}};
for(let a=0x807FBC74;a+4<=C.PEND;a+=4){if(a>=0x807FBC94&&a<0x807FE7F0)continue;add(C.u32(a),'data@'+C.hex(a));}
for(const u of A.users)add(u.v,'pair@'+C.hex(C.P0+u.lo*4));
let miss=[];for(const [t,why] of refs){if(!entries.has((t+SHIFT)>>>0))miss.push([t,why])}
console.log('pointer-referenced code addresses',refs.size,'missing entries',miss.length);
fs.writeFileSync(process.argv[3]||'extracted/missing_entries.json',JSON.stringify(miss.map(([t,w])=>[t,w,C.symAt(t)])));
miss.slice(0,15).forEach(([t,w])=>console.log(C.hex(t),w,C.symAt(t).slice(0,60)));
