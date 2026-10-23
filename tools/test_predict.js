// Предсказание своего дрона при задержках сети: играем «клиента» против настоящей комнаты через виртуальную сеть.
const SW=require('./load.js');
function run(L,J,label,secs){
  const rng=SW.rng(label.length*7+L);
  const hub=new SW.Hub({every:()=>()=>{}});
  let now=0;const down=[],up=[];
  const delay=()=>L+rng()*J;
  const conn={send:o=>down.push([now+delay(),JSON.parse(JSON.stringify(o))]),close(){}};
  const sess=hub.connect(conn);
  sess.message({action:'create_game',name:'T',opts:{mode:'ffa',map:'city',size:2,bots:true,botDiff:'easy',solo:true},v:SW.PROTO});
  // до первого round: ждём доставки
  let g=[...Object.values(hub.games)][0];
  const TICKMS=SW.TICK*1000;
  let pred=null,world=null,H=null,phase='count',myId=0;
  let nextHost=0,nextClient=rng()*TICKMS,seqSent=0;
  const hostTrace=[],clientTrace=[];const errs=[],lead=[];let me0=null,res={};
  const warm=5000;
  while(now<secs*1000){
    now+=1;
    // доставка сообщений
    for(let i=up.length-1;i>=0;i--)if(up[i][0]<=now){const m=up[i][1];up.splice(i,1);sess.message(m)}
    for(let i=0;i<down.length;i++){
      if(down[i][0]<=now){
        const m=down[i][1];down.splice(i,1);i--;
        if(m.type==='round'){world=SW.makeWorld(m.map,m.seed);myId=m.you;const me=m.dr.find(d=>d.id===myId);H=SW.effective(me.hull,me.mods);pred=new SW.Predictor(world,H)}
        else if(m.type==='snap'){phase=m.ph}
        else if(m.type==='me'&&pred){
          if(pred.P&&m.ep===pred.ep&&m.al){
            const h=pred.hist[m.ack&255];
            if(h&&h.s===m.ack&&now>warm)errs.push(Math.hypot(m.st[0]-h.x,m.st[1]-h.y,m.st[2]-h.z));
          }
          pred.reconcile(m);
        }
      }
    }
    if(now>=nextHost){nextHost+=TICKMS;hub.step(g);const d=g.A&&g.A.byId.get(1);if(d)hostTrace.push([now,d.x,d.y,d.z])}
    if(pred&&now>=nextClient){
      nextClient+=TICKMS*1.0002;
      const t=now/1000;
      const cmd={y:Math.sin(t/.9)*.8,p:Math.cos(t/1.3)*.3,t:Math.floor(t)%7===0?1:0,l:1};
      const move=phase==='play'&&pred.P;
      const s=pred.step(cmd,move);
      up.push([now+delay(),{action:'in',s,y:cmd.y,p:cmd.p,t:cmd.t,f:0,l:1,m:0,r:0,w:0}]);
      if(now>warm&&pred.P)clientTrace.push([now,pred.P.x,pred.P.y,pred.P.z]);
    }
  }
  // положение клиента в момент t сравниваем с положением дрона в комнате в момент t+L: к тому времени дойдёт наша команда
  for(const [t,x,y,z] of clientTrace){
    const tt=t+L+J/2,k=hostTrace.findIndex(q=>q[0]>=tt);
    if(k>0){const p=hostTrace[k-1],q=hostTrace[k],f=(tt-p[0])/(q[0]-p[0]||1);lead.push(Math.hypot(x-(p[1]+(q[1]-p[1])*f),y-(p[2]+(q[2]-p[2])*f),z-(p[3]+(q[3]-p[3])*f)))}
  }
  const st=a=>{a=a.filter(v=>v<100).sort((x,y)=>x-y);return {n:a.length,avg:+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2),p95:+a[Math.floor(a.length*.95)].toFixed(2),max:+a[a.length-1].toFixed(2)}};
  console.log(label.padEnd(18),'recon-err',JSON.stringify(st(errs)),'| vs host(t+L)',JSON.stringify(st(lead)),'| soft',pred.stat.soft,'hard',pred.stat.hard,'of',pred.stat.n);
  return {errs:st(errs),lead:st(lead),stat:pred.stat};
}
let bad=0;
for(const [L,J,label] of [[0,0,'локально'],[20,5,'LAN 20мс'],[50,15,'wifi 50±15'],[100,30,'мобильная 100±30'],[180,60,'плохая 180±60']]){
  const r=run(L,J,label,25);
  if(r.lead.p95>4.5+L/18||r.stat.hard>3){console.log('  ^ ПЛОХО');bad++}
}
console.log(bad?'FAILED '+bad:'predict OK');process.exit(bad?1:0);
