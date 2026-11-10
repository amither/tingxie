import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText } from '../src/core/parser.js';

const en = (text) => parseText(text).entries;

test('一行一个词：英文 词性 中文', () => {
  assert.deepEqual(en('knee n. 膝盖'), [{ en: 'knee', zh: '膝盖' }]);
});

test('一行两栏：左右各解析一次', () => {
  assert.deepEqual(en('always adv. 总是 hands n. 手'), [
    { en: 'always', zh: '总是' },
    { en: 'hands', zh: '手' },
  ]);
});

test('两个词的短语保留', () => {
  assert.deepEqual(en('hardly ever adv. 几乎不 pencil case n. 笔盒'), [
    { en: 'hardly ever', zh: '几乎不' },
    { en: 'pencil case', zh: '笔盒' },
  ]);
});

test('中文里的括号保留', () => {
  assert.deepEqual(en('feet n. 脚（复数）'), [{ en: 'feet', zh: '脚（复数）' }]);
});

test('OCR 在汉字之间插入的空格被去掉', () => {
  assert.deepEqual(en('building n. 建 筑 大 楼'), [{ en: 'building', zh: '建筑大楼' }]);
});

test('没有词性也能解析；以 n 结尾的单词不会被误当词性', () => {
  assert.deepEqual(en('pen 笔'), [{ en: 'pen', zh: '笔' }]);
  assert.deepEqual(en('never adv. 从不'), [{ en: 'never', zh: '从不' }]);
});

test('Sentences 之后的内容整块忽略', () => {
  const text = ['cloud n. 云朵', 'Sentences 中文', 'This is a nose. 这是一个鼻子。', 'tent n. 帐篷'].join('\n');
  assert.deepEqual(en(text), [{ en: 'cloud', zh: '云朵' }]);
});

test('超过 3 个词的当作句子丢弃，也不进未识别', () => {
  const r = parseText('This is a nose 这是一个鼻子');
  assert.deepEqual(r.entries, []);
  assert.deepEqual(r.unrecognized, []);
});

test('只有英文、没认出中文的短行进入 unrecognized', () => {
  const r = parseText('backpack');
  assert.deepEqual(r.entries, []);
  assert.deepEqual(r.unrecognized, ['backpack']);
});

test('标题行、表头行、空行不进入 unrecognized', () => {
  const text = ['Paper Check—First grammar&writing-Lesson 8', '词汇 词性 词义', '', 'kite n. 风筝'].join('\n');
  const r = parseText(text);
  assert.deepEqual(r.entries, [{ en: 'kite', zh: '风筝' }]);
  assert.deepEqual(r.unrecognized, []);
});

test('Lesson 8 样本整段解析', () => {
  const text = [
    'always adv. 总是 hands n. 手',
    'usually adv. 经常 eyes n. 眼睛',
    'hardly ever adv. 几乎不 leg n. 腿',
    'foot n. 一只脚',
    'feet n. 脚（复数）',
    'Sentences 中文',
    'These are ears. 这些是耳朵。',
  ].join('\n');
  assert.deepEqual(en(text).map((e) => e.en), ['always', 'hands', 'usually', 'eyes', 'hardly ever', 'leg', 'foot', 'feet']);
});
