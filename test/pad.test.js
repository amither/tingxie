import test from 'node:test';
import assert from 'node:assert/strict';
import { cellCount } from '../src/ui/pad.js';

test('cellCount: 格数 = 单词的字母个数 + 3', () => {
  assert.equal(cellCount('cat'), 6);
  assert.equal(cellCount('apple'), 8);
  assert.equal(cellCount('apartment'), 12);
});

test('cellCount: 短语按字母数算，空格不算字母', () => {
  assert.equal(cellCount('pencil case'), 13);
  assert.equal(cellCount('hardly ever'), 13);
});

test('cellCount: 空词也有 3 格', () => {
  assert.equal(cellCount(''), 3);
});
