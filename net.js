// «Стрижи» — связь: P2P (WebRTC через PeerJS), запасной канал MQTT, пересылка server.py; сессия, переподключение, хост.
// Транспортная часть (loop/relay/peer/mqtt/hybrid) и устройство хоста перенесены из «Фей» и «Ножей» — проверены на iPhone,
// мобильном интернете и VPN. Здесь они отвязаны от страницы: всё, что видно игроку, идёт через колбэки NET.cb.
//
// Два способа связи, протокол сообщений у них один и тот же:
//  'p2p' — комната (room.js) работает в браузере создателя, остальные подключаются к нему через WebRTC (PeerJS);
//          если прямой канал за несколько секунд не открылся, гость сам переходит на запасной (MQTT через публичные серверы);
//  'ws'  — комната тоже у создателя, а server.py на компьютере только пересылает сообщения (игра по Wi-Fi без интернета).
// Игра с ботами — та же комната, только без сети («петля» в памяти).
(function(root){
'use strict';
const SW=root.SW;
const CFG={
  peerPrefix:'strizhi-',mqttBase:'strizhi/v1/',ls:'strizhi_',site:'https://3forwork11235.github.io/swifts/',app:/SwiftsApp\//,port:8768,info:'strizhi-server.json',
};
const IN_APP=CFG.app.test(navigator.userAgent);
const SERVED=/^https?:$/.test(location.protocol);
const AUTO_WS=SERVED?(location.protocol==='https:'?'wss://':'ws://')+location.host:null;
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function lsDel(k){try{localStorage.removeItem(k)}catch(e){}}

const NET={conn:null,via:'p2p',host:false,solo:false,slot:null,gameId:null,token:null,lan:[],retry:0,rtimer:null,pingAt:0,pongAt:0,
  slots:{},leader:null,opts:{},started:false,err:null,createSeq:0,rtt:80,pingN:0,pings:{},route:'',diag:null,
  cb:{status(){},msg(){},lost(){},hostTries(){},closed(){},name:()=>'Пилот',loadout:()=>({}),opts:()=>({}),paused(){return false}}};
let PY_SERVER=false;   // страницу отдал server.py — к нему подключаемся автоматически
let LINK_VIA=false;    // способ связи задала ссылка-приглашение — не меняем его
let serverIp=lsGet(CFG.ls+'server_ip')||'127.0.0.1:'+CFG.port;
NET.CFG=CFG;NET.IN_APP=IN_APP;NET.SERVED=SERVED;
NET.wsUrl=function(){if(PY_SERVER)return AUTO_WS;return /^wss?:\/\//i.test(serverIp)?serverIp:'ws://'+serverIp};
NET.setServerIp=v=>{serverIp=v;lsSet(CFG.ls+'server_ip',v)};
NET.getServerIp=()=>serverIp;
NET.pyServer=()=>PY_SERVER;
NET.setVia=function(v,manual){
  NET.via=v==='ws'?'ws':'p2p';
  if(manual)lsSet(CFG.ls+'via',NET.via);
};
NET.setVia(lsGet(CFG.ls+'via')||'p2p');
// Страницу мог отдать server.py — тогда по умолчанию играем через него
NET.detectServer=function(done){
  if(!SERVED)return;
  fetch(CFG.info,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(info=>{
    if(!info||!info.strizhi)return;
    PY_SERVER=true;NET.lan=info.lan||NET.lan;
    if(!NET.conn&&!NET.token&&!LINK_VIA)NET.setVia(lsGet(CFG.ls+'via')||'ws');
    if(done)done();
  }).catch(()=>{});
};
function status(t){NET.cb.status(t)}
function netOnline(){return !!(NET.conn&&NET.conn.readyState===1)}
function netSend(o){if(netOnline()){try{NET.conn.send(o);return true}catch(e){}}return false}
NET.online=netOnline;NET.send=netSend;
function netClose(){
  NET.createSeq++;
  if(NET.conn){const c=NET.conn;NET.conn=null;c.close()}
  hostStop();releaseWake();
}
NET.close=netClose;

// --- транспорты: readyState (0 — соединяемся, 1 — открыто, 3 — закрыто), send(obj), close()
// и колбэки onopen/onmessage/onclose. close() сам onclose не вызывает.
function transport(){return{readyState:0,err:null,onopen:null,onmessage:null,onclose:null,send(){},close(){this.readyState=3}}}
function tOpen(t){if(t.readyState!==0)return;t.readyState=1;if(t.onopen)t.onopen()}
function tLost(t,err){if(t.readyState===3)return;t.readyState=3;if(err)t.err=err;if(t.onclose)t.onclose()}
function tData(t,raw){if(t.readyState!==1||!t.onmessage)return;let m;try{m=typeof raw==='string'?JSON.parse(raw):raw}catch(e){return}t.onmessage(m)}

// Гость через server.py: просим переслать нас к хосту игры gid, дальше сообщения идут как есть
function relayTransport(url,gid){
  const t=transport();
  let ws;
  try{ws=new WebSocket(url)}catch(e){t.readyState=3;t.err='bad-url';return t}
  ws.onopen=()=>{ws.send(JSON.stringify({action:'relay_join',game_id:gid}));tOpen(t)};
  ws.onmessage=e=>{
    let m;try{m=JSON.parse(e.data)}catch(_){return}
    if(m&&m.type==='relay_nohost'){t.err='peer-unavailable';return} // хоста нет — сервер сейчас отключит
    tData(t,m);
  };
  ws.onclose=()=>tLost(t,t.err);
  t.send=o=>ws.send(JSON.stringify(o));
  t.close=()=>{t.readyState=3;try{ws.close(1000)}catch(e){}};
  return t;
}
// Создатель игры подключается к своей же комнате без сети. Через JSON — чтобы комната и игра не делили объекты
function loopTransport(){
  const t=transport(),later=f=>setTimeout(f,0);
  const sess=HOST.hub.connect({
    send:o=>{const s=JSON.stringify(o);later(()=>tData(t,s))},
    close:()=>later(()=>{tLost(t);sess.closed()}),
  });
  t.send=o=>{const s=JSON.stringify(o);later(()=>{if(t.readyState===1)sess.message(JSON.parse(s))})};
  t.close=()=>{if(t.readyState===3)return;t.readyState=3;later(()=>sess.closed())};
  later(()=>tOpen(t));
  return t;
}

// --- PeerJS: знакомит браузеры через свой бесплатный сервер, дальше связь идёт напрямую (WebRTC) ---
// Свой сервер знакомств можно задать так: localStorage.strizhi_peer='{"host":"…","port":443,"path":"/","secure":true}'
const PEERJS_URLS=[...(IN_APP?['vendor/peerjs.min.js']:['vendor/peerjs.min.js']),'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js','https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'];
let peerLib=null;
function loadLib(urls,test,cacheKey){
  if(test())return Promise.resolve();
  if(LIBS[cacheKey])return LIBS[cacheKey];
  LIBS[cacheKey]=new Promise((res,rej)=>{
    const next=i=>{
      if(i>=urls.length){LIBS[cacheKey]=null;rej('no-lib');return}
      const s=document.createElement('script');s.src=urls[i];s.crossOrigin='anonymous';
      s.onload=()=>test()?res():next(i+1);
      s.onerror=()=>{s.remove();next(i+1)};
      document.head.append(s);
    };
    next(0);
  });
  return LIBS[cacheKey];
}
const LIBS={};
const loadPeerJs=()=>loadLib(PEERJS_URLS,()=>!!root.Peer,'peer');
// --- серверы для поиска маршрута между устройствами (ICE) ---
// STUN подсказывает устройству его внешний адрес. TURN — ретранслятор на случай, когда напрямую нельзя (мобильный интернет, CGNAT).
// Ключ Metered (бесплатный тариф) — тот же, что у «Лучника», «Ножей» и «Фей»; в открытом коде это нормально для TURN.
const STUN_SERVERS=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']},{urls:'stun:stun.cloudflare.com:3478'}];
const TURN_USER='0eea1dbe53ebb64348d2e282',TURN_PASS='IpRgNw5q7HDm5nlk';
const TURN_SERVERS=[
  'turn:global.relay.metered.ca:80',
  'turn:global.relay.metered.ca:80?transport=tcp',
  'turn:global.relay.metered.ca:443',
  'turns:global.relay.metered.ca:443?transport=tcp', // через TLS на 443 — пройдёт даже там, где режут всё, кроме HTTPS
].map(urls=>({urls,username:TURN_USER,credential:TURN_PASS}));
function iceServers(){
  try{const o=JSON.parse(lsGet(CFG.ls+'ice')||'null');if(Array.isArray(o))return Promise.resolve(STUN_SERVERS.concat(o))}catch(e){}
  return Promise.resolve(STUN_SERVERS.concat(TURN_SERVERS));
}
function peerOpts(ice){
  let o=null;try{o=JSON.parse(lsGet(CFG.ls+'peer')||'null')}catch(e){}
  const config={iceServers:ice};
  if(lsGet(CFG.ls+'relay')==='1')config.iceTransportPolicy='relay'; // проверка ретранслятора
  return Object.assign({debug:1,config},o||{});
}
function iceErr(dc){const pc=dc&&dc.peerConnection,s=pc&&pc.iceConnectionState;return s==='failed'||s==='disconnected'||s==='checking'?'ice-'+s:null}
function connDiag(dc,types){
  const pc=dc&&dc.peerConnection;
  return {answered:!!(pc&&pc.remoteDescription),ice:pc?pc.iceConnectionState:'-',types:Array.from(types)};
}
function peerTransport(gid){
  const t=transport();
  let peer=null,dc=null;
  const types=new Set();
  const fail=err=>{t.diag=connDiag(dc,types);if(peer){try{peer.destroy()}catch(e){}}tLost(t,err)};
  Promise.all([loadPeerJs(),iceServers()]).then(([,ice])=>{
    if(t.readyState===3)return;
    peer=new root.Peer(peerOpts(ice));
    peer.on('error',e=>{if(t.readyState===0)fail(iceErr(dc)||(e&&e.type)||'error')}); // после соединения ошибки сервера знакомств не страшны
    peer.on('open',()=>{
      if(t.readyState===3)return;
      dc=peer.connect(CFG.peerPrefix+gid,{reliable:true});
      const pc=dc.peerConnection;
      if(pc){
        pc.addEventListener('icecandidate',e=>{if(e.candidate&&e.candidate.type)types.add(e.candidate.type)});
        pc.addEventListener('iceconnectionstatechange',()=>{if(t.readyState===0&&t.onstage)t.onstage(pc.iceConnectionState)});
      }
      if(t.onstage)t.onstage('offer');
      dc.on('open',()=>tOpen(t));
      dc.on('data',d=>tData(t,d));
      dc.on('close',()=>fail(iceErr(dc)||'closed'));
      dc.on('error',e=>fail(iceErr(dc)||(e&&e.type)||'dc-error'));
      t.send=o=>dc.send(JSON.stringify(o));
    });
  },fail);
  // Так и не соединились — сдаёмся с понятной причиной. Но если путь уже найден, соединение просто медленное: ждём до минуты.
  const started=Date.now();
  t.progressing=()=>{const pc=dc&&dc.peerConnection,st=pc&&pc.iceConnectionState;return !!(pc&&pc.remoteDescription&&/checking|connected|completed/.test(st||''))};
  const check=()=>{
    if(t.readyState!==0)return;
    if(t.progressing()&&Date.now()-started<60000){setTimeout(check,3000);return}
    const pc=dc&&dc.peerConnection;
    fail(!dc?(peer&&peer.open?'timeout':'no-signal'):pc&&!pc.remoteDescription?'no-answer':iceErr(dc)||'timeout');
  };
  setTimeout(check,20000);
  t.close=()=>{t.readyState=3;if(peer){try{peer.destroy()}catch(e){}}};
  return t;
}

// --- Запасной канал: публичный сервер сообщений (MQTT поверх обычного защищённого WebSocket) ---
// Бывает, что путь между устройствами WebRTC находит, а сам канал не открывается: оператор, VPN или фильтр
// провайдера режут зашифрованный поток WebRTC. Тогда гость через несколько секунд сам переходит на этот канал.
// Создатель игры слушает оба пути сразу. Темы: <база>/h — создателю, <база>/g/<cid> — конкретному гостю.
const MQTT_URLS=[...(IN_APP?['vendor/mqtt.min.js']:['vendor/mqtt.min.js']),'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js','https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js'];
const MQ_BROKERS=['wss://broker.emqx.io:8084/mqtt','wss://broker.hivemq.com:8884/mqtt','wss://test.mosquitto.org:8081/mqtt'];
const MQ_SWITCH=6000; // через сколько мс без открытого канала P2P гость пробует запасной
const loadMqtt=()=>loadLib(MQTT_URLS,()=>!!root.mqtt,'mqtt');
function mqTopic(gid){return CFG.mqttBase+gid}
function mqParse(buf){try{return JSON.parse(buf.toString())}catch(e){return null}}
// Гость: стучимся к создателю через все серверы сразу — работаем через тот, где он ответил первым
function mqttTransport(gid){
  const t=transport();t.kind='mq';
  const cid=Math.random().toString(36).slice(2,12),base=mqTopic(gid),hello=JSON.stringify({c:cid,t:'o'}),bye=JSON.stringify({c:cid,t:'x'});
  let c=null,tries=[],okT=null;
  const drop=cl=>{try{cl.publish(base+'/h',bye);cl.end(false)}catch(e){}};
  const fail=err=>{
    clearInterval(t.ka);clearTimeout(okT);
    for(const cl of tries)try{cl.end(true)}catch(e){}
    tries=[];const old=c;c=null;if(old)try{old.end(true)}catch(e){}
    tLost(t,err);
  };
  const lost=()=>{if(!c&&t.readyState===0&&tries.every(cl=>cl.__dead))fail(t.lastErr||'mq-fail')};
  const start=()=>{
    if(t.readyState===3)return;
    for(const url of MQ_BROKERS){
      const cl=root.mqtt.connect(url,{reconnectPeriod:0,connectTimeout:6000,clean:true,keepalive:20,will:{topic:base+'/h',payload:bye,qos:0}});
      tries.push(cl);
      cl.on('connect',()=>cl.subscribe(base+'/g/'+cid,{qos:0},()=>cl.publish(base+'/h',hello)));
      cl.on('message',(tp,buf)=>{
        const m=mqParse(buf);if(!m)return;
        if(!c){
          if(m.t!=='ok'||t.readyState!==0)return;
          // победитель — этот сервер; с остальных уходим
          c=cl;clearTimeout(okT);
          for(const o of tries)if(o!==cl)drop(o);
          tries=[cl];
          t.ka=setInterval(()=>{if(c===cl)cl.publish(base+'/h',JSON.stringify({c:cid,t:'k'}))},4000); // «я здесь» каждые 4 с
          tOpen(t);
          return;
        }
        if(c!==cl)return;
        if(m.t==='m'){if(t.readyState===1&&t.onmessage)t.onmessage(m.d)}
        else if(m.t==='x')fail('closed');
      });
      cl.on('error',()=>{t.lastErr='mq-error'});
      cl.on('close',()=>{cl.__dead=true;if(c===cl)fail('closed');else lost()});
    }
    okT=setTimeout(()=>{if(!c)fail('no-answer')},9000); // ни на одном сервере создатель не ответил
  };
  loadMqtt().then(start,()=>fail('no-lib'));
  t.send=o=>{if(c&&t.readyState===1)c.publish(base+'/h',JSON.stringify({c:cid,t:'m',d:o}))};
  t.close=()=>{
    if(t.readyState===3)return;t.readyState=3;
    clearInterval(t.ka);clearTimeout(okT);
    for(const cl of tries)drop(cl);
    tries=[];c=null;
  };
  return t;
}
// Гость в режиме P2P: сначала напрямую, а если канал не открылся — через запасной. Кто откроется первым, тот и работает.
function hybridTransport(gid){
  const t=transport();
  let chosen=null,m=null;
  const p=peerTransport(gid);
  p.onstage=st=>{if(!chosen&&t.onstage)t.onstage(st)};
  const choose=x=>{
    if(chosen||t.readyState!==0){x.close();return}
    chosen=x;t.kind=x.kind||'p2p';
    if(x!==p)p.close();
    if(m&&x!==m)m.close();
    x.onmessage=msg=>{if(t.readyState===1&&t.onmessage)t.onmessage(msg)};
    x.onclose=()=>tLost(t,x.err);
    t.send=o=>x.send(o);
    tOpen(t);
  };
  const lostBoth=()=>{
    if(chosen||t.readyState===3)return;
    if(p.readyState===3&&(!m||m.readyState===3)){
      t.diag=p.diag;
      tLost(t,m&&m.err==='no-answer'&&p.err!=='peer-unavailable'?'no-answer':p.err||(m&&m.err));
    }
  };
  const startMq=()=>{
    if(m||chosen||t.readyState===3)return;
    if(t.onstage)t.onstage('backup');
    m=mqttTransport(gid);
    m.onopen=()=>choose(m);
    m.onclose=lostBoth;
  };
  p.onopen=()=>choose(p);
  p.onclose=()=>{if(!chosen){startMq();lostBoth()}};
  const timer=setTimeout(startMq,MQ_SWITCH);
  t.progressing=()=>!chosen&&((p.readyState===0&&!!p.progressing&&p.progressing())||(!!m&&m.readyState===0));
  t.close=()=>{t.readyState=3;clearTimeout(timer);p.close();if(m)m.close()};
  return t;
}
// Создатель игры: слушает запасной канал на всех серверах сразу (гость приходит туда, где получилось)
function mqttListen(gid){
  const base=mqTopic(gid);
  const L={clients:[],guests:new Map(),dead:false,
    destroy(){
      L.dead=true;clearInterval(L.iv);
      for(const g of L.guests.values())g.sess.closed();
      L.guests.clear();
      for(const c of L.clients)try{c.end(true)}catch(e){}
    }};
  loadMqtt().then(()=>{
    if(L.dead)return;
    MQ_BROKERS.forEach((url,bi)=>{
      const c=root.mqtt.connect(url,{reconnectPeriod:3000,connectTimeout:8000,clean:true,keepalive:20});
      L.clients.push(c);
      c.on('connect',()=>c.subscribe(base+'/h',{qos:0}));
      c.on('error',()=>{}); // недоступный сервер — не страшно, есть другие
      c.on('message',(tp,buf)=>{
        const m=mqParse(buf);
        if(!m||typeof m.c!=='string'||m.c.length>24||!HOST.hub)return;
        const key=bi+':'+m.c,out=base+'/g/'+m.c;
        let g=L.guests.get(key);
        if(m.t==='o'){
          if(g){L.guests.delete(key);g.sess.closed()}
          g={seen:Date.now(),counted:false};
          g.sess=HOST.hub.connect({
            send:o=>c.publish(out,JSON.stringify({t:'m',d:o})),
            close:()=>setTimeout(()=>{c.publish(out,JSON.stringify({t:'x'}));if(L.guests.get(key)===g)L.guests.delete(key)},300),
          });
          L.guests.set(key,g);
          c.publish(out,JSON.stringify({t:'ok'}));
        }else if(!g){
          if(m.t==='m'||m.t==='k')c.publish(out,JSON.stringify({t:'x'})); // этого гостя мы уже отключили — пусть переподключится сразу
          return;
        }
        else if(m.t==='k')g.seen=Date.now();
        else if(m.t==='m'){
          g.seen=Date.now();
          if(!g.counted){g.counted=true;HOST.tries.push({ice:'backup',open:true,mq:true});if(HOST.tries.length>6)HOST.tries.shift();NET.cb.hostTries()}
          g.sess.message(m.d);
        }
        else if(m.t==='x'){L.guests.delete(key);g.sess.closed()}
      });
    });
  },()=>{});
  // гость молчит дольше 15 с (свернул браузер, пропала сеть) — считаем, что отошёл
  L.iv=setInterval(()=>{const now=Date.now();for(const [k,g] of L.guests)if(now-g.seen>15000){L.guests.delete(k);g.sess.closed()}},3000);
  return L;
}

// --- хост: комната (room.js) живёт в браузере создателя игры ---
const HOST_KEY=CFG.ls+'host';
const HOST={listener:null,hub:null,gid:null,saveT:null,tries:[],mq:null};
NET.HOST=HOST;
// Таймер симуляции из Web Worker: в фоновой вкладке обычный setInterval замедляется до раза в секунду
function workerEvery(fn,ms){
  try{
    const url=URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`],{type:'text/javascript'}));
    const w=new Worker(url);URL.revokeObjectURL(url);
    w.onmessage=()=>fn();
    return()=>w.terminate();
  }catch(e){const h=setInterval(fn,ms);return()=>clearInterval(h)}
}
function hostListen(gid){return NET.via==='ws'?relayListen(gid):peerListen(gid)}
function peerListen(gid){
  return Promise.all([loadPeerJs(),iceServers()]).then(([,ice])=>new Promise((res,rej)=>{
    const peer=new root.Peer(CFG.peerPrefix+gid,peerOpts(ice));
    const L={peer,destroy(){try{peer.destroy()}catch(e){}}};
    let opened=false;
    peer.on('open',()=>{opened=true;res(L)});
    peer.on('error',e=>{if(!opened){L.destroy();rej(e&&e.type||'error')}});
    // пропала связь с сервером знакомств — играющие гости не заметят, но новые не подключатся: возвращаемся
    peer.on('disconnected',()=>setTimeout(()=>{if(HOST.listener===L&&!peer.destroyed&&peer.disconnected)try{peer.reconnect()}catch(e){}},2000));
    peer.on('connection',hostAccept);
  }));
}
// Хост через server.py: сервер пересылает сообщения гостей, помечая их номером связи (cid)
function relayListen(gid){
  return new Promise((res,rej)=>{
    let ws;try{ws=new WebSocket(NET.wsUrl())}catch(e){rej('bad-url');return}
    const guests=new Map(); // cid -> сессия гостя в комнате
    const L={destroyed:false,destroy(){L.destroyed=true;try{ws.close()}catch(e){}}};
    const send=o=>{if(ws.readyState===1)ws.send(JSON.stringify(o))};
    let ok=false;
    ws.onopen=()=>send({action:'relay_host',game_id:gid});
    ws.onmessage=e=>{
      let m;try{m=JSON.parse(e.data)}catch(_){return}
      if(m.type==='relay_ok'){ok=true;res(L)}
      else if(m.type==='relay_taken'){rej('unavailable-id');L.destroy()}
      else if(m.type==='relay_open'&&HOST.hub){
        const cid=m.cid;
        guests.set(cid,HOST.hub.connect({
          send:o=>send({action:'relay_send',cid,data:o}),
          close:()=>setTimeout(()=>send({action:'relay_close',cid}),300),
        }));
      }else if(m.type==='relay_msg'){const s=guests.get(m.cid);if(s)s.message(m.data)}
      else if(m.type==='relay_close'){const s=guests.get(m.cid);if(s){guests.delete(m.cid);s.closed()}}
    };
    ws.onclose=()=>{
      for(const s of guests.values())s.closed();
      guests.clear();
      if(!ok){rej('server');return}
      if(!L.destroyed&&HOST.listener===L)setTimeout(()=>relayRelisten(L,gid),2000); // связь с сервером пропала — регистрируемся снова
    };
  });
}
function relayRelisten(old,gid){
  if(HOST.listener!==old)return;
  relayListen(gid).then(nl=>{if(HOST.listener===old)HOST.listener=nl;else nl.destroy()},
    ()=>setTimeout(()=>relayRelisten(old,gid),3000));
}
function hostAccept(dc){
  if(!HOST.hub){try{dc.close()}catch(e){}return}
  const rec={ice:'new',open:false}; // запоминаем попытку — создатель видит, дошёл ли до него друг и чем кончилось
  HOST.tries.push(rec);if(HOST.tries.length>6)HOST.tries.shift();
  const pc=dc.peerConnection;
  if(pc)pc.addEventListener('iceconnectionstatechange',()=>{rec.ice=pc.iceConnectionState;NET.cb.hostTries()});
  dc.on('open',()=>{rec.open=true;NET.cb.hostTries()});
  NET.cb.hostTries();
  const hub=HOST.hub;
  let sess=null;
  const conn={
    send:o=>{if(dc.open)dc.send(JSON.stringify(o))},
    close:()=>setTimeout(()=>{try{dc.close()}catch(e){}},300),
  };
  dc.on('open',()=>{sess=hub.connect(conn)});
  dc.on('data',d=>{if(!sess)return;let m;try{m=typeof d==='string'?JSON.parse(d):d}catch(e){return}sess.message(m)});
  const gone=()=>{if(sess){const s=sess;sess=null;s.closed()}};
  dc.on('close',gone);dc.on('error',gone);
}
function hostSetup(listener,gid,snap){
  HOST.listener=listener;HOST.gid=gid;HOST.tries=[];
  if(listener&&listener.peer)HOST.mq=mqttListen(gid); // P2P: заодно слушаем запасной канал
  HOST.hub=new SW.Hub({
    log:m=>SW.log(m),
    onChange:hostSave,
    onClosed:id=>{if(id!==HOST.gid)return;hostStop();if(NET.host)NET.onMessage({type:'game_closed'})},
    every:workerEvery,
  });
  if(snap)HOST.hub.restore(snap);
}
function hostSave(){
  if(HOST.saveT||NET.solo)return;
  HOST.saveT=setTimeout(()=>{
    HOST.saveT=null;
    const s=HOST.hub&&HOST.hub.snapshot(HOST.gid);
    if(s)lsSet(HOST_KEY,JSON.stringify({ts:Date.now(),game:s}));
  },500);
}
function hostStop(){
  const {listener,hub,gid,saveT,mq}=HOST;
  if(!listener&&!hub)return;
  Object.assign(HOST,{listener:null,hub:null,gid:null,saveT:null,mq:null});
  if(saveT)clearTimeout(saveT);
  if(hub&&gid)hub.shutdown(gid); // гостям уходит «игра закрыта»
  if(hub)for(const id in hub.games)hub.shutdown(id);
  if(listener)setTimeout(()=>listener.destroy(),600);
  if(mq)setTimeout(()=>mq.destroy(),600);
  lsDel(HOST_KEY);
}
function hostCreate(){
  // код игры = адрес хоста (у сервера знакомств или у server.py); если такой занят — берём другой
  let tries=0;
  const attempt=()=>{
    const gid=SW.randomGameId();
    return hostListen(gid).then(listener=>({listener,gid}),err=>{if(err==='unavailable-id'&&++tries<5)return attempt();throw err});
  };
  return attempt();
}
function hostRestore(gid){
  let saved=null;try{saved=JSON.parse(lsGet(HOST_KEY)||'null')}catch(e){}
  if(!saved||!saved.game||saved.game.id!==gid||Date.now()-saved.ts>10*60e3)return Promise.reject('no-snapshot');
  let tries=0; // старый адрес хоста может ещё несколько секунд числиться занятым
  const attempt=()=>hostListen(gid).catch(err=>{
    if(err==='unavailable-id'&&++tries<10)return new Promise(r=>setTimeout(r,2500)).then(attempt);
    throw err;
  });
  return attempt().then(listener=>({listener,game:saved.game}));
}
NET.hostErrText=function(err){
  if(NET.via==='ws')return'❌ Нет связи с сервером на компьютере ('+NET.wsUrl()+'). Проверьте, что server.py запущен и устройство в той же сети.';
  if(err==='no-lib')return'❌ Не удалось загрузить модуль связи — нужен интернет.';
  if(err==='browser-incompatible')return'❌ Этот браузер не поддерживает прямое соединение (WebRTC). Попробуйте Chrome или Safari.';
  return'❌ Нет связи с сервером знакомств (PeerJS) — нужен интернет. Без интернета выберите «Через сервер на компьютере». (код: '+err+')';
};
NET.hostTries=()=>HOST.tries;

// Экран не гаснет, пока идёт игра
let wakeLock=null;
function keepAwake(){
  if(wakeLock||document.hidden||!navigator.wakeLock)return;
  wakeLock='pending';
  navigator.wakeLock.request('screen').then(l=>{
    if(wakeLock!=='pending'){l.release().catch(()=>{});return}
    wakeLock=l;l.addEventListener('release',()=>{if(wakeLock===l)wakeLock=null});
  },()=>{if(wakeLock==='pending')wakeLock=null});
}
function releaseWake(){const l=wakeLock;wakeLock=null;if(l&&l!=='pending')l.release().catch(()=>{})}

// --- сессия (чтобы вернуться в игру даже после перезагрузки вкладки) ---
const SESS_KEY=CFG.ls+'session';
function saveSession(){if(NET.solo)return;lsSet(SESS_KEY,JSON.stringify({gid:NET.gameId,slot:NET.slot,token:NET.token,via:NET.via,host:NET.host,ws:NET.via==='ws'?NET.wsUrl():null,ts:Date.now()}))}
function loadSession(){try{const s=JSON.parse(lsGet(SESS_KEY)||'null');return s&&s.slot&&Date.now()-s.ts<6*3600e3?s:null}catch(e){return null}}
function clearSession(){
  NET.token=null;NET.gameId=null;NET.host=false;NET.solo=false;NET.retry=0;NET.slots={};NET.leader=null;NET.started=false;NET.err=null;
  if(NET.rtimer){clearTimeout(NET.rtimer);NET.rtimer=null}
  lsDel(SESS_KEY);
}
NET.clearSession=clearSession;
function makeTransport(gid){
  if(NET.host){
    if(HOST.hub)return loopTransport();
    const t=transport();t.readyState=3;t.err='no-host';return t;
  }
  return NET.via==='ws'?relayTransport(NET.wsUrl(),gid):hybridTransport(gid);
}
function openSocket(first){
  const t=makeTransport(first.game_id||NET.gameId);
  if(t.readyState===3){
    if(t.err==='no-host')NET.onMessage({type:'resume_failed'});else status('❌ Неверный адрес сервера');
    return;
  }
  NET.conn=t;
  const STAGES={backup:'напрямую не открылось, пробуем запасной канал',offer:'ищем создателя игры',checking:'создатель ответил, прокладываем путь',connected:'путь найден, открываем канал',completed:'путь найден, открываем канал',disconnected:'связь прерывается, ждём',failed:'сеть не пропускает'};
  t.onstage=st=>{if(NET.conn===t&&!NET.token&&STAGES[st])status('🔄 Подключение к игре '+(first.game_id||NET.gameId)+': '+STAGES[st]+'…'+(joinTry&&joinTry.n?' (попытка '+(joinTry.n+1)+')':''))};
  t.onopen=()=>{NET.route=t.kind||NET.via;NET.pingAt=NET.pongAt=0;t.send(first);keepAwake()};
  t.onmessage=NET.onMessage;
  t.onclose=()=>{if(NET.conn!==t)return;NET.conn=null;NET.err=t.err;NET.diag=t.diag||null;socketLost()};
}
function lostText(){
  if(NET.err==='peer-unavailable')return'❌ Игра не найдена. Проверьте код — и что создатель игры её не закрыл.';
  if(NET.via==='ws')return'❌ Нет соединения с сервером. Проверьте, что сервер запущен'+(PY_SERVER?' и устройство в той же сети.':' и адрес верный.');
  if(NET.err==='no-lib')return'❌ Не удалось загрузить модуль связи — нужен интернет.';
  const code='\n'+diagLine();
  if(/^ice-|timeout|no-answer/.test(NET.err||''))return'❌ '+whyText()+' Нажмите «В бой!», чтобы попробовать ещё раз.'+code;
  if(/network|server-error|socket|no-signal/.test(NET.err||''))return'❌ Нет связи с сервером знакомств (PeerJS) — проверьте интернет.'+code;
  return'❌ Не удалось соединиться с создателем игры. Нужен интернет; если не помогает — попробуйте другую сеть.'+code;
}
function socketLost(){
  if(NET.token&&NET.gameId){scheduleReconnect();return}
  if(joinRetry())return;
  NET.cb.lost(lostText());
}
function scheduleReconnect(delay){
  if(NET.rtimer||NET.conn||!NET.token)return;
  if(NET.host&&!HOST.hub)return; // комната хоста ещё поднимается из снимка — подключимся, когда будет готова
  if(delay==null)delay=Math.min(5000,300+NET.retry*700);
  NET.rtimer=setTimeout(()=>{
    NET.rtimer=null;
    if(NET.conn||!NET.token||(NET.host&&!HOST.hub))return;
    if(document.hidden)return; // вкладка в фоне — переподключимся, когда вернутся
    if(++NET.retry>80){
      const lost='Нет связи с '+(NET.via==='ws'?'сервером':'создателем игры');
      clearSession();NET.cb.closed(lost);
      return;
    }
    openSocket({action:'resume',game_id:NET.gameId,slot:NET.slot,token:NET.token,loadout:NET.cb.loadout()});
    const t=NET.conn;
    const giveUp=()=>{
      if(NET.conn!==t||!t||t.readyState!==0)return;
      if(t.progressing&&t.progressing()){setTimeout(giveUp,3000);return} // путь найден — соединение дойдёт, ждём
      NET.conn=null;t.close();scheduleReconnect();
    };
    setTimeout(giveUp,NET.via==='ws'?6000:20000);
  },delay);
}
function resumeNow(){
  if(!NET.token||!NET.gameId)return;
  if(NET.conn&&NET.conn.readyState<=1){
    if(NET.conn.readyState===1){ // соединение формально живо — проверяем, что оно не «мёртвое» после сна телефона
      const c=NET.conn,t=Date.now();NET.pingAt=t;netSend({action:'ping'});
      setTimeout(()=>{if(NET.conn===c&&NET.pongAt<t){NET.conn=null;c.close();scheduleReconnect(0)}},2500);
    }
    return;
  }
  if(NET.rtimer){clearTimeout(NET.rtimer);NET.rtimer=null}
  scheduleReconnect(0);
}
// Пинг раз в секунду: меряем задержку и замечаем «мёртвое» соединение
setInterval(()=>{
  const c=NET.conn;
  if(!c||c.readyState!==1||!NET.token||document.hidden)return;
  const now=Date.now();
  if(NET.pingAt>NET.pongAt){
    if(now-NET.pingAt>8000&&!NET.solo){NET.conn=null;c.close();scheduleReconnect(0)}
  }else if(now-NET.pingAt>=1000){
    NET.pingAt=now;const n=++NET.pingN;NET.pings[n]=performance.now();
    netSend({action:'ping',n});
  }
},250);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){if(NET.cb.hidden)NET.cb.hidden()}
  else{resumeNow();hostWake();if(NET.conn)keepAwake()}
});
// Создатель игры вернулся в браузер: связь с сервером знакомств могла оборваться, пока вкладка спала — восстанавливаем сразу
function hostWake(){
  const L=HOST.listener,p=L&&L.peer,gid=HOST.gid;
  if(!p||!gid)return;
  if(p.destroyed){
    let tries=0;
    const again=()=>peerListen(gid).then(nl=>{if(HOST.listener===L)HOST.listener=nl;else nl.destroy()},
      err=>{if(HOST.listener===L&&err==='unavailable-id'&&++tries<10)setTimeout(again,2500)});
    again();
  }else if(p.disconnected){try{p.reconnect()}catch(e){}}
}
addEventListener('pageshow',resumeNow);addEventListener('focus',resumeNow);addEventListener('online',resumeNow);

// ---------- вход в игру ----------
function netConnect(first){
  netClose();clearSession();
  if(NET.via==='ws')status('Подключение к '+NET.wsUrl()+'…');
  else status('Подключение к игре '+first.game_id+'…');
  openSocket(first);
}
NET.create=function(){
  const first={action:'create_game',v:SW.PROTO,name:NET.cb.name(),opts:NET.cb.opts(),loadout:NET.cb.loadout()};
  netClose();clearSession();
  const seq=NET.createSeq;
  status('Создаём игру…');
  hostCreate().then(({listener,gid})=>{
    if(seq!==NET.createSeq){listener.destroy();return} // пока ждали, ушли в другое место
    hostSetup(listener,gid);
    NET.host=true;first.game_id=gid;
    openSocket(first);
  },err=>{if(seq===NET.createSeq)status(NET.hostErrText(err))});
};
NET.startSolo=function(opts){
  netClose();clearSession();
  hostSetup(null,null);
  NET.host=true;NET.solo=true;
  openSocket({action:'create_game',v:SW.PROTO,name:NET.cb.name(),opts:Object.assign(opts||NET.cb.opts(),{solo:true,bots:true}),loadout:NET.cb.loadout()});
};
NET.join=function(id){
  id=String(id||'').trim().toUpperCase();
  if(!/^[A-Z0-9]{6}$/.test(id)){status('Введите код игры из 6 символов');return false}
  const first={action:'join_game',v:SW.PROTO,game_id:id,name:NET.cb.name(),loadout:NET.cb.loadout()};
  netConnect(first);
  joinTry={first,started:Date.now(),n:0,seq:NET.createSeq};
  return true;
};
// Вход по ссылке не сдаётся с первого раза: чаще всего создатель игры просто отошёл — пробуем снова, пока он не вернётся.
let joinTry=null;
const JOIN_WAIT=120e3;
function joinRetry(){
  const j=joinTry;
  if(!j||j.seq!==NET.createSeq||NET.token||NET.conn)return false;
  if(Date.now()-j.started>JOIN_WAIT||!/^ice-|^mq-|timeout|no-answer|negotiation|peer-unavailable|closed|server|socket|network/.test(NET.err||'closed')){joinTry=null;return false}
  j.n++;
  const sec=Math.round((Date.now()-j.started)/1000);
  status('⏳ '+whyText()+' Пробуем ещё… ('+sec+' с, попытка '+j.n+')\n'+diagLine()+(sameDeviceHost(j.first.game_id)?
    '\n⚠️ Похоже, игра создана на этом же устройстве. На телефоне вкладка создателя засыпает, когда открываешь другую, — открой ссылку на другом устройстве.':''));
  setTimeout(()=>{if(joinTry===j&&j.seq===NET.createSeq&&!NET.conn&&!NET.token)openSocket(j.first)},2000);
  return true;
}
function whyText(){
  const e=NET.err||'',d=NET.diag;
  if(e==='peer-unavailable')return'Игра не найдена: создатель её закрыл или его браузер потерял связь с интернетом.';
  if(e==='no-answer')return'Создатель игры не ответил — его браузер свёрнут, «уснул» или потерял интернет.';
  if(/^ice-|timeout/.test(e)&&d&&d.answered)
    return'Создатель ответил, но устройства не смогли проложить путь друг к другу'+(d.types.includes('relay')?'.':' — ретранслятор (TURN) недоступен в этой сети.');
  return'Нет связи с создателем игры.';
}
function diagLine(){
  const d=NET.diag;
  return'🔧 код: '+(NET.err||'closed')+(d?' · ответ: '+(d.answered?'да':'нет')+' · пути: '+(d.types.join(', ')||'нет')+' · ICE: '+d.ice:'');
}
function sameDeviceHost(gid){try{const h=JSON.parse(lsGet(HOST_KEY)||'null');return !!(h&&h.game&&h.game.id===gid&&Date.now()-h.ts<6*3600e3)}catch(e){return false}}

NET.inviteLink=function(){
  if(!SERVED||!NET.gameId)return null;
  let base=IN_APP?CFG.site:location.origin+location.pathname.replace(/index\.html$/,''); // из приложения зовём на сайт — откроется в любом браузере
  if(/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)&&NET.lan.length)base=NET.lan[0]+'/';
  return base+(NET.via==='p2p'?'#p2p=':'#')+NET.gameId;
};

// Сообщения комнаты: общие обработчики связи, остальное — странице
NET.onMessage=function(m){
  switch(m.type){
    case'joined':
      joinTry=null;
      NET.slot=m.slot;NET.gameId=m.game_id;NET.token=m.token;
      if(NET.solo&&HOST.hub&&!HOST.gid)HOST.gid=m.game_id;
      saveSession();break;
    case'resumed':
      NET.retry=0;NET.slot=m.slot;NET.gameId=m.game_id;NET.started=m.started;NET.opts=m.opts||NET.opts;saveSession();break;
    case'lobby':NET.opts=m.opts;NET.gameId=m.game_id;NET.slots=m.slots;NET.leader=m.leader;break;
    case'slots':NET.slots=m.slots||NET.slots;NET.leader=m.leader;break;
    case'round':NET.retry=0;NET.started=true;if(m.opts)NET.opts=m.opts;if(m.slots)NET.slots=m.slots;NET.leader=m.leader;break;
    case'pong':
      NET.pongAt=Date.now();
      if(m.n&&NET.pings[m.n]){const r=performance.now()-NET.pings[m.n];delete NET.pings[m.n];NET.rtt=NET.rtt*0.7+r*0.3}
      break;
    case'resume_failed':case'game_closed':clearSession();break;
  }
  NET.cb.msg(m);
};

// Запуск страницы: ссылка-приглашение или возврат в прерванную игру. Возвращает {join:'ABC123'} если нужно показать вход.
NET.boot=function(){
  const h=decodeURIComponent(location.hash.slice(1)).trim().toUpperCase();
  const p2p=/^P2P=([A-Z0-9]{6})$/.exec(h);
  if(p2p||(SERVED&&/^[A-Z0-9]{6}$/.test(h))){
    history.replaceState(null,'',location.pathname+location.search);
    LINK_VIA=true;
    if(p2p)NET.setVia('p2p');else{PY_SERVER=true;NET.setVia('ws')}
    return {join:p2p?p2p[1]:h};
  }
  // Вкладку перезагрузили посреди игры — возвращаемся в неё
  const s=loadSession();
  if(!s)return null;
  if(s.via==='p2p')NET.setVia('p2p');
  else{
    if(SERVED&&s.ws!==AUTO_WS)return null; // через server.py: продолжаем, только если страница открыта с того же сервера
    if(SERVED)PY_SERVER=true;else serverIp=s.ws;
    NET.setVia('ws');
  }
  NET.gameId=s.gid;NET.slot=s.slot;NET.token=s.token;NET.host=!!s.host;
  status('Возвращаемся в игру '+s.gid+'…');
  if(!s.host){scheduleReconnect(0);return {resume:true}}
  // мы были хостом: поднимаем комнату из снимка, гости переподключатся сами
  const seq=NET.createSeq;
  hostRestore(s.gid).then(({listener,game})=>{
    if(seq!==NET.createSeq||NET.gameId!==s.gid){listener.destroy();return}
    hostSetup(listener,s.gid,game);
    scheduleReconnect(0);
  },err=>{
    if(seq!==NET.createSeq)return;
    clearSession();lsDel(HOST_KEY);
    status(err==='no-snapshot'?'Игра '+s.gid+' закрыта — создайте новую.':NET.hostErrText(err));
    NET.cb.closed('');
  });
  return {resume:true};
};
SW.Net=NET;
})(typeof window!=='undefined'?window:globalThis);
