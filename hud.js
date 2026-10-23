// «Стрижи» — экранные приборы (HUD): прицел с шкалами, рамки целей, захват, упреждение, тревога ракет, радар, цели задания.
// Рисуется на 2D-канве поверх 3D-сцены. Все данные берёт у SW.Client (см. client.js).
(function(root){
'use strict';
const SW=root.SW,R=SW.Render;
const {clamp,angDiff}=SW;
const CY='#31e6ff',RED='#ff4d5e',AMB='#ffb347',GRN='#5dff9a',MAG='#ff3fb4',WHT='#eaf7ff',DIM='rgba(160,200,220,.55)';
const FONT='"Exo 2","Segoe UI",system-ui,sans-serif';
const P={x:0,y:0,z:0},Q={x:0,y:0,z:0};
let ctx=null,W=0,H=0,dpr=1,canvas=null;

const HUD={
  init(c){canvas=c;ctx=c.getContext('2d');HUD.resize()},
  resize(){
    dpr=Math.min(root.devicePixelRatio||1,2);W=root.innerWidth;H=root.innerHeight;
    canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width=W+'px';canvas.style.height=H+'px';
  },
  clear(){if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height)},

  // ---------- рисовалки ----------
  txt(s,x,y,size,col,align,weight,shadow){
    ctx.font=`${weight||'700'} ${size}px ${FONT}`;ctx.textAlign=align||'left';ctx.fillStyle=col||WHT;
    if(shadow!==false){ctx.shadowColor='rgba(0,0,0,.75)';ctx.shadowBlur=4;ctx.shadowOffsetY=1}
    ctx.fillText(s,x,y);ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  },
  bracket(x,y,s,col,lw){
    const l=s*.38;ctx.strokeStyle=col;ctx.lineWidth=lw||2;ctx.beginPath();
    for(const [sx,sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
      ctx.moveTo(x+sx*s,y+sy*(s-l));ctx.lineTo(x+sx*s,y+sy*s);ctx.lineTo(x+sx*(s-l),y+sy*s);
    }
    ctx.stroke();
  },
  diamond(x,y,s,col,fill){
    ctx.beginPath();ctx.moveTo(x,y-s);ctx.lineTo(x+s,y);ctx.lineTo(x,y+s);ctx.lineTo(x-s,y);ctx.closePath();
    if(fill){ctx.fillStyle=col;ctx.fill()}else{ctx.strokeStyle=col;ctx.lineWidth=1.6;ctx.stroke()}
  },
  arrow(x,y,ang,s,col){ // треугольник, «вверх» — по ang=0
    ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s*.7,s*.7);ctx.lineTo(0,s*.3);ctx.lineTo(-s*.7,s*.7);ctx.closePath();ctx.fill();ctx.restore();
  },
  bar(x,y,w,h,k,col,bg){
    ctx.fillStyle=bg||'rgba(0,0,0,.45)';ctx.fillRect(x,y,w,h);
    ctx.fillStyle=col;ctx.fillRect(x,y,w*clamp(k,0,1),h);
    ctx.strokeStyle='rgba(255,255,255,.25)';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,w-1,h-1);
  },
  // направление к точке в пространстве камеры: {cx,cy,cz} — вправо, вверх, вперёд
  camSpace(x,y,z){
    const e=R.cam.matrixWorldInverse.elements;
    return {cx:e[0]*x+e[4]*y+e[8]*z+e[12],cy:e[1]*x+e[5]*y+e[9]*z+e[13],cz:-(e[2]*x+e[6]*y+e[10]*z+e[14])};
  },
  // метка на краю экрана для точки вне поля зрения
  edge(x,y,z,col,size,label){
    const c=HUD.camSpace(x,y,z);
    let a=Math.atan2(c.cx,c.cy);
    const rx=W*.5-46,ry=H*.5-70,k=1/Math.max(Math.abs(Math.sin(a))/rx,Math.abs(Math.cos(a))/ry);
    const px=W/2+Math.sin(a)*k,py=H/2-Math.cos(a)*k;
    HUD.arrow(px,py,a,size||11,col);
    if(label)HUD.txt(label,px-Math.sin(a)*22,py+Math.cos(a)*22+4,12,col,'center');
  },
  onScreen(p,m){return p.z>0&&p.x>m&&p.x<W-m&&p.y>m&&p.y<H-m},

  // ---------- главный кадр ----------
  draw(C,dt){
    if(!ctx)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);
    if(C.scene!=='game'||!C.world)return;
    const me=C.me,t=C.now;
    R.cam.updateMatrixWorld();
    const alive=me.al===1&&!C.spectating;
    HUD.vignette(C,me,t);
    if(C.boostK>.05)HUD.speedLines(C);
    if(alive){
      HUD.targets(C,me,t);
      HUD.threats(C,me,t);
      HUD.reticle(C,me,t);
      HUD.rings(C);
      HUD.bottom(C,me);
    }else if(C.spectating){
      HUD.spectate(C);
    }
    HUD.radar(C,me);
    HUD.top(C,me);
    HUD.feed(C,t);
    HUD.messages(C,t);
    HUD.dmg(C,t);
    if(me.al===0)HUD.death(C,me,t);
    HUD.zone(C,me);
    HUD.net(C);
  },

  vignette(C,me,t){
    const k=me.al===1?clamp(1-me.hp/Math.max(1,me.mh)/0.35,0,1):0;
    if(k>0||C.hurtT>0){
      const a=clamp(k*.5*(.7+.3*Math.sin(t*6))+Math.max(0,C.hurtT)*.5,0,.75);
      const g=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.32,W/2,H/2,Math.max(W,H)*.75);
      g.addColorStop(0,'rgba(255,40,60,0)');g.addColorStop(1,`rgba(255,40,60,${a})`);
      ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    }
    if(C.flashT>0){ctx.fillStyle=`rgba(255,255,255,${clamp(C.flashT,0,.5)})`;ctx.fillRect(0,0,W,H)}
  },
  speedLines(C){
    ctx.strokeStyle=`rgba(190,235,255,${C.boostK*.35})`;ctx.lineWidth=1.5;ctx.beginPath();
    const r=SW.rng(C.frame>>1);
    for(let i=0;i<26;i++){
      const a=r()*6.283,d0=Math.min(W,H)*(.28+r()*.25),d1=d0+Math.min(W,H)*(.1+r()*.18)*C.boostK;
      ctx.moveTo(W/2+Math.cos(a)*d0*1.3,H/2+Math.sin(a)*d0);ctx.lineTo(W/2+Math.cos(a)*d1*1.3,H/2+Math.sin(a)*d1);
    }
    ctx.stroke();
  },

  // ---------- прицел ----------
  reticle(C,me,t){
    const pose=C.pose;
    const f=SW.fwd(pose.yaw,pose.pitch);
    const px=pose.x+f[0]*320,py=pose.y+f[1]*320,pz=pose.z+f[2]*320;
    R.project(px,py,pz,P);
    if(P.z<=0)return;
    const x=P.x,y=P.y,laser=me.w===1&&C.hull.laser>0;
    const heat=me.ht/100,en=me.en/Math.max(1,C.H.energy);
    const col=me.ov||C.laserLock?RED:(C.aimHit?AMB:CY);
    ctx.save();ctx.translate(x,y);
    ctx.lineWidth=2;ctx.strokeStyle=col;ctx.globalAlpha=.92;
    // кольцо с разрывами и точка
    for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(0,0,15,i*Math.PI/2+.25,i*Math.PI/2+Math.PI/2-.25);ctx.stroke()}
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(0,0,1.8,0,6.283);ctx.fill();
    if(laser){ctx.beginPath();ctx.moveTo(0,-26);ctx.lineTo(5,-20);ctx.lineTo(-5,-20);ctx.closePath();ctx.stroke()}
    else{ctx.beginPath();ctx.moveTo(-26,0);ctx.lineTo(-20,0);ctx.moveTo(26,0);ctx.lineTo(20,0);ctx.stroke()}
    // шкалы по бокам прицела: слева нагрев пушки, справа энергия
    ctx.lineWidth=3;
    ctx.strokeStyle='rgba(255,255,255,.18)';ctx.beginPath();ctx.arc(0,0,23,Math.PI*.78,Math.PI*1.22);ctx.stroke();ctx.beginPath();ctx.arc(0,0,23,-Math.PI*.22,Math.PI*.22);ctx.stroke();
    ctx.strokeStyle=heat>.75?RED:AMB;ctx.beginPath();ctx.arc(0,0,23,Math.PI*1.22-(Math.PI*.44)*heat,Math.PI*1.22);ctx.stroke();
    ctx.strokeStyle=en<.2?RED:CY;ctx.beginPath();ctx.arc(0,0,23,-Math.PI*.22,-Math.PI*.22+Math.PI*.44*en);ctx.stroke();
    ctx.restore();
    // отметка попадания
    if(C.hitT>0){
      const k=C.hitT/.25,s=10+(1-k)*8,hc=C.hitKill?RED:WHT;
      ctx.strokeStyle=hc;ctx.lineWidth=2.4;ctx.globalAlpha=clamp(k+.2,0,1);ctx.beginPath();
      for(const [sx,sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){ctx.moveTo(x+sx*s,y+sy*s);ctx.lineTo(x+sx*(s+9),y+sy*(s+9))}
      ctx.stroke();ctx.globalAlpha=1;
    }
    if(me.ov)HUD.txt('ПЕРЕГРЕВ',x,y+48,13,RED,'center');
    else if(C.laserLock)HUD.txt('ЛАЗЕР ЗАРЯЖАЕТСЯ',x,y+48,13,RED,'center');
  },

  // ---------- цели ----------
  targets(C,me,t){
    const pose=C.pose,list=[];
    for(const e of C.rd.drones){
      if(!(e.flags&1))continue;
      const info=e.info,foe=info&&info.team!==C.myTeam;
      const dx=e.x-pose.x,dy=e.y-pose.y,dz=e.z-pose.z,d=Math.hypot(dx,dy,dz);
      list.push({kind:0,id:e.id,x:e.x,y:e.y,z:e.z,d,foe,name:e.foeHull?SW.FOES[e.foeHull].name:(info?info.name:'?'),hp:e.hp,mh:e.mh||(e.foeHull?SW.FOES[e.foeHull].hp:100),inv:!!(e.flags&32),team:info?info.team:1,r:e.foeHull?SW.FOES[e.foeHull].r:2.3});
    }
    for(const s of C.rd.sites){
      if(!s.alive)continue;
      const d=Math.hypot(s.x-pose.x,s.y-pose.y,s.z-pose.z);
      list.push({kind:1,id:1000+s.idx,x:s.x,y:s.y+s.r*.6,z:s.z,d,foe:true,name:SW.SITES[s.type].name,hp:s.hp,mh:s.maxhp,r:s.r,inv:s.invul,site:true});
    }
    list.sort((a,b)=>a.d-b.d);
    const pxm=H/(2*Math.tan(R.cam.fov*Math.PI/360)); // пикселей на метр на единичной дистанции
    let shown=0;C.aimHit=false;
    let leadT=null,leadAng=.3;
    const f=SW.fwd(pose.yaw,pose.pitch);
    for(const o of list){
      if(o.d>(o.site?1500:1200))continue;
      R.project(o.x,o.y,o.z,P);
      const on=HUD.onScreen(P,6);
      if(!on){
        if(o.foe&&!o.site&&o.d<900&&shown<4){HUD.edge(o.x,o.y,o.z,RED,9,null);shown++}
        continue;
      }
      const s=clamp(o.r*1.7*pxm/o.d,9,64);
      const locked=me.lk===o.id;
      const col=o.foe?(locked&&me.lp>=1?RED:RED):CY;
      ctx.globalAlpha=o.inv?.5:1;
      HUD.bracket(P.x,P.y,s,col,locked?2.6:1.6);
      ctx.globalAlpha=1;
      // полоска прочности и подпись — для ближних
      if(o.d<650||locked){
        const w=Math.max(34,s*1.5);
        HUD.bar(P.x-w/2,P.y+s+5,w,4,o.hp/Math.max(1,o.mh),o.foe?RED:CY);
        HUD.txt(`${o.name} · ${Math.round(o.d)} м`,P.x,P.y-s-7,12,col,'center');
      }
      // захват ракеты
      if(locked){
        const k=me.lp;
        ctx.strokeStyle=k>=1?RED:AMB;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(P.x,P.y,s+9,-Math.PI/2,-Math.PI/2+Math.PI*2*k);ctx.stroke();
        if(k>=1){HUD.txt('ЗАХВАТ',P.x,P.y+s+24,13,RED,'center');HUD.diamond(P.x,P.y,5,RED,true)}
      }
      // кандидат на упреждение: ближайшая к направлению носа вражеская цель
      if(o.foe&&o.kind===0){
        const ux=(o.x-pose.x)/o.d,uy=(o.y-pose.y)/o.d,uz=(o.z-pose.z)/o.d;
        const ang=Math.acos(clamp(ux*f[0]+uy*f[1]+uz*f[2],-1,1));
        if(ang<leadAng&&o.d<520){leadAng=ang;leadT=o}
      }
    }
    // упреждение для основной цели
    if(leadT){
      const e=C.rd.drones.find(d=>d.id===leadT.id);
      if(e){
        const tv=e.vel||[0,0,0],sv=C.vel;
        let tt=leadT.d/(300+C.pose.spd*.5);
        for(let k=0;k<2;k++){
          const ax=e.x+tv[0]*tt-pose.x-sv[0]*tt,ay=e.y+tv[1]*tt-pose.y-sv[1]*tt,az=e.z+tv[2]*tt-pose.z-sv[2]*tt;
          tt=Math.hypot(ax,ay,az)/300;
        }
        R.project(e.x+tv[0]*tt-sv[0]*tt,e.y+tv[1]*tt-sv[1]*tt,e.z+tv[2]*tt-sv[2]*tt,Q);
        if(Q.z>0){
          ctx.strokeStyle=AMB;ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(Q.x,Q.y,9,0,6.283);ctx.stroke();
          ctx.beginPath();ctx.moveTo(Q.x-14,Q.y);ctx.lineTo(Q.x-9,Q.y);ctx.moveTo(Q.x+14,Q.y);ctx.lineTo(Q.x+9,Q.y);ctx.moveTo(Q.x,Q.y-14);ctx.lineTo(Q.x,Q.y-9);ctx.moveTo(Q.x,Q.y+14);ctx.lineTo(Q.x,Q.y+9);ctx.stroke();
          // «в прицеле»: оранжевый, когда лидер-кольцо близко к центру прицела
          R.project(pose.x+f[0]*320,pose.y+f[1]*320,pose.z+f[2]*320,P);
          if(Math.hypot(Q.x-P.x,Q.y-P.y)<26)C.aimHit=true;
        }
      }
    }
  },

  // ---------- ракеты, летящие в нас ----------
  threats(C,me,t){
    const pose=C.pose;let worst=1e9;
    for(const m of C.rd.missiles){
      if(m.tg!==C.myId)continue;
      const d=Math.hypot(m.x-pose.x,m.y-pose.y,m.z-pose.z);
      worst=Math.min(worst,d);
      R.project(m.x,m.y,m.z,P);
      if(HUD.onScreen(P,20)){
        const s=16;ctx.strokeStyle=RED;ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(P.x,P.y-s);ctx.lineTo(P.x+s,P.y+s*.8);ctx.lineTo(P.x-s,P.y+s*.8);ctx.closePath();ctx.stroke();
        HUD.txt(Math.round(d)+' м',P.x,P.y+s+16,13,RED,'center');
      }else HUD.edge(m.x,m.y,m.z,RED,13,Math.round(d)+' м');
    }
    C.warnLevel=worst>1e8?0:worst<320?2:1;
    if(worst<1e8){
      const blink=Math.sin(t*(worst<320?18:9))>0;
      if(blink){HUD.txt('⚠ ПУСК РАКЕТЫ',W/2,H*.26,clamp(W*.026,18,30),RED,'center','900');}
      HUD.txt(worst<320?'ЛОВУШКИ! ВИРАЖ!':'ракета наведена на вас — маневр или ловушки',W/2,H*.26+26,14,AMB,'center');
      ctx.strokeStyle=`rgba(255,60,70,${blink?.5:.15})`;ctx.lineWidth=8;ctx.strokeRect(4,4,W-8,H-8);
    }
  },

  // ---------- кольца маршрута ----------
  rings(C){
    const r=C.ringTarget;
    if(!r)return;
    const pose=C.pose,d=Math.hypot(r.x-pose.x,r.y-pose.y,r.z-pose.z);
    R.project(r.x,r.y,r.z,P);
    if(HUD.onScreen(P,30)){
      ctx.strokeStyle='#ffe27a';ctx.lineWidth=2.4;ctx.beginPath();ctx.arc(P.x,P.y,15,0,6.283);ctx.stroke();
      HUD.diamond(P.x,P.y,4,'#ffe27a',true);
      HUD.txt(Math.round(d)+' м',P.x,P.y-24,14,'#ffe27a','center','800');
    }else HUD.edge(r.x,r.y,r.z,'#ffe27a',14,Math.round(d)+' м');
  },

  // ---------- низ: прочность, скорость, боезапас ----------
  bottom(C,me){
    const mobile=C.touch,w=clamp(W*.3,190,300),x=W/2-w/2,y=mobile?H-34:H-48;
    // прочность + щит
    const hk=me.hp/Math.max(1,me.mh);
    HUD.bar(x,y,w,12,hk,hk>.5?GRN:hk>.25?AMB:RED);
    if(me.sh>0){ctx.fillStyle='rgba(180,120,255,.8)';ctx.fillRect(x,y-4,w*clamp(me.sh/SW.W.shield.hp,0,1),3)}
    HUD.txt(`${Math.round(me.hp)} / ${me.mh}`,W/2,y-6,12,WHT,'center','800');
    // скорость и высота
    const p=C.pose;
    HUD.txt(`${Math.round(p.spd*3.6)} км/ч`,x,y+27,13,C.boosting?AMB:DIM,'left','700');
    HUD.txt(`выс ${Math.round(p.y)} м`,x+w,y+27,13,p.y<30?RED:DIM,'right','700');
    // ракеты и ловушки (иконки)
    const ix=W/2;
    let s='';
    ctx.font=`700 13px ${FONT}`;
    for(let i=0;i<C.H.missiles&&i<8;i++){
      const on=i<me.ms;
      ctx.fillStyle=on?(me.lk&&me.lp>=1?RED:CY):'rgba(255,255,255,.18)';
      ctx.beginPath();ctx.moveTo(ix-62+i*9,y+17);ctx.lineTo(ix-60+i*9,y+9);ctx.lineTo(ix-58+i*9,y+17);ctx.closePath();ctx.fill();
    }
    for(let i=0;i<C.H.flares&&i<7;i++){
      ctx.fillStyle=i<me.fl?AMB:'rgba(255,255,255,.18)';ctx.beginPath();ctx.arc(ix+18+i*10,y+14,3.4,0,6.283);ctx.fill();
    }
    HUD.txt(me.w===1&&C.hull.laser>0?'ЛАЗЕР':'ПУШКА',ix,y+27,12,DIM,'center','700');
  },

  // ---------- радар ----------
  radar(C,me){
    const mobile=C.touch,R0=mobile?58:76,cx=mobile?R0+14:R0+18,cy=mobile?R0+66:H-R0-22;
    const pose=C.pose,range=C.radarRange||650;
    ctx.save();
    ctx.translate(cx,cy);
    ctx.fillStyle='rgba(4,14,22,.55)';ctx.beginPath();ctx.arc(0,0,R0,0,6.283);ctx.fill();
    ctx.strokeStyle='rgba(49,230,255,.35)';ctx.lineWidth=1.2;
    for(const k of [1,.66,.33]){ctx.beginPath();ctx.arc(0,0,R0*k,0,6.283);ctx.stroke()}
    ctx.beginPath();ctx.moveTo(-R0,0);ctx.lineTo(R0,0);ctx.moveTo(0,-R0);ctx.lineTo(0,R0);ctx.stroke();
    // развёртка
    const sw=C.now*1.6%(Math.PI*2);
    const g=ctx.createConicGradient?ctx.createConicGradient(sw-Math.PI/2,0,0):null;
    if(g){g.addColorStop(0,'rgba(49,230,255,.28)');g.addColorStop(.18,'rgba(49,230,255,0)');g.addColorStop(1,'rgba(49,230,255,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,R0,0,6.283);ctx.fill()}
    ctx.strokeStyle='rgba(49,230,255,.8)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,R0,0,6.283);ctx.stroke();
    // нос вверх: поворачиваем мир на −yaw
    const cy_=Math.cos(pose.yaw),sy=Math.sin(pose.yaw);
    const plot=(x,z)=>{ // мировая точка → радар
      const dx=x-pose.x,dz=z-pose.z;
      // вперёд = (−sin yaw, −cos yaw), вправо = (cos yaw, −sin yaw)
      const fwd=-dx*sy-dz*cy_,rgt=dx*cy_-dz*sy;
      let rx=rgt/range*R0,ry=-fwd/range*R0;const l=Math.hypot(rx,ry);
      let edge=false;if(l>R0-3){rx*=(R0-3)/l;ry*=(R0-3)/l;edge=true}
      return [rx,ry,edge];
    };
    const dot=(x,y,z,col,size,sq)=>{
      const [rx,ry,edge]=plot(x,z);
      ctx.globalAlpha=edge?.55:1;ctx.fillStyle=col;
      if(sq)ctx.fillRect(rx-size,ry-size,size*2,size*2);else{ctx.beginPath();ctx.arc(rx,ry,size,0,6.283);ctx.fill()}
      // выше/ниже нас
      const dy=y-pose.y;
      if(Math.abs(dy)>45){ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.beginPath();const u=dy>0?-1:1;ctx.moveTo(rx,ry+u*(size+2));ctx.lineTo(rx,ry+u*(size+5));ctx.stroke()}
      ctx.globalAlpha=1;
    };
    for(const p of C.pickupsView())dot(p.x,p.y,p.z,GRN,1.8);
    for(const s of C.rd.sites)if(s.alive)dot(s.x,s.y,s.z,AMB,3,true);
    for(const e of C.rd.drones){
      if(!(e.flags&1))continue;
      const info=e.info,foe=info&&info.team!==C.myTeam;
      dot(e.x,e.y,e.z,foe?RED:CY,3);
    }
    for(const m of C.rd.missiles)dot(m.x,m.y,m.z,m.tg===C.myId?RED:'#ffe27a',2.2,true);
    if(C.ringTarget)dot(C.ringTarget.x,C.ringTarget.y,C.ringTarget.z,'#ffe27a',3.6);
    // сам дрон
    ctx.fillStyle=WHT;ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4.5,5);ctx.lineTo(0,2.5);ctx.lineTo(-4.5,5);ctx.closePath();ctx.fill();
    ctx.restore();
  },

  // ---------- верх: режим, цели, жизни ----------
  top(C,me){
    const g=C.g,cx=W/2,y=C.touch?24:28;
    const sz=clamp(W*.017,13,17);
    if(C.mode==='run'&&g&&g.k==='run'){
      const obj=C.objText||C.runInfo&&C.runInfo.objText||'';
      HUD.txt(obj,cx,y,sz+1,WHT,'center','800');
      const o=g.o||[0,0];
      if(o[1]>0){
        const w=clamp(W*.22,130,230);HUD.bar(cx-w/2,y+8,w,7,o[0]/o[1],'#ffe27a');
        HUD.txt(`${o[0]} / ${o[1]}`,cx,y+31,12,DIM,'center');
      }
      let ty=y+(o[1]>0?47:22);
      if(g.bp<100&&(C.runInfo&&(C.runInfo.obj.type==='boss'||C.runInfo.obj.type==='core'))){
        const w=clamp(W*.3,160,320);HUD.bar(cx-w/2,ty,w,9,g.bp/100,RED);HUD.txt(C.runInfo.obj.type==='boss'?'«МАТКА»':'СЕРДЦЕ СТРАЖА',cx,ty-3,11,RED,'center');ty+=22;
      }
      // жизни и время — справа
      const rx=C.touch?W-170:W-18;
      let hearts='';for(let i=0;i<g.lm;i++)hearts+=i<g.lv?'♥':'♡';
      HUD.txt(hearts,rx,y,17,RED,'right','700');
      if(g.tl>0||C.runInfo&&C.runInfo.tl>0){const s=g.tl;HUD.txt(Math.floor(s/60)+':'+String(s%60).padStart(2,'0'),rx,y+22,16,s<30?RED:WHT,'right','800')}
      else HUD.txt(Math.floor(g.cl/60)+':'+String(g.cl%60).padStart(2,'0'),rx,y+22,14,DIM,'right','700');
      HUD.txt('очки '+g.sc,rx,y+42,12,DIM,'right','700');
      if(g.f>0)HUD.txt('врагов: '+g.f,18,C.touch?H-110:34,13,RED,'left','700');
    }else if(g){
      const lim=g.lim,tl=g.tl;
      if(C.mode==='team'&&g.ts){
        HUD.txt(String(g.ts[0]),cx-34,y+4,26,'#5db4ff','right','900');HUD.txt(String(g.ts[1]),cx+34,y+4,26,'#ff6b6b','left','900');
        HUD.txt(`до ${lim}`,cx,y-4,11,DIM,'center');
      }else{
        const mine=(g.sb||[]).find(r=>r[0]===C.myId);
        HUD.txt(`${mine?mine[1]:0} / ${lim}`,cx,y+4,26,WHT,'center','900');
        HUD.txt('сбито',cx,y-8,11,DIM,'center');
      }
      if(tl>0||C.opts&&C.opts.time)HUD.txt(Math.floor(tl/60)+':'+String(tl%60).padStart(2,'0'),cx,y+28,15,tl<30?RED:WHT,'center','800');
      // мини-таблица лидеров
      const sb=(g.sb||[]).slice().sort((a,b)=>b[1]-a[1]||a[2]-b[2]).slice(0,4);
      if(!C.touch)sb.forEach((r,i)=>{
        const info=C.info.get(r[0]),name=info?info.name:'?',mine=r[0]===C.myId;
        HUD.txt(`${i+1}. ${name}`,W-110,y+i*17,13,mine?CY:WHT,'right','700');HUD.txt(String(r[1]),W-18,y+i*17,13,mine?CY:WHT,'right','800');
      });
    }
  },

  feed(C,t){
    let y=C.touch?70:96;
    for(const f of C.feed){
      const a=clamp((f.until-t)*1.2,0,1);if(a<=0)continue;
      ctx.globalAlpha=a;
      ctx.font=`700 14px ${FONT}`;ctx.textAlign='right';
      const tw=ctx.measureText(f.text).width;
      ctx.fillStyle=f.me?'rgba(49,230,255,.22)':'rgba(0,0,0,.35)';ctx.fillRect(W-18-tw-12,y-15,tw+20,22);
      ctx.fillStyle=f.col||WHT;ctx.fillText(f.text,W-18,y);
      ctx.globalAlpha=1;y+=25;
    }
  },
  messages(C,t){
    // крупные сообщения по центру
    let y=H*.36;
    for(const m of C.msgs){
      const age=t-m.t,life=m.life||2.4;if(age>life)continue;
      const a=age<.15?age/.15:clamp((life-age)/.5,0,1),k=1+Math.max(0,.25-age)*1.4;
      ctx.globalAlpha=a;
      HUD.txt(m.text,W/2,y,clamp(W*.033,20,40)*k*(m.small?.62:1),m.col||WHT,'center','900');
      ctx.globalAlpha=1;y+=m.small?26:44;
    }
    if(C.hint&&C.hint.until>t)HUD.txt(C.hint.text,W/2,H*.66,clamp(W*.016,13,17),'#ffe27a','center','700');
  },
  dmg(C,t){
    for(const d of C.dmgDirs){
      const age=t-d.t;if(age>1.4)continue;
      const a=1-age/1.4;
      const c=HUD.camSpace(d.x,d.y,d.z),ang=Math.atan2(c.cx,c.cy);
      ctx.save();ctx.translate(W/2,H/2);ctx.rotate(ang);
      const g=ctx.createLinearGradient(0,-H*.5,0,-H*.5+90);g.addColorStop(0,`rgba(255,40,60,${a*.8})`);g.addColorStop(1,'rgba(255,40,60,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(-70,-H*.5);ctx.lineTo(70,-H*.5);ctx.lineTo(30,-H*.5+90);ctx.lineTo(-30,-H*.5+90);ctx.closePath();ctx.fill();
      ctx.restore();
    }
  },
  zone(C,me){
    if(me.al!==1||me.out<=0)return;
    const left=Math.max(0,5-me.out/10);
    const blink=Math.sin(C.now*10)>0;
    if(blink)HUD.txt(left>0?'ВЕРНИТЕСЬ В ЗОНУ БОЯ':'ВНЕ ЗОНЫ — ДРОН ГОРИТ',W/2,H*.3,clamp(W*.026,18,30),RED,'center','900');
    if(left>0)HUD.txt(left.toFixed(1)+' с',W/2,H*.3+30,20,AMB,'center','800');
  },
  death(C,me,t){
    ctx.fillStyle='rgba(0,0,0,.35)';ctx.fillRect(0,0,W,H*.22);ctx.fillRect(0,H*.78,W,H*.22);
    HUD.txt('СБИТ',W/2,H*.15,clamp(W*.05,28,56),RED,'center','900');
    if(C.killer)HUD.txt(C.killer,W/2,H*.15+30,16,WHT,'center','700');
    const rs=me.rs/10;
    if(rs>0)HUD.txt(`Возвращение в бой через ${Math.ceil(rs)}`,W/2,H*.86,18,WHT,'center','700');
    else if(C.noRespawn)HUD.txt('Дроны закончились — наблюдай за напарниками',W/2,H*.86,16,AMB,'center','700');
  },
  spectate(C){
    HUD.txt('НАБЛЮДЕНИЕ'+(C.specName?': '+C.specName:''),W/2,H-40,16,AMB,'center','800');
    HUD.txt('сменить — клавиша C / кнопка камеры',W/2,H-20,12,DIM,'center');
  },
  net(C){
    const n=C.netNote;
    if(n)HUD.txt(n,W/2,H*.12,15,AMB,'center','700');
  },
};
SW.HUD=HUD;
})(typeof window!=='undefined'?window:globalThis);
