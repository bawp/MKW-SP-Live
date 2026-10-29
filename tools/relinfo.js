const fs=require('fs');const b=fs.readFileSync(process.argv[2]);const base=parseInt(process.argv[3]||'0');
const n=b.readUInt32BE(0xC),so=b.readUInt32BE(0x10);console.log('sections',n,'bss',b.readUInt32BE(0x20).toString(16),'align',b.readUInt32BE(0x40),b.readUInt32BE(0x44));
for(let i=0;i<n;i++){const o=b.readUInt32BE(so+i*8),s=b.readUInt32BE(so+i*8+4);if(o||s)console.log(i,'off',(o&~1).toString(16),'exec',o&1,'size',s.toString(16),'addr',base?((base+(o&~1))>>>0).toString(16):'');}
