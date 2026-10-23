// Каждую миссию проходит ИИ-«человек» (автопилот): проверяем, что сценарий вообще можно выполнить, и считаем показатели.
const SW=require('./load.js');
const only=process.argv[2]!=null?+process.argv[2]:null,maxSec=+process.argv[3]||900;
let fail=0;
for(let mi=0;mi<SW.MISSIONS.length;mi++){
  if(only!=null&&only!==mi)continue;
  const M=SW.MISSIONS[mi];
  const A=new SW.Arena({map:M.map,seed:M.seed,mode:'run',opts:{mission:mi,diff:M.diff,assist:1,wing:2},simSeed:5});
  const d=A.addDrone({id:1,slot:'P0',kind:'human',team:0,hull:'swift',mods:['armor','flares'],name:'Тест'});
  d.ctl='ai';SW.AI.attach(A,d);d.ai.style='fighter';d.ai.hunter=true;
  A.begin();
  const dir=A.dir;let say=0,evs={};const t0=Date.now();
  const dt=SW.TICK;let ticks=0;
  while(A.phase!=='end'&&A.t<maxSec){
    // кольца — цель автопилота
    if(dir.rings&&dir.ri<dir.rings.length){const r=dir.rings[dir.ri];d.ai.goal={x:r.x,y:r.y,z:r.z}}else d.ai.goal=null;
    A.step(dt);ticks++;
    if(ticks%2===0){const s=A.snapshot();for(const e of s.ev||[]){evs[e[0]]=(evs[e[0]]||0)+1;if(e[0]==='say')say++}}
    if(!d.alive&&d.canRe===undefined)d.canRe=true;
  }
  const res=A.result||dir.summary();
  console.log(`#${mi} ${M.title} [${M.map}] ${A.phase==='end'?(res.win?'WIN':'LOSS('+res.why+')'):'TIMEOUT'} sim ${A.t.toFixed(0)}s real ${Date.now()-t0}ms stars ${res.stars} lost ${res.lost} score ${res.score} waves ${res.waves} reward ${res.reward}`);
  console.log('   events',JSON.stringify(evs),'obj',dir.objCur(),'/',dir.objTotal,'lives',dir.lives);
  if(A.phase!=='end'||!res.win){fail++}
}
console.log(fail?'some missions not completed: '+fail:'all missions completed');
