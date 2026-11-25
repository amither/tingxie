import test from 'node:test';
import assert from 'node:assert/strict';
import { toGray, rotate, estimateSkew, findCells, pairCells, wordPairs, inset, crop, removeLines, resize } from '../src/core/table.js';

// ---- 合成图片：白底，画表格线和“字”（一串小黑块） ----
const blank = (w, h) => ({ width: w, height: h, data: new Uint8Array(w * h).fill(255) });
function rect(img, x0, y0, x1, y1, v = 0) {
  for (let y = Math.max(0, y0); y <= Math.min(img.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(img.width - 1, x1); x++) img.data[y * img.width + x] = v;
  }
}
// 一个格子里的“字”：几个小方块，不会连成长线
function word(img, x0, y0, x1, y1) {
  const h = y1 - y0, top = y0 + Math.round(h * 0.3), bottom = y0 + Math.round(h * 0.7);
  for (let x = x0 + 6; x + 8 < x1 - 6; x += 14) rect(img, x, top, x + 8, bottom);
}
// 词表：colWidths 是每列宽度，画 nRows 行；返回列边界
function table(img, x0, y0, colWidths, rowH, nRows, line = 2) {
  const xs = [x0];
  for (const w of colWidths) xs.push(xs.at(-1) + w);
  const yEnd = y0 + rowH * nRows;
  for (let r = 0; r <= nRows; r++) rect(img, x0, y0 + r * rowH, xs.at(-1) + line - 1, y0 + r * rowH + line - 1);
  for (const x of xs) rect(img, x, y0, x + line - 1, yEnd + line - 1);
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < colWidths.length; c++) word(img, xs[c] + line, y0 + r * rowH + line, xs[c + 1], y0 + (r + 1) * rowH);
  }
  return xs;
}
// 双栏词表：英文 | 词性 | 中文 | 英文 | 词性 | 中文
const COLS = [170, 50, 200, 170, 50, 200];
function wordTable(nRows = 6) {
  const img = blank(900, 120 + 50 * nRows + 60);
  table(img, 20, 60, COLS, 50, nRows);
  return img;
}

test('toGray: RGBA 按亮度转灰度', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  const g = toGray(rgba, 3, 1);
  assert.deepEqual([g.width, g.height], [3, 1]);
  assert.equal(g.data[0], 255);
  assert.equal(g.data[1], 0);
  assert.ok(g.data[2] > 60 && g.data[2] < 90);
});

test('findCells: 正拍的双栏词表，每行 6 格，宽度与列宽一致', () => {
  const rows = findCells(wordTable(6));
  assert.equal(rows.length, 6);
  for (const cells of rows) {
    assert.equal(cells.length, 6);
    cells.forEach((c, k) => assert.ok(Math.abs(c.x1 - c.x0 + 1 - COLS[k]) <= 12, `第 ${k} 格宽 ${c.x1 - c.x0 + 1}`));
    assert.ok(cells.every((c) => c.y1 - c.y0 > 30));
  }
});

test('findCells: 格子边上的细缝不算格子', () => {
  const img = wordTable(3);
  rect(img, 20 + 840 + 5, 60, 20 + 840 + 6, 60 + 150); // 最右边再贴一条竖线，留下 3 像素的缝
  const rows = findCells(img);
  assert.ok(rows.every((cells) => cells.length === 6));
});

test('findCells: 没有表格时返回空数组', () => {
  const img = blank(600, 400);
  word(img, 50, 50, 500, 90);
  assert.deepEqual(findCells(img), []);
});

test('findCells: 表格外面的深色背景（截图里的手机边框）不算格子', () => {
  const img = wordTable(3);
  rect(img, 0, 0, 8, img.height - 1);                 // 左边黑边
  rect(img, img.width - 9, 0, img.width - 1, img.height - 1); // 右边黑边
  const rows = findCells(img);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((cells) => cells.length === 6), rows.map((r) => r.length).join(','));
});

test('findCells: 照片把表格最右边裁掉了（没有右边框），最后一格仍然算', () => {
  const img = blank(800, 300);
  table(img, 20, 60, COLS, 50, 3); // 表格比图片宽，右边框画在图片外面
  const rows = findCells(img);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((cells) => cells.length === 6), rows.map((r) => r.length).join(','));
  assert.ok(rows[0][5].x1 >= 790);
});

test('estimateSkew + rotate: 能测出倾斜角，转正后能找到格子', () => {
  const tilted = rotate(wordTable(6), 2);
  const skew = estimateSkew(tilted);
  assert.ok(Math.abs(skew - 2) <= 0.3, `skew=${skew}`);
  const rows = findCells(rotate(tilted, -skew));
  assert.ok(rows.length >= 5, `rows=${rows.length}`);
  assert.ok(rows.every((cells) => cells.length === 6));
});

test('estimateSkew: 没倾斜时接近 0', () => {
  assert.ok(Math.abs(estimateSkew(wordTable(6))) <= 0.2);
});

test('findCells: 残留一点倾斜（0.4°）也能找到', () => {
  const rows = findCells(rotate(wordTable(6), 0.4));
  assert.ok(rows.length >= 5, `rows=${rows.length}`);
  assert.ok(rows.every((cells) => cells.length === 6));
});

const cell = (x0, x1) => ({ x0, x1, y0: 0, y1: 40 });
test('pairCells: 词性列左边是英文、右边是中文', () => {
  const cells = [cell(0, 136), cell(140, 188), cell(192, 377), cell(380, 550), cell(554, 597), cell(600, 772)];
  assert.deepEqual(pairCells(cells), [{ en: cells[0], zh: cells[2] }, { en: cells[3], zh: cells[5] }]);
});

test('pairCells: 没有词性列时两两配对', () => {
  const cells = [cell(0, 300), cell(304, 600)];
  assert.deepEqual(pairCells(cells), [{ en: cells[0], zh: cells[1] }]);
});

test('pairCells: 只有一格（标题、整行说明）不配对', () => {
  assert.deepEqual(pairCells([cell(0, 800)]), []);
});

test('crop: 裁出格子、按倍数放大，四周留白', () => {
  const img = blank(100, 60);
  rect(img, 30, 20, 39, 29);
  const out = crop(img, { x0: 25, y0: 15, x1: 44, y1: 34 }, 2, 10);
  assert.equal(out.width, 20 * 2 + 20);
  assert.equal(out.height, 20 * 2 + 20);
  assert.equal(out.data[0], 255);
  const mid = out.data[Math.floor(out.height / 2) * out.width + Math.floor(out.width / 2)];
  assert.ok(mid < 50);
});

test('crop: 灰底的格子拉伸成白底黑字（照片里纸是灰的，补的白边不能比底色亮太多）', () => {
  const img = blank(100, 60);
  rect(img, 0, 0, 99, 59, 180); // 灰底
  rect(img, 30, 20, 39, 29, 40); // 字
  const out = crop(img, { x0: 20, y0: 10, x1: 49, y1: 39 }, 1, 10);
  assert.ok(out.data[(10 + 2) * out.width + 10 + 2] > 240, '底色应接近白');
  assert.ok(out.data[25 * out.width + 25] < 30, '字应接近黑');
});

test('wordPairs: 有词性列的词表，遇到第一行没有词性列的（句子区）就停', () => {
  const word = [cell(0, 136), cell(140, 188), cell(192, 377), cell(380, 550), cell(554, 597), cell(600, 772)];
  const sentence = [cell(0, 377), cell(380, 772)];
  const pairs = wordPairs([sentence, word, word, sentence, word]);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0], [{ en: word[0], zh: word[2] }, { en: word[3], zh: word[5] }]);
});

test('wordPairs: 没有词性列的两栏表，每行都要', () => {
  const row = [cell(0, 300), cell(304, 600)];
  assert.equal(wordPairs([row, row, row]).length, 3);
});

test('inset: 格子上下各收 8%（至少 2 像素），左右不收', () => {
  assert.deepEqual(inset({ x0: 100, y0: 200, x1: 299, y1: 249 }), { x0: 100, y0: 204, x1: 299, y1: 245 });
  assert.deepEqual(inset({ x0: 0, y0: 0, x1: 99, y1: 19 }), { x0: 0, y0: 2, x1: 99, y1: 17 });
});

test('removeLines: 去掉表格线，保留字', () => {
  const img = wordTable(3);
  const out = removeLines(img);
  const darkRow = (y) => { let n = 0; for (let x = 0; x < out.width; x++) if (out.data[y * out.width + x] < 128) n++; return n; };
  assert.ok(darkRow(60) < 20, '横线应被去掉');
  // 第一行第一格里的字还在
  let ink = 0;
  for (let y = 62; y < 110; y++) for (let x = 22; x < 190; x++) if (out.data[y * out.width + x] < 128) ink++;
  assert.ok(ink > 100);
});

test('resize: 按倍数缩放', () => {
  const out = resize(blank(10, 4), 2.5);
  assert.deepEqual([out.width, out.height], [25, 10]);
});
