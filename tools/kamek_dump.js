const fs=require('fs');const {parseKamek,NAMES}=require('./kamek.js');
const b=fs.readFileSync(process.argv[2]);const sizes=[0,4,8,12].map(i=>b.readUInt32BE(i));let o=0x10;const res=[];
for(const s of sizes){if(!s)continue;const k=parseKamek(b,o);const c=k.next(o+s);res.push({k,c,o});o+=s;}
console.log('consumed',o.toString(16),'file',b.length.toString(16));
res.forEach(({k,c,o},i)=>{console.log(i,o.toString(16),JSON.stringify(k.h),c.length)});
const A=res[0].c.filter(x=>x.abs),B=res[1].c.filter(x=>x.abs);
console.log('code identical:',b.subarray(res[0].k.codeOff,res[0].k.cmdOff).equals(b.subarray(res[1].k.codeOff,res[1].k.cmdOff)));
let diff=0;for(let i=0;i<Math.min(A.length,B.length);i++)if(A[i].a!==B[i].a&&diff++<5)console.log('diff',NAMES[A[i].t],A[i].a.toString(16),B[i].a.toString(16));console.log('abs cmd diffs',diff);
