// Parse a Pulsar Code.pul: region header + Kamek blobs.
const fs=require('fs');
const NAMES={1:'Addr32',4:'Addr16Lo',5:'Addr16Hi',6:'Addr16Ha',10:'Rel24',32:'Write32',33:'Write16',34:'Write8',35:'CondWritePointer',36:'CondWrite32',37:'CondWrite16',38:'CondWrite8',64:'Branch',65:'BranchLink'};
const ARGS={1:1,4:1,5:1,6:1,10:1,32:1,33:1,34:1,35:2,36:2,37:2,38:2,64:1,65:1};
function parseKamek(b,off){
  if(b.toString('latin1',off,off+5)!=='Kamek')throw new Error('bad magic at '+off);
  const h={version:b.readUInt16BE(off+6),bss:b.readUInt32BE(off+8),code:b.readUInt32BE(off+12),ctorStart:b.readUInt32BE(off+16),ctorEnd:b.readUInt32BE(off+20)};
  let p=off+0x20+h.code;const cmds=[];
  return {h,codeOff:off+0x20,cmdOff:p,next(end){while(p<end){const w=b.readUInt32BE(p);p+=4;const t=w>>>24;let a=w&0xffffff,abs=false;if(a===0xfffffe){a=b.readUInt32BE(p);p+=4;abs=true}
    const n=ARGS[t];if(n===undefined)throw new Error('unknown cmd '+t+' at 0x'+(p-4).toString(16));const args=[];for(let i=0;i<n;i++){args.push(b.readUInt32BE(p));p+=4}cmds.push({t,a,abs,args})}return cmds}};
}
module.exports={parseKamek,NAMES};
if(require.main===module){
  const b=fs.readFileSync(process.argv[2]);
  const offs=[0,4,8,12].map(i=>b.readUInt32BE(i));console.log('header',offs.map(x=>x.toString(16)));
  const starts=[...new Set([0x10,...offs.filter(x=>x)])].sort((a,b)=>a-b);
  starts.forEach((s,i)=>{const end=i+1<starts.length?starts[i+1]:b.length;const ks=s===0x10?s:s+0x10; // tolerate
    let k;try{k=parseKamek(b,s)}catch(e){k=parseKamek(b,s+0x10)}
    const c=k.next(end);const hist={};c.forEach(x=>{const n=NAMES[x.t]+(x.abs?'@abs':'@rel');hist[n]=(hist[n]||0)+1});
    console.log('blob@'+s.toString(16),JSON.stringify(k.h),'cmds',c.length,hist);
    if(process.argv[3])c.filter(x=>x.abs).slice(0,+process.argv[3]).forEach(x=>console.log(' ',NAMES[x.t],x.a.toString(16),x.args.map(v=>v.toString(16))));
  });
}
