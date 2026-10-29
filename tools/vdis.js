const V=require('./vanilla.js');const {decode}=require('./ppc.js');const fs=require('fs'),path=require('path');
const names=new Map(fs.readFileSync(path.join(process.env.APPDATA,'CT-MKWII/Recomp/Install/BuildWorkspace/projects/mkwii/MAP.txt'),'latin1').split('\n').filter(Boolean).map(l=>{const i=l.indexOf(' ');return [parseInt(l.slice(0,i),16),l.slice(i+1).trim()]}));
const a0=parseInt(process.argv[2]),n=+(process.argv[3]||16);
for(let a=a0;a<a0+n*4;a+=4){const w=V.read32(a);const d=decode(w,a);if(names.has(a))console.log('  <'+names.get(a)+'>');console.log('0x'+a.toString(16),w.toString(16).padStart(8,'0'),d.text+(d.target?'  ; '+(names.get(d.target)||''):''))}
