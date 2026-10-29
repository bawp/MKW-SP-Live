const C=require('./common.js');const START=0x807FBC94,STOP=0x807FE7F0;
const out=[];for(let a=START;a<STOP;a+=20){const w=[0,4,8,12,16].map(i=>C.u32(a+i));out.push({at:a,name:(C.byAddr.get(a)||['?']).join('|'),w});}
module.exports=out;
if(require.main===module){const types={};for(const e of out){const k=e.w[0]+'/'+e.w[3].toString(16)+'/'+e.w[4];types[k]=(types[k]||0)+1}console.log(out.length,'entries',types);
for(const e of out){const [t,d,s,x,y]=e.w;let extra='';if(t===0){extra=' size='+x+' data='+C.pay.subarray(s-C.P0,s-C.P0+Math.min(x,16)).toString('hex')}
console.log(C.hex(e.at),t,C.hex(d),C.seg(d).padEnd(6),C.symAt(d).slice(0,60).padEnd(60),C.hex(s),C.seg(s),t===1?'link='+(x>>>24):'',extra,y?'Y='+C.hex(y):'', '#'+e.name.slice(0,50))}}
