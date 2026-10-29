const C=require('./common.js');const A=require('./analyze.js');const fs=require('fs'),path=require('path');
const map=new Set(fs.readFileSync(path.join(process.env.APPDATA,'CT-MKWII/Recomp/Install/BuildWorkspace/projects/mkwii/MAP.txt'),'latin1').split('\n').map(l=>parseInt(l.split(' ')[0],16)).filter(x=>x));
const st={};const miss=[];
A.ins.forEach((d,i)=>{if(d.kind==='b'&&d.lk){const sg=C.seg(d.target);if(sg==='pay')return;const m=C.mapAddr(d.target);const k=sg+':'+(map.has(m)?'hit':'miss');st[k]=(st[k]||0)+1;if(!map.has(m)&&miss.length<10)miss.push(C.hex(d.target)+'->'+C.hex(m)+' '+C.symAt(d.target).slice(0,50))}});
console.log(st);console.log(miss.join('\n'));
