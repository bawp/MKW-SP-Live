// variants of the Esports / Rankings icons with the original's detail added back
const zlib=require('zlib');
const fs=require('fs');const {tplRGB5A3,writePNG}=require('./img.js');
eval(fs.readFileSync('combine.js','utf8').split('const alpha=')[0].replace(/^.*?function readPNG/s,'function readPNG'));
const cr=u=>{u=Math.abs(u);return u<1?1.5*u**3-2.5*u**2+1:u<2?-0.5*u**3+2.5*u**2-4*u+2:0};
// bicubic upsample of a float RGB image (w,h) by S
function up(src,w,h,S){const W=w*S,H=h*S,o=new Float32Array(W*H*3);for(let Y=0;Y<H;Y++)for(let X=0;X<W;X++){const x=(X+0.5)/S-0.5,y=(Y+0.5)/S-0.5,x0=Math.floor(x),y0=Math.floor(y);const acc=[0,0,0];
 for(let j=-1;j<=2;j++)for(let i=-1;i<=2;i++){const wgt=cr(x-x0-i)*cr(y-y0-j);if(!wgt)continue;const xx=Math.min(w-1,Math.max(0,x0+i)),yy=Math.min(h-1,Math.max(0,y0+j));for(let c=0;c<3;c++)acc[c]+=wgt*src[(yy*w+xx)*3+c]}o.set(acc,(Y*W+X)*3)}return o}
// HD + upsampled (original - boxdown(HD)), strength k
function restore(hd,orig,k){const S=hd.w/orig.w,w=orig.w,h=orig.h,res=new Float32Array(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const acc=[0,0,0];for(let j=0;j<S;j++)for(let i=0;i<S;i++){const q=((y*S+j)*hd.w+x*S+i)*4;for(let c=0;c<3;c++)acc[c]+=hd.px[q+c]}for(let c=0;c<3;c++)res[(y*w+x)*3+c]=orig.px[(y*w+x)*4+c]-acc[c]/(S*S)}
 const u=up(res,w,h,S);const out={w:hd.w,h:hd.h,px:new Uint8ClampedArray(hd.px)};for(let i=0;i<hd.w*hd.h;i++)for(let c=0;c<3;c++)out.px[i*4+c]=hd.px[i*4+c]+k*u[i*3+c];return out}
const name=process.argv[2],orig=tplRGB5A3(fs.readFileSync(process.env.TEMP+'/szs/Channel/button/timg/'+name+'.tpl'));
const variants={
 a_anime_restore:restore(readPNG('ai/'+name+'_rgb_realesrgan-x4plus-anime.png'),orig,1),
 b_animevideo:readPNG('ai/'+name+'_rgb_realesr-animevideov3.png'),
 c_general_restore:restore(readPNG('ai/'+name+'_rgb_realesrgan-x4plus.png'),orig,1),
 d_animevideo_restore:restore(readPNG('ai/'+name+'_rgb_realesr-animevideov3.png'),orig,1),
 z_anime_current:readPNG('ai/'+name+'_rgb_realesrgan-x4plus-anime.png')};
fs.mkdirSync('variants',{recursive:true});for(const [k,v] of Object.entries(variants))writePNG('variants/'+name+'_'+k+'.png',v);
// crop sheet of the leaves (left half), each variant labelled by order
const [cx,cy,cw,ch]=process.argv.slice(3).map(Number);const keys=Object.keys(variants);const out={w:cw*keys.length+6*(keys.length-1),h:ch,px:new Uint8ClampedArray((cw*keys.length+6*(keys.length-1))*ch*4)};
keys.forEach((k,n)=>{const v=variants[k];for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const s=((cy+y)*v.w+cx+x)*4,o=(y*out.w+n*(cw+6)+x)*4;out.px.set([v.px[s],v.px[s+1],v.px[s+2],255],o)}});
writePNG('variants/'+name+'_crop.png',out);console.log(keys.join(' | '));
// extra blends
{const A2=restore(readPNG('ai/'+name+'_rgb_realesrgan-x4plus-anime.png'),orig,1.6);writePNG('variants/'+name+'_e_anime_restore16.png',A2);
 const a=variants.a_anime_restore,c=variants.c_general_restore;const m={w:a.w,h:a.h,px:new Uint8ClampedArray(a.px.length)};for(let i=0;i<a.px.length;i++)m.px[i]=(a.px[i]+c.px[i])/2;writePNG('variants/'+name+'_f_blend.png',m);
 const m2=restore(m,orig,1);writePNG('variants/'+name+'_g_blend_restore.png',m2);}
