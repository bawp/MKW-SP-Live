const fs=require('fs');const path=require('path');
const ROOT=path.join(__dirname,'..');
const P0=0x8076F000, PSIZE=0x153D74, PEND=P0+PSIZE, LOFF=0x58C0;
const loader=fs.readFileSync(path.join(ROOT,'extracted/contents/bin/loader.bin'));
const pay=Buffer.from(loader.subarray(LOFF,LOFF+PSIZE));
const smap=fs.readFileSync(path.join(ROOT,'extracted/contents/bin/payloadP.SMAP'),'latin1').split('\n').filter(Boolean).map(l=>{const i=l.indexOf(' ');return {a:parseInt(l.slice(0,i)),n:l.slice(i+1)}});
const byAddr=new Map();for(const s of smap){if(!byAddr.has(s.a))byAddr.set(s.a,[]);byAddr.get(s.a).push(s.n)}
const sorted=[...smap].sort((x,y)=>x.a-y.a);
function symAt(a){let lo=0,hi=sorted.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(sorted[m].a<=a){r=m;lo=m+1}else hi=m-1}return r<0?'?':sorted[r].n+(a!==sorted[r].a?'+0x'+(a-sorted[r].a).toString(16):'')}
// MKW-SP memory layout -> vanilla (WiiCompiled) layout
const REL_SP=0x80399F2C, REL_SP_DATAEND=0x80767040, REL_D=0x1763B4, BSS_SP=0x80767040, BSS_SP_END=0x8076E8F0, BSS_D=0x2566A0;
function seg(a){a>>>=0;if(a>=0x80000000&&a<REL_SP)return 'dol';if(a>=REL_SP&&a<REL_SP_DATAEND)return 'rel';if(a>=BSS_SP&&a<P0)return 'relbss';if(a>=P0&&a<PEND)return 'pay';return 'other'}
function mapAddr(a){a>>>=0;const s=seg(a);if(s==='rel')return (a+REL_D)>>>0;if(s==='relbss')return (a+BSS_D)>>>0;return a}
const u32=a=>pay.readUInt32BE(a-P0);
const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');
module.exports={P0,PSIZE,PEND,pay,smap,byAddr,sorted,symAt,seg,mapAddr,u32,hex,REL_D,BSS_D,ROOT};
