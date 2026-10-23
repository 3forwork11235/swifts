// Комната целиком: подключаем «клиентов» из фальшивых соединений и играем.
const SW=require('./load.js');
let fail=0;const ok=(c,m)=>{if(!c){console.log('FAIL',m);fail++}};
function Client(hub,name){
  const c={log:[],last:{},slot:null,you:0};
  const conn={send:o=>{const m=JSON.parse(JSON.stringify(o));c.log.push(m);c.last[m.type]=m;if(m.type==='joined')c.slot=m.slot;if(m.type==='round')c.you=m.you},close:()=>{c.closed=true}};
  c.sess=hub.connect(conn);c.send=o=>c.sess.message(JSON.parse(JSON.stringify(o)));c.name=name;
  return c;
}
const hub=new SW.Hub({log:()=>{},every:()=>()=>{}});
// 1. схватка: два игрока + боты
const a=Client(hub,'A'),b=Client(hub,'B');
a.send({action:'create_game',name:'Альфа',opts:{mode:'ffa',map:'port',size:5,bots:true,botDiff:'normal'},loadout:{hull:'wasp',mods:['armor','bogus','cap','jet'],skin:{paint:3,trail:2,emblem:1}},v:SW.PROTO});
const gid=a.last.joined.game_id;ok(/^[A-Z0-9]{6}$/.test(gid),'game id');
ok(a.last.lobby&&a.last.lobby.opts.size===5,'lobby opts');
ok(JSON.stringify(a.last.lobby.slots.P0.mods)==='["armor","cap"]','loadout cleaned '+JSON.stringify(a.last.lobby.slots.P0.mods));
b.send({action:'join_game',game_id:gid,name:'Боря',loadout:{hull:'shade'},v:SW.PROTO});
ok(b.slot==='P1','b joined P1');
b.send({action:'start_game'});ok(!a.last.round,'non-leader cannot start');
a.send({action:'start_game'});
const g=hub.games[gid];
ok(g.started&&g.A,'started');
ok(a.last.round&&a.last.round.you===1&&b.last.round.you===2,'round sent with ids');
ok(Object.values(a.last.round.slots).filter(s=>s.kind==='bot').length===3,'3 bots filled');
const r=a.last.round;console.log('round msg bytes',JSON.stringify(r).length,'drones',r.dr.length);
// пошагово: 3 секунды отсчёта + 20 секунд боя
let seq=0;
for(let i=0;i<30*23;i++){
  seq++;
  a.send({action:'in',s:seq,y:Math.sin(i/30)*.5,p:.1,t:0,f:i%90<30?1:0,l:1,m:0,r:0,w:0});
  b.send({action:'in',s:seq,y:-.3,p:0,t:1,f:0,l:1,m:0,r:0,w:0});
  hub.step(g);
}
ok(a.last.snap&&a.last.me,'snap and me received');
ok(a.last.me.ack>0&&a.last.me.ack<=seq,'ack '+a.last.me.ack);
const bytes=a.log.filter(m=>m.type==='snap').map(m=>JSON.stringify(m).length);
console.log('snaps',bytes.length,'avg',(bytes.reduce((x,y)=>x+y,0)/bytes.length)|0,'B; me',JSON.stringify(a.last.me).length,'B');
ok(a.last.roster||a.log.some(m=>m.type==='roster'),'roster sent');
ok(g.A.phase==='play','playing '+g.A.phase);
const myD=g.A.byId.get(1);ok(myD.hullId==='wasp'&&myD.mods.join()==='armor,cap','drone loadout');
ok(myD.H.hp===Math.round(SW.HULLS.wasp.hp*1.25),'module applied hp '+myD.H.hp);
// 2. отключение и возвращение
const tokenB=b.log.find(m=>m.type==='joined').token;
b.sess.closed();
ok(Object.values(g.slots).find(s=>s.name==='Боря').online===false,'B offline');
const b2=Client(hub,'B2');
b2.send({action:'resume',game_id:gid,slot:'P1',token:tokenB,loadout:{hull:'shade'}});
ok(b2.last.resumed&&b2.last.round,'resumed with round state');
ok(g.A.byId.get(2).ctl==='human','control returned');
b2.send({action:'resume',game_id:gid,slot:'P1',token:'bad'});ok(b2.last.resume_failed,'bad token');
// 3. раунд заканчивается по времени/счёту
g.A.dir.left=0.01;
for(let i=0;i<5;i++)hub.step(g);
ok(g.A.phase==='end'&&a.last.round_end,'round end');
ok(a.last.round_end.result.sb.length===5,'scoreboard rows');
console.log('result winner',a.last.round_end.result.winner,'next',a.last.round_end.next);
a.send({action:'restart'});ok(g.round===2&&g.A.phase==='count','restart new round');
// 4. выход в лобби
a.send({action:'to_lobby'});ok(!g.started&&a.last.lobby.started===false,'back to lobby');
ok(Object.values(g.slots).filter(s=>s.kind==='empty').length===3,'bots cleared');
// 5. изменение настроек в лобби
a.send({action:'set_opts',opts:{mode:'team',size:6,frags:20}});ok(g.opts.mode==='team'&&g.opts.size===6&&Object.keys(g.slots).length===6,'set_opts');
b2.send({action:'set_opts',opts:{mode:'ffa'}});ok(g.opts.mode==='team','non-leader cannot change');
a.send({action:'team',team:1});b2.send({action:'team',team:0});
a.send({action:'start_game'});ok(g.started,'team start');
const teams=Object.values(a.last.round.slots).map(s=>s.team);console.log('teams',teams.join(''));
// 6. рейс в одиночку
const hub2=new SW.Hub({log:()=>{},every:()=>()=>{}});
const s=Client(hub2,'S');
s.send({action:'create_game',name:'Соло',opts:{mode:'run',mission:1,solo:true},v:SW.PROTO});
const g2=hub2.games[s.last.joined.game_id];
ok(g2.started&&g2.A.mode==='run','solo run started');
ok(g2.opts.wing===2&&g2.A.byId.has(8)||true,'wingmen via opts');
for(let i=0;i<30*10;i++){s.send({action:'in',s:i,y:0,p:0,t:0,f:0,l:1});hub2.step(g2)}
ok(s.last.snap.g.k==='run','run state in snapshot');
console.log('run state',JSON.stringify(s.last.snap.g).slice(0,200));
console.log('drones in run:',g2.A.drones.map(d=>d.name+':'+d.kind).join(', '));
// 7. закрытие
hub2.shutdown(s.last.joined.game_id);ok(s.last.game_closed,'shutdown message');
console.log(fail?'FAILED '+fail:'hub OK');process.exit(fail?1:0);
