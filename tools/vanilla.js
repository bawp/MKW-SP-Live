// Vanilla RMCP01 memory image: main.dol + StaticR.rel relocated at 0x805102E0 (bss at 0x809BD6E0).
const fs=require('fs'),path=require('path');
// MKWSP_WIICOMPILED_INSTALL: the WiiCompiled install folder (default %APPDATA%\CT-MKWII\Recomp\Install)
const INSTALL=process.env.MKWSP_WIICOMPILED_INSTALL||path.join(process.env.APPDATA,'CT-MKWII/Recomp/Install');
const A=path.join(INSTALL,'BuildWorkspace/Assets');
const dol=fs.readFileSync(path.join(A,'main.dol')),rel=fs.readFileSync(path.join(A,'StaticR.rel'));
const MEM_BASE=0x80000000,mem=Buffer.alloc(0x01A00000);
const put=(addr,buf)=>buf.copy(mem,addr-MEM_BASE);
for(let i=0;i<18;i++){const off=dol.readUInt32BE(i*4),addr=dol.readUInt32BE(0x48+i*4),size=dol.readUInt32BE(0x90+i*4);if(size)put(addr,dol.subarray(off,off+size))}
const REL_BASE=0x805102E0,REL_BSS=0x809BD6E0;
const nsec=rel.readUInt32BE(0xC),so=rel.readUInt32BE(0x10);const secAddr=[];
for(let i=0;i<nsec;i++){const o=rel.readUInt32BE(so+i*8),s=rel.readUInt32BE(so+i*8+4);if(o&~1){secAddr[i]=REL_BASE+(o&~1);put(secAddr[i],rel.subarray(o&~1,(o&~1)+s))}else if(s){secAddr[i]=REL_BSS}else secAddr[i]=0}
const impOff=rel.readUInt32BE(0x28),impSize=rel.readUInt32BE(0x2C);const relTargets=new Map();
const rd=a=>mem.readUInt32BE(a-MEM_BASE),wr=(a,v)=>mem.writeUInt32BE(v>>>0,a-MEM_BASE);
const rh=a=>mem.readUInt16BE(a-MEM_BASE),wh=(a,v)=>mem.writeUInt16BE(v&0xffff,a-MEM_BASE);
for(let i=0;i<impSize;i+=8){const mod=rel.readUInt32BE(impOff+i),ro=rel.readUInt32BE(impOff+i+4);let p=ro,where=0;
  for(;;p+=8){const off=rel.readUInt16BE(p),type=rel[p+2],sec=rel[p+3],add=rel.readUInt32BE(p+4);
    if(type===203)break;if(type===202){where=secAddr[sec];continue}where+=off;if(type===201||type===0)continue;
    const S=mod===0?add:(secAddr[sec]+add)>>>0;const P=where;relTargets.set(P,{type,S});
    switch(type){case 1:wr(P,S);break;case 4:wh(P,S);break;case 5:wh(P,S>>>16);break;case 6:wh(P,(S+0x8000)>>>16);break;
      case 10:wr(P,(rd(P)&0xfc000003)|((S-P)&0x3fffffc));break;case 11:wr(P,(rd(P)&0xffff0003)|((S-P)&0xfffc));break;
      default:throw new Error('reloc type '+type)}}}
module.exports={mem,read32:rd,read16:rh,relTargets,secAddr,REL_BASE,REL_BSS,INSTALL};
if(require.main===module){console.log('rel sections',secAddr.map(x=>x&&x.toString(16)));console.log('reloc sites',relTargets.size)}
