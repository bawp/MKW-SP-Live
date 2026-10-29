const C=require('./common.js');const {decode}=require('./ppc.js');
const a0=parseInt(process.argv[2]),n=+(process.argv[3]||32);
for(let a=a0;a<a0+n*4;a+=4){const w=C.u32(a);const d=decode(w,a);const s=C.byAddr.get(a);if(s)console.log('  <'+s.join('|').slice(0,90)+'>');let t=d.text;if(d.target)t+='  ; '+C.seg(d.target)+' '+C.symAt(d.target).slice(0,70);console.log(C.hex(a),w.toString(16).padStart(8,'0'),t)}
