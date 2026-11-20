import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleCells } from '../src/core/assemble.js';

test('assembleCells: 逐格拼起来', () => {
  assert.equal(assembleCells(['c', 'a', 't']), 'cat');
});

test('assembleCells: 首尾空格子忽略', () => {
  assert.equal(assembleCells(['', 'c', 'a', 't', '', '']), 'cat');
});

test('assembleCells: 中间空格子（连续多个也一样）算一个空格', () => {
  assert.equal(assembleCells(['p', 'e', 'n', '', 'c', 'a', 's', 'e']), 'pen case');
  assert.equal(assembleCells(['a', '', '', 'b']), 'a b');
});

test('assembleCells: 全空返回空字符串', () => {
  assert.equal(assembleCells([]), '');
  assert.equal(assembleCells(['', '']), '');
});
