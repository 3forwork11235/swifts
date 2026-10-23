// «Стрижи» — клиент боя: приём снимков от комнаты, плавное движение чужих дронов, предсказание своего дрона,
// события боя (взрывы, звуки, радио, лента убийств). Камера и отрисовка сцен — в view.js, экраны — в app.js.
//
// Как это работает:
//  • Своя машина двигается сразу — той же функцией SW.Flight.step, что и в комнате (30 раз в секунду). Каждый шаг уходит комнате.
//  • Раз в 66 мс приходит сообщение `me`: точное состояние нашего дрона на шаге `ack`. Сравниваем с тем, что мы предсказали на этом
//    шаге; небольшую разницу плавно «подтягиваем», большую (удар, возрождение) — сразу ставим точку заново.
//  • Чужие дроны, ракеты и зенитки приходят в снимках; мы показываем их чуть «из прошлого» (интерполяция между двумя снимками),
//    поэтому движение гладкое даже при рывках сети. События боя разыгрываются, когда до их времени доходит это «прошлое».
(function(root){
'use strict';
const SW=root.SW,R=SW.Render,A=SW.Audio,I=SW.Input,NET=SW.Net,F=SW.FX;
const {clamp,lerp,angLerp,angDiff,TICK}=SW;
const PHRASES=['Прикрой!','Спасибо!','Вижу цель!','Атакую!','Иду домой','Ракета на хвосте!','Отлично!','Отходим!'];
const HOW=['пушкой','лазером','ракетой','зениткой','о землю','тараном','вне зоны','зениткой','—'];
const r2=v=>Math.round(v*100)/100;

const C={
  scene:'menu',now:0,frame:0,touch:false,world:null,mode:'ffa',opts:{},myId:0,myTeam:0,info:new Map(),
  H:SW.effective('swift'),me:{al:0,hp:100,mh:100,en:100,ht:0,ov:0,ms:0,fl:0,w:0,lk:0,lp:0,rs:0,out:0,sh:0,iv:0,sc:0,ack:0,ep:0},
  pred:null,acc:0,
  buf:[],playT:null,evq:[],interval:66,jit:8,lastArr:0,delay:110,
  rd:{drones:[],missiles:[],sites:[]},siteInfo:new Map(),maxHp:new Map(),
  feed:[],msgs:[],dmgDirs:[],radioQ:[],hint:null,g:null,runInfo:null,objText:'',
  pose:{x:0,y:200,z:0,yaw:0,pitch:0,roll:0,spd:40},vel:[0,0,-40],
  hitT:0,hitKill:false,hurtT:0,flashT:0,boostK:0,boosting:false,trauma:0,aimHit:false,laserLock:false,warnLevel:0,
  phase:'count',phaseT:0,paused:false,spectating:false,specId:0,specName:'',killer:'',noRespawn:false,netNote:'',
  ringIdx:0,ringTarget:null,radarRange:650,tracerAcc:new Map(),lastCount:-1,mp:{},
  cb:{},   // колбэки страницы: round_end, closed ...
};
C.hull=C.H;
SW.Client=C;
const S=()=>SW.Meta?SW.Meta.S:{};

// ---------- запуск ----------
C.init=function(){
  C.touch=I.touch;
  I.hooks={cam:()=>SW.View&&SW.View.toggleCam(),pause:()=>C.togglePause(),score:v=>C.cb.score&&C.cb.score(v),mute:()=>{A.mute();C.toast(A.muted?'Звук выключен':'Звук включён')},
    radio:n=>C.say(n),help:()=>C.cb.help&&C.cb.help()};
};
C.toast=function(t){C.msgs.push({t:C.now,text:t,small:true,life:2.2,col:'#ffe27a'})};
C.say=function(n){if(PHRASES[n]&&C.scene==='game')NET.send({action:'emote',e:n})};
C.togglePause=function(){
  if(C.scene!=='game')return;
  if(NET.solo){C.paused=!C.paused;NET.send({action:'pause',on:C.paused});C.cb.pause&&C.cb.pause(C.paused)}
  else C.cb.pause&&C.cb.pause(null);
};

// ---------- начало раунда ----------
C.resetState=function(){
  C.buf.length=0;C.evq.length=0;C.playT=null;C.pred=null;C.acc=0;
  C.feed.length=0;C.msgs.length=0;C.dmgDirs.length=0;C.radioQ.length=0;C.hint=null;C.killer='';C.noRespawn=false;C.spectating=false;
  C.hitT=C.hurtT=C.flashT=0;C.trauma=0;C.maxHp.clear();C.siteInfo.clear();C.tracerAcc.clear();C.g=null;C.lastCount=-1;C.objText='';
  C.rd.drones.length=C.rd.missiles.length=C.rd.sites.length=0;C.ringIdx=0;C.ringTarget=null;C.paused=false;C.phase='count';
  C.me={al:0,hp:100,mh:100,en:100,ht:0,ov:0,ms:0,fl:0,w:0,lk:0,lp:0,rs:0,out:0,sh:0,iv:0,sc:0,ack:0,ep:0};
};
C.startRound=function(m){
  C.resetState();
  C.mode=m.mode;C.opts=m.opts||{};C.myId=m.you;C.runInfo=m.dir&&m.dir.k==='run'?m.dir:null;
  C.world=SW.makeWorld(m.map,m.seed);
  if(C.world.hash!==m.wh)console.warn('[стрижи] мир собрался иначе, чем у хоста',C.world.hash,m.wh);
  R.loadWorld(C.world);R.clearEntities();
  C.info.clear();for(const d of m.dr)C.info.set(d.id,d);
  const mine=C.info.get(C.myId);C.myTeam=mine?mine.team:0;
  C.H=SW.effective(mine?mine.hull:'swift',mine?mine.mods:[]);C.hull=C.H;
  C.pred=new SW.Predictor(C.world,C.H);
  for(const s of m.sites){
    const [idx,type,x,y,z,hp,mh,al]=s;
    R.ensureSite(idx,type,x,y,z);
    C.siteInfo.set(idx,{idx,type,x,y,z,hp,maxhp:mh,alive:!!al,r:SW.SITES[type].r,tg:0,firing:false,invul:false});
  }
  R.setPickups(C.world,m.pk);
  R.setRings(C.runInfo?C.runInfo.rings:null);
  if(C.runInfo)C.objText=C.runInfo.objText||'';
  C.phase=m.phase;C.phaseT=m.pt/10;
  C.scene='game';
  I.setActive(true);
  if(SW.View)SW.View.enterGame();
  A.music('battle');
  if(C.runInfo&&C.runInfo.mi===0)C.hint={text:C.touch?'Левый палец — курс и высота · справа: огонь, ракета, ловушки, форсаж':'Мышь или WASD — курс · ЛКМ/Пробел — огонь · Shift — форсаж · F — ракета · G — ловушки',until:C.now+14};
  if(C.cb.round)C.cb.round(m);
};
C.leaveGame=function(){
  C.scene='menu';I.setActive(false);A.laserOn(false);A.engine(0,false,false);
  R.clearEntities();C.me.al=0;
};
// список живых участников: для ангара/лобби и таблицы
C.roster=function(m){
  const seen=new Set();
  for(const d of m.dr){
    seen.add(d.id);
    const old=C.info.get(d.id);
    C.info.set(d.id,d);
    if(old&&(old.hull!==d.hull||JSON.stringify(old.skin)!==JSON.stringify(d.skin)))R.removeDrone(d.id); // перерисуем с новым видом
  }
  for(const [id,d] of C.info)if(!seen.has(id)&&!d.foe){C.info.delete(id);R.removeDrone(id)}
};

// ---------- снимки ----------
C.onSnap=function(m){
  const b=C.buf,last=b[b.length-1];
  if(last&&m.t<=last.t)return;
  const now=performance.now();
  if(C.lastArr){
    const dt=now-C.lastArr;
    C.interval=C.interval*.9+dt*.1;C.jit=C.jit*.92+Math.abs(dt-C.interval)*.08;
  }
  C.lastArr=now;
  const e={t:m.t,at:now,dm:new Map(),mm:new Map(),ss:m.s,g:m.g,ph:m.ph};
  for(const r of m.d){
    const flags=r[9],o={id:r[0],x:r[1]/10,y:r[2]/10,z:r[3]/10,yaw:r[4]/1000,pitch:r[5]/1000,roll:r[6]/100,spd:r[7]/10,hp:r[8],flags,laser:r.length>10?[r[10]/10,r[11]/1000,r[12]/1000]:null,
      foeHull:flags&256?SW.HULL_CODES[flags>>10]:null};
    e.dm.set(o.id,o);
    if(o.hp>(C.maxHp.get(o.id)||0))C.maxHp.set(o.id,o.hp);
  }
  for(const r of m.m)e.mm.set(r[0],{id:r[0],x:r[1]/10,y:r[2]/10,z:r[3]/10,yaw:r[4]/100,pitch:r[5]/100,tg:r[6],kindN:r[7],decoy:r[8]});
  b.push(e);if(b.length>16)b.shift();
  C.g=m.g;C.phase=m.ph;C.phaseT=m.pt/10;
  if(m.ev)for(const ev of m.ev)C.evq.push({t:m.t,ev});
  // состояние зениток — без интерполяции
  const alive=new Set();
  for(const r of m.s){
    const s=C.siteInfo.get(r[0]);if(!s)continue;
    alive.add(r[0]);s.hp=r[1];s.tg=r[2];s.firing=!!r[3];s.alive=true;
  }
  for(const s of C.siteInfo.values())if(!alive.has(s.idx))s.alive=false;
  if(C.g&&C.g.k==='run')C.ringIdx=C.g.ri;
};

// ---------- личное состояние: предсказание и сверка (см. predict.js) ----------
// C.P — текущее предсказанное состояние своего дрона, C.Pp — предыдущий шаг (для плавной отрисовки между шагами)
Object.defineProperty(C,'P',{get(){return C.pred?C.pred.P:null}});
Object.defineProperty(C,'Pp',{get(){return C.pred?C.pred.Pp:null}});
Object.defineProperty(C,'seq',{get(){return C.pred?C.pred.seq:0}});
Object.defineProperty(C,'ep',{get(){return C.pred?C.pred.ep:-1}});
C.onMe=function(m){
  const was=C.me;C.me=m;
  if(!m.al&&was.al===1)C.onDeath();
  if(m.al&&was.al===0)C.onSpawn();
  if(C.pred)C.pred.reconcile(m);
};
C.onDeath=function(){
  C.flashT=.35;
  if(C.mode==='run'&&C.g&&C.g.lv===0)C.noRespawn=true;
};
C.onSpawn=function(){C.killer='';C.noRespawn=false;C.spectating=false;C.hurtT=0;if(SW.View)SW.View.snapCamera()};

// Один шаг предсказания (30 раз в секунду): берём ввод, отправляем, двигаем свой дрон
C.stepOwn=function(){
  const s=I.sample(),me=C.me,pred=C.pred;
  if(!pred)return;
  const cmd={y:r2(s.y),p:r2(s.p),t:s.t,f:s.f,l:s.l};
  const move=!!pred.P&&me.al===1&&C.phase!=='count'&&!C.paused;
  const seq=pred.step(cmd,move);
  NET.send({action:'in',y:cmd.y,p:cmd.p,t:cmd.t,f:cmd.f,l:cmd.l,m:I.cnt.m,r:I.cnt.r,w:I.cnt.w,s:seq});
  if(!move)return;
  const P=pred.P;
  C.boosting=P.boost;
  // свои трассеры сразу, не дожидаясь комнаты
  C.laserLock=me.w===1&&me.en<12;
  if(s.f&&!me.ov&&!(me.w===1&&C.H.laser>0)){
    C.mp.acc=(C.mp.acc||0)+TICK;
    const per=SW.W.cannon.cd/C.H.gunRate;
    while(C.mp.acc>=per){
      C.mp.acc-=per;
      const f=SW.fwd(P.yaw,P.pitch),m=SW.Flight.muzzle(P,Math.random()<.5?-1:1),sp=.014,sv=P.spd;
      F.tracer(m[0],m[1],m[2],f[0]*300+f[0]*sv+(Math.random()-.5)*sp*300,f[1]*300+f[1]*sv+(Math.random()-.5)*sp*300,f[2]*300+f[2]*sv+(Math.random()-.5)*sp*300,.5,7,0x9cf3ff);
      if(Math.random()<.35)A.play('cannon',{vol:.7});
    }
  }
};

// ---------- события боя ----------
C.nameOf=function(id){
  if(id>=1000){const s=C.siteInfo.get(id-1000);return s?SW.SITES[s.type].name:'Зенитка'}
  if(id===0)return '—';
  const i=C.info.get(id);if(i)return i.name;
  const d=C.rd.drones.find(x=>x.id===id);
  return d&&d.foeHull?SW.FOES[d.foeHull].name:'Пилот';
};
C.posOf=function(id){
  if(id>=1000){const s=C.siteInfo.get(id-1000);return s?[s.x,s.y,s.z]:null}
  if(id===C.myId&&C.P)return [C.P.x,C.P.y,C.P.z];
  const d=C.rd.drones.find(x=>x.id===id);return d?[d.x,d.y,d.z]:null;
};
C.shake=function(v){C.trauma=Math.min(1,C.trauma+v)};
C.addFeed=function(text,col,me){C.feed.unshift({text,col,me,until:C.now+6.5});if(C.feed.length>5)C.feed.pop()};
C.addMsg=function(text,col,small,life){C.msgs.unshift({t:C.now,text,col,small,life});if(C.msgs.length>3)C.msgs.length=3};
const KILL_MSG=['Сбит','Лазерный удар','Ракета в цель','Зенитка уничтожена','Крушение','Таран','Сбит','Зенитка'];
C.onEvent=function(ev,old){
  const k=ev[0],me=C.myId,cam=R.cam.position;
  switch(k){
    case'x':{
      const [,kind,x,y,z,size]=ev;
      F.explosion(x,y,z,size||4,kind);
      if(kind>=1&&!old){
        A.play('boom',{pos:[x,y,z],size,vol:kind===4?.4:1});
        const d=Math.hypot(x-cam.x,y-cam.y,z-cam.z);
        if(d<260)C.shake(clamp((kind===3?.5:.28)*(1-d/260)*(size>6?1.2:1),0,.7));
      }else if(kind===0&&!old&&Math.random()<.4)A.play('hit',{pos:[x,y,z],vol:.35});
      break;
    }
    case'h':{
      const [,by,vic,dmg,x,y,z]=ev;
      if(by===me&&vic!==me){C.hitT=.25;if(C.now-(C.hitKillAt||-9)>.5)C.hitKill=false;A.play('hit');C.mp.dmgDone=(C.mp.dmgDone||0)+dmg}
      if(vic===me){
        C.hurtT=Math.min(.6,C.hurtT+dmg/90);C.shake(clamp(dmg/90,.08,.45));
        if(!old){A.play('hurt',{vol:clamp(dmg/30,.35,1)})}
        const src=C.posOf(by);
        if(src)C.dmgDirs.push({t:C.now,x:src[0],y:src[1],z:src[2]});
        if(C.dmgDirs.length>6)C.dmgDirs.shift();
      }
      break;
    }
    case'k':{
      const [,killer,vic,how]=ev;
      const kn=C.nameOf(killer),vn=C.nameOf(vic);
      const mineK=killer===me,mineV=vic===me;
      const friend=(i)=>{const a=C.info.get(i);return a&&a.team===C.myTeam};
      if(vic<1000||true){
        const txt=killer?`${kn}  ✦  ${vn}`:`${vn}  ✦  ${HOW[how]||''}`;
        C.addFeed(txt,mineK?'#5dff9a':mineV?'#ff7b88':'#eaf7ff',mineK||mineV);
      }
      if(mineK&&vic!==me){
        C.hitKill=true;C.hitKillAt=C.now;C.hitT=.35;A.play('kill');
        const foeInfo=vic>=1000?SW.SITES[(C.siteInfo.get(vic-1000)||{}).type]:null;
        C.addMsg(vic>=1000?`+${foeInfo?foeInfo.score:100} ${foeInfo?foeInfo.name:''}`:KILL_MSG[how]||'Сбит',how===2||how===3?'#ffb347':'#5dff9a',false,1.8);
        C.mp.kills=(C.mp.kills||0)+1;
        if(C.me.sc!=null&&vic<1000)C.streak=(C.streak||0)+1;
      }
      if(mineV){
        C.killer=killer?`Сбил ${kn}`:'Вы разбились';
        if(!killer)C.killer=HOW[how]==='о землю'?'Вы врезались':'Вы потеряны вне зоны';
        C.streak=0;
      }
      break;
    }
    case'm':{
      const [,mid,by,kindN,x,y,z]=ev;
      if(!old)A.play('missile',{pos:[x,y,z],vol:by===me?.7:1});
      break;
    }
    case'f':{
      const [,by,x,y,z,vx,vy,vz]=ev;
      F.flare(x,y,z,vx,vy,vz);
      if(!old)A.play('flare',{pos:[x,y,z]});
      break;
    }
    case'pk':{
      const [,spot,by,kind]=ev;
      const p=R.pickups[spot];if(p){p.on=false;F.glowP(p.g.position.x,p.g.position.y,p.g.position.z,0,0,0,.4,10,2,.6,1,.8,.8,0,0)}
      if(by===me){
        A.play('pickup');C.addMsg(SW.PICKS[SW.PICK_IDS[kind]].name,'#5dff9a',true,1.4);C.mp.pk=(C.mp.pk||0)+1;
      }
      break;
    }
    case'pr':{const p=R.pickups[ev[1]];if(p)p.on=true;break}
    case'ring':{
      const [,by,idx,next]=ev;
      const r=C.runInfo&&C.runInfo.rings&&C.runInfo.rings[idx];
      if(r){F.shock(r[0],r[1],r[2],r[6]*1.5,1,.85,.3,.6);F.sparks(r[0],r[1],r[2],20,22)}
      if(by===me){A.play('ring');C.addMsg('Кольцо '+next+(C.runInfo?' / '+C.runInfo.rings.length:''),'#ffe27a',false,1.5);C.mp.rings=(C.mp.rings||0)+1}
      break;
    }
    case'say':{
      C.radioQ.push({who:ev[1],text:ev[2],t:C.now});
      if(C.cb.radio)C.cb.radio(ev[1],ev[2]);
      if(!old)A.play('radio');
      break;
    }
    case'rad':{
      const name=C.nameOf(ev[1]),ph=PHRASES[ev[2]];
      if(ph){C.addFeed(`${name}: «${ph}»`,'#9fe6ff',ev[1]===me);if(!old)A.play('radio',{vol:.6})}
      break;
    }
    case'wave':{
      C.addMsg(ev[2]?`ВОЛНА ${ev[1]} / ${ev[2]}`:`ВОЛНА ${ev[1]}`,'#ff7b88',false,2.4);
      break;
    }
    case'obj':{C.objText=ev[1];break}
    case'sp':{
      const [,id,x,y,z]=ev;
      F.glowP(x,y,z,0,0,0,.5,24,4,.5,.9,1,.8,0,0);F.shock(x,y,z,22,.4,.9,1,.6);
      if(id===me&&!old)A.play('ring',{vol:.5});
      break;
    }
    case'cr':{
      const [,id,imp,x,y,z]=ev;
      F.sparks(x,y,z,10,26);
      if(id===me){C.shake(clamp(imp/40,.2,.8));if(!old)A.play('crash')}
      break;
    }
    case't':{
      const [,x,y,z,vx,vy,vz,life]=ev;
      F.tracer(x,y,z,vx,vy,vz,Math.min(.7,life),9,0xffa24a);
      break;
    }
    case'go':{
      C.addMsg('В ПОЛЁТ!','#31e6ff',false,1.4);if(!old)A.play('go');
      break;
    }
    case'icp':{
      if(ev[1]===me){C.addMsg('Ракета сбита','#ffe27a',true,1.4);A.play('kill',{vol:.5});C.mp.icp=(C.mp.icp||0)+1}
      break;
    }
  }
};
// разыгрываем события, до времени которых дошло «прошлое» интерполяции
C.flushEvents=function(){
  const q=C.evq;
  if(C.playT==null)return;
  while(q.length&&q[0].t<=C.playT+8){
    const e=q.shift();
    C.onEvent(e.ev,C.playT-e.t>900);
  }
};

// ---------- воспроизведение снимков ----------
C.advancePlay=function(dt){
  const b=C.buf;if(!b.length)return;
  const newest=b[b.length-1];
  C.delay=clamp(C.interval*1.45+C.jit*2.2,NET.host?72:96,320);
  const target=newest.t-C.delay;
  if(C.playT==null||Math.abs(target-C.playT)>600)C.playT=target;
  else{C.playT+=dt*1000;C.playT+=(target-C.playT)*Math.min(1,dt*2.5)}
  // между какими снимками мы сейчас
  let a=null,bb=null;
  for(let i=b.length-1;i>=0;i--){if(b[i].t<=C.playT){a=b[i];bb=b[i+1]||null;break}}
  if(!a){a=b[0];C.playT=a.t}
  const k=bb?clamp((C.playT-a.t)/(bb.t-a.t),0,1):0;
  const ext=bb?0:Math.min(.15,(C.playT-a.t)/1000);
  // дроны
  const out=C.rd.drones;out.length=0;
  for(const [id,d0] of a.dm){
    if(id===C.myId)continue;
    const d1=bb&&bb.dm.get(id);
    const o={id,flags:d0.flags,foeHull:d0.foeHull,laser:d0.laser,info:C.info.get(id)};
    if(d1){
      o.x=lerp(d0.x,d1.x,k);o.y=lerp(d0.y,d1.y,k);o.z=lerp(d0.z,d1.z,k);o.yaw=angLerp(d0.yaw,d1.yaw,k);o.pitch=lerp(d0.pitch,d1.pitch,k);o.roll=lerp(d0.roll,d1.roll,k);
      o.spd=lerp(d0.spd,d1.spd,k);o.hp=d1.hp;o.flags=k>.5?d1.flags:d0.flags;if(k>.5)o.laser=d1.laser;
    }else{
      const cp=Math.cos(d0.pitch);
      o.x=d0.x-Math.sin(d0.yaw)*cp*d0.spd*ext;o.y=d0.y+Math.sin(d0.pitch)*d0.spd*ext;o.z=d0.z-Math.cos(d0.yaw)*cp*d0.spd*ext;
      o.yaw=d0.yaw;o.pitch=d0.pitch;o.roll=d0.roll;o.spd=d0.spd;o.hp=d0.hp;
    }
    const cp=Math.cos(o.pitch);o.vel=[-Math.sin(o.yaw)*cp*o.spd,Math.sin(o.pitch)*o.spd,-Math.cos(o.yaw)*cp*o.spd];
    o.mh=C.maxHp.get(id)||o.hp;
    if(o.foeHull&&!o.info){o.info={id,name:SW.FOES[o.foeHull].name,team:1,hull:o.foeHull,foe:true,skin:{}};C.info.set(id,o.info)}
    out.push(o);
  }
  // ракеты
  const mo=C.rd.missiles;mo.length=0;
  for(const [id,m0] of a.mm){
    const m1=bb&&bb.mm.get(id);
    if(m1)mo.push({id,x:lerp(m0.x,m1.x,k),y:lerp(m0.y,m1.y,k),z:lerp(m0.z,m1.z,k),yaw:m1.yaw,pitch:m1.pitch,tg:m1.tg,kindN:m0.kindN,decoy:m1.decoy});
    else{
      const cp=Math.cos(m0.pitch),sp=110*ext;
      mo.push({id,x:m0.x-Math.sin(m0.yaw)*cp*sp,y:m0.y+Math.sin(m0.pitch)*sp,z:m0.z-Math.cos(m0.yaw)*cp*sp,yaw:m0.yaw,pitch:m0.pitch,tg:m0.tg,kindN:m0.kindN,decoy:m0.decoy});
    }
  }
  // зенитки
  const so=C.rd.sites;so.length=0;
  for(const s of C.siteInfo.values())so.push(s);
  // фаза и обратный отсчёт
  if(C.phase==='count'){
    const n=Math.ceil(C.phaseT-.05);
    if(n!==C.lastCount&&n>0&&n<=3){C.lastCount=n;C.addMsg(String(n),'#eaf7ff',false,1);A.play('beep')}
  }
};
// видимые бонусы для радара
C.pickupsView=function(){
  const out=[];
  for(const p of R.pickups)if(p.on){const q=p.g.position;out.push({x:q.x,y:q.y,z:q.z})}
  return out;
};

// ---------- кадр ----------
C.frameFn=function(now){
  requestAnimationFrame(C.frameFn);
  const t=now/1000,dt=Math.min(.05,Math.max(.001,t-(C.t0||t)));C.t0=t;C.now=t;C.frame++;
  if(!R.renderer)return;
  if(C.scene==='game'&&C.world){C.frameGame(dt);R.adapt(dt)}
  else if(SW.View)SW.View.frameMenu(dt);
  if(C.hitT>0)C.hitT-=dt;
  C.hurtT=Math.max(0,C.hurtT-dt*1.2);C.flashT=Math.max(0,C.flashT-dt*1.5);C.trauma=Math.max(0,C.trauma-dt*1.6);
  SW.HUD.draw(C,dt);
};
C.frameGame=function(dt){
  const me=C.me;
  // 1) свой дрон — фиксированными шагами
  if(!C.paused){
    C.acc+=dt;let n=0;
    while(C.acc>=TICK&&n<4){C.stepOwn();C.acc-=TICK;n++}
    if(C.acc>TICK*4)C.acc=0;
  }
  // 2) чужие — из буфера снимков; события
  C.advancePlay(dt);
  C.flushEvents();
  // 3) поза своего дрона для отрисовки
  const P=C.P,Pp=C.Pp,po=C.pose;
  if(P){
    const a=C.paused?0:clamp(C.acc/TICK,0,1);
    po.x=lerp(Pp.x,P.x,a);po.y=lerp(Pp.y,P.y,a);po.z=lerp(Pp.z,P.z,a);po.yaw=angLerp(Pp.yaw,P.yaw,a);po.pitch=lerp(Pp.pitch,P.pitch,a);po.roll=lerp(Pp.roll,P.roll,a);po.spd=lerp(Pp.spd,P.spd,a);
    const cp=Math.cos(po.pitch);C.vel[0]=-Math.sin(po.yaw)*cp*po.spd;C.vel[1]=Math.sin(po.pitch)*po.spd;C.vel[2]=-Math.cos(po.yaw)*cp*po.spd;
  }
  C.boostK+=((C.boosting&&me.al===1?1:0)-C.boostK)*Math.min(1,dt*5);
  // 4) бонусы, кольца, ближайшее кольцо
  if(C.runInfo&&C.runInfo.rings){
    const i=Math.min(C.ringIdx,C.runInfo.rings.length-1),r=C.runInfo.rings[C.ringIdx];
    C.ringTarget=C.ringIdx<C.runInfo.rings.length?{x:r[0],y:r[1],z:r[2]}:null;
    R.updateRings(C.ringIdx,C.now);
  }else C.ringTarget=null;
  // 5) отрисовка сущностей и камера
  if(SW.View)SW.View.frameGame(dt);
  // 6) звук
  const warn=C.warnLevel;
  let lock=0;if(me.al===1&&me.lk){lock=me.lp>=1?2:1}
  A.engine(C.pose.spd,C.boosting,me.al===1&&!C.paused);
  A.laserOn(me.al===1&&me.w===1&&I.sample().f&&me.en>2&&!C.paused);
  A.signals(dt,me.al===1?warn:0,lock,me.lp);
  // 7) радио: очередь реплик к странице
  // 8) связь
  const lag=performance.now()-C.lastArr;
  C.netNote=!NET.online()&&!NET.solo?'🔄 Переподключение…':(C.lastArr&&lag>1600&&!NET.solo?'🐢 Создатель игры не отвечает…':'');
  if(C.paused)C.netNote='⏸ Пауза';
};

// ---------- обработка сообщений комнаты ----------
C.onNet=function(m){
  switch(m.type){
    case'round':C.startRound(m);break;
    case'snap':if(C.scene==='game')C.onSnap(m);break;
    case'me':if(C.scene==='game')C.onMe(m);break;
    case'roster':C.roster(m);break;
    case'round_end':if(C.cb.roundEnd)C.cb.roundEnd(m);if(m.result){A.play(m.result.win===false||m.result.winner&&m.result.winner!==C.myId&&m.result.mode==='ffa'?'lose':'win')}break;
  }
};
C.phrases=PHRASES;
})(typeof window!=='undefined'?window:globalThis);
