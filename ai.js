// «Стрижи» — ИИ пилотов: боты в схватках, ведомые и дроны СТРАЖа. Выдаёт тот же ввод (d.in), что и живой игрок:
// стик по курсу и тангажу, тягу, огонь, пуск ракеты, ловушки. Поэтому у ботов те же ограничения полёта, что и у людей.
//
// Решение за тик: 1) кого атаковать  2) нет ли ракеты в хвосте  3) куда лететь  4) не врежусь ли  5) как довернуть и стрелять.
// Сложность (SW.DIFF) меняет реакцию, разброс прицела, упреждение, шанс уклониться и частоту ракет.
(function(root){
'use strict';
const SW=root.SW;
const {clamp,angDiff}=SW;
const F=[0,0,0],_t=[0,0,0],_v=[0,0,0],_a1={yaw:0,pitch:0},_a2={yaw:0,pitch:0};
const PROBES=[[0,0],[.4,0],[-.4,0],[0,.45],[0,-.4],[.8,0],[-.8,0],[.8,.4],[-.8,.4],[0,1.0],[1.3,.3],[-1.3,.3]]; // [рыскание, тангаж] от носа

// направление (yaw,pitch) → единичный вектор
function dirOf(yaw,pitch,out){const cp=Math.cos(pitch);out[0]=-Math.sin(yaw)*cp;out[1]=Math.sin(pitch);out[2]=-Math.cos(yaw)*cp;return out}

const AI={
  attach(A,d){
    d.ai={rt:A.rand()*.4,tgt:0,wp:null,evade:0,evDir:1,mslT:2+A.rand()*4,probeT:0,los:true,losT:0,avoid:null,avoidT:0,errT:0,err:[0,0,0],
      flareT:0,seen:null,leader:0,forceLock:0,pickT:0,mode:'',weapT:0,cx:0,cz:0,ph:A.rand()*6.28,style:(d.H.ai&&d.H.ai.style)||'fighter'};
    if(d.kind==='wing')d.ai.style='wing';
  },
  reset(A,d){const a=d.ai;if(!a)return;a.tgt=0;a.wp=null;a.evade=0;a.avoid=null;a.mslT=2+A.rand()*4},

  think(A,d,dt){
    const ai=d.ai,I=d.in,D=SW.DIFF[d.diff]||SW.DIFF.normal,H=d.H,W=A.world;
    ai.rt-=dt;ai.mslT-=dt;ai.probeT-=dt;ai.evade-=dt;ai.losT-=dt;ai.errT-=dt;ai.flareT-=dt;ai.weapT-=dt;
    I.fire=0;I.thr=0;
    if(A.phase==='count')return;
    // --- 1. цель ---
    if(ai.rt<=0){ai.rt=D.react*(1.4+A.rand()*.8);ai.tgt=AI.pickTarget(A,d)}
    let T=ai.tgt?A.target(ai.tgt):null;
    if(T&&!T.alive){ai.tgt=0;T=null}
    const tx0=T?T.x:0,ty0=T?(T.isDrone?T.y:T.y+T.r*.5):0,tz0=T?T.z:0;
    const dist=T?Math.hypot(tx0-d.x,ty0-d.y,tz0-d.z):1e9;
    if(T&&ai.losT<=0){ai.losT=.25;ai.los=W.los(d.x,d.y,d.z,tx0,ty0,tz0)}
    // разброс прицела обновляется раз в пол-секунды
    if(ai.errT<=0){ai.errT=.35+A.rand()*.3;const e=D.aim;ai.err[0]=(A.rand()-.5)*2*e;ai.err[1]=(A.rand()-.5)*2*e;ai.err[2]=(A.rand()-.5)*2*e}
    // --- 2. угроза: ракета, летящая в нас ---
    let inc=null,incD=1e9;
    for(const m of A.missiles){
      if(m.tg!==d.id)continue;
      const dd=Math.hypot(m.x-d.x,m.y-d.y,m.z-d.z);
      if(dd<incD){incD=dd;inc=m}
    }
    if(inc&&incD<460){
      if(ai.seen!==inc){ // новая угроза: решаем, заметили ли мы её и как реагируем
        ai.seen=inc;ai.reacts=A.rand()<D.evade;ai.flares=1+(A.rand()<.4?1:0);
      }
      if(ai.reacts){
        if(incD<260&&ai.flares>0&&ai.flareT<=0&&d.flares>0){I.dropFlare=true;ai.flares--;ai.flareT=.5}
        if(incD<240&&ai.evade<=0){ai.evade=1.1+A.rand()*.5;ai.evDir=A.rand()<.5?-1:1;ai.evUp=A.rand()<.5?-1:1}
      }
    }else ai.seen=null;
    // --- 3. куда лететь ---
    let wx,wy,wz,fire=false,mode='patrol',thrWant=0;
    const style=ai.style;
    if(ai.evade>0&&inc){
      // «бочка»: резкий разворот поперёк линии ракеты
      mode='evade';
      const mx=d.x-inc.x,mz=d.z-inc.z,ml=Math.hypot(mx,mz)||1;
      wx=d.x+(-mz/ml)*ai.evDir*200;wz=d.z+(mx/ml)*ai.evDir*200;wy=d.y+ai.evUp*70;
      thrWant=1;
    }else if(ai.goal&&!(T&&dist<260)){
      // заданная точка (автопилот в тестах и «лети сюда» для сценариев)
      mode='goal';wx=ai.goal.x;wy=ai.goal.y;wz=ai.goal.z;
      thrWant=Math.hypot(wx-d.x,wy-d.y,wz-d.z)>260?1:0;
    }else if(T&&(style!=='wing'||dist<650||ai.hunter)){
      mode='attack';
      let px=tx0,py=ty0,pz=tz0;
      if(T.isDrone&&style!=='ram'){
        // упреждение: где цель будет, когда долетит пуля
        const tv=A.vel(T,_t),t=Math.min(1.4,dist/SW.W.cannon.speed*D.lead);
        px+=tv[0]*t;py+=tv[1]*t;pz+=tv[2]*t;
      }else if(style==='ram'&&T.isDrone){const tv=A.vel(T,_t),t=Math.min(.8,dist/90);px+=tv[0]*t;py+=tv[1]*t;pz+=tv[2]*t}
      wx=px+ai.err[0]*dist;wy=py+ai.err[1]*dist;wz=pz+ai.err[2]*dist;
      if(style==='carrier'){ // «Матка» медленно кружит над картой
        ai.ph+=dt*.12;wx=Math.cos(ai.ph)*260;wz=Math.sin(ai.ph)*260;wy=190+Math.sin(ai.ph*1.7)*30;
      }
      // стрельба
      const range=(H.ai&&H.ai.range)||(T.isDrone?300:380);
      fire=ai.los&&dist<range&&style!=='ram'&&style!=='carrier';
      if(style==='carrier')fire=ai.los&&dist<range&&H.gun>0;
      if(style==='ram'){thrWant=dist>80?1:0}
      else if(dist>330)thrWant=1;
      else if(dist<110)thrWant=-1;
      // пуск ракеты
      if(T.isDrone||style==='wing'||d.kind==='wing'){
        const wantM=H.missiles>0&&ai.mslT<=0&&dist<(SW.W.missile.lockRange*.9)&&dist>120&&ai.los;
        if(wantM){
          if(d.kind==='foe'){
            // враги стреляют ракетой в сторону цели, захват не нужен
            dirOf(d.yaw,d.pitch,F);
            const c=((tx0-d.x)*F[0]+(ty0-d.y)*F[1]+(tz0-d.z)*F[2])/dist;
            if(c>.78){ai.forceLock=T.id;I.fireMissile=true;ai.mslT=((H.ai&&H.ai.missileEvery)||6)*(.8+A.rand()*.5)}
          }else if(d.locked&&A.rand()<D.missileP){I.fireMissile=true;ai.mslT=3+A.rand()*5}
        }
      }
    }else if(style==='wing'){
      // ведомый держится рядом с ведущим
      mode='follow';
      const L=AI.leader(A,d);
      if(L){
        const cp=Math.cos(L.pitch),fx=-Math.sin(L.yaw)*cp,fz=-Math.cos(L.yaw)*cp,rx=Math.cos(L.yaw),rz=-Math.sin(L.yaw);
        const side=d.id%2?1:-1;
        wx=L.x-fx*40+rx*side*38;wy=L.y+6;wz=L.z-fz*40+rz*side*38;
        const dd=Math.hypot(wx-d.x,wy-d.y,wz-d.z);
        thrWant=dd>180?1:dd<30?-1:0;
        if(dd<45){wx=L.x+fx*120;wy=L.y;wz=L.z+fz*120}
      }else{wx=0;wy=150;wz=0}
    }else{
      // патруль: случайные точки в небе
      if(!ai.wp||Math.hypot(ai.wp.x-d.x,ai.wp.y-d.y,ai.wp.z-d.z)<70){
        const p=W.freePoint(A.rand,70,230,120,16);ai.wp=p;
      }
      wx=ai.wp.x;wy=ai.wp.y;wz=ai.wp.z;
    }
    // бонус, если ранен и рядом ремкомплект
    if(mode!=='evade'&&(d.kind==='bot'||d.kind==='wing')&&d.hp<d.maxhp*.45){
      const p=AI.nearPickup(A,d,'hp',520);
      if(p){wx=p.x;wy=p.y;wz=p.z;mode='pickup';fire=false}
    }
    ai.mode=mode;
    // --- 4. обход препятствий и границ ---
    const half=W.half;
    if(Math.abs(d.x)>half*.86||Math.abs(d.z)>half*.86){
      wx=wx*.2-d.x*.8;wz=wz*.2-d.z*.8;wy=Math.max(wy,110);
    }
    if(ai.probeT<=0){
      ai.probeT=.07;
      ai.avoid=AI.probe(A,d,wx,wy,wz);
    }
    let useAvoid=ai.avoid;
    // --- 5. рули ---
    let ang;
    if(useAvoid){ang=SW.angles(useAvoid.x,useAvoid.y,useAvoid.z,_a1);thrWant=Math.min(thrWant,0)}
    else ang=SW.angles(wx-d.x,wy-d.y,wz-d.z,_a1);
    let ey=angDiff(d.yaw,ang.yaw),ep=ang.pitch-d.pitch;
    // уклончивый «зигзаг», если по нам стреляют
    if(mode==='attack'&&A.t-d.lastT<1.6&&D.evade>.4)ey+=Math.sin(A.t*3.1+ai.ph)*.28*D.evade;
    I.yaw=clamp(-ey*2.4,-1,1);
    I.pitch=clamp(ep*2.4,-1,1);
    // пол и потолок
    if(d.y<32&&d.pitch<.25)I.pitch=Math.max(I.pitch,.8);
    else if(d.y>W.ceil-28)I.pitch=Math.min(I.pitch,-.8);
    I.lvl=0;
    // тяга: тормозим на крутых поворотах вблизи цели, форсируем при погоне и уклонении
    if(Math.abs(ey)>1.2&&dist<220&&mode==='attack')thrWant=Math.min(thrWant,-1);
    I.thr=thrWant>0?(d.energy>(mode==='evade'?5:35)?1:0):thrWant;
    if(style==='ram')I.thr=d.energy>5?1:0;
    // огонь по прицелу: направление носа к точке упреждения
    if(fire&&!useAvoid){
      const hit=SW.W.cannon.hit;
      const cone=(T&&T.isDrone?D.fire:D.fire*.7)+(T?((T.H?T.H.r:T.r)||2)/Math.max(30,dist):0);
      if(Math.abs(ey)<cone*1.6&&Math.abs(ep)<cone*1.6){
        // лазер у «Тени» на средней дистанции, иначе пушка
        if(d.H.laser>1.2&&d.energy>35&&dist<300){if(d.weapon!==1&&ai.weapT<=0){I.swap=true;ai.weapT=1}}
        else if(d.weapon===1&&ai.weapT<=0){I.swap=true;ai.weapT=1}
        I.fire=1;
      }
    }
  },

  // выбор цели: ближайший враг, которого мы «видим» и который перед носом
  pickTarget(A,d){
    const ai=d.ai,style=ai.style;
    dirOf(d.yaw,d.pitch,F);
    let best=0,bs=-1e9;
    const consider=(t,id,isSite)=>{
      const dx=t.x-d.x,dy=t.y-d.y,dz=t.z-d.z,dist=Math.hypot(dx,dy,dz);
      if(dist>1700)return;
      const c=clamp((dx*F[0]+dy*F[1]+dz*F[2])/(dist||1),-1,1);
      let s=-dist-Math.acos(c)*260+(id===ai.tgt?220:0);
      if(isSite)s-=(style==='wing'||ai.hunter?500:3000); // зенитки — только если ничего другого нет
      if(t.isDrone&&t.hp<t.maxhp*.35)s+=120;
      if(style==='ram'&&t.kind!=='human')s-=400; // камикадзе охотятся за людьми
      if(s>bs){bs=s;best=id}
    };
    for(const e of A.drones)if(e.alive&&e!==d&&A.enemy(d,e)&&!(e.invT>1.5))consider(e,e.id,false);
    if(style==='wing'||d.kind==='wing'||ai.hunter)for(const s of A.sites)if(s.alive&&s.team!==d.team&&s.type!=='pylon'||s.alive&&s.team!==d.team&&s.type==='pylon'&&!A.sites.some(x=>x.alive&&x.team!==d.team&&x.type==='sam'))consider({x:s.x,y:s.y+s.r*.5,z:s.z},1000+s.idx,true);
    return best;
  },
  leader(A,d){
    let best=null,bd=1e9;
    for(const e of A.drones)if(e.alive&&e.kind==='human'&&e.team===d.team){const dd=Math.hypot(e.x-d.x,e.z-d.z);if(dd<bd){bd=dd;best=e}}
    return best;
  },
  nearPickup(A,d,kind,maxD){
    let best=null,bd=maxD;
    for(const p of A.pickups)if(p.on&&p.kind===kind){const dd=Math.hypot(p.x-d.x,p.y-d.y,p.z-d.z);if(dd<bd){bd=dd;best=p}}
    return best;
  },

  // Не врежусь ли? Бросаем лучи вперёд; если путь к цели закрыт — возвращаем направление, где свободно, иначе null.
  probe(A,d,wx,wy,wz){
    const W=A.world,L=Math.max(70,d.spd*1.55+25);
    const ds=SW.angles(wx-d.x,wy-d.y,wz-d.z,_a2);
    // прямой луч в сторону цели и вперёд по курсу
    dirOf(d.yaw,d.pitch,F);
    const t0=W.rayHit(d.x,d.y,d.z,F[0],F[1],F[2],L);
    if(t0<0){
      // впереди чисто; но если до цели путь закрыт и стена ближе, всё равно не торопимся менять курс
      return null;
    }
    // впереди стена. Ищем лучшее направление среди пробников вокруг носа
    let best=null,bs=-1e9;
    for(const pr of PROBES){
      const yaw=d.yaw+pr[0],pitch=clamp(d.pitch+pr[1],-1.2,1.2);
      dirOf(yaw,pitch,_v);
      const t=W.rayHit(d.x,d.y,d.z,_v[0],_v[1],_v[2],L*1.1);
      const free=t<0?L*1.1:t;
      // чем свободнее и чем ближе к желаемому направлению — тем лучше; вверх выбираем охотнее
      const toward=Math.cos(angDiff(yaw,ds.yaw))*.5+Math.cos(pitch-ds.pitch)*.2;
      const sc=free+toward*L*.35+(pr[1]>0?L*.12:0)-Math.abs(pr[0])*10;
      if(sc>bs){bs=sc;best=[_v[0],_v[1],_v[2]];}
    }
    // чуть сильнее, если стена совсем рядом
    return best?{x:best[0],y:best[1],z:best[2],w:1-t0/L}:null;
  },
};
SW.AI=AI;
})(typeof window!=='undefined'?window:globalThis);
