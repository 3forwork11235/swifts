// Помощь прицела: цель летит прямо впереди и чуть сбоку — без помощи пули идут мимо, с помощью попадают.
const SW=require('./load.js');
let fail=0;const ok=(c,m)=>{if(!c){console.log('FAIL',m);fail++}};
function trial(assist,weapon,lateral){
  const A=new SW.Arena({map:'port',seed:3,mode:'ffa',opts:{assist,time:0,frags:99},simSeed:1});
  const a=A.addDrone({id:1,slot:'P0',kind:'human',team:1,hull:'swift',name:'A'});
  const b=A.addDrone({id:2,slot:'P1',kind:'human',team:2,hull:'bumble',name:'B'});
  A.begin();
  A.respawn(a,{x:200,y:200,z:300,yaw:0,inv:0});A.respawn(b,{x:200+lateral,y:200,z:150,yaw:0,inv:0});
  A.phase='play';b.invT=0;a.invT=0;
  a.weapon=weapon;
  const hp0=b.hp;
  for(let i=0;i<60;i++){ // 2 секунды
    a.in.fire=1;a.inAt=A.t;b.inAt=A.t;
    A.step(SW.TICK);
    // держим дистанцию: обе машины летят прямо с одной скоростью
  }
  return {dmg:hp0-b.hp,dist:Math.hypot(a.x-b.x,a.z-b.z)};
}
for(const lat of [0,6,12]){
  for(const w of [0,1]){
    const r0=trial(0,w,lat),r2=trial(2,w,lat);
    console.log(`смещение ${lat} м, ${w?'лазер':'пушка'}: без помощи урон ${r0.dmg.toFixed(0)}, сильная помощь ${r2.dmg.toFixed(0)} (дистанция ${r2.dist.toFixed(0)} м)`);
    if(lat===0)ok(r0.dmg>0,'прямо по курсу попадания и без помощи');
    if(lat>=6)ok(r2.dmg>=r0.dmg,'помощь не хуже');
  }
}
const r=trial(2,0,6);ok(r.dmg>20,'сильная помощь попадает по цели со смещением 6 м: '+r.dmg);
console.log(fail?'FAILED':'assist OK');process.exit(fail?1:0);
