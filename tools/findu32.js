const fs=require('fs');const b=fs.readFileSync(process.argv[2]);
for(const h of process.argv.slice(3)){const v=parseInt(h);const r=[];for(let i=0;i+4<=b.length;i+=4)if(b.readUInt32BE(i)===v)r.push('0x'+i.toString(16));console.log(h,r.length,r.slice(0,20).join(' '));}
