// Parse the produced Code.pul, apply Kamek relocations at MODULE_BASE, and sanity-check the result.
const fs=require('fs');const {parseKamek,NAMES}=require('./kamek.js');const C=require('./common.js');const {decode}=require('./ppc.js');
const BASE=0x81800000;const b=fs.readFileSync(process.argv[2]);const n=b.readUInt32BE(0);
const k=parseKamek(b,0x10);const cmds=k.next(0x10+n);const code=Buffer.from(b.subarray(k.codeOff,k.cmdOff));
const hist={};for(const c of cmds){const x=NAMES[c.t]+(c.abs?'@abs':'@rel');hist[x]=(hist[x]||0)+1}console.log(JSON.stringify(k.h),hist);
const res=t=>(t&0x80000000)?t>>>0:(BASE+t)>>>0;let bad=0;
for(const c of cmds){if(c.abs)continue;const P=BASE+c.a,o=c.a,S=res(c.args[0]);
  switch(c.t){case 1:code.writeUInt32BE(S,o);break;case 4:code.writeUInt16BE(S&0xffff,o);break;case 5:code.writeUInt16BE(S>>>16,o);break;case 6:code.writeUInt16BE(((S+0x8000)>>>16)&0xffff,o);break;
   case 10:{const d=(S-P)|0;if(d>=0x2000000||d<-0x2000000){bad++;console.log('Rel24 out of range',P.toString(16),S.toString(16))}code.writeUInt32BE(((code.readUInt32BE(o)&0xfc000003)|(d&0x3fffffc))>>>0,o);break}
   default:console.log('rel cmd',NAMES[c.t])}}
// Every Addr16Lo must leave the low half unchanged (64 KiB congruence) and every Ha must equal old+0x0109 (or carry-consistent).
const PAD=0xF000;let loChanged=0,haOdd=0;
for(const c of cmds){if(c.abs)continue;if(c.t===4){const old=C.pay.readUInt16BE(c.a-PAD);if(old!==code.readUInt16BE(c.a))loChanged++}
  if(c.t===6){const old=C.pay.readUInt16BE(c.a-PAD),nw=code.readUInt16BE(c.a);if(nw!==((old+0x10A)&0xffff))haOdd++}}
console.log('lo halves changed:',loChanged,' ha not old+0x10A:',haOdd,' rel24 out of range:',bad);
// Patch commands land in DOL/REL ranges of the vanilla layout
let outside=0;for(const c of cmds)if(c.abs&&!((c.a>=0x80004000&&c.a<0x8038917C)||(c.a>=0x805103B4&&c.a<0x808DD3D4))){outside++;console.log('patch outside game code/data',c.a.toString(16),NAMES[c.t])}
console.log('abs patches outside game image:',outside);
fs.writeFileSync(process.argv[2]+'.relocated.bin',code);
