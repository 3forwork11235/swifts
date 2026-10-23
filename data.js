// «Стрижи» — игровые данные: корпуса дронов, оружие, зенитки, модули, карты, сложность.
// Общий для хоста и клиента файл: числа здесь — «правила игры», по ним считает комната (room.js / sim.js),
// и по ним же клиент предсказывает свой полёт. Меняешь число — меняется баланс.
(function(root){
'use strict';
const SW=root.SW;

// ---------- корпуса ----------
// hp — прочность; spd — крейсерская скорость, м/с; boost/brake — множители форсажа и торможения;
// yaw/pitch — предельная скорость поворота, рад/с; accel/decel — набор/сброс скорости, м/с²; r — радиус столкновения;
// missiles/flares — боезапас; energy/regen — энергия (форсаж и лазер), единиц и в секунду; boostCost — расход на форсаже;
// gun/laser — множители урона; gunRate — скорострельность; heat/cool — нагрев и остывание пушки; lockT — время захвата, с.
SW.HULLS={
  swift:{name:'Стриж',blurb:'Универсал: ровный нрав, ровный ход. С него начинают все.',
    hp:120,spd:44,boost:1.6,brake:.62,yaw:1.75,pitch:1.35,accel:22,decel:30,r:2.3,resp:.13,level:.9,
    missiles:4,flares:3,energy:100,regen:14,boostCost:30,gun:1,gunRate:1,heat:1,cool:1,laser:1,lockT:.9,mTurn:1,flareRe:1,price:0,
    stats:{hp:3,spd:3,agi:3,wpn:3}},
  wasp:{name:'Оса',blurb:'Лёгкая и юркая: круто поворачивает, но хрупкая.',
    hp:86,spd:49,boost:1.55,brake:.6,yaw:2.2,pitch:1.7,accel:26,decel:34,r:2.0,resp:.11,level:.9,
    missiles:2,flares:2,energy:90,regen:14,boostCost:30,gun:1.05,gunRate:1.05,heat:1,cool:1,laser:.9,lockT:.9,mTurn:1,flareRe:1,price:600,
    stats:{hp:2,spd:4,agi:5,wpn:2}},
  bumble:{name:'Шмель',blurb:'Тяжёлый бронеход: неповоротлив, зато выдержит и несёт много ракет.',
    hp:200,spd:38,boost:1.5,brake:.68,yaw:1.35,pitch:1.05,accel:16,decel:26,r:2.9,resp:.16,level:.9,
    missiles:6,flares:4,energy:110,regen:13,boostCost:32,gun:1.15,gunRate:.95,heat:.9,cool:1.1,laser:1,lockT:.9,mTurn:1,flareRe:1,price:900,
    stats:{hp:5,spd:2,agi:2,wpn:4}},
  shade:{name:'Тень',blurb:'Лазерный снайпер: много энергии и самый мощный лазер.',
    hp:104,spd:45,boost:1.6,brake:.6,yaw:1.65,pitch:1.3,accel:21,decel:30,r:2.1,resp:.13,level:.9,
    missiles:3,flares:3,energy:150,regen:19,boostCost:28,gun:.9,gunRate:.95,heat:1,cool:1,laser:1.38,lockT:.8,mTurn:1.1,flareRe:1,price:1200,
    stats:{hp:2,spd:3,agi:3,wpn:5}},
};
SW.HULL_IDS=['swift','wasp','bumble','shade'];

// ---------- противники СТРАЖа (дроны под управлением ИИ) ----------
// score — очки за уничтожение; gun — множитель урона пушки (у врагов меньше, чем у игроков);
// ai — характер: range — дальность стрельбы, skill — меткость 0..1, missileEvery — пауза между ракетами, с.
SW.FOES={
  e_wasp:{name:'Оса СТРАЖа',hp:46,spd:52,boost:1.3,brake:.7,yaw:2.2,pitch:1.7,accel:26,decel:34,r:2.0,resp:.12,level:.9,
    missiles:0,flares:0,energy:60,regen:10,boostCost:30,gun:.45,gunRate:.7,heat:0,cool:50,laser:0,lockT:1,mTurn:1,flareRe:1,
    score:50,model:'e_wasp',ai:{range:270,skill:.5,missileEvery:0,style:'fighter'}},
  e_hornet:{name:'Шершень СТРАЖа',hp:96,spd:47,boost:1.35,brake:.7,yaw:1.9,pitch:1.45,accel:22,decel:30,r:2.3,resp:.13,level:.9,
    missiles:99,flares:2,energy:60,regen:10,boostCost:30,gun:.5,gunRate:.8,heat:0,cool:50,laser:0,lockT:1.1,mTurn:.9,flareRe:1,
    score:130,model:'e_hornet',ai:{range:320,skill:.65,missileEvery:7,style:'fighter'}},
  e_bulk:{name:'Бронеход СТРАЖа',hp:280,spd:34,boost:1.2,brake:.8,yaw:1.15,pitch:.9,accel:14,decel:24,r:3.4,resp:.18,level:.9,
    missiles:99,flares:3,energy:60,regen:10,boostCost:30,gun:.6,gunRate:.9,heat:0,cool:50,laser:0,lockT:1.2,mTurn:.85,flareRe:1,
    score:280,model:'e_bulk',ai:{range:340,skill:.6,missileEvery:5,style:'gunship'}},
  e_kami:{name:'Камикадзе',hp:28,spd:60,boost:1.3,brake:.8,yaw:2.5,pitch:1.9,accel:30,decel:34,r:1.9,resp:.1,level:.9,
    missiles:0,flares:0,energy:60,regen:10,boostCost:30,gun:0,gunRate:1,heat:0,cool:50,laser:0,lockT:1,mTurn:1,flareRe:1,
    score:80,model:'e_kami',ram:1,ai:{range:0,skill:.6,missileEvery:0,style:'ram'}},
  e_mother:{name:'Матка СТРАЖа',hp:2000,spd:16,boost:1,brake:1,yaw:.5,pitch:.45,accel:6,decel:8,r:15,resp:.5,level:.9,
    missiles:999,flares:0,energy:60,regen:10,boostCost:30,gun:.9,gunRate:1,heat:0,cool:50,laser:0,lockT:1,mTurn:.8,flareRe:1,
    score:4000,model:'e_mother',boss:1,ai:{range:480,skill:.6,missileEvery:3.2,style:'carrier'}},
};

// ---------- оружие ----------
SW.W={
  cannon:{cd:.085,speed:300,dmg:4.5,spread:.014,life:1.2,heat:3.2,heatMax:100,resume:45,cool:34,hit:.9},   // мини-пушка
  laser:{range:330,dps:44,cost:24,hit:2.2,delay:.7,minE:12},                                            // лазер: мгновенный луч
  missile:{speed:118,launch:34,accel:85,turn:2.3,life:7,dmg:46,splash:9,splashDmg:26,fuse:5.5,seek:1.2,cd:.6,regen:12,hit:1.6, // ракета «Шершень»
    lockRange:820,cone:.2,loseCone:.3},
  sam:{speed:108,launch:30,accel:72,turn:1.55,life:11,dmg:36,splash:8,splashDmg:20,fuse:5.5,seek:1.3,hit:1.6},   // ракета зенитного комплекса
  flare:{cd:1.1,recharge:9,life:3.6,divert:.8,range:430},
  enemyMissile:{speed:104,launch:30,accel:70,turn:1.7,life:9,dmg:30,splash:8,splashDmg:18,fuse:5.5,seek:1.25,hit:1.6},
  ram:{dmg:70,radius:4.2},
  shield:{hp:70,time:12},
};

// ---------- зенитные установки и цели на земле ----------
SW.SITES={
  sam:{name:'ЗРК «Тюльпан»',hp:90,range:580,minRange:60,reload:5.4,maxFlight:2,score:100,r:7,aa:1},
  flak:{name:'Зенитка «Ёрш»',hp:70,range:430,burst:9,rate:.11,pause:2.4,dmg:3.2,spread:.04,score:60,r:5,aa:1},
  pylon:{name:'Пилон щита',hp:240,score:300,r:8,aa:0},
  core:{name:'Сердце СТРАЖа',hp:1500,range:760,reload:3.4,volley:3,score:2500,r:16,aa:1},
};

// ---------- подбираемые бонусы ----------
SW.PICKS={
  hp:{name:'Ремкомплект',col:'#5dff9a',heal:46},
  ms:{name:'Боезапас',col:'#ffd23d'},
  en:{name:'Энергоячейка',col:'#3dd6ff'},
  sh:{name:'Щит',col:'#c76bff'},
};
SW.PICK_IDS=['hp','ms','en','sh'];
SW.PICK_RESPAWN=24;

// ---------- модули (в ангаре можно поставить два) ----------
// m — множители, a — прибавки к числам корпуса
SW.MODULES={
  armor:{name:'Усиленная броня',desc:'+25% прочности, −6% скорости',price:250,m:{hp:1.25,spd:.94}},
  cap:{name:'Конденсатор',desc:'+40% энергии, заряд быстрее',price:300,m:{energy:1.4,regen:1.3}},
  rof:{name:'Скорострельная пушка',desc:'Пушка стреляет на 20% чаще, но греется',price:350,m:{gunRate:1.2,heat:1.15}},
  flares:{name:'Кассеты ловушек',desc:'+2 ловушки, перезарядка быстрее',price:300,a:{flares:2},m:{flareRe:.7}},
  hunter:{name:'Головка-охотник',desc:'Захват цели быстрее на 35%, ракеты круче поворачивают',price:400,m:{lockT:.65,mTurn:1.2}},
  jet:{name:'Форсаж-плюс',desc:'Форсаж сильнее на 12% и экономнее на 25%',price:350,a:{boost:.12},m:{boostCost:.75}},
  coolant:{name:'Охладитель пушки',desc:'Пушка остывает вдвое быстрее',price:250,m:{cool:2}},
  lens:{name:'Линза лазера',desc:'+25% урона лазера',price:400,m:{laser:1.25}},
};
SW.MODULE_IDS=Object.keys(SW.MODULES);

// Итоговые числа дрона = корпус + два модуля (+ сложность для ботов). Считают и хост, и клиент — поэтому здесь.
SW.effective=function(hullId,mods,diff){
  const base=SW.HULLS[hullId]||SW.FOES[hullId]||SW.HULLS.swift;
  const E=Object.assign({},base);
  E.id=SW.HULLS[hullId]||SW.FOES[hullId]?hullId:'swift';
  for(const id of (mods||[]).slice(0,2)){
    const M=SW.MODULES[id];if(!M)continue;
    if(M.m)for(const k in M.m)if(typeof E[k]==='number')E[k]*=M.m[k];
    if(M.a)for(const k in M.a)if(typeof E[k]==='number')E[k]+=M.a[k];
  }
  if(diff){
    const D=SW.DIFF[diff];
    if(D){E.hp*=D.hpMul;E.spd*=D.spdMul;E.gun*=D.dmgMul}
  }
  E.hp=Math.round(E.hp);E.flares=Math.round(E.flares);E.missiles=Math.round(E.missiles);
  return E;
};

// ---------- сложность ботов и врагов ----------
// react — как часто «думает» бот, с; aim — разброс прицела, рад; evade — шанс удачно уклониться;
// missileP — склонность пускать ракеты; lead — насколько точно берёт упреждение; samReload — множитель перезарядки ЗРК
SW.DIFF={
  easy:{name:'Лёгкая',react:.5,aim:.075,hpMul:.8,dmgMul:.7,spdMul:.92,evade:.25,missileP:.25,lead:.55,samReload:1.45,fire:.09},
  normal:{name:'Обычная',react:.3,aim:.036,hpMul:1,dmgMul:1,spdMul:1,evade:.55,missileP:.5,lead:.85,samReload:1,fire:.065},
  hard:{name:'Трудная',react:.17,aim:.017,hpMul:1.15,dmgMul:1.15,spdMul:1.05,evade:.8,missileP:.75,lead:1,samReload:.82,fire:.05},
  ace:{name:'Ас',react:.09,aim:.007,hpMul:1.3,dmgMul:1.25,spdMul:1.1,evade:.95,missileP:.9,lead:1,samReload:.66,fire:.04},
};
SW.DIFF_IDS=['easy','normal','hard','ace'];

// ---------- карты ----------
SW.MAPS={
  city:{name:'Аэрополис',blurb:'Ночной мегаполис: неоновые башни, узкие улицы-каньоны, мосты между небоскрёбами.',half:720,ceil:430},
  canyon:{name:'Каньон Красной Скалы',blurb:'Закат над ущельем: скальные столбы, арки и узкие проходы.',half:760,ceil:420},
  port:{name:'Порт «Маяк»',blurb:'Рассвет над морем: краны, суда и платформы — много неба для драки.',half:780,ceil:400},
};
SW.MAP_IDS=['city','canyon','port'];

// ---------- режимы ----------
SW.MODES={
  run:{name:'Рейс',blurb:'Сюжетные вылеты. Один или вместе с друзьями — против зениток и дронов СТРАЖа.'},
  ffa:{name:'Схватка',blurb:'Каждый сам за себя: сбивай всех, пока не наберёшь нужное число побед.'},
  team:{name:'Команды',blurb:'Две эскадрильи, «синие» против «красных»: боты и друзья в любых пропорциях.'},
};
SW.MODE_IDS=['run','ffa','team'];

// ---------- позывные ботов ----------
SW.CALLSIGNS=['Ворон','Сокол','Ястреб','Кречет','Беркут','Гриф','Коршун','Орлан','Филин','Сапсан','Лунь','Пустельга',
  'Балобан','Скопа','Кобчик','Чеглок','Зарница','Вихрь','Шквал','Буран','Смерч','Метель','Мираж','Комета'];

// максимум игроков в комнате
// ---------- косметика (цвета видны всем в бою, поэтому список общий) ----------
SW.PAINTS=[
  {n:'Бирюза',c:'#31e6ff',p:0},{n:'Неон-розовый',c:'#ff3fb4',p:0},{n:'Янтарь',c:'#ffb347',p:0},{n:'Кислота',c:'#7dff6a',p:0},
  {n:'Фиалка',c:'#a77bff',p:150},{n:'Алый',c:'#ff5470',p:150},{n:'Снег',c:'#f2f2f2',p:150},{n:'Кобальт',c:'#3d6bff',p:200},
  {n:'Лимон',c:'#ffe23d',p:200},{n:'Закат',c:'#ff7b2e',p:200},{n:'Мята',c:'#2fffb0',p:300},{n:'Сталь',c:'#9aa7b8',p:300},
];
SW.TRAILS=[
  {n:'Белый след',c:'#dff6ff',p:0},{n:'Неон',c:'#31e6ff',p:150},{n:'Огонь',c:'#ff8a2e',p:200},{n:'Радуга',c:'rainbow',p:400},{n:'Звёзды',c:'#fff3a8',p:300},{n:'Электро',c:'#9d7bff',p:300},
];
SW.EMBLEMS=['🦅','🔥','⚡','💀','🐺','🌙','⭐','👑'];

SW.FOE_IDS=['e_wasp','e_hornet','e_bulk','e_kami','e_mother'];
SW.HULL_CODES=SW.HULL_IDS.concat(SW.FOE_IDS);  // номер корпуса в снимках сети
SW.MAX_SLOTS=8;  // номера дронов-игроков: 1..8 (0 означает «никого»); враги — от 100
})(typeof window!=='undefined'?window:globalThis);
