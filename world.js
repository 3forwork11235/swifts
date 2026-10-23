// «Стрижи» — мир: процедурная карта по зерну, столкновения и лучи.
// Мир целиком получается из (карта, зерно): хост и все клиенты строят одинаковые здания и не пересылают их по сети.
// Здания — прямоугольные коробки (AABB); для быстрых запросов они разложены по сетке.
// Файл общий для хоста (попадания, ИИ) и клиента (предсказание полёта, отрисовка).
(function(root){
'use strict';
const SW=root.SW;
const {clamp,rng,hashNums}=SW;

// виды коробок (для раскраски на клиенте)
const K={BUILD:0,TIER:1,BRIDGE:2,MAST:3,ROCK:4,BOX:5,SHIP:6,CRANE:7,DECK:8,MISC:9};
SW.BOX_KIND=K;

const CELL=64; // размер ячейки сетки, м

class World{
  constructor(mapId,seed){
    const M=SW.MAPS[mapId]||SW.MAPS.city;
    this.id=SW.MAPS[mapId]?mapId:'city';this.seed=seed|0;
    this.half=M.half;this.ceil=M.ceil;this.name=M.name;
    this.b=[];        // x0,y0,z0,x1,y1,z1 подряд
    this.kind=[];this.tint=[];
    this.samSpots=[];this.pickSpots=[];
    this.hit={nx:0,ny:1,nz:0,depth:0};
    const r=rng(this.seed*7919+13);
    ({city:genCity,canyon:genCanyon,port:genPort})[this.id](this,r);
    this.finalize();
    // места бонусов, которым нужны запросы к сетке, — после её построения
    for(let k=0;k<(this.needPick||0);k++)this.pickSpots.push(this.freePoint(r,30,140,60,12));
    this.hash=hashNums(this.b);
  }
  add(x0,y0,z0,x1,y1,z1,kind,tint){
    if(x1<x0){const t=x0;x0=x1;x1=t}if(z1<z0){const t=z0;z0=z1;z1=t}
    this.b.push(x0,y0,z0,x1,y1,z1);this.kind.push(kind||0);this.tint.push(tint||0);
  }
  get count(){return this.kind.length}
  finalize(){
    const n=this.count,pad=120,half=this.half;
    this.pad=pad;this.nx=Math.ceil((2*half+2*pad)/CELL);
    const cells=this.nx*this.nx,cnt=new Int32Array(cells+1),b=this.b;
    const range=i=>[this.cx(b[i*6]),this.cx(b[i*6+3]),this.cx(b[i*6+2]),this.cx(b[i*6+5])];
    for(let i=0;i<n;i++){const [a0,a1,c0,c1]=range(i);for(let z=c0;z<=c1;z++)for(let x=a0;x<=a1;x++)cnt[z*this.nx+x+1]++}
    for(let c=0;c<cells;c++)cnt[c+1]+=cnt[c];
    this.start=cnt;this.items=new Int32Array(cnt[cells]);
    const fill=cnt.slice(0,cells);
    for(let i=0;i<n;i++){const [a0,a1,c0,c1]=range(i);for(let z=c0;z<=c1;z++)for(let x=a0;x<=a1;x++)this.items[fill[z*this.nx+x]++]=i}
    this.seen=new Int32Array(n);this.stamp=0;
    this.b=new Float32Array(b);this.kind=Uint8Array.from(this.kind);this.tint=Uint8Array.from(this.tint);
  }
  cx(v){return clamp(Math.floor((v+this.half+this.pad)/CELL),0,this.nx-1)}

  // Сфера (x,y,z,r) пересекается со зданием или землёй? Заполняет this.hit (нормаль наружу и глубину); true, если есть касание.
  hitSphere(x,y,z,r,out){
    out=out||this.hit;
    let best=0,bx=0,by=1,bz=0;
    if(y-r<0){best=r-y;by=1}
    const a0=this.cx(x-r),a1=this.cx(x+r),c0=this.cx(z-r),c1=this.cx(z+r),B=this.b,st=++this.stamp;
    for(let cz=c0;cz<=c1;cz++)for(let cxx=a0;cxx<=a1;cxx++){
      const c=cz*this.nx+cxx;
      for(let k=this.start[c],e=this.start[c+1];k<e;k++){
        const i=this.items[k];
        if(this.seen[i]===st)continue;this.seen[i]=st;
        const o=i*6,x0=B[o],y0=B[o+1],z0=B[o+2],x1=B[o+3],y1=B[o+4],z1=B[o+5];
        if(x+r<x0||x-r>x1||y+r<y0||y-r>y1||z+r<z0||z-r>z1)continue;
        const qx=x<x0?x0:x>x1?x1:x,qy=y<y0?y0:y>y1?y1:y,qz=z<z0?z0:z>z1?z1:z;
        const dx=x-qx,dy=y-qy,dz=z-qz,d2=dx*dx+dy*dy+dz*dz;
        if(d2>=r*r)continue;
        let depth,nx,ny,nz;
        if(d2>1e-8){const d=Math.sqrt(d2);depth=r-d;nx=dx/d;ny=dy/d;nz=dz/d}
        else{
          // центр внутри коробки — выталкиваем по самой короткой оси
          const p=[x-x0,x1-x,y-y0,y1-y,z-z0,z1-z];let m=0;
          for(let q=1;q<6;q++)if(p[q]<p[m])m=q;
          depth=p[m]+r;nx=ny=nz=0;
          if(m===0)nx=-1;else if(m===1)nx=1;else if(m===2)ny=-1;else if(m===3)ny=1;else if(m===4)nz=-1;else nz=1;
        }
        if(depth>best){best=depth;bx=nx;by=ny;bz=nz}
      }
    }
    if(best<=0)return false;
    out.nx=bx;out.ny=by;out.nz=bz;out.depth=best;return true;
  }

  // Луч из (ox,oy,oz) по единичному направлению (dx,dy,dz); возвращает расстояние до препятствия или −1, если дальше maxT пусто.
  rayHit(ox,oy,oz,dx,dy,dz,maxT){
    let tmin=maxT+1;
    if(dy<0&&oy>0){const t=-oy/dy;if(t<=maxT)tmin=t}
    const ex=ox+dx*maxT,ez=oz+dz*maxT;
    const a0=this.cx(Math.min(ox,ex)),a1=this.cx(Math.max(ox,ex)),c0=this.cx(Math.min(oz,ez)),c1=this.cx(Math.max(oz,ez));
    const B=this.b,st=++this.stamp;
    for(let cz=c0;cz<=c1;cz++)for(let cxx=a0;cxx<=a1;cxx++){
      const c=cz*this.nx+cxx;
      for(let k=this.start[c],e=this.start[c+1];k<e;k++){
        const i=this.items[k];
        if(this.seen[i]===st)continue;this.seen[i]=st;
        const o=i*6;let t0=0,t1=tmin<maxT?tmin:maxT,ok=true;
        for(let ax=0;ax<3&&ok;ax++){
          const org=ax===0?ox:ax===1?oy:oz,d=ax===0?dx:ax===1?dy:dz,lo=B[o+ax],hi=B[o+3+ax];
          if(d>-1e-9&&d<1e-9){if(org<lo||org>hi)ok=false}
          else{
            let ta=(lo-org)/d,tb=(hi-org)/d;
            if(ta>tb){const t=ta;ta=tb;tb=t}
            if(ta>t0)t0=ta;if(tb<t1)t1=tb;
            if(t0>t1)ok=false;
          }
        }
        if(ok&&t0<tmin)tmin=t0;
      }
    }
    return tmin<=maxT?tmin:-1;
  }
  // прямая видимость между двумя точками
  los(ax,ay,az,bx,by,bz){
    const dx=bx-ax,dy=by-ay,dz=bz-az,l=Math.hypot(dx,dy,dz);
    if(l<1)return true;
    return this.rayHit(ax,ay,az,dx/l,dy/l,dz/l,l-1)<0;
  }
  // свободная точка в воздухе (для появления дронов, бонусов); r — запас вокруг
  freePoint(r,ymin,ymax,margin,rad){
    const h=this.half-margin;rad=rad||14;
    for(let k=0;k<80;k++){
      const x=r.range(-h,h),z=r.range(-h,h),y=r.range(ymin,ymax);
      if(!this.hitSphere(x,y,z,rad))return {x,y,z};
    }
    return {x:0,y:this.ceil-40,z:0};
  }
  // Маршрут из n колец: от края карты вглубь, с поворотами; проверяется, что между кольцами нет зданий.
  route(n,r){
    const rings=[];let a=r.range(0,SW.TAU),h=this.half*0.78;
    let px=Math.cos(a)*h,pz=Math.sin(a)*h,py=r.range(80,120),dir=a+Math.PI; // со стороны края — к центру
    const start={x:px,y:py,z:pz,yaw:0};
    for(let k=0;k<n;k++){
      // берём несколько кандидатов и выбираем самый «уличный»: невысокий и без резких поворотов
      let best=null,bs=1e9,tx=0,ty=0,tz=0;
      for(let at=0;at<48;at++){
        const hd=dir+r.range(-1.2,1.2),dist=r.range(150,260);
        tx=px+Math.cos(hd)*dist;tz=pz+Math.sin(hd)*dist;
        ty=clamp(py+r.range(-60,60),36,this.ceil-60);
        if(Math.abs(tx)>this.half*0.86||Math.abs(tz)>this.half*0.86)continue;
        if(this.hitSphere(tx,ty,tz,24))continue;
        // путь свободен? центральный и боковые лучи (±9 м)
        const dx=tx-px,dy=ty-py,dz=tz-pz,l=Math.hypot(dx,dy,dz),ux=dx/l,uy=dy/l,uz=dz/l;
        let clear=true;
        for(const off of [[0,0],[0,9],[0,-9],[9,0],[-9,0]]){
          if(this.rayHit(px+off[0]*(-uz),py+off[1],pz+off[0]*ux,ux,uy,uz,l)>=0){clear=false;break}
        }
        if(!clear)continue;
        // не уходим к краю карты: чем дальше от центра, тем хуже кандидат
        const s=Math.abs(ty-95)+Math.abs(hd-dir)*30+Math.max(0,Math.hypot(tx,tz)-this.half*0.45)*0.35+r.range(0,25);
        if(s<bs){bs=s;best={x:tx,y:ty,z:tz,hd}}
      }
      if(best){tx=best.x;ty=best.y;tz=best.z;dir=best.hd}
      else{ // запасной путь: над крышами
        tx=px+Math.cos(dir)*180;tz=pz+Math.sin(dir)*180;ty=this.ceil-60;
        if(Math.abs(tx)>this.half*0.86||Math.abs(tz)>this.half*0.86){tx=px*0.6;tz=pz*0.6}
        dir=Math.atan2(tz-pz,tx-px);
      }
      const dx=tx-px,dy=ty-py,dz=tz-pz,l=Math.hypot(dx,dy,dz)||1;
      rings.push({x:tx,y:ty,z:tz,nx:dx/l,ny:dy/l,nz:dz/l,r:k===n-1?22:15});
      px=tx;py=ty;pz=tz;
    }
    // старт — перед первым кольцом, нос на него
    start.yaw=SW.angles(rings[0].x-start.x,0,rings[0].z-start.z).yaw;
    rings.start=start;
    return rings;
  }
  // выбрать n мест для зениток: разнесённых друг от друга не ближе minSep
  pickSites(n,r,minSep,from){
    const pool=r.shuffle((from||this.samSpots).slice()),out=[];
    for(const s of pool){
      if(out.length>=n)break;
      if(out.every(o=>Math.hypot(o.x-s.x,o.z-s.z)>=minSep))out.push(s);
    }
    for(const s of pool){if(out.length>=n)break;if(!out.includes(s))out.push(s)}
    return out;
  }
}

// ---------- Аэрополис ----------
function genCity(W,r){
  const half=W.half,nb=9,P=2*half/nb,road=60,bs=P-road;
  const lots=[];
  for(let i=0;i<nb;i++)for(let j=0;j<nb;j++){
    const bx0=-half+i*P+road/2,bz0=-half+j*P+road/2,cx=bx0+bs/2,cz=bz0+bs/2;
    const c=1-clamp(Math.hypot(cx,cz)/(half*0.92),0,1);
    const centre=i===(nb>>1)&&j===(nb>>1);
    const rects=[];
    const pat=centre?0:r();
    if(pat<0.25)rects.push([bx0,bz0,bx0+bs,bz0+bs]);
    else if(pat<0.55){
      const g=8,s=r.range(0.4,0.6);
      if(r()<0.5){const m=bx0+bs*s;rects.push([bx0,bz0,m-g/2,bz0+bs],[m+g/2,bz0,bx0+bs,bz0+bs])}
      else{const m=bz0+bs*s;rects.push([bx0,bz0,bx0+bs,m-g/2],[bx0,m+g/2,bx0+bs,bz0+bs])}
    }else{
      const g=8,mx=bx0+bs/2,mz=bz0+bs/2;
      rects.push([bx0,bz0,mx-g/2,mz-g/2],[mx+g/2,bz0,bx0+bs,mz-g/2],[bx0,mz+g/2,mx-g/2,bz0+bs],[mx+g/2,mz+g/2,bx0+bs,bz0+bs]);
    }
    for(const rc of rects){
      const m=r.range(0,5);
      let x0=rc[0]+m,z0=rc[1]+m,x1=rc[2]-m,z1=rc[3]-m;
      if(centre){x0=cx-22;x1=cx+22;z0=cz-22;z1=cz+22}
      const empty=!centre&&r()<0.08+0.22*(1-c);
      const tint=r.int(0,6);
      if(empty){W.samSpots.push({x:(x0+x1)/2,y:0,z:(z0+z1)/2,ground:1});continue}
      let h=centre?310:18+Math.pow(c,1.25)*r.range(40,225)+r.range(0,28);
      const w=x1-x0,d=z1-z0,mx=(x0+x1)/2,mz=(z0+z1)/2;
      if(centre){ // шпиль в центре: ступени сужаются кверху
        W.cityTop=h*.94; // сюда ставится Сердце СТРАЖа
        const tiers=[[1,.34],[.74,.58],[.5,.8],[.3,.94]];
        let yb=0;for(const [f,hf] of tiers){const hh=h*hf;W.add(mx-w/2*f,yb,mz-d/2*f,mx+w/2*f,hh,mz+d/2*f,yb?K.TIER:K.BUILD,tint);yb=hh}
        W.add(mx-1.2,h*.94,mz-1.2,mx+1.2,h+34,mz+1.2,K.MAST,tint);
      }else if(h>110){
        W.add(x0,0,z0,x1,h*.55,z1,K.BUILD,tint);
        const f=.8,sx=w*(1-f)/2,sz=d*(1-f)/2;
        W.add(x0+sx,h*.55,z0+sz,x1-sx,h*.82,z1-sz,K.TIER,tint);
        const f2=.55,tx=w*(1-f2)/2,tz=d*(1-f2)/2;
        W.add(x0+tx,h*.82,z0+tz,x1-tx,h,z1-tz,K.TIER,tint);
        if(r()<0.55)W.add(mx-1,h,mz-1,mx+1,h+r.range(14,34),mz+1,K.MAST,tint);
      }else if(h>55){
        W.add(x0,0,z0,x1,h*.7,z1,K.BUILD,tint);
        const sx=w*.125,sz=d*.125;
        W.add(x0+sx,h*.7,z0+sz,x1-sx,h,z1-sz,K.TIER,tint);
        if(r()<0.3)W.add(mx-.8,h,mz-.8,mx+.8,h+r.range(8,18),mz+.8,K.MAST,tint);
      }else{
        W.add(x0,0,z0,x1,h,z1,K.BUILD,tint);
      }
      lots.push({x0,z0,x1,z1,h,i,j});
      if(!centre&&h>=18&&h<=135&&r()<0.5)W.samSpots.push({x:mx,y:h,z:mz,roof:1});
    }
  }
  // мосты между соседними высотками через улицу
  for(const A of lots){
    if(A.h<80)continue;
    for(const B of lots){
      if(B===A||B.h<80)continue;
      if(B.i===A.i+1&&B.j===A.j){
        const z0=Math.max(A.z0,B.z0),z1=Math.min(A.z1,B.z1);
        if(z1-z0>=18&&r()<0.28){const zc=(z0+z1)/2,y0=r.range(34,Math.min(A.h,B.h)-14);W.add(A.x1-2,y0,zc-4,B.x0+2,y0+7,zc+4,K.BRIDGE,A.i&3)}
      }else if(B.j===A.j+1&&B.i===A.i){
        const x0=Math.max(A.x0,B.x0),x1=Math.min(A.x1,B.x1);
        if(x1-x0>=18&&r()<0.28){const xc=(x0+x1)/2,y0=r.range(34,Math.min(A.h,B.h)-14);W.add(xc-4,y0,A.z1-2,xc+4,y0+7,B.z0+2,K.BRIDGE,A.j&3)}
      }
    }
  }
  // бонусы — на перекрёстках улиц, на разной высоте
  const ys=[34,58,86,120];
  for(let k=0;k<16;k++){
    const i=r.int(1,nb),j=r.int(1,nb),x=-half+i*P,z=-half+j*P,y=r.pick(ys);
    W.pickSpots.push({x,y,z});
  }
}

// ---------- Каньон Красной Скалы ----------
function genCanyon(W,r){
  const half=W.half,cell=170,n=Math.floor(2*half/cell),o=-half+(2*half-n*cell)/2;
  const corridorX=r.range(-200,200),corridorZ=r.range(-200,200);
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    const cx=o+(i+.5)*cell+r.range(-30,30),cz=o+(j+.5)*cell+r.range(-30,30);
    if(Math.abs(cz-corridorZ)<75||Math.abs(cx-corridorX)<75)continue; // два широких коридора
    if(r()<0.22)continue;
    const w=r.range(70,140),d=r.range(70,140),h=r.range(70,210),tint=r.int(0,5);
    W.add(cx-w/2,0,cz-d/2,cx+w/2,h*.6,cz+d/2,K.ROCK,tint);
    W.add(cx-w*.36,h*.6,cz-d*.36,cx+w*.36,h*.86,cz+d*.36,K.ROCK,tint);
    W.add(cx-w*.2,h*.86,cz-d*.2,cx+w*.2,h,cz+d*.2,K.ROCK,tint);
    W.samSpots.push({x:cx,y:h,z:cz,roof:1});
    if(r()<.4){ // отдельный каменный столб рядом
      const px=cx+r.range(-100,100),pz=cz+r.range(-100,100),ph=r.range(90,240);
      if(Math.abs(pz-corridorZ)>50&&Math.abs(px-corridorX)>50)W.add(px-7,0,pz-7,px+7,ph,pz+7,K.ROCK,tint);
    }
  }
  // арки
  for(let k=0;k<5;k++){
    const x=r.range(-half*.7,half*.7),z=r.range(-half*.7,half*.7),h=r.range(100,140),gap=r.range(60,90);
    if(r()<.5){W.add(x-gap/2-24,0,z-12,x-gap/2,h,z+12,K.ROCK,2);W.add(x+gap/2,0,z-12,x+gap/2+24,h,z+12,K.ROCK,2);W.add(x-gap/2-24,h-20,z-14,x+gap/2+24,h,z+14,K.ROCK,2)}
    else{W.add(x-12,0,z-gap/2-24,x+12,h,z-gap/2,K.ROCK,2);W.add(x-12,0,z+gap/2,x+12,h,z+gap/2+24,K.ROCK,2);W.add(x-14,h-20,z-gap/2-24,x+14,h,z+gap/2+24,K.ROCK,2)}
  }
  // скалы по краям — стена каньона
  const e=half+30;
  for(let s=-half;s<half;s+=110){
    const h=r.range(150,300),w=r.range(90,130);
    W.add(s,0,-e-60,s+w,h,-e+40,K.ROCK,1);W.add(s,0,e-40,s+w,h,e+60,K.ROCK,1);
    W.add(-e-60,0,s,-e+40,h,s+w,K.ROCK,1);W.add(e-40,0,s,e+60,h,s+w,K.ROCK,1);
  }
  W.needPick=14;
}

// ---------- Порт «Маяк» ----------
function genPort(W,r){
  const half=W.half;
  // причал и платформы
  W.add(-half+30,0,-260,-half+330,5,260,K.DECK,0);
  W.add(120,0,-half+60,470,5,-half+260,K.DECK,0);
  W.add(-60,0,60,60,5,160,K.DECK,0); // остров
  // контейнеры: ряды стопок
  for(let cx=-half+50;cx<-half+300;cx+=30)for(let cz=-240;cz<240;cz+=16){
    if(r()<.12)continue;
    const st=r.int(1,6),tint=r.int(0,5);
    W.add(cx-12,5,cz-3,cx+12,5+2.6*st,cz+3,K.BOX,tint);
  }
  // краны
  for(let k=0;k<4;k++){
    const z=-200+k*125,x=-half+330;
    W.add(x-3,5,z-14,x+3,60,z-8,K.CRANE,0);W.add(x-3,5,z+8,x+3,60,z+14,K.CRANE,0);
    W.add(x-70,56,z-16,x+30,64,z+16,K.CRANE,0);
    W.add(x+20,20,z-10,x+32,60,z+10,K.CRANE,0);
    W.samSpots.push({x:x-60,y:64,z,roof:1});
  }
  // суда
  for(let k=0;k<3;k++){
    const x=r.range(-200,300),z=r.range(-half+300,half-120),len=r.range(120,170);
    if(Math.abs(x)<130&&Math.abs(z)<200)continue;
    W.add(x-len/2,0,z-9,x+len/2,13,z+9,K.SHIP,k);
    W.add(x+len/2-34,13,z-8,x+len/2-6,34,z+8,K.SHIP,k);
    W.add(x+len/2-24,34,z-3,x+len/2-16,46,z+3,K.SHIP,k);
    W.samSpots.push({x:x-len*.2,y:13,z,roof:1});
  }
  // нефтяная платформа
  const px=-120,pz=-420;
  for(const [dx,dz] of [[-24,-24],[24,-24],[-24,24],[24,24]])W.add(px+dx-3,0,pz+dz-3,px+dx+3,42,pz+dz+3,K.DECK,0);
  W.add(px-34,42,pz-34,px+34,50,pz+34,K.DECK,0);W.add(px-5,50,pz-5,px+5,105,pz+5,K.MAST,0);
  W.samSpots.push({x:px+20,y:50,z:pz-20,roof:1});
  // маяк
  const lx=half-120,lz=half-120;
  W.add(lx-24,0,lz-24,lx+24,6,lz+24,K.DECK,0);W.add(lx-5,6,lz-5,lx+5,80,lz+5,K.BUILD,0);W.add(lx-9,80,lz-9,lx+9,92,lz+9,K.TIER,0);
  W.samSpots.push({x:lx+14,y:6,z:lz-14,roof:1});
  // волнорезы
  W.add(-half+20,0,half-200,half-300,6,half-186,K.DECK,0);
  W.add(half-200,0,-half+300,half-186,6,half-300,K.DECK,0);
  for(let k=0;k<12;k++)W.samSpots.push({x:r.range(-half*.7,half*.7),y:0,z:r.range(-half*.7,half*.7),ground:1});
  W.needPick=14;
}

const cache=new Map();
SW.makeWorld=function(mapId,seed){
  const key=mapId+':'+(seed|0);
  let w=cache.get(key);
  if(!w){if(cache.size>4)cache.delete(cache.keys().next().value);w=new World(mapId,seed);cache.set(key,w)}
  return w;
};
SW.World=World;
})(typeof window!=='undefined'?window:globalThis);
