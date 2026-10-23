const SW=require('./load.js');
let fail=0;const ok=(c,m)=>{if(!c){console.log('FAIL',m);fail++}};
const H=SW.effective('swift');const dt=SW.TICK;
const w=new SW.World('port',3);
// 1. прямо 3 секунды
let d={};SW.Flight.init(d,H,200,250,200,0);
for(let i=0;i<90;i++)SW.Flight.step(d,{yaw:0,pitch:0,thr:0},dt,w,H);
ok(Math.abs(d.z-200+H.spd*3)<1,'straight dist z='+d.z+' want '+(200-H.spd*3));
ok(Math.abs(d.x-200)<1e-6,'no sideways');
// 2. стик вправо: курс уменьшается, смещение в +x (при курсе −Z право = +X)
SW.Flight.init(d,H,200,250,200,0);
for(let i=0;i<45;i++)SW.Flight.step(d,{yaw:1,pitch:0,thr:0},dt,w,H);
ok(d.yaw<-1,'yaw right '+d.yaw);ok(d.x>210,'moved to +x '+d.x);ok(d.roll<0,'bank right (roll<0): '+d.roll);
// 3. радиус виража ≈ v/ω
SW.Flight.init(d,H,200,250,200,0);let t=0;const ps=[];
for(let i=0;i<150;i++){SW.Flight.step(d,{yaw:-1,pitch:0,thr:0},dt,w,H);ps.push([d.x,d.z])}
const xs=ps.map(p=>p[0]),zs=ps.map(p=>p[1]);const R=(Math.max(...xs)-Math.min(...xs))/2;
console.log('turn diameter/2 ≈',R.toFixed(1),'theory',(H.spd/H.yaw).toFixed(1));
ok(R>15&&R<35,'turn radius '+R);
// 4. тангаж вверх, форсаж/энергия
SW.Flight.init(d,H,200,100,200,0);
for(let i=0;i<60;i++)SW.Flight.step(d,{yaw:0,pitch:1,thr:1},dt,w,H);
ok(d.y>150,'climb '+d.y);ok(d.energy<H.energy,'boost spent energy '+d.energy);
console.log('boost speed',d.spd.toFixed(1),'pitch',d.pitch.toFixed(2));
// 5. земля: пикирование в землю → отскок, y>=r
SW.Flight.init(d,H,200,60,200,0);d.pitch=-1.0;let imp=0;
for(let i=0;i<120;i++){imp=Math.max(imp,SW.Flight.step(d,{yaw:0,pitch:0,thr:0},dt,w,H));ok(d.y>=H.r-1e-6,'above ground '+d.y)}
console.log('ground impact',imp.toFixed(1));ok(imp>10,'impact reported');
// 6. здание: летим в центральный шпиль
const c=new SW.World('city',3);SW.Flight.init(d,H,0,150,300,0);let hit=0;
for(let i=0;i<300&&!hit;i++)hit=SW.Flight.step(d,{yaw:0,pitch:0,thr:0},dt,c,H);
console.log('hit building at z=',d.z.toFixed(1),'impact',hit.toFixed(1),'new yaw',d.yaw.toFixed(2),'spd',d.spd.toFixed(1));
ok(hit>5,'building hit');
// 7. детерминизм: два одинаковых прогона
function run(){const q={};SW.Flight.init(q,H,10,150,50,1);for(let i=0;i<500;i++)SW.Flight.step(q,{yaw:Math.sin(i/20),pitch:Math.cos(i/33)*.5,thr:i%97<20?1:0,level:1},dt,c,H);return [q.x,q.y,q.z,q.yaw,q.pitch,q.spd]}
const a=run(),b=run();ok(a.every((v,i)=>v===b[i]),'deterministic');
console.log(fail?'FAILED '+fail:'flight OK');process.exit(fail?1:0);
