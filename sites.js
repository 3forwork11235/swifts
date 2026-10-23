// «Стрижи» — наземные установки: зенитные комплексы (ЗРК), зенитки, пилоны щита и Сердце СТРАЖа. Дополняет Arena.
(function(root){
'use strict';
const SW=root.SW;
const A=SW.Arena.prototype;
const {clamp}=SW;
const _v=[0,0,0];

// Поставить установку type ('sam'|'flak'|'pylon'|'core') в (x,y,z) — y это основание. o: {hpMul, team, reload}
A.addSite=function(type,x,y,z,o){
  o=o||{};
  const S=SW.SITES[type],hp=Math.round(S.hp*(o.hpMul||1));
  const s={idx:this.sites.length,type,x,y,z,hp,maxhp:hp,alive:true,team:o.team==null?1:o.team,r:S.r,
    cd:2+this.rand()*3,think:this.rand()*.25,tgt:0,firing:false,burst:0,burstT:0,pause:1+this.rand()*2,volley:0,volT:0,invul:false,mTurn:o.mTurn||1,reload:o.reload||1};
  this.sites.push(s);
  return s;
};

A.updateSites=function(dt){
  if(!this.sites.length||this.phase==='end')return;
  const D=SW.DIFF[this.opts.diff||'normal']||SW.DIFF.normal;
  for(const s of this.sites){
    if(!s.alive||s.type==='pylon')continue;
    const S=SW.SITES[s.type];
    s.think-=dt;s.cd-=dt;
    if(s.think<=0){
      s.think=.25;
      // ближайшая видимая цель в зоне поражения
      let best=null,bd=S.range;
      for(const d of this.drones){
        if(!d.alive||d.team===s.team||d.invT>0)continue;
        const dx=d.x-s.x,dz=d.z-s.z,hd=Math.hypot(dx,dz),dist=Math.hypot(hd,d.y-s.y-s.r);
        if(dist>=bd||(S.minRange&&hd<S.minRange&&d.y>s.y))continue; // «мёртвая зона» над самой установкой
        if(!this.world.los(s.x,s.y+s.r,s.z,d.x,d.y,d.z))continue;
        bd=dist;best=d;
      }
      s.tgt=best?best.id:0;
    }
    s.firing=false;
    const tg=s.tgt?this.byId.get(s.tgt):null;
    if(!tg||!tg.alive){s.tgt=0;continue}
    if(s.type==='sam'){
      if(s.cd<=0&&this.missiles.filter(m=>m.by===1000+s.idx).length<S.maxFlight){
        s.cd=S.reload*D.samReload*s.reload*(1+this.rand()*.3);
        this.launchSam(s,tg,tg.x-s.x,tg.y-s.y+s.r*2,tg.z-s.z,SW.W.sam,1);
        s.firing=true;
      }
    }else if(s.type==='flak'){
      s.pause-=dt;
      if(s.burst<=0&&s.pause<=0){s.burst=S.burst;s.burstT=0}
      if(s.burst>0){
        s.firing=true;s.burstT-=dt;
        if(s.burstT<=0){
          s.burstT=S.rate;s.burst--;
          if(s.burst<=0)s.pause=S.pause*D.samReload*(.8+this.rand()*.4);
          // упреждение + разброс (у «трудных» точнее)
          const tv=this.vel(tg,_v),sx=s.x,sy=s.y+s.r*1.4,sz=s.z,sp=320;
          let t=Math.hypot(tg.x-sx,tg.y-sy,tg.z-sz)/sp;
          for(let k=0;k<2;k++)t=Math.hypot(tg.x+tv[0]*t-sx,tg.y+tv[1]*t-sy,tg.z+tv[2]*t-sz)/sp;
          let dx=tg.x+tv[0]*t-sx,dy=tg.y+tv[1]*t-sy,dz=tg.z+tv[2]*t-sz;
          const l=Math.hypot(dx,dy,dz)||1,e=S.spread*(.6+D.aim*8);
          dx=dx/l+(this.rand()-.5)*2*e;dy=dy/l+(this.rand()-.5)*2*e;dz=dz/l+(this.rand()-.5)*2*e;
          const n=Math.hypot(dx,dy,dz);dx/=n;dy/=n;dz/=n;
          this.spawnBullet(sx,sy,sz,dx*sp,dy*sp,dz*sp,Math.min(2.2,S.range/sp+.25),S.dmg*D.dmgMul,1000+s.idx,s.team,7);
        }
      }
    }else if(s.type==='core'){
      if(s.volley<=0&&s.cd<=0){s.volley=S.volley;s.volT=0;s.cd=S.reload*D.samReload*s.reload}
      if(s.volley>0){
        s.firing=true;s.volT-=dt;
        if(s.volT<=0){
          s.volT=.35;s.volley--;
          const a=this.rand()*SW.TAU;
          this.launchSam(s,tg,Math.cos(a)*.6,1.2,Math.sin(a)*.6,SW.W.enemyMissile,2);
        }
      }
    }
  }
};
})(typeof window!=='undefined'?window:globalThis);
