// Disassemble the converted+relocated payload (addresses as placed at 0x8180F000).
const fs=require('fs');const {decode}=require('./ppc.js');const C=require('./common.js');
const b=fs.readFileSync(require('path').join(C.ROOT,'build/MKW-SP/Binaries/Code.pul.relocated.bin'));
const SH=0x010A0000,PAD=0xF000;const a0=parseInt(process.argv[2]),n=+(process.argv[3]||20);
for(let a=a0;a<a0+n*4;a+=4){const w=b.readUInt32BE(PAD+a-C.P0);const na=(a+SH)>>>0;const d=decode(w,na);const s=C.byAddr.get(a);if(s)console.log('  <'+s[0].slice(0,80)+'>');console.log(C.hex(a),C.hex(na),w.toString(16).padStart(8,'0'),d.text)}
