// 生成 PWA 图标（无依赖）：橙色底，一张略微倾斜的四线三格作业卡，上面手写 abc，右下角一个绿色对勾。
// 用法：node scripts/make-icons.mjs
// 图形用有向距离函数描述（坐标 0..1，y 向下），逐像素超采样抗锯齿。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

// ---- PNG 编码 ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
}
function encodePng(size, rgb) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- 距离函数（负数在形状内） ----
const len = (x, y) => Math.hypot(x, y);
function roundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function segment(px, py, ax, ay, bx, by, w) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return len(px - ax - t * dx, py - ay - t * dy) - w / 2;
}
const ring = (px, py, cx, cy, r, w) => Math.abs(len(px - cx, py - cy) - r) - w / 2;
// 圆弧：从角度 a0 顺时针到 a1（度，0 指向右，y 向下所以顺时针看起来是往下转）
function arc(px, py, cx, cy, r, a0, a1, w) {
  const ang = (Math.atan2(py - cy, px - cx) * 180 / Math.PI + 360) % 360;
  const span = (a1 - a0 + 360) % 360, rel = (ang - a0 + 360) % 360;
  if (rel <= span) return Math.abs(len(px - cx, py - cy) - r) - w / 2;
  const end = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = end(a0), [x1, y1] = end(a1);
  return Math.min(len(px - x0, py - y0), len(px - x1, py - y1)) - w / 2;
}
const circle = (px, py, cx, cy, r) => len(px - cx, py - cy) - r;

// ---- 图案 ----
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const ORANGE_TOP = hex('#fbbf24'), ORANGE_BOTTOM = hex('#f59e0b');
const WHITE = [255, 255, 255], INK = hex('#1f2937'), GRID = hex('#cbd5e1'), BASELINE = hex('#fca5a5');
const GREEN = hex('#16a34a'), SHADOW = hex('#92400e');

// 作业卡：中心、半宽高、倾斜角
const CARD = { cx: 0.47, cy: 0.45, hw: 0.36, hh: 0.27, r: 0.06, tilt: -6 };
const cos = Math.cos(CARD.tilt * Math.PI / 180), sin = Math.sin(CARD.tilt * Math.PI / 180);
// 把画面坐标转到作业卡自己的（未倾斜）坐标
const toCard = (x, y) => {
  const dx = x - CARD.cx, dy = y - CARD.cy;
  return [CARD.cx + dx * cos + dy * sin, CARD.cy - dx * sin + dy * cos];
};

// 四线三格（卡内坐标）：第三条是红色基线
const LINES = [0.30, 0.39, 0.53, 0.62];
const LINE_W = 0.007;
const PEN = 0.032; // 字的笔画粗细
const X_TOP = LINES[1], BASE = LINES[2], MID = (X_TOP + BASE) / 2, R = (BASE - X_TOP) / 2;
const letters = (x, y) => Math.min(
  // a：一个圆 + 右侧竖笔
  ring(x, y, 0.255, MID, R, PEN), segment(x, y, 0.255 + R, X_TOP, 0.255 + R, BASE, PEN),
  // b：高竖笔 + 右侧圆
  segment(x, y, 0.405, LINES[0] - 0.01, 0.405, BASE, PEN), ring(x, y, 0.405 + R, MID, R, PEN),
  // c：开口朝右的圆弧
  arc(x, y, 0.64, MID, R, 40, 320, PEN),
);

// 对勾徽章
const BADGE = { cx: 0.76, cy: 0.76, r: 0.15 };
const check = (x, y) => Math.min(
  segment(x, y, 0.695, 0.765, 0.745, 0.815, 0.045),
  segment(x, y, 0.745, 0.815, 0.835, 0.71, 0.045),
);

// 逐层合成：每层给出 [颜色, 覆盖率 0..1]
function shade(x, y) {
  let c = ORANGE_TOP.map((v, i) => v + (ORANGE_BOTTOM[i] - v) * y);
  const over = (col, a) => { if (a > 0) c = c.map((v, i) => v + (col[i] - v) * a); };

  const [kx, ky] = toCard(x, y);
  const [sx, sy] = toCard(x - 0.012, y - 0.022); // 投影向右下偏
  const dShadow = roundRect(sx, sy, CARD.cx, CARD.cy, CARD.hw, CARD.hh, CARD.r);
  over(SHADOW, 0.28 * Math.max(0, Math.min(1, 1 - dShadow / 0.035)));

  if (roundRect(kx, ky, CARD.cx, CARD.cy, CARD.hw, CARD.hh, CARD.r) < 0) {
    over(WHITE, 1);
    if (kx > CARD.cx - CARD.hw + 0.04 && kx < CARD.cx + CARD.hw - 0.04) {
      LINES.forEach((ly, k) => { if (Math.abs(ky - ly) < LINE_W / 2) over(k === 2 ? BASELINE : GRID, 1); });
    }
    if (letters(kx, ky) < 0) over(INK, 1);
  }

  const dBadge = circle(x, y, BADGE.cx, BADGE.cy, BADGE.r);
  if (dBadge < 0.022) over(WHITE, 1); // 白边
  if (dBadge < 0) over(GREEN, 1);
  if (check(x, y) < 0) over(WHITE, 1);
  return c;
}

function render(size, ss = 4) {
  const rgb = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const col = shade((px + (i + 0.5) / ss) / size, (py + (j + 0.5) / ss) / size);
          acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2];
        }
      }
      const o = (py * size + px) * 3;
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.round(acc[k] / (ss * ss));
    }
  }
  return encodePng(size, rgb);
}

mkdirSync('icons', { recursive: true });
for (const size of [180, 512]) writeFileSync(`icons/icon-${size}.png`, render(size));
console.log('icons/icon-180.png, icons/icon-512.png');
