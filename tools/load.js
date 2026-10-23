// Загружает общие файлы игры в Node (в том же порядке, что и в index.html) — для тестов.
const path=require('path');
const root=path.join(__dirname,'..');
const files=['core.js','data.js','world.js','flight.js','ai.js','missions.js','sim.js','combat.js','sites.js','modes.js','room.js','predict.js'];
for(const f of files){
  try{require(path.join(root,f))}catch(e){if(e.code==='MODULE_NOT_FOUND'&&String(e.message).includes(f))continue;throw e}
}
module.exports=globalThis.SW;
