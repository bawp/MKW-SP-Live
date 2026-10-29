const fs=require('fs');const f=process.argv[2];let s=fs.readFileSync(f,'utf8');const BS=String.fromCharCode(92);
s=s.replace(/^(nand_root|dvd_root) = '(.*)'$/mg,(m,k,v)=>k+' = "'+v.split(BS).join(BS+BS)+'"');fs.writeFileSync(f,s);console.log(s.split('\n').slice(2,6).join('\n'));
