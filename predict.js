// «Стрижи» — предсказание своего дрона на стороне игрока (без DOM, поэтому проверяется в Node: tools/test_predict.js).
//
// Идея. Игрок двигает свой дрон сам, той же функцией SW.Flight.step, что и комната, — 30 шагов в секунду, каждый шаг имеет номер.
// Все введённые команды уходят в комнату. Комната присылает `me`: точное состояние нашего дрона и номер ack последней принятой
// команды. Мы сравниваем это состояние с тем, что сами записали на шаге ack. Расхождение исправляем:
//   • маленькое (до 14 м) — плавно подтягиваем текущее положение, сдвигая и запись более поздних шагов,
//     чтобы одну и ту же ошибку не исправлять дважды;
//   • большое (удар, взрыв, возрождение) — берём состояние комнаты и заново проигрываем наши команды после ack.
(function(root){
'use strict';
const SW=root.SW;
const {angDiff,TICK}=SW;
const HARD=14,DEAD=.6;

function copy(d,s){d.x=s.x;d.y=s.y;d.z=s.z;d.yaw=s.yaw;d.pitch=s.pitch;d.roll=s.roll;d.spd=s.spd;d.yawV=s.yawV;d.pitchV=s.pitchV;d.energy=s.energy;d.boost=s.boost;d.regenT=s.regenT}

class Predictor{
  constructor(world,H){
    this.world=world;this.H=H;
    this.P=null;this.Pp=null;this.seq=0;this.ep=-1;
    this.hist=new Array(256);this.cmds=new Array(256);
    this.stat={soft:0,hard:0,n:0};
  }
  // поставить состояние как есть (первый кадр, возрождение)
  set(st,en){
    const P=this.P||(this.P={});
    P.x=st[0];P.y=st[1];P.z=st[2];P.yaw=st[3];P.pitch=st[4];P.roll=st[5];P.spd=st[6];P.yawV=st[7];P.pitchV=st[8];
    P.energy=en;P.boost=false;P.regenT=0;
    this.Pp=this.Pp||{};copy(this.Pp,P);
  }
  record(s){const P=this.P;this.hist[s&255]=P?{s,x:P.x,y:P.y,z:P.z,yaw:P.yaw,pitch:P.pitch,spd:P.spd}:null}
  // Один шаг: команда cmd = {y,p,t,l}; move=false — дрон стоит (отсчёт, гибель, пауза)
  step(cmd,move){
    const s=++this.seq;cmd.s=s;this.cmds[s&255]=cmd;
    const P=this.P;
    if(P){
      copy(this.Pp,P);
      if(move)SW.Flight.step(P,{yaw:cmd.y,pitch:cmd.p,thr:cmd.t,level:cmd.l},TICK,this.world,this.H);
    }
    this.record(s);
    return s;
  }
  // Сообщение `me` от комнаты. Возвращает 'set' | 'hard' | 'soft' | 'ok'
  reconcile(m){
    this.stat.n++;
    if(m.ep!==this.ep||!this.P){
      this.ep=m.ep;this.set(m.st,m.en);this.hist.fill(null);this.seq=Math.max(this.seq,m.ack);
      return 'set';
    }
    if(!m.al){this.set(m.st,m.en);return 'set'}
    const P=this.P;P.energy=m.en;
    const h=this.hist[m.ack&255];
    if(!h||h.s!==m.ack){
      const e=Math.hypot(m.st[0]-P.x,m.st[1]-P.y,m.st[2]-P.z);
      if(e>25){this.set(m.st,m.en);return 'hard'}
      return 'ok';
    }
    const ex=m.st[0]-h.x,ey=m.st[1]-h.y,ez=m.st[2]-h.z,e=Math.hypot(ex,ey,ez);
    if(e>HARD){
      this.set(m.st,m.en);
      const P2=this.P;
      for(let s=m.ack+1;s<=this.seq;s++){
        const c=this.cmds[s&255];
        if(c&&c.s===s){SW.Flight.step(P2,{yaw:c.y,pitch:c.p,thr:c.t,level:c.l},TICK,this.world,this.H);this.record(s)}
      }
      copy(this.Pp,P2);
      this.stat.hard++;return 'hard';
    }
    if(e>DEAD){
      const k=e>3?.6:.28; // чем больше расхождение, тем быстрее подтягиваем
      const dy=angDiff(h.yaw,m.st[3])*k,dp=(m.st[4]-h.pitch)*k,ds=(m.st[6]-h.spd)*.5;
      P.x+=ex*k;P.y+=ey*k;P.z+=ez*k;P.yaw+=dy;P.pitch+=dp;P.spd+=ds;
      this.Pp.x+=ex*k;this.Pp.y+=ey*k;this.Pp.z+=ez*k;
      for(let s=m.ack+1;s<=this.seq;s++){const q=this.hist[s&255];if(q&&q.s===s){q.x+=ex*k;q.y+=ey*k;q.z+=ez*k;q.yaw+=dy;q.pitch+=dp;q.spd+=ds}}
      this.stat.soft++;return 'soft';
    }
    return 'ok';
  }
}
SW.Predictor=Predictor;
})(typeof window!=='undefined'?window:globalThis);
