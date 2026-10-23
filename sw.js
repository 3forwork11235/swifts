// Service worker «Стрижей»: игра открывается и без сети (игра с ботами, повторный запуск с иконки).
// Свои файлы — сначала из сети, чтобы обновления приходили сразу; без сети — из кэша.
// Тяжёлые библиотеки (three.js, PeerJS, MQTT) лежат рядом в vendor/ и берутся из кэша без обращения к сети.
const CACHE='strizhi-v1'; // новое имя — старый кэш удалится при обновлении
const SHELL=['./','./index.html','./manifest.webmanifest','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png',
  './core.js','./data.js','./world.js','./flight.js','./predict.js','./missions.js','./ai.js','./sim.js','./combat.js','./sites.js','./modes.js','./room.js',
  './meta.js','./models.js','./fx.js','./render.js','./input.js','./audio.js','./hud.js','./net.js','./client.js','./view.js','./app.js',
  './vendor/three.min.js','./vendor/peerjs.min.js','./vendor/mqtt.min.js'];
const FONTS=['https://fonts.googleapis.com/css2?family=Exo+2:wght@500;700;800;900&family=Russo+One&display=swap'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(
    SHELL.concat(FONTS).map(u=>c.add(u).catch(()=>{})) // один недоступный файл не должен ломать установку
  )).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
function fromNetwork(req){
  // сеть с таймаутом: на плохом мобильном интернете не ждём вечно
  return new Promise((res,rej)=>{
    const t=setTimeout(()=>rej(new Error('timeout')),6000);
    // no-cache: браузер сверяет файл с сайтом (GitHub Pages иначе 10 минут отдаёт старую копию)
    fetch(req,{cache:'no-cache'}).then(r=>{clearTimeout(t);res(r)},err=>{clearTimeout(t);rej(err)});
  });
}
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin===location.origin){
    if(url.pathname.endsWith('/strizhi-server.json'))return; // проверка server.py — всегда в сеть
    if(/\/vendor\//.test(url.pathname)){ // тяжёлые библиотеки не меняются: сначала кэш
      e.respondWith(caches.match(req).then(r=>r||fetch(req).then(resp=>{if(resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return resp})));
      return;
    }
    e.respondWith(fromNetwork(req).then(r=>{
      if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}
      return r;
    }).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>
      r||(req.mode==='navigate'?caches.match('./index.html').then(i=>i||caches.match('./')):Response.error()))));
    return;
  }
  if(/\/(peerjs|mqtt)@[\d.]+\//.test(url.pathname)||/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)){ // модули связи и шрифты
    e.respondWith(caches.match(req).then(r=>r||fetch(req).then(resp=>{
      if(resp.ok||resp.type==='opaque'){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(req,copy))}
      return resp;
    })));
  }
});
