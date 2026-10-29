const fs=require('fs'),zlib=require('zlib');const {tplRGB5A3,writePNG}=require('./img.js');
function readPNG(f){const b=fs.readFileSync(f);let p=8,w,h,ct;const id=[];while(p<b.length){const l=b.readUInt32BE(p),t=b.toString('latin1',p+4,p+8);if(t==='IHDR'){w=b.readUInt32BE(p+8);h=b.readUInt32BE(p+12);ct=b[p+17]}if(t==='IDAT')id.push(b.subarray(p+8,p+8+l));p+=12+l}
 const bpp=ct===6?4:3,raw=zlib.inflateSync(Buffer.concat(id)),stride=w*bpp,out=new Uint8ClampedArray(w*h*4);let prev=Buffer.alloc(stride);
 for(let y=0;y<h;y++){const f=raw[y*(stride+1)],line=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
  for(let i=0;i<stride;i++){const a=i>=bpp?line[i-bpp]:0,b2=prev[i],c=i>=bpp?prev[i-bpp]:0;let v=line[i];
   if(f===1)v+=a;else if(f===2)v+=b2;else if(f===3)v+=(a+b2)>>1;else if(f===4){const pp=a+b2-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b2),pc=Math.abs(pp-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b2:c}line[i]=v&255}
  for(let x=0;x<w;x++){for(let c=0;c<3;c++)out[(y*w+x)*4+c]=line[x*bpp+c];out[(y*w+x)*4+3]=bpp===4?line[x*bpp+3]:255}prev=line}
 return {w,h,px:out}}
const alpha=readPNG('ai/alpha_src_realesrgan-x4plus-anime.png');
const hashes=require(process.env.TEMP+'/chan_hashes.json');
for(const f of ['tt_mariokart_channel_top_menu_image_ranking','tt_mariokart_channel_top_menu_image_event']){
 const rgb=readPNG('ai/'+f+'_rgb_realesrgan-x4plus-anime.png');const img={w:rgb.w,h:rgb.h,px:new Uint8ClampedArray(rgb.px)};
 for(let i=0;i<img.px.length;i+=4){let a=alpha.px[i];a=a>245?255:a<10?0:a;img.px[i+3]=a}
 const t=hashes.find(h=>h.p.endsWith('button/timg/'+f+'.tpl'));fs.mkdirSync('hd_icons',{recursive:true});writePNG('hd_icons/'+t.name+'.png',img);
 // check: box-downsample vs original
 const src=tplRGB5A3(fs.readFileSync(process.env.TEMP+'/szs/Channel/button/timg/'+f+'.tpl'));const S=img.w/src.w;let sum=0,n=0,sa=0;
 for(let y=0;y<src.h;y++)for(let x=0;x<src.w;x++){const acc=[0,0,0,0];for(let j=0;j<S;j++)for(let i=0;i<S;i++){const k=((y*S+j)*img.w+x*S+i)*4,a=img.px[k+3];acc[0]+=img.px[k]*a;acc[1]+=img.px[k+1]*a;acc[2]+=img.px[k+2]*a;acc[3]+=a}
  const k=(y*src.w+x)*4,a=acc[3]/(S*S);sa+=Math.abs(a-src.px[k+3]);if(src.px[k+3]>128&&a>128){for(let c=0;c<3;c++){sum+=Math.abs(acc[c]/acc[3]-src.px[k+c]);n++}}}
 console.log(f,'->',t.name+'.png',img.w+'x'+img.h,'mean colour error',(sum/n).toFixed(2),'mean alpha error',(sa/(src.w*src.h)).toFixed(2))}
