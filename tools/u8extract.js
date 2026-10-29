// Extract a U8 archive found at a byte offset inside a file.
const fs=require('fs'),path=require('path');
const [,,file,offHex,outDir]=process.argv;const all=fs.readFileSync(file);const base=parseInt(offHex);
const b=all.subarray(base);
if(b.readUInt32BE(0)!==0x55AA382D)throw new Error('not U8');
const root=b.readUInt32BE(4);const n=b.readUInt32BE(root+8);const strTab=root+n*12;
const name=o=>{let e=strTab+o;while(b[e])e++;return b.toString('latin1',strTab+o,e)};
const stack=[[n,outDir]];let maxEnd=0;
for(let i=1;i<n;i++){while(i>=stack[stack.length-1][0])stack.pop();
 const e=root+i*12,t=b[e],no=b.readUIntBE(e+1,3),a=b.readUInt32BE(e+4),c=b.readUInt32BE(e+8);
 const p=path.join(stack[stack.length-1][1],name(no));
 if(t===1){fs.mkdirSync(p,{recursive:true});stack.push([c,p]);}
 else{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b.subarray(a,a+c));maxEnd=Math.max(maxEnd,a+c);console.log(c.toString().padStart(9),path.relative(outDir,p));}}
console.log('archive end in file: 0x'+(base+maxEnd).toString(16));
