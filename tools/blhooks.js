// bl-entered hooks whose trampoline can leave by branching into game code (not returning).
const C=require('./common.js');const P=require('./patches.js');const {decode}=require('./ppc.js');
const out=[];
for(const e of P){const [t,dst,src,x]=e.w;if(t!==1||!((x>>>24)&1)||C.seg(src)!=='pay')continue;
  const exits=[];let calls=0,len=0;
  for(let a=src;a<src+4*64;a+=4){const d=decode(C.u32(a),a);len++;
    if(d.kind==='b'&&!d.lk){exits.push(C.seg(d.target)==='pay'?'b-internal '+C.hex(d.target):'b-game '+C.hex(C.mapAddr(d.target))+(d.target===dst+4?' (=hook+4)':''));break}
    if(d.kind==='b'&&d.lk)calls++;
    if(d.kind==='bc'&&C.seg(d.target)!=='pay')exits.push('bc-game');
    if(d.kind==='bclr'){exits.push(d.uncond?'blr':'cond-blr');if(d.uncond)break}
    if(d.kind==='bcctr'&&!d.lk){exits.push('bctr');break}}
  if(exits.some(x=>x.startsWith('b-game')&&!x.includes('hook+4')))out.push({name:C.symAt(dst),src:C.hex(src),exits,calls,len});}
console.log(out.length);for(const o of out)console.log(o.src,o.name.slice(0,50).padEnd(50),o.exits.join(', '),'calls',o.calls,'len',o.len);
module.exports=out;
