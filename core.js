// «Стрижи» — общее ядро: математика, случайные числа, шаг симуляции.
// Подключается и на странице (раньше всех остальных скриптов), и в Node (тесты в tools/) — всё кладётся в объект SW.
// Системы координат: метры, секунды, радианы; ось Y — вверх.
// Курс (yaw) и тангаж (pitch) — как в Three.js: при yaw=0 дрон летит вдоль −Z, положительный yaw — поворот ВЛЕВО,
// положительный pitch — нос вверх. Крен (roll) > 0 — левое крыло вниз (машина «ложится» в левый поворот).
(function(root){
'use strict';
const SW=root.SW=root.SW||{};
const PI=Math.PI,TAU=PI*2;
SW.PI=PI;SW.TAU=TAU;
SW.TICK=1/30;        // шаг симуляции, с
SW.SNAP_EVERY=2;     // снимок игрокам — каждые 2 шага (15 раз в секунду)

SW.clamp=(v,a,b)=>v<a?a:v>b?b:v;
SW.lerp=(a,b,t)=>a+(b-a)*t;
SW.sign=v=>v<0?-1:1;
// кратчайшая разница углов a→b, в (−π, π]
SW.angDiff=(a,b)=>{let d=(b-a)%TAU;if(d>PI)d-=TAU;else if(d<-PI)d+=TAU;return d};
SW.wrap=a=>{a%=TAU;return a>PI?a-TAU:a<-PI?a+TAU:a};
SW.angLerp=(a,b,t)=>a+SW.angDiff(a,b)*t;
SW.dist3=(ax,ay,az,bx,by,bz)=>Math.hypot(ax-bx,ay-by,az-bz);
SW.dist2=(ax,az,bx,bz)=>Math.hypot(ax-bx,az-bz);

// единичный вектор курса: out=[x,y,z]
SW.fwd=(yaw,pitch,out)=>{
  out=out||[0,0,0];const cp=Math.cos(pitch);
  out[0]=-Math.sin(yaw)*cp;out[1]=Math.sin(pitch);out[2]=-Math.cos(yaw)*cp;return out;
};
// «вправо» относительно курса (без крена)
SW.rightOf=(yaw,out)=>{out=out||[0,0,0];out[0]=Math.cos(yaw);out[1]=0;out[2]=-Math.sin(yaw);return out};
// углы курса и тангажа вектора (dx,dy,dz); out={yaw,pitch}
SW.angles=(dx,dy,dz,out)=>{
  out=out||{yaw:0,pitch:0};
  out.yaw=Math.atan2(-dx,-dz);out.pitch=Math.atan2(dy,Math.hypot(dx,dz));return out;
};

// Случайные числа с зерном (mulberry32): мир у всех игроков получается одинаковым
SW.rng=function(seed){
  let s=(seed|0)>>>0;
  const r=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};
  r.range=(a,b)=>a+r()*(b-a);
  r.int=(a,b)=>a+Math.floor(r()*(b-a));   // [a, b)
  r.pick=arr=>arr[Math.floor(r()*arr.length)];
  r.chance=p=>r()<p;
  r.shuffle=arr=>{for(let i=arr.length-1;i>0;i--){const j=Math.floor(r()*(i+1));const t=arr[i];arr[i]=arr[j];arr[j]=t}return arr};
  return r;
};
// контрольная сумма набора чисел (FNV-1a) — чтобы убедиться, что мир собрался одинаково
SW.hashNums=arr=>{
  let h=0x811c9dc5;
  for(let i=0;i<arr.length;i++){h^=Math.round(arr[i]*4)|0;h=Math.imul(h,0x01000193)}
  return h>>>0;
};

// случайные байты, коды игр, ключи
const ID_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих 0/O и 1/I
SW.randBytes=n=>{
  const b=new Uint8Array(n);
  if(root.crypto&&root.crypto.getRandomValues)root.crypto.getRandomValues(b);
  else for(let i=0;i<n;i++)b[i]=Math.floor(Math.random()*256);
  return b;
};
SW.newToken=()=>Array.from(SW.randBytes(16),x=>x.toString(16).padStart(2,'0')).join('');
SW.randomGameId=()=>{let s='';for(const x of SW.randBytes(6))s+=ID_CHARS[x%ID_CHARS.length];return s};
SW.isNum=v=>typeof v==='number'&&Number.isFinite(v);
SW.toInt=v=>{const n=Math.trunc(Number(v));return Number.isFinite(n)?n:0};

// простая «рубрика» для отладки: SW.dbg=true в консоли включает подробные сообщения
SW.dbg=false;
SW.log=(...a)=>{if(SW.dbg&&root.console)console.log(...a)};
})(typeof window!=='undefined'?window:globalThis);
