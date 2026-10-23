// Комната игры «Стрижи»: места, лобби, боты, раунды и связь с ареной (sim.js).
// Работает в браузере создателя игры (или на одном устройстве в игре с ботами). Остальные игроки подключаются к нему
// через WebRTC (P2P), запасной канал MQTT или пересылку server.py, а сам создатель — через «петлю» в памяти.
// Игроки присылают только ввод (стик, огонь, нажатия); всё остальное считает арена и 15 раз в секунду рассылает снимок.
// Каждому игроку дополнительно уходит личное сообщение `me` — точное состояние его дрона, по нему клиент поправляет предсказание.
//
// Сообщения клиент → комната: create_game, join_game, resume, in (ввод), start_game, restart, to_lobby, set_opts, loadout,
//   team, emote, pause, ping, leave.   Комната → клиент: joined, lobby, slots, round, snap, me, roster, round_end, resumed, emote,
//   pong, error, game_closed.
(function(root){
'use strict';
const SW=root.SW;
const {clamp,toInt,isNum}=SW;
const TICK=SW.TICK;
const RECONNECT_GRACE=180; // сколько секунд держим место ушедшего игрока
const BOT_DELAY=5;         // через сколько секунд за отошедшего начинает лететь бот
const PROTO=1;             // версия протокола: гость со старой страницей получит понятную ошибку
SW.PROTO=PROTO;

function pick(a){return a[Math.floor(Math.random()*a.length)]}
function cleanName(n){return String(n==null?'':n).trim().replace(/[<>&]/g,'').slice(0,14)}
function slotIds(n){const a=[];for(let i=0;i<n;i++)a.push('P'+i);return a}
function slotIdx(sid){return toInt(String(sid).slice(1))}
// два пилота с одним позывным путаются в таблице: второму добавляем номер
function uniqueName(g,name,sid){
  const used=new Set(Object.keys(g.slots).filter(s=>s!==sid&&g.slots[s].name).map(s=>g.slots[s].name));
  if(!used.has(name))return name;
  for(let i=2;i<20;i++){const n=name.slice(0,12)+' '+i;if(!used.has(n))return n}
  return name;
}

function cleanOpts(o,prev){
  o=Object.assign({},prev||{},o||{});
  const mode=SW.MODE_IDS.includes(o.mode)?o.mode:'ffa';
  const flag=(v,d)=>v===undefined?d:!!v;
  const out={
    mode,
    map:SW.MAP_IDS.includes(o.map)?o.map:'city',
    solo:!!o.solo,
    bots:flag(o.bots,true),
    botDiff:SW.DIFF_IDS.includes(o.botDiff)?o.botDiff:'normal',
    assist:[0,1,2].includes(toInt(o.assist))?toInt(o.assist):1,
    mission:clamp(toInt(o.mission),0,SW.MISSIONS.length-1),
    diff:SW.DIFF_IDS.includes(o.diff)?o.diff:null, // null — как задумано в миссии
    wing:clamp(toInt(o.wing),0,3),
    time:[0,180,300,420,600].includes(toInt(o.time))?toInt(o.time):(mode==='team'?420:420),
    frags:clamp(toInt(o.frags)||(mode==='team'?30:15),3,99),
  };
  out.size=mode==='run'?clamp(toInt(o.size)||4,1,4):clamp(toInt(o.size)||6,2,SW.MAX_SLOTS);
  if(out.solo){out.bots=true;out.size=mode==='run'?1:clamp(toInt(o.size)||6,2,SW.MAX_SLOTS)}
  if(mode==='run'&&out.solo&&o.wing===undefined)out.wing=2;
  if(mode==='run')out.bots=false;
  return out;
}
function cleanLoadout(l){
  l=l||{};
  const hull=SW.HULL_IDS.includes(l.hull)?l.hull:'swift';
  const mods=[];
  for(const m of (Array.isArray(l.mods)?l.mods:[]))if(SW.MODULES[m]&&!mods.includes(m)&&mods.length<2)mods.push(m);
  const s=l.skin||{};
  const n=(v,max)=>{const x=toInt(v);return x>=0&&x<max?x:0};
  return {hull,mods,skin:{paint:n(s.paint,12),trail:n(s.trail,6),emblem:n(s.emblem,8)}};
}
function newSlot(){return {kind:'empty',ws:null,token:null,name:'',online:false,tasks:[],loadout:cleanLoadout(),team:0,away:false}}

function leader(g){
  for(const s of Object.keys(g.slots)){const sl=g.slots[s];if(sl.kind==='human'&&sl.online)return s}
  for(const s of Object.keys(g.slots))if(g.slots[s].kind==='human')return s;
  return null;
}
function slotsView(g){
  const v={};
  for(const s in g.slots){const sl=g.slots[s];v[s]={kind:sl.kind,name:sl.name,online:sl.online,hull:sl.loadout.hull,mods:sl.loadout.mods,skin:sl.loadout.skin,team:sl.team,away:sl.away}}
  return v;
}
function freeSlotForJoin(g){
  const ids=Object.keys(g.slots);
  return ids.find(s=>g.slots[s].kind==='empty')||ids.find(s=>g.slots[s].kind==='bot'&&!g.slots[s].token)||ids.find(s=>g.slots[s].kind==='gone')||null;
}
function allHumans(g){return Object.values(g.slots).every(sl=>sl.kind==='human')}
function gameDead(g){return Object.values(g.slots).every(sl=>sl.token===null)}
function cancelTasks(sl){for(const t of sl.tasks)clearTimeout(t);sl.tasks=[]}
function humans(g){return Object.keys(g.slots).filter(s=>g.slots[s].kind==='human')}

class SwiftHub{
  constructor(o){
    o=o||{};
    this.games={};
    this.log=o.log||(()=>{});
    this.onChange=o.onChange||null;   // состояние игры изменилось (для сохранения)
    this.onClosed=o.onClosed||null;   // игра закрыта
    // таймер симуляции; страница может дать свой (из Web Worker — он не засыпает в фоне)
    this.every=o.every||((fn,ms)=>{const h=setInterval(fn,ms);return()=>clearInterval(h)});
  }
  connect(conn){
    const c={conn,g:null,me:null,emoteAt:0};
    return {
      message:data=>{try{this._message(c,data)}catch(e){this.log('[!] Ошибка: '+(e&&e.stack||e))}},
      closed:()=>{try{this._closed(c)}catch(e){this.log('[!] Ошибка: '+(e&&e.stack||e))}},
    };
  }

  // ---------- отправка ----------
  send(ws,msg){if(!ws)return;try{ws.send(msg)}catch(e){}}
  broadcast(g,msg,exclude){for(const sl of Object.values(g.slots))if(sl.ws&&sl.ws!==exclude)this.send(sl.ws,msg)}
  lobbyMsg(g){return {type:'lobby',game_id:g.id,slots:slotsView(g),leader:leader(g),opts:g.opts,score:g.score,started:g.started}}
  sendSlots(g){
    if(g.started)this.broadcast(g,{type:'slots',slots:slotsView(g),leader:leader(g),score:g.score});
    else this.broadcast(g,this.lobbyMsg(g));
  }
  changed(g){if(this.onChange&&this.games[g.id]===g)this.onChange(g)}

  // ---------- раунды ----------
  teamOf(g,sid){
    const sl=g.slots[sid],idx=slotIdx(sid);
    if(g.opts.mode==='team')return sl.team===1?1:0;
    if(g.opts.mode==='run')return 0;
    return idx+1;
  }
  makeBot(g,sid){
    const sl=g.slots[sid],used=new Set(Object.values(g.slots).filter(s=>s!==sl&&s.name).map(s=>s.name));
    const free=SW.CALLSIGNS.filter(n=>!used.has(n));
    const hard=g.opts.botDiff==='hard'||g.opts.botDiff==='ace';
    sl.kind='bot';sl.token=null;sl.online=false;sl.away=false;
    sl.name=free.length?pick(free):'Пилот';
    sl.loadout=cleanLoadout({hull:pick(SW.HULL_IDS),mods:hard?[pick(SW.MODULE_IDS)]:[],skin:{paint:Math.floor(Math.random()*12),trail:Math.floor(Math.random()*6),emblem:Math.floor(Math.random()*8)}});
    if(g.opts.mode==='team'){
      const cnt=[0,0];
      for(const s of Object.keys(g.slots)){const o=g.slots[s];if(o!==sl&&(o.kind==='human'||o.kind==='bot'))cnt[o.team===1?1:0]++}
      sl.team=cnt[1]<=cnt[0]?1:0;
    }
  }
  // Новая арена и дроны всех участников
  newRound(g){
    const o=g.opts,M=o.mode==='run'?SW.MISSIONS[o.mission]:null;
    if(g.A)this.stopLoop(g);
    const ids=Object.keys(g.slots);
    if(o.mode!=='run'&&o.bots)for(const s of ids)if(g.slots[s].kind==='empty')this.makeBot(g,s);
    g.round=(g.round||0)+1;
    const A=new SW.Arena({map:M?M.map:o.map,seed:M?M.seed:1+Math.floor(Math.random()*2147483000),mode:o.mode,opts:Object.assign({},o)});
    g.A=A;g.endSent=false;g.snapN=0;g.rosterV=-1;g.paused=false;g.idle=false;
    for(const sid of ids){
      const sl=g.slots[sid];
      if(sl.kind==='empty'||sl.kind==='gone')continue;
      this.addDroneFor(g,sid);
    }
    A.begin();
    this.broadcastRound(g);
    this.startLoop(g);
    this.changed(g);
  }
  addDroneFor(g,sid){
    const A=g.A,sl=g.slots[sid],o=g.opts,idx=slotIdx(sid),L=sl.loadout;
    const human=sl.kind==='human'&&sl.online;
    const d=A.addDrone({id:idx+1,slot:sid,name:sl.name,kind:human?'human':'bot',team:this.teamOf(g,sid),hull:L.hull,mods:L.mods,skin:L.skin,diff:o.botDiff});
    if(human)d.in.lvl=1;
    return d;
  }
  roundMsg(g,sid){
    return Object.assign({type:'round',round:g.round,you:slotIdx(sid)+1,opts:g.opts,slots:slotsView(g),leader:leader(g),score:g.score},g.A.roundInfo());
  }
  broadcastRound(g){
    for(const sid of Object.keys(g.slots)){const sl=g.slots[sid];if(sl.ws)this.send(sl.ws,this.roundMsg(g,sid))}
  }
  fullState(g,sid){
    return Object.assign({type:'resumed',game_id:g.id,slot:sid,started:g.started,slots:slotsView(g),leader:leader(g),opts:g.opts,score:g.score},
      g.started&&g.A?{round:g.round,you:slotIdx(sid)+1,ri:g.A.roundInfo()}:{});
  }

  // ---------- игровой цикл ----------
  startLoop(g){
    this.stopLoop(g);
    let last=Date.now(),acc=0;
    g.stopLoop=this.every(()=>{
      if(this.games[g.id]!==g||!g.A){this.stopLoop(g);return}
      const now=Date.now();
      if(g.paused||g.idle){last=now;return}
      acc+=Math.min(.5,(now-last)/1000);last=now; // вкладка спала — не догоняем всё сразу
      let n=0;
      while(acc>=TICK&&n<8){acc-=TICK;n++;try{this.step(g)}catch(e){this.log('[!] Ошибка шага: '+(e&&e.stack||e))}}
    },1000/60);
  }
  stopLoop(g){if(g.stopLoop){const s=g.stopLoop;g.stopLoop=null;s()}}
  step(g){
    const A=g.A;
    A.step(TICK);
    if(++g.snapN>=SW.SNAP_EVERY){g.snapN=0;this.sendSnap(g)}
    if(A.phase==='end'){
      if(!g.endSent){g.endSent=true;this.endRound(g)}
      else if(A.phaseT<=0){
        if(g.opts.mode==='run')g.idle=true;           // «Рейс»: ждём решения создателя (ещё раз / меню)
        else this.newRound(g);                         // схватки идут раунд за раундом
      }
    }
  }
  sendSnap(g){
    const A=g.A,snap=A.snapshot();
    if(g.rosterV!==A.rosterV){
      g.rosterV=A.rosterV;
      this.broadcast(g,{type:'roster',dr:A.drones.filter(d=>d.kind!=='foe').map(d=>A.droneInfo(d))});
    }
    for(const sid in g.slots){
      const sl=g.slots[sid];
      if(!sl.ws)continue;
      this.send(sl.ws,snap);
      const d=A.byId.get(slotIdx(sid)+1);
      if(d&&sl.kind==='human')this.send(sl.ws,A.meFor(d));
    }
  }
  endRound(g){
    const A=g.A,r=A.result||{};
    // победитель раунда записывается в общий счёт матча
    let win=null;
    if(r.mode==='ffa'&&r.winner>0)win=r.winner;
    if(r.mode==='run'&&r.win)win=0;
    if(win>0){const sid='P'+(win-1);if(g.score[sid])g.score[sid].wins++}
    const st={};
    for(const d of A.drones)if(d.kind!=='foe')st[d.id]={k:d.st.k,d:d.st.d,dmg:Math.round(d.st.dmg),shots:d.st.shots,hit:d.st.hit,icp:d.st.icp,sites:d.st.sites,rings:d.st.rings,pk:d.st.pk,best:d.st.best,score:Math.round(d.st.score),fs:d.st.flareSaves||0};
    this.broadcast(g,{type:'round_end',result:r,round:g.round,next:g.opts.mode==='run'?0:SW.END_PAUSE,st,score:g.score,opts:g.opts});
    this.changed(g);
  }

  // ---------- старт и места ----------
  startGame(g){
    const ids=Object.keys(g.slots),o=g.opts;
    if(o.mode!=='run'&&o.bots)for(const s of ids)if(g.slots[s].kind==='empty')this.makeBot(g,s);
    const n=ids.filter(s=>g.slots[s].kind==='human'||g.slots[s].kind==='bot').length;
    if(n<(o.mode==='run'?1:2))return false;
    g.started=true;g.round=0;
    g.score={};for(const s of ids)g.score[s]={wins:0};
    this.sendSlots(g);
    this.newRound(g);
    return true;
  }
  // игрок ушёл насовсем
  releaseSlot(g,sid){
    const sl=g.slots[sid];
    cancelTasks(sl);
    sl.token=null;sl.ws=null;sl.online=false;sl.away=false;
    const d=g.A&&g.A.byId.get(slotIdx(sid)+1);
    if(!g.started){sl.kind='empty';sl.name=''}
    else if(g.opts.bots&&g.opts.mode!=='run'){
      this.makeBot(g,sid);
      if(d){d.name=sl.name;d.skin=sl.loadout.skin;g.A.setControl(d,'ai');d.kind='bot'}
    }else{
      sl.kind='gone';
      if(d)g.A.removeDrone(d);
    }
  }
  afterLeave(g){
    if(gameDead(g)){this.closeGame(g);return}
    this.sendSlots(g);
  }
  closeGame(g){
    this.stopLoop(g);
    for(const sl of Object.values(g.slots))cancelTasks(sl);
    if(this.games[g.id]!==g)return;
    delete this.games[g.id];
    this.log(`[-] Игра ${g.id} закрыта`);
    if(this.onClosed)this.onClosed(g.id);
  }
  awayTimer(g,sid,token){
    const sl=g.slots[sid];
    const giveUp=()=>{
      if(sl.token===token&&!sl.online){
        this.log(`[-] Игрок ${sid} не вернулся в игру ${g.id}`);
        this.releaseSlot(g,sid);
        this.afterLeave(g);
        this.changed(g);
      }
    };
    if(g.started){
      sl.tasks.push(setTimeout(()=>{
        if(sl.token===token&&!sl.online&&sl.kind==='human'){
          // за отошедшего пока летит бот; вернётся — получит управление обратно
          sl.away=true;
          const d=g.A&&g.A.byId.get(slotIdx(sid)+1);
          if(d)g.A.setControl(d,'ai');
          this.sendSlots(g);this.changed(g);
        }
        sl.tasks.push(setTimeout(giveUp,(RECONNECT_GRACE-BOT_DELAY)*1000));
      },BOT_DELAY*1000));
    }else sl.tasks.push(setTimeout(giveUp,RECONNECT_GRACE*1000));
  }

  // ---------- сообщения ----------
  _message(c,data){
    if(!data||typeof data!=='object')return;
    const ws=c.conn,action=data.action;
    let g=c.g,me=c.me;

    if(action==='ping'){
      this.send(ws,{type:'pong',n:data.n});
    }else if(action==='create_game'){
      if(data.v!=null&&data.v!==PROTO){this.send(ws,{type:'error',message:'Версия игры не совпадает — обновите страницу'});return}
      // в P2P код игры выбирает хост (от него зависит адрес для подключения)
      let gid=String(data.game_id||'').toUpperCase();
      if(!/^[A-Z0-9]{6}$/.test(gid)||this.games[gid])gid=SW.randomGameId();
      while(this.games[gid])gid=SW.randomGameId();
      const o=cleanOpts(data.opts);
      g={id:gid,opts:o,slots:{},started:false,score:{},round:0,A:null};
      for(const s of slotIds(o.size))g.slots[s]=newSlot();
      me='P0';
      const sl=g.slots[me];
      Object.assign(sl,{kind:'human',ws,token:SW.newToken(),name:cleanName(data.name)||'Пилот',online:true,loadout:cleanLoadout(data.loadout)});
      this.games[gid]=g;
      c.g=g;c.me=me;
      this.send(ws,{type:'joined',game_id:gid,slot:me,token:sl.token});
      this.log(`[+] Игра ${gid} создана (${o.mode}, мест: ${o.size})`);
      if(o.solo){if(!this.startGame(g))this.sendSlots(g)}
      else this.sendSlots(g);
    }else if(action==='join_game'){
      if(data.v!=null&&data.v!==PROTO){this.send(ws,{type:'error',message:'Версия игры не совпадает — обновите страницу'});return}
      const gid=String(data.game_id||'').toUpperCase();
      const gg=this.games[gid];
      const sid=gg&&!gg.opts.solo?freeSlotForJoin(gg):null;
      if(!sid){this.send(ws,{type:'error',message:gg?'В игре нет свободных мест':'Игра не найдена'});return}
      g=gg;me=sid;c.g=g;c.me=me;
      const sl=g.slots[me];
      cancelTasks(sl);
      const n=Object.values(g.slots).filter(s=>s.token).length+1;
      const botTeam=sl.team;
      Object.assign(sl,{kind:'human',ws,token:SW.newToken(),name:uniqueName(g,cleanName(data.name)||`Пилот ${n}`,me),online:true,away:false,loadout:cleanLoadout(data.loadout)});
      if(g.opts.mode==='team'&&g.started)sl.team=botTeam; // место бота уже было на чьей-то стороне
      if(g.score&&!g.score[me])g.score[me]={wins:0};
      this.send(ws,{type:'joined',game_id:gid,slot:me,token:sl.token});
      this.log(`[+] Игрок вошёл в ${gid} на место ${me}`);
      if(g.started&&g.A){
        // вместо бота (или в пустое место) добавляем дрон нового игрока и вводим в бой
        const old=g.A.byId.get(slotIdx(me)+1);
        if(old)g.A.removeDrone(old);
        const d=this.addDroneFor(g,me);
        g.A.respawn(d);
        this.send(ws,this.roundMsg(g,me));
        this.sendSlots(g);
      }else if(allHumans(g)&&!g.opts.bots){
        this.startGame(g);
      }else this.sendSlots(g);
    }else if(action==='resume'){
      const gid=String(data.game_id||'').toUpperCase();
      const sid=data.slot;
      const gg=this.games[gid];
      if(!gg||!(sid in gg.slots)||gg.slots[sid].token===null||gg.slots[sid].token!==data.token){
        this.send(ws,{type:'resume_failed'});
        return;
      }
      g=gg;me=sid;c.g=g;c.me=me;
      const sl=g.slots[me];
      const old=sl.ws;
      cancelTasks(sl);
      Object.assign(sl,{ws,online:true,kind:'human',away:false});
      if(data.loadout)sl.loadout=cleanLoadout(data.loadout);
      if(old&&old!==ws){try{old.close()}catch(e){}}
      const d=g.A&&g.A.byId.get(slotIdx(me)+1);
      if(d&&g.started){g.A.setControl(d,'human');d.kind='human'}
      this.send(ws,this.fullState(g,me));
      if(g.started&&g.A){this.send(ws,this.roundMsg(g,me))}
      this.sendSlots(g);
      this.log(`[~] Игрок ${me} вернулся в игру ${gid}`);
    }else if(!g){
      return;
    }else if(action==='in'){
      // ввод пилота: стик, тяга, огонь и счётчики нажатий; ack — номер шага ввода (для предсказания)
      const sl=g.slots[me];
      if(sl.ws!==ws||!g.A)return;
      const d=g.A.byId.get(slotIdx(me)+1);
      if(d&&d.ctl==='human')g.A.setInput(d,data);
      return; // часто — без сохранения
    }else if(action==='start_game'){
      if(!g.started&&leader(g)===me){
        if(g.opts.mode==='team'&&!g.opts.bots&&humans(g).every(s=>g.slots[s].team===g.slots[humans(g)[0]].team)){this.send(ws,{type:'error',message:'Для командной игры нужны две команды — или включите ботов'});return}
        if(!this.startGame(g))this.send(ws,{type:'error',message:'Нужно хотя бы два пилота — позовите друга или включите ботов'});
      }
    }else if(action==='set_opts'){
      if(!g.started&&leader(g)===me){
        const o=cleanOpts(data.opts,g.opts);
        if(o.solo!==g.opts.solo)o.solo=g.opts.solo;
        // число мест: нельзя убрать занятые
        const want=slotIds(o.size);
        for(const s of Object.keys(g.slots))if(!want.includes(s)&&g.slots[s].kind==='human')o.size=Math.max(o.size,slotIdx(s)+1);
        g.opts=cleanOpts(o);
        const ids=slotIds(g.opts.size);
        for(const s of ids)if(!g.slots[s])g.slots[s]=newSlot();
        for(const s of Object.keys(g.slots))if(!ids.includes(s)&&g.slots[s].kind!=='human')delete g.slots[s];
        this.sendSlots(g);
      }
    }else if(action==='loadout'){
      const sl=g.slots[me];
      sl.loadout=cleanLoadout(data.loadout);
      if(data.name)sl.name=cleanName(data.name)||sl.name;
      if(!g.started)this.sendSlots(g);
    }else if(action==='team'){
      const sl=g.slots[me];
      if(!g.started&&g.opts.mode==='team'){sl.team=toInt(data.team)===1?1:0;this.sendSlots(g)}
    }else if(action==='restart'){
      // новый раунд: «Ещё раз» после итогов или выбор следующей миссии
      if(g.started&&g.A&&leader(g)===me&&g.A.phase==='end'){
        if(g.opts.mode==='run'&&isNum(data.mission))g.opts=cleanOpts({mission:data.mission},g.opts);
        this.newRound(g);
      }
    }else if(action==='to_lobby'){
      if(g.started&&leader(g)===me&&!g.opts.solo){
        this.stopLoop(g);g.A=null;g.started=false;
        for(const s of Object.keys(g.slots)){const sl=g.slots[s];if(sl.kind==='bot'&&!sl.token){sl.kind='empty';sl.name=''}else if(sl.kind==='gone'){sl.kind='empty';sl.name=''}}
        this.sendSlots(g);
      }
    }else if(action==='pause'){
      if(g.opts.solo&&g.A){g.paused=!!data.on}
    }else if(action==='emote'){
      // быстрая реплика в эфир; не чаще раза в секунду
      const now=Date.now(),e=toInt(data.e);
      if(g.started&&g.A&&now-c.emoteAt>1000&&e>=0&&e<16){
        c.emoteAt=now;
        g.A.ev('rad',slotIdx(me)+1,e);
      }
    }else if(action==='leave'){
      if(g.slots[me].ws===ws){
        this.releaseSlot(g,me);
        this.afterLeave(g);
      }
      this.changed(g);
      c.g=null;c.me=null;
      return;
    }
    if(c.g)this.changed(c.g);
  }

  _closed(c){
    const g=c.g,me=c.me;
    if(!g||!me||!g.slots[me]||g.slots[me].ws!==c.conn)return;
    const sl=g.slots[me];
    sl.ws=null;sl.online=false;
    this.awayTimer(g,me,sl.token);
    this.sendSlots(g);
    this.changed(g);
  }

  // ---------- для хоста ----------
  // Хост закрывает игру: всем сообщаем и рвём соединения
  shutdown(gid){
    const g=this.games[gid];
    if(!g)return;
    for(const sl of Object.values(g.slots)){
      if(sl.ws){const ws=sl.ws;sl.ws=null;this.send(ws,{type:'game_closed'});try{ws.close()}catch(e){}}
    }
    this.closeGame(g);
  }
  // Снимок игры без соединений, таймеров и арены — чтобы пережить перезагрузку вкладки хоста
  snapshot(gid){
    const g=this.games[gid];
    if(!g)return null;
    const slots={};
    for(const s in g.slots){const sl=g.slots[s];slots[s]={kind:sl.kind,token:sl.token,name:sl.name,loadout:sl.loadout,team:sl.team}}
    return JSON.parse(JSON.stringify({id:g.id,opts:g.opts,slots,started:g.started,score:g.score,round:g.round}));
  }
  restore(snap){
    const g=JSON.parse(JSON.stringify(snap));
    for(const s in g.slots)Object.assign(g.slots[s],{ws:null,online:false,tasks:[],away:false});
    g.A=null;this.games[g.id]=g;
    // раунд после перезагрузки начинается заново
    if(g.started){g.round=Math.max(0,(g.round||1)-1);this.newRound(g)}
    for(const s in g.slots){const sl=g.slots[s];if(sl.token)this.awayTimer(g,s,sl.token)}
    return g;
  }
}

SwiftHub.randomGameId=SW.randomGameId;
SwiftHub.cleanOpts=cleanOpts;
SwiftHub.cleanLoadout=cleanLoadout;
SW.Hub=SwiftHub;
if(typeof module!=='undefined'&&module.exports)module.exports=SwiftHub;
})(typeof window!=='undefined'?window:globalThis);
