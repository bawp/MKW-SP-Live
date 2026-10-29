// both icons: variant g + unsharp mask (amount k, radius ~1.2 px), joined with the alpha mask
const fs=require('fs'),zlib=require('zlib');const {writePNG}=require('./img.js');
eval(fs.readFileSync('combine.js','utf8').split('const alpha=')[0].replace(/^.*?function readPNG/s,'function readPNG'));
const k=+process.argv[2];const alpha=readPNG('ai/alpha_src_realesrgan-x4plus-anime.png');
function unsharp(im,amount){const w=im.w,h=im.h,g=[0.25,0.5,0.25];const blur=new Float32Array(w*h*3),tmp=new Float32Array(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){let s=0;for(let d=-1;d<=1;d++){const xx=Math.min(w-1,Math.max(0,x+d));s+=g[d+1]*im.px[(y*w+xx)*4+c]}tmp[(y*w+x)*3+c]=s}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){let s=0;for(let d=-1;d<=1;d++){const yy=Math.min(h-1,Math.max(0,y+d));s+=g[d+1]*tmp[(yy*w+x)*3+c]}blur[(y*w+x)*3+c]=s}
 const o={w,h,px:new Uint8ClampedArray(im.px)};for(let i=0;i<w*h;i++)for(let c=0;c<3;c++)o.px[i*4+c]=im.px[i*4+c]+amount*(im.px[i*4+c]-blur[i*3+c]);return o}
const out={};
for(const [f,hash] of [['ranking','c972902bee098677'],['event','c23890c6fd61b704']]){
 const rgb=unsharp(readPNG('variants/tt_mariokart_channel_top_menu_image_'+f+'_g_blend_restore.png'),k);
 for(let i=0;i<rgb.px.length;i+=4){const a=alpha.px[i];rgb.px[i+3]=a>245?255:a<10?0:a}
 writePNG('hd_icons/tex1_220x56_'+hash+'_5.png',rgb);out[f]=rgb}
// side-by-side preview over the button's dark blue, both banners stacked
const W=out.ranking.w,H=out.ranking.h,p={w:W,h:H*2+6,px:new Uint8ClampedArray(W*(H*2+6)*4)};
['ranking','event'].forEach((f,n)=>{const im=out[f];for(let i=0;i<W*H;i++){const al=im.px[i*4+3]/255,bg=[30,30,80];const o=((Math.floor(i/W)+n*(H+6))*W+i%W)*4;for(let c=0;c<3;c++)p.px[o+c]=im.px[i*4+c]*al+bg[c]*(1-al);p.px[o+3]=255}});
writePNG('pair_preview.png',p);console.log('ok');
