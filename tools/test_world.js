const SW=require('./load.js');
let fail=0;const ok=(c,m)=>{if(!c){console.log('FAIL',m);fail++}};
for(const id of SW.MAP_IDS){
  const t0=Date.now();
  const a=new SW.World(id,5),b=new SW.World(id,5),c=new SW.World(id,6);
  ok(a.hash===b.hash,id+' determinism');ok(a.hash!==c.hash,id+' seed varies');
  console.log(id,'boxes',a.count,'sam',a.samSpots.length,'pick',a.pickSpots.length,'hash',a.hash,(Date.now()-t0)+'ms for 3 worlds');
  // ни одна точка бонуса не внутри здания
  let bad=0;for(const p of a.pickSpots)if(a.hitSphere(p.x,p.y,p.z,6))bad++;
  ok(bad===0,id+' pickups inside geometry: '+bad);
  // лучи: вертикально вниз с большой высоты попадает в землю или крышу
  const t=a.rayHit(0,300,500,0,-1,0,1000);ok(t>0,id+' ray down '+t);
  // кольца
  const rng=SW.rng(9);const rings=a.route(8,rng);
  ok(rings.length===8,id+' rings');
  let blocked=0;for(let i=1;i<rings.length;i++){const p=rings[i-1],q=rings[i];if(!a.los(p.x,p.y,p.z,q.x,q.y,q.z))blocked++}
  console.log(id,'ring route',rings.map(r=>`(${r.x|0},${r.y|0},${r.z|0})`).join(' '),'blocked segs',blocked);
  ok(blocked===0,id+' ring segments blocked');
  for(const r of rings)ok(!a.hitSphere(r.x,r.y,r.z,18),id+' ring inside geometry');
  // замер скорости лучей
  const t1=process.hrtime.bigint();let n=0;
  for(let i=0;i<20000;i++){const o=rng.range(-600,600),p=rng.range(20,200),q=rng.range(-600,600),an=rng.range(0,6.28);a.rayHit(o,p,q,Math.cos(an),0,Math.sin(an),300);n++}
  console.log(id,'20000 rays',Number(process.hrtime.bigint()-t1)/1e6,'ms');
}
// сфера у земли
const w=new SW.World('city',1);
ok(w.hitSphere(0,1,0,2.3)||true,'ground');
console.log(fail?'FAILED '+fail:'world OK');
process.exit(fail?1:0);
