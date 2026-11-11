import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERVAL_DAYS, newCard, isNew, gradeCorrect, markWrong, markRetryCorrect,
  pickSession, pickPractice, summary,
} from '../src/core/scheduler.js';

const NOW = new Date(2026, 10, 10, 15, 30); // 2026-11-10 15:30 本地时间
const day = (offset) => { const d = new Date(2026, 10, 10 + offset); return d.getTime(); };
const card = (over = {}) => ({ ...newCard({ en: 'cat', zh: '猫', batch: 'L8' }, NOW), ...over });

test('newCard 初始为新词', () => {
  const c = newCard({ en: 'cat', zh: '猫', batch: 'L8' }, NOW);
  assert.equal(c.box, 0);
  assert.equal(c.firstSeenAt, null);
  assert.ok(isNew(c));
  assert.ok(c.id);
});

test('gradeCorrect: 盒子 +1，按间隔算到期日（当天零点起算）', () => {
  const c = gradeCorrect(card(), NOW);
  assert.equal(c.box, 1);
  assert.equal(c.dueAt, day(1));
  assert.equal(c.reps, 1);
  assert.equal(c.firstSeenAt, NOW.getTime());
  assert.ok(!isNew(c));
});

test('gradeCorrect: 逐级拉长间隔，封顶 30 天', () => {
  let c = card();
  const dues = [];
  for (let i = 0; i < 7; i++) { c = gradeCorrect(c, NOW); dues.push([c.box, c.dueAt]); }
  assert.deepEqual(dues.map((d) => d[0]), [1, 2, 3, 4, 5, 5, 5]);
  assert.equal(dues[1][1], day(3));
  assert.equal(dues[2][1], day(7));
  assert.equal(dues[3][1], day(14));
  assert.equal(dues[4][1], day(30));
  assert.equal(dues[6][1], day(30));
  assert.deepEqual(INTERVAL_DAYS, [0, 1, 3, 7, 14, 30]);
});

test('markWrong: 盒子归 0，lapses +1，立即到期', () => {
  const c = markWrong(card({ box: 3, reps: 3 }), NOW);
  assert.equal(c.box, 0);
  assert.equal(c.lapses, 1);
  assert.equal(c.dueAt, NOW.getTime());
  assert.equal(c.reps, 3);
  assert.equal(c.firstSeenAt, NOW.getTime());
});

test('markRetryCorrect: 盒子保持 0，明天到期', () => {
  const c = markRetryCorrect(markWrong(card(), NOW), NOW);
  assert.equal(c.box, 0);
  assert.equal(c.dueAt, day(1));
  assert.equal(c.lapses, 1);
});

test('函数不修改入参', () => {
  const c = card();
  gradeCorrect(c, NOW);
  assert.equal(c.box, 0);
});

const SETTINGS = { sessionSize: 10, newPerDay: 5 };
const seen = (over) => card({ firstSeenAt: day(-3), ...over });

test('pickSession: 先取到期词，盒子低优先，同盒子按到期时间', () => {
  const a = seen({ id: 'a', box: 2, dueAt: day(-1) });
  const b = seen({ id: 'b', box: 0, dueAt: day(-2) });
  const c = seen({ id: 'c', box: 0, dueAt: day(-5) });
  const notDue = seen({ id: 'd', box: 1, dueAt: day(2) });
  const ids = pickSession([a, b, c, notDue], NOW, SETTINGS).map((x) => x.id);
  assert.deepEqual(ids, ['c', 'b', 'a']);
});

test('pickSession: 先取新词，名额有剩余再用到期词补', () => {
  const due = seen({ id: 'due', dueAt: day(-1) });
  const fresh = [1, 2, 3, 4].map((i) => card({ id: 'n' + i, createdAt: i }));
  const ids = pickSession([due, ...fresh], NOW, { sessionSize: 3, newPerDay: 5 }).map((x) => x.id);
  assert.deepEqual(ids, ['n1', 'n2', 'n3']); // 新词已占满，到期词排不上
  const more = pickSession([due, ...fresh], NOW, { sessionSize: 10, newPerDay: 2 }).map((x) => x.id);
  assert.deepEqual(more, ['n1', 'n2', 'due']); // 新词受每天上限约束，余下名额给到期词
});

test('pickSession: 每天新词上限扣除今天已出现的新词', () => {
  const todays = [1, 2].map((i) => card({ id: 't' + i, firstSeenAt: NOW.getTime(), dueAt: day(1), box: 1 }));
  const fresh = [1, 2, 3, 4].map((i) => card({ id: 'n' + i, createdAt: i }));
  const ids = pickSession([...todays, ...fresh], NOW, { sessionSize: 10, newPerDay: 3 }).map((x) => x.id);
  assert.deepEqual(ids, ['n1']);
});

test('pickSession: 没有可出的词返回空数组', () => {
  assert.deepEqual(pickSession([], NOW, SETTINGS), []);
});

test('summary: 统计到期词与今天还可补的新词数', () => {
  const due = seen({ id: 'due', dueAt: day(-1) });
  const fresh = [1, 2, 3].map((i) => card({ id: 'n' + i }));
  assert.deepEqual(summary([due, ...fresh], NOW, { sessionSize: 10, newPerDay: 2 }), { due: 1, newAvail: 2 });
});

test('newCard: 没有 crypto.randomUUID（局域网 http）时仍能生成不重复的 id', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  try {
    const a = newCard({ en: 'a', zh: '啊', batch: 'x' }, NOW);
    const b = newCard({ en: 'b', zh: '波', batch: 'x' }, NOW);
    assert.ok(a.id && b.id);
    assert.notEqual(a.id, b.id);
  } finally {
    Object.defineProperty(globalThis, 'crypto', desc);
  }
});

test('pickSession: 新词优先从最近导入的批次选，批内保持导入顺序', () => {
  const mk = (id, batch, createdAt) => card({ id, batch, createdAt });
  const cards = [
    mk('old1', 'L7', 100), mk('old2', 'L7', 101),
    mk('new2', 'L8', 201), mk('new1', 'L8', 200),
  ];
  const ids = pickSession(cards, NOW, { sessionSize: 3, newPerDay: 5 }).map((x) => x.id);
  assert.deepEqual(ids, ['new1', 'new2', 'old1']);
});

test('pickPractice: 只练学过的词，盒子低的优先，同盒子按到期时间', () => {
  const a = seen({ id: 'a', box: 3, dueAt: day(5) });
  const b = seen({ id: 'b', box: 1, dueAt: day(4) });
  const c = seen({ id: 'c', box: 1, dueAt: day(2) });
  const fresh = card({ id: 'new' });
  const ids = pickPractice([a, b, c, fresh], 10).map((x) => x.id);
  assert.deepEqual(ids, ['c', 'b', 'a']);
});

test('pickPractice: 受 size 限制；排除的词排到后面，名额不够时才补', () => {
  const cards = ['a', 'b', 'c', 'd'].map((id, i) => seen({ id, box: 1, dueAt: day(i + 1) }));
  assert.deepEqual(pickPractice(cards, 2).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(pickPractice(cards, 2, new Set(['a', 'b'])).map((x) => x.id), ['c', 'd']);
  assert.deepEqual(pickPractice(cards, 3, new Set(['a', 'b', 'c'])).map((x) => x.id), ['d', 'a', 'b']);
});

test('pickPractice: 没有学过的词返回空数组', () => {
  assert.deepEqual(pickPractice([card({ id: 'n' })], 10), []);
  assert.deepEqual(pickPractice([], 10), []);
});
