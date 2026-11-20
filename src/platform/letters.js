// 手写字母识别：笔画 → 28×28 灰度图 → 小卷积网络（纯 JS 推理，权重由 tools/handwriting/train.py 导出）
// 纯函数，不依赖 DOM，浏览器和 Node 都能用。

const SIZE = 28;
const BOX = 20;          // 笔画中心线的外框缩放到 20 像素见方（加上笔画粗细和模糊后约 23 像素，与 EMNIST 一致）
const LINE = 2.4;        // 笔画粗细（28 像素坐标系）
const SS = 4;            // 超采样倍数，用来抗锯齿

// strokes: [[[x, y], ...], ...]，任意坐标单位。minSize：外框小于它时不再放大（避免一个小点被放成一大团）
export function rasterize(strokes, { minSize = 1 } = {}) {
  const pts = strokes.flat();
  if (pts.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const s = BOX / Math.max(x1 - x0, y1 - y0, minSize);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const map = ([x, y]) => [(SIZE / 2 + (x - cx) * s) * SS, (SIZE / 2 + (y - cy) * s) * SS];

  // 超采样画布上逐段画粗线（到线段距离 ≤ 半径即为墨迹）
  const N = SIZE * SS, r = (LINE / 2) * SS, hi = new Uint8Array(N * N);
  for (const stroke of strokes) {
    const p = stroke.map(map);
    if (p.length === 1) p.push(p[0]);
    for (let k = 1; k < p.length; k++) {
      const [ax, ay] = p[k - 1], [bx, by] = p[k];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const minI = Math.max(0, Math.floor(Math.min(ax, bx) - r)), maxI = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + r));
      const minJ = Math.max(0, Math.floor(Math.min(ay, by) - r)), maxJ = Math.min(N - 1, Math.ceil(Math.max(ay, by) + r));
      for (let j = minJ; j <= maxJ; j++) {
        for (let i = minI; i <= maxI; i++) {
          const px = i + 0.5, py = j + 0.5;
          const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
          const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
          if (ex * ex + ey * ey <= r * r) hi[j * N + i] = 1;
        }
      }
    }
  }

  // 缩小到 28×28（取平均），再做一次 [1,2,1] 模糊，让边缘像 EMNIST 一样柔和
  const img = new Float32Array(SIZE * SIZE);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) img[((j / SS) | 0) * SIZE + ((i / SS) | 0)] += hi[j * N + i];
  for (let k = 0; k < img.length; k++) img[k] /= SS * SS;
  const blurred = blur(blur(img, 1, 0), 0, 1);
  let max = 0;
  for (const v of blurred) max = Math.max(max, v);
  if (max > 0) for (let k = 0; k < blurred.length; k++) blurred[k] /= max;
  return blurred;
}

function blur(src, dx, dy) {
  const out = new Float32Array(src.length);
  const at = (x, y) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? 0 : src[y * SIZE + x]);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      out[y * SIZE + x] = (at(x - dx, y - dy) + 2 * at(x, y) + at(x + dx, y + dy)) / 4;
    }
  }
  return out;
}

// 小写 i 有一个点：找一笔明显小于整体、且位于上方的笔画
export function hasDot(strokes) {
  if (strokes.length < 2) return false;
  const box = (pts) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  const all = box(strokes.flat());
  const height = Math.max(all.y1 - all.y0, 1);
  return strokes.some((s) => {
    const b = box(s);
    return Math.max(b.x1 - b.x0, b.y1 - b.y0) < height * 0.25 && (b.y0 + b.y1) / 2 < all.y0 + height * 0.4;
  });
}

// ---- 网络推理 ----

function conv3x3(input, C, H, W, weight, bias) {
  const O = bias.length, out = new Float32Array(O * H * W);
  for (let o = 0; o < O; o++) {
    const base = o * H * W;
    for (let k = 0; k < H * W; k++) out[base + k] = bias[o];
    for (let c = 0; c < C; c++) {
      const inC = c * H * W, wBase = (o * C + c) * 9;
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const w = weight[wBase + ky * 3 + kx];
          if (w === 0) continue;
          for (let y = 0; y < H; y++) {
            const sy = y + ky - 1;
            if (sy < 0 || sy >= H) continue;
            const row = inC + sy * W, outRow = base + y * W;
            for (let x = 0; x < W; x++) {
              const sx = x + kx - 1;
              if (sx >= 0 && sx < W) out[outRow + x] += w * input[row + sx];
            }
          }
        }
      }
    }
  }
  return out;
}

function reluPool(input, C, H, W) {
  const h = H >> 1, w = W >> 1, out = new Float32Array(C * h * w);
  for (let c = 0; c < C; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = c * H * W + 2 * y * W + 2 * x;
        out[c * h * w + y * w + x] = Math.max(0, input[i], input[i + 1], input[i + W], input[i + W + 1]);
      }
    }
  }
  return out;
}

function linear(input, weight, bias) {
  const n = input.length, out = new Float32Array(bias.length);
  for (let o = 0; o < bias.length; o++) {
    let s = bias[o];
    for (let i = 0; i < n; i++) s += weight[o * n + i] * input[i];
    out[o] = s;
  }
  return out;
}

// meta: letters.json 的内容；buffer: letters.bin 的 ArrayBuffer
export function createRecognizer(meta, buffer) {
  const all = new Float32Array(buffer);
  const t = {};
  for (const { name, shape, offset } of meta.tensors) t[name] = all.subarray(offset, offset + shape.reduce((a, b) => a * b, 1));
  const classes = meta.classes;

  function logits(img) {
    let x = reluPool(conv3x3(img, 1, 28, 28, t['conv1.w'], t['conv1.b']), 16, 28, 28);
    x = reluPool(conv3x3(x, 16, 14, 14, t['conv2.w'], t['conv2.b']), 32, 14, 14);
    x = reluPool(conv3x3(x, 32, 7, 7, t['conv3.w'], t['conv3.b']), 64, 7, 7);
    x = linear(x, t['fc1.w'], t['fc1.b']).map((v) => Math.max(0, v));
    return linear(x, t['fc2.w'], t['fc2.b']);
  }

  // 返回按概率排序的候选 [{ letter, p }]；没有笔画时返回 []
  function recognize(strokes, opts) {
    const img = rasterize(strokes, opts);
    if (!img) return [];
    const z = logits(img);
    const m = Math.max(...z);
    const e = Array.from(z, (v) => Math.exp(v - m));
    const sum = e.reduce((a, b) => a + b, 0);
    const p = new Map(e.map((v, k) => [classes[k], v / sum]));
    // EMNIST 里 i/l 都可能只是一竖：有点算 i，没点算 l（孩子写的是小写）
    const [from, to] = hasDot(strokes) ? ['l', 'i'] : ['i', 'l'];
    p.set(to, p.get(to) + p.get(from)); p.set(from, 0);
    return [...p].map(([letter, prob]) => ({ letter, p: prob })).sort((a, b) => b.p - a.p);
  }

  return { logits, recognize, rasterize };
}
