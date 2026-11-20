import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rasterize, hasDot, createRecognizer } from '../src/platform/letters.js';

const at = (img, x, y) => img[y * 28 + x];
const inkBox = (img, th = 0.3) => {
  let x0 = 28, x1 = -1, y0 = 28, y1 = -1;
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) if (at(img, x, y) > th) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};

test('rasterize: 没有笔画返回 null', () => {
  assert.equal(rasterize([]), null);
});

test('rasterize: 一竖居中，高度约 23 像素，最亮处为 1', () => {
  const img = rasterize([[[50, 10], [50, 110]]]);
  const b = inkBox(img);
  assert.ok(b.h >= 21 && b.h <= 25, `h=${b.h}`);
  assert.ok(b.w <= 5, `w=${b.w}`);
  assert.ok(Math.abs(b.cx - 13.5) <= 1 && Math.abs(b.cy - 13.5) <= 1, `center=${b.cx},${b.cy}`);
  assert.equal(Math.max(...img), 1);
});

test('rasterize: 与书写大小和位置无关', () => {
  const small = rasterize([[[0, 0], [10, 10]], [[0, 10], [10, 0]]]);
  const big = rasterize([[[300, 300], [400, 400]], [[300, 400], [400, 300]]]);
  for (let k = 0; k < 784; k++) assert.ok(Math.abs(small[k] - big[k]) < 1e-5);
});

test('rasterize: minSize 防止一个小点被放大成一团', () => {
  const dot = rasterize([[[5, 5], [6, 6]]], { minSize: 100 });
  assert.ok(inkBox(dot).w <= 5);
});

test('hasDot: 一竖没有点；一竖加上方的小点有点', () => {
  const stem = [[50, 40], [50, 110]];
  assert.equal(hasDot([stem]), false);
  assert.equal(hasDot([stem, [[50, 10], [51, 12]]]), true);
  assert.equal(hasDot([stem, [[50, 105], [51, 107]]]), false); // 小笔画在下方不算
  assert.equal(hasDot([[[0, 0], [100, 100]], [[0, 100], [100, 0]]]), false); // 两笔都很大
});

const model = () => {
  const meta = JSON.parse(readFileSync(new URL('../models/letters.json', import.meta.url)));
  const bin = readFileSync(new URL('../models/letters.bin', import.meta.url));
  return createRecognizer(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
};

test('推理与 PyTorch 导出的 logits 一致', () => {
  const sample = JSON.parse(readFileSync(new URL('./fixtures/letters-sample.json', import.meta.url)));
  const { logits } = model();
  sample.inputs.forEach((input, n) => {
    const z = logits(Float32Array.from(input));
    sample.logits[n].forEach((v, k) => assert.ok(Math.abs(z[k] - v) < 1e-3, `sample ${n} class ${k}: ${z[k]} vs ${v}`));
  });
});

test('recognize: 没点的一竖认作 l，加点认作 i', () => {
  const { recognize } = model();
  const stem = [[50, 40], [50, 110]];
  assert.equal(recognize([stem])[0].letter, 'l');
  assert.equal(recognize([stem, [[50, 12], [51, 14]]])[0].letter, 'i');
  assert.deepEqual(recognize([]), []);
});
