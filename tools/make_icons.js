// Генератор иконок: node tools/make_icons.js  → icons/*.png и android/res/mipmap-*/ic_launcher.png
// Чистый JS без зависимостей: каждый пиксель считается функцией shade(), PNG собирается вручную.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const root = path.join(__dirname, '..');

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function inRR(x, y, x0, y0, x1, y1, r) { if (x < x0 || x > x1 || y < y0 || y > y1) return false; const cx = Math.max(x0 + r, Math.min(x1 - r, x)), cy = Math.max(y0 + r, Math.min(y1 - r, y)); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; }
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; }
function rot(x, y, cx, cy, a) { const c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy; return [cx + dx * c + dy * s, cy - dx * s + dy * c]; }
function mix(a, b, t) { t = Math.max(0, Math.min(1, t)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function segDist(x, y, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - ax - dx * t, y - ay - dy * t); }

const CY = [49, 230, 255], MG = [255, 63, 180], AM = [255, 179, 71];
function shade(x, y) {
  if (!inRR(x, y, 0, 0, 1, 1, .22)) return null;
  // небо: от тёмно-синего к фиолетовому, на горизонте розовое сияние
  let col = mix([5, 8, 28], [58, 16, 88], Math.pow(y, 1.4));
  col = mix(col, MG, Math.max(0, 1 - Math.abs(y - .8) / .16) * .5);
  // «неоновая сетка» внизу
  if (y > .8) {
    col = mix(col, [10, 8, 30], .7);
    const k = (y - .8) / .2, hx = Math.abs(((y - .8) * 40) % 1 - .5);
    if (hx > .44 && k > 0) col = mix(col, CY, .6);
    const vx = (x - .5) / (k * .9 + .08), vf = Math.abs((vx * 5) % 1 - .5);
    if (vf > .46) col = mix(col, MG, .5);
  }
  // звёзды
  const sd = Math.sin(Math.floor(x * 140) * 12.9898 + Math.floor(y * 140) * 78.233) * 43758.5453; if (y < .55 && sd - Math.floor(sd) > .992) col = mix(col, [255, 255, 255], .8);
  // дрон: центр (.5,.46), чуть накренён
  const q = rot(x, y, .5, .46, -.28), qx = q[0], qy = q[1];
  const glow = Math.max(0, 1 - Math.hypot(qx - .5, qy - .46) / .42); col = mix(col, CY, glow * glow * .34);
  // лучи-рамы
  const rotors = [[.27, .27], [.73, .27], [.27, .65], [.73, .65]];
  for (const r of rotors) if (segDist(qx, qy, .5, .46, r[0], r[1]) < .016) col = [30, 44, 66];
  for (const r of rotors) {
    const d = Math.hypot(qx - r[0], qy - r[1]);
    if (d < .115) col = mix(col, CY, .16);
    if (d > .093 && d < .115) col = mix(CY, [255, 255, 255], .35);
    if (d < .02) col = [20, 30, 48];
    // лопасти
    const a = .5; if (d < .092 && (segDist(qx, qy, r[0] - .09 * Math.cos(a), r[1] - .09 * Math.sin(a), r[0] + .09 * Math.cos(a), r[1] + .09 * Math.sin(a)) < .007)) col = mix(col, [15, 25, 40], .75);
  }
  // корпус
  const body = [[.5, .24], [.585, .42], [.57, .64], [.5, .68], [.43, .64], [.415, .42]];
  if (inPoly(qx, qy, body)) { col = mix([200, 235, 255], [60, 120, 170], (qy - .24) / .44); if (qx > .5) col = mix(col, [20, 60, 100], .25); }
  if (inPoly(qx, qy, [[.5, .3], [.545, .44], [.5, .5], [.455, .44]])) col = mix(MG, [255, 160, 220], (qy - .3) / .2);
  if (qy > .56 && qy < .6 && Math.abs(qx - .5) < .06) col = AM;
  return [col[0], col[1], col[2], 255];
}
function render(size, SS) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const c = shade((px + (sx + .5) / SS) / size, (py + (sy + .5) / SS) / size); if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; } }
    const n = SS * SS, o = (py * size + px) * 4, aa = a / n;
    buf[o] = aa ? r / (a / 255) : 0; buf[o + 1] = aa ? g / (a / 255) : 0; buf[o + 2] = aa ? b / (a / 255) : 0; buf[o + 3] = aa;
  }
  return png(size, size, buf);
}
const out = [['icons/icon-512.png', 512], ['icons/icon-192.png', 192], ['icons/icon-180.png', 180], ['android/res/mipmap-xxhdpi/ic_launcher.png', 180], ['android/res/mipmap-xxxhdpi/ic_launcher.png', 192]];
const cache = {};
out.forEach(([f, s]) => {
  const p = path.join(root, f);
  if (f.startsWith('android') && !fs.existsSync(path.join(root, 'android'))) return; // обёртка ещё не создана
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, cache[s] || (cache[s] = render(s, s > 300 ? 3 : 4)));
  console.log('wrote', f, s);
});
