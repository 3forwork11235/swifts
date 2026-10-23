// «Стрижи» — управление. Всё сводится к одному набору чисел для полёта:
//   y — стик по курсу −1..1 (вправо +), p — по тангажу −1..1 (вверх +), t — тяга (−1 тормоз, +1 форсаж), f — огонь,
// плюс счётчики нажатий (ракета m, ловушки r, смена оружия w): счётчики не теряются, если пакет с вводом запоздал.
// Источники: клавиатура, мышь (стик от центра экрана), сенсорный джойстик и кнопки, геймпад.
(function(root){
'use strict';
const SW=root.SW;
const {clamp}=SW;
const $=id=>document.getElementById(id);

const I={
  active:false,touch:false,
  cfg:{sens:1,invY:false,mouse:true,level:true},
  keys:new Set(),mouse:{x:0,y:0,on:false,moved:false,down:false,right:false},
  joy:{id:null,x:0,y:0,vx:0,vy:0,r:62},
  btn:{fire:false,boost:false,brake:false},
  cnt:{m:0,r:0,w:0},
  hooks:{},
  pad:null,
  init(){
    I.touch=matchMedia('(pointer:coarse)').matches||'ontouchstart' in root;
    addEventListener('keydown',I.keydown);addEventListener('keyup',I.keyup);
    addEventListener('blur',()=>{I.keys.clear();I.btn.fire=I.btn.boost=I.btn.brake=false;I.mouse.down=I.mouse.right=false});
    const st=$('stage');
    st.addEventListener('mousemove',e=>{I.mouse.x=e.clientX;I.mouse.y=e.clientY;I.mouse.on=true;I.mouse.moved=true});
    st.addEventListener('mouseleave',()=>{I.mouse.on=false});
    st.addEventListener('mousedown',e=>{
      if(!I.active)return;
      if(e.button===0)I.mouse.down=true;else if(e.button===2){I.mouse.right=true;I.cnt.m++}
      e.preventDefault();
    });
    addEventListener('mouseup',e=>{if(e.button===0)I.mouse.down=false;else if(e.button===2)I.mouse.right=false});
    st.addEventListener('contextmenu',e=>e.preventDefault());
    I.initTouch();
    addEventListener('gamepadconnected',()=>{});
  },
  setCfg(c){Object.assign(I.cfg,c)},
  setActive(on){
    I.active=on;
    if(!on){I.keys.clear();I.btn.fire=I.btn.boost=I.btn.brake=false;I.mouse.down=I.mouse.right=false;I.joy.id=null;I.joy.vx=I.joy.vy=0;I.showJoy(false)}
    const t=$('touch');if(t)t.style.display=on&&I.touch?'block':'none';
  },

  // ----- клавиатура -----
  keydown(e){
    if(!I.active||e.repeat&&!/^Digit/.test(e.code))return;
    if(e.target&&/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
    const c=e.code;
    let used=true;
    switch(c){
      case'KeyF':case'KeyE':I.cnt.m++;break;
      case'KeyG':case'KeyR':I.cnt.r++;break;
      case'KeyQ':I.cnt.w++;break;
      case'KeyC':I.hooks.cam&&I.hooks.cam();break;
      case'KeyM':I.hooks.mute&&I.hooks.mute();break;
      case'Escape':case'KeyP':I.hooks.pause&&I.hooks.pause();break;
      case'Tab':I.hooks.score&&I.hooks.score(true);break;
      case'KeyH':I.hooks.help&&I.hooks.help();break;
      default:
        if(/^Digit[1-9]$/.test(c)){I.hooks.radio&&I.hooks.radio(+c.slice(5)-1)}
        else if(/^(KeyW|KeyA|KeyS|KeyD|Arrow(Up|Down|Left|Right)|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|KeyX)$/.test(c)){I.keys.add(c)}
        else used=false;
    }
    if(used)e.preventDefault();
  },
  keyup(e){
    I.keys.delete(e.code);
    if(e.code==='Tab'&&I.hooks.score)I.hooks.score(false);
  },

  // ----- сенсорный экран -----
  initTouch(){
    const zone=$('joyZone');if(!zone)return;
    const jb=$('joyBase'),jk=$('joyKnob');
    zone.addEventListener('pointerdown',e=>{
      if(I.joy.id!==null)return;
      I.joy.id=e.pointerId;I.joy.x=e.clientX;I.joy.y=e.clientY;I.joy.vx=I.joy.vy=0;
      zone.setPointerCapture(e.pointerId);
      jb.style.left=e.clientX+'px';jb.style.top=e.clientY+'px';jk.style.transform='translate(-50%,-50%)';I.showJoy(true);
      e.preventDefault();
    });
    zone.addEventListener('pointermove',e=>{
      if(e.pointerId!==I.joy.id)return;
      let dx=e.clientX-I.joy.x,dy=e.clientY-I.joy.y;const l=Math.hypot(dx,dy),R=I.joy.r;
      if(l>R){dx*=R/l;dy*=R/l}
      I.joy.vx=dx/R;I.joy.vy=dy/R;
      jk.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
      e.preventDefault();
    });
    const end=e=>{
      if(e.pointerId!==I.joy.id)return;
      I.joy.id=null;I.joy.vx=I.joy.vy=0;I.showJoy(false);
    };
    zone.addEventListener('pointerup',end);zone.addEventListener('pointercancel',end);zone.addEventListener('lostpointercapture',end);
    // кнопки: удержание (огонь, форсаж, тормоз) и нажатия (ракета, ловушки, оружие)
    const hold=(id,key)=>{
      const el=$(id);if(!el)return;
      const down=e=>{I.btn[key]=true;el.classList.add('on');el.setPointerCapture&&el.setPointerCapture(e.pointerId);e.preventDefault()};
      const up=e=>{I.btn[key]=false;el.classList.remove('on')};
      el.addEventListener('pointerdown',down);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('lostpointercapture',up);
    };
    const tap=(id,fn)=>{
      const el=$(id);if(!el)return;
      el.addEventListener('pointerdown',e=>{el.classList.add('on');fn();e.preventDefault()});
      const up=()=>el.classList.remove('on');
      el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('pointerleave',up);
    };
    hold('bFire','fire');hold('bBoost','boost');hold('bBrake','brake');
    tap('bMsl',()=>I.cnt.m++);tap('bFlare',()=>I.cnt.r++);tap('bSwap',()=>I.cnt.w++);
    tap('bCam',()=>I.hooks.cam&&I.hooks.cam());tap('bPause',()=>I.hooks.pause&&I.hooks.pause());
    tap('bScore',()=>I.hooks.score&&I.hooks.score('toggle'));
    // сенсорный экран не должен прокручивать и масштабировать страницу во время игры
    document.addEventListener('touchmove',e=>{if(I.active)e.preventDefault()},{passive:false});
  },
  showJoy(on){const jb=$('joyBase');if(jb)jb.classList.toggle('show',on)},

  // ----- геймпад -----
  poll(){
    const gp=navigator.getGamepads?[...navigator.getGamepads()].find(g=>g&&g.connected):null;
    if(!gp){I.pad=null;return}
    const b=i=>gp.buttons[i]&&gp.buttons[i].pressed,P=I.pad||(I.pad={prev:[]});
    const edge=(i,fn)=>{const now=!!b(i);if(now&&!P.prev[i])fn();P.prev[i]=now};
    edge(5,()=>I.cnt.m++);edge(4,()=>I.cnt.r++);edge(3,()=>I.cnt.w++);edge(2,()=>I.hooks.cam&&I.hooks.cam());edge(9,()=>I.hooks.pause&&I.hooks.pause());
    P.ax=gp.axes[0]||0;P.ay=gp.axes[1]||0;P.fire=b(7)||b(0)&&false;P.boost=b(0);P.brake=b(1);
  },

  // ----- сводка для полёта -----
  sample(){
    I.poll();
    const k=I.keys,c=I.cfg;
    let y=0,p=0,t=0;
    // мышь: смещение от центра окна — положение стика
    if(c.mouse&&!I.touch&&I.mouse.on&&I.mouse.moved&&I.active){
      const R=.34*Math.min(innerWidth,innerHeight);
      let mx=(I.mouse.x-innerWidth/2)/R,my=-(I.mouse.y-innerHeight/2)/R;
      const l=Math.hypot(mx,my);
      if(l>1){mx/=l;my/=l}
      const dz=.06,sh=v=>Math.abs(v)<dz?0:Math.sign(v)*Math.pow((Math.abs(v)-dz)/(1-dz),1.25);
      y=sh(mx);p=sh(my);
    }
    if(k.has('KeyA')||k.has('ArrowLeft'))y-=1;
    if(k.has('KeyD')||k.has('ArrowRight'))y+=1;
    if(k.has('KeyW')||k.has('ArrowUp'))p+=1;
    if(k.has('KeyS')||k.has('ArrowDown'))p-=1;
    // сенсорный джойстик
    if(I.joy.id!==null){
      const sh=v=>Math.abs(v)<.08?0:Math.sign(v)*Math.pow(Math.abs(v),1.15);
      y+=sh(I.joy.vx);p+=-sh(I.joy.vy);
    }
    if(I.pad){y+=Math.abs(I.pad.ax)>.12?I.pad.ax:0;p+=Math.abs(I.pad.ay)>.12?-I.pad.ay:0}
    y=clamp(y*c.sens,-1,1);p=clamp(p*c.sens*(c.invY?-1:1),-1,1);
    if(k.has('ShiftLeft')||k.has('ShiftRight')||I.btn.boost||(I.pad&&I.pad.boost))t=1;
    if(k.has('ControlLeft')||k.has('ControlRight')||k.has('KeyX')||I.btn.brake||(I.pad&&I.pad.brake))t=t>0?0:-1;
    const f=k.has('Space')||I.mouse.down||I.btn.fire||(I.pad&&I.pad.fire)?1:0;
    return {y,p,t,f,l:c.level?1:0};
  },
};
SW.Input=I;
})(typeof window!=='undefined'?window:globalThis);
