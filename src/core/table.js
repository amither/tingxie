// 词表照片的图像处理：转正、找表格格子、裁格子、去表格线。
// 纯函数，不依赖 DOM，浏览器和 Node 都能用。图片统一为灰度 { width, height, data: Uint8Array }（0 黑 255 白）。

const MAX_SKEW = 6; // 只找 ±6° 以内的倾斜

const blankLike = (w, h) => ({ width: w, height: h, data: new Uint8Array(w * h).fill(255) });

export function toGray(rgba, width, height) {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  return { width, height, data };
}

// Otsu 阈值：把灰度分成黑白两类，使类间方差最大
function otsu({ data }) {
  const hist = new Array(256).fill(0);
  for (const v of data) hist[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = data.length - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const diff = sumB / wB - (sum - sumB) / wF;
    const between = wB * wF * diff * diff;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

// 1 = 黑（墨迹），0 = 白
function binarize(img) {
  const t = otsu(img);
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i] <= t ? 1 : 0;
  return out;
}

function sample(img, x, y) {
  const { width: w, height: h, data } = img;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 255;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const dx = x - x0, dy = y - y0;
  return data[y0 * w + x0] * (1 - dx) * (1 - dy) + data[y0 * w + x1] * dx * (1 - dy)
    + data[y1 * w + x0] * (1 - dx) * dy + data[y1 * w + x1] * dx * dy;
}

export function resize(img, f) {
  const out = blankLike(Math.max(1, Math.round(img.width * f)), Math.max(1, Math.round(img.height * f)));
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const sx = Math.min(img.width - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const sy = Math.min(img.height - 1, Math.max(0, (y + 0.5) / f - 0.5));
      out.data[y * out.width + x] = sample(img, sx, sy);
    }
  }
  return out;
}

// 绕中心把画面顺时针转 deg 度（y 轴向下，所以水平线会变成往右下斜）；空出来的地方填白
export function rotate(img, deg) {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const cx = (img.width - 1) / 2, cy = (img.height - 1) / 2;
  const out = blankLike(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const dx = x - cx, dy = y - cy;
      out.data[y * img.width + x] = sample(img, cx + cos * dx + sin * dy, cy - sin * dx + cos * dy);
    }
  }
  return out;
}

// 画面被顺时针转了多少度：沿各个角度把墨迹投影到竖直方向，表格线和文字行对齐时投影最“尖”
export function estimateSkew(img) {
  const f = Math.min(1, 1000 / img.width);
  const small = f < 1 ? resize(img, f) : img;
  const bin = binarize(small);
  const xs = [], ys = [];
  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) if (bin[y * small.width + x]) { xs.push(x); ys.push(y); }
  }
  if (xs.length === 0) return 0;
  const step = Math.max(1, Math.floor(xs.length / 200000));
  const cx = small.width / 2, size = small.height + small.width;
  const score = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180), hist = new Float64Array(size * 2);
    for (let i = 0; i < xs.length; i += step) hist[Math.round(ys[i] - (xs[i] - cx) * t) + size]++;
    let s = 0;
    for (const v of hist) s += v * v;
    return s;
  };
  let best = 0, bestScore = -1;
  for (let d = -MAX_SKEW; d <= MAX_SKEW + 1e-9; d += 0.25) {
    const s = score(d);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  const coarse = best;
  for (let d = coarse - 0.25; d <= coarse + 0.25 + 1e-9; d += 0.05) {
    const s = score(d);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  return Math.round(best * 100) / 100;
}

// 连续的下标归成一段（间隔不超过 gap）
function groups(indices, gap) {
  const out = [];
  for (const i of indices) {
    const last = out.at(-1);
    if (last && i - last.end <= gap) last.end = i; else out.push({ start: i, end: i });
  }
  return out;
}

// 一行里最长的“黑段”，允许中间断开不超过 gap 像素（照片里的线常有断点）。返回 { len, start, end }
function longestRun(n, isDark, gap) {
  let best = { len: 0, start: -1, end: -1 }, start = -1, lastDark = -1;
  for (let i = 0; i < n; i++) {
    if (!isDark(i)) continue;
    if (start < 0 || i - lastDark > gap + 1) start = i;
    lastDark = i;
    if (i - start + 1 > best.len) best = { len: i - start + 1, start, end: i };
  }
  return best;
}

// 找表格的格子：先找横线，再在相邻两条横线之间找贯穿整行的竖线。
// 一行的格子只取上下两条横线共同覆盖的横向范围：范围外的深色背景不算竖线；横线的两端也算边界（照片裁掉了边框时）。
// 返回 [[{ x0, y0, x1, y1 }, ...], ...]，每个元素是一行（从左到右），只含至少 2 格的行。
export function findCells(img) {
  const { width: W, height: H } = img;
  const bin = binarize(img);
  const dark = (x, y) => bin[y * W + x] === 1;

  // 横线：上下 2 像素内有墨迹就算（容许一点倾斜），最长黑段超过宽度的 1/4
  const lineRows = [], extent = new Map();
  for (let y = 0; y < H; y++) {
    const ys = [y - 2, y - 1, y, y + 1, y + 2].filter((v) => v >= 0 && v < H);
    const run = longestRun(W, (x) => ys.some((v) => dark(x, v)), 3);
    if (run.len >= W * 0.25) { lineRows.push(y); extent.set(y, run); }
  }
  const hLines = groups(lineRows, 3).map((g) => {
    let x0 = W, x1 = -1;
    for (let y = g.start; y <= g.end; y++) {
      const run = extent.get(y); // 组内允许有几行间隔，它们不是线
      if (run) { x0 = Math.min(x0, run.start); x1 = Math.max(x1, run.end); }
    }
    return { ...g, x0, x1 };
  });

  const minCell = Math.max(8, Math.round(W * 0.02));
  const rows = [];
  for (let k = 1; k < hLines.length; k++) {
    const a = hLines[k - 1], b = hLines[k];
    const top = a.end + 1, bottom = b.start - 1, h = bottom - top + 1;
    if (h < 12 || h > H * 0.25) continue;
    const left = Math.max(a.x0, b.x0), right = Math.min(a.x1, b.x1);
    if (right - left < W * 0.25) continue;
    // 竖线：在这一行的中间 80% 高度里，左右 r 像素内几乎每一行都有墨迹
    const r = Math.max(1, Math.round(h * 0.05));
    const y0 = top + Math.floor(h * 0.1), y1 = bottom - Math.floor(h * 0.1);
    const xs = [];
    for (let x = Math.max(0, left - r); x <= Math.min(W - 1, right + r); x++) {
      let hit = 0;
      for (let y = y0; y <= y1; y++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < W && dark(xx, y)) { hit++; break; }
        }
      }
      if (hit >= (y1 - y0 + 1) * 0.9) xs.push(x);
    }
    // 边界：竖线，加上横线两端（附近没有竖线时）
    const bounds = groups(xs, 2).map((g) => ({ start: g.start, end: g.end }));
    if (!bounds.length || bounds[0].start > left + minCell) bounds.unshift({ start: left - 1, end: left - 1 });
    if (bounds.at(-1).end < right - minCell) bounds.push({ start: right + 1, end: right + 1 });
    const cells = [];
    for (let j = 1; j < bounds.length; j++) {
      const x0 = bounds[j - 1].end + 2, x1 = bounds[j].start - 2;
      if (x1 - x0 + 1 >= minCell) cells.push({ x0, y0: top + 1, x1, y1: bottom - 1 });
    }
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

// 一行格子里哪个是英文、哪个是中文：窄格子是词性列，它左边是英文、右边是中文；没有词性列就两两配对
const narrowCells = (cells) => {
  const widths = cells.map((c) => c.x1 - c.x0 + 1);
  const med = [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)];
  return widths.map((w) => w < med * 0.6);
};

export function pairCells(cells) {
  if (cells.length < 2) return [];
  const narrow = narrowCells(cells);
  const pairs = [];
  if (narrow.some(Boolean)) {
    for (let j = 1; j < cells.length - 1; j++) {
      if (narrow[j] && !narrow[j - 1] && !narrow[j + 1]) pairs.push({ en: cells[j - 1], zh: cells[j + 1] });
    }
    return pairs;
  }
  for (let j = 0; j + 1 < cells.length; j += 2) pairs.push({ en: cells[j], zh: cells[j + 1] });
  return pairs;
}

// 整张表 → 每行的 [{ en, zh }]。表里有带词性列的行时，只要这一段：之后第一行没有词性列的（句子区）就停
export function wordPairs(rows) {
  const hasPos = rows.map((cells) => cells.length >= 3 && narrowCells(cells).some(Boolean));
  const first = hasPos.indexOf(true);
  if (first < 0) return rows.map(pairCells).filter((p) => p.length);
  const end = hasPos.indexOf(false, first);
  return rows.slice(first, end < 0 ? rows.length : end).map(pairCells).filter((p) => p.length);
}

// 格子上下再收一点再识别：斜拍时格子上下边可能带进一截横线，会被认成“一”之类的字。
// 左右不收：字常常紧贴左边的竖线，收了会切掉首字母
export function inset({ x0, y0, x1, y1 }) {
  const dy = Math.max(2, Math.round((y1 - y0 + 1) * 0.08));
  return { x0, y0: y0 + dy, x1, y1: y1 - dy };
}

// 裁出一个格子并放大，按这一格自己的亮度拉伸成白底黑字，四周留白（Tesseract 识别贴边的字不准）。
// 照片里纸是灰的：不拉伸的话，补的白边和灰底会被 Tesseract 分成两类，整个灰底被当成黑块
export function crop(img, { x0, y0, x1, y1 }, scale, border = 12) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const iw = Math.round(w * scale), ih = Math.round(h * scale);
  const inner = new Float32Array(iw * ih);
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const sx = x0 + Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const sy = y0 + Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
      inner[y * iw + x] = sample(img, sx, sy);
    }
  }
  // 用 Otsu 把这一格分成字和纸两类，各取平均亮度作为拉伸的两端（按百分位取会受字多字少影响，字少时会把字加粗）。
  // 两类差别很小说明格子里没字，不拉伸
  const q = { data: Uint8Array.from(inner, (v) => Math.round(v)) };
  const t = otsu(q);
  let inkSum = 0, inkN = 0, paperSum = 0, paperN = 0;
  for (const v of q.data) { if (v <= t) { inkSum += v; inkN++; } else { paperSum += v; paperN++; } }
  const ink = inkN ? inkSum / inkN : 0, paper = paperN ? paperSum / paperN : 255;
  const range = paper - ink;
  const out = blankLike(iw + border * 2, ih + border * 2);
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const v = inner[y * iw + x];
      out.data[(y + border) * out.width + x + border] = range < 40 ? v : Math.max(0, Math.min(255, ((v - ink) * 255) / range));
    }
  }
  return out;
}

// 把长横线、长竖线涂白（整页识别时表格线会被认成 | [ 之类的字符）
export function removeLines(img) {
  const { width: W, height: H } = img;
  const bin = binarize(img);
  const out = { width: W, height: H, data: Uint8Array.from(img.data) };
  const wipe = (n, at, min, paint) => {
    let start = -1;
    for (let i = 0; i <= n; i++) {
      if (i < n && at(i)) { if (start < 0) start = i; continue; }
      if (start >= 0 && i - start >= min) for (let k = start; k < i; k++) paint(k);
      start = -1;
    }
  };
  for (let y = 0; y < H; y++) wipe(W, (x) => bin[y * W + x], W * 0.12, (x) => { out.data[y * W + x] = 255; });
  for (let x = 0; x < W; x++) wipe(H, (y) => bin[y * W + x], Math.max(40, H * 0.04), (y) => { out.data[y * W + x] = 255; });
  return out;
}
