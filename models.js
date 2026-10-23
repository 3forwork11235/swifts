// «Стрижи» — 3D-модели: дроны, ракеты, зенитки, кольца, бонусы. Всё собирается из простых форм (никаких файлов с моделями).
// Нос модели смотрит в −Z (так же, как курс yaw=0 в симуляции). Размеры в метрах.
(function(root){
'use strict';
const SW=root.SW,T=root.THREE;
if(!T)return;
const Models={};

// ---------- общие материалы и формы ----------
const G={
  box:new T.BoxGeometry(1,1,1),
  cyl:new T.CylinderGeometry(1,1,1,14),
  cyl6:new T.CylinderGeometry(1,1,1,6),
  cone:new T.ConeGeometry(1,1,12),
  sph:new T.SphereGeometry(1,14,10),
  oct:new T.OctahedronGeometry(1),
  tor:new T.TorusGeometry(1,.06,8,40),
};
const matCache=new Map();
function lam(color,extra){
  const k='l'+color+(extra?JSON.stringify(extra):'');
  let m=matCache.get(k);
  if(!m){m=new T.MeshLambertMaterial(Object.assign({color,flatShading:true},extra||{}));matCache.set(k,m)}
  return m;
}
function bas(color,extra){
  const k='b'+color+(extra?JSON.stringify(extra):'');
  let m=matCache.get(k);
  if(!m){m=new T.MeshBasicMaterial(Object.assign({color,fog:true},extra||{}));matCache.set(k,m)}
  return m;
}
const glowMat=(color,op)=>bas(color,{transparent:true,opacity:op==null?.9:op,blending:T.AdditiveBlending,depthWrite:false});
const DARK=0x23262e,METAL=0x4a505c,GLASS=0x0a2a38;

// мягкое светящееся пятно для спрайтов
let _glowTex=null;
function glowTexture(){
  if(_glowTex)return _glowTex;
  const c=document.createElement('canvas');c.width=c.height=64;
  const x=c.getContext('2d'),g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.25,'rgba(255,255,255,.55)');g.addColorStop(.6,'rgba(255,255,255,.12)');g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,64,64);
  _glowTex=new T.CanvasTexture(c);
  return _glowTex;
}
Models.glowTexture=glowTexture;
function glowSprite(color,size,op){
  const s=new T.Sprite(new T.SpriteMaterial({map:glowTexture(),color,transparent:true,opacity:op==null?.9:op,blending:T.AdditiveBlending,depthWrite:false}));
  s.scale.set(size,size,1);return s;
}
Models.glowSprite=glowSprite;

function mesh(geo,mat,sx,sy,sz,x,y,z){
  const m=new T.Mesh(geo,mat);
  m.scale.set(sx,sy==null?sx:sy,sz==null?sx:sz);
  if(x!=null)m.position.set(x,y,z);
  return m;
}
const B=(w,h,d,mat,x,y,z)=>mesh(G.box,mat,w,h,d,x,y,z);
function rotY(o,a){o.rotation.y=a;return o}
// положить потомка в точку и вернуть его (Group.add возвращает родителя, а не потомка)
function put(parent,child,x,y,z){child.position.set(x,y,z);parent.add(child);return child}
function rx(o,a){o.rotation.x=a;return o}

// винт: ступица, две лопасти и полупрозрачный диск (спин задаёт рендер)
function rotor(r,x,y,z,hubMat,discCol){
  const g=new T.Group();g.position.set(x,y,z);
  g.add(mesh(G.cyl,hubMat||lam(DARK),.12,.16,.12));
  const spin=new T.Group();
  spin.add(B(r*2,.025,.11,lam(0x15171c)));
  spin.add(rotY(B(r*2,.025,.11,lam(0x15171c)),Math.PI/2));
  g.add(spin);
  const disc=mesh(G.cyl,bas(discCol||0xbfeaff,{transparent:true,opacity:.16,depthWrite:false,side:T.DoubleSide}),r,.02,r);
  disc.position.y=.03;g.add(disc);
  g.userData.spin=spin;
  return g;
}

// ---------- общий «каркас» дрона ----------
// Возвращает {obj, rotors:[], muzzle:[sprite], thr:sprite(сопло), nav:[sprite], beam:null}
function newRig(){return {obj:new T.Group(),rotors:[],muzzle:[],thr:null,nav:[],parts:{}}}
function addMuzzles(rig,pts,size){
  for(const p of pts){
    const s=glowSprite(0xffe08a,size||1.4,0);s.position.set(p[0],p[1],p[2]);s.visible=false;rig.obj.add(s);rig.muzzle.push(s);
  }
}
function addThruster(rig,x,y,z,size,col){
  const s=glowSprite(col||0x66ccff,size,.8);s.position.set(x,y,z);rig.obj.add(s);rig.thr=s;rig.parts.thrBase=size;
}
function addNav(rig,pts){
  const cols=[0xff3b3b,0x3bff6a];
  pts.forEach((p,i)=>{const s=glowSprite(cols[i%2],.7,1);s.position.set(p[0],p[1],p[2]);rig.obj.add(s);rig.nav.push(s)});
}

// ---------- игровые корпуса ----------
function buildSwift(paint,accent){
  const rig=newRig(),o=rig.obj;
  const body=lam(paint),dark=lam(DARK),metal=lam(METAL);
  o.add(B(1.0,.42,2.3,body,0,0,.1));
  const nose=mesh(G.cone,body,.5,1.5,.5,0,0,-1.9);nose.rotation.x=-Math.PI/2;nose.scale.set(.5,1.5,.34);o.add(nose);
  o.add(mesh(G.sph,lam(GLASS,{emissive:0x0b3a4a}),.42,.28,.8,0,.28,-.35));
  o.add(B(.12,.1,1.7,bas(accent),.52,.2,.2));o.add(B(.12,.1,1.7,bas(accent),-.52,.2,.2));
  for(const [sx,sz] of [[1,-1],[-1,-1],[1,1],[-1,1]]){
    const ax=sx*1.35,az=sz*1.05+.1;
    const arm=B(.16,.1,Math.hypot(ax,az)+.1,dark);
    arm.position.set(ax/2,.12,az/2);arm.rotation.y=Math.atan2(ax,az);o.add(arm);
    const r=rotor(.82,ax,.26,az);o.add(r);rig.rotors.push(r.userData.spin);
  }
  o.add(B(.14,.14,1.0,metal,.55,-.18,-1.0));o.add(B(.14,.14,1.0,metal,-.55,-.18,-1.0));
  addMuzzles(rig,[[.55,-.18,-1.65],[-.55,-.18,-1.65]]);
  addThruster(rig,0,.02,1.35,1.5,0x66ddff);
  addNav(rig,[[-1.4,.3,1.0],[1.4,.3,1.0]]);
  return rig;
}
function buildWasp(paint,accent){
  const rig=newRig(),o=rig.obj;
  const body=lam(paint),dark=lam(DARK);
  o.add(B(.55,.38,2.6,body,0,0,0));
  const nose=mesh(G.cone,body,1,1,1);nose.rotation.x=-Math.PI/2;nose.scale.set(.28,1.3,.2);nose.position.set(0,0,-1.9);o.add(nose);
  o.add(mesh(G.sph,lam(GLASS,{emissive:0x0b3a4a}),.3,.22,.6,0,.24,-.5));
  o.add(B(.06,.08,1.9,bas(accent),0,.22,.3));
  for(const sx of [1,-1]){
    const pyl=B(.9,.08,.3,dark);pyl.position.set(sx*.65,0,-.2);o.add(pyl);
    const ring=mesh(new T.TorusGeometry(1,.1,8,26),lam(METAL),.78,.78,.78);ring.rotation.x=Math.PI/2;ring.position.set(sx*1.25,.05,-.2);o.add(ring);
    const r=rotor(.7,sx*1.25,.05,-.2);o.add(r);rig.rotors.push(r.userData.spin);
    const tail=B(.06,.5,.8,body,sx*.3,.28,1.15);tail.rotation.z=sx*-.25;o.add(tail);
  }
  o.add(B(.1,.1,.8,lam(METAL),.3,-.2,-.9));o.add(B(.1,.1,.8,lam(METAL),-.3,-.2,-.9));
  addMuzzles(rig,[[.3,-.2,-1.35],[-.3,-.2,-1.35]],1.1);
  addThruster(rig,0,0,1.45,1.2,0xffb06a);
  addNav(rig,[[-1.9,.1,-.2],[1.9,.1,-.2]]);
  return rig;
}
function buildBumble(paint,accent){
  const rig=newRig(),o=rig.obj;
  const body=lam(paint),dark=lam(DARK),metal=lam(METAL);
  o.add(B(1.7,.8,3.0,body,0,0,.1));
  o.add(B(1.3,.5,1.2,lam(0x30343d),0,-.5,-.3));
  const nose=mesh(G.cone,body,1,1,1);nose.rotation.x=-Math.PI/2;nose.scale.set(.85,1.4,.45);nose.position.set(0,0,-2.3);o.add(nose);
  o.add(mesh(G.sph,lam(GLASS,{emissive:0x0b3a4a}),.6,.35,1.0,0,.5,-.4));
  o.add(B(.14,.12,2.4,bas(accent),.86,.15,.1));o.add(B(.14,.12,2.4,bas(accent),-.86,.15,.1));
  for(const [sx,sz] of [[1,-1],[-1,-1],[1,1],[-1,1]]){
    const ax=sx*1.95,az=sz*1.3+.1;
    const arm=B(.28,.16,Math.hypot(ax,az),dark);arm.position.set(ax/2,.12,az/2);arm.rotation.y=Math.atan2(ax,az);o.add(arm);
    const r=rotor(1.15,ax,.3,az);o.add(r);rig.rotors.push(r.userData.spin);
  }
  for(const sx of [1,-1,.5,-.5])o.add(rx(mesh(G.cyl,metal,.13,.9,.13,sx*.7,-.62,-.9),Math.PI/2));
  addMuzzles(rig,[[.8,-.3,-1.9],[-.8,-.3,-1.9]],1.7);
  addThruster(rig,0,0,1.8,2.0,0x66ddff);
  addNav(rig,[[-2.1,.4,1.4],[2.1,.4,1.4]]);
  return rig;
}
function buildShade(paint,accent){
  const rig=newRig(),o=rig.obj;
  const body=lam(paint,{emissive:0x050810}),dark=lam(0x14161c);
  // стелс-«летающее крыло»: плоская пирамида
  const wing=mesh(new T.ConeGeometry(1,1,3),lam(0x1a1d26),1,1,1);wing.rotation.x=-Math.PI/2;wing.scale.set(2.4,3.8,.22);wing.position.set(0,0,-.2);o.add(wing);
  const top=mesh(new T.ConeGeometry(1,1,3),body,1,1,1);top.rotation.x=-Math.PI/2;top.scale.set(1.0,2.6,.3);top.position.set(0,.12,-.6);o.add(top);
  o.add(mesh(G.sph,lam(GLASS,{emissive:0x0b3a4a}),.3,.18,.7,0,.35,-.4));
  o.add(B(.05,.05,2.6,bas(accent),.8,.0,.0).rotateY(-.25));o.add(B(.05,.05,2.6,bas(accent),-.8,.0,.0).rotateY(.25));
  for(const sx of [1,-1]){
    const r=rotor(.62,sx*.75,.2,.9);o.add(r);rig.rotors.push(r.userData.spin);
    const ring=mesh(new T.TorusGeometry(1,.09,8,22),dark,.66,.66,.66);ring.rotation.x=Math.PI/2;ring.position.set(sx*.75,.2,.9);o.add(ring);
  }
  put(o,glowSprite(accent,.9,.9),0,0,-2.45);
  addMuzzles(rig,[[.4,-.08,-1.9],[-.4,-.08,-1.9]],1.2);
  addThruster(rig,0,.1,1.6,1.4,0x9a88ff);
  addNav(rig,[[-1.8,.0,1.0],[1.8,.0,1.0]]);
  return rig;
}

// ---------- дроны СТРАЖа: тёмные, с красным «глазом» ----------
const FOE_RED=0xff3a4c;
function buildFoe(id){
  const rig=newRig(),o=rig.obj;
  const dark=lam(0x2c2f39),plate=lam(0x3b3f4c),red=bas(FOE_RED);
  if(id==='e_wasp'||id==='e_hornet'){
    const big=id==='e_hornet',k=big?1.35:1;
    o.add(B(.8*k,.4*k,1.9*k,dark,0,0,0));
    const nose=mesh(G.cone,plate,1,1,1);nose.rotation.x=-Math.PI/2;nose.scale.set(.42*k,1.1*k,.3*k);nose.position.set(0,0,-1.45*k);o.add(nose);
    const eye=glowSprite(FOE_RED,1.1*k,1);eye.position.set(0,.05,-1.0*k);o.add(eye);
    o.add(B(.1,.1,1.4*k,red,.42*k,.12,.1));o.add(B(.1,.1,1.4*k,red,-.42*k,.12,.1));
    for(const [sx,sz] of [[1,-1],[-1,-1],[1,1],[-1,1]]){
      const ax=sx*1.05*k,az=sz*.85*k;
      const arm=B(.12*k,.08,Math.hypot(ax,az),dark);arm.position.set(ax/2,.1,az/2);arm.rotation.y=Math.atan2(ax,az);o.add(arm);
      const r=rotor(.62*k,ax,.2,az,null,0xffb3ba);o.add(r);rig.rotors.push(r.userData.spin);
    }
    if(big){o.add(B(.14,.14,.8,plate,.4,-.25,-.9));o.add(B(.14,.14,.8,plate,-.4,-.25,-.9));o.add(B(.55,.2,.5,lam(0x7a1d28),0,-.28,-.4))}
    else{o.add(B(.1,.1,.6,plate,.25,-.2,-.8));o.add(B(.1,.1,.6,plate,-.25,-.2,-.8))}
    addMuzzles(rig,[[.25,-.2,-1.2*k],[-.25,-.2,-1.2*k]],1.0);
    addThruster(rig,0,0,1.05*k,1.1*k,0xff6a4a);
  }else if(id==='e_bulk'){
    o.add(B(1.9,.9,3.2,dark,0,0,0));o.add(B(1.5,.4,2.4,plate,0,.6,.2));
    const nose=mesh(G.cone,plate,1,1,1);nose.rotation.x=-Math.PI/2;nose.scale.set(.95,1.4,.5);nose.position.set(0,0,-2.3);o.add(nose);
    const eye=glowSprite(FOE_RED,1.6,1);eye.position.set(0,.1,-1.7);o.add(eye);
    o.add(B(.14,.14,2.6,red,.98,.1,.0));o.add(B(.14,.14,2.6,red,-.98,.1,.0));
    for(const [sx,sz] of [[1,-1],[-1,-1],[1,1],[-1,1]]){
      const ax=sx*2.1,az=sz*1.4;
      const arm=B(.3,.18,Math.hypot(ax,az),dark);arm.position.set(ax/2,.12,az/2);arm.rotation.y=Math.atan2(ax,az);o.add(arm);
      const r=rotor(1.2,ax,.3,az,null,0xffb3ba);o.add(r);rig.rotors.push(r.userData.spin);
    }
    for(const sx of [1,-1])o.add(rx(mesh(G.cyl,lam(0x7a1d28),.2,1.2,.2,sx*.9,-.6,-1.0),Math.PI/2));
    addMuzzles(rig,[[.7,-.4,-2.0],[-.7,-.4,-2.0]],1.7);
    addThruster(rig,0,0,1.8,2.0,0xff6a4a);
  }else if(id==='e_kami'){
    const nose=mesh(G.cone,lam(0x4a1f26),1,1,1);nose.rotation.x=-Math.PI/2;nose.scale.set(.5,2.0,.5);nose.position.set(0,0,-.8);o.add(nose);
    o.add(B(.5,.5,1.2,dark,0,0,.6));
    const ring=mesh(new T.TorusGeometry(1,.1,8,24),dark,.8,.8,.8);ring.rotation.x=Math.PI/2;ring.position.set(0,.1,.6);o.add(ring);
    const r=rotor(.78,0,.1,.6,null,0xffb3ba);o.add(r);rig.rotors.push(r.userData.spin);
    const eye=glowSprite(FOE_RED,1.4,1);eye.position.set(0,0,-1.5);o.add(eye);
    o.add(B(.06,.06,1.6,red,0,.3,.2));
    addThruster(rig,0,0,1.3,1.3,0xff5030);
  }else{ // e_mother
    const hull=mesh(G.cyl,dark,11,2.4,11);hull.position.y=0;o.add(hull);
    o.add(mesh(G.cyl,plate,7,1.6,7,0,1.8,0));
    o.add(mesh(G.sph,lam(0x4a1f26),4,2.6,4,0,2.6,0));
    o.add(mesh(G.cyl,bas(FOE_RED),11.2,.3,11.2,0,-.5,0));
    const eye=glowSprite(FOE_RED,10,.9);eye.position.set(0,-2.4,0);o.add(eye);
    for(let i=0;i<8;i++){
      const a=i/8*Math.PI*2,x=Math.cos(a)*13,z=Math.sin(a)*13;
      const arm=B(.9,.5,5,dark);arm.position.set(x*.8,0,z*.8);arm.rotation.y=Math.atan2(x,z);o.add(arm);
      const r=rotor(4.2,x,.8,z,null,0xffb3ba);o.add(r);rig.rotors.push(r.userData.spin);
    }
    for(let i=0;i<4;i++){
      const a=i/4*Math.PI*2+Math.PI/4;
      const t=mesh(G.cyl,plate,1.2,1.4,1.2,Math.cos(a)*7,-1.7,Math.sin(a)*7);o.add(t);
      const bar=mesh(G.cyl,dark,.28,3,.28,Math.cos(a)*7,-3.2,Math.sin(a)*7);o.add(bar);
    }
    addMuzzles(rig,[[4,-3,-3],[-4,-3,-3]],4);
    addThruster(rig,0,0,12.5,8,0xff6a4a);
  }
  return rig;
}

// ---------- склейка деталей ----------
// Дрон собирается из десятков простых форм; чтобы не платить десятком вызовов отрисовки за каждую, статичные части
// склеиваются в один меш на материал, а лопасти каждого винта — в один меш внутри вращающейся группы.
function bakeInto(parent,meshes,rootInv){
  const byMat=new Map();
  for(const m of meshes){const k=m.material;if(!byMat.has(k))byMat.set(k,[]);byMat.get(k).push(m)}
  const M=new T.Matrix4(),N=new T.Matrix3();
  for(const [mat,list] of byMat){
    const pos=[],nor=[],idx=[];let base=0;
    for(const m of list){
      const g=m.geometry,p=g.attributes.position,n=g.attributes.normal;
      M.multiplyMatrices(rootInv,m.matrixWorld);N.getNormalMatrix(M);
      const v=new T.Vector3(),w=new T.Vector3();
      for(let i=0;i<p.count;i++){
        v.fromBufferAttribute(p,i).applyMatrix4(M);pos.push(v.x,v.y,v.z);
        w.fromBufferAttribute(n,i).applyMatrix3(N).normalize();nor.push(w.x,w.y,w.z);
      }
      if(g.index)for(let i=0;i<g.index.count;i++)idx.push(g.index.getX(i)+base);
      else for(let i=0;i<p.count;i++)idx.push(i+base);
      base+=p.count;
    }
    const geo=new T.BufferGeometry();
    geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new T.Float32BufferAttribute(nor,3));geo.setIndex(idx);
    const mesh=new T.Mesh(geo,mat);mesh.renderOrder=list[0].renderOrder;
    parent.add(mesh);
  }
  for(const m of meshes)m.parent.remove(m);
}
Models.optimize=function(rig){
  const obj=rig.obj;obj.updateMatrixWorld(true);
  const spins=new Set(rig.rotors);
  const inUnder=n=>{for(let p=n.parent;p;p=p.parent)if(spins.has(p))return p;return null};
  const stat=[],perSpin=new Map();
  obj.traverse(n=>{
    if(!n.isMesh)return;
    const sp=inUnder(n);
    if(sp){if(!perSpin.has(sp))perSpin.set(sp,[]);perSpin.get(sp).push(n)}else stat.push(n);
  });
  bakeInto(obj,stat,new T.Matrix4().copy(obj.matrixWorld).invert());
  for(const [sp,list] of perSpin){sp.updateMatrixWorld(true);bakeInto(sp,list,new T.Matrix4().copy(sp.matrixWorld).invert())}
};

const SKINS={swift:buildSwift,wasp:buildWasp,bumble:buildBumble,shade:buildShade};
// paintHex — цвет корпуса (число), accentHex — цвет полос и огней
Models.drone=function(hullId,paintHex,accentHex){
  const rig=SKINS[hullId]?SKINS[hullId](paintHex,accentHex):buildFoe(hullId);
  rig.hullId=hullId;
  rig.obj.userData.rig=rig;
  Models.optimize(rig);
  return rig;
};

// ---------- ракета ----------
Models.missile=function(kindN){
  const g=new T.Group();
  const col=kindN===0?0xd8f2ff:0xffd0c0,stripe=kindN===0?0x31e6ff:0xff4a3a;
  const body=mesh(G.cyl,lam(col),.17,2.4,.17);body.rotation.x=Math.PI/2;g.add(body);
  const nose=mesh(G.cone,lam(stripe),.17,.7,.17);nose.rotation.x=-Math.PI/2;nose.position.z=-1.5;g.add(nose);
  const band=mesh(G.cyl,bas(stripe),.18,.25,.18);band.rotation.x=Math.PI/2;band.position.z=-.3;g.add(band);
  for(let i=0;i<4;i++){
    const f=B(.04,.5,.45,lam(0x555a66));f.position.z=.95;f.rotation.z=i*Math.PI/2;f.position.set(Math.cos(i*Math.PI/2)*.28,Math.sin(i*Math.PI/2)*.28,.95);g.add(f);
  }
  const flame=glowSprite(kindN===0?0x9fe8ff:0xffa040,2.4,.95);flame.position.z=1.5;g.add(flame);
  g.userData.flame=flame;
  return g;
};

// ---------- зенитные установки ----------
Models.site=function(type){
  const g=new T.Group(),dark=lam(0x2b2f38),plate=lam(0x3d4250),red=lam(0x8c2430),redGlow=bas(0xff3a4c);
  const yaw=new T.Group();g.userData.yaw=yaw;
  if(type==='sam'){
    g.add(mesh(G.cyl,dark,5.5,1.2,5.5,0,.6,0));g.add(mesh(G.cyl6,plate,4,.6,4,0,1.4,0));
    yaw.position.y=1.7;g.add(yaw);
    yaw.add(B(3.2,1.6,3.6,plate,0,.8,.4));
    const pitch=new T.Group();pitch.position.set(0,1.9,-.6);yaw.add(pitch);g.userData.pitch=pitch;
    for(const [x,y] of [[.8,.8],[-.8,.8],[.8,-.8],[-.8,-.8]]){
      const t=mesh(G.cyl,dark,.6,5.6,.6,x,y,-1.4);t.rotation.x=Math.PI/2;pitch.add(t);
      const tip=mesh(G.cyl,red,.52,.5,.52,x,y,-4.1);tip.rotation.x=Math.PI/2;pitch.add(tip);
    }
    pitch.rotation.x=.9;
    const dish=mesh(G.cyl,dark,1.4,.12,1.4,1.9,2.2,.4);dish.rotation.z=.7;yaw.add(dish);
    put(yaw,glowSprite(0xff4a3a,1.2,.9),0,2.3,1.6);
  }else if(type==='flak'){
    g.add(mesh(G.cyl,dark,3.6,1,3.6,0,.5,0));
    yaw.position.y=1;g.add(yaw);
    yaw.add(B(2.2,1.3,2.2,plate,0,.65,0));
    const pitch=new T.Group();pitch.position.set(0,1.3,0);yaw.add(pitch);g.userData.pitch=pitch;
    for(const sx of [.55,-.55]){const b=mesh(G.cyl,lam(0x1b1d24),.2,5.2,.2,sx,0,-2.4);b.rotation.x=Math.PI/2;pitch.add(b)}
    pitch.add(B(1.6,.8,1.2,dark,0,0,-.2));
    pitch.rotation.x=.5;
    const m=glowSprite(0xffd070,1.8,0);m.position.set(0,0,-5.2);m.visible=false;pitch.add(m);g.userData.muzzle=m;
  }else if(type==='pylon'){
    g.add(mesh(G.cyl6,dark,4,1.2,4,0,.6,0));
    g.add(mesh(G.cyl,plate,1.7,20,1.7,0,11,0));
    g.add(mesh(G.cyl,lam(0x5a2c88),1.1,22,1.1,0,12,0));
    const orb=mesh(G.sph,bas(0xff4bd8),2.6,2.6,2.6,0,23.5,0);g.add(orb);g.userData.orb=orb;
    put(g,glowSprite(0xff4bd8,12,.8),0,23.5,0);
    const ring=mesh(new T.TorusGeometry(1,.1,8,30),bas(0xff9af0),3.8,3.8,3.8,0,23.5,0);ring.rotation.x=Math.PI/2;g.add(ring);g.userData.ring=ring;
  }else{ // core
    g.add(mesh(G.cyl6,dark,14,2.5,14,0,1.2,0));
    const core=mesh(G.sph,bas(0xff3a4c),6.5,6.5,6.5,0,12,0);g.add(core);g.userData.core=core;
    put(g,glowSprite(0xff2a3a,34,.7),0,12,0);
    const r1=mesh(new T.TorusGeometry(1,.06,8,40),bas(0xff9a9a),11,11,11,0,12,0);g.add(r1);g.userData.r1=r1;
    const r2=mesh(new T.TorusGeometry(1,.05,8,40),bas(0xffd0d0),14,14,14,0,12,0);r2.rotation.x=1.2;g.add(r2);g.userData.r2=r2;
    const sh=mesh(G.sph,bas(0x9a6bff,{transparent:true,opacity:.18,depthWrite:false,blending:T.AdditiveBlending}),17,17,17,0,12,0);g.add(sh);g.userData.shield=sh;
  }
  g.userData.type=type;
  return g;
};

// ---------- кольцо маршрута (радиус r), смотрит вдоль нормали ----------
Models.ring=function(r){
  const g=new T.Group();
  const tor=mesh(new T.TorusGeometry(1,.045,10,56),bas(0xffcf3a),r,r,r);g.add(tor);
  const glow=mesh(new T.TorusGeometry(1,.09,8,56),bas(0xffcf3a,{transparent:true,opacity:.28,blending:T.AdditiveBlending,depthWrite:false}),r,r,r);g.add(glow);
  const disc=mesh(new T.CircleGeometry(1,40),bas(0xffcf3a,{transparent:true,opacity:.06,side:T.DoubleSide,blending:T.AdditiveBlending,depthWrite:false}),r,r,r);g.add(disc);
  g.userData={tor,glow,disc};
  return g;
};

// ---------- бонус ----------
Models.pickup=function(kind){
  const col=new T.Color(SW.PICKS[kind].col);
  const g=new T.Group();
  g.add(mesh(G.oct,bas(col),1.5,1.9,1.5));
  g.add(mesh(G.oct,bas(col,{wireframe:true,transparent:true,opacity:.5}),2.6,3.2,2.6));
  g.add(glowSprite(col.getHex(),9,.7));
  return g;
};

// ---------- дрон-превью для ангара ----------
Models.G=G;Models.lam=lam;Models.bas=bas;Models.mesh=mesh;
SW.Models=Models;
})(typeof window!=='undefined'?window:globalThis);
