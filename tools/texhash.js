// Hash every TPL texture in game/MKW-SP archives the way Dolphin/aurora name replacements.
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const M=(1n<<64n)-1n,P1=11400714785074694791n,P2=14029467366897019727n,P3=1609587929392839161n,P4=9650029242287828579n,P5=2870177450012600261n;
const rotl=(x,r)=>((x<<BigInt(r))|(x>>BigInt(64-r)))&M;
const round=(a,i)=>rotl((a+i*P2)&M,31)*P1&M;
const merge=(a,v)=>(((a^round(0n,v))*P1)&M)+P4&M;
function xxh64(b){const n=b.length;let p=0,h;
 if(n>=32){let v1=(P1+P2)&M,v2=P2,v3=0n,v4=(-P1)&M;
  while(p+32<=n){v1=round(v1,b.readBigUInt64LE(p));v2=round(v2,b.readBigUInt64LE(p+8));v3=round(v3,b.readBigUInt64LE(p+16));v4=round(v4,b.readBigUInt64LE(p+24));p+=32}
  h=(rotl(v1,1)+rotl(v2,7)+rotl(v3,12)+rotl(v4,18))&M;h=merge(h,v1);h=merge(h,v2);h=merge(h,v3);h=merge(h,v4);}
 else h=P5;
 h=(h+BigInt(n))&M;
 while(p+8<=n){h^=round(0n,b.readBigUInt64LE(p));h=(rotl(h,27)*P1+P4)&M;p+=8}
 if(p+4<=n){h^=(BigInt(b.readUInt32LE(p))*P1)&M;h=(rotl(h,23)*P2+P3)&M;p+=4}
 while(p<n){h^=(BigInt(b[p])*P5)&M;h=rotl(h,11)*P1&M;p++}
 h^=h>>33n;h=h*P2&M;h^=h>>29n;h=h*P3&M;h^=h>>32n;return h}
function yaz0(b){if(b.toString('latin1',0,4)!=='Yaz0')return b;const size=b.readUInt32BE(4),o=Buffer.alloc(size);let s=16,d=0;
 while(d<size){let code=b[s++];for(let i=0;i<8&&d<size;i++,code<<=1){if(code&0x80)o[d++]=b[s++];else{const b1=b[s++],b2=b[s++];const dist=((b1&0xf)<<8|b2)+1;let len=b1>>4;if(!len)len=b[s++]+0x12;else len+=2;for(let k=0;k<len;k++,d++)o[d]=o[d-dist]}}}return o}
function u8(b,cb){if(b.readUInt32BE(0)!==0x55AA382D)return;const root=b.readUInt32BE(4),n=b.readUInt32BE(root+8),st=root+n*12;const name=o=>{let e=st+o;while(b[e])e++;return b.toString('latin1',st+o,e)};
 const stack=[[n,'']];for(let i=1;i<n;i++){while(i>=stack[stack.length-1][0])stack.pop();const e=root+i*12,t=b[e],no=b.readUIntBE(e+1,3),a=b.readUInt32BE(e+4),c=b.readUInt32BE(e+8);const p=stack[stack.length-1][1]+'/'+name(no);if(t===1)stack.push([c,p]);else cb(p,b.subarray(a,a+c))}}
const BPP={0:4,1:8,2:8,3:16,4:16,5:16,6:32,8:4,9:8,10:16,14:4};const BW={0:8,1:8,2:8,3:4,4:4,5:4,6:4,8:8,9:8,10:4,14:8},BH={0:8,1:4,2:4,3:4,4:4,5:4,6:4,8:8,9:4,10:4,14:8};
function tpl(b,cb){if(b.readUInt32BE(0)!==0x0020AF30)return;const cnt=b.readUInt32BE(4),tab=b.readUInt32BE(8);
 for(let i=0;i<cnt;i++){const ih=b.readUInt32BE(tab+i*8),ph=b.readUInt32BE(tab+i*8+4);const h=b.readUInt16BE(ih),w=b.readUInt16BE(ih+2),f=b.readUInt32BE(ih+4),off=b.readUInt32BE(ih+8);
  if(BPP[f]===undefined)continue;const bw=Math.ceil(w/BW[f])*BW[f],bh=Math.ceil(h/BH[f])*BH[f];const size=bw*bh*BPP[f]/8*(f===6?1:1);
  const tlut=(f===8||f===9||f===10)&&ph?(()=>{const n=b.readUInt16BE(ph),po=b.readUInt32BE(ph+8);return xxh64(b.subarray(po,po+n*2))})():null;
  cb({w,h,f,hash:xxh64(b.subarray(off,off+size)),tlut,idx:i})}}
const name=t=>`tex1_${t.w}x${t.h}_${t.hash.toString(16).padStart(16,'0')}${t.tlut!==null?'_'+t.tlut.toString(16).padStart(16,'0'):''}_${t.f}`;
const out=[];
function scanArc(label,buf){u8(buf,(p,data)=>{if(p.endsWith('.tpl'))tpl(data,t=>out.push({label,p,...t,name:name(t)}))})}
for(const f of process.argv.slice(2)){let b=fs.readFileSync(f);if(f.endsWith('.lzma'))b=execFileSync('xz',['--format=lzma','-dc',f],{maxBuffer:1<<28});b=yaz0(b);scanArc(path.basename(f),b)}
fs.writeFileSync('extracted/texhashes.json',JSON.stringify(out.map(o=>({label:o.label,p:o.p,name:o.name,w:o.w,h:o.h,f:o.f})),null,0));
console.log('textures hashed:',out.length);
