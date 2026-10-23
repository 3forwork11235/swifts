// «Стрижи» — звук. Никаких аудиофайлов: всё синтезируется на лету (WebAudio) — пушка, лазер, взрывы, двигатель,
// сигналы тревоги и захвата, а также простая процедурная музыка (меню — спокойная, бой — бодрая).
// Звуки на карте позиционные: громкость падает с расстоянием, панорама — по направлению от камеры.
(function(root){
'use strict';
const SW=root.SW;
const clamp=SW.clamp;

const A={
  ctx:null,ok:false,vol:{sfx:.8,music:.5},muted:false,L:{x:0,y:0,z:0,rx:1,rz:0},
  eng:null,laser:null,alarmT:0,alarmKind:0,lockT:0,lockState:0,lockP:0,mus:null,musMode:'off',
  init(){
    if(A.ctx){A.resume();return}
    const AC=root.AudioContext||root.webkitAudioContext;if(!AC)return;
    try{A.ctx=new AC()}catch(e){return}
    const c=A.ctx;
    A.master=c.createGain();A.master.gain.value=A.muted?0:1;
    // мягкий компрессор, чтобы взрывы не рвали динамики
    A.comp=c.createDynamicsCompressor();A.comp.threshold.value=-16;A.comp.ratio.value=5;A.comp.attack.value=.004;A.comp.release.value=.2;
    A.master.connect(A.comp);A.comp.connect(c.destination);
    A.sfx=c.createGain();A.sfx.connect(A.master);A.musGain=c.createGain();A.musGain.connect(A.master);
    A.setVolumes(A.vol.sfx,A.vol.music);
    // шум
    const len=c.sampleRate*2,buf=c.createBuffer(1,len,c.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
    A.noise=buf;A.ok=true;
    A.startEngine();
    A.resume();
  },
  resume(){if(A.ctx&&A.ctx.state!=='running')A.ctx.resume().catch(()=>{})},
  setVolumes(s,m){A.vol.sfx=s;A.vol.music=m;if(A.sfx){A.sfx.gain.value=s;A.musGain.gain.value=m*.55}},
  mute(on){A.muted=on==null?!A.muted:on;if(A.master)A.master.gain.value=A.muted?0:1;return A.muted},
  // слушатель — камера
  listener(x,y,z,yaw){A.L.x=x;A.L.y=y;A.L.z=z;A.L.rx=Math.cos(yaw);A.L.rz=-Math.sin(yaw)},
  spatial(pos){
    if(!pos)return {g:1,p:0};
    const dx=pos[0]-A.L.x,dy=pos[1]-A.L.y,dz=pos[2]-A.L.z,d=Math.hypot(dx,dy,dz);
    const g=1/(1+Math.pow(d/110,1.6)),pan=clamp((dx*A.L.rx+dz*A.L.rz)/(d||1),-1,1)*.85;
    return {g,p:pan,d};
  },
  // узел на выход: усиление + панорама
  out(g,pan,t){
    const c=A.ctx,gn=c.createGain();gn.gain.value=g;
    let last=gn;
    if(c.createStereoPanner&&pan){const p=c.createStereoPanner();p.pan.value=pan;gn.connect(p);last=p}
    last.connect(A.sfx);return gn;
  },
  nz(t,dur,node,rate){
    const s=A.ctx.createBufferSource();s.buffer=A.noise;s.loop=true;s.playbackRate.value=rate||1;
    s.connect(node);s.start(t,Math.random()*1.5);s.stop(t+dur+.05);return s;
  },
  osc(type,f0,f1,t,dur,node,det){
    const o=A.ctx.createOscillator();o.type=type;o.frequency.setValueAtTime(f0,t);
    if(f1!=null&&f1!==f0)o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    if(det)o.detune.value=det;
    o.connect(node);o.start(t);o.stop(t+dur+.05);return o;
  },
  env(gain,t,a,peak,d){gain.gain.cancelScheduledValues(t);gain.gain.setValueAtTime(0.0001,t);gain.gain.linearRampToValueAtTime(peak,t+a);gain.gain.exponentialRampToValueAtTime(0.0001,t+a+d)},

  // ---------- разовые звуки ----------
  play(name,o){
    if(!A.ok||A.muted)return;
    o=o||{};
    const sp=A.spatial(o.pos),vol=(o.vol==null?1:o.vol)*sp.g;
    if(vol<.012)return;
    const c=A.ctx,t=c.currentTime+(o.delay||0);
    const F=A.fx[name];if(F)F(c,t,vol,sp.p,o);
  },
  fx:{
    cannon(c,t,v,p,o){
      const g=A.out(.28*v,p),f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=o.far?900:1500;f.Q.value=.8;f.connect(g);
      A.env(g,t,.002,.28*v,.07);A.nz(t,.09,f,1);
      const g2=A.out(.3*v,p);A.env(g2,t,.002,.3*v,.07);A.osc('sine',150,48,t,.08,g2);
    },
    zap(c,t,v,p){ // отрезок лазера у чужого дрона
      const g=A.out(.12*v,p);A.env(g,t,.01,.12*v,.16);A.osc('sawtooth',720,340,t,.18,g);A.osc('square',1450,520,t,.18,g,6);
    },
    missile(c,t,v,p){
      const g=A.out(.4*v,p),f=c.createBiquadFilter();f.type='bandpass';f.Q.value=1.2;f.frequency.setValueAtTime(350,t);f.frequency.exponentialRampToValueAtTime(3200,t+.9);f.connect(g);
      A.env(g,t,.03,.4*v,1.0);A.nz(t,1.1,f,1);
      const g2=A.out(.3*v,p);A.env(g2,t,.01,.3*v,.5);A.osc('sine',90,45,t,.55,g2);
    },
    boom(c,t,v,p,o){
      const k=clamp((o.size||6)/8,.5,3),g=A.out(.7*v,p),f=c.createBiquadFilter();f.type='lowpass';f.frequency.setValueAtTime(2200,t);f.frequency.exponentialRampToValueAtTime(70,t+.35+.5*k);f.connect(g);
      A.env(g,t,.004,.7*v,.45+.75*k);A.nz(t,1.4*k+.5,f,.7);
      const g2=A.out(.7*v,p);A.env(g2,t,.004,.7*v,.4+.5*k);A.osc('sine',110,26,t,.5+.5*k,g2);
    },
    hit(c,t,v){const g=A.out(.2*v,0);A.env(g,t,.001,.2*v,.03);A.osc('square',2200,1500,t,.04,g)},
    hitkill(c,t,v){const g=A.out(.28*v,0);A.env(g,t,.001,.28*v,.08);A.osc('square',1500,2300,t,.08,g);A.osc('square',2300,3000,t+.07,.1,g)},
    hurt(c,t,v){
      const g=A.out(.55*v,0),f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=700;f.connect(g);A.env(g,t,.002,.55*v,.22);A.nz(t,.25,f);
      const g2=A.out(.5*v,0);A.env(g2,t,.002,.5*v,.2);A.osc('sine',110,50,t,.2,g2);
    },
    crash(c,t,v){
      const g=A.out(.8*v,0),f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=500;f.connect(g);A.env(g,t,.002,.8*v,.5);A.nz(t,.55,f,.6);
      const g2=A.out(.7*v,0);A.env(g2,t,.003,.7*v,.4);A.osc('sine',70,22,t,.45,g2);
    },
    pickup(c,t,v,p){const g=A.out(.25*v,p);for(let i=0;i<3;i++){const tt=t+i*.06;A.env2(g,tt,.01,.25*v,.12);A.osc('sine',[660,880,1320][i],null,tt,.12,g)}},
    ring(c,t,v){const g=A.out(.3*v,0);A.env(g,t,.005,.3*v,.5);A.osc('sine',880,1760,t,.4,g);A.osc('triangle',1320,2640,t,.4,g)},
    click(c,t,v){const g=A.out(.15*v,0);A.env(g,t,.001,.15*v,.02);A.osc('square',900,700,t,.03,g)},
    beep(c,t,v){const g=A.out(.28*v,0);A.env(g,t,.005,.28*v,.2);A.osc('sine',520,520,t,.2,g)},
    go(c,t,v){const g=A.out(.32*v,0);A.env(g,t,.005,.32*v,.5);A.osc('sine',1040,1040,t,.5,g);A.osc('triangle',1560,1560,t,.5,g)},
    radio(c,t,v){
      const g=A.out(.12*v,0),f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=2200;f.Q.value=2;f.connect(g);A.env(g,t,.002,.12*v,.08);A.nz(t,.1,f);
      const g2=A.out(.1*v,0);A.env(g2,t+.05,.002,.1*v,.05);A.osc('sine',1700,1700,t+.05,.06,g2);
    },
    flare(c,t,v,p){const g=A.out(.3*v,p),f=c.createBiquadFilter();f.type='highpass';f.frequency.value=3500;f.connect(g);A.env(g,t,.01,.3*v,.5);A.nz(t,.55,f)},
    kill(c,t,v){const g=A.out(.3*v,0);for(let i=0;i<3;i++){const tt=t+i*.07;A.env2(g,tt,.005,.3*v,.15);A.osc('triangle',[784,1047,1568][i],null,tt,.15,g)}},
    win(c,t,v){const g=A.out(.35*v,0);[523,659,784,1047].forEach((f,i)=>{const tt=t+i*.14;A.env2(g,tt,.01,.35*v,.5);A.osc('triangle',f,null,tt,.5,g)})},
    lose(c,t,v){const g=A.out(.35*v,0);[440,370,311,247].forEach((f,i)=>{const tt=t+i*.2;A.env2(g,tt,.01,.35*v,.6);A.osc('sawtooth',f,f*.98,tt,.6,g)})},
    warn(c,t,v){const g=A.out(.3*v,0);A.env(g,t,.002,.3*v,.1);A.osc('square',A.alarmHi?1250:900,A.alarmHi?1250:900,t,.1,g)},
    lock(c,t,v){const g=A.out(.2*v,0);A.env(g,t,.002,.2*v,.07);A.osc('sine',1400,1400,t,.07,g)},
    locked(c,t,v){const g=A.out(.22*v,0);A.env(g,t,.003,.22*v,.12);A.osc('sine',2100,2100,t,.12,g)},
    heat(c,t,v){const g=A.out(.25*v,0);A.env(g,t,.003,.25*v,.12);A.osc('sawtooth',300,180,t,.12,g)},
  },
  env2(gain,t,a,peak,d){gain.gain.setValueAtTime(0.0001,t);gain.gain.linearRampToValueAtTime(peak,t+a);gain.gain.exponentialRampToValueAtTime(0.0001,t+a+d)},

  // ---------- двигатель и лазер (непрерывные) ----------
  startEngine(){
    const c=A.ctx;
    const g=c.createGain();g.gain.value=0;g.connect(A.sfx);
    const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=500;f.connect(g);
    const o1=c.createOscillator();o1.type='sawtooth';o1.frequency.value=70;o1.connect(f);o1.start();
    const o2=c.createOscillator();o2.type='square';o2.frequency.value=140;o2.detune.value=9;const g2=c.createGain();g2.gain.value=.35;o2.connect(g2);g2.connect(f);o2.start();
    // шум ветра
    const wg=c.createGain();wg.gain.value=0;wg.connect(A.sfx);
    const wf=c.createBiquadFilter();wf.type='bandpass';wf.frequency.value=900;wf.Q.value=.5;wf.connect(wg);
    const ns=c.createBufferSource();ns.buffer=A.noise;ns.loop=true;ns.connect(wf);ns.start();
    // лазер
    const lg=c.createGain();lg.gain.value=0;lg.connect(A.sfx);
    const lo=c.createOscillator();lo.type='sawtooth';lo.frequency.value=210;const lo2=c.createOscillator();lo2.type='square';lo2.frequency.value=422;
    const lf=c.createBiquadFilter();lf.type='lowpass';lf.frequency.value=1800;lo.connect(lf);lo2.connect(lf);lf.connect(lg);lo.start();lo2.start();
    const lfo=c.createOscillator();lfo.frequency.value=28;const lfg=c.createGain();lfg.gain.value=40;lfo.connect(lfg);lfg.connect(lo.frequency);lfo.start();
    A.eng={g,f,o1,o2,wg,wf};A.laser={g:lg,lo,lo2};
  },
  // v — скорость м/с, boost — форсаж, on — звук двигателя нужен (в игре), hp — доля прочности
  engine(v,boost,on){
    if(!A.eng)return;
    const t=A.ctx.currentTime,e=A.eng;
    const tg=on?(.05+.03*clamp(v/60,0,1.2)+(boost?.05:0)):0;
    e.g.gain.setTargetAtTime(tg,t,.08);
    e.o1.frequency.setTargetAtTime(48+v*1.1+(boost?18:0),t,.1);e.o2.frequency.setTargetAtTime(96+v*2.2+(boost?36:0),t,.1);
    e.f.frequency.setTargetAtTime(380+v*11+(boost?500:0),t,.1);
    e.wg.gain.setTargetAtTime(on?clamp((v-30)/50,0,1)*(boost?.12:.05):0,t,.15);
    e.wf.frequency.setTargetAtTime(700+v*14,t,.15);
  },
  laserOn(on,hp){
    if(!A.laser)return;
    const t=A.ctx.currentTime;
    A.laser.g.gain.setTargetAtTime(on&&!A.muted?.08:0,t,.03);
  },

  // ---------- сигналы: тревога ракеты и захват цели ----------
  // warn: 0 нет, 1 ракета летит (медленный), 2 ракета близко (быстрый); lock: 0 нет, 1 захватываем (p 0..1), 2 захвачено
  signals(dt,warn,lock,p){
    if(!A.ok)return;
    A.alarmT-=dt;
    if(warn&&A.alarmT<=0){A.alarmT=warn===2?.2:.45;A.alarmHi=!A.alarmHi;A.play('warn')}
    A.lockT-=dt;
    if(lock===1&&A.lockT<=0){A.lockT=.5-.38*clamp(p,0,1);A.play('lock')}
    else if(lock===2&&A.lockT<=0){A.lockT=.16;A.play('locked')}
  },

  // ---------- музыка ----------
  music(mode){
    if(!A.ok||mode===A.musMode)return;
    A.musMode=mode;
    if(A.mus){clearInterval(A.mus.h);A.mus=null}
    if(mode==='off')return;
    const c=A.ctx,bpm=mode==='battle'?128:92,step=60/bpm/4;
    const roots=[55,43.65,65.41,49],chords=[[0,3,7],[0,4,7],[0,4,7],[0,4,7]]; // Am F C G
    const minor=[0,3,7],major=[0,4,7];
    const st={t:c.currentTime+.1,i:0,h:null};
    const note=(f,t,dur,type,peak,cut,dest)=>{
      const g=c.createGain(),fl=c.createBiquadFilter();fl.type='lowpass';fl.frequency.setValueAtTime(cut,t);fl.frequency.exponentialRampToValueAtTime(Math.max(80,cut*.25),t+dur);
      g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(peak,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
      const o=c.createOscillator();o.type=type;o.frequency.value=f;o.connect(fl);fl.connect(g);g.connect(dest||A.musGain);o.start(t);o.stop(t+dur+.05);
    };
    const sched=()=>{
      while(st.t<c.currentTime+.25){
        const i=st.i,bar=Math.floor(i/16)%4,s=i%16,root=roots[bar],ch=bar===0?minor:major,t=st.t;
        const f=(semi,oct)=>root*Math.pow(2,semi/12)*(oct||1);
        if(mode==='battle'){
          if(s%4===0){const g=c.createGain();g.gain.setValueAtTime(.5,t);g.gain.exponentialRampToValueAtTime(.001,t+.16);g.connect(A.musGain);
            const o=c.createOscillator();o.frequency.setValueAtTime(130,t);o.frequency.exponentialRampToValueAtTime(40,t+.14);o.connect(g);o.start(t);o.stop(t+.2)}
          if(s%4===2){const g=c.createGain();g.gain.setValueAtTime(.05,t);g.gain.exponentialRampToValueAtTime(.001,t+.05);g.connect(A.musGain);const fl=c.createBiquadFilter();fl.type='highpass';fl.frequency.value=6000;fl.connect(g);A.nz(t,.06,fl)}
          if(s%2===0)note(f(0,1)*(s%8===6?2:1),t,step*1.8,'sawtooth',.16,700);
          const arp=[0,1,2,1,2,1,2,1][s%8];note(f(ch[arp%3],4),t,step*1.4,'square',.04,2600);
        }else{
          if(s%8===0){for(const k of ch){note(f(k,2),t,step*8,'sawtooth',.045,900);note(f(k,2),t,step*8,'sawtooth',.03,900)}}
          if(s%4===0)note(f(ch[(s/4|0)%3],4),t,step*3,'triangle',.06,2200);
          if(s===0)note(f(0,1),t,step*8,'sine',.2,400);
        }
        st.t+=step;st.i++;
      }
    };
    st.h=setInterval(sched,60);sched();
    A.mus=st;
  },
};
SW.Audio=A;
})(typeof window!=='undefined'?window:globalThis);
