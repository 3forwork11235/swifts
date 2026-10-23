const SW=require('./load.js');
const mi=+process.argv[2]||2,diff=process.argv[3]||null,wing=+process.argv[4]||0,seedAdd=+process.argv[5]||5;
const M=SW.MISSIONS[mi];
const A=new SW.Arena({map:M.map,seed:M.seed,mode:'run',opts:{mission:mi,diff:diff||M.diff,assist:1,wing},simSeed:seedAdd});
const d=A.addDrone({id:1,slot:'P0',kind:'human',team:0,hull:'swift',mods:['armor','flares'],name:'Тест'});
d.ctl='ai';SW.AI.attach(A,d);d.ai.style='fighter';d.ai.hunter=true;
A.begin();const dir=A.dir;const dt=SW.TICK;
const how={},HOW=['пушка','лазер','ракета','ЗРК','столкн.','таран','зона','зенитка','проч'];
while(A.phase!=='end'&&A.t<600){
  if(dir.rings&&dir.ri<dir.rings.length){const r=dir.rings[dir.ri];d.ai.goal={x:r.x,y:r.y,z:r.z}}
  A.step(dt);
  for(const e of A.events){if(e[0]==='k'&&e[2]===1){how[HOW[e[3]]]=(how[HOW[e[3]]]||0)+1;console.log(`t=${A.t.toFixed(0)} died by ${HOW[e[3]]} killer=${e[1]} foes=${dir.foesAlive()}`)}}
  A.events.length=0;
}
const res=A.result||dir.summary();
console.log(res.win?'WIN':'LOSS',A.t.toFixed(0)+'s','deaths by',JSON.stringify(how),'my kills',d.st.k,'dmg dealt',Math.round(d.st.dmg),'shots',d.st.shots,'hits',d.st.hit);
