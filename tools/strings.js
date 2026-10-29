const fs=require('fs');const b=fs.readFileSync(process.argv[2]);const min=+(process.argv[3]||6);
let s=-1;for(let i=0;i<=b.length;i++){const c=b[i];if(c>=0x20&&c<0x7f){if(s<0)s=i}else{if(s>=0&&i-s>=min)console.log(s.toString(16).padStart(8,'0'),b.toString('latin1',s,i));s=-1}}
