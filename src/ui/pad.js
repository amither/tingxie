// 手写板：按单词的字母个数 + 3 固定格数，一格写一个字母，写完一笔就识别
import { h } from './dom.js';
import { createRecognizer } from '../platform/letters.js';
import { assembleCells } from '../core/assemble.js';

const CELL_W = 84;
const CELL_H = 112;
const EXTRA_CELLS = 3; // 留出短语里的空格和写错时的余量

// 只数字母；短语的空格也要占一格，所以留 EXTRA_CELLS 个余量
export function cellCount(word) {
  return (word.match(/[a-z]/gi) ?? []).length + EXTRA_CELLS;
}

let recognizerPromise = null;
export function loadRecognizer() {
  const get = (url, as) => fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r[as]();
  });
  recognizerPromise ??= Promise.all([get('models/letters.json', 'json'), get('models/letters.bin', 'arrayBuffer')])
    .then(([meta, bin]) => createRecognizer(meta, bin))
    .catch((e) => { recognizerPromise = null; throw e; }); // 失败了下次再试
  return recognizerPromise;
}

let penSeen = false; // 用过 Apple Pencil 后忽略手指/手掌的触摸

export function createPad(recognizer, word) {
  const el = h('div', { class: 'pad-cells' });
  const cells = [];
  let lastCell = null;
  let locked = false;

  function recognize(cell) {
    const pts = cell.strokes.flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const extent = pts.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
    // 没写，或只是不小心点了一下，都当空格子
    cell.letter = extent < CELL_H * 0.06 ? '' : recognizer.recognize(cell.strokes, { minSize: CELL_H * 0.25 })[0].letter;
    cell.guess.textContent = cell.letter;
  }

  function addCell() {
    const pad = h('canvas', { class: 'pad' });
    const guess = h('div', { class: 'pad-guess' });
    const clear = h('button', { class: 'pad-clear', 'aria-label': '擦掉这一格' }, '✕');
    const cell = { strokes: [], letter: '', guess };
    cell.wrap = h('div', { class: 'pad-cell' }, pad, guess, clear);

    const dpr = window.devicePixelRatio || 1;
    pad.width = CELL_W * dpr; pad.height = CELL_H * dpr;
    const ctx = pad.getContext('2d');
    ctx.scale(dpr, dpr);
    cell.redraw = () => {
      ctx.clearRect(0, 0, CELL_W, CELL_H);
      [0.18, 0.4, 0.62, 0.84].forEach((f, k) => { // 四线三格，第三条线是基线
        ctx.strokeStyle = k === 2 ? '#fca5a5' : '#cbd5e1'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(4, CELL_H * f); ctx.lineTo(CELL_W - 4, CELL_H * f); ctx.stroke();
      });
      ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of cell.strokes) {
        ctx.beginPath(); ctx.moveTo(...s[0]);
        for (const p of s.length > 1 ? s.slice(1) : [s[0]]) ctx.lineTo(...p);
        ctx.stroke();
      }
    };
    cell.redraw();

    let active = null, current = null;
    const point = (e) => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    pad.addEventListener('pointerdown', (e) => {
      if (locked || active !== null) return;
      if (e.pointerType === 'pen') penSeen = true;
      else if (e.pointerType === 'touch' && penSeen) return;
      e.preventDefault();
      active = e.pointerId; pad.setPointerCapture(e.pointerId);
      current = [point(e)]; cell.strokes.push(current); lastCell = cell;
      cell.redraw();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      for (const ev of e.getCoalescedEvents?.() ?? [e]) current.push(point(ev));
      cell.redraw();
    });
    const end = (e) => { if (e.pointerId !== active) return; active = null; recognize(cell); };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    clear.addEventListener('click', () => { if (locked) return; cell.strokes = []; cell.redraw(); recognize(cell); });

    cells.push(cell);
    el.append(cell.wrap);
  }

  for (let i = 0; i < cellCount(word ?? ''); i++) addCell();

  return {
    el,
    value: () => assembleCells(cells.map((c) => c.letter)),
    undo() {
      if (locked || !lastCell?.strokes.length) return;
      lastCell.strokes.pop(); lastCell.redraw(); recognize(lastCell);
    },
    clearAll() {
      if (locked) return;
      for (const c of cells) { c.strokes = []; c.letter = ''; c.guess.textContent = ''; c.redraw(); }
    },
    lock() { locked = true; el.classList.add('locked'); },
  };
}
