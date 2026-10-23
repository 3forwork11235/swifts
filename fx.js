// «Стрижи» — эффекты: частицы (огонь, искры, дым), трассеры пуль, лазерные лучи, ударные кольца, ловушки.
// Частицы — два пула THREE.Points на своём шейдере (светящиеся и дымовые); всё считается на процессоре, без текстур-атласов.
(function(root){
'use strict';
const SW=root.SW,T=root.THREE;
if(!T)return;

const VERT=`
attribute vec4 aColor;attribute float aSize;varying vec4 vColor;uniform float uScale;
void main(){
  vColor=aColor;vec4 mv=modelViewMatrix*vec4(position,1.0);
  gl_PointSize=min(aSize*uScale/max(0.5,-mv.z),220.0);
  gl_Position=projectionMatrix*mv;
}`;
const FRAG=`
varying vec4 vColor;
void main(){
  vec2 c=gl_PointCoord-0.5;float d=length(c)*2.0;
  if(d>1.0)discard;
  float a=1.0-d;a=a*a*(3.0-2.0*a);
  gl_FragColor=vec4(vColor.rgb,vColor.a*a);
}`;

class Pool{
  constructor(scene,max,additive){
    this.max=max;this.n=0;this.next=0;
    this.pos=new Float32Array(max*3);this.col=new Float32Array(max*4);this.size=new Float32Array(max);
    this.vel=new Float32Array(max*3);this.life=new Float32Array(max);this.life0=new Float32Array(max);
    this.s0=new Float32Array(max);this.s1=new Float32Array(max);this.c0=new Float32Array(max*4);this.c1=new Float32Array(max*4);
    this.drag=new Float32Array(max);this.grav=new Float32Array(max);
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.BufferAttribute(this.pos,3));
    g.setAttribute('aColor',new T.BufferAttribute(this.col,4));
    g.setAttribute('aSize',new T.BufferAttribute(this.size,1));
    this.geo=g;
    this.mat=new T.ShaderMaterial({vertexShader:VERT,fragmentShader:FRAG,uniforms:{uScale:{value:600}},transparent:true,depthWrite:false,
      blending:additive?T.AdditiveBlending:T.NormalBlending});
    this.pts=new T.Points(g,this.mat);this.pts.frustumCulled=false;this.pts.renderOrder=additive?5:4;
    scene.add(this.pts);
  }
  // c0 → c1 — цвет (rgba) от рождения до смерти; размер s0 → s1
  emit(x,y,z,vx,vy,vz,life,s0,s1,r0,g0,b0,a0,r1,g1,b1,a1,drag,grav){
    const i=this.next;this.next=(this.next+1)%this.max;
    const p=i*3,c=i*4;
    this.pos[p]=x;this.pos[p+1]=y;this.pos[p+2]=z;this.vel[p]=vx;this.vel[p+1]=vy;this.vel[p+2]=vz;
    this.life[i]=this.life0[i]=life;this.s0[i]=s0;this.s1[i]=s1;
    this.c0[c]=r0;this.c0[c+1]=g0;this.c0[c+2]=b0;this.c0[c+3]=a0;
    this.c1[c]=r1;this.c1[c+1]=g1;this.c1[c+2]=b1;this.c1[c+3]=a1;
    this.drag[i]=drag||0;this.grav[i]=grav||0;
    this.size[i]=s0;
  }
  update(dt){
    const N=this.max;
    for(let i=0;i<N;i++){
      let L=this.life[i];
      if(L<=0){this.size[i]=0;continue}
      L-=dt;this.life[i]=L;
      if(L<=0){this.size[i]=0;continue}
      const p=i*3,c=i*4,k=1-L/this.life0[i],dr=Math.max(0,1-this.drag[i]*dt);
      this.vel[p]*=dr;this.vel[p+1]=this.vel[p+1]*dr-this.grav[i]*dt;this.vel[p+2]*=dr;
      this.pos[p]+=this.vel[p]*dt;this.pos[p+1]+=this.vel[p+1]*dt;this.pos[p+2]+=this.vel[p+2]*dt;
      this.size[i]=this.s0[i]+(this.s1[i]-this.s0[i])*k;
      for(let j=0;j<4;j++)this.col[c+j]=this.c0[c+j]+(this.c1[c+j]-this.c0[c+j])*k;
    }
    this.geo.attributes.position.needsUpdate=true;this.geo.attributes.aColor.needsUpdate=true;this.geo.attributes.aSize.needsUpdate=true;
  }
  clear(){this.life.fill(0);this.size.fill(0)}
  dispose(scene){scene.remove(this.pts);this.geo.dispose();this.mat.dispose()}
}

const FX={
  q:1,tracers:[],flares:[],shocks:[],beams:[],
  init(scene,quality){
    FX.scene=scene;
    FX.setQuality(quality==null?2:quality);
    FX.glow=new Pool(scene,2200,true);
    FX.smoke=new Pool(scene,1100,false);
    // трассеры: один InstancedMesh на все пули
    const geo=new T.BoxGeometry(.11,.11,1);
    FX.tmax=480;
    FX.tmesh=new T.InstancedMesh(geo,new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.95,blending:T.AdditiveBlending,depthWrite:false}),FX.tmax);
    FX.tmesh.frustumCulled=false;FX.tmesh.count=0;FX.tmesh.renderOrder=6;
    FX.tmesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    FX.tmesh.setColorAt(0,new T.Color(1,1,1));
    scene.add(FX.tmesh);
    FX.dummy=new T.Object3D();FX.tcol=new T.Color();
    // ударные кольца — спрайты с текстурой кольца
    const c=document.createElement('canvas');c.width=c.height=128;
    const x=c.getContext('2d'),g=x.createRadialGradient(64,64,34,64,64,62);
    g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.75,'rgba(255,255,255,.9)');g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g;x.fillRect(0,0,128,128);
    FX.ringTex=new T.CanvasTexture(c);
    for(let i=0;i<14;i++){
      const s=new T.Sprite(new T.SpriteMaterial({map:FX.ringTex,color:0xffffff,transparent:true,opacity:0,blending:T.AdditiveBlending,depthWrite:false}));
      s.visible=false;scene.add(s);FX.shocks.push({s,life:0,life0:1,size0:1,size1:10});
    }
    // лазерные лучи
    for(let i=0;i<10;i++){
      const g=new T.Group();
      const core=new T.Mesh(new T.CylinderGeometry(.09,.09,1,6,1,true),new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.95,blending:T.AdditiveBlending,depthWrite:false}));
      const halo=new T.Mesh(new T.CylinderGeometry(.42,.42,1,8,1,true),new T.MeshBasicMaterial({color:0x31e6ff,transparent:true,opacity:.35,blending:T.AdditiveBlending,depthWrite:false}));
      core.rotation.x=halo.rotation.x=Math.PI/2;
      const wrap=new T.Group();wrap.add(core);wrap.add(halo);g.add(wrap);
      const tip=SW.Models.glowSprite(0xffffff,3,.9);g.add(tip);
      g.visible=false;scene.add(g);FX.beams.push({g,core,halo,tip,wrap,use:false});
    }
  },
  setQuality(q){FX.q=q===0?.4:q===1?.7:1;FX.quality=q},
  setScale(px,fov){ // пикселей на метр на единичной дистанции
    const s=px/(2*Math.tan(fov*Math.PI/360));
    FX.glow.mat.uniforms.uScale.value=s;FX.smoke.mat.uniforms.uScale.value=s;
  },
  clear(){
    FX.glow.clear();FX.smoke.clear();FX.tracers.length=0;FX.flares.length=0;
    for(const s of FX.shocks){s.life=0;s.s.visible=false}
    for(const b of FX.beams){b.use=false;b.g.visible=false}
  },

  // ---------- простые источники ----------
  glowP(x,y,z,vx,vy,vz,life,s0,s1,r,g,b,a,drag,grav){FX.glow.emit(x,y,z,vx,vy,vz,life,s0,s1,r,g,b,a,r*.6,g*.35,b*.2,0,drag||0,grav||0)},
  smokeP(x,y,z,vx,vy,vz,life,s0,s1,shade,a,drag){FX.smoke.emit(x,y,z,vx,vy,vz,life,s0,s1,shade,shade,shade*1.05,a,shade*.6,shade*.6,shade*.65,0,drag||1,-0.6)},
  trail(x,y,z,r,g,b,size,life){FX.glow.emit(x,y,z,0,0,0,life||.35,size,size*.2,r,g,b,.8,r*.3,g*.3,b*.5,0,0,0)},
  puff(x,y,z,size,shade){FX.smokeP(x,y,z,(Math.random()-.5)*2,Math.random()*1.5,(Math.random()-.5)*2,1.6+Math.random(),size*.5,size*2,shade==null?.35:shade,.4,.9)},
  rnd(a){return (Math.random()-.5)*2*a},
  sparks(x,y,z,n,speed){
    n=Math.ceil(n*FX.q);
    for(let i=0;i<n;i++){
      const a=Math.random()*6.283,e=Math.random()*2-1,s=Math.sqrt(1-e*e),v=speed*(.4+Math.random()*.8);
      FX.glow.emit(x,y,z,Math.cos(a)*s*v,e*v,Math.sin(a)*s*v,.25+Math.random()*.5,.45,.12,1,.85,.4,1,1,.35,.1,0,1.2,18);
    }
  },
  shock(x,y,z,size,r,g,b,life){
    const w=FX.shocks.find(s=>s.life<=0);if(!w)return;
    w.life=w.life0=life||.55;w.size0=size*.15;w.size1=size;w.s.position.set(x,y,z);w.s.material.color.setRGB(r,g,b);w.s.visible=true;
  },
  // взрыв: kind 0 — искры от попадания, 1 — ракета, 2 — дрон, 3 — крупный, 4 — малый хлопок
  explosion(x,y,z,size,kind){
    const q=FX.q;
    if(kind===0){FX.sparks(x,y,z,6,16);FX.glowP(x,y,z,0,0,0,.12,size*1.6,size*.5,1,.9,.6,.9,0,0);return}
    if(kind===4){
      FX.glowP(x,y,z,0,0,0,.18,size*1.5,size*.4,1,.8,.4,.9,0,0);FX.sparks(x,y,z,8,18);
      for(let i=0;i<3;i++)FX.puff(x+FX.rnd(1),y+FX.rnd(1),z+FX.rnd(1),size*.9,.45);
      return;
    }
    const big=kind>=2,k=kind===3?2:big?1:.8,S=size*k;
    FX.glowP(x,y,z,0,0,0,.14,Math.min(S*2,34),Math.min(S*.8,14),1,.92,.7,.95,0,0);
    FX.shock(x,y,z,Math.min(S*3,80),1,.7,.35,.5);
    const nf=Math.ceil(Math.min(16+S*2.5,70)*q),ps=Math.min(S*.8,10);
    for(let i=0;i<nf;i++){
      const a=Math.random()*6.283,e=Math.random()*2-1,s=Math.sqrt(1-e*e),v=(3+Math.random()*10)*Math.min(S/3,3.5);
      FX.glow.emit(x,y,z,Math.cos(a)*s*v,e*v,Math.sin(a)*s*v,.5+Math.random()*.6,ps,ps*.3,1,.5+Math.random()*.35,.18,.9,.5,.1,.05,0,2.2,-2);
    }
    FX.sparks(x,y,z,10+S*3,30+S*5);
    const ns=Math.ceil(Math.min(6+S*1.5,40)*q);
    for(let i=0;i<ns;i++)FX.smokeP(x+FX.rnd(S*.4),y+FX.rnd(S*.3),z+FX.rnd(S*.4),FX.rnd(5),Math.random()*4,FX.rnd(5),1.8+Math.random()*2.4,Math.min(S*.6,8),Math.min(S*2,20),.25+Math.random()*.15,.55,1.3);
    if(big){ // обломки: тёмные «осколки» с гравитацией
      const nd=Math.ceil((8+S*2)*q);
      for(let i=0;i<nd;i++){
        const a=Math.random()*6.283,v=8+Math.random()*26;
        FX.smoke.emit(x,y,z,Math.cos(a)*v,Math.random()*18,Math.sin(a)*v,1.2+Math.random()*1.4,.8,.5,.12,.12,.14,1,.1,.1,.12,0,.3,26);
        FX.glowP(x,y,z,Math.cos(a)*v*.7,Math.random()*14,Math.sin(a)*v*.7,.6+Math.random()*.6,1.1,.2,1,.6,.2,.9,.4,14);
      }
    }
  },
  // ловушка: яркий огонёк с дымным следом
  flare(x,y,z,vx,vy,vz){FX.flares.push({x,y,z,vx,vy,vz,life:3.6})},

  // ---------- трассеры ----------
  tracer(x,y,z,vx,vy,vz,life,len,color){
    if(FX.tracers.length>=FX.tmax)FX.tracers.shift();
    FX.tracers.push({x,y,z,vx,vy,vz,life,len,c:color==null?0x9cf3ff:color});
  },
  // луч лазера: i — номер луча (по одному на стреляющий дрон)
  beam(i,ox,oy,oz,dx,dy,dz,len,color,hit){
    const b=FX.beams[i%FX.beams.length];
    b.use=true;b.t=0;
    const g=b.g;g.visible=true;g.position.set(ox,oy,oz);
    FX.dummy.position.set(ox,oy,oz);FX.dummy.lookAt(ox+dx,oy+dy,oz+dz);g.quaternion.copy(FX.dummy.quaternion);
    b.wrap.scale.set(1,1,len);b.wrap.position.z=len/2; // Object3D.lookAt направляет +Z на точку
    b.halo.material.color.setHex(color);
    b.tip.position.set(0,0,len);b.tip.material.color.setHex(color);b.tip.scale.setScalar(hit?4.5:2.4);
    b.frame=FX.frame;
  },

  // ---------- обновление ----------
  frame:0,
  update(dt,cam){
    FX.frame++;
    FX.glow.update(dt);FX.smoke.update(dt);
    // ударные кольца
    for(const w of FX.shocks){
      if(w.life<=0)continue;
      w.life-=dt;
      if(w.life<=0){w.s.visible=false;continue}
      const k=1-w.life/w.life0,sz=w.size0+(w.size1-w.size0)*(1-(1-k)*(1-k));
      w.s.scale.set(sz,sz,1);w.s.material.opacity=(1-k)*.8;
    }
    // ловушки
    for(let i=FX.flares.length-1;i>=0;i--){
      const f=FX.flares[i];
      f.life-=dt;if(f.life<=0){FX.flares.splice(i,1);continue}
      f.vx*=1-1.2*dt;f.vz*=1-1.2*dt;f.vy-=6*dt;
      f.x+=f.vx*dt;f.y+=f.vy*dt;f.z+=f.vz*dt;
      FX.glow.emit(f.x,f.y,f.z,0,0,0,.08,3.2+Math.random(),1.5,1,.9,.6,1,1,.6,.3,0,0,0);
      if(FX.frame%2===0)FX.smokeP(f.x,f.y,f.z,FX.rnd(1),0,FX.rnd(1),1.4,.7,3,.7,.35,.8);
    }
    // трассеры
    const tm=FX.tmesh,D=FX.dummy;let n=0;
    for(let i=FX.tracers.length-1;i>=0;i--){
      const t=FX.tracers[i];
      t.life-=dt;if(t.life<=0){FX.tracers.splice(i,1);continue}
      t.x+=t.vx*dt;t.y+=t.vy*dt;t.z+=t.vz*dt;
    }
    for(let i=0;i<FX.tracers.length&&n<FX.tmax;i++){
      const t=FX.tracers[i],sp=Math.hypot(t.vx,t.vy,t.vz)||1;
      D.position.set(t.x-t.vx/sp*t.len*.5,t.y-t.vy/sp*t.len*.5,t.z-t.vz/sp*t.len*.5);
      D.lookAt(D.position.x+t.vx,D.position.y+t.vy,D.position.z+t.vz);
      D.scale.set(1,1,t.len);D.updateMatrix();
      tm.setMatrixAt(n,D.matrix);FX.tcol.setHex(t.c);tm.setColorAt(n,FX.tcol);n++;
    }
    tm.count=n;tm.instanceMatrix.needsUpdate=true;if(tm.instanceColor)tm.instanceColor.needsUpdate=true;
    // лучи, которым не обновили позицию в этом кадре, гаснут
    for(const b of FX.beams)if(b.use&&b.frame<FX.frame-1){b.use=false;b.g.visible=false}
    for(const b of FX.beams)if(b.use){const f=.8+Math.random()*.2;b.core.material.opacity=f;b.halo.material.opacity=.25+Math.random()*.2}
  },
};
SW.FX=FX;
})(typeof window!=='undefined'?window:globalThis);
