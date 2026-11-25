import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText, cleanEn, cleanZh, entriesFromCells } from '../src/core/parser.js';

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

// ---- 整页 OCR 的真实输出（Lesson 11 截图，去表格线后识别） ----
test('中文里的省略号保留，OCR 认成的 . 或 .… 统一成 …', () => {
  assert.deepEqual(en('in prep. 在…里面'), [{ en: 'in', zh: '在…里面' }]);
  assert.deepEqual(en('on                         prep. 在.上面'), [{ en: 'on', zh: '在…上面' }]);
  assert.deepEqual(en('between                 prep. 在.…中间'), [{ en: 'between', zh: '在…中间' }]);
});

test('残留的表格线 | 、全角句号、词性 /. 都不影响', () => {
  assert.deepEqual(en('excited                          adj. |激动的'), [{ en: 'excited', zh: '激动的' }]);
  assert.deepEqual(en('clothes                           n。 |衣服'), [{ en: 'clothes', zh: '衣服' }]);
  assert.deepEqual(en('at the market /. 在市场'), [{ en: 'at the market', zh: '在市场' }]);
  assert.deepEqual(en('everywhere                     I. |任何地方; 到处'), [{ en: 'everywhere', zh: '任何地方；到处' }]);
  assert.deepEqual(en('vegetable nm | 蔬菜'), [{ en: 'vegetable', zh: '蔬菜' }]);
});

test('一行两栏，中间夹着词性和竖线', () => {
  assert.deepEqual(en('on                         prep. 在.上面                          excited                          adj. |激动的'), [
    { en: 'on', zh: '在…上面' },
    { en: 'excited', zh: '激动的' },
  ]);
});

test('英文就是词性缩写本身（如 prep）时不当成词条', () => {
  assert.deepEqual(en('prep 在…里面'), []);
});

test('同一行里一栏有中文、另一栏的中文没认出来：那个英文进入 unrecognized', () => {
  const r = parseText('igloo                        n. KET                            bread                             n. 面包');
  assert.deepEqual(r.entries, [{ en: 'bread', zh: '面包' }]);
  assert.deepEqual(r.unrecognized, ['igloo']);
});

// ---- 逐格识别的结果 ----
test('cleanEn / cleanZh: 去掉 OCR 杂字符和汉字间的空格', () => {
  assert.equal(cleanEn(' teddy  bear| '), 'teddy bear');
  assert.equal(cleanEn('at the market.'), 'at the market');
  assert.equal(cleanZh('在 … 里 面'), '在…里面');
  assert.equal(cleanZh('任何 地 方 ; 到 处'), '任何地方；到处');
  assert.equal(cleanZh('| 激动 的 。'), '激动的');
  assert.equal(cleanZh('脚 (复数)'), '脚（复数）');
  assert.equal(cleanZh('脚〈复数)'), '脚（复数）');
});

test('entriesFromCells: 先左栏从上到下，再右栏；跳过表头，遇到 Sentences 停止', () => {
  const rows = [
    [{ en: '', zh: '词义' }, { en: 'iA', zh: '词义' }],
    [{ en: 'in', zh: '在 … 里 面' }, { en: 'at the market', zh: '在 市 场' }],
    [{ en: 'on', zh: '在 … 上 面' }, { en: 'excited', zh: '激动 的' }],
    [{ en: 'Sentences', zh: '中文' }],
    [{ en: 'The market is a fun place.', zh: '市集是一个有趣的地方。' }],
  ];
  assert.deepEqual(entriesFromCells(rows), {
    entries: [
      { en: 'in', zh: '在…里面' }, { en: 'on', zh: '在…上面' },
      { en: 'at the market', zh: '在市场' }, { en: 'excited', zh: '激动的' },
    ],
    unrecognized: [],
  });
});

test('entriesFromCells: 一边认不出来的进入 unrecognized，整句的跳过', () => {
  const rows = [
    [{ en: 'igloo', zh: 'KET' }, { en: '', zh: '面包' }],
    [{ en: 'There are many small shops.', zh: '有很多小的商店。' }],
  ];
  assert.deepEqual(entriesFromCells(rows), {
    entries: [],
    unrecognized: [{ en: 'igloo', zh: '' }, { en: '', zh: '面包' }],
  });
});

test('entriesFromCells: 第一行英文置信度都很低（表头“词汇”被英文模型认成乱码）就整行跳过', () => {
  const rows = [
    [{ en: 'FC', zh: '调义', enConf: 27 }, { en: 'FC', zh: '词义', enConf: 40 }],
    [{ en: 'in', zh: '在…里面', enConf: 94 }, { en: 'bread', zh: '面包', enConf: 95 }],
  ];
  assert.deepEqual(entriesFromCells(rows).entries, [{ en: 'in', zh: '在…里面' }, { en: 'bread', zh: '面包' }]);
});

test('entriesFromCells: 其他行英文置信度低，英文留空交给家长补', () => {
  const rows = [
    [{ en: 'in', zh: '在…里面', enConf: 94 }],
    [{ en: 'Parl ever', zh: '几乎不', enConf: 45 }],
  ];
  assert.deepEqual(entriesFromCells(rows), {
    entries: [{ en: 'in', zh: '在…里面' }],
    unrecognized: [{ en: '', zh: '几乎不' }],
  });
});
