// «Стрижи» — всё, что хранится на устройстве игрока: позывной, кредиты, ангар (корпуса, модули, окраска), прохождение кампании,
// статистика, достижения, задания дня и настройки. Сохраняется в браузере (localStorage).
(function(root){
'use strict';
const SW=root.SW;
const KEY='strizhi_profile',SKEY='strizhi_settings';
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function jget(k,def){try{const v=JSON.parse(lsGet(k)||'null');return v==null?def:v}catch(e){return def}}

const EMB_PRICE=[0,100,150,250,200,200,300,500];
const TOUCH=matchMedia('(pointer:coarse)').matches||'ontouchstart' in root;

// ---------- достижения: [id, значок, название, описание, награда ₵, проверка(stats, profile)] ----------
const ACH=[
  ['first','🛫','Первый вылет','Сыграй один раунд',30,s=>s.rounds>=1],
  ['kills10','🎯','Охотник','Сбей 10 дронов',50,s=>s.kills>=10],
  ['kills100','🦅','Ас','Сбей 100 дронов',200,s=>s.kills>=100],
  ['kills500','⚡','Гроза неба','Сбей 500 дронов',500,s=>s.kills>=500],
  ['sites10','📡','Разрушитель ПВО','Уничтожь 10 зенитных установок',60,s=>s.sites>=10],
  ['sites50','💥','Бич зениток','Уничтожь 50 зенитных установок',250,s=>s.sites>=50],
  ['rings25','🟡','Курьер','Пролети 25 колец',60,s=>s.rings>=25],
  ['rings150','🏅','Король коридора','Пролети 150 колец',250,s=>s.rings>=150],
  ['icp10','🛡','Перехватчик','Сбей 10 вражеских ракет',80,s=>s.icp>=10],
  ['flare10','🔥','Тепловая уловка','Спасись ловушками 10 раз',80,s=>s.flareSaves>=10],
  ['pk25','🧰','Запасливый','Подбери 25 бонусов',40,s=>s.pk>=25],
  ['streak5','🔗','Серия','Сбей 5 врагов, ни разу не погибнув',100,s=>s.bestStreak>=5],
  ['wins5','🏆','Победитель','Выиграй 5 схваток',100,s=>s.wins>=5],
  ['wins25','👑','Чемпион неба','Выиграй 25 схваток',300,s=>s.wins>=25],
  ['camp1','📖','Первый рейс','Пройди первое задание кампании',40,(s,p)=>Object.keys(p.camp).length>=1],
  ['campAll','🌅','Свободное небо','Пройди всю кампанию (6 заданий)',500,(s,p)=>[0,1,2,3,4,5].every(i=>p.camp[i])],
  ['stars','🌟','Звёздный пилот','Получи 3 звезды во всех заданиях кампании',600,(s,p)=>[0,1,2,3,4,5].every(i=>p.camp[i]&&p.camp[i].stars>=3)],
  ['endless10','♾','Бесконечное небо','Продержись 10 волн в бесконечном режиме',200,s=>s.endlessBest>=10],
];
// ---------- задания дня ----------
const TASKS=[
  {id:'kills',text:'Сбей {n} {дрон|дрона|дронов}',need:[8,12,18],stat:'kills',reward:60},
  {id:'sites',text:'Разрушь {n} {зенитную установку|зенитные установки|зенитных установок}',need:[3,5,8],stat:'sites',reward:70},
  {id:'rings',text:'Пролети {n} {кольцо|кольца|колец}',need:[8,14],stat:'rings',reward:60},
  {id:'rounds',text:'Сыграй {n} {раунд|раунда|раундов}',need:[2,3,5],stat:'rounds',reward:50},
  {id:'icp',text:'Сбей {n} {вражескую ракету|вражеские ракеты|вражеских ракет}',need:[2,3,5],stat:'icp',reward:70},
  {id:'pk',text:'Подбери {n} {бонус|бонуса|бонусов}',need:[4,6,10],stat:'pk',reward:40},
  {id:'wins',text:'Выиграй {n} {схватку|схватки|схваток}',need:[1,2],stat:'wins',reward:100},
];

// склонение по числу: «1 бонус», «2 бонуса», «5 бонусов»; в тексте — {один|два|пять}
function plural(n,text){
  const k=n%10,h=n%100,i=h>=11&&h<=14?2:k===1?0:k>=2&&k<=4?1:2;
  return text.replace('{n}',n).replace(/{([^}|]+)|([^}|]+)|([^}|]+)}/,(m,a,b,c)=>[a,b,c][i]);
}
const defProfile=()=>({
  name:'Птенец',credits:250,
  owned:{hulls:['swift'],mods:[],paints:SW.PAINTS.map((p,i)=>p.p===0?i:-1).filter(i=>i>=0),trails:SW.TRAILS.map((p,i)=>p.p===0?i:-1).filter(i=>i>=0),emblems:[0]},
  eq:{hull:'swift',mods:[],paint:0,trail:0,emblem:0},
  camp:{},
  stats:{rounds:0,wins:0,kills:0,deaths:0,sites:0,rings:0,icp:0,flareSaves:0,pk:0,dmg:0,bestStreak:0,endlessBest:0,earned:0,seconds:0},
  ach:{},daily:{date:'',tasks:[],bonus:false},tutorial:0,
});
const defSettings=()=>({
  quality:TOUCH?1:2,sens:1,invY:false,mouse:true,level:true,fov:72,shake:1,sfx:.8,music:.5,fps:false,
});

const Meta={
  P:null,S:null,EMB_PRICE,ACH,TASKS,TOUCH,
  load(){
    const d=defProfile(),p=jget(KEY,{});
    Meta.P=Object.assign(d,p);
    Meta.P.owned=Object.assign(d.owned,p.owned||{});Meta.P.eq=Object.assign(defProfile().eq,p.eq||{});
    Meta.P.stats=Object.assign(defProfile().stats,p.stats||{});
    Meta.S=Object.assign(defSettings(),jget(SKEY,{}));
    Meta.daily();
    return Meta;
  },
  save(){lsSet(KEY,JSON.stringify(Meta.P))},
  saveSettings(){lsSet(SKEY,JSON.stringify(Meta.S))},
  setName(n){n=String(n||'').trim().slice(0,14);if(n){Meta.P.name=n;Meta.save()}return Meta.P.name},

  // ---------- ангар ----------
  have(kind,id){
    const o=Meta.P.owned;
    if(kind==='hull')return o.hulls.includes(id);
    if(kind==='mod')return o.mods.includes(id);
    if(kind==='paint')return o.paints.includes(id);
    if(kind==='trail')return o.trails.includes(id);
    if(kind==='emblem')return o.emblems.includes(id);
    return false;
  },
  price(kind,id){
    if(kind==='hull')return SW.HULLS[id].price;
    if(kind==='mod')return SW.MODULES[id].price;
    if(kind==='paint')return SW.PAINTS[id].p;
    if(kind==='trail')return SW.TRAILS[id].p;
    if(kind==='emblem')return EMB_PRICE[id];
    return 0;
  },
  buy(kind,id){
    if(Meta.have(kind,id))return 'have';
    const pr=Meta.price(kind,id);
    if(Meta.P.credits<pr)return 'poor';
    Meta.P.credits-=pr;
    const o=Meta.P.owned;
    ({hull:o.hulls,mod:o.mods,paint:o.paints,trail:o.trails,emblem:o.emblems})[kind].push(id);
    Meta.save();return 'ok';
  },
  equip(kind,id){
    if(!Meta.have(kind,id))return false;
    const e=Meta.P.eq;
    if(kind==='hull')e.hull=id;
    else if(kind==='mod'){const i=e.mods.indexOf(id);if(i>=0)e.mods.splice(i,1);else{e.mods.push(id);if(e.mods.length>2)e.mods.shift()}}
    else e[kind]=id;
    Meta.save();return true;
  },
  // то, что уходит в комнату: только купленное
  loadout(){
    const e=Meta.P.eq;
    return {hull:Meta.have('hull',e.hull)?e.hull:'swift',mods:e.mods.filter(m=>Meta.have('mod',m)).slice(0,2),
      skin:{paint:Meta.have('paint',e.paint)?e.paint:0,trail:Meta.have('trail',e.trail)?e.trail:0,emblem:Meta.have('emblem',e.emblem)?e.emblem:0}};
  },

  // ---------- кампания ----------
  campDone(i){return !!Meta.P.camp[i]},
  campOpen(i){return i===0||i===6?(i===0||Meta.P.camp[5]||Meta.P.camp[4]):!!Meta.P.camp[i-1]},

  // ---------- задания дня ----------
  daily(){
    const d=new Date(),key=d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
    if(Meta.P.daily.date===key)return Meta.P.daily;
    const r=SW.rng(d.getFullYear()*372+d.getMonth()*31+d.getDate()),pool=r.shuffle(TASKS.slice()).slice(0,3);
    Meta.P.daily={date:key,bonus:false,tasks:pool.map(t=>{const n=r.pick(t.need);return {id:t.id,n,have:0,done:false,reward:t.reward,text:plural(n,t.text)}})};
    Meta.save();return Meta.P.daily;
  },

  // ---------- итоги раунда ----------
  // m — сообщение round_end, myId — наш дрон. Возвращает сводку для экрана итогов.
  record(m,myId,myTeam){
    const P=Meta.P,S=P.stats,st=(m.st&&m.st[myId])||{k:0,d:0,dmg:0,shots:0,hit:0,icp:0,sites:0,rings:0,pk:0,best:0,score:0,fs:0},r=m.result||{};
    const before=new Set(Object.keys(P.ach));
    let win=false,credits=0;
    if(r.mode==='ffa')win=r.winner===myId;
    else if(r.mode==='team')win=r.winTeam===myTeam;
    else if(r.mode==='run')win=!!r.win;
    S.rounds++;S.kills+=st.k;S.deaths+=st.d;S.sites+=st.sites;S.rings+=st.rings;S.icp+=st.icp;S.pk+=st.pk;S.flareSaves+=st.fs;S.dmg+=st.dmg;
    S.bestStreak=Math.max(S.bestStreak,st.best);
    if(win&&r.mode!=='run')S.wins++;
    if(r.mode==='run'){
      if(win&&!r.endless){
        const old=P.camp[r.mission];
        P.camp[r.mission]={stars:Math.max(old?old.stars:0,r.stars),best:Math.min(old&&old.best||9999,r.time)};
      }
      if(r.endless)S.endlessBest=Math.max(S.endlessBest,r.waves);
      credits=r.reward||0;
    }else{
      credits=15+st.k*8+st.sites*10+(win?60:0);
    }
    // задания дня
    const dly=Meta.daily(),done=[];
    for(const t of dly.tasks){
      if(t.done)continue;
      const T0=TASKS.find(x=>x.id===t.id),delta=T0.stat==='rounds'?1:T0.stat==='wins'?(win&&r.mode!=='run'?1:0):(st[T0.stat]||0);
      t.have=Math.min(t.n,t.have+delta);
      if(t.have>=t.n){t.done=true;credits+=t.reward;done.push(t)}
    }
    if(!dly.bonus&&dly.tasks.every(t=>t.done)){dly.bonus=true;credits+=100;done.push({text:'Все задания дня — бонус',reward:100})}
    // достижения
    const gained=[];
    for(const a of ACH){
      if(P.ach[a[0]])continue;
      if(a[5](S,P)){P.ach[a[0]]=1;credits+=a[4];gained.push(a)}
    }
    P.credits+=credits;S.earned+=credits;
    Meta.save();
    return {win,credits,st,newAch:gained,tasks:done,r};
  },
  dailyProgress(){return Meta.daily()},
};
SW.Meta=Meta.load();
})(typeof window!=='undefined'?window:globalThis);
