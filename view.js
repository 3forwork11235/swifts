// «Стрижи» — что и откуда показывать: камера (за дроном, из кабины, наблюдение, после гибели), отрисовка сущностей боя,
// а также живой фон меню (город с пролетающими дронами) и сцена ангара.
(function(root){
'use strict';
const SW=root.SW,T=root.THREE,R=SW.Render,F=SW.FX,A=SW.Audio;
const {clamp,lerp,angLerp,angDiff}=SW;
const C=()=>SW.Client;
const MENU_IDS=[9001,9002,9003,9004,9005,9006];
const _q=new T.Quaternion(),_v=new T.Vector3(),_z=new T.Vector3(0,0,1);

const V={
  camMode:'chase',cy:0,cp:0,cpos:new T.Vector3(),deadPos:null,deadT:0,specId:0,menuScene:'menu',menuT:0,heroLoad:null,laserN:0,
  toggleCam(){
    const c=C();
    if(c.me.al!==1||c.spectating){V.cycleSpec();return}
    V.camMode=V.camMode==='chase'?'fpv':'chase';
    c.toast(V.camMode==='fpv'?'Вид из кабины':'Вид сзади');
  },
  cycleSpec(){
    const c=C(),list=c.rd.drones.filter(d=>(d.flags&1)&&d.info&&d.info.team===c.myTeam&&!d.foeHull);
    if(!list.length)return;
    const i=list.findIndex(d=>d.id===V.specId);V.specId=list[(i+1)%list.length].id;
  },
  enterGame(){
    V.camMode='chase';V.deadPos=null;V.specId=0;V.snapCamera();
    for(const id of MENU_IDS.concat([9000]))R.removeDrone(id);
  },
  snapCamera(){V.cy=C().pose.yaw;V.cp=C().pose.pitch*.7;V.cpos.set(C().pose.x,C().pose.y,C().pose.z);V.deadPos=null;V.deadT=0},

  // ---------- бой ----------
  frameGame(dt){
    const c=C(),me=c.me,po=c.pose,S=SW.Meta?SW.Meta.S:{},now=c.now;
    const seen=new Set();
    // свой дрон
    const mine=c.info.get(c.myId);
    const vis=me.al===1&&c.P&&!c.spectating;
    if(vis){
      if(!R.drones.get(c.myId))R.addDrone(c.myId,{hull:mine?mine.hull:'swift',skin:mine?mine.skin:{}});
      R.updateDrone(c.myId,{x:po.x,y:po.y,z:po.z,yaw:po.yaw,pitch:po.pitch,roll:po.roll,spd:po.spd,hp:me.hp,maxhp:me.mh,alive:true,
        flags:1|(c.boosting?2:0)|(me.sh>0?16:0)|(me.iv>0?32:0)|(c.firing?4:0)},dt);
      const g=R.drones.get(c.myId);if(V.camMode==='fpv'&&g)g.group.visible=false;
      seen.add(c.myId);
    }else{const g=R.drones.get(c.myId);if(g)g.group.visible=false}
    // чужие
    const tg=c.tracerAcc;
    for(const e of c.rd.drones){
      seen.add(e.id);
      let o=R.drones.get(e.id);
      if(!o){
        const foe=!!e.foeHull;
        o=R.addDrone(e.id,{hull:foe?e.foeHull:(e.info?e.info.hull:'swift'),foe,skin:e.info?e.info.skin:{}});
      }
      R.updateDrone(e.id,{x:e.x,y:e.y,z:e.z,yaw:e.yaw,pitch:e.pitch,roll:e.roll,spd:e.spd,hp:e.hp,maxhp:e.mh,flags:e.flags,alive:!!(e.flags&1)},dt);
      if(!(e.flags&1))continue;
      const d=Math.hypot(e.x-po.x,e.y-po.y,e.z-po.z),fwd=SW.fwd(e.yaw,e.pitch);
      const foe=!!e.foeHull;
      // стрельба: трассеры рисуем сами по флагу «стреляет»
      if(e.flags&4){
        let a=(tg.get(e.id)||0)+dt;const per=.1;
        while(a>per){
          a-=per;
          const sp=.016,sv=e.spd,m=SW.Flight.muzzle({x:e.x,y:e.y,z:e.z,yaw:e.yaw,pitch:e.pitch},Math.random()<.5?-1:1);
          F.tracer(m[0],m[1],m[2],fwd[0]*(300+sv)+(Math.random()-.5)*sp*300,fwd[1]*(300+sv)+(Math.random()-.5)*sp*300,fwd[2]*(300+sv)+(Math.random()-.5)*sp*300,.5,7,foe?0xff6a5a:0x9cf3ff);
          if(d<420&&Math.random()<.4)A.play('cannon',{pos:[e.x,e.y,e.z],far:true,vol:.7});
        }
        tg.set(e.id,a);
      }else tg.delete(e.id);
      // лазер
      if((e.flags&8)&&e.laser){
        const m=SW.Flight.muzzle({x:e.x,y:e.y,z:e.z,yaw:e.yaw,pitch:e.pitch},0),L=e.laser;
        const dir=SW.fwd(e.yaw+L[1],e.pitch+L[2]);
        F.beam(e.id%8,m[0],m[1],m[2],dir[0],dir[1],dir[2],L[0],foe?0xff4d5e:0x31e6ff,L[0]<SW.W.laser.range-2);
        if(d<400&&Math.random()<.12)A.play('zap',{pos:[e.x,e.y,e.z]});
      }
    }
    for(const id of [...R.drones.keys()])if(!seen.has(id)&&id<9000)R.removeDrone(id);
    // ракеты
    for(const m of c.rd.missiles){
      R.updateMissile(m.id,{x:m.x,y:m.y,z:m.z,yaw:m.yaw,pitch:m.pitch},m.kindN,dt);
    }
    R.sweepMissiles();
    // установки: поворачиваются к цели
    let pylonsAlive=0;for(const s of c.siteInfo.values())if(s.type==='pylon'&&s.alive)pylonsAlive++;
    for(const s of c.siteInfo.values()){
      let t=null;
      if(s.tg){
        if(s.tg===c.myId)t={x:po.x,y:po.y,z:po.z};
        else{const e=c.rd.drones.find(d=>d.id===s.tg);if(e)t=e}
      }
      R.updateSite(s.idx,s.alive,t,s.type==='core'&&pylonsAlive>0,s.firing,dt);
    }
    R.updatePickups(now);
    // свой лазер и огонь
    V.ownFire(dt);
    V.updateCamera(dt);
    c.warnLevel=c.warnLevel||0;
    A.listener(R.cam.position.x,R.cam.position.y,R.cam.position.z,V.listenYaw);
    R.tick(dt,now);R.render();
  },
  // собственный луч: берём длину и отклонение из последнего снимка (там учтены цель и помощь прицела)
  ownLaser(){
    const c=C(),b=c.buf[c.buf.length-1];
    const d=b&&b.dm.get(c.myId);
    return d&&(d.flags&8)?d.laser:null;
  },
  ownFire(dt){
    const c=C(),me=c.me,po=c.pose;
    if(me.al!==1||!c.P)return;
    const I=SW.Input;
    const firing=I.active&&I.sample().f&&!me.ov&&c.phase==='play';
    c.firing=firing&&!(me.w===1&&c.H.laser>0);
    if(firing&&me.w===1&&c.H.laser>0&&me.en>2){
      const L=V.ownLaser(),m=SW.Flight.muzzle(c.P,0);
      const yaw=po.yaw+(L?L[1]:0),pit=po.pitch+(L?L[2]:0),dir=SW.fwd(yaw,pit);
      let len=L?L[0]:SW.W.laser.range;
      if(!L){const tw=c.world.rayHit(m[0],m[1],m[2],dir[0],dir[1],dir[2],len);if(tw>=0)len=tw}
      F.beam(9,m[0],m[1],m[2],dir[0],dir[1],dir[2],len,0x31e6ff,L?len<SW.W.laser.range-2:false);
    }
  },

  // ---------- камера ----------
  updateCamera(dt){
    const c=C(),me=c.me,cam=R.cam,po=c.pose,S=SW.Meta?SW.Meta.S:{};
    const baseFov=S.fov||72;
    let target=po,roll=po.roll;
    c.spectating=false;
    if(me.al!==1){
      if(c.noRespawn&&me.rs<=0){
        // дронов больше нет — наблюдаем за напарниками
        const list=c.rd.drones.filter(d=>(d.flags&1)&&d.info&&d.info.team===c.myTeam&&!d.foeHull);
        if(list.length){
          c.spectating=true;
          let t=list.find(d=>d.id===V.specId)||list[0];V.specId=t.id;c.specName=t.info?t.info.name:'';
          target=t;roll=t.roll;
        }
      }
      if(!c.spectating){
        // после гибели: камера кружит над местом взрыва
        if(!V.deadPos)V.deadPos={x:po.x,y:po.y,z:po.z};
        V.deadT+=dt;
        const a=V.deadT*.35+1,r=22+V.deadT*5,p=V.deadPos;
        cam.position.set(p.x+Math.cos(a)*r,p.y+10+V.deadT*2,p.z+Math.sin(a)*r);
        cam.lookAt(p.x,p.y,p.z);
        V.shakeCam(dt);V.finishCam(baseFov,dt,0);
        return;
      }
    }else V.deadPos=null,V.deadT=0;
    const sp=target.spd||40;
    if(V.camMode==='fpv'&&!c.spectating){
      const f=SW.fwd(po.yaw,po.pitch);
      cam.position.set(po.x+f[0]*1.1,po.y+f[1]*1.1+.35,po.z+f[2]*1.1);
      cam.rotation.set(po.pitch,po.yaw,po.roll*.9,'YXZ');
      V.cy=po.yaw;V.cp=po.pitch;V.cpos.copy(cam.position);
      V.shakeCam(dt);V.finishCam(baseFov+4,dt,sp);
      return;
    }
    // вид сзади: камера плавно «догоняет» курс, поэтому поворот чувствуется
    V.cy=angLerp(V.cy,target.yaw,1-Math.exp(-dt*9));
    V.cp+=(target.pitch*.75-V.cp)*(1-Math.exp(-dt*6));
    const f=SW.fwd(V.cy,V.cp);
    const dist=13+sp*.05+c.boostK*4,h=3.6-V.cp*3;
    const tx=target.x-f[0]*dist,ty=target.y-f[1]*dist+h,tz=target.z-f[2]*dist;
    const k=1-Math.exp(-dt*(c.boostK>.5?16:13));
    V.cpos.x+=(tx-V.cpos.x)*k;V.cpos.y+=(ty-V.cpos.y)*k;V.cpos.z+=(tz-V.cpos.z)*k;
    // не даём камере влезть в здание или землю
    let cx=V.cpos.x,cy=V.cpos.y,cz=V.cpos.z;
    {
      const dx=cx-target.x,dy=cy-target.y,dz=cz-target.z,l=Math.hypot(dx,dy,dz)||1;
      const t=c.world.rayHit(target.x,target.y,target.z,dx/l,dy/l,dz/l,l);
      if(t>=0&&t<l){const q=Math.max(2.5,t-1.4);cx=target.x+dx/l*q;cy=target.y+dy/l*q;cz=target.z+dz/l*q}
      if(cy<1.2)cy=1.2;
    }
    cam.position.set(cx,cy,cz);
    cam.lookAt(target.x+f[0]*38,target.y+f[1]*38+1,target.z+f[2]*38);
    cam.rotateZ(roll*.38);
    V.shakeCam(dt);V.finishCam(baseFov,dt,sp);
  },
  shakeCam(dt){
    const c=C(),S=SW.Meta?SW.Meta.S:{};
    const k=c.trauma*c.trauma*(S.shake==null?1:S.shake);
    if(k>.001){
      const cam=R.cam;
      cam.position.x+=(Math.random()-.5)*k*1.4;cam.position.y+=(Math.random()-.5)*k*1.4;cam.position.z+=(Math.random()-.5)*k*1.4;
      cam.rotateZ((Math.random()-.5)*k*.05);
    }
  },
  finishCam(baseFov,dt,sp){
    const c=C();
    R.setFov(baseFov+c.boostK*9+clamp((sp-44)*.12,-2,4));
    R.cam.updateMatrixWorld();
    R.cam.getWorldDirection(_v);V.listenYaw=Math.atan2(-_v.x,-_v.z);
  },
  listenYaw:0,

  // ---------- меню и ангар ----------
  setMenuScene(s){V.menuScene=s;if(s==='menu')R.removeDrone(9000)},
  setHero(load){
    V.heroLoad=load;
    R.addDrone(9000,{hull:load.hull,skin:load.skin});
  },
  ensureMenuWorld(){
    if(R.world&&R.world.id==='city'&&R.world.seed===7)return;
    R.clearEntities();
    R.loadWorld(SW.makeWorld('city',7));
    for(const id of MENU_IDS)R.removeDrone(id);
    MENU_IDS.forEach((id,i)=>R.addDrone(id,{hull:SW.HULL_IDS[i%4],skin:{paint:(i*3+1)%12,trail:i%6}}));
  },
  frameMenu(dt){
    const c=C(),cam=R.cam;
    V.menuT+=dt;const t=V.menuT;
    V.ensureMenuWorld();
    // пролётные дроны по окружностям вокруг шпиля
    MENU_IDS.forEach((id,i)=>{
      const r=150+i*46,w=(.22+.03*i)*(i%2?1:-1),a=t*w+i*1.7,y=120+i*28+Math.sin(t*.4+i)*12;
      const x=Math.cos(a)*r,z=Math.sin(a)*r,dx=-Math.sin(a)*r*w,dz=Math.cos(a)*r*w;
      R.updateDrone(id,{x,y,z,yaw:Math.atan2(-dx,-dz),pitch:Math.sin(t*.4+i)*.05,roll:-Math.sign(w)*.5,spd:44,hp:100,maxhp:100,flags:1|(i%3===0?2:0),alive:true},dt);
    });
    if(V.menuScene==='hangar'&&V.heroLoad){
      const hy=392,a=t*.28;
      R.updateDrone(9000,{x:0,y:hy,z:0,yaw:t*.35,pitch:.04,roll:Math.sin(t*.8)*.12,spd:30,hp:100,maxhp:100,flags:1,alive:true},dt);
      const dist=V.heroDist||11.5;
      cam.position.set(Math.cos(a)*dist,hy+2.6+Math.sin(t*.3)*.6,Math.sin(a)*dist);
      cam.lookAt(0,hy+.1,0);R.setFov(52);
      // панель ангара занимает часть экрана: сдвигаем кадр, чтобы дрон оставался на виду
      const W=R.W,H=R.H;
      if(W<720)cam.setViewOffset(W,H,0,H*.2,W,H);else cam.setViewOffset(W,H,W*.2,0,W,H);
    }else{
      if(cam.view&&cam.view.enabled)cam.clearViewOffset();
      const a=t*.045,rr=360+Math.sin(t*.1)*40;
      cam.position.set(Math.cos(a)*rr,240+Math.sin(t*.13)*30,Math.sin(a)*rr);
      cam.lookAt(0,150,0);R.setFov(66);
    }
    cam.updateMatrixWorld();
    R.sweepMissiles();
    R.tick(dt,c.now);R.render();
  },
};
SW.View=V;
})(typeof window!=='undefined'?window:globalThis);
