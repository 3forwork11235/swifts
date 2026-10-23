// «Стрижи» — арена: вся симуляция боя в одном объекте. Работает в браузере хоста (комната room.js) и в Node (тесты).
// Арена ничего не знает о сети: ей говорят «вот ввод игрока» (setInput) и просят «шаг» (step) и «снимок» (snapshot).
//
// Что внутри (части арены разнесены по файлам, все дополняют Arena.prototype):
//   sim.js     — дроны, раунд, появление/возрождение, бонусы, снимки для сети            (этот файл)
//   combat.js  — пушка, лазер, ракеты, ловушки, урон, взрывы
//   sites.js   — зенитные комплексы и цели на земле
//   ai.js      — «мозги» ботов и дронов СТРАЖа
//   modes.js   — правила режимов (схватка, команды, рейс) и сценарии миссий (missions.js)
//
// События (A.ev) — короткие массивы, попадают в снимок и разыгрываются у игроков:
//   ['x',вид,x,y,z,размер]   взрыв (0 искры, 1 ракета, 2 дрон, 3 крупный, 4 малый)
//   ['h',кто,кого,урон,x,y,z] попадание (урон из очереди суммируется)
//   ['k',убийца,жертва,чем]   сбит (0 пушка,1 лазер,2 ракета,3 ЗРК,4 столкновение,5 таран,6 зона,7 зенитка,8 прочее)
//   ['m',id,кто,вид,x,y,z]    пуск ракеты        ['f',кто,x,y,z,vx,vy,vz] ловушка
//   ['pk',место,кто,вид]      бонус подобран     ['pr',место] бонус вернулся
//   ['ring',кто,№,следующий]  кольцо пройдено    ['say',кто,текст] радиопереговоры
//   ['wave',№,всего,текст]    волна              ['obj',текст,сейчас,всего] цель задания
//   ['sp',кто,x,y,z]          появление дрона    ['cr',кто,сила,x,y,z] удар о здание
//   ['t',x,y,z,vx,vy,vz,жизнь] трассер зенитки   ['go'] начало     ['icp',кто] перехват ракеты
(function(root){
'use strict';
const SW=root.SW;
const {clamp}=SW;
SW.COUNTDOWN=3;
SW.END_PAUSE=14;   // сколько секунд показываем итоги, прежде чем начнётся следующий раунд

const PICK_W=[['hp',.34],['ms',.26],['en',.26],['sh',.14]];
const OUT_GRACE=5;     // сколько секунд можно лететь за краем карты
const HITACC_MAX=40;

class Arena{
  constructor(cfg){
    this.cfg=cfg;this.mode=cfg.mode;this.opts=cfg.opts||{};
    this.world=SW.makeWorld(cfg.map,cfg.seed);
    this.rand=SW.rng(cfg.simSeed!=null?cfg.simSeed:(Math.random()*4294967296)>>>0);
    this.t=0;this.tick=0;this.phase='count';this.phaseT=SW.COUNTDOWN;
    this.drones=[];this.byId=new Map();this.missiles=[];this.bullets=[];this.sites=[];this.flares=[];this.pickups=[];
    this.events=[];this.hitAcc=new Map();this.sparkN=0;
    this.nid=1;this.foeNext=100;this.rosterV=0;
    this.result=null;
    this.stat={shots:0,hits:0};
    // бонусы стоят на заранее заданных местах мира
    const pr=SW.rng(cfg.seed*31+5);
    this.world.pickSpots.forEach((p,i)=>{
      let q=pr(),kind='hp';for(const [k,w] of PICK_W){if(q<w){kind=k;break}q-=w}
      this.pickups.push({i,kind,x:p.x,y:p.y,z:p.z,on:true,t:0});
    });
    this.dir=SW.Modes[this.mode](this,cfg);
  }
  // Начать раунд: когда все игроки уже добавлены (addDrone), режим расставляет цели, а дроны появляются в небе
  begin(){
    this.dir.init();
    for(const d of this.drones)if(!d.alive)this.respawn(d);
  }

  ev(...a){this.events.push(a)}
  enemy(a,b){return a.team!==b.team}
  // цель по номеру: дроны < 1000, зенитки и цели на земле — 1000 + индекс
  target(id){return id>=1000?this.sites[id-1000]:this.byId.get(id)}
  vel(d,out){
    const cp=Math.cos(d.pitch);out=out||[0,0,0];
    out[0]=-Math.sin(d.yaw)*cp*d.spd;out[1]=Math.sin(d.pitch)*d.spd;out[2]=-Math.cos(d.yaw)*cp*d.spd;return out;
  }
  alive(){return this.drones.filter(d=>d.alive)}

  // ---------- дроны ----------
  // spec: {id, slot, name, kind:'human'|'bot'|'foe'|'wing', team, hull, mods, skin, diff}
  addDrone(spec){
    const foe=spec.kind==='foe';
    const H=SW.effective(spec.hull,spec.mods,spec.kind==='human'?null:(spec.diff||'normal'));
    const id=spec.id!=null?spec.id:this.foeNext++;
    if(this.foeNext>990)this.foeNext=100;
    const d={id,slot:spec.slot||null,name:spec.name||'',kind:spec.kind,team:spec.team,skin:spec.skin||{},hullId:spec.hull,mods:spec.mods||[],H,diff:spec.diff||'normal',
      isDrone:true,alive:false,
      x:0,y:200,z:0,yaw:0,pitch:0,roll:0,spd:H.spd,yawV:0,pitchV:0,energy:H.energy,boost:false,regenT:0,
      hp:H.hp,maxhp:H.hp,respT:0,invT:0,shield:0,shieldT:0,ep:0,
      missiles:H.missiles,flares:H.flares,heat:0,over:false,gunCd:0,mslCd:0,flareCd:0,mslRe:0,flRe:0,weapon:0,gunSide:1,
      gunOn:false,laserOn:false,laserLen:0,laserDy:0,laserDp:0,laserLock:false,
      lockId:0,lockT:0,locked:false,
      in:{yaw:0,pitch:0,thr:0,fire:0,lvl:1,fireMissile:false,dropFlare:false,swap:false},
      ack:0,inAt:0,outT:0,
      st:{k:0,d:0,dmg:0,hit:0,shots:0,icp:0,streak:0,best:0,sites:0,rings:0,pk:0,score:0},
      lastBy:0,lastT:-99,lastHow:8,ai:null,away:false,
      ctl:spec.kind==='human'?'human':'ai'};
    this.drones.push(d);this.byId.set(id,d);
    if(!foe)this.rosterV++;
    if(d.ctl==='ai')SW.AI.attach(this,d);
    return d;
  }
  removeDrone(d){
    const i=this.drones.indexOf(d);if(i>=0)this.drones.splice(i,1);
    if(d.kind!=='foe')this.rosterV++;
    if(this.byId.get(d.id)===d)this.byId.delete(d.id);
    for(const m of this.missiles)if(m.tg===d.id)m.tg=0;
  }
  // сменить управление: человек ушёл — дрон ведёт бот; вернулся — снова человек
  setControl(d,ctl){
    d.ctl=ctl;d.kind=ctl==='human'?'human':(d.kind==='human'?'bot':d.kind);
    if(ctl==='ai'&&!d.ai)SW.AI.attach(this,d);
    if(ctl==='human'){d.in.yaw=d.in.pitch=d.in.thr=0;d.in.fire=0}
  }
  // ввод игрока (из room.js): число-счётчики превращаются в одноразовые «нажатия»
  setInput(d,m){
    const i=d.in;
    if(SW.isNum(m.y))i.yaw=clamp(m.y,-1,1);
    if(SW.isNum(m.p))i.pitch=clamp(m.p,-1,1);
    if(SW.isNum(m.t))i.thr=clamp(m.t,-1,1);
    i.fire=m.f?1:0;i.lvl=m.l?1:0;
    if(SW.isNum(m.m)){if(d.cm!==undefined&&m.m!==d.cm)i.fireMissile=true;d.cm=m.m}
    if(SW.isNum(m.r)){if(d.cf!==undefined&&m.r!==d.cf)i.dropFlare=true;d.cf=m.r}
    if(SW.isNum(m.w)){if(d.cw!==undefined&&m.w!==d.cw)i.swap=true;d.cw=m.w}
    if(SW.isNum(m.s)&&m.s>d.ack)d.ack=m.s;
    d.inAt=this.t;
  }

  // Поставить дрон в точку. Если точку не дали — выбирает режим.
  respawn(d,spot){
    const H=d.H;
    spot=spot||this.dir.spawn(d);
    SW.Flight.init(d,H,spot.x,spot.y,spot.z,spot.yaw);
    if(spot.pitch)d.pitch=spot.pitch;
    d.hp=d.maxhp=H.hp;d.alive=true;d.respT=0;d.invT=spot.inv!=null?spot.inv:2.5;d.shield=0;d.shieldT=0;d.ep=(d.ep+1)&255;
    d.missiles=H.missiles;d.flares=H.flares;d.heat=0;d.over=false;d.gunCd=d.mslCd=d.flareCd=0;d.mslRe=d.flRe=0;
    d.lockId=0;d.lockT=0;d.locked=false;d.laserLock=false;d.gunOn=d.laserOn=false;d.outT=0;d.lastBy=0;
    d.in.fireMissile=d.in.dropFlare=d.in.swap=false;
    if(d.ai)SW.AI.reset(this,d);
    this.ev('sp',d.id,Math.round(d.x),Math.round(d.y),Math.round(d.z));
  }

  // ---------- шаг ----------
  step(dt){
    this.tick++;
    if(this.phase==='count'){
      this.phaseT-=dt;
      if(this.phaseT<=0){this.phase='play';this.ev('go')}
      return;
    }
    this.t+=dt;
    if(this.phase==='end')this.phaseT-=dt;
    this.dir.update(dt);
    const W=this.world,F=SW.Flight;
    for(const d of this.drones){
      if(!d.alive){
        if(d.kind!=='foe'&&d.respT>0){d.respT-=dt;if(d.respT<=0&&this.dir.canRespawn(d))this.respawn(d)}
        continue;
      }
      if(d.invT>0)d.invT-=dt;
      if(d.shieldT>0){d.shieldT-=dt;if(d.shieldT<=0)d.shield=0}
      // управление: человек или ИИ
      if(d.ctl==='ai')SW.AI.think(this,d,dt);
      else if(this.t-d.inAt>.5){const i=d.in;i.yaw=i.pitch=i.thr=0;i.fire=0}
      const imp=F.step(d,d.in,dt,W,d.H);
      if(imp>3)this.crash(d,imp);
      this.updateWeapons(d,dt);
      this.bounds(d,dt);
    }
    this.updateBullets(dt);
    this.updateMissiles(dt);
    this.updateFlares(dt);
    this.updateSites(dt);
    this.contacts(dt);
    this.updatePickups(dt);
    // убитых врагов убираем после того, как о них узнали в событиях
    for(let i=this.drones.length-1;i>=0;i--){const d=this.drones[i];if(!d.alive&&d.kind==='foe'){this.drones.splice(i,1);this.byId.delete(d.id)}}
  }

  // удар о здание или землю: урон по силе удара
  crash(d,imp){
    if(d.invT>0)return;
    this.ev('cr',d.id,Math.round(imp),Math.round(d.x),Math.round(d.y),Math.round(d.z));
    this.damage(d,Math.min(70,imp*.9),0,4,d.x,d.y,d.z);
  }
  // за краем карты: через OUT_GRACE секунд дрон начинает гореть
  bounds(d,dt){
    const h=this.world.half;
    if(Math.abs(d.x)>h||Math.abs(d.z)>h){
      d.outT+=dt;
      if(d.outT>OUT_GRACE)this.damage(d,28*dt,0,6,d.x,d.y,d.z,true);
    }else if(d.outT>0)d.outT=Math.max(0,d.outT-dt*2);
  }
  // дроны не должны «слипаться»; камикадзе взрываются о цель
  contacts(dt){
    const ds=this.drones;
    for(let i=0;i<ds.length;i++){
      const a=ds[i];if(!a.alive)continue;
      for(let j=i+1;j<ds.length;j++){
        const b=ds[j];if(!b.alive)continue;
        const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,rr=a.H.r+b.H.r;
        if(Math.abs(dx)>rr+3||Math.abs(dz)>rr+3||Math.abs(dy)>rr+3)continue;
        const dist=Math.hypot(dx,dy,dz);
        if((a.H.ram&&this.enemy(a,b)&&dist<SW.W.ram.radius+b.H.r)){this.ram(a,b);continue}
        if((b.H.ram&&this.enemy(a,b)&&dist<SW.W.ram.radius+a.H.r)){this.ram(b,a);continue}
        if(dist<rr&&dist>.01){
          const p=(rr-dist)/2,ux=dx/dist,uy=dy/dist,uz=dz/dist;
          a.x-=ux*p;a.y-=uy*p;a.z-=uz*p;b.x+=ux*p;b.y+=uy*p;b.z+=uz*p;
        }
      }
    }
  }
  ram(k,v){
    this.damage(v,SW.W.ram.dmg*(k.H.gun||1),k.id,5,k.x,k.y,k.z);
    this.ev('x',3,Math.round(k.x),Math.round(k.y),Math.round(k.z),9);
    k.hp=0;k.lastBy=v.id;this.kill(k,v.id,5,true);
  }

  // ---------- бонусы ----------
  updatePickups(dt){
    for(const p of this.pickups){
      if(!p.on){p.t-=dt;if(p.t<=0){p.on=true;this.ev('pr',p.i)}continue}
      for(const d of this.drones){
        if(!d.alive||d.kind==='foe')continue;
        const dx=d.x-p.x,dy=d.y-p.y,dz=d.z-p.z;
        if(dx*dx+dy*dy+dz*dz>49)continue;
        if(this.collect(d,p)){p.on=false;p.t=SW.PICK_RESPAWN;this.ev('pk',p.i,d.id,SW.PICK_IDS.indexOf(p.kind));d.st.pk++;break}
      }
    }
  }
  collect(d,p){
    const H=d.H;
    switch(p.kind){
      case'hp':if(d.hp>=d.maxhp-1)return false;d.hp=Math.min(d.maxhp,d.hp+SW.PICKS.hp.heal);return true;
      case'ms':if(d.missiles>=H.missiles&&d.flares>=H.flares)return false;d.missiles=Math.min(H.missiles,d.missiles+2);d.flares=Math.min(H.flares,d.flares+1);return true;
      case'en':if(d.energy>=H.energy-1&&d.heat<5)return false;d.energy=H.energy;d.heat=0;d.over=false;return true;
      case'sh':d.shield=SW.W.shield.hp;d.shieldT=SW.W.shield.time;return true;
    }
    return false;
  }

  // ---------- конец раунда ----------
  finish(result){
    if(this.phase==='end')return;
    this.phase='end';this.phaseT=SW.END_PAUSE||12;this.result=result;
  }

  // ---------- сеть ----------
  // состояние раунда целиком: для начала раунда и для вернувшихся игроков
  roundInfo(){
    const W=this.world;
    return {map:this.cfg.map,seed:this.cfg.seed,wh:W.hash,mode:this.mode,
      sites:this.sites.map(s=>this.siteInfo(s)),
      pk:this.pickups.map(p=>[SW.PICK_IDS.indexOf(p.kind),p.on?1:0]),
      dr:this.drones.filter(d=>d.kind!=='foe').map(d=>this.droneInfo(d)),
      dir:this.dir.info(),phase:this.phase,pt:Math.round(this.phaseT*10),t:Math.round(this.t*1000)};
  }
  droneInfo(d){return {id:d.id,slot:d.slot,name:d.name,team:d.team,hull:d.hullId,skin:d.skin,mods:d.mods,kind:d.kind}}
  siteInfo(s){return [s.idx,s.type,Math.round(s.x),Math.round(s.y),Math.round(s.z),Math.round(s.hp),Math.round(s.maxhp),s.alive?1:0]}

  flags(d){
    return (d.alive?1:0)|(d.boost?2:0)|(d.gunOn?4:0)|(d.laserOn?8:0)|(d.shield>0?16:0)|(d.invT>0?32:0)|(d.over?64:0)|(d.weapon?128:0)|(d.kind==='foe'?256:0)|(Math.max(0,SW.HULL_CODES.indexOf(d.hullId))<<10);
  }
  snapshot(){
    const dr=[];
    for(const d of this.drones){
      // дроны-враги видны, пока живы; мёртвые игроки остаются в списке, чтобы у клиентов были имена и очки
      if(!d.alive&&d.kind==='foe')continue;
      const r=[d.id,Math.round(d.x*10),Math.round(d.y*10),Math.round(d.z*10),Math.round(d.yaw*1000),Math.round(d.pitch*1000),Math.round(d.roll*100),Math.round(d.spd*10),Math.round(d.hp),this.flags(d)];
      if(d.laserOn)r.push(Math.round(d.laserLen*10),Math.round(d.laserDy*1000),Math.round(d.laserDp*1000));
      dr.push(r);
    }
    const ms=this.missiles.map(m=>[m.id,Math.round(m.x*10),Math.round(m.y*10),Math.round(m.z*10),Math.round(Math.atan2(-m.dx,-m.dz)*100),Math.round(Math.asin(clamp(m.dy,-1,1))*100),m.tg|0,m.kindN,m.decoy?1:0]);
    const ss=[];
    for(const s of this.sites)if(s.alive)ss.push([s.idx,Math.round(s.hp),s.tgt|0,s.firing?1:0]);
    // накопленный урон: по одному событию на пару «кто — кого»
    for(const [k,v] of this.hitAcc)this.events.push(['h',v.by,v.vic,Math.round(v.dmg),v.x,v.y,v.z]);
    this.hitAcc.clear();this.sparkN=0;
    const msg={type:'snap',t:Math.round(this.t*1000),ph:this.phase,pt:Math.round(this.phaseT*10),d:dr,m:ms,s:ss,g:this.dir.state()};
    if(this.events.length){msg.ev=this.events;this.events=[]}
    return msg;
  }
  // личное сообщение игроку: точное состояние его дрона для предсказания и все его показатели
  meFor(d){
    const r3=v=>Math.round(v*1000)/1000;
    return {type:'me',ack:d.ack,ep:d.ep,st:[r3(d.x),r3(d.y),r3(d.z),r3(d.yaw),r3(d.pitch),r3(d.roll),r3(d.spd),r3(d.yawV),r3(d.pitchV)],
      hp:Math.round(d.hp),mh:d.maxhp,en:Math.round(d.energy),ht:Math.round(d.heat),ov:d.over?1:0,ms:d.missiles,fl:d.flares,w:d.weapon,
      lk:d.lockId,lp:Math.round(clamp(d.lockT/d.H.lockT,0,1)*100)/100,al:d.alive?1:0,rs:Math.round(d.respT*10),out:Math.round(d.outT*10),
      sh:Math.round(d.shield),iv:Math.round(Math.max(0,d.invT)*10),sc:d.st.score};
  }
}
SW.Arena=Arena;
})(typeof window!=='undefined'?window:globalThis);
