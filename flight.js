// «Стрижи» — модель полёта. Одна функция step() двигает дрон; её вызывают и комната (для всех дронов),
// и страница игрока (чтобы свой дрон отзывался без задержки сети). Поэтому внутри — только чистая математика:
// никаких случайных чисел и обращений ко времени, результат зависит лишь от состояния, ввода и шага dt.
//
// Дрон всё время летит вперёд (как самолёт), игрок управляет курсом, тангажом и скоростью:
//   inp.yaw   −1..1  стик вправо = поворот вправо
//   inp.pitch −1..1  стик вверх = нос вверх
//   inp.thr   −1..1  −1 тормоз, +1 форсаж (тратит энергию)
//   inp.level 0/1    автовыравнивание: без ввода по тангажу нос сам возвращается к горизонту
(function(root){
'use strict';
const SW=root.SW;
const {clamp,wrap}=SW;
const PMAX=1.3;            // предельный тангаж, рад (≈75°)
const BOUND=100;           // за краем карты — невидимая стена
const HIT={nx:0,ny:1,nz:0,depth:0};

const Flight={
  PMAX,
  // начальное состояние дрона в точке (x,y,z) с курсом yaw
  init(d,H,x,y,z,yaw){
    d.x=x;d.y=y;d.z=z;d.yaw=yaw;d.pitch=0;d.roll=0;d.spd=H.spd;d.yawV=0;d.pitchV=0;
    d.energy=H.energy;d.boost=false;d.regenT=0;
  },
  // Один шаг полёта. Возвращает силу удара (м/с), если дрон врезался в здание или землю, иначе 0.
  step(d,inp,dt,world,H){
    const k=Math.min(1,dt/H.resp);
    const iy=clamp(inp.yaw||0,-1,1),ip=clamp(inp.pitch||0,-1,1),it=clamp(inp.thr||0,-1,1);
    d.yawV+=(-iy*H.yaw-d.yawV)*k;
    d.pitchV+=(ip*H.pitch-d.pitchV)*k;
    d.yaw=wrap(d.yaw+d.yawV*dt);
    let p=d.pitch+d.pitchV*dt;
    if(inp.level&&Math.abs(ip)<.06)p-=p*Math.min(1,H.level*dt);
    d.pitch=clamp(p,-PMAX,PMAX);
    // крен «в поворот» — только для красоты (на движение не влияет)
    d.roll+=(clamp(d.yawV/H.yaw,-1,1)*.9-d.roll)*Math.min(1,dt*7);
    // скорость: форсаж тратит энергию, тормоз замедляет; набор высоты тормозит, пикирование разгоняет
    const wantBoost=it>.3&&d.energy>4;
    d.boost=wantBoost;
    if(wantBoost){d.energy=Math.max(0,d.energy-H.boostCost*dt);d.regenT=.6}
    else if(d.regenT>0)d.regenT-=dt;
    else d.energy=Math.min(H.energy,d.energy+H.regen*dt);
    const tgt=H.spd*(wantBoost?H.boost:it<-.3?H.brake:1)*(1-.3*Math.sin(d.pitch));
    const dv=tgt-d.spd;
    d.spd+=dv>0?Math.min(dv,H.accel*dt):Math.max(dv,-H.decel*dt);
    // перемещение
    const cp=Math.cos(d.pitch),fx=-Math.sin(d.yaw)*cp,fy=Math.sin(d.pitch),fz=-Math.cos(d.yaw)*cp,s=d.spd*dt;
    d.x+=fx*s;d.y+=fy*s;d.z+=fz*s;
    let impact=0;
    if(world){
      const lim=world.half+BOUND;
      d.x=clamp(d.x,-lim,lim);d.z=clamp(d.z,-lim,lim);
      if(d.y>world.ceil){d.y=world.ceil;if(d.pitch>0)d.pitch*=.5}
      if(world.hitSphere(d.x,d.y,d.z,H.r,HIT)){
        d.x+=HIT.nx*HIT.depth;d.y+=HIT.ny*HIT.depth;d.z+=HIT.nz*HIT.depth;
        const vn=(fx*HIT.nx+fy*HIT.ny+fz*HIT.nz)*d.spd; // скорость «в стену»
        if(vn<0){
          impact=-vn;
          // отскок: гасим часть скорости и разворачиваем нос вдоль стены
          const e=1.35;
          const vx=fx*d.spd-e*vn*HIT.nx,vy=fy*d.spd-e*vn*HIT.ny,vz=fz*d.spd-e*vn*HIT.nz,vl=Math.hypot(vx,vy,vz);
          if(vl>1e-3){
            d.yaw=Math.atan2(-vx,-vz);
            d.pitch=clamp(Math.atan2(vy,Math.hypot(vx,vz)),-PMAX,PMAX);
            d.spd=Math.max(H.spd*.5,vl*.8);
            d.yawV=0;d.pitchV=0;
          }
        }
      }
    }
    return impact;
  },
  // точка у носа дрона, откуда вылетают снаряды (side −1/+1 — левая/правая пушка)
  muzzle(d,side,out){
    out=out||[0,0,0];
    const cp=Math.cos(d.pitch),sy=Math.sin(d.yaw),cy=Math.cos(d.yaw),sp=Math.sin(d.pitch);
    const fx=-sy*cp,fy=sp,fz=-cy*cp,rx=cy,rz=-sy;
    out[0]=d.x+fx*3.2+rx*side*.9;out[1]=d.y+fy*3.2-.25;out[2]=d.z+fz*3.2+rz*side*.9;
    return out;
  },
};
SW.Flight=Flight;
})(typeof window!=='undefined'?window:globalThis);
