// «Стрижи» — бой: мини-пушка, лазер, ракеты, ловушки, урон и взрывы. Дополняет Arena (см. sim.js).
(function(root){
'use strict';
const SW=root.SW;
const A=SW.Arena.prototype;
const {clamp,angDiff}=SW;
const W=SW.W;
const ASSIST=[0,.045,.1];   // «магнит» прицела по уровням помощи, рад
const _f=[0,0,0],_m=[0,0,0],_v=[0,0,0];

// пересечение отрезка (p, направление d, длина L) со сферой (c, R): расстояние вдоль отрезка или −1
function segSphere(px,py,pz,dx,dy,dz,L,cx,cy,cz,R){
  const mx=px-cx,my=py-cy,mz=pz-cz,b=mx*dx+my*dy+mz*dz,c=mx*mx+my*my+mz*mz-R*R;
  if(c>0&&b>0)return -1;
  const disc=b*b-c;if(disc<0)return -1;
  let t=-b-Math.sqrt(disc);if(t<0)t=0;
  return t<=L?t:-1;
}
SW.segSphere=segSphere;

// ---------- урон и гибель ----------
A.damage=function(v,amt,by,how,x,y,z,quiet){
  if(!v.alive||amt<=0||this.phase!=='play')return 0;
  if(v.invul)return 0; // цель под защитой (например, Сердце СТРАЖа, пока стоят пилоны)
  if(v.isDrone){
    if(v.invT>0)return 0;
    if(v.shield>0){const a=Math.min(v.shield,amt);v.shield-=a;amt-=a;if(v.shield<=0)v.shieldT=0;if(amt<=0)return 0}
    v.lastBy=by;v.lastT=this.t;v.lastHow=how;
  }
  v.hp-=amt;
  const att=by>0&&by<1000?this.byId.get(by):null;
  if(att){att.st.dmg+=amt;att.st.hit++}
  if(!quiet){
    const vic=v.isDrone?v.id:1000+v.idx,key=by*8192+vic;
    let h=this.hitAcc.get(key);
    if(h){h.dmg+=amt;h.x=Math.round(x);h.y=Math.round(y);h.z=Math.round(z)}
    else if(this.hitAcc.size<40)this.hitAcc.set(key,{by,vic,dmg:amt,x:Math.round(x),y:Math.round(y),z:Math.round(z)});
  }
  if(v.hp<=0)this.kill(v,by,how);
  return amt;
};
A.kill=function(v,by,how){
  if(!v.alive)return;
  v.alive=false;v.hp=0;
  // упал сам, но его недавно били — засчитываем тому, кто бил
  if((!by||by===v.id)&&this.t-v.lastT<6&&v.lastBy)by=v.lastBy;
  const killer=by>0&&by<1000?this.byId.get(by):null;
  if(v.isDrone){
    v.gunOn=v.laserOn=false;
    v.st.d++;v.st.streak=0;
    if(killer&&killer!==v){killer.st.k++;killer.st.streak++;if(killer.st.streak>killer.st.best)killer.st.best=killer.st.streak}
    this.ev('k',by||0,v.id,how);
    this.ev('x',v.H.boss?3:2,Math.round(v.x),Math.round(v.y),Math.round(v.z),v.H.boss?v.H.r*1.2:v.H.r*3.2);
    v.respT=v.kind==='foe'?0:this.dir.respawnDelay(v);
    for(const m of this.missiles){if(m.tg===v.id)m.tg=0}
    this.dir.onKill(v,killer,how);
  }else{
    this.ev('k',by||0,1000+v.idx,how);
    this.ev('x',3,Math.round(v.x),Math.round(v.y+3),Math.round(v.z),v.type==='core'?v.r*1.2:v.r*.9);
    if(killer)killer.st.sites++;
    this.dir.onSiteKill(v,killer,how);
  }
};

// ---------- оружие дрона на каждом шаге ----------
A.updateWeapons=function(d,dt){
  const H=d.H,I=d.in;
  d.gunCd-=dt;d.mslCd-=dt;d.flareCd-=dt;
  if(I.swap){I.swap=false;if(H.laser>0)d.weapon^=1}
  if(d.missiles<H.missiles&&H.missiles<99){d.mslRe+=dt;if(d.mslRe>=W.missile.regen){d.mslRe=0;d.missiles++}}
  if(d.flares<H.flares){d.flRe+=dt;if(d.flRe>=W.flare.recharge*H.flareRe){d.flRe=0;d.flares++}}
  this.updateLock(d,dt);
  if(I.fireMissile){I.fireMissile=false;this.launchMissile(d)}
  if(I.dropFlare){I.dropFlare=false;this.dropFlare(d)}
  d.gunOn=false;d.laserOn=false;
  const fire=I.fire&&this.phase==='play';
  const useLaser=d.weapon===1&&H.laser>0;
  if(!useLaser||!fire){ // пушка остывает, пока из неё не стреляют
    d.heat=Math.max(0,d.heat-W.cannon.cool*H.cool*dt*(fire&&!d.over?0:1));
    if(d.over&&d.heat<=W.cannon.resume)d.over=false;
  }
  if(useLaser)this.fireLaser(d,dt,fire);
  else if(fire&&!d.over&&H.gunRate>0&&H.gun>0)this.fireGun(d,dt);
};

// Куда на самом деле полетит выстрел. Человеку прицел слегка «притягивается» к цели в конусе помощи (с упреждением);
// боты целятся сами — поворотом корпуса. Возвращает единичный вектор в out.
A.aimDir=function(d,speed,out){
  SW.fwd(d.yaw,d.pitch,out);
  if(d.kind!=='human')return out;
  const cone=ASSIST[this.opts.assist==null?1:this.opts.assist|0];
  if(!cone)return out;
  let best=null,ba=cone;
  const px=d.x,py=d.y,pz=d.z;
  const test=(t,r)=>{
    const dx=t.x-px,dy=t.y-py,dz=t.z-pz,dist=Math.hypot(dx,dy,dz);
    if(dist>560||dist<8)return;
    const ang=Math.acos(clamp((dx*out[0]+dy*out[1]+dz*out[2])/dist,-1,1));
    if(ang<ba){ba=ang;best=t}
  };
  for(const e of this.drones)if(e.alive&&this.enemy(d,e))test(e);
  for(const s of this.sites)if(s.alive&&s.team!==d.team)test({x:s.x,y:s.y+s.r*.5,z:s.z});
  if(!best)return out;
  let tx=best.x,ty=best.y,tz=best.z;
  if(speed>0&&best.isDrone){
    // упреждение: решаем «где будет цель, когда долетит снаряд» (снаряд наследует скорость стрелка)
    const tv=this.vel(best,_v),sv=this.vel(d,_m);let t=Math.hypot(tx-px,ty-py,tz-pz)/speed;
    for(let k=0;k<3;k++){
      const ax=best.x+tv[0]*t-px-sv[0]*t,ay=best.y+tv[1]*t-py-sv[1]*t,az=best.z+tv[2]*t-pz-sv[2]*t;
      t=Math.hypot(ax,ay,az)/speed;tx=best.x+tv[0]*t-sv[0]*t;ty=best.y+tv[1]*t-sv[1]*t;tz=best.z+tv[2]*t-sv[2]*t;
    }
  }
  let dx=tx-px,dy=ty-py,dz=tz-pz;const l=Math.hypot(dx,dy,dz)||1;dx/=l;dy/=l;dz/=l;
  // вблизи центра конуса — полное притяжение, к краю слабеет
  const k=ba<cone*.55?1:1-(ba-cone*.55)/(cone*.45);
  out[0]+=(dx-out[0])*k;out[1]+=(dy-out[1])*k;out[2]+=(dz-out[2])*k;
  const n=Math.hypot(out[0],out[1],out[2])||1;out[0]/=n;out[1]/=n;out[2]/=n;
  return out;
};

// ---------- мини-пушка ----------
A.fireGun=function(d,dt){
  const H=d.H,C=W.cannon;
  const aim=this.aimDir(d,C.speed,_f);
  const sv=this.vel(d,_v);
  let fired=0;
  while(d.gunCd<=0&&fired<3){
    d.gunCd+=C.cd/H.gunRate;fired++;
    d.heat+=C.heat*H.heat;
    d.gunSide=-d.gunSide;
    const m=SW.Flight.muzzle(d,d.gunSide,_m);
    // разброс в пределах конуса
    const a=this.rand()*SW.TAU,r=Math.sqrt(this.rand())*C.spread;
    let dx=aim[0]+Math.cos(a)*r,dy=aim[1]+Math.sin(a)*r,dz=aim[2]+Math.cos(a+1.3)*r;
    const l=Math.hypot(dx,dy,dz);dx/=l;dy/=l;dz/=l;
    this.bullets.push({x:m[0],y:m[1],z:m[2],vx:dx*C.speed+sv[0],vy:dy*C.speed+sv[1],vz:dz*C.speed+sv[2],life:C.life,dmg:C.dmg*H.gun,by:d.id,team:d.team,how:0,hit:C.hit});
    d.st.shots++;
    if(d.heat>=C.heatMax){d.over=true;break}
  }
  d.gunOn=true;
};
// зенитные и прочие снаряды, выпущенные не дроном
A.spawnBullet=function(x,y,z,vx,vy,vz,life,dmg,by,team,how){
  this.bullets.push({x,y,z,vx,vy,vz,life,dmg,by,team,how,hit:W.cannon.hit});
  this.ev('t',Math.round(x),Math.round(y),Math.round(z),Math.round(vx),Math.round(vy),Math.round(vz),life);
};

// ---------- лазер ----------
A.fireLaser=function(d,dt,fire){
  const H=d.H,L=W.laser;
  if(d.laserLock&&d.energy>=L.minE)d.laserLock=false;
  if(!fire||d.laserLock)return;
  if(d.energy<=0){d.laserLock=true;return}
  d.laserOn=true;
  d.energy=Math.max(0,d.energy-L.cost*dt);d.regenT=L.delay;
  if(d.energy<=0)d.laserLock=true;
  const dir=this.aimDir(d,0,_f);
  const o=SW.Flight.muzzle(d,0,_m);
  let best=L.range;const tw=this.world.rayHit(o[0],o[1],o[2],dir[0],dir[1],dir[2],best);
  if(tw>=0)best=tw;
  let who=null,kind=0;
  for(const e of this.drones){
    if(!e.alive||!this.enemy(d,e))continue;
    const t=segSphere(o[0],o[1],o[2],dir[0],dir[1],dir[2],best,e.x,e.y,e.z,e.H.r+L.hit);
    if(t>=0&&t<=best){best=t;who=e;kind=0}
  }
  for(const s of this.sites){
    if(!s.alive||s.team===d.team)continue;
    const t=segSphere(o[0],o[1],o[2],dir[0],dir[1],dir[2],best,s.x,s.y+s.r*.5,s.z,s.r+L.hit);
    if(t>=0&&t<=best){best=t;who=s;kind=1}
  }
  for(const m of this.missiles){
    if(m.team===d.team)continue;
    const t=segSphere(o[0],o[1],o[2],dir[0],dir[1],dir[2],best,m.x,m.y,m.z,2.2);
    if(t>=0&&t<=best){best=t;who=m;kind=2}
  }
  d.laserLen=best;
  const ang=SW.angles(dir[0],dir[1],dir[2]);
  d.laserDy=angDiff(d.yaw,ang.yaw);d.laserDp=ang.pitch-d.pitch;
  const hx=o[0]+dir[0]*best,hy=o[1]+dir[1]*best,hz=o[2]+dir[2]*best;
  if(who){
    if(kind===2)this.interceptMissile(who,d);
    else this.damage(who,L.dps*H.laser*dt,d.id,1,hx,hy,hz);
  }
  // искры на конце луча — не чаще раза в пол-секунды
  if(this.tick%12===0&&(who||tw>=0))this.ev('x',0,Math.round(hx),Math.round(hy),Math.round(hz),2);
};

// ---------- захват цели для ракеты ----------
A.updateLock=function(d,dt){
  const H=d.H;
  if(d.missiles<=0){d.lockId=0;d.lockT=0;d.locked=false;return}
  const fwd=SW.fwd(d.yaw,d.pitch,_f);
  const cone=d.lockId?W.missile.loseCone:W.missile.cone;
  let best=null,ba=cone,bid=0;
  const test=(t,id,r)=>{
    const dx=t.x-d.x,dy=t.y-d.y,dz=t.z-d.z,dist=Math.hypot(dx,dy,dz);
    if(dist>W.missile.lockRange||dist<25)return;
    const c=(dx*fwd[0]+dy*fwd[1]+dz*fwd[2])/dist;if(c<Math.cos(ba))return;
    const ang=Math.acos(clamp(c,-1,1));
    if(ang<ba){ba=ang;best=t;bid=id}
  };
  for(const e of this.drones)if(e.alive&&e!==d&&this.enemy(d,e))test(e,e.id);
  for(const s of this.sites)if(s.alive&&s.team!==d.team)test({x:s.x,y:s.y+s.r*.5,z:s.z},1000+s.idx);
  if(best&&!this.world.los(d.x,d.y,d.z,best.x,best.y,best.z))best=null;
  if(best){
    if(bid===d.lockId)d.lockT+=dt;else{d.lockId=bid;d.lockT=0}
  }else{
    d.lockT=Math.max(0,d.lockT-dt*2);
    if(d.lockT<=0)d.lockId=0;
  }
  d.locked=d.lockId!==0&&d.lockT>=H.lockT;
};

// ---------- ракеты ----------
A.launchMissile=function(d){
  if(!d.alive||d.missiles<=0||d.mslCd>0||this.phase!=='play')return false;
  const foe=d.kind==='foe',M=foe?W.enemyMissile:W.missile;
  const tg=d.locked?d.lockId:(d.ai&&d.ai.forceLock)||0;
  if(d.ai)d.ai.forceLock=0;
  const f=SW.fwd(d.yaw,d.pitch,_f),mz=SW.Flight.muzzle(d,0,_m);
  const m={id:this.nid++,kindN:foe?2:0,by:d.id,team:d.team,x:mz[0],y:mz[1]-.6,z:mz[2],dx:f[0],dy:f[1],dz:f[2],spd:d.spd+M.launch,M,
    turn:M.turn*d.H.mTurn,life:M.life,tg,decoy:null,age:0,how:2,hitR:M.hit};
  this.missiles.push(m);
  d.missiles--;d.mslCd=W.missile.cd;d.lockT=0;d.locked=false;
  this.ev('m',m.id,d.id,m.kindN,Math.round(m.x),Math.round(m.y),Math.round(m.z));
  return true;
};
// ракета с земли (зенитка): site — установка, tg — номер цели-дрона
A.launchSam=function(s,tgt,dx,dy,dz,M,kindN){
  const l=Math.hypot(dx,dy,dz)||1;
  const m={id:this.nid++,kindN:kindN==null?1:kindN,by:1000+s.idx,team:s.team,x:s.x,y:s.y+s.r,z:s.z,dx:dx/l,dy:dy/l,dz:dz/l,spd:M.launch,M,
    turn:M.turn*(s.mTurn||1),life:M.life,tg:tgt.id,decoy:null,age:0,how:3,hitR:M.hit};
  this.missiles.push(m);
  this.ev('m',m.id,1000+s.idx,m.kindN,Math.round(m.x),Math.round(m.y),Math.round(m.z));
  return m;
};
A.updateMissiles=function(dt){
  const W_=this.world;
  for(let i=this.missiles.length-1;i>=0;i--){
    const m=this.missiles[i],M=m.M;
    m.age+=dt;m.life-=dt;
    if(m.life<=0){this.missileEnd(m,i,false);continue}
    // что преследуем
    let tr=null,tx=0,ty=0,tz=0;
    if(m.decoy){
      if(m.decoy.life>0){tr=m.decoy;tx=tr.x;ty=tr.y;tz=tr.z}else m.decoy=null;
    }else if(m.tg){
      tr=this.target(m.tg);
      if(tr&&tr.alive){tx=tr.x;ty=tr.y+(tr.isDrone?0:tr.r*.5);tz=tr.z}else{tr=null;m.tg=0}
    }
    if(tr){
      let dx=tx-m.x,dy=ty-m.y,dz=tz-m.z,dist=Math.hypot(dx,dy,dz)||1;
      if(tr.isDrone){ // упреждение по скорости цели
        const tv=this.vel(tr,_v),tt=Math.min(1.2,dist/Math.max(40,m.spd))*.8;
        dx+=tv[0]*tt;dy+=tv[1]*tt;dz+=tv[2]*tt;dist=Math.hypot(dx,dy,dz)||1;
      }
      dx/=dist;dy/=dist;dz/=dist;
      const cosA=m.dx*dx+m.dy*dy+m.dz*dz;
      if(m.age>.5&&cosA<Math.cos(M.seek)){m.tg=0;m.decoy=null} // цель ушла за пределы обзора головки — ракета потеряла её
      else{
        const ang=Math.acos(clamp(cosA,-1,1)),maxA=m.turn*dt,k=ang>maxA?maxA/ang:1;
        m.dx+=(dx-m.dx)*k;m.dy+=(dy-m.dy)*k;m.dz+=(dz-m.dz)*k;
        const n=Math.hypot(m.dx,m.dy,m.dz)||1;m.dx/=n;m.dy/=n;m.dz/=n;
      }
    }
    m.spd=Math.min(M.speed,m.spd+M.accel*dt);
    const l=m.spd*dt;
    // стена по пути?
    const tw=W_.rayHit(m.x,m.y,m.z,m.dx,m.dy,m.dz,l+1);
    // ближайшая цель вдоль пути (взрыватель срабатывает на сближении)
    let bt=l,boom=false;
    const near=(t,r)=>{
      const rx=t.x-m.x,ry=t.y-m.y,rz=t.z-m.z;
      let s=rx*m.dx+ry*m.dy+rz*m.dz;s=clamp(s,0,l);
      const cx=m.x+m.dx*s-t.x,cy=m.y+m.dy*s-t.y,cz=m.z+m.dz*s-t.z;
      if(cx*cx+cy*cy+cz*cz<=r*r&&s<=bt){bt=s;boom=true}
    };
    if(m.age>.25){
      for(const e of this.drones)if(e.alive&&e.team!==m.team)near(e,Math.max(M.fuse,e.H.r+M.hit));
      for(const s of this.sites)if(s.alive&&s.team!==m.team)near({x:s.x,y:s.y+s.r*.5,z:s.z},s.r+M.hit);
      if(m.decoy)near(m.decoy,5);
    }
    if(tw>=0&&tw<=bt+1){bt=Math.max(0,tw-.5);boom=true}
    if(boom){
      m.x+=m.dx*bt;m.y+=m.dy*bt;m.z+=m.dz*bt;
      this.missileEnd(m,i,true);continue;
    }
    m.x+=m.dx*l;m.y+=m.dy*l;m.z+=m.dz*l;
  }
};
A.missileEnd=function(m,i,hit){
  this.missiles.splice(i,1);
  if(hit)this.blast(m.x,m.y,m.z,m.M,m.by,m.team,m.how);
  else this.ev('x',4,Math.round(m.x),Math.round(m.y),Math.round(m.z),3);
};
// сбить ракету пулей или лучом
A.interceptMissile=function(m,by){
  const i=this.missiles.indexOf(m);if(i<0)return;
  this.missiles.splice(i,1);
  this.ev('x',4,Math.round(m.x),Math.round(m.y),Math.round(m.z),4);
  if(by&&by.st){by.st.icp++;this.ev('icp',by.id)}
};
// взрыв с разлётом: прямое попадание — полный урон, рядом — меньше
A.blast=function(x,y,z,M,by,team,how){
  this.ev('x',1,Math.round(x),Math.round(y),Math.round(z),M.splash);
  for(const d of this.drones){
    if(!d.alive||d.team===team)continue;
    const dist=Math.hypot(d.x-x,d.y-y,d.z-z);
    if(dist>M.splash+d.H.r)continue;
    const direct=dist<d.H.r+M.hit+1.5;
    this.damage(d,direct?M.dmg:M.splashDmg*(1-clamp((dist-d.H.r)/M.splash,0,1)),by,how,d.x,d.y,d.z);
  }
  for(const s of this.sites){
    if(!s.alive||s.team===team)continue;
    const dist=Math.hypot(s.x-x,s.y+s.r*.5-y,s.z-z);
    if(dist>M.splash+s.r)continue;
    this.damage(s,dist<s.r+M.hit+1.5?M.dmg:M.splashDmg*(1-clamp((dist-s.r)/M.splash,0,1)),by,how,s.x,s.y,s.z);
  }
};

// ---------- ловушки ----------
A.dropFlare=function(d){
  if(!d.alive||d.flares<=0||d.flareCd>0||this.phase!=='play')return false;
  d.flares--;d.flareCd=W.flare.cd;
  const f=SW.fwd(d.yaw,d.pitch,_f),sv=this.vel(d,_v);
  const fl={id:this.nid++,x:d.x-f[0]*3,y:d.y-1.5,z:d.z-f[2]*3,vx:sv[0]*.35-f[0]*8,vy:sv[1]*.35-4,vz:sv[2]*.35-f[2]*8,life:W.flare.life,by:d.id,team:d.team};
  this.flares.push(fl);
  this.ev('f',d.id,Math.round(fl.x),Math.round(fl.y),Math.round(fl.z),Math.round(fl.vx),Math.round(fl.vy),Math.round(fl.vz));
  // ракеты, летящие в этот дрон, могут клюнуть на ловушку
  for(const m of this.missiles){
    if(m.tg!==d.id||m.decoy)continue;
    const dist=Math.hypot(m.x-d.x,m.y-d.y,m.z-d.z);
    if(dist>W.flare.range||dist<10)continue;
    if(this.rand()<W.flare.divert){m.decoy=fl;m.tg=0;d.st.flareSaves=(d.st.flareSaves||0)+1}
  }
  return true;
};
A.updateFlares=function(dt){
  for(let i=this.flares.length-1;i>=0;i--){
    const f=this.flares[i];
    f.life-=dt;f.vx*=1-1.2*dt;f.vz*=1-1.2*dt;f.vy-=6*dt;
    f.x+=f.vx*dt;f.y+=f.vy*dt;f.z+=f.vz*dt;
    if(f.life<=0||f.y<1)this.flares.splice(i,1);
  }
};

// ---------- пули ----------
A.updateBullets=function(dt){
  const Wd=this.world;
  for(let i=this.bullets.length-1;i>=0;i--){
    const b=this.bullets[i];
    b.life-=dt;
    if(b.life<=0){this.bullets.splice(i,1);continue}
    const sp=Math.hypot(b.vx,b.vy,b.vz),l=sp*dt,dx=b.vx/sp,dy=b.vy/sp,dz=b.vz/sp;
    let best=l,who=null,kind=0;
    const tw=Wd.rayHit(b.x,b.y,b.z,dx,dy,dz,l);
    if(tw>=0)best=tw;
    for(const e of this.drones){
      if(!e.alive||e.team===b.team)continue;
      const t=segSphere(b.x,b.y,b.z,dx,dy,dz,best,e.x,e.y,e.z,e.H.r+b.hit);
      if(t>=0&&t<=best){best=t;who=e;kind=0}
    }
    for(const s of this.sites){
      if(!s.alive||s.team===b.team)continue;
      const t=segSphere(b.x,b.y,b.z,dx,dy,dz,best,s.x,s.y+s.r*.5,s.z,s.r+b.hit);
      if(t>=0&&t<=best){best=t;who=s;kind=1}
    }
    for(const m of this.missiles){
      if(m.team===b.team)continue;
      const t=segSphere(b.x,b.y,b.z,dx,dy,dz,best,m.x,m.y,m.z,1.8);
      if(t>=0&&t<=best){best=t;who=m;kind=2}
    }
    if(who){
      const hx=b.x+dx*best,hy=b.y+dy*best,hz=b.z+dz*best;
      if(kind===2)this.interceptMissile(who,this.byId.get(b.by));
      else this.damage(who,b.dmg,b.by,b.how,hx,hy,hz);
      this.bullets.splice(i,1);
      if(this.sparkN++<6&&kind!==2)this.ev('x',0,Math.round(hx),Math.round(hy),Math.round(hz),1.5);
    }else if(tw>=0){
      if(this.sparkN++<6)this.ev('x',0,Math.round(b.x+dx*tw),Math.round(b.y+dy*tw),Math.round(b.z+dz*tw),1.5);
      this.bullets.splice(i,1);
    }else{b.x+=b.vx*dt;b.y+=b.vy*dt;b.z+=b.vz*dt}
  }
};
})(typeof window!=='undefined'?window:globalThis);
