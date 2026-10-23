// «Стрижи» — правила режимов. Директор режима подключён к арене и отвечает за:
// где и когда появляются дроны, что считается победой, какие очки и цели видят игроки.
//   ffa  — «Схватка»: каждый сам за себя, до N побед или по времени
//   team — «Команды»: две эскадрильи (синие 0 и красные 1)
//   run  — «Рейс»: сюжетные вылеты (missions.js): кольца, зенитки, волны дронов, боссы
//
// Интерфейс директора: init() update(dt) onKill(жертва,убийца,чем) onSiteKill(цель,убийца) spawn(дрон) canRespawn(дрон)
//   respawnDelay(дрон) state() — компактное состояние для снимка, info() — для начала раунда, summary() — итоги.
(function(root){
'use strict';
const SW=root.SW;
const {clamp}=SW;

// ---------- общее: точки появления в небе ----------
function skySpot(A,d,opts){
  const W=A.world,rnd=A.rand;
  let best=null,bs=-1;
  const n=opts.tries||14;
  for(let k=0;k<n;k++){
    let x,z;
    if(opts.zone){ // команда появляется со своей стороны карты
      x=rnd.range(-W.half*.5,W.half*.5);z=opts.zone*W.half*.62+rnd.range(-70,70);
    }else{x=rnd.range(-W.half*.8,W.half*.8);z=rnd.range(-W.half*.8,W.half*.8)}
    const y=rnd.range(opts.y0||110,opts.y1||220);
    if(W.hitSphere(x,y,z,20))continue;
    // чем дальше от врагов — тем лучше
    let md=1000;
    for(const e of A.drones)if(e.alive&&e!==d&&A.enemy(d,e))md=Math.min(md,Math.hypot(e.x-x,e.y-y,e.z-z));
    if(md>bs){bs=md;best={x,y,z}}
  }
  if(!best)best={x:rnd.range(-200,200),y:W.ceil-60,z:rnd.range(-200,200)};
  best.yaw=SW.angles(-best.x,0,-best.z).yaw+rnd.range(-.6,.6);
  return best;
}
// счёт для таблицы: [id, убил, погиб, очки, команда]
function board(A){
  const sb=[];
  for(const d of A.drones)if(d.kind!=='foe')sb.push([d.id,d.st.k,d.st.d,Math.round(d.st.score),d.team]);
  return sb;
}

// ---------- Схватка ----------
class Ffa{
  constructor(A,cfg){
    this.A=A;
    const o=A.opts;
    this.lim=SW.toInt(o.frags)||15;
    this.time=SW.toInt(o.time)||420;
    this.left=this.time;
  }
  init(){this.left=this.time}
  update(dt){
    const A=this.A;
    if(A.phase!=='play')return;
    this.left-=dt;
    if(this.left<=0)this.end();
  }
  onKill(v,k,how){
    if(this.A.phase!=='play')return;
    if(k&&k!==v){k.st.score+=100;if(k.st.k>=this.lim)this.end()}
  }
  onSiteKill(){}
  end(){
    const A=this.A;if(A.phase!=='play')return;
    const sb=board(A).sort((a,b)=>b[1]-a[1]||a[2]-b[2]);
    A.finish(this.summary(sb));
  }
  summary(sb){
    sb=sb||board(this.A).sort((a,b)=>b[1]-a[1]||a[2]-b[2]);
    // победитель — тот, кто сбил больше всех; при равенстве (в том числе 0:0) победителя нет
    const tie=!sb.length||sb[0][1]<=0||(sb[1]&&sb[1][1]===sb[0][1]&&sb[1][2]===sb[0][2]);
    return {mode:'ffa',winner:tie?-1:sb[0][0],sb,time:Math.round(this.time-this.left)};
  }
  spawn(d){return skySpot(this.A,d,{})}
  canRespawn(){return true}
  respawnDelay(){return 3}
  state(){return {tl:Math.max(0,Math.round(this.left)),lim:this.lim,sb:board(this.A)}}
  info(){return {tl:this.time,lim:this.lim}}
}

// ---------- Команды ----------
class Team extends Ffa{
  constructor(A,cfg){super(A,cfg);this.lim=SW.toInt(A.opts.frags)||30;this.ts=[0,0]}
  init(){super.init();this.ts=[0,0]}
  onKill(v,k,how){
    const A=this.A;
    if(A.phase!=='play')return;
    if(k&&k!==v&&k.team!==v.team){k.st.score+=100;this.ts[k.team]=(this.ts[k.team]||0)+1;if(this.ts[k.team]>=this.lim)this.end()}
  }
  end(){
    const A=this.A;if(A.phase!=='play')return;
    A.finish(this.summary());
  }
  summary(){
    const sb=board(this.A).sort((a,b)=>b[1]-a[1]||a[2]-b[2]);
    const w=this.ts[0]===this.ts[1]?-1:this.ts[0]>this.ts[1]?0:1;
    return {mode:'team',winTeam:w,ts:this.ts.slice(),sb,time:Math.round(this.time-this.left)};
  }
  spawn(d){return skySpot(this.A,d,{zone:d.team===0?1:-1})}
  state(){return {tl:Math.max(0,Math.round(this.left)),lim:this.lim,ts:this.ts.slice(),sb:board(this.A)}}
}

// ---------- Рейс (миссии) ----------
class Run{
  constructor(A,cfg){
    this.A=A;
    this.M=SW.MISSIONS[clamp(SW.toInt(A.opts.mission),0,SW.MISSIONS.length-1)];
    this.diff=A.opts.diff||this.M.diff||'normal'; // выбор создателя важнее задумки миссии
    A.opts.diff=this.diff;
    this.clock=0;this.lives=3;this.livesMax=3;this.lost=0;
    this.rings=null;this.ri=0;this.prev=new Map();
    this.objSites=[];this.pylons=[];this.core=null;this.boss=null;
    this.lineIdx=0;this.lines=[];this.fired=new Set();
    this.waveIdx=-1;this.waveT=3;this.waveTotal=0;this.foeCount=0;this.waitWave=false;
    this.endAt=0;this.won=null;this.bossPct=100;this.spawnT=8;this.score=0;this.siteKills=0;
    this.start=null;
  }
  get obj(){return this.M.obj}
  init(){
    const A=this.A,M=this.M,W=A.world,r=SW.rng(M.seed*13+7);
    const humans=A.drones.filter(d=>d.kind==='human').length||1;
    this.livesMax=this.lives=Math.min(9,3*humans);
    const hpMul=this.diff==='easy'?.8:this.diff==='hard'?1.2:this.diff==='ace'?1.4:1;
    // колонны зениток по карте
    const taken=[];
    for(const [type,n] of (M.sites||[])){
      const spots=W.pickSites(n,r,170,W.samSpots.filter(s=>!taken.includes(s)));
      for(const sp of spots){
        taken.push(sp);
        const s=A.addSite(type,sp.x,sp.y,sp.z,{hpMul,reload:1});
        if(M.obj.type==='destroy')this.objSites.push(s);
      }
    }
    this.lines=(M.lines||[]).filter(l=>l.at!=null).sort((a,b)=>a.at-b.at);
    const t=M.obj.type;
    if(t==='rings'){
      this.rings=W.route(M.obj.n,SW.rng(M.seed*17+3));this.ri=0;
      this.start=this.rings.start;
    }
    if(t==='waves'||t==='endless'){this.waveTotal=t==='waves'?M.waves.length:0}
    if(t==='boss'){
      const hp=(.7+.3*humans);
      const d=A.addDrone({kind:'foe',team:1,hull:'e_mother',name:'Матка',diff:this.diff});
      d.maxhp=d.hp=Math.round(d.H.hp*hp*(this.diff==='easy'?.7:1));
      A.respawn(d,{x:0,y:200,z:-W.half*.15,yaw:0,inv:0});
      d.maxhp=d.hp=Math.round(d.H.hp*hp*(this.diff==='easy'?.7:1));
      this.boss=d;
    }
    if(t==='core'){
      // ядро — на вершине центральной башни, четыре пилона — на крышах вокруг
      const hCore=W.cityTop||310;
      this.core=A.addSite('core',0,hCore,0,{hpMul,reload:1});
      this.core.invul=true;
      const want=[[1,1],[-1,1],[1,-1],[-1,-1]];
      for(const [sx,sz] of want){
        let best=null,bd=1e9;
        for(const sp of W.samSpots){
          if(!sp.roof||taken.includes(sp))continue;
          const dd=Math.hypot(sp.x-sx*260,sp.z-sz*260);
          if(dd<bd){bd=dd;best=sp}
        }
        if(best){taken.push(best);this.pylons.push(A.addSite('pylon',best.x,best.y,best.z,{hpMul}))}
      }
      this.spawnT=22;
    }
    this.objTotal=t==='rings'?M.obj.n:t==='destroy'?this.objSites.length:t==='core'?this.pylons.length+1:t==='boss'?1:0;
  }

  // ---------- появление ----------
  spawn(d){
    const A=this.A,W=A.world,rnd=A.rand;
    if(d.kind==='human'||d.kind==='wing'){
      // рядом с живым напарником-человеком, иначе — на старте миссии
      const mates=A.drones.filter(e=>e.alive&&e.kind==='human'&&e!==d);
      if(mates.length&&A.phase==='play'){
        const m=rnd.pick(mates);
        for(let k=0;k<12;k++){
          const x=m.x+rnd.range(-50,50),y=m.y+rnd.range(-15,25),z=m.z+rnd.range(-50,50);
          if(!W.hitSphere(x,y,z,12))return {x,y,z,yaw:m.yaw};
        }
      }
      if(this.start){
        const s=this.start,off=(d.slot?SW.toInt(String(d.slot).slice(1)):d.id)%8,sd=off%2?1:-1;
        const rx=Math.cos(s.yaw),rz=-Math.sin(s.yaw);
        return {x:s.x+rx*sd*Math.ceil(off/2)*26,y:s.y+Math.floor(off/2)*6,z:s.z+rz*sd*Math.ceil(off/2)*26,yaw:s.yaw};
      }
      const bx=Math.cos(d.id)*30*((d.id%4)+1),bz=W.half*.55+Math.sin(d.id)*30;
      for(let k=0;k<20;k++){
        const x=bx+rnd.range(-70,70)*(k>8?3:1),y=rnd.range(140,200),z=bz+rnd.range(-70,70)*(k>8?3:1);
        if(!W.hitSphere(x,y,z,16))return {x,y,z,yaw:0};
      }
      return {x:0,y:W.ceil-80,z:0,yaw:0};
    }
    return skySpot(A,d,{});
  }
  canRespawn(d){return d.kind==='foe'?false:d.kind==='human'?d.canRe!==false:true}
  respawnDelay(d){return d.kind==='human'?4:12}

  // ---------- события ----------
  trigger(key){
    const A=this.A,M=this.M;
    if(this.fired.has(key))return;this.fired.add(key);
    for(const l of (M.lines||[]))if(l.on===key)A.ev('say',l.who,l.text);
  }
  onKill(v,k,how){
    const A=this.A;
    if(v.kind==='human'){
      v.canRe=this.lives>0;
      if(v.canRe)this.lives--;
      this.lost++;
    }
    if(v.kind==='foe'){
      if(k&&k.kind!=='foe'){
        const sc=v.H.score||50;
        k.st.score+=sc;this.score+=sc;
      }
      if(v===this.boss){this.bossPct=0;this.trigger('boss:0')}
    }
  }
  onSiteKill(s,k,how){
    const A=this.A;
    const sc=SW.SITES[s.type].score;
    if(k){k.st.score+=sc}this.score+=sc;
    if(s.type==='pylon'){
      const n=this.pylons.filter(p=>!p.alive).length;
      this.trigger('pylon:'+n);
      A.ev('obj',this.objText(),this.objCur(),this.objTotal);
      if(n===this.pylons.length&&this.core){this.core.invul=false;A.ev('say','vera','Щит ядра снят! Бей по Сердцу!')}
    }else if(s.type==='core'){
      this.bossPct=0;
    }else{
      this.siteKills++;this.trigger('site:'+this.siteKills);
      A.ev('obj',this.objText(),this.objCur(),this.objTotal);
    }
  }
  objCur(){
    const t=this.obj.type;
    if(t==='rings')return this.ri;
    if(t==='destroy')return this.objSites.filter(s=>!s.alive).length;
    if(t==='core')return this.pylons.filter(s=>!s.alive).length+(this.core&&!this.core.alive?1:0);
    if(t==='boss')return this.boss&&!this.boss.alive?1:0;
    return this.waveIdx+1;
  }
  objText(){return this.obj.text}

  // ---------- волны и враги ----------
  spawnFoes(list,near){
    const A=this.A,W=A.world,rnd=A.rand;
    const hs=A.drones.filter(d=>d.alive&&d.kind==='human');
    for(const [type,n] of list){
      for(let i=0;i<n;i++){
        const tgt=hs.length?rnd.pick(hs):{x:0,y:150,z:0,yaw:0};
        let spot=null;
        for(let k=0;k<24&&!spot;k++){
          const a=rnd.range(0,SW.TAU),dist=rnd.range(near?260:480,near?420:760);
          const x=tgt.x+Math.cos(a)*dist,z=tgt.z+Math.sin(a)*dist,y=clamp(tgt.y+rnd.range(-60,80),70,W.ceil-70);
          if(Math.abs(x)>W.half*.9||Math.abs(z)>W.half*.9)continue;
          if(!W.hitSphere(x,y,z,18))spot={x,y,z};
        }
        if(!spot)spot={x:rnd.range(-300,300),y:W.ceil-90,z:rnd.range(-300,300)};
        const f=A.addDrone({kind:'foe',team:1,hull:type,name:SW.FOES[type].name,diff:this.diff});
        A.respawn(f,{x:spot.x,y:spot.y,z:spot.z,yaw:SW.angles(tgt.x-spot.x,0,tgt.z-spot.z).yaw,inv:1.2});
        this.foeCount++;
      }
    }
  }
  foesAlive(){return this.A.drones.filter(d=>d.kind==='foe'&&d.alive&&d!==this.boss).length}

  // ---------- шаг ----------
  update(dt){
    const A=this.A,M=this.M;
    if(A.phase==='count')return;
    // конец вылета: ждём пару секунд, чтобы увидеть взрыв
    if(this.won!==null){
      this.endAt-=dt;
      if(this.endAt<=0&&A.phase==='play')A.finish(this.summary());
      return;
    }
    if(A.phase!=='play')return;
    this.clock+=dt;
    // реплики по времени
    while(this.lineIdx<this.lines.length&&this.lines[this.lineIdx].at<=this.clock){const l=this.lines[this.lineIdx++];A.ev('say',l.who,l.text)}
    if(this.clock<.3&&!this.fired.has('start')){this.fired.add('start');A.ev('obj',this.objText(),this.objCur(),this.objTotal)}
    const t=this.obj.type;
    // ведомые: по желанию создателя
    this.wingmen(dt);
    // кольца
    if(t==='rings')this.updateRings();
    // волны
    if(t==='waves'||t==='endless')this.updateWaves(dt);
    else if(M.waves&&M.waves.length)this.updateTimedWaves();
    if(t==='boss')this.updateBoss(dt);
    if(t==='core')this.updateCore(dt);
    // победа / поражение
    if(t==='rings'&&this.ri>=this.rings.length)this.win();
    else if(t==='destroy'&&this.objSites.every(s=>!s.alive))this.win();
    else if(t==='boss'&&this.boss&&!this.boss.alive)this.win();
    else if(t==='core'&&this.core&&!this.core.alive)this.win();
    if(M.time&&this.clock>=M.time&&this.won===null)this.lose('time');
    // экипаж потерян
    const humans=A.drones.filter(d=>d.kind==='human');
    if(humans.length&&this.won===null&&humans.every(d=>!d.alive&&d.canRe===false))this.lose('crew');
  }
  win(){if(this.won===null){this.won=true;this.endAt=3}}
  lose(why){this.won=false;this.why=why;this.endAt=2.5}

  updateRings(){
    const A=this.A;
    const r=this.rings[this.ri];if(!r)return;
    for(const d of A.drones){
      if(!d.alive||d.kind==='foe')continue;
      const pv=this.prev.get(d.id);
      if(pv&&pv.ep===d.ep){
        const s0=(pv.x-r.x)*r.nx+(pv.y-r.y)*r.ny+(pv.z-r.z)*r.nz,s1=(d.x-r.x)*r.nx+(d.y-r.y)*r.ny+(d.z-r.z)*r.nz;
        if(s0*s1<=0&&s0!==s1){
          const k=s0/(s0-s1),px=pv.x+(d.x-pv.x)*k,py=pv.y+(d.y-pv.y)*k,pz=pv.z+(d.z-pv.z)*k;
          if(Math.hypot(px-r.x,py-r.y,pz-r.z)<=r.r+2.5&&d.kind==='human'){
            this.ri++;d.st.rings++;d.st.score+=100;this.score+=100;
            A.ev('ring',d.id,this.ri-1,this.ri);
            this.trigger('ring:'+this.ri);
            A.ev('obj',this.objText(),this.ri,this.rings.length);
            break;
          }
        }
      }
    }
    for(const d of A.drones)if(d.alive&&d.kind!=='foe'){
      let pv=this.prev.get(d.id);if(!pv){pv={};this.prev.set(d.id,pv)}
      pv.x=d.x;pv.y=d.y;pv.z=d.z;pv.ep=d.ep;
    }
  }
  updateWaves(dt){
    const A=this.A,M=this.M;
    const alive=this.foesAlive();
    if(this.waveIdx>=0&&!this.waitWave&&alive===0){this.waitWave=true;this.waveT=this.obj.type==='endless'?6:5}
    if(this.waitWave||this.waveIdx<0){
      this.waveT-=dt;
      if(this.waveT<=0){
        const next=this.waveIdx+1;
        if(this.obj.type==='waves'&&next>=M.waves.length){if(this.won===null)this.win();return}
        this.waveIdx=next;this.waitWave=false;
        let list,say=null;
        if(this.obj.type==='waves'){const w=M.waves[next];list=w.foes;say=w.say}
        else{ // бесконечный режим: волны растут
          const n=next+1;
          list=[['e_wasp',Math.min(8,2+n)]];
          if(n>=2)list.push(['e_hornet',Math.min(5,Math.floor(n/2))]);
          if(n%3===0)list.push(['e_kami',Math.min(5,1+Math.floor(n/3))]);
          if(n%5===0)list.push(['e_bulk',Math.min(3,Math.floor(n/5))]);
          say=n===1?{who:'vera',text:'Первая волна!'}:null;
        }
        this.spawnFoes(list,false);
        A.ev('wave',next+1,this.waveTotal,say?say.text:'');
        if(say)A.ev('say',say.who,say.text);
        this.trigger('wave:'+(next+1));
        A.ev('obj',this.objText(),next+1,this.waveTotal);
      }
    }
  }
  // волны, привязанные ко времени (в миссиях с кольцами)
  updateTimedWaves(){
    const A=this.A,M=this.M;
    while(this.waveIdx+1<M.waves.length&&M.waves[this.waveIdx+1].at<=this.clock){
      const w=M.waves[++this.waveIdx];
      this.spawnFoes(w.foes,true);
      A.ev('wave',this.waveIdx+1,M.waves.length,'');
    }
  }
  updateBoss(dt){
    const A=this.A,b=this.boss;
    if(!b||!b.alive)return;
    this.bossPct=Math.round(b.hp/b.maxhp*100);
    for(const p of [70,35,15])if(this.bossPct<=p)this.trigger('boss:'+p);
    this.spawnT-=dt;
    if(this.spawnT<=0){
      const left=this.foesAlive();
      const rate=this.bossPct<35?8:this.bossPct<70?10:14;
      this.spawnT=rate;
      if(left<5){
        const list=[['e_wasp',2]];
        if(this.bossPct<70)list.push(['e_kami',1]);
        if(this.bossPct<35)list.push(['e_hornet',1]);
        this.spawnFoes(list,true);
      }
    }
  }
  updateCore(dt){
    const A=this.A;
    const c=this.core;
    if(c&&c.alive)this.bossPct=Math.round(c.hp/c.maxhp*100);
    for(const p of [50,20])if(c&&this.bossPct<=p&&!c.invul)this.trigger('boss:'+p);
    this.spawnT-=dt;
    if(this.spawnT<=0){
      this.spawnT=c&&!c.invul?14:24;
      if(this.foesAlive()<5){
        const list=[['e_wasp',2],['e_hornet',1]];
        if(c&&!c.invul)list.push(['e_kami',2]);
        this.spawnFoes(list,false);
      }
    }
  }
  // ведомые боты (создатель выбирает 0..3): держатся рядом и стреляют по врагам
  wingmen(dt){
    const A=this.A,want=SW.toInt(A.opts.wing);
    if(!want||this.wingMade)return;
    this.wingMade=true;
    for(let i=0;i<want;i++){
      const id=SW.MAX_SLOTS-i;
      if(A.byId.has(id))continue;
      const w=A.addDrone({id,slot:null,kind:'wing',team:0,hull:i%2?'wasp':'swift',name:SW.CALLSIGNS[(id*5+3)%SW.CALLSIGNS.length],diff:A.opts.botDiff||'normal',skin:{paint:(id+4)%12}});
      A.respawn(w);
    }
  }

  // ---------- для сети ----------
  state(){
    const t=this.obj.type;
    const left=this.M.time?Math.max(0,Math.round(this.M.time-this.clock)):0;
    return {k:'run',lv:this.lives,lm:this.livesMax,cl:Math.round(this.clock),tl:left,o:[this.objCur(),this.objTotal||this.waveTotal||0],ri:this.ri,
      f:this.foesAlive()+(this.boss&&this.boss.alive?1:0),sc:this.score,bp:this.bossPct,sb:board(this.A)};
  }
  info(){
    const M=this.M;
    return {k:'run',id:M.id,title:M.title,obj:M.obj,objText:M.obj.text,rings:this.rings?this.rings.map(r=>[Math.round(r.x),Math.round(r.y),Math.round(r.z),+r.nx.toFixed(3),+r.ny.toFixed(3),+r.nz.toFixed(3),r.r]):null,
      lm:this.livesMax,diff:this.diff,tl:M.time||0,endless:!!M.endless,mi:SW.MISSIONS.indexOf(M)};
  }
  summary(){
    const M=this.M,A=this.A;
    const win=this.won===true;
    const sb=board(A).sort((a,b)=>b[3]-a[3]);
    let stars=0;
    if(win){
      stars=1;
      if(this.lost<=Math.max(1,Math.floor(this.livesMax/3)))stars++;
      if(M.par?this.clock<=M.par:this.lost===0)stars++;
    }
    const endless=!!M.endless;
    const reward=endless?Math.floor(this.waveIdx*10+this.score/80):win?Math.round(M.reward*(.7+stars*.15)+this.score/100):Math.round(this.score/200);
    return {mode:'run',win,why:this.why||null,mission:SW.MISSIONS.indexOf(M),title:M.title,stars,time:Math.round(this.clock),lost:this.lost,score:this.score,
      waves:this.waveIdx+1,reward,sb,endless,diff:this.diff};
  }
}

SW.Modes={
  ffa:(A,cfg)=>new Ffa(A,cfg),
  team:(A,cfg)=>new Team(A,cfg),
  run:(A,cfg)=>new Run(A,cfg),
};
})(typeof window!=='undefined'?window:globalThis);
