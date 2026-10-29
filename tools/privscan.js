const C=require('./common.js');const A=require('./analyze.js');
const res=new Map();
A.ins.forEach((d,i)=>{const w=d.w,op=w>>>26,xo=(w>>>1)&0x3ff;let why=null;
  if(op===19&&(xo===50))why='rfi';
  if(op===31&&[146,83,210,242,306,566,595,659,470].includes(xo))why={146:'mtmsr',83:'mfmsr',210:'mtsr',242:'mtsrin',306:'tlbie',566:'tlbsync',595:'mfsr',659:'mfsrin',470:'dcbi'}[xo];
  if(op===31&&(xo===467||xo===339)){const spr=(((w>>>11)&31)<<5)|((w>>>16)&31);if(![1,8,9,912,913,914,915,916,917,918,919,268,269].includes(spr))why=(xo===467?'mtspr ':'mfspr ')+spr}
  if(op===31&&xo===371)why='mftb';
  if(op===17)why='sc';
  if(why){const a=C.P0+i*4;const f=C.symAt(a).replace(/\+0x[0-9a-f]+$/,'');if(!res.has(f))res.set(f,new Set());res.get(f).add(why)}});
for(const [f,s] of res)console.log(f.slice(0,80).padEnd(80),[...s].join(','));
