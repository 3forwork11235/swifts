const SW=require('./load.js');
const args=process.argv.slice(2);
const map=args[0]||'city',secs=+args[1]||180,nb=+args[2]||6,diff=args[3]||'normal',mode=args[4]||'ffa';
let fail=0;const ok=(c,m)=>{if(!c){console.log('FAIL',m);fail++}};
const A=new SW.Arena({map,seed:7,mode,opts:{frags:999,time:secs+60,assist:1,diff,mission:0},simSeed:42});
for(let i=0;i<nb;i++)A.addDrone({id:i+1,slot:'P'+i,kind:'bot',team:mode==='team'?i%2:i,hull:SW.HULL_IDS[i%4],mods:[],name:SW.CALLSIGNS[i],diff});
A.begin();
const cnt={cr:0,k:0,m:0,f:0,x:0,h:0,icp:0};const how={};let maxSnap=0,t0=Date.now(),snapBytes=0,snaps=0;
const dt=SW.TICK;
for(let i=0;i<secs/dt;i++){
  A.step(dt);
  if(i%SW.SNAP_EVERY===0){
    const s=A.snapshot();const js=JSON.stringify(s);maxSnap=Math.max(maxSnap,js.length);snapBytes+=js.length;snaps++;
    for(const e of s.ev||[]){cnt[e[0]]=(cnt[e[0]]||0)+1;if(e[0]==='k')how[e[3]]=(how[e[3]]||0)+1}
    for(const d of s.d)for(const v of d)ok(Number.isFinite(v),'NaN in snapshot');
  }
  for(const d of A.drones){
    if(!d.alive)continue;
    ok(Number.isFinite(d.x+d.y+d.z+d.yaw+d.pitch+d.spd),'NaN state '+d.name);
    if(A.world.hitSphere(d.x,d.y,d.z,d.H.r-0.5))ok(false,'drone inside geometry '+d.name+' t='+A.t.toFixed(1));
  }
}
const ms=Date.now()-t0;
console.log(`${map} ${nb} bots ${secs}s sim in ${ms}ms (${(ms/(secs/dt)).toFixed(3)} ms/tick); snap avg ${(snapBytes/snaps)|0}B max ${maxSnap}B`);
console.log('events',JSON.stringify(cnt),'kills by',JSON.stringify(how));
console.log(A.drones.map(d=>`${d.name}[${d.hullId}] k${d.st.k} d${d.st.d} dmg${Math.round(d.st.dmg)} shots${d.st.shots} icp${d.st.icp}${d.alive?'':' (dead)'}`).join('\n'));
const crashes=cnt.cr||0;
console.log('crashes per drone-minute:',(crashes/(nb*secs/60)).toFixed(2));
ok(!fail,'');
console.log(fail?'FAILED':'sim OK');process.exit(fail?1:0);
