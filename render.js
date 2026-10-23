// «Стрижи» — отрисовка (Three.js): сцена, небо, здания, вода, дроны, ракеты, камера.
// Здания всей карты склеиваются в один меш (два-три вызова отрисовки на мир), окна — текстура-эмиссия.
// Мир (world.js) — единственный источник правды о геометрии; здесь он только рисуется.
(function(root){
'use strict';
const SW=root.SW,T=root.THREE;
if(!T)return;
const K=SW.BOX_KIND;
const {clamp}=SW;

const THEMES={
  city:{sky:[0x02030c,0x120d33,0x5a1a5e],fog:0x1d1038,near:320,far:2300,hemi:[0x7f8cff,0x20102e,.85],sun:{col:0xb9c6ff,int:.5,dir:[-.4,.8,.3]},
    stars:1,body:{col:0xdfe6ff,size:380,dir:[-.5,.42,-.78]},ambient:0x15102a,
    bld:[0x20264d,0x2a3163,0x32295f,0x1b3252,0x261f47,0x2e1c45],neon:[0x00e5ff,0xff3df2,0xffd23d,0x46ff9a],tex:'windows'},
  canyon:{sky:[0x2a1c52,0xc9587a,0xffb068],fog:0xe39a6b,near:260,far:2500,hemi:[0xffd6b0,0x9a5a3e,1.15],sun:{col:0xffd9ae,int:1.2,dir:[.65,.32,-.4]},
    stars:0,body:{col:0xffe2b0,size:520,dir:[.82,.26,-.52]},ambient:0x40201a,
    bld:[0xc9643a,0xb04e30,0xd6794a,0xa24428,0xbf5a38,0xe3925f],neon:[0xffb347],tex:'strata'},
  port:{sky:[0x2c5088,0x9bbfe0,0xffd9a8],fog:0xa9bccf,near:320,far:2700,hemi:[0xd5e7ff,0x3a4a5a,.95],sun:{col:0xfff1d6,int:1.05,dir:[-.5,.42,.6]},
    stars:0,body:{col:0xfff0cf,size:420,dir:[-.58,.36,-.72]},ambient:0x2a3340,
    bld:[0xb8bec7,0x9aa3ae,0xc9ccd2,0xaab3bd,0x8e98a4,0xbdb6aa],neon:[0xffcf3a],tex:'plain'},
};
const BOXCOL={ // цвета контейнеров, кранов и судов
  [K.BOX]:[0xd7452e,0x2f6fd6,0xe0a526,0x3aa65c,0x8a8f99,0xc9d1db],
  [K.SHIP]:[0x2a3f66,0x7a2a2a,0x3b5b4a],
  [K.CRANE]:[0xf0b429],[K.DECK]:[0x6b6f77],[K.BRIDGE]:[0x3a6a8a,0x4a5a9a,0x3a8a8a,0x5a4a8a],[K.MAST]:[0x22242c],
};

// ---------- текстуры ----------
function canvasTex(w,h,draw,opts){
  const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
  const t=new T.CanvasTexture(c);
  if(opts&&opts.repeat){t.wrapS=t.wrapT=T.RepeatWrapping}
  t.anisotropy=4;return t;
}
function rnd(seed){return SW.rng(seed)}
// фасад: 4×4 окна на плитку; светящиеся — в эмиссионной карте, плитка стены — в обычной
function facadeTextures(){
  const r=rnd(77),N=4,S=128,cell=S/N;
  const wall=canvasTex(S,S,(x)=>{
    x.fillStyle='#8a90a8';x.fillRect(0,0,S,S);
    for(let i=0;i<N;i++)for(let j=0;j<N;j++){
      x.fillStyle='#4b5068';x.fillRect(i*cell+6,j*cell+7,cell-12,cell-14);
      x.fillStyle='rgba(255,255,255,.07)';x.fillRect(i*cell+6,j*cell+7,cell-12,3);
    }
  },{repeat:1});
  const lit=canvasTex(S,S,(x)=>{
    x.fillStyle='#000';x.fillRect(0,0,S,S);
    const cols=['#ffd9a0','#ffe8c0','#9fe6ff','#ffb3ec','#b8ffd0'];
    for(let i=0;i<N;i++)for(let j=0;j<N;j++){
      if(r()<.46){x.fillStyle=cols[r()<.7?0:r.int(0,cols.length)];x.globalAlpha=.55+r()*.45;x.fillRect(i*cell+6,j*cell+7,cell-12,cell-14);x.globalAlpha=1}
    }
  },{repeat:1});
  return {wall,lit};
}
function strataTexture(){
  const r=rnd(5);
  return canvasTex(64,128,(x,w,h)=>{
    x.fillStyle='#b0b0b0';x.fillRect(0,0,w,h);
    for(let y=0;y<h;y+=3){x.fillStyle=`rgba(${r()<.5?'255,255,255':'0,0,0'},${.03+r()*.1})`;x.fillRect(0,y,w,2+r()*4)}
    for(let i=0;i<120;i++){x.fillStyle=`rgba(0,0,0,${r()*.09})`;x.fillRect(r()*w,r()*h,2+r()*8,1+r()*3)}
  },{repeat:1});
}
function noiseTexture(seed,size,contrast){
  const r=rnd(seed);
  return canvasTex(size,size,(x,w,h)=>{
    x.fillStyle='#808080';x.fillRect(0,0,w,h);
    for(let i=0;i<w*h/90;i++){const v=128+(r()-.5)*255*contrast;x.fillStyle=`rgb(${v|0},${v|0},${v|0})`;const s=1+r()*5;x.beginPath();x.arc(r()*w,r()*h,s,0,6.28);x.fill()}
  },{repeat:1});
}

// ---------- склейка коробок в один меш ----------
const FACE=[ // нормаль, 4 угла (по обходу), оттенок
  {n:[1,0,0],v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]],sh:.8},
  {n:[-1,0,0],v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],sh:.8},
  {n:[0,1,0],v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],sh:1.0,top:true},
  {n:[0,-1,0],v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],sh:.35},
  {n:[0,0,1],v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],sh:.64},
  {n:[0,0,-1],v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]],sh:.64},
];
class BoxMesher{
  constructor(roof,grad){this.p=[];this.n=[];this.uv=[];this.c=[];this.i=[];this.roof=roof==null?1:roof;this.grad=grad||0}
  // uvScale: размер плитки текстуры в метрах (0 — без текстуры)
  add(x0,y0,z0,x1,y1,z1,color,tile,uo,vo,glow){
    const col=new T.Color(color),dx=x1-x0,dy=y1-y0,dz=z1-z0;
    for(const f of FACE){
      const base=this.p.length/3;
      for(let k=0;k<4;k++){
        const v=f.v[k];
        this.p.push(x0+v[0]*dx,y0+v[1]*dy,z0+v[2]*dz);
        this.n.push(f.n[0],f.n[1],f.n[2]);
        let sh=glow?1:(f.top?this.roof:f.sh);
        if(!glow&&this.grad&&f.n[1]===0)sh*=1-this.grad+this.grad*v[1]; // 0 у основания → 1 на крыше
        this.c.push(col.r*sh,col.g*sh,col.b*sh);
        if(!tile||f.n[1]!==0){this.uv.push(.02,.02)}
        else{
          const u=(f.n[0]!==0?(v[2]*dz+z0):(v[0]*dx+x0))/tile+uo,w=(v[1]*dy+y0)/tile+vo;
          this.uv.push(u,w);
        }
      }
      this.i.push(base,base+1,base+2,base,base+2,base+3);
    }
  }
  geometry(){
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(this.p,3));
    g.setAttribute('normal',new T.Float32BufferAttribute(this.n,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(this.uv,2));
    g.setAttribute('color',new T.Float32BufferAttribute(this.c,3));
    g.setIndex(this.i);return g;
  }
}

// ---------- рендер ----------
const R={
  quality:2,mode:'menu',world:null,theme:null,drones:new Map(),missiles:new Map(),sites:new Map(),rings:[],pickups:[],time:0,
  W:1,H:1,
  init(canvas,quality){
    R.quality=quality==null?2:quality;
    try{
      R.renderer=new T.WebGLRenderer({canvas,antialias:R.quality>=1,powerPreference:'high-performance',alpha:false});
    }catch(e){R.failed=true;return false}
    R.pr=Math.min(root.devicePixelRatio||1,[1,1.5,2][R.quality]);
    R.renderer.setPixelRatio(R.pr);
    R.scene=new T.Scene();
    R.cam=new T.PerspectiveCamera(72,1,.4,6000);
    R.hemi=new T.HemisphereLight(0xffffff,0x222233,.8);R.scene.add(R.hemi);
    R.sun=new T.DirectionalLight(0xffffff,.8);R.scene.add(R.sun);R.scene.add(R.sun.target);
    R.worldGroup=new T.Group();R.scene.add(R.worldGroup);
    R.entGroup=new T.Group();R.scene.add(R.entGroup);
    SW.FX.init(R.scene,R.quality);
    R.fx=SW.FX;
    R.resize();
    return true;
  },
  resize(){
    const w=root.innerWidth,h=root.innerHeight;
    R.W=w;R.H=h;
    R.renderer.setSize(w,h,false);
    R.cam.aspect=w/h;R.cam.updateProjectionMatrix();
    R.fx.setScale(h*R.pr,R.cam.fov);
  },
  // Автоподбор разрешения: если кадр долго длится дольше ~30 мс — снижаем плотность пикселей, если запас — возвращаем
  adapt(dt){
    if(dt>.12)return;
    R.fa=(R.fa||dt)*.95+dt*.05;R.adaptT=(R.adaptT||0)+dt;
    if(R.adaptT<2.5)return;R.adaptT=0;
    const max=Math.min(root.devicePixelRatio||1,[1,1.5,2][R.quality]);
    if(R.fa>1/32&&R.pr>.6){R.pr=Math.max(.6,R.pr*.85);R.renderer.setPixelRatio(R.pr);R.resize()}
    else if(R.fa<1/55&&R.pr<max-.02){R.pr=Math.min(max,R.pr*1.12);R.renderer.setPixelRatio(R.pr);R.resize()}
  },
  setFov(f){if(Math.abs(R.cam.fov-f)>.05){R.cam.fov=f;R.cam.updateProjectionMatrix();R.fx.setScale(R.H*R.pr,f)}},

  // ----- мир -----
  clearWorld(){
    for(const o of R.worldGroup.children.slice()){
      R.worldGroup.remove(o);
      o.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material){if(c.material.map)c.material.map.dispose();c.material.dispose()}});
    }
    R.sky=R.stars=R.body=R.water=R.zone=null;R.beacons=[];
    R.world=null;
  },
  loadWorld(world){
    if(R.world===world)return;
    R.clearWorld();
    const th=THEMES[world.id]||THEMES.city;R.theme=th;R.world=world;
    const G=R.worldGroup;
    // освещение и туман
    R.scene.fog=new T.Fog(th.fog,th.near,th.far);
    R.scene.background=new T.Color(th.fog);
    R.hemi.color.setHex(th.hemi[0]);R.hemi.groundColor.setHex(th.hemi[1]);R.hemi.intensity=th.hemi[2];
    R.sun.color.setHex(th.sun.col);R.sun.intensity=th.sun.int;R.sun.position.set(th.sun.dir[0]*1000,th.sun.dir[1]*1000,th.sun.dir[2]*1000);
    // небо: градиентный купол
    {
      const g=new T.SphereGeometry(4600,24,16),pos=g.attributes.position,cols=[];
      const c0=new T.Color(th.sky[0]),c1=new T.Color(th.sky[1]),c2=new T.Color(th.sky[2]),cf=new T.Color(th.fog),tmp=new T.Color();
      for(let i=0;i<pos.count;i++){
        const t=pos.getY(i)/4600;
        if(t>=0){ if(t<.18)tmp.copy(c2).lerp(c1,t/.18); else tmp.copy(c1).lerp(c0,Math.min(1,(t-.18)/.6)) }
        else tmp.copy(c2).lerp(cf,Math.min(1,-t*3));
        cols.push(tmp.r,tmp.g,tmp.b);
      }
      g.setAttribute('color',new T.Float32BufferAttribute(cols,3));
      R.sky=new T.Mesh(g,new T.MeshBasicMaterial({vertexColors:true,side:T.BackSide,fog:false,depthWrite:false}));
      R.sky.renderOrder=-10;G.add(R.sky);
    }
    if(th.stars){
      const r=rnd(11),p=[];
      for(let i=0;i<700;i++){const a=r()*6.283,e=Math.asin(r()*.95+.04),d=4400;p.push(Math.cos(a)*Math.cos(e)*d,Math.sin(e)*d,Math.sin(a)*Math.cos(e)*d)}
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));
      R.stars=new T.Points(g,new T.PointsMaterial({color:0xffffff,size:2.2,sizeAttenuation:false,fog:false,transparent:true,opacity:.85,depthWrite:false}));
      R.stars.renderOrder=-9;G.add(R.stars);
    }
    {
      const d=th.body.dir,n=Math.hypot(d[0],d[1],d[2]);
      const s=SW.Models.glowSprite(th.body.col,th.body.size,1);s.material.fog=false;s.material.depthWrite=false;
      R.bodyDir=[d[0]/n,d[1]/n,d[2]/n];s.renderOrder=-8;R.body=s;G.add(s);
      const core=SW.Models.glowSprite(0xffffff,.34,1);core.material.fog=false;core.material.depthWrite=false;core.renderOrder=-7;s.add(core);
    }
    R.buildGround(world,th,G);
    R.buildBuildings(world,th,G);
    R.buildFar(world,th,G);
    R.buildZone(world,G);
  },
  buildGround(world,th,G){
    const H=world.half;
    if(world.id==='city'){
      const P=2*H/9,road=60;
      const tex=canvasTex(2048,2048,(x,w,h)=>{
        const s=w/(2*H);
        x.fillStyle='#0c0f1b';x.fillRect(0,0,w,h);
        x.fillStyle='#161a2c';
        for(let i=0;i<9;i++)for(let j=0;j<9;j++)x.fillRect((i*P+road/2)*s,(j*P+road/2)*s,(P-road)*s,(P-road)*s);
        x.strokeStyle='rgba(0,229,255,.55)';x.lineWidth=2;x.setLineDash([22*s,18*s]);
        for(let i=0;i<=9;i++){x.beginPath();x.moveTo(i*P*s,0);x.lineTo(i*P*s,h);x.stroke();x.beginPath();x.moveTo(0,i*P*s);x.lineTo(w,i*P*s);x.stroke()}
        x.setLineDash([]);x.strokeStyle='rgba(255,61,242,.7)';x.lineWidth=3;
        for(let i=0;i<9;i++){const a=(i*P+road/2)*s,b=(i*P+P-road/2)*s;
          for(const q of [a,b]){x.beginPath();x.moveTo(q,0);x.lineTo(q,h);x.stroke();x.beginPath();x.moveTo(0,q);x.lineTo(w,q);x.stroke()}}
      });
      const m=new T.Mesh(new T.PlaneGeometry(2*H,2*H),new T.MeshBasicMaterial({map:tex}));
      m.rotation.x=-Math.PI/2;G.add(m);
    }else if(world.id==='canyon'){
      const tex=canvasTex(1024,1024,(x,w,h)=>{
        const r=rnd(3);x.fillStyle='#c98a5a';x.fillRect(0,0,w,h);
        for(let i=0;i<900;i++){x.fillStyle=`rgba(${r()<.5?'140,70,40':'230,170,110'},${.04+r()*.1})`;const s=8+r()*50;x.beginPath();x.ellipse(r()*w,r()*h,s,s*(.3+r()*.7),r()*3,0,6.28);x.fill()}
      });
      const m=new T.Mesh(new T.PlaneGeometry(2*H,2*H),new T.MeshLambertMaterial({map:tex}));m.rotation.x=-Math.PI/2;G.add(m);
    }else{ // порт: море
      const bump=noiseTexture(9,256,.55);bump.repeat.set(16,16);
      const mat=new T.MeshPhongMaterial({color:0x174a68,shininess:140,specular:0xb4d4ea,bumpMap:bump,bumpScale:.22});
      const m=new T.Mesh(new T.PlaneGeometry(2*H,2*H),mat);m.rotation.x=-Math.PI/2;G.add(m);R.water=bump;
    }
    // за пределами арены — ровный цвет под цвет тумана
    const far=new T.Mesh(new T.PlaneGeometry(9000,9000),new T.MeshBasicMaterial({color:world.id==='port'?0x1a4a68:world.id==='canyon'?0xb27a52:0x0a0c16}));
    far.rotation.x=-Math.PI/2;far.position.y=-.3;G.add(far);
  },
  buildBuildings(world,th,G){
    const b=world.b,n=world.count;
    const mesher=new BoxMesher(th.tex==='windows'?.38:1.1,th.tex==='windows'?.0:th.tex==='strata'?.5:.3),neon=new BoxMesher();
    const r=rnd(world.seed+99);
    const tile=th.tex==='windows'?12.8:th.tex==='strata'?60:0;
    R.beacons=[];
    for(let i=0;i<n;i++){
      const o=i*6,x0=b[o],y0=b[o+1],z0=b[o+2],x1=b[o+3],y1=b[o+4],z1=b[o+5],kind=world.kind[i],tint=world.tint[i];
      let color;
      if(BOXCOL[kind]){const a=BOXCOL[kind];color=a[tint%a.length]}
      else color=th.bld[tint%th.bld.length];
      const useTile=(kind===K.BUILD||kind===K.TIER)&&th.tex==='windows'?tile:(kind===K.ROCK?tile:0);
      mesher.add(x0,y0,z0,x1,y1,z1,color,useTile,Math.floor(r()*4)/4,Math.floor(r()*4)/4);
      // неон по верху башен и вдоль мостов
      if(th.tex==='windows'){
        const h=y1-y0;
        if((kind===K.BUILD||kind===K.TIER)&&y1>95&&h>14){
          const nc=th.neon[tint%th.neon.length],t=.7;
          neon.add(x0-.2,y1-t,z0-.2,x1+.2,y1,z0+.4,nc,0,0,0,1);neon.add(x0-.2,y1-t,z1-.4,x1+.2,y1,z1+.2,nc,0,0,0,1);
          neon.add(x0-.2,y1-t,z0-.2,x0+.4,y1,z1+.2,nc,0,0,0,1);neon.add(x1-.4,y1-t,z0-.2,x1+.2,y1,z1+.2,nc,0,0,0,1);
          if(y1>200)for(const [cx,cz] of [[x0,z0],[x1,z0],[x0,z1],[x1,z1]])neon.add(cx-.3,y0+4,cz-.3,cx+.3,y1,cz+.3,nc,0,0,0,1);
        }else if(kind===K.BRIDGE){
          neon.add(x0,y1,z0,x1,y1+.35,z1,0x00e5ff,0,0,0,1);
        }
      }
      if(kind===K.MAST||(kind===K.BUILD&&y1>150&&th.tex==='windows'))R.beacons.push((x0+x1)/2,y1+2,(z0+z1)/2,r()*6.28,kind===K.MAST?10:7);
    }
    R.makeBeacons(G);
    const geo=mesher.geometry();
    const texs=th.tex==='windows'?facadeTextures():null;
    const mat=new T.MeshLambertMaterial({vertexColors:true,map:texs?texs.wall:(th.tex==='strata'?strataTexture():null),
      emissive:texs?0xffffff:0x000000,emissiveMap:texs?texs.lit:null,emissiveIntensity:texs?1.15:0});
    G.add(new T.Mesh(geo,mat));
    if(neon.p.length){
      const ng=neon.geometry();
      G.add(new T.Mesh(ng,new T.MeshBasicMaterial({vertexColors:true})));
    }
  },
  // красные огни на мачтах и крышах: один набор точек, мигание считает шейдер
  makeBeacons(G){
    const a=R.beacons;R.beaconMat=null;
    if(!a.length)return;
    const n=a.length/5,pos=new Float32Array(n*3),ph=new Float32Array(n),sz=new Float32Array(n);
    for(let i=0;i<n;i++){pos[i*3]=a[i*5];pos[i*3+1]=a[i*5+1];pos[i*3+2]=a[i*5+2];ph[i]=a[i*5+3];sz[i]=a[i*5+4]}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(pos,3));g.setAttribute('aPh',new T.BufferAttribute(ph,1));g.setAttribute('aSz',new T.BufferAttribute(sz,1));
    R.beaconMat=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,uniforms:{uT:{value:0},uScale:{value:600}},
      vertexShader:'attribute float aPh;attribute float aSz;uniform float uT;uniform float uScale;varying float vA;void main(){vA=sin(uT*2.6+aPh)>.35?1.0:.08;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=min(aSz*uScale/max(1.0,-mv.z),64.0);gl_Position=projectionMatrix*mv;}',
      fragmentShader:'varying float vA;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float a=(1.-d);gl_FragColor=vec4(1.0,.16,.2,a*a*vA);}'});
    const p=new T.Points(g,R.beaconMat);p.frustumCulled=false;p.renderOrder=3;G.add(p);
  },
  // дальний силуэт за границей арены — глубина горизонта
  buildFar(world,th,G){
    const m=new BoxMesher(),r=rnd(world.seed+5),H=world.half;
    const col=new T.Color(th.fog).multiplyScalar(world.id==='city'?.55:.8);
    for(let i=0;i<110;i++){
      const a=r()*6.283,d=H*1.35+r()*900,x=Math.cos(a)*d,z=Math.sin(a)*d;
      const w=40+r()*120,h=world.id==='city'?60+r()*260:world.id==='canyon'?100+r()*320:12+r()*60;
      m.add(x-w/2,0,z-w/2,x+w/2,h,z+w/2,col.getHex(),0,0,0,0);
    }
    const mat=new T.MeshBasicMaterial({vertexColors:true});
    G.add(new T.Mesh(m.geometry(),mat));
  },
  // «силовой барьер» на краю карты — проявляется вблизи
  buildZone(world,G){
    const H=world.half,c=world.ceil;
    const tex=canvasTex(128,128,(x,w,h)=>{
      x.clearRect(0,0,w,h);x.strokeStyle='rgba(120,230,255,.9)';x.lineWidth=2;
      for(let i=0;i<=8;i++){x.beginPath();x.moveTo(i*16,0);x.lineTo(i*16,h);x.stroke();x.beginPath();x.moveTo(0,i*16);x.lineTo(w,i*16);x.stroke()}
    },{repeat:1});
    R.zone=[];
    for(let k=0;k<4;k++){
      const m=new T.Mesh(new T.PlaneGeometry(2*H,c),new T.MeshBasicMaterial({map:tex,transparent:true,opacity:0,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,fog:false}));
      tex.repeat.set(2*H/60,c/60);
      const a=k*Math.PI/2;m.position.set(Math.sin(a)*H,c/2,Math.cos(a)*H);m.rotation.y=a+Math.PI;
      G.add(m);R.zone.push({m,nx:Math.sin(a),nz:Math.cos(a)});
    }
  },

  // ----- дроны -----
  // info: {hull, skin:{paint,trail,emblem}, foe:bool}
  addDrone(id,info){
    R.removeDrone(id);
    const paint=SW.PAINTS[(info.skin&&info.skin.paint)|0]||SW.PAINTS[0];
    const col=new T.Color(paint.c).getHex();
    const rig=SW.Models.drone(info.hull,col,col);
    const o={id,rig,group:rig.obj,foe:!!info.foe,trailAcc:0,smokeAcc:0,gunAcc:0,blink:Math.random()*6,spinPh:Math.random()*6,hull:info.hull,trail:(info.skin&&info.skin.trail)|0,col:new T.Color(paint.c),
      shield:null,shot:0,dead:false};
    if(info.foe){o.col.setHex(0xff5a4a)}
    const sh=new T.Mesh(SW.Models.G.sph,new T.MeshBasicMaterial({color:0x9a6bff,transparent:true,opacity:.28,blending:T.AdditiveBlending,depthWrite:false}));
    sh.scale.setScalar(info.foe&&info.hull==='e_mother'?18:3.4);sh.visible=false;rig.obj.add(sh);o.shield=sh;
    R.entGroup.add(rig.obj);
    R.drones.set(id,o);
    return o;
  },
  removeDrone(id){
    const o=R.drones.get(id);if(!o)return;
    R.entGroup.remove(o.group);R.drones.delete(id);
  },
  // s: {x,y,z,yaw,pitch,roll,spd,hp,maxhp,flags,alive}
  updateDrone(id,s,dt){
    const o=R.drones.get(id);if(!o)return;
    const g=o.group;
    g.visible=s.alive!==false;
    if(!g.visible)return;
    g.position.set(s.x,s.y,s.z);
    g.rotation.set(s.pitch,s.yaw,s.roll,'YXZ');
    const f=s.flags|0,boost=!!(f&2),gun=!!(f&4),shield=!!(f&16),inv=!!(f&32);
    o.blink+=dt;
    // винты
    const sp=(boost?60:40)*(o.foe?1.1:1);
    for(const r of o.rig.rotors)r.rotation.y+=sp*dt;
    // сопло
    if(o.rig.thr){
      const base=o.rig.parts.thrBase||1.4,k=(boost?1.9:1)*(.85+.15*Math.sin(o.blink*40));
      o.rig.thr.scale.setScalar(base*k);o.rig.thr.material.opacity=boost?1:.7;
    }
    for(let i=0;i<o.rig.nav.length;i++)o.rig.nav[i].material.opacity=(Math.sin(o.blink*5+i*3)>0.4)?1:.15;
    // вспышки пушки
    for(const m of o.rig.muzzle){
      const on=gun&&Math.random()<.55;m.visible=on;
      if(on){m.material.opacity=.9;m.scale.setScalar(m.scale.x*0+1.0+Math.random()*.6)}
    }
    o.shield.visible=shield;
    if(inv){g.visible=Math.sin(o.blink*38)>-.3}
    // след двигателя и дым из повреждённого дрона
    const v=Math.max(s.spd,1),fx=-Math.sin(s.yaw)*Math.cos(s.pitch),fy=Math.sin(s.pitch),fz=-Math.cos(s.yaw)*Math.cos(s.pitch);
    o.trailAcc+=dt;
    const every=boost?.016:.026;
    while(o.trailAcc>every){
      o.trailAcc-=every;
      const back=1.6+v*o.trailAcc; // точка вылета сдвинута на путь, пройденный с момента «должного» выброса — след получается сплошным
      const bx=s.x-fx*back,by=s.y-fy*back,bz=s.z-fz*back;
      if(o.foe)R.fx.trail(bx,by,bz,1,.35,.2,boost?1.3:.8,.4);
      else{
        const tr=o.trail;
        if(tr===3){const h=(o.blink*.6)%1;const c=new T.Color().setHSL(h,1,.6);R.fx.trail(bx,by,bz,c.r,c.g,c.b,boost?1.7:1.1,.7)}
        else{
          const c=tr===0?[.75,.9,1]:tr===1?[.15,.9,1]:tr===2?[1,.55,.15]:tr===4?[1,.95,.6]:[.6,.5,1];
          R.fx.trail(bx,by,bz,c[0],c[1],c[2],boost?1.5:.85,boost?.8:.5);
        }
      }
    }
    if(s.maxhp&&s.hp<s.maxhp*.4){
      o.smokeAcc+=dt;
      const k=1-s.hp/(s.maxhp*.4);
      while(o.smokeAcc>.07){o.smokeAcc-=.07;R.fx.smokeP(s.x,s.y+.3,s.z,R.fx.rnd(1),1.2,R.fx.rnd(1),1.1,.5,2.2+k*1.5,.18,.5+k*.3,1);if(k>.5)R.fx.glowP(s.x,s.y,s.z,R.fx.rnd(2),R.fx.rnd(2),R.fx.rnd(2),.3,1.2,.2,1,.5,.1,.8,0,0)}
    }
  },

  // ----- ракеты -----
  updateMissile(id,s,kindN,dt){
    let o=R.missiles.get(id);
    if(!o){o={g:SW.Models.missile(kindN),acc:0};R.entGroup.add(o.g);R.missiles.set(id,o)}
    o.seen=R.frameNo;
    o.g.position.set(s.x,s.y,s.z);o.g.rotation.set(s.pitch,s.yaw,0,'YXZ');
    o.g.userData.flame.scale.setScalar(2+Math.random()*.8);
    o.acc+=dt;
    while(o.acc>.03){
      o.acc-=.03;
      const fx=-Math.sin(s.yaw)*Math.cos(s.pitch),fy=Math.sin(s.pitch),fz=-Math.cos(s.yaw)*Math.cos(s.pitch);
      R.fx.smokeP(s.x-fx*1.8,s.y-fy*1.8,s.z-fz*1.8,R.fx.rnd(.5),R.fx.rnd(.5),R.fx.rnd(.5),1.1,.5,2.6,.75,.45,.8);
      R.fx.glowP(s.x-fx*1.5,s.y-fy*1.5,s.z-fz*1.5,0,0,0,.14,1.5,.4,1,.7,.3,.8,0,0);
    }
  },
  sweepMissiles(){
    for(const [id,o] of R.missiles)if(o.seen!==R.frameNo){R.entGroup.remove(o.g);R.missiles.delete(id)}
  },
  frameNo:0,

  // ----- установки -----
  ensureSite(idx,type,x,y,z){
    let o=R.sites.get(idx);
    if(o)return o;
    const g=SW.Models.site(type);g.position.set(x,y,z);R.entGroup.add(g);
    o={g,type,x,y,z,alive:true,aim:0,pit:0,ph:Math.random()*6};R.sites.set(idx,o);return o;
  },
  // t: цель (x,y,z) или null; invul — под защитой
  updateSite(idx,alive,t,invul,firing,dt){
    const o=R.sites.get(idx);if(!o)return;
    o.ph+=dt;
    if(!alive){
      if(o.alive){ // разрушена: темнеем и дымим
        o.alive=false;
        o.g.traverse(c=>{if(c.material&&c.material.color&&!c.material.isSpriteMaterial&&!c.material.transparent){c.material=c.material.clone();c.material.color.multiplyScalar(.28)}});
        if(o.g.userData.orb)o.g.userData.orb.visible=false;
        if(o.g.userData.core)o.g.userData.core.visible=false;
        if(o.g.userData.shield)o.g.userData.shield.visible=false;
      }
      if(Math.random()<dt*5)R.fx.smokeP(o.x+R.fx.rnd(2),o.y+3,o.z+R.fx.rnd(2),R.fx.rnd(1),3,R.fx.rnd(1),2.5,1.5,5,.2,.6,.5);
      return;
    }
    const U=o.g.userData;
    if(U.yaw&&t){
      const want=Math.atan2(-(t.x-o.x),-(t.z-o.z)),hd=Math.hypot(t.x-o.x,t.z-o.z),wp=Math.atan2(t.y-o.y-3,hd);
      let d=want-U.yaw.rotation.y;d=(d+Math.PI)%(Math.PI*2)-Math.PI;if(d<-Math.PI)d+=Math.PI*2;
      U.yaw.rotation.y+=clamp(d,-2.2*dt,2.2*dt);
      if(U.pitch)U.pitch.rotation.x+=clamp(wp-U.pitch.rotation.x,-1.5*dt,1.5*dt);
    }else if(U.yaw&&!t)U.yaw.rotation.y+=.25*dt;
    if(U.muzzle){const on=firing&&Math.random()<.6;U.muzzle.visible=on;U.muzzle.material.opacity=on?.9:0}
    if(U.orb){const k=1+.12*Math.sin(o.ph*4);U.orb.scale.setScalar(2.6*k);U.ring.rotation.z+=dt*2}
    if(U.core){U.r1.rotation.x+=dt*.9;U.r1.rotation.y+=dt*.5;U.r2.rotation.z+=dt*1.3;U.core.scale.setScalar(6.5*(1+.06*Math.sin(o.ph*6)));U.shield.visible=!!invul}
  },
  removeSite(idx){const o=R.sites.get(idx);if(o){R.entGroup.remove(o.g);R.sites.delete(idx)}},
  clearEntities(){
    for(const id of [...R.drones.keys()])R.removeDrone(id);
    for(const [id,o] of R.missiles)R.entGroup.remove(o.g);R.missiles.clear();
    for(const [i,o] of R.sites)R.entGroup.remove(o.g);R.sites.clear();
    for(const r of R.rings)R.entGroup.remove(r.g);R.rings=[];
    for(const p of R.pickups)R.entGroup.remove(p.g);R.pickups=[];
    R.fx.clear();
  },

  // ----- кольца и бонусы -----
  setRings(list){
    for(const r of R.rings)R.entGroup.remove(r.g);R.rings=[];
    if(!list)return;
    list.forEach((a,i)=>{
      const g=SW.Models.ring(a[6]);g.position.set(a[0],a[1],a[2]);
      g.lookAt(a[0]+a[3],a[1]+a[4],a[2]+a[5]);
      R.entGroup.add(g);R.rings.push({g,i});
    });
  },
  updateRings(cur,t){
    for(const r of R.rings){
      const done=r.i<cur,now=r.i===cur;
      r.g.visible=!done&&r.i<cur+4;
      const U=r.g.userData;
      const k=now?1:.3;
      U.tor.material.color.setHex(now?0xffe27a:0xffb82e);
      U.glow.material.opacity=(now?.5+.25*Math.sin(t*6):.18);
      U.disc.material.opacity=now?.1+.05*Math.sin(t*6):.02;
      const s=now?1+.04*Math.sin(t*6):1;
      r.g.scale.setScalar(s*k+(1-k)*.0+ (now?0:0));
      r.g.scale.setScalar(s);
    }
  },
  setPickups(world,list){
    for(const p of R.pickups)R.entGroup.remove(p.g);R.pickups=[];
    world.pickSpots.forEach((sp,i)=>{
      const kind=SW.PICK_IDS[list[i]?list[i][0]:0];
      const g=SW.Models.pickup(kind);g.position.set(sp.x,sp.y,sp.z);R.entGroup.add(g);
      R.pickups.push({g,i,on:list[i]?list[i][1]===1:true,base:sp.y,ph:i*1.7});
    });
  },
  updatePickups(t){
    for(const p of R.pickups){
      p.g.visible=p.on;
      if(!p.on)continue;
      p.g.position.y=p.base+Math.sin(t*1.6+p.ph)*1.2;p.g.rotation.y=t*1.3+p.ph;
    }
  },

  // ----- кадр -----
  tick(dt,t){
    R.time=t;R.frameNo++;
    const c=R.cam.position;
    if(R.sky){R.sky.position.copy(c);if(R.stars)R.stars.position.copy(c);
      if(R.body){R.body.position.set(c.x+R.bodyDir[0]*4300,c.y+R.bodyDir[1]*4300,c.z+R.bodyDir[2]*4300)}}
    if(R.beaconMat){R.beaconMat.uniforms.uT.value=t;R.beaconMat.uniforms.uScale.value=R.H*R.pr/(2*Math.tan(R.cam.fov*Math.PI/360))}
    if(R.water){R.water.offset.x=t*.012;R.water.offset.y=t*.007}
    // силовой барьер проявляется рядом
    if(R.zone)for(const z of R.zone){
      const d=R.world.half-(c.x*z.nx+c.z*z.nz);
      z.m.material.opacity=clamp(1-d/220,0,1)*.55;z.m.visible=z.m.material.opacity>.01;
    }
    R.fx.update(dt,R.cam);
  },
  render(){R.renderer.render(R.scene,R.cam)},
  // координаты точки на экране (в пикселях) и глубина; z<0 — позади камеры
  project(x,y,z,out){
    out=out||{x:0,y:0,z:0};
    const v=_pv.set(x,y,z).applyMatrix4(R.cam.matrixWorldInverse);
    const depth=-v.z;
    v.applyMatrix4(R.cam.projectionMatrix);
    out.x=(v.x*.5+.5)*R.W;out.y=(-v.y*.5+.5)*R.H;out.z=depth;
    return out;
  },
};
const _pv=new T.Vector3();
SW.Render=R;
})(typeof window!=='undefined'?window:globalThis);
