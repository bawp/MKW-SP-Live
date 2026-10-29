// RGB5A3 TPL decode, PNG read/write (RGBA8), small helpers.
const fs=require('fs'),zlib=require('zlib');
function tplRGB5A3(b){const ih=b.readUInt32BE(b.readUInt32BE(8));const h=b.readUInt16BE(ih),w=b.readUInt16BE(ih+2),f=b.readUInt32BE(ih+4),off=b.readUInt32BE(ih+8);
 if(f!==5)throw new Error('fmt '+f);const px=new Uint8ClampedArray(w*h*4);let p=off;
 for(let by=0;by<h;by+=4)for(let bx=0;bx<w;bx+=4)for(let y=0;y<4;y++)for(let x=0;x<4;x++){const v=b.readUInt16BE(p);p+=2;const X=bx+x,Y=by+y;if(X>=w||Y>=h)continue;const i=(Y*w+X)*4;
  if(v&0x8000){px[i]=((v>>10)&31)*255/31;px[i+1]=((v>>5)&31)*255/31;px[i+2]=(v&31)*255/31;px[i+3]=255}
  else{px[i]=((v>>8)&15)*17;px[i+1]=((v>>4)&15)*17;px[i+2]=(v&15)*17;px[i+3]=((v>>12)&7)*255/7}}
 return {w,h,px}}
const crcT=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c});
const crc=b=>{let c=-1;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return (c^-1)>>>0};
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])}
function writePNG(file,{w,h,px}){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;Buffer.from(px.buffer,px.byteOffset+y*w*4,w*4).copy(raw,y*(w*4+1)+1)}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]))}
module.exports={tplRGB5A3,writePNG};
