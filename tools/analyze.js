// Recover relocations for the absolutely-linked MKW-SP payload.
const C=require('./common.js');const {decode,sx16}=require('./ppc.js');
const CODE_END=0x807FBC74; // ctors+patch/command tables follow
const N=(CODE_END-C.P0)/4;const ins=new Array(N);
const DATA_RANGES=[[0x807e59c4,0x807e59f0]]; // inline string after 'bl endStr'
const isData=a=>DATA_RANGES.some(([s,e])=>a>=s&&a<e);
for(let i=0;i<N;i++){const a=C.P0+i*4;ins[i]=isData(a)?{kind:'data',w:C.u32(a),text:'.data',defs:[],uses:[]}:decode(C.u32(a),a)}
const idx=a=>(a-C.P0)/4;
// function entries: SMAP symbols inside code + bl targets
const entry=new Uint8Array(N);
for(const s of C.smap)if(s.a>=C.P0&&s.a<CODE_END&&!(s.a&3))entry[idx(s.a)]=1;
for(let i=0;i<N;i++){const d=ins[i];if(d.kind==='b'&&d.lk&&d.target>=C.P0&&d.target<CODE_END)entry[idx(d.target)]=1}
// successors
function succ(i){const d=ins[i],a=C.P0+i*4,r=[];const inCode=t=>t>=C.P0&&t<CODE_END;
  if(d.kind==='b'){if(d.lk){r.push(i+1)}else if(inCode(d.target)&&!entry[idx(d.target)])r.push(idx(d.target));return r}
  if(d.kind==='bc'){if(inCode(d.target))r.push(idx(d.target));if(!d.uncond)r.push(i+1);return r}
  if(d.kind==='bclr'||d.kind==='bcctr'){if(d.lk||!d.uncond)r.push(i+1);return r}
  if(d.kind==='data'||(d.text&&d.text.startsWith('.word')))return r;
  r.push(i+1);return r}
// state: per reg either undefined (unknown) or {hi:value<<16, src:index of lis, full?:bool}
const IN=new Array(N).fill(null);const work=[];
const UNK=null;
function merge(a,b){if(!a)return b.slice();let ch=false;for(let r=0;r<32;r++){const x=a[r],y=b[r];if(x===undefined)continue;if(!y||x.v!==y.v||x.src!==y.src||x.full!==y.full){a[r]=undefined;ch=true}}return ch?a:null}
for(let i=0;i<N;i++)if(entry[i]){IN[i]=new Array(32).fill(undefined);work.push(i)}
const visitedIn=new Uint8Array(N);
function transfer(i,st){const d=ins[i];const s=st.slice();
  if(d.kind==='addis'&&d.rA===0)s[d.rD]={v:(d.imm<<16)>>>0,src:i,full:false};
  else if(d.kind==='addi'&&d.rA&&s[d.rA]&&!s[d.rA].full)s[d.rD]={v:(s[d.rA].v+d.simm)>>>0,src:s[d.rA].src,lo:i,full:true};
  else if(d.kind==='ori'&&s[d.rD]&&!s[d.rD].full&&d.w!==0x60000000)s[d.rA]={v:(s[d.rD].v|d.imm)>>>0,src:s[d.rD].src,lo:i,full:true,ori:true};
  else if(d.mr&&s[d.rD])s[d.rA]=s[d.rD];
  else for(const r of d.defs)s[r]=undefined;
  if(d.kind==='addi'&&d.rA&&!(s[d.rA]&&!s[d.rA].full)&&d.defs)/* handled above */;
  return s}
const users=[];// {lo:i, hi:src, v}
const seenUse=new Set();
let iter=0;
function run(){
while(work.length){const i=work.pop();if(++iter>5e7)throw new Error('no converge');let st=IN[i];
  let cur=i;let s=st;
  while(true){const d=ins[cur];
    // record uses before transfer
    if((d.kind==='mem'||d.kind==='psq')&&d.base&&s[d.base]&&!s[d.base].full){const key=cur+':'+s[d.base].src;if(!seenUse.has(key)){seenUse.add(key);users.push({lo:cur,hi:s[d.base].src,v:(s[d.base].v+(d.kind==='psq'?sx16(d.w&0xfff)<<20>>20:d.simm))>>>0,kind:d.kind})}}
    if(d.kind==='addi'&&d.rA&&s[d.rA]&&!s[d.rA].full){const key=cur+':'+s[d.rA].src;if(!seenUse.has(key)){seenUse.add(key);users.push({lo:cur,hi:s[d.rA].src,v:(s[d.rA].v+d.simm)>>>0,kind:'addi'})}}
    if(d.kind==='ori'&&s[d.rD]&&!s[d.rD].full&&d.w!==0x60000000){const key=cur+':'+s[d.rD].src;if(!seenUse.has(key)){seenUse.add(key);users.push({lo:cur,hi:s[d.rD].src,v:(s[d.rD].v|d.imm)>>>0,kind:'ori'})}}
    const ns=transfer(cur,s);const sc=succ(cur);
    if(sc.length===1&&sc[0]===cur+1&&sc[0]<N&&!entry[sc[0]]&&IN[sc[0]]===null&&!visitedIn[sc[0]]){visitedIn[sc[0]]=1;IN[sc[0]]=ns;cur=sc[0];s=ns;continue}
    for(const t of sc){if(t>=N||entry[t])continue;if(IN[t]===null){IN[t]=ns.slice();work.push(t)}else{const m=merge(IN[t],ns);if(m){IN[t]=m;work.push(t)}}}
    break}}
}
run();for(let i=0;i<N;i++){if(IN[i]===null&&ins[i].kind!=='data'){IN[i]=new Array(32).fill(undefined);work.push(i);run()}}
// lis that were never consumed
module.exports={ins,users,entry,CODE_END,idx,isData};
if(require.main===module){
  const bySeg={};for(const u of users){const k=u.kind+':'+C.seg(u.v);bySeg[k]=(bySeg[k]||0)+1}console.log('users',users.length,bySeg);
  // per lis: segments it feeds
  const per=new Map();for(const u of users){if(!per.has(u.hi))per.set(u.hi,new Set());per.get(u.hi).add(C.seg(u.v))}
  let mixed=0;for(const [h,s] of per)if(s.size>1){mixed++;if(mixed<10)console.log('mixed lis',C.hex(C.P0+h*4),[...s])}console.log('mixed',mixed);
  let lisTotal=0,lisUsed=per.size,unused=[];for(let i=0;i<N;i++){const d=ins[i];if(d.kind==='addis'&&d.rA===0){lisTotal++;if(!per.has(i)){const hi=d.imm<<16>>>0;const sg=C.seg(hi);if(sg!=='other'&&sg!=='dol'||(d.imm>=0x8039&&d.imm<=0x808d))unused.push(i)}}}
  console.log('lis total',lisTotal,'with users',lisUsed,'suspicious unused',unused.length);unused.slice(0,25).forEach(i=>console.log('  ',C.hex(C.P0+i*4),ins[i].text,C.symAt(C.P0+i*4).slice(0,60)));
  let ext={};for(let i=0;i<N;i++){const d=ins[i];if(d.kind==='b'){const sg=C.seg(d.target);if(sg!=='pay'){const k=(d.lk?'bl':'b')+':'+sg+(d.aa?':AA':'');ext[k]=(ext[k]||0)+1}}if(d.kind==='bc'&&C.seg(d.target)!=='pay')ext['bc:'+C.seg(d.target)]=(ext['bc:'+C.seg(d.target)]||0)+1}console.log('external branches',ext);
}
