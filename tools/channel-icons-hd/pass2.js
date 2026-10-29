const fs=require('fs'),zlib=require('zlib');const {writePNG}=require('./img.js');
eval(fs.readFileSync('combine.js','utf8').split('const alpha=')[0].replace(/^.*?function readPNG/s,'function readPNG'));
const half=im=>{const w=im.w/2,h=im.h/2,o={w,h,px:new Uint8ClampedArray(w*h*4)};for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<4;c++){let s=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++)s+=im.px[((2*y+j)*im.w+2*x+i)*4+c];o.px[(y*w+x)*4+c]=s/4}return o};
const alpha=half(readPNG('pass2/alpha_x4.png'));const res={};
for(const [f,h] of [['ranking','c972902bee098677'],['event','c23890c6fd61b704']]){const im=half(readPNG('pass2/'+f+'_rgb_x4.png'));
 for(let i=0;i<im.px.length;i+=4){const a=alpha.px[i];im.px[i+3]=a>245?255:a<10?0:a}fs.mkdirSync('hd_icons8',{recursive:true});writePNG('hd_icons8/tex1_220x56_'+h+'_5.png',im);res[f]=[im,readPNG('hd_icons/tex1_220x56_'+h+'_5.png')]}
// close-ups: [old 4x enlarged x2 | new 8x] for the 10 and the leaves
const crops=[['ranking',230,120,330,300],['event',120,90,330,300]];const W=330*2+8,H=300;const out={w:W*2+16,h:H,px:new Uint8ClampedArray((W*2+16)*H*4)};
crops.forEach(([f,cx,cy,cw,ch],n)=>{const [nw,old]=res[f];for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const so=(((cy+y)>>1)*old.w+((cx+x)>>1))*4,sn=((cy+y)*nw.w+cx+x)*4;const bx=n*(W+16);
 for(const [s,im,dx] of [[so,old,0],[sn,nw,cw+8]]){const al=im.px[s+3]/255,bg=[30,30,80],o=(y*out.w+bx+dx+x)*4;for(let c=0;c<3;c++)out.px[o+c]=im.px[s+c]*al+bg[c]*(1-al);out.px[o+3]=255}}});
writePNG('pass2_compare.png',out);console.log('ok',res.ranking[0].w+'x'+res.ranking[0].h);
