// Minimal PowerPC (Gekko) decoder: enough for relocation analysis + readable disassembly.
const sx16=v=>(v&0x8000)?v-0x10000:v;
const DFORM={32:'lwz',33:'lwzu',34:'lbz',35:'lbzu',36:'stw',37:'stwu',38:'stb',39:'stbu',40:'lhz',41:'lhzu',42:'lha',43:'lhau',44:'sth',45:'sthu',46:'lmw',47:'stmw',48:'lfs',49:'lfsu',50:'lfd',51:'lfdu',52:'stfs',53:'stfsu',54:'stfd',55:'stfdu'};
const LOADS=new Set([32,33,34,35,40,41,42,43,46]);const UPD=new Set([33,35,37,39,41,43,45,49,51,53,55]);
function decode(w,pc){
  const op=w>>>26,rD=(w>>>21)&31,rA=(w>>>16)&31,rB=(w>>>11)&31,imm=w&0xffff,simm=sx16(imm);
  const r={op,w,rD,rA,rB,imm,simm,defs:[],uses:[],kind:'other'};
  if(op===18){let d=w&0x3fffffc;if(d&0x2000000)d-=0x4000000;r.kind='b';r.aa=!!(w&2);r.lk=!!(w&1);r.target=(r.aa?d:pc+d)>>>0;r.text=(r.lk?'bl':'b')+(r.aa?'a':'')+' 0x'+r.target.toString(16);if(r.lk)r.defs=[0,3,4,5,6,7,8,9,10,11,12];return r}
  if(op===16){let d=w&0xfffc;if(d&0x8000)d-=0x10000;r.kind='bc';r.aa=!!(w&2);r.lk=!!(w&1);r.bo=rD;r.target=(r.aa?d:pc+d)>>>0;r.uncond=(rD&0x14)===0x14;r.text='bc'+(r.lk?'l':'')+' '+rD+','+rA+',0x'+r.target.toString(16);return r}
  if(op===19){const xo=(w>>>1)&0x3ff;if(xo===16||xo===528){r.kind=xo===16?'bclr':'bcctr';r.lk=!!(w&1);r.bo=rD;r.uncond=(rD&0x14)===0x14;r.text=(xo===16?'blr':'bctr')+(r.lk?'l':'')+(r.uncond?'':' (cond '+rD+','+rA+')');if(r.lk)r.defs=[0,3,4,5,6,7,8,9,10,11,12];return r}r.text='cr/misc op19 xo='+xo;if(xo===150)r.text='isync';return r}
  if(op===15){r.kind='addis';r.defs=[rD];if(rA)r.uses=[rA];r.text=rA?`addis r${rD},r${rA},0x${imm.toString(16)}`:`lis r${rD},0x${imm.toString(16)}`;return r}
  if(op===14){r.kind='addi';r.defs=[rD];if(rA)r.uses=[rA];r.text=rA?`addi r${rD},r${rA},${simm}`:`li r${rD},${simm}`;return r}
  if(op===24||op===25){r.kind=op===24?'ori':'oris';r.defs=[rA];r.uses=[rD];r.text=(op===24?'ori':'oris')+` r${rA},r${rD},0x${imm.toString(16)}`;if(w===0x60000000)r.text='nop';return r}
  if(op===26||op===27||op===28||op===29){r.defs=[rA];r.uses=[rD];r.text=['xori','xoris','andi.','andis.'][op-26]+` r${rA},r${rD},0x${imm.toString(16)}`;return r}
  if(op in DFORM){r.kind='mem';r.name=DFORM[op];r.load=LOADS.has(op);r.fp=op>=48;r.base=rA;r.uses=rA?[rA]:[];
    if(!r.fp&&r.load){if(op===46){for(let i=rD;i<32;i++)r.defs.push(i)}else r.defs.push(rD)} else if(!r.fp&&!r.load){r.uses.push(rD)}
    if(UPD.has(op))r.defs.push(rA);r.text=`${r.name} ${r.fp?'f':'r'}${rD},${simm}(r${rA})`;return r}
  if(op===56||op===57||op===60||op===61){r.kind='psq';r.base=rA;r.uses=[rA];r.text='psq op'+op+` f${rD},${sx16(w&0xfff)}(r${rA})`;if(op===57||op===61)r.defs=[rA];return r}
  if(op===7||op===8||op===12||op===13){r.defs=[rD];r.uses=[rA];r.text=['mulli','subfic','','','addic','addic.'][op===7?0:op===8?1:op-8]+` r${rD},r${rA},${simm}`;return r}
  if(op===10||op===11){r.uses=[rA];r.text=(op===10?'cmplwi':'cmpwi')+` cr${rD>>2},r${rA},${op===10?imm:simm}`;return r}
  if(op===20||op===21||op===23){r.defs=[rA];r.uses=op===20?[rD,rA]:op===23?[rD,rB]:[rD];r.text=['rlwimi','rlwinm','','rlwnm'][op-20]+` r${rA},r${rD},...`;return r}
  if(op===31){const xo=(w>>>1)&0x3ff;r.xo=xo;
    if(xo===339){const spr=((rB<<5)|rA);r.defs=[rD];r.text=`mfspr r${rD},${spr}`;if(spr===8)r.text=`mflr r${rD}`;return r}
    if(xo===467){const spr=((rB<<5)|rA);r.uses=[rD];r.text=`mtspr ${spr},r${rD}`;if(spr===8)r.text=`mtlr r${rD}`;if(spr===9)r.text=`mtctr r${rD}`;return r}
    if(xo===444&&rD===rB){r.defs=[rA];r.uses=[rD];r.text=`mr r${rA},r${rD}`;r.mr=true;return r}
    // stores (X-form): xo in set -> rS used; loads define rD
    const XST=new Set([151,183,215,247,407,439,662,918,150,438]);const XLD=new Set([23,55,87,119,279,311,343,375,534,790,20,310]);
    if(XST.has(xo)){r.uses=[rD,rA,rB].filter(x=>x);r.text='stx xo'+xo;return r}
    if(XLD.has(xo)){r.defs=[rD];r.uses=[rA,rB].filter(x=>x);r.text='ldx xo'+xo;return r}
    if([0,32,1014,86,54,278,470,982,246,758,598,854,512,146,210,242,595,659,535,567,663,695,727,759,983,0].includes(xo)){r.uses=[rA,rB];r.text='op31 xo'+xo;if(xo===535||xo===567||xo===599||xo===631)r.defs=[rA];return r}
    // logical ops (and/or/xor/nor/slw/srw/sraw/srawi/cntlzw/extsb/extsh): define rA
    if([28,60,124,284,316,412,444,476,24,536,792,824,26,922,954].includes(xo)){r.defs=[rA];r.uses=[rD,rB];r.text='logic xo'+xo;return r}
    r.defs=[rD];r.uses=[rA,rB];r.text='op31 xo'+xo;return r}
  if(op===59||op===63||op===4){r.text='fp op'+op;if(op===4){const xo=(w>>>1)&0x3ff;if(xo===1014||(w>>>1&31)===6||(w>>>1&31)===7){r.uses=[rA,rB]}}return r}
  if(op===17){r.kind='sc';r.text='sc';return r}
  r.text='.word 0x'+w.toString(16).padStart(8,'0');return r;
}
module.exports={decode,sx16};
