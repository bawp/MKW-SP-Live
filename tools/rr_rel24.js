const fs=require('fs');const {parseKamek,NAMES}=require('./kamek.js');
const b=fs.readFileSync(process.argv[2]);const n=b.readUInt32BE(0);const k=parseKamek(b,0x10);const c=k.next(0x10+n);
const map=new Set(fs.readFileSync(process.argv[3],'latin1').split('\n').map(l=>parseInt(l.split(' ')[0],16)).filter(x=>x));
let abs=0,mid=0;const ex=[];
for(const x of c){if(x.t===10&&!x.abs&&(x.args[0]&0x80000000)){abs++;if(!map.has(x.args[0])){mid++;if(ex.length<15)ex.push(x.args[0].toString(16)+' from code+'+x.a.toString(16))}}}
console.log('Rel24 to game:',abs,'non-function-start targets:',mid);console.log(ex.join('\n'));
const rel=c.filter(x=>x.abs&&(x.t===4||x.t===5||x.t===6));console.log('abs-located Addr16:',rel.length);
console.log('Addr32@abs examples',c.filter(x=>x.abs&&x.t===1).slice(0,5).map(x=>x.a.toString(16)+'->'+x.args[0].toString(16)).join(' '));
console.log('Write32@abs pointing into code?',c.filter(x=>x.abs&&x.t===32&&(x.args[0]>>>24)===0x48).length);
