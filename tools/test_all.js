// Запуск всех проверок общего ядра и комнаты: node tools/test_all.js
// (без браузера: мир, полёт, бой ботов, миссии автопилотом, комната, предсказание при задержках сети)
const { spawnSync } = require('child_process');
const path = require('path');
const tests = [
  ['мир (генерация, лучи, маршруты)', 'test_world.js', []],
  ['полёт', 'test_flight.js', []],
  ['бой ботов: город', 'test_sim.js', ['city', '90', '6']],
  ['бой ботов: каньон, команды', 'test_sim.js', ['canyon', '90', '6', 'normal', 'team']],
  ['бой ботов: порт, асы', 'test_sim.js', ['port', '90', '6', 'ace']],
  ['комната (лобби, ввод, возврат, раунды)', 'test_hub.js', []],
  ['помощь прицела', 'test_assist.js', []],
  ['предсказание при задержках', 'test_predict.js', []],
];
let bad = 0;
for (const [name, file, args] of tests) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { encoding: 'utf8', timeout: 300000 });
  const ok = r.status === 0;
  if (!ok) bad++;
  console.log((ok ? '✔ ' : '✘ ') + name + ' (' + (Date.now() - t0) + ' мс)');
  if (!ok) console.log((r.stdout || '') + (r.stderr || ''));
}
console.log(bad ? 'Провалено проверок: ' + bad : 'Все проверки пройдены');
process.exit(bad ? 1 : 0);
