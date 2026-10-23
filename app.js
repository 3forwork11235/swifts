// «Стрижи» — экраны и сценарий приложения: меню, кампания, настройка игры, лобби, ангар, профиль, настройки, пауза, итоги.
// Бой — client.js/view.js/hud.js, правила — room.js/sim.js, связь — net.js, хранение — meta.js.
'use strict';
const VERSION='1.0'; // видно в углу меню — по нему ясно, что на устройстве свежая версия
(function(){
const SW=window.SW,R=SW.Render,A=SW.Audio,I=SW.Input,NET=SW.Net,C=SW.Client,V=SW.View,M=SW.Meta;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}
const TOUCH=I.touch=matchMedia('(pointer:coarse)').matches||'ontouchstart' in window;
if(TOUCH)document.body.classList.add('touch');
$('ver').textContent='версия '+VERSION;

// ---------- экраны ----------
let cur='menu';
function show(id){
  cur=id;
  for(const s of document.querySelectorAll('.screen'))s.classList.toggle('active',s.id===id);
  document.body.className=document.body.className.replace(/scr-\S+/g,'').trim()+' scr-'+id;
  $('purse').style.display=id==='game'||id==='lobby'?'none':'';
  $('purse').textContent='₵ '+M.P.credits;
  if(id!=='game')document.querySelectorAll('.screen.active').forEach(s=>s.scrollTop=0);
  if(A.ok)A.music(id==='game'?'battle':'menu');
  V.setMenuScene(id==='hangar'?'hangar':'menu');
  netStatus('');
}
let toastT=null;
function toast(t,ms){const e=$('toast');e.textContent=t;e.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>e.classList.remove('show'),ms||2400)}
function netStatus(t){for(const e of document.querySelectorAll('.netStatus'))e.textContent=t}
C.toast=function(t){toast(t,1800)};

// ---------- настройка игры ----------
const SU=Object.assign({mode:'ffa',map:'city',size:6,bots:true,botDiff:'normal',frags:15,time:420,assist:1,mission:0,diff:'',wing:2},JSON.parse(lsGet('strizhi_setup')||'{}'));
function saveSetup(){lsSet('strizhi_setup',JSON.stringify(SU))}
const OPT={
  map:{label:'Карта',opts:()=>SW.MAP_IDS.map(i=>[i,SW.MAPS[i].name])},
  size:{label:'Мест в бою',opts:m=>m==='run'?[1,2,3,4].map(n=>[n,n+(n===1?' пилот':' пилота')]):[2,3,4,5,6,7,8].map(n=>[n,n+' пилотов'])},
  botDiff:{label:'Боты',opts:()=>SW.DIFF_IDS.map(i=>[i,SW.DIFF[i].name])},
  frags:{label:'Победа при',opts:m=>(m==='team'?[15,30,50,75]:[5,10,15,25,40]).map(n=>[n,n+' сбитых'])},
  time:{label:'Время раунда',opts:()=>[[180,'3 минуты'],[300,'5 минут'],[420,'7 минут'],[600,'10 минут'],[0,'без лимита']]},
  assist:{label:'Помощь прицела',opts:()=>[[0,'нет'],[1,'слабая'],[2,'сильная']]},
  diff:{label:'Сложность',opts:()=>[['','как задумано'],['easy','Лёгкая'],['normal','Обычная'],['hard','Трудная'],['ace','Ас']]},
  wing:{label:'Ведомые боты',opts:()=>[[0,'нет'],[1,'один'],[2,'два'],[3,'три']]},
};
function fieldsFor(mode){return mode==='run'?['diff','wing','size','assist']:['map','size','botDiff','frags','time','assist']}
// сетка настроек: onChange(ключ, значение)
function buildOpts(box,mode,vals,onChange,readonly){
  box.innerHTML='';
  for(const k of fieldsFor(mode)){
    const f=OPT[k],lb=el('label','lbl',esc(f.label)),sel=el('select');
    for(const [v,t] of f.opts(mode)){const o=el('option',null,esc(t));o.value=v;sel.append(o)}
    sel.value=String(vals[k]==null?'':vals[k]);
    sel.disabled=!!readonly;
    sel.onchange=()=>{const raw=sel.value;const v=k==='diff'?raw:(/^\d+$/.test(raw)?+raw:raw);onChange(k,v)};
    lb.append(sel);box.append(lb);
  }
  if(mode!=='run'){
    const lb=el('label','chk');const cb=el('input');cb.type='checkbox';cb.checked=!!vals.bots;cb.disabled=!!readonly;
    cb.onchange=()=>onChange('bots',cb.checked);lb.append(cb,document.createTextNode('Боты на свободных местах'));box.append(lb);
  }
}
function currentOpts(){
  const o={mode:SU.mode,map:SU.map,size:SU.size,bots:SU.bots,botDiff:SU.botDiff,frags:SU.frags,time:SU.time,assist:SU.assist,mission:SU.mission,diff:SU.diff||null,wing:SU.wing};
  return o;
}

// ---------- меню ----------
$('name').value=M.P.name;
$('name').onchange=()=>{$('name').value=M.setName($('name').value)};
$('mPlay').onclick=()=>{audioStart();$('name').blur();M.setName($('name').value);show('play')};
$('mHangar').onclick=()=>{audioStart();openHangar('menu')};
$('mProfile').onclick=()=>{audioStart();renderProfile();show('profile')};
$('mSettings').onclick=()=>{audioStart();renderSettings();show('settings')};
$('mHelp').onclick=()=>openHelp();
$('playBack').onclick=()=>show('menu');
$('campBack').onclick=()=>show('play');
$('brBack').onclick=()=>show('campaign');
$('suBack').onclick=()=>show('play');
$('pfBack').onclick=()=>show('menu');
$('stBack').onclick=()=>show('menu');
function audioStart(){A.init();A.play('click');if(A.ok)A.music(cur==='game'?'battle':'menu')}
document.addEventListener('pointerdown',()=>{if(!A.ok){A.init();if(A.ok)A.music(cur==='game'?'battle':'menu')}},{once:true});
document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('.btn,.card,.mrow,.tab,.item')){A.init();A.play('click')}});

// ---------- выбор режима ----------
function renderModes(){
  const box=$('modeCards');box.innerHTML='';
  const info={run:['🛰','Сюжетная кампания: курьерские вылеты, зенитки, роевые дроны и боссы. Можно проходить вдвоём-вчетвером.'],
    ffa:['⚔','Каждый сам за себя. Бои в небе над городом, портом или каньоном — с ботами и друзьями.'],
    team:['🛡','Синие против красных. Друзья в одной эскадрилье — боты в другой, или как захотите.']};
  for(const id of SW.MODE_IDS){
    const c=el('div','card',`<span class="big">${info[id][0]}</span><h3>${SW.MODES[id].name}</h3><p>${info[id][1]}</p>`);
    c.onclick=()=>{SU.mode=id;saveSetup();id==='run'?openCampaign():openSetup()};
    box.append(c);
  }
}
renderModes();
$('btnJoin').onclick=()=>{
  audioStart();M.setName($('name').value);
  const id=$('joinId').value;
  NET.join(id);
};
$('joinId').addEventListener('keydown',e=>{if(e.key==='Enter')$('btnJoin').click()});

// ---------- схватки и команды ----------
function openSetup(){
  const m=SU.mode;
  if(m==='team'&&SU.frags<15)SU.frags=30;if(m==='ffa'&&SU.frags>40)SU.frags=15;
  $('setupTitle').textContent=SW.MODES[m].name;
  $('setupSub').textContent=SW.MODES[m].blurb;
  buildOpts($('setupOpts'),m,SU,(k,v)=>{SU[k]=v;saveSetup()});
  show('setup');
}
$('suSolo').onclick=()=>{audioStart();M.setName($('name').value);NET.startSolo(Object.assign(currentOpts(),{solo:true,bots:true}))};
$('suFriends').onclick=()=>{audioStart();M.setName($('name').value);NET.create()};

// ---------- кампания ----------
function stars(n){return '★'.repeat(n)+'<i>'+'★'.repeat(3-n)+'</i>'}
function openCampaign(){
  if(!M.P.tutorial){showPrologue();return}
  renderMissions();show('campaign');
}
function showPrologue(){
  const box=$('prologueText');box.innerHTML='';
  SW.PROLOGUE.forEach((t,i)=>{const p=el('p',null,esc(t));p.style.animationDelay=(i*1.1)+'s';box.append(p)});
  show('prologue');
}
$('prologueGo').onclick=()=>{M.P.tutorial=1;M.save();renderMissions();show('campaign')};
function renderMissions(){
  const box=$('missionList');box.innerHTML='';
  SW.MISSIONS.forEach((mi,i)=>{
    const open=M.campOpen(i),done=M.P.camp[i];
    const r=el('div','mrow'+(open?'':' locked'));
    r.innerHTML=`<div class="num">${mi.endless?'∞':i+1}</div><div class="grow"><h3>${esc(mi.title)}</h3><p>${esc(mi.blurb)}</p></div>
      <div style="text-align:right;flex:none">${done?`<div class="stars">${stars(done.stars)}</div>`:open?`<div style="color:var(--cyan);font-size:12px;font-weight:800">${mi.endless?'рекорд: '+M.P.stats.endlessBest+' волн':'ДОСТУПНО'}</div>`:'<div style="font-size:20px">🔒</div>'}</div>`;
    if(open)r.onclick=()=>openBriefing(i);
    box.append(r);
  });
}
function dialog(lines){
  let h='';
  for(const l of lines){const w=SW.WHO[l.who]||SW.WHO.vera;h+=`<div class="dlg"><div class="pt" style="border-color:${w.col}">${w.icon}</div><div class="bub" style="border-color:${w.col}"><div class="nm" style="color:${w.col}">${esc(w.name)} · ${esc(w.role)}</div>${esc(l.text)}</div></div>`}
  return h;
}
function openBriefing(i){
  SU.mission=i;SU.mode='run';saveSetup();
  const mi=SW.MISSIONS[i];
  $('brTitle').textContent=(mi.endless?'':'Задание '+(i+1)+'. ')+mi.title;
  $('brSub').innerHTML=esc(mi.blurb)+'<br><b style="color:var(--amb)">Цель: '+esc(mi.obj.text)+'</b>'+(mi.reward?' · награда до ₵ '+mi.reward:'');
  $('brDlg').innerHTML=dialog(mi.intro);
  buildOpts($('brOpts'),'run',SU,(k,v)=>{SU[k]=v;saveSetup()});
  show('briefing');
}
$('brGo').onclick=()=>{audioStart();M.setName($('name').value);NET.startSolo(Object.assign(currentOpts(),{mode:'run',solo:true,size:1}))};
$('brFriends').onclick=()=>{audioStart();M.setName($('name').value);SU.size=Math.max(2,SU.size);NET.create()};

// ---------- лобби ----------
const HULL_ICON={swift:'🛸',wasp:'🐝',bumble:'🐘',shade:'🌑'};
function renderLobby(){
  const ids=Object.keys(NET.slots).sort((a,b)=>+a.slice(1)-+b.slice(1)),o=NET.opts||{};
  $('lbTitle').textContent=(o.mode?SW.MODES[o.mode].name:'Комната')+(o.mode==='run'&&SW.MISSIONS[o.mission]?': '+SW.MISSIONS[o.mission].title:'');
  $('lbSub').textContent=o.mode==='run'?'Вылет вместе: каждому свой дрон, общие жизни и общая цель':'';
  $('gameIdBox').innerHTML=String(NET.gameId||'').split('').map(ch=>'<span>'+esc(ch)+'</span>').join('');
  $('serverShow').textContent=NET.via==='ws'?(NET.pyServer()?location.host:NET.wsUrl()):
    (!NET.host&&NET.route==='mq'?'запасной канал (через сервер сообщений)':'напрямую (P2P)')+', сервер — '+(NET.host?'это устройство':'устройство создателя игры');
  const link=NET.inviteLink();
  $('joinLink').style.display=link?'':'none';if(link)$('joinLink').textContent=link;
  $('btnShare').style.display=navigator.share?'':'none';
  const slotBox=$('slotList');slotBox.innerHTML='';
  let free=0;
  for(const id of ids){
    const s=NET.slots[id],me=id===NET.slot,row=el('div','slot'+(me?' me':'')+(s.kind==='empty'?' empty':''));
    const paint=SW.PAINTS[(s.skin&&s.skin.paint)|0]||SW.PAINTS[0];
    const ic=el('div','ic',s.kind==='empty'?'＋':SW.EMBLEMS[(s.skin&&s.skin.emblem)|0]);
    if(s.kind!=='empty')ic.style.borderColor=paint.c;
    const box=el('div','grow');
    const hull=s.kind!=='empty'&&SW.HULLS[s.hull]?SW.HULLS[s.hull].name:'';
    box.innerHTML=`<div class="nm">${s.kind==='empty'?(o.bots?'Бот':'Свободно'):esc(s.name)+(me?' (ты)':'')}</div>
      <div class="st">${s.kind==='empty'?(o.bots?'займёт место, если никто не придёт':'ждём пилота'):s.kind==='bot'?'бот · '+hull:(s.online?'<span class="on">● на месте</span>':'отошёл')+' · '+hull}</div>`;
    row.append(ic,box);
    if(o.mode==='team'&&s.kind!=='empty'){
      const t=el('div','tm '+(s.team===1?'r':'b'),s.team===1?'КРАСНЫЕ':'СИНИЕ');
      if(me)t.onclick=()=>NET.send({action:'team',team:s.team===1?0:1});else t.style.opacity=.7;
      row.append(t);
    }
    if(s.kind==='empty')free++;
    slotBox.append(row);
  }
  const leader=NET.leader===NET.slot;
  $('btnStart').style.display=leader?'':'none';
  $('lobbyHint').textContent=leader?(o.mode==='run'?'Когда все на месте — жми «Взлёт!»':'Жми «Взлёт!» — свободные места займут боты'+(o.bots?'':' (боты выключены)')+'.'):'Ждём команды создателя игры.';
  $('lbOptsPanel').style.display='';
  buildOpts($('lbOpts'),o.mode||'ffa',o,(k,v)=>NET.send({action:'set_opts',opts:{[k]:v}}),!leader);
  renderHostTries();
}
function renderHostTries(){
  const el_=$('hostTries'),t=NET.hostTries();
  if(!el_)return;
  el_.textContent=!NET.host||!t.length?'':'🔌 Попытки подключения: '+t.map(r=>r.open?(r.mq?'✅ вошёл (запасной канал)':'✅ вошёл'):r.ice==='failed'?'❌ сеть не пропустила':r.ice==='disconnected'?'⚠️ оборвалось':'⏳ '+r.ice).join(' · ');
}
$('btnStart').onclick=()=>NET.send({action:'start_game'});
$('btnLbBack').onclick=()=>leaveToMenu();
$('btnLbHangar').onclick=()=>openHangar('lobby');
$('btnCopy').onclick=()=>{
  const l=NET.inviteLink();if(!l)return;
  copyText(l,()=>{$('btnCopy').textContent='✅ Скопировано';setTimeout(()=>$('btnCopy').textContent='📋 Копировать ссылку',1500)});
};
$('btnShare').onclick=()=>{
  const l=NET.inviteLink();if(!l)return;
  if(navigator.share)navigator.share({title:'Стрижи',text:'Залетай в бой над городом! Код: '+NET.gameId,url:l}).catch(()=>{});else $('btnCopy').onclick();
};
function copyText(text,done){
  if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(text).then(done,()=>{})}
  else{
    const t=document.createElement('textarea');t.value=text;t.setAttribute('readonly','');t.style.position='fixed';t.style.opacity='0';
    document.body.appendChild(t);t.select();t.setSelectionRange(0,text.length);
    try{document.execCommand('copy');done()}catch(e){}
    t.remove();
  }
}
function leaveToMenu(){
  if(NET.conn&&NET.token&&!NET.solo)NET.send({action:'leave'});
  NET.close();NET.clearSession();
  C.leaveGame();closeOverlays();
  show('menu');
}

// ---------- ангар ----------
let hgTab='hull',hgFrom='menu',pending=null;
const TABS=[['hull','Корпус'],['mod','Модули'],['paint','Окраска'],['trail','След'],['emblem','Эмблема']];
function openHangar(from){
  hgFrom=from;pending=null;
  V.heroDist=11.5;
  V.setHero(M.loadout());show('hangar');V.setMenuScene('hangar');
  renderHangar();
}
function previewHero(){const l=M.loadout();if(pending&&pending.kind==='hull')l.hull=pending.id;V.setHero(l)}
function renderHangar(){
  $('hgPurse').textContent='₵ '+M.P.credits;
  const eq=M.P.eq,hull=SW.HULLS[pending&&pending.kind==='hull'?pending.id:M.loadout().hull],E=SW.effective(pending&&pending.kind==='hull'?pending.id:M.loadout().hull,M.loadout().mods);
  const meter=(k)=>`<div class="statrow"><span>${k[0]}</span><div class="meter"><i style="width:${hull.stats[k[1]]*20}%"></i></div></div>`;
  $('hgInfo').innerHTML=`<h3 style="font-size:22px">${esc(hull.name)}</h3><div style="color:var(--dim);font-size:13px;margin:4px 0 10px;line-height:1.4">${esc(hull.blurb)}</div>`+
    [['броня','hp'],['скорость','spd'],['манёвр','agi'],['огонь','wpn']].map(meter).join('')+
    `<div style="font-size:12px;color:var(--dim);margin-top:6px">Прочность ${E.hp} · ракет ${E.missiles} · ловушек ${E.flares} · энергия ${Math.round(E.energy)}</div>`;
  const tabs=$('hgTabs');tabs.innerHTML='';
  for(const [k,t] of TABS){const b=el('div','tab'+(k===hgTab?' on':''),t);b.onclick=()=>{hgTab=k;pending=null;renderHangar()};tabs.append(b)}
  const box=$('hgItems');box.innerHTML='';
  const addItem=(kind,id,name,sub,swatch,priceNum)=>{
    const have=M.have(kind,id),on=kind==='mod'?eq.mods.includes(id):(eq[kind]===id||(kind==='hull'&&eq.hull===id));
    const it=el('div','item'+(on?' on':''));
    it.innerHTML=(swatch?`<div class="sw" style="background:${swatch}"></div>`:'')+`<div class="in">${name}</div>`+
      `<div class="ip${have?' have':''}">${on?'✓ надето':have?'надеть':'₵ '+priceNum}</div>`+(sub?`<div class="ix">${sub}</div>`:'');
    it.onclick=()=>{
      if(have){M.equip(kind,id);pending=null;A.play('click');V.setHero(M.loadout());renderHangar();return}
      if(pending&&pending.kind===kind&&pending.id===id){
        const r=M.buy(kind,id);
        if(r==='ok'){A.play('pickup');M.equip(kind,id);toast('Куплено!');pending=null;V.setHero(M.loadout());renderHangar();$('purse').textContent='₵ '+M.P.credits}
        else if(r==='poor'){toast('Не хватает ₵ '+(priceNum-M.P.credits))}
      }else{
        pending={kind,id};
        if(kind==='hull')previewHero();
        if(kind==='paint'||kind==='trail'||kind==='emblem'){const l=M.loadout();l.skin[kind]=id;V.setHero(l)}
        toast('Нажми ещё раз — купить за ₵ '+priceNum+(M.P.credits<priceNum?' (не хватает)':''),2000);
        renderHangar();
        const b=$('hgItems').children;for(const x of b)if(x.dataset&&x.dataset.k===kind+':'+id)x.classList.add('on');
      }
    };
    it.dataset.k=kind+':'+id;
    box.append(it);
  };
  if(hgTab==='hull')for(const id of SW.HULL_IDS){const h=SW.HULLS[id];addItem('hull',id,esc(h.name),esc(h.blurb.split(':')[0]),null,h.price)}
  else if(hgTab==='mod')for(const id of SW.MODULE_IDS){const m=SW.MODULES[id];addItem('mod',id,esc(m.name),esc(m.desc),null,m.price)}
  else if(hgTab==='paint')SW.PAINTS.forEach((p,i)=>addItem('paint',i,esc(p.n),'',p.c,p.p));
  else if(hgTab==='trail')SW.TRAILS.forEach((p,i)=>addItem('trail',i,esc(p.n),'',p.c==='rainbow'?'linear-gradient(90deg,red,orange,yellow,lime,cyan,blue,magenta)':p.c,p.p));
  else SW.EMBLEMS.forEach((e,i)=>addItem('emblem',i,'<span style="font-size:24px">'+e+'</span>','',null,M.EMB_PRICE[i]));
  const pe=$('hgItems').querySelector('.item.pend');if(pe)pe.classList.remove('pend');
}
$('hgBack').onclick=()=>{
  pending=null;
  if(hgFrom==='lobby'&&NET.conn){NET.send({action:'loadout',loadout:M.loadout(),name:M.P.name});show('lobby');renderLobby()}
  else{V.setMenuScene('menu');show('menu')}
};

// ---------- профиль ----------
function renderProfile(){
  const S=M.P.stats;
  const tile=(v,t)=>`<div><b>${v}</b><span>${t}</span></div>`;
  $('pfStats').innerHTML=tile(S.rounds,'вылетов')+tile(S.kills,'сбито')+tile(S.deaths,'потерь')+tile(S.wins,'побед')+tile(S.sites,'зениток')+tile(S.rings,'колец')+tile(Object.keys(M.P.camp).length+'/6','кампания')+tile('₵ '+S.earned,'заработано');
  const d=M.daily();
  $('pfDaily').innerHTML=d.tasks.map(t=>`<div class="task${t.done?' ok':''}"><div class="tx"><div>${esc(t.text)}</div><div class="bar"><i style="width:${Math.round(t.have/t.n*100)}%"></i></div></div><div class="tp">${t.have}/${t.n} · ₵ ${t.reward}${t.done?' ✓':''}</div></div>`).join('')+
    `<div class="link" style="margin-top:8px">Все три — бонус ₵ 100${d.bonus?' ✓ получен':''}. Новые задания — каждый день.</div>`;
  $('pfAch').innerHTML=M.ACH.map(a=>`<div class="ach${M.P.ach[a[0]]?' ok':''}"><div class="ai">${a[1]}</div><div><div class="an">${esc(a[2])}</div><div class="ad">${esc(a[3])}</div></div><div class="ap">${M.P.ach[a[0]]?'✓':'₵ '+a[4]}</div></div>`).join('');
}

// ---------- настройки ----------
function applySettings(){
  const S=M.S;
  I.setCfg({sens:S.sens,invY:S.invY,mouse:S.mouse,level:S.level});
  A.setVolumes(S.sfx,S.music);
  $('fps').style.display=S.fps?'':'none';
}
function settingRows(box,compact){
  const S=M.S,rows=[
    ['Чувствительность','range',{k:'sens',min:.5,max:1.8,step:.05}],
    ['Поле зрения','range',{k:'fov',min:60,max:95,step:1}],
    ['Звук','range',{k:'sfx',min:0,max:1,step:.05}],
    ['Музыка','range',{k:'music',min:0,max:1,step:.05}],
    ['Тряска камеры','range',{k:'shake',min:0,max:1,step:.1}],
    ['Нос вниз при стике вверх (инверсия)','check',{k:'invY'}],
    ['Автовыравнивание','check',{k:'level'}],
    ['Управление мышью','check',{k:'mouse'}],
    ['Показывать FPS','check',{k:'fps'}],
  ];
  if(compact)rows.length=4;
  box.innerHTML='';
  for(const [lab,type,o] of rows){
    const row=el('div','srow'),l=el('div',null,esc(lab));let inp;
    if(type==='range'){inp=el('input');inp.type='range';inp.min=o.min;inp.max=o.max;inp.step=o.step;inp.value=S[o.k];inp.oninput=()=>{S[o.k]=+inp.value;M.saveSettings();applySettings()}}
    else{inp=el('input');inp.type='checkbox';inp.checked=!!S[o.k];inp.style.width='22px';inp.style.height='22px';inp.onchange=()=>{S[o.k]=inp.checked;M.saveSettings();applySettings()}}
    row.append(l,inp);box.append(row);
  }
}
function renderSettings(){
  const S=M.S;
  settingRows($('stBox'));
  const q=el('div','srow'),ql=el('div',null,'Качество графики (после перезапуска)'),qs=el('select');
  [['0','Низкое'],['1','Среднее'],['2','Высокое']].forEach(([v,t])=>{const o=el('option',null,t);o.value=v;qs.append(o)});
  qs.value=String(S.quality);qs.onchange=()=>{S.quality=+qs.value;M.saveSettings();toast('Применится после перезапуска страницы')};
  q.append(ql,qs);$('stBox').append(q);
  // связь
  const nb=$('stNet');nb.innerHTML='<div class="cap">Связь для игры с друзьями</div>';
  const r1=el('div','srow'),l1=el('div',null,'Способ'),s1=el('select');
  [['p2p','Напрямую (P2P), нужен интернет'],['ws','Через сервер на компьютере (Wi-Fi)']].forEach(([v,t])=>{const o=el('option',null,t);o.value=v;s1.append(o)});
  s1.value=NET.via;s1.onchange=()=>{NET.setVia(s1.value,true);renderSettings()};r1.append(l1,s1);nb.append(r1);
  if(NET.via==='ws'&&!NET.pyServer()){
    const r2=el('div','srow'),l2=el('div',null,'Адрес сервера'),i2=el('input');i2.type='text';i2.value=NET.getServerIp();i2.onchange=()=>NET.setServerIp(i2.value.trim());r2.append(l2,i2);nb.append(r2);
  }
  const rb=el('div','row c');rb.style.marginTop='14px';
  const reset=el('button','btn small warn','Сбросить прогресс');
  reset.onclick=()=>{if(confirm('Стереть кредиты, ангар и прохождение кампании?')){try{localStorage.removeItem('strizhi_profile')}catch(e){}location.reload()}};
  rb.append(reset);nb.append(rb);
}

// ---------- помощь ----------
function openHelp(){
  const k=(a,b)=>`<kbd>${a}</kbd><div>${b}</div>`;
  $('helpBody').innerHTML=TOUCH?
    `<div class="keys">${k('Левый палец','курс и высота — тяни в сторону движения')}${k('ОГОНЬ','пушка (🔁 — лазер)')}${k('🚀','ракета: наведи на цель, дождись захвата')}${k('🔥','ловушки против ракет')}${k('⚡','форсаж (тратит энергию)')}${k('🎥','камера: сзади / из кабины')}</div>`:
    `<div class="keys">${k('Мышь','курс и высота (чем дальше от центра, тем круче)')}${k('W A S D / стрелки','курс и высота с клавиатуры')}${k('ЛКМ / Пробел','огонь')}${k('ПКМ / F','ракета (нужен захват)')}${k('G','ловушки')}${k('Shift / Ctrl','форсаж / торможение')}${k('Q','пушка ⇄ лазер')}${k('C','камера: сзади / из кабины')}${k('Tab','таблица')}${k('1–8','быстрая реплика')}${k('Esc','пауза')}</div>`;
  $('help').classList.add('show');
}
$('helpClose').onclick=()=>$('help').classList.remove('show');
C.cb.help=openHelp;

// ---------- пауза, таблица ----------
function closeOverlays(){for(const id of ['pause','score','results','help','phrases'])$(id).classList.remove('show');$('radio').classList.remove('show')}
C.cb.pause=state=>{
  if(state===false){$('pause').classList.remove('show');return}
  settingRows($('pauseSet'),true);
  $('pause').classList.add('show');
};
$('pResume').onclick=()=>{$('pause').classList.remove('show');if(C.paused)C.togglePause()};
$('pHelp').onclick=openHelp;
$('pExit').onclick=()=>leaveToMenu();
let scoreOn=false;
function renderScore(){
  const g=C.g,sb=(g&&g.sb||[]).slice().sort((a,b)=>b[1]-a[1]||a[2]-b[2]||b[3]-a[3]);
  const team=C.mode==='team';
  let h='<table class="tbl"><tr><th>Пилот</th><th>Сбито</th><th>Потери</th><th>Очки</th></tr>';
  for(const r of sb){
    const i=C.info.get(r[0]);
    h+=`<tr class="${r[0]===C.myId?'me ':''}${team?(r[4]===1?'r':'b'):''}"><td>${esc(i?i.name:'?')}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`;
  }
  $('scBody').innerHTML=h+'</table>';
  $('scTitle').textContent=team&&g&&g.ts?`Синие ${g.ts[0]} : ${g.ts[1]} Красные`:'Таблица';
}
C.cb.score=v=>{
  scoreOn=v==='toggle'?!scoreOn:!!v;
  $('score').classList.toggle('show',scoreOn);
  if(scoreOn)renderScore();
};
setInterval(()=>{if(scoreOn)renderScore()},400);

// быстрые реплики на телефоне: кнопка 💬 раскрывает список
(function(){
  const box=$('phrases');
  C.phrases.forEach((t,i)=>{const b=el('button',null,esc(t));b.onclick=()=>{C.say(i);box.classList.remove('show')};box.append(b)});
  $('bRadio').addEventListener('pointerdown',e=>{box.classList.toggle('show');e.preventDefault()});
})();

// ---------- радио ----------
let radioQ=[],radioBusy=false,radioTimer=null;
C.cb.radio=(who,text)=>{radioQ.push({who,text});if(!radioBusy)nextRadio()};
function nextRadio(){
  const m=radioQ.shift();
  if(!m){radioBusy=false;$('radio').classList.remove('show');return}
  radioBusy=true;
  const w=SW.WHO[m.who]||SW.WHO.vera;
  $('rdIcon').textContent=w.icon;$('rdIcon').parentElement.querySelector('.pt').style.borderColor=w.col;
  $('rdName').textContent=w.name+' · '+w.role;$('rdName').style.color=w.col;
  const tx=$('rdText');tx.textContent='';$('radio').classList.add('show');
  let i=0;const iv=setInterval(()=>{tx.textContent=m.text.slice(0,++i);if(i>=m.text.length)clearInterval(iv)},22);
  clearTimeout(radioTimer);radioTimer=setTimeout(()=>{clearInterval(iv);nextRadio()},Math.max(3200,m.text.length*70));
}

// ---------- начало и конец раунда ----------
C.cb.round=m=>{
  closeOverlays();radioQ=[];radioBusy=false;
  show('game');
  resultsRound=-1;
};
let resultsRound=-1,nextTimer=null,lastSummary=null;
C.cb.roundEnd=m=>{
  if(resultsRound===m.round)return;
  resultsRound=m.round;
  lastSummary=M.record(m,C.myId,C.myTeam);
  $('purse').textContent='₵ '+M.P.credits;
  setTimeout(()=>showResults(m,lastSummary),m.result&&m.result.mode==='run'?900:500);
};
function showResults(m,sum){
  if(cur!=='game')return;
  const r=m.result||{},box=$('resBox'),leader=NET.leader===NET.slot;
  let h='',title='',cls='';
  const rows=(r.sb||[]).map(x=>{const i=C.info.get(x[0]);return {id:x[0],name:i?i.name:'?',k:x[1],d:x[2],sc:x[3],team:x[4]}});
  if(r.mode==='run'){
    cls=sum.win?'win':'lose';title=sum.win?(r.endless?'ВОЛН: '+r.waves:'ЗАДАНИЕ ВЫПОЛНЕНО'):'ЗАДАНИЕ ПРОВАЛЕНО';
    if(r.endless){cls='win';title='Волн отражено: '+r.waves}
    h+=`<div class="bigtxt ${cls}">${title}</div>`;
    if(!r.endless&&sum.win)h+=`<div class="stars" style="text-align:center;font-size:32px">${stars(r.stars)}</div>`;
    else if(!sum.win)h+=`<div class="sub">${r.why==='time'?'Время вышло':'Все дроны потеряны'}</div>`;
    h+=`<div class="gain"><div class="g">⏱ ${Math.floor(r.time/60)}:${String(r.time%60).padStart(2,'0')}</div><div class="g">💥 очки ${r.score}</div><div class="g">✖ потерь ${r.lost}</div></div>`;
    const mi=SW.MISSIONS[r.mission];
    if(sum.win&&mi&&mi.outro)h+=dialog(mi.outro);
  }else{
    const sorted=rows.slice().sort((a,b)=>b.k-a.k||a.d-b.d);
    if(r.mode==='team'){
      const w=r.winTeam;title=w<0?'НИЧЬЯ':(w===C.myTeam?'ПОБЕДА':'ПОРАЖЕНИЕ');cls=w<0?'':(w===C.myTeam?'win':'lose');
      h+=`<div class="bigtxt ${cls}">${title}</div><div class="sub">Синие ${r.ts[0]} : ${r.ts[1]} Красные</div>`;
    }else{
      const place=sorted.findIndex(x=>x.id===C.myId)+1;
      title=sum.win?'ПОБЕДА':r.winner<0?'НИЧЬЯ':'МЕСТО '+place+' ИЗ '+sorted.length;cls=sum.win?'win':'';
      const wn=rows.find(x=>x.id===r.winner);
      h+=`<div class="bigtxt ${cls}">${title}</div><div class="sub">${wn?'Победитель: '+esc(wn.name):''}</div>`;
    }
    h+='<table class="tbl"><tr><th>Пилот</th><th>Сбито</th><th>Потери</th></tr>'+sorted.map(x=>`<tr class="${x.id===C.myId?'me ':''}${r.mode==='team'?(x.team===1?'r':'b'):''}"><td>${esc(x.name)}</td><td>${x.k}</td><td>${x.d}</td></tr>`).join('')+'</table>';
  }
  // что получено
  const g=['<div class="g">₵ +'+sum.credits+'</div>'];
  for(const a of sum.newAch)g.push(`<div class="g" style="border-color:var(--grn)">${a[1]} ${esc(a[2])}</div>`);
  for(const t of sum.tasks)g.push(`<div class="g" style="border-color:var(--amb)">📅 ${esc(t.text)} +₵${t.reward}</div>`);
  h+=`<div class="gain">${g.join('')}</div>`;
  // кнопки
  h+='<div class="row c" style="gap:10px;margin-top:10px" id="resBtns"></div><div class="link" id="resNext"></div>';
  box.innerHTML=h;
  const btns=$('resBtns');
  const mk=(t,cls,fn)=>{const b=el('button','btn '+cls,t);b.onclick=fn;btns.append(b);return b};
  if(r.mode==='run'){
    if(leader){
      const nextOk=sum.win&&!r.endless&&r.mission<5&&M.campOpen(r.mission+1);
      if(nextOk)mk('Дальше →','primary big',()=>{NET.send({action:'restart',mission:r.mission+1});});
      mk(sum.win?'Ещё раз':'Повторить','',()=>NET.send({action:'restart'}));
      if(NET.solo===false)mk('В лобби','',()=>NET.send({action:'to_lobby'}));
    }else $('resNext').textContent='Ждём решения создателя игры…';
    mk('В меню','ghost',()=>leaveToMenu());
  }else{
    if(leader&&!NET.solo){mk('В лобби','',()=>NET.send({action:'to_lobby'}))}
    mk('В меню','ghost',()=>leaveToMenu());
    let left=m.next||14;clearInterval(nextTimer);
    const upd=()=>{$('resNext').textContent='Следующий раунд через '+left+' с…';if(--left<0)clearInterval(nextTimer)};
    upd();nextTimer=setInterval(upd,1000);
    if(leader){mk('Сразу ещё раз','primary',()=>NET.send({action:'restart'}))}
  }
  $('results').classList.add('show');
  A.play(sum.win?'win':'lose');
}

// ---------- сообщения комнаты ----------
NET.cb.name=()=>M.P.name;
NET.cb.loadout=()=>M.loadout();
NET.cb.opts=()=>currentOpts();
NET.cb.status=netStatus;
NET.cb.hostTries=renderHostTries;
NET.cb.hidden=()=>{if(NET.solo&&C.scene==='game'&&!C.paused)C.togglePause()};
NET.cb.lost=text=>{netStatus(text);if(cur==='lobby')show('play'),netStatus(text)};
NET.cb.closed=text=>{if(text)toast(text,3500);C.leaveGame();closeOverlays();show('menu')};
NET.cb.msg=m=>{
  switch(m.type){
    case'lobby':
      if(cur==='game'&&m.started===false){C.leaveGame();closeOverlays();clearInterval(nextTimer)}
      if(cur!=='lobby'){show('lobby')}
      renderLobby();break;
    case'slots':
      NET.slots=m.slots;
      if(cur==='lobby')renderLobby();
      break;
    case'round':case'snap':case'me':case'roster':case'round_end':C.onNet(m);break;
    case'resume_failed':case'game_closed':
      toast(m.type==='game_closed'?'Создатель закрыл игру':'Эта игра уже закрыта',3500);
      C.leaveGame();closeOverlays();clearInterval(nextTimer);show('menu');break;
    case'error':netStatus('⚠️ '+m.message);toast(m.message,3000);break;
  }
};

// ---------- запуск ----------
function boot(){
  applySettings();
  if(!R.init($('stage'),M.S.quality)){
    $('boot').innerHTML='<div style="text-align:center;max-width:320px;line-height:1.6;padding:20px">Не удалось запустить 3D.<br><small>Нужен браузер с WebGL (Chrome, Safari, Firefox).</small></div>';return;
  }
  SW.HUD.init($('hud'));I.init();C.init();applySettings();
  addEventListener('resize',()=>{R.resize();SW.HUD.resize()});
  C.t0=undefined;requestAnimationFrame(C.frameFn);
  NET.detectServer();
  const bt=NET.boot();
  show('menu');
  if(bt&&bt.join){$('joinId').value=bt.join;show('play');NET.join(bt.join)}
  else if(bt&&bt.resume){show('play')}
  setTimeout(()=>$('boot').classList.add('gone'),250);
  // FPS
  let n=0,t0=performance.now();
  setInterval(()=>{const t=performance.now();$('fps').textContent=((C.frame-n)*1000/(t-t0)|0)+' fps';n=C.frame;t0=t},500);
  if('serviceWorker' in navigator&&NET.SERVED&&!NET.IN_APP)navigator.serviceWorker.register('sw.js').catch(()=>{});
}
SW.App={show,toast,boot,leaveToMenu,SU};
boot(); // скрипты стоят в конце страницы — всё уже разобрано, ждать загрузки шрифтов не нужно
})();
