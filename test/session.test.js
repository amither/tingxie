import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, currentId, answer, isFinished, stats } from '../src/core/session.js';

test('全部一次写对', () => {
  const s = createSession(['a', 'b']);
  assert.equal(currentId(s), 'a');
  assert.equal(answer(s, true), 'correct');
  assert.equal(currentId(s), 'b');
  assert.equal(answer(s, true), 'correct');
  assert.ok(isFinished(s));
  assert.deepEqual(stats(s), { total: 2, firstTryCorrect: 2, done: 2, struggled: [] });
});

test('写错的词原地重试，写对后才进入下一个', () => {
  const s = createSession(['a', 'b']);
  assert.equal(answer(s, false), 'wrong');
  assert.equal(currentId(s), 'a');
  assert.equal(stats(s).done, 0);
  assert.equal(answer(s, true), 'retry-correct');
  assert.equal(currentId(s), 'b');
  assert.equal(answer(s, true), 'correct');
  assert.ok(isFinished(s));
  assert.deepEqual(stats(s), { total: 2, firstTryCorrect: 1, done: 2, struggled: ['a'] });
});

test('同一个词连续写错：始终停在它上面，写对才放行', () => {
  const s = createSession(['a', 'b']);
  assert.equal(answer(s, false), 'wrong');
  assert.equal(answer(s, false), 'wrong-again');
  assert.equal(answer(s, false), 'wrong-again');
  assert.equal(currentId(s), 'a');
  assert.ok(!isFinished(s));
  assert.equal(answer(s, true), 'retry-correct');
  assert.equal(currentId(s), 'b');
  assert.ok(!isFinished(s));
});

test('空队列直接结束', () => {
  const s = createSession([]);
  assert.ok(isFinished(s));
  assert.equal(currentId(s), null);
});
