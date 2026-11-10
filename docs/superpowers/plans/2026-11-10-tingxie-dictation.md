# 儿童英语听写 PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个在 iPad 上离线运行的英语单词听写 PWA：拍照/PDF 导入词表，手写听写，按遗忘曲线安排复习。

**Architecture:** 原生 JS（ES modules），无构建步骤，无后台。纯逻辑（`scheduler`、`parser`、`session`）放在 `src/core/`，用 `node:test` 做单元测试；浏览器相关（IndexedDB、语音、OCR、PDF、界面）放在其他目录，用 iPad 人工验证。

**Tech Stack:** HTML/CSS/JS（ES modules）、IndexedDB、`speechSynthesis`、pdf.js（`pdfjs-dist@4`）、Tesseract.js（`tesseract.js@5`）、Service Worker、`node:test`。

**Spec:** `docs/superpowers/specs/2026-11-10-tingxie-dictation-design.md`

**对 spec 的一处补充：** 词条增加 `firstSeenAt`（首次答题时间，初始为 `null`），用来判断“新词”和统计“今天已出现的新词数”。

**约定：** 工作目录均为 `/Users/arsir/other_code/tingxie`。测试页 `handwriting-test/` 已验证完毕，Task 1 会删掉。本地预览命令：`python3 -m http.server 8080 --bind 0.0.0.0`，iPad 访问 `http://<Mac 局域网 IP>:8080`。注意：Service Worker 只在 HTTPS 或 localhost 下注册，局域网 http 访问时会自动跳过，不影响其他功能；离线与“添加到主屏幕”需在 HTTPS 下验证（见 Task 11）。

---

## 文件结构

```
index.html                    入口
manifest.webmanifest          PWA 清单
sw.js                         Service Worker（预缓存）
styles.css                    全部样式
package.json                  仅声明 type=module 和 test 脚本
src/app.js                    哈希路由，启动
src/core/scheduler.js         盒子间隔、选词、统计（纯函数）
src/core/parser.js            OCR/PDF 文本 → 词条草稿（纯函数）
src/core/session.js           一轮听写的队列状态机（纯函数）
src/data/store.js             IndexedDB、备份导出/导入
src/platform/speech.js        speechSynthesis 封装
src/platform/importer.js      PDF/图片 → 文本
src/ui/dom.js                 h() 与 mount()
src/ui/home.js                首页
src/ui/dictation.js           听写页
src/ui/import.js              导入页 + 校对页
src/ui/words.js               词表页
src/ui/settings.js            设置页
test/scheduler.test.js
test/parser.test.js
test/session.test.js
scripts/fetch-vendor.sh       把 pdf.js / Tesseract 及语言包下载到 vendor/
scripts/make-icons.mjs        生成 PWA 图标 PNG
vendor/                       第三方库（脚本下载，提交进仓库以便 Pages 发布）
```

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`, `.gitignore`
- Delete: `handwriting-test/`

- [ ] **Step 1: 初始化仓库并创建 package.json**

```bash
cd /Users/arsir/other_code/tingxie
git init
rm -rf handwriting-test
mkdir -p src/core src/data src/platform src/ui test scripts vendor icons
```

`package.json`:

```json
{
  "name": "tingxie",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/"
  }
}
```

`.gitignore`:

```
.DS_Store
node_modules/
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "chore: project scaffold and design spec"
```

---

### Task 2: scheduler（遗忘曲线，纯函数）

**Files:**
- Create: `src/core/scheduler.js`
- Test: `test/scheduler.test.js`

- [ ] **Step 1: 写失败测试**

`test/scheduler.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERVAL_DAYS, newCard, isNew, gradeCorrect, markWrong, markRetryCorrect,
  pickSession, summary,
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

test('pickSession: 不足时补新词，受 sessionSize 限制', () => {
  const due = seen({ id: 'due', dueAt: day(-1) });
  const fresh = [1, 2, 3, 4].map((i) => card({ id: 'n' + i, createdAt: i }));
  const ids = pickSession([due, ...fresh], NOW, { sessionSize: 3, newPerDay: 5 }).map((x) => x.id);
  assert.deepEqual(ids, ['due', 'n1', 'n2']);
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL，提示找不到 `../src/core/scheduler.js`。

- [ ] **Step 3: 实现**

`src/core/scheduler.js`:

```js
export const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
export const MAX_BOX = INTERVAL_DAYS.length - 1;

// 本地时间 now 所在日往后 offset 天的零点时间戳
function dayStart(now, offset = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

export function newCard({ en, zh, batch }, now = new Date()) {
  return {
    id: crypto.randomUUID(),
    en, zh, batch,
    box: 0, dueAt: 0, reps: 0, lapses: 0,
    createdAt: now.getTime(),
    firstSeenAt: null,
  };
}

export const isNew = (c) => c.firstSeenAt == null;

const seenAt = (c, now) => (c.firstSeenAt == null ? now.getTime() : c.firstSeenAt);

// 第一次就写对
export function gradeCorrect(c, now) {
  const box = Math.min(c.box + 1, MAX_BOX);
  return { ...c, box, dueAt: dayStart(now, INTERVAL_DAYS[box]), reps: c.reps + 1, firstSeenAt: seenAt(c, now) };
}

// 写错：归零，本轮末尾会再出现
export function markWrong(c, now) {
  return { ...c, box: 0, lapses: c.lapses + 1, dueAt: now.getTime(), firstSeenAt: seenAt(c, now) };
}

// 写错后重试才写对：盒子保持 0，明天再考
export function markRetryCorrect(c, now) {
  return { ...c, box: 0, dueAt: dayStart(now, 1), firstSeenAt: seenAt(c, now) };
}

function newAvailable(cards, now, newPerDay) {
  const today = dayStart(now, 0);
  const newToday = cards.filter((c) => !isNew(c) && c.firstSeenAt >= today).length;
  return Math.max(0, newPerDay - newToday);
}

export function pickSession(cards, now, { sessionSize, newPerDay }) {
  const t = now.getTime();
  const due = cards
    .filter((c) => !isNew(c) && c.dueAt <= t)
    .sort((a, b) => a.box - b.box || a.dueAt - b.dueAt)
    .slice(0, sessionSize);
  const fresh = cards.filter(isNew).sort((a, b) => a.createdAt - b.createdAt);
  const room = Math.min(sessionSize - due.length, newAvailable(cards, now, newPerDay));
  return due.concat(fresh.slice(0, Math.max(0, room)));
}

export function summary(cards, now, { newPerDay }) {
  const t = now.getTime();
  const due = cards.filter((c) => !isNew(c) && c.dueAt <= t).length;
  const freshCount = cards.filter(isNew).length;
  return { due, newAvail: Math.min(freshCount, newAvailable(cards, now, newPerDay)) };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: scheduler 的全部用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/scheduler.js test/scheduler.test.js
git commit -m "feat: spaced-repetition scheduler"
```

---

### Task 3: parser（文本 → 词条草稿，纯函数）

**Files:**
- Create: `src/core/parser.js`
- Test: `test/parser.test.js`

- [ ] **Step 1: 写失败测试**

`test/parser.test.js`:

```js
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: parser 用例 FAIL，找不到 `../src/core/parser.js`。

- [ ] **Step 3: 实现**

`src/core/parser.js`:

```js
const POS = '(?:n|v|adj|adv|prep|pron|conj|art|num|int|aux|det)';
// 英文（可含空格、撇号）+ 可选词性（必须带点）+ 中文（可含全/半角括号，OCR 可能夹空格）
const ENTRY = new RegExp(
  `([A-Za-z][A-Za-z'’ ]*?)(?:\\s+${POS}\\.)?\\s*([\\u4e00-\\u9fff][\\u4e00-\\u9fff（）()\\s]*)`,
  'g',
);

const SENTENCES_HEADER = /^\W*sentences\b/i;
const latinWords = (s) => s.match(/[A-Za-z][A-Za-z'’]*/g) ?? [];

function cleanEn(s) {
  return s.trim().replace(/\s+/g, ' ');
}

export function parseText(text) {
  const entries = [];
  const unrecognized = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SENTENCES_HEADER.test(line)) break;

    let matched = false;
    for (const m of line.matchAll(ENTRY)) {
      matched = true;
      const en = cleanEn(m[1]);
      const zh = m[2].replace(/\s+/g, '');
      if (en.split(' ').length > 3) continue; // 句子
      entries.push({ en, zh });
    }
    if (matched) continue;

    const words = latinWords(line).length;
    if (words >= 1 && words <= 3 && !/[.?!]/.test(line)) unrecognized.push(line);
  }
  return { entries, unrecognized };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: parser 全部 PASS（scheduler 仍 PASS）。若某条不过，只调整 `ENTRY` 或过滤逻辑，不要改测试期望。

- [ ] **Step 5: 提交**

```bash
git add src/core/parser.js test/parser.test.js
git commit -m "feat: word-list text parser"
```

---

### Task 4: session（一轮听写的队列状态机，纯函数）

**Files:**
- Create: `src/core/session.js`
- Test: `test/session.test.js`

- [ ] **Step 1: 写失败测试**

`test/session.test.js`:

```js
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

test('写错的词排到队尾，重试写对后才算完成', () => {
  const s = createSession(['a', 'b']);
  assert.equal(answer(s, false), 'wrong');
  assert.equal(currentId(s), 'b');
  assert.equal(answer(s, true), 'correct');
  assert.equal(currentId(s), 'a');
  assert.equal(answer(s, true), 'retry-correct');
  assert.ok(isFinished(s));
  assert.deepEqual(stats(s), { total: 2, firstTryCorrect: 1, done: 2, struggled: ['a'] });
});

test('同一个词连续写错：第二次起返回 wrong-again，仍留在队尾', () => {
  const s = createSession(['a']);
  assert.equal(answer(s, false), 'wrong');
  assert.equal(answer(s, false), 'wrong-again');
  assert.ok(!isFinished(s));
  assert.equal(currentId(s), 'a');
  assert.equal(answer(s, true), 'retry-correct');
  assert.ok(isFinished(s));
});

test('空队列直接结束', () => {
  const s = createSession([]);
  assert.ok(isFinished(s));
  assert.equal(currentId(s), null);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL，找不到 `session.js`。

- [ ] **Step 3: 实现**

`src/core/session.js`:

```js
export function createSession(ids) {
  return { queue: [...ids], failed: new Set(), total: ids.length, done: 0, firstTryCorrect: 0 };
}

export const currentId = (s) => (s.queue.length ? s.queue[0] : null);
export const isFinished = (s) => s.queue.length === 0;

// 返回 'correct' | 'retry-correct' | 'wrong' | 'wrong-again'
export function answer(s, correct) {
  const id = s.queue.shift();
  const failedBefore = s.failed.has(id);
  if (correct) {
    s.done += 1;
    if (!failedBefore) { s.firstTryCorrect += 1; return 'correct'; }
    return 'retry-correct';
  }
  s.failed.add(id);
  s.queue.push(id);
  return failedBefore ? 'wrong-again' : 'wrong';
}

export function stats(s) {
  return { total: s.total, firstTryCorrect: s.firstTryCorrect, done: s.done, struggled: [...s.failed] };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/session.js test/session.test.js
git commit -m "feat: dictation session state machine"
```

---

### Task 5: store（IndexedDB 与备份）

**Files:**
- Create: `src/data/store.js`

浏览器 API，没有单元测试；Task 7 起通过界面验证。

- [ ] **Step 1: 实现**

`src/data/store.js`:

```js
const DB_NAME = 'tingxie';
const DB_VERSION = 1;
export const DEFAULT_SETTINGS = { sessionSize: 10, newPerDay: 5 };

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('cards', { keyPath: 'id' });
      req.result.createObjectStore('meta'); // key-value：settings、lastBackupAt
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAllCards = () => run('cards', 'readonly', (s) => s.getAll());
export const putCards = (cards) => run('cards', 'readwrite', (s) => { cards.forEach((c) => s.put(c)); });
export const deleteCard = (id) => run('cards', 'readwrite', (s) => { s.delete(id); });

const getMeta = (key) => run('meta', 'readonly', (s) => s.get(key));
const setMeta = (key, value) => run('meta', 'readwrite', (s) => { s.put(value, key); });

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await getMeta('settings')) ?? {}) };
}
export const saveSettings = (settings) => setMeta('settings', settings);
export const getLastBackupAt = () => getMeta('lastBackupAt');

export async function exportBackup() {
  const backup = { app: 'tingxie', version: 1, exportedAt: Date.now(), settings: await getSettings(), cards: await getAllCards() };
  await setMeta('lastBackupAt', backup.exportedAt);
  return backup;
}

export async function importBackup(backup) {
  if (backup?.app !== 'tingxie' || !Array.isArray(backup.cards)) throw new Error('不是有效的备份文件');
  await putCards(backup.cards);
  if (backup.settings) await saveSettings({ ...DEFAULT_SETTINGS, ...backup.settings });
  return backup.cards.length;
}

export async function requestPersistence() {
  try { await navigator.storage?.persist?.(); } catch { /* 忽略 */ }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/data/store.js
git commit -m "feat: IndexedDB store with backup"
```

---

### Task 6: speech 与 dom 工具

**Files:**
- Create: `src/platform/speech.js`, `src/ui/dom.js`

- [ ] **Step 1: 实现 speech**

`src/platform/speech.js`:

```js
const norm = (lang) => lang.replace('_', '-');

function englishVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => norm(v.lang).startsWith('en'));
  return voices.find((v) => norm(v.lang) === 'en-US') ?? voices[0] ?? null;
}

export const hasEnglishVoice = () => 'speechSynthesis' in window && englishVoice() !== null;

export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const voice = englishVoice();
  if (voice) u.voice = voice;
  u.lang = voice ? voice.lang : 'en-US';
  u.rate = 0.8;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
```

- [ ] **Step 2: 实现 dom 工具**

`src/ui/dom.js`:

```js
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) el.append(c instanceof Node ? c : document.createTextNode(c ?? ''));
  return el;
}

export const mount = (root, ...nodes) => root.replaceChildren(...nodes);
```

- [ ] **Step 3: 提交**

```bash
git add src/platform/speech.js src/ui/dom.js
git commit -m "feat: speech wrapper and dom helper"
```

---

### Task 7: 应用外壳、首页、听写页

**Files:**
- Create: `index.html`, `styles.css`, `src/app.js`, `src/ui/home.js`, `src/ui/dictation.js`
- 其余页面先用占位路由，后续任务补全。

- [ ] **Step 1: index.html**

```html
<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="听写">
  <meta name="theme-color" content="#f59e0b">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icons/icon-180.png">
  <link rel="stylesheet" href="styles.css">
  <title>英语听写</title>
</head>
<body>
  <main id="app"></main>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: styles.css**

```css
:root { --main: #f59e0b; --ok: #16a34a; --bad: #dc2626; --bg: #fffbea; --ink: #1f2937; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "PingFang SC", sans-serif; background: var(--bg); color: var(--ink); }
#app { max-width: 820px; margin: 0 auto; padding: 24px; padding-bottom: env(safe-area-inset-bottom, 24px); }
h1 { font-size: 28px; margin: 0 0 16px; }
h2 { font-size: 22px; margin: 20px 0 8px; }
button, .btn { font-size: 24px; padding: 14px 28px; border: 0; border-radius: 14px; background: var(--main); color: #fff; cursor: pointer; }
button.secondary { background: #fff; color: var(--ink); border: 2px solid #e5e7eb; }
button.danger { background: var(--bad); }
button.small { font-size: 16px; padding: 6px 12px; border-radius: 8px; }
button:disabled { opacity: .5; }
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.row.spread { justify-content: space-between; }
.big { width: 100%; font-size: 36px; padding: 28px; margin: 16px 0; }
.card { background: #fff; border-radius: 16px; padding: 16px 20px; margin: 12px 0; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.muted { color: #6b7280; font-size: 18px; }
.notice { background: #fef3c7; border-radius: 12px; padding: 12px 16px; margin: 12px 0; font-size: 18px; }
.zh { font-size: 56px; text-align: center; margin: 32px 0 16px; }
.answer { width: 100%; font-size: 48px; padding: 14px; border: 3px solid var(--main); border-radius: 14px; text-align: center; }
.feedback { font-size: 40px; text-align: center; margin: 20px 0; min-height: 56px; }
.feedback.ok { color: var(--ok); } .feedback.bad { color: var(--bad); }
.progress { font-size: 20px; color: #6b7280; text-align: center; }
table { width: 100%; border-collapse: collapse; }
td, th { padding: 6px; border-bottom: 1px solid #f3f4f6; text-align: left; font-size: 20px; }
input[type=text], input[type=number], select { font-size: 22px; padding: 8px 10px; border: 2px solid #e5e7eb; border-radius: 10px; width: 100%; }
tr.flag td { background: #fef2f2; }
tr.dup td { background: #fffbeb; }
```

- [ ] **Step 3: app.js（哈希路由）**

`src/app.js`:

```js
import { requestPersistence } from './data/store.js';
import { mount, h } from './ui/dom.js';

const routes = {
  home: () => import('./ui/home.js'),
  dictation: () => import('./ui/dictation.js'),
  import: () => import('./ui/import.js'),
  words: () => import('./ui/words.js'),
  settings: () => import('./ui/settings.js'),
};

const root = document.getElementById('app');
const navigate = (name) => { location.hash = '#/' + name; };

async function render() {
  const name = location.hash.replace(/^#\//, '') || 'home';
  const load = routes[name] ?? routes.home;
  try {
    const view = await load();
    await view.render(root, { navigate });
  } catch (e) {
    console.error(e);
    mount(root, h('div', { class: 'notice' }, '出错了：' + e.message), h('button', { onclick: () => navigate('home') }, '回首页'));
  }
}

window.addEventListener('hashchange', render);
requestPersistence();
render();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js');
```

- [ ] **Step 4: 首页**

`src/ui/home.js`:

```js
import { h, mount } from './dom.js';
import { getAllCards, getSettings, getLastBackupAt } from '../data/store.js';
import { summary } from '../core/scheduler.js';

const DAY = 86400000;

export async function render(root, { navigate }) {
  const [cards, settings, lastBackupAt] = await Promise.all([getAllCards(), getSettings(), getLastBackupAt()]);
  const now = new Date();
  const { due, newAvail } = summary(cards, now, settings);
  const nodes = [h('h1', {}, '英语听写')];

  if (cards.length === 0) {
    nodes.push(h('div', { class: 'notice' }, '还没有单词，先导入吧。'),
      h('button', { class: 'big', onclick: () => navigate('import') }, '导入单词'));
  } else {
    const nothing = due + newAvail === 0;
    nodes.push(
      h('div', { class: 'card' }, `今天要复习 ${due} 个词，新词 ${newAvail} 个`),
      h('button', { class: 'big', disabled: nothing, onclick: () => navigate('dictation') }, nothing ? '今天都完成啦 🎉' : '开始听写'),
      h('div', { class: 'row' },
        h('button', { class: 'secondary', onclick: () => navigate('import') }, '导入单词'),
        h('button', { class: 'secondary', onclick: () => navigate('words') }, `词表（${cards.length}）`),
        h('button', { class: 'secondary', onclick: () => navigate('settings') }, '设置')),
    );
    const days = lastBackupAt ? Math.floor((now - lastBackupAt) / DAY) : null;
    if (days === null || days >= 14) {
      nodes.push(h('div', { class: 'notice' }, days === null ? '还没有备份过，建议到设置里导出一份。' : `上次备份是 ${days} 天前，建议到设置里再导出一份。`));
    }
  }
  mount(root, ...nodes);
}
```

- [ ] **Step 5: 听写页**

`src/ui/dictation.js`:

```js
import { h, mount } from './dom.js';
import { getAllCards, getSettings, putCards } from '../data/store.js';
import { pickSession, gradeCorrect, markWrong, markRetryCorrect } from '../core/scheduler.js';
import { createSession, currentId, answer, isFinished, stats } from '../core/session.js';
import { speak } from '../platform/speech.js';

const normalize = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export async function render(root, { navigate }) {
  const [cards, settings] = await Promise.all([getAllCards(), getSettings()]);
  const picked = pickSession(cards, new Date(), settings);
  if (picked.length === 0) { navigate('home'); return; }

  const byId = new Map(picked.map((c) => [c.id, c]));
  const session = createSession(picked.map((c) => c.id));

  function showQuestion() {
    if (isFinished(session)) return showSummary();
    const card = byId.get(currentId(session));
    const input = h('input', {
      class: 'answer', type: 'text', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false',
      placeholder: '写出英文单词',
    });
    const feedback = h('div', { class: 'feedback' });
    const submit = h('button', { class: 'big' }, '提交');
    let locked = false;

    const onSubmit = async () => {
      if (locked) return;
      locked = true; input.disabled = true; submit.disabled = true;
      const ok = normalize(input.value) === normalize(card.en);
      const outcome = answer(session, ok);
      const now = new Date();
      const updated = outcome === 'correct' ? gradeCorrect(card, now)
        : outcome === 'retry-correct' ? markRetryCorrect(card, now)
        : outcome === 'wrong' ? markWrong(card, now) : card;
      byId.set(card.id, updated);
      if (updated !== card) await putCards([updated]);

      if (ok) {
        feedback.className = 'feedback ok'; feedback.textContent = '✓ 正确';
        setTimeout(showQuestion, 800);
      } else {
        feedback.className = 'feedback bad'; feedback.textContent = `✗ 正确答案：${card.en}`;
        speak(card.en);
        submit.textContent = '知道了'; submit.disabled = false;
        submit.onclick = showQuestion;
      }
    };
    submit.onclick = onSubmit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSubmit(); });

    const { done, total } = stats(session);
    mount(root,
      h('div', { class: 'progress' }, `${done + 1 > total ? total : done + 1} / ${total}`),
      h('div', { class: 'zh' }, card.zh),
      h('div', { class: 'row' }, h('button', { class: 'secondary small', onclick: () => speak(card.en) }, '🔊 听发音')),
      input, feedback, submit,
      h('button', { class: 'secondary small', onclick: () => navigate('home') }, '退出'),
    );
    input.focus();
  }

  function showSummary() {
    const s = stats(session);
    const hard = s.struggled.map((id) => byId.get(id));
    mount(root,
      h('h1', {}, '本轮完成 🎉'),
      h('div', { class: 'card' }, `一次写对 ${s.firstTryCorrect} / ${s.total}`),
      hard.length ? h('div', { class: 'card' }, h('h2', {}, '要多练的词'), ...hard.map((c) => h('div', {}, `${c.en}  ${c.zh}`))) : '',
      h('div', { class: 'row' },
        h('button', { onclick: () => { location.hash = '#/home'; setTimeout(() => navigate('dictation'), 0); } }, '再来一轮'),
        h('button', { class: 'secondary', onclick: () => navigate('home') }, '回首页')),
    );
  }

  showQuestion();
}
```

- [ ] **Step 6: 临时占位路由文件，避免动态 import 失败**

创建 `src/ui/import.js`、`src/ui/words.js`、`src/ui/settings.js`，内容均为（把 `XXX` 换成各自页面名）：

```js
import { h, mount } from './dom.js';
export async function render(root, { navigate }) {
  mount(root, h('h1', {}, 'XXX（待实现）'), h('button', { onclick: () => navigate('home') }, '回首页'));
}
```

- [ ] **Step 7: 在浏览器里造几条数据验证首页和听写页**

Run: `python3 -m http.server 8080 --bind 0.0.0.0`，浏览器（或 iPad）打开页面，在开发者控制台执行：

```js
const s = await import('./src/data/store.js');
const { newCard } = await import('./src/core/scheduler.js');
await s.putCards([['cat','猫'],['dog','狗'],['red','红色']].map(([en, zh]) => newCard({ en, zh, batch: 'test' })));
location.reload();
```

Expected：首页显示“今天要复习 0 个词，新词 3 个”；点“开始听写”显示中文；写对自动下一个；写错显示正确答案并朗读，点“知道了”后该词排到末尾；结束页显示统计；回首页后新词数变为 0 且按钮显示“今天都完成啦”。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: app shell, home and dictation views"
```

---

### Task 8: 第三方库与 importer（PDF/图片 → 文本）

**Files:**
- Create: `scripts/fetch-vendor.sh`, `src/platform/importer.js`
- 下载到 `vendor/`

- [ ] **Step 1: 下载脚本**

`scripts/fetch-vendor.sh`:

```bash
#!/bin/sh
# 把 pdf.js、Tesseract.js 及中英文语言包拷贝到 vendor/，供离线使用
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
cd "$WORK"
npm init -y >/dev/null
npm install pdfjs-dist@4 tesseract.js@5 tesseract.js-core@5 @tesseract.js-data/eng @tesseract.js-data/chi_sim

mkdir -p "$ROOT/vendor/lang"
cp node_modules/pdfjs-dist/build/pdf.min.mjs node_modules/pdfjs-dist/build/pdf.worker.min.mjs "$ROOT/vendor/"
cp node_modules/tesseract.js/dist/tesseract.min.js node_modules/tesseract.js/dist/worker.min.js "$ROOT/vendor/"
cp node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js "$ROOT/vendor/"
cp node_modules/tesseract.js-core/tesseract-core-lstm.wasm node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm "$ROOT/vendor/" 2>/dev/null || true
cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz "$ROOT/vendor/lang/"
cp node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz "$ROOT/vendor/lang/"
echo "vendor ready:"; ls -la "$ROOT/vendor" "$ROOT/vendor/lang"
```

- [ ] **Step 2: 运行脚本**

Run: `sh scripts/fetch-vendor.sh`
Expected：末尾列出 `vendor/` 下的 `pdf.min.mjs`、`pdf.worker.min.mjs`、`tesseract.min.js`、`worker.min.js`、`tesseract-core*.js`，以及 `vendor/lang/` 下两个 `.traineddata.gz`。沙箱若拦截 npm 的网络访问，需允许 `registry.npmjs.org`。如果 `tesseract.js-core` 的文件名与脚本不符，用 `ls node_modules/tesseract.js-core` 查看后调整 `cp` 行，并同步 Task 11 的预缓存清单。

- [ ] **Step 3: 实现 importer**

`src/platform/importer.js`:

```js
const MAX_SIDE = 2200;
let workerPromise;
let tesseractLoaded;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('加载失败：' + src));
    document.head.append(s);
  });
}

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      tesseractLoaded ??= loadScript('vendor/tesseract.min.js');
      await tesseractLoaded;
      return Tesseract.createWorker('eng+chi_sim', 1, {
        workerPath: new URL('vendor/worker.min.js', document.baseURI).href,
        corePath: new URL('vendor/', document.baseURI).href,
        langPath: new URL('vendor/lang/', document.baseURI).href,
        logger: (m) => { if (m.status === 'recognizing text') onProgress?.(`识别中 ${Math.round(m.progress * 100)}%`); },
      });
    })();
  }
  return workerPromise;
}

// 缩放 + 灰度 + 对比度拉伸，提高斜拍屏幕照片的识别率
function preprocess(bitmap) {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < lo) lo = g; if (g > hi) hi = g;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = ((d[i] - lo) * 255) / range;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function ocrCanvas(canvas, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return data.text;
}

async function imageToText(file, onProgress) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return ocrCanvas(preprocess(bitmap), onProgress);
}

async function pdfToText(file, onProgress) {
  const pdfjs = await import('../../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

  // 1) 先尝试文字层
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(`读取 PDF 第 ${p}/${pdf.numPages} 页`);
    const content = await (await pdf.getPage(p)).getTextContent();
    const byY = new Map();
    for (const it of content.items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 4); // 同一行的 y 相近
      (byY.get(y) ?? byY.set(y, []).get(y)).push(it);
    }
    [...byY.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => {
      lines.push(items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' '));
    });
  }
  const text = lines.join('\n');
  if (text.replace(/\s/g, '').length >= 30) return text;

  // 2) 没有文字层：渲染成图片再 OCR
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(`识别 PDF 第 ${p}/${pdf.numPages} 页`);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    out.push(await ocrCanvas(canvas, onProgress));
  }
  return out.join('\n');
}

export function extractText(file, onProgress) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? pdfToText(file, onProgress) : imageToText(file, onProgress);
}
```

- [ ] **Step 4: 提交**

```bash
git add scripts/fetch-vendor.sh src/platform/importer.js vendor
git commit -m "feat: PDF/image text extraction with pdf.js and Tesseract"
```

---

### Task 9: 导入页与校对页

**Files:**
- Modify（整体替换）: `src/ui/import.js`

- [ ] **Step 1: 实现**

`src/ui/import.js`:

```js
import { h, mount } from './dom.js';
import { getAllCards, putCards } from '../data/store.js';
import { newCard } from '../core/scheduler.js';
import { parseText } from '../core/parser.js';
import { extractText } from '../platform/importer.js';

const defaultBatch = (file) => (file?.name ?? '').replace(/\.[^.]+$/, '') || new Date().toISOString().slice(0, 10);

export async function render(root, { navigate }) {
  const status = h('div', { class: 'muted' });
  const pick = (accept) => {
    const input = h('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        status.textContent = '处理中，请稍候…';
        const text = await extractText(file, (msg) => { status.textContent = msg; });
        const { entries, unrecognized } = parseText(text);
        if (!entries.length && !unrecognized.length) { status.textContent = '没识别出内容，可以换一张更清晰的照片，或手动添加。'; return; }
        await showReview(root, navigate, entries, unrecognized, defaultBatch(file));
      } catch (e) {
        console.error(e);
        status.textContent = '识别失败：' + e.message;
      }
    });
    document.body.append(input);
    input.click();
  };

  mount(root,
    h('h1', {}, '导入单词'),
    h('div', { class: 'row' },
      h('button', { onclick: () => pick('image/*') }, '📷 拍照 / 选图片'),
      h('button', { onclick: () => pick('application/pdf,.pdf') }, '📄 选 PDF'),
      h('button', { class: 'secondary', onclick: () => showReview(root, navigate, [], [], defaultBatch()) }, '✍️ 手动添加')),
    status,
    h('button', { class: 'secondary small', onclick: () => navigate('home') }, '返回'),
  );
}

async function showReview(root, navigate, entries, unrecognized, batchDefault) {
  const existing = new Map((await getAllCards()).map((c) => [c.en.toLowerCase(), c]));
  const rows = [
    ...entries.map((e) => ({ en: e.en, zh: e.zh, flagged: false, onDup: 'skip' })),
    ...unrecognized.map((line) => ({ en: line, zh: '', flagged: true, onDup: 'skip' })),
  ];
  const batchInput = h('input', { type: 'text', value: batchDefault });
  const tbody = h('tbody');

  function draw() {
    tbody.replaceChildren(...rows.map((r, i) => {
      const dup = existing.get(r.en.trim().toLowerCase());
      const en = h('input', { type: 'text', value: r.en, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
      en.addEventListener('input', () => { r.en = en.value; });
      en.addEventListener('change', draw); // 失焦后刷新重复提示
      const zh = h('input', { type: 'text', value: r.zh, placeholder: r.flagged ? '请补中文' : '' });
      zh.addEventListener('input', () => { r.zh = zh.value; });
      const dupCell = dup
        ? h('select', { onchange: (e) => { r.onDup = e.target.value; } },
          h('option', { value: 'skip', selected: r.onDup === 'skip' }, '已存在：跳过'),
          h('option', { value: 'overwrite', selected: r.onDup === 'overwrite' }, '已存在：覆盖中文'))
        : '';
      return h('tr', { class: r.flagged ? 'flag' : dup ? 'dup' : '' },
        h('td', {}, en), h('td', {}, zh), h('td', {}, dupCell),
        h('td', {}, h('button', { class: 'small danger', onclick: () => { rows.splice(i, 1); draw(); } }, '删')));
    }));
  }

  async function save() {
    const todo = rows.filter((r) => r.en.trim() || r.zh.trim());
    const incomplete = todo.filter((r) => !r.en.trim() || !r.zh.trim());
    if (incomplete.length) { alert(`还有 ${incomplete.length} 行没填完整（红底是没识别出中文的行），请补全或删除。`); return; }
    const now = new Date();
    const batch = batchInput.value.trim() || batchDefault;
    const out = [];
    for (const r of todo) {
      const dup = existing.get(r.en.trim().toLowerCase());
      if (!dup) out.push(newCard({ en: r.en.trim(), zh: r.zh.trim(), batch }, now));
      else if (r.onDup === 'overwrite') out.push({ ...dup, zh: r.zh.trim() });
    }
    await putCards(out);
    alert(`已保存 ${out.length} 个词`);
    navigate('home');
  }

  draw();
  mount(root,
    h('h1', {}, '校对词表'),
    h('div', { class: 'muted' }, '红底：没认出中文；黄底：和已有单词重复。确认无误后保存。'),
    h('h2', {}, '批次名'), batchInput,
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '英文'), h('th', {}, '中文'), h('th', {}), h('th', {}))), tbody),
    h('div', { class: 'row' },
      h('button', { class: 'secondary', onclick: () => { rows.push({ en: '', zh: '', flagged: false, onDup: 'skip' }); draw(); } }, '＋ 添加一行'),
      h('button', { onclick: save }, '保存'),
      h('button', { class: 'secondary', onclick: () => navigate('home') }, '取消')),
  );
}
```

- [ ] **Step 2: iPad 上验证**

重新加载页面，进入“导入单词”：
1. 用 `Downloads/微信图片_20261110112956_8_247.jpg` 走“选图片”，等待识别（首次会加载约十几 MB 语言包，较慢）。
2. 校对页应出现左右两栏的词条；检查 `knee`、`feet`、`hardly ever`、`pencil case` 等是否正确，把识别错的改掉。
3. 句子区的内容不应出现在列表里。
4. 保存后首页显示词数。再导入一次同样的图片，应全部标黄且默认“跳过”。
5. 用 `Downloads/First grammar&writing-Lesson 8.pdf` 走“选 PDF”，记录它是否有文字层（识别速度快、结果干净就是有）。把 OCR 的错误模式记下来告诉我，必要时调整 `parser`（先补测试用例）。

- [ ] **Step 3: 提交**

```bash
git add src/ui/import.js
git commit -m "feat: import and review views"
```

---

### Task 10: 词表页与设置页

**Files:**
- Modify（整体替换）: `src/ui/words.js`, `src/ui/settings.js`

- [ ] **Step 1: 词表页**

`src/ui/words.js`:

```js
import { h, mount } from './dom.js';
import { getAllCards, putCards, deleteCard } from '../data/store.js';
import { isNew } from '../core/scheduler.js';

function dueText(c, now) {
  if (isNew(c)) return '新词';
  const days = Math.ceil((c.dueAt - now) / 86400000);
  return days <= 0 ? '今天' : `${days} 天后`;
}

export async function render(root, { navigate }) {
  const cards = await getAllCards();
  const now = Date.now();
  const batches = new Map();
  for (const c of cards.sort((a, b) => a.createdAt - b.createdAt)) (batches.get(c.batch) ?? batches.set(c.batch, []).get(c.batch)).push(c);

  const reload = () => render(root, { navigate });
  const edit = async (c) => {
    const en = prompt('英文', c.en); if (en === null) return;
    const zh = prompt('中文', c.zh); if (zh === null) return;
    if (en.trim() && zh.trim()) { await putCards([{ ...c, en: en.trim(), zh: zh.trim() }]); reload(); }
  };

  mount(root,
    h('h1', {}, `词表（${cards.length}）`),
    ...[...batches.entries()].map(([batch, list]) => h('div', { class: 'card' },
      h('h2', {}, `${batch}（${list.length}）`),
      h('table', {}, ...list.map((c) => h('tr', {},
        h('td', {}, c.en), h('td', {}, c.zh),
        h('td', { class: 'muted' }, `盒${c.box} · ${dueText(c, now)}`),
        h('td', {}, h('div', { class: 'row' },
          h('button', { class: 'small secondary', onclick: () => edit(c) }, '改'),
          h('button', { class: 'small secondary', onclick: async () => { await putCards([{ ...c, box: 0, dueAt: 0, reps: 0, lapses: 0, firstSeenAt: null }]); reload(); } }, '重置'),
          h('button', { class: 'small danger', onclick: async () => { if (confirm(`删除 ${c.en}？`)) { await deleteCard(c.id); reload(); } } }, '删'))))),
      ))),
    h('button', { class: 'secondary', onclick: () => navigate('home') }, '返回'),
  );
}
```

- [ ] **Step 2: 设置页**

`src/ui/settings.js`:

```js
import { h, mount } from './dom.js';
import { getSettings, saveSettings, exportBackup, importBackup } from '../data/store.js';
import { speak, hasEnglishVoice } from '../platform/speech.js';

export async function render(root, { navigate }) {
  const settings = await getSettings();
  const size = h('select', {}, ...[5, 10, 20].map((n) => h('option', { value: n, selected: n === settings.sessionSize }, `${n} 个`)));
  const newPer = h('input', { type: 'number', min: 0, max: 100, value: settings.newPerDay });
  const msg = h('div', { class: 'muted' });

  const save = async () => {
    await saveSettings({ sessionSize: Number(size.value), newPerDay: Math.max(0, Number(newPer.value) || 0) });
    msg.textContent = '已保存';
  };
  const testVoice = () => {
    if (!hasEnglishVoice()) { msg.textContent = '没有找到英文语音：到 iPad 设置 → 辅助功能 → 朗读内容 → 声音 → 英语，下载一个语音。'; return; }
    speak('apple'); msg.textContent = '正在朗读 apple';
  };
  const doExport = async () => {
    const backup = await exportBackup();
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `tingxie-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    msg.textContent = `已导出 ${backup.cards.length} 个词`;
  };
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    try { msg.textContent = `已导入 ${await importBackup(JSON.parse(await fileInput.files[0].text()))} 个词`; }
    catch (e) { msg.textContent = '导入失败：' + e.message; }
  });

  mount(root,
    h('h1', {}, '设置'),
    h('div', { class: 'card' }, h('h2', {}, '每轮词数'), size, h('h2', {}, '每天新词上限'), newPer,
      h('div', { class: 'row' }, h('button', { onclick: save }, '保存'))),
    h('div', { class: 'card' }, h('h2', {}, '发音'), h('button', { class: 'secondary', onclick: testVoice }, '🔊 测试发音')),
    h('div', { class: 'card' }, h('h2', {}, '备份'),
      h('div', { class: 'row' }, h('button', { class: 'secondary', onclick: doExport }, '导出备份'), h('button', { class: 'secondary', onclick: () => fileInput.click() }, '导入备份')), fileInput),
    msg,
    h('button', { class: 'secondary', onclick: () => navigate('home') }, '返回'),
  );
}
```

- [ ] **Step 3: iPad 上验证**

词表页：按批次分组显示；“改”能改英文/中文；“重置”后该词回到“新词”；“删”有确认。设置页：改每轮词数为 5 后听写一轮只有 5 个；“测试发音”能读出 apple；“导出备份”能下载 JSON（iPad 上会走“下载”提示）；清空数据后“导入备份”能恢复。

- [ ] **Step 4: 提交**

```bash
git add src/ui/words.js src/ui/settings.js
git commit -m "feat: word list and settings views"
```

---

### Task 11: PWA（图标、清单、Service Worker）与最终验证

**Files:**
- Create: `manifest.webmanifest`, `sw.js`, `scripts/make-icons.mjs`, `icons/icon-180.png`, `icons/icon-512.png`

- [ ] **Step 1: 图标生成脚本**

`scripts/make-icons.mjs`（无依赖，生成橙色底加白色圆的 PNG）:

```js
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
}
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const r = size * 0.32, cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      [raw[o], raw[o + 1], raw[o + 2]] = inside ? [255, 255, 255] : [245, 158, 11];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-180.png', png(180));
writeFileSync('icons/icon-512.png', png(512));
```

Run: `node scripts/make-icons.mjs && ls icons`
Expected：出现 `icon-180.png`、`icon-512.png`。

- [ ] **Step 2: manifest**

`manifest.webmanifest`:

```json
{
  "name": "英语听写",
  "short_name": "听写",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#fffbea",
  "theme_color": "#f59e0b",
  "icons": [
    { "src": "icons/icon-180.png", "sizes": "180x180", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 3: Service Worker**

`sw.js`（核心文件必须缓存成功；vendor 文件逐个尽力缓存，缺哪个不会让安装失败）:

```js
const CACHE = 'tingxie-v1'; // 改动任何文件后把版本号 +1，旧缓存会在 activate 时清掉
const CORE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/app.js', 'src/core/scheduler.js', 'src/core/parser.js', 'src/core/session.js',
  'src/data/store.js', 'src/platform/speech.js', 'src/platform/importer.js',
  'src/ui/dom.js', 'src/ui/home.js', 'src/ui/dictation.js', 'src/ui/import.js', 'src/ui/words.js', 'src/ui/settings.js',
  'icons/icon-180.png', 'icons/icon-512.png',
];
const VENDOR = [
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/tesseract.min.js', 'vendor/worker.min.js',
  'vendor/tesseract-core-lstm.wasm.js', 'vendor/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract-core-lstm.wasm', 'vendor/tesseract-core-simd-lstm.wasm',
  'vendor/lang/eng.traineddata.gz', 'vendor/lang/chi_sim.traineddata.gz',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await Promise.allSettled(VENDOR.map((u) => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request)));
});
```

- [ ] **Step 4: 本地回归**

Run: `npm test`
Expected：scheduler、parser、session 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: PWA manifest, icons and service worker"
```

- [ ] **Step 6: iPad 验证清单（需要 HTTPS，才能验证离线与主屏幕）**

Service Worker 在局域网 http 下不会注册。有两个办法，任选其一：
- 发布到 GitHub Pages（HTTPS，最省事，也是最终使用方式）；
- 或临时用 `npx serve --ssl-cert/--ssl-key` 加自签名证书（iPad 上信任证书较麻烦，不推荐）。

在 HTTPS 地址上逐条验证：
- [ ] Safari 打开页面 → 分享 → 添加到主屏幕；从主屏幕图标打开，全屏无地址栏。
- [ ] 首次进入后，先在导入页完成一次 OCR（让语言包被缓存），再开飞行模式，重新打开应用：首页、听写、导入（拍照 OCR）、词表、设置都能用。
- [ ] 手写键盘在输入框里能正常上屏，提交后判题正确。
- [ ] 答错时朗读正确；音量、静音开关符合预期（iPad 静音开关打开时网页语音可能无声，需要提醒家长）。
- [ ] 把词写对一次，隔天打开，该词不再出现；写错的词隔天仍出现。
- [ ] 修改代码后把 `sw.js` 里的 `CACHE` 版本号 +1，再次访问能拿到新版本（可能需要关闭再打开应用一次）。

---

## Self-Review（对照 spec）

- **导入（拍照/PDF）**：Task 8（importer）、Task 9（校对页、重复处理、未识别行、批次名）。
- **听写流程（显示中文、手写、提交、对错、错时朗读、对时自动下一个）**：Task 7 的听写页，判题 `normalize` 与 spec 一致。
- **遗忘曲线**：Task 2 的 `scheduler`（间隔 0/1/3/7/14/30 天、答错归零、重试写对明天再考、选词顺序、新词上限）。写错的词排到队尾直到写对：Task 4 的 `session`。
- **每轮词数、每天新词上限可设**：Task 10 设置页，Task 2 `pickSession` 使用。
- **首页统计与备份提醒、词表管理、重置为新词**：Task 7、Task 10。
- **离线、PWA、persist**：Task 5 的 `requestPersistence`，Task 7 的 `app.js` 注册 SW，Task 11。
- **没有英文语音的提示**：Task 10 的“测试发音”。
- **错误处理：OCR 失败、没内容**：Task 9 的 `status` 提示。手写出汉字：判错并显示答案（Task 7，字符串不相等即判错）。
- **测试**：`scheduler`、`parser`、`session` 有 `node:test` 用例；UI 与 OCR 在各任务里给了手动验证步骤。
- **类型一致性**：`newCard`、`gradeCorrect`、`markWrong`、`markRetryCorrect`、`pickSession`、`summary`、`createSession`、`currentId`、`answer`、`isFinished`、`stats`、`parseText`、`extractText`、`getAllCards`、`putCards`、`deleteCard`、`getSettings`、`saveSettings`、`exportBackup`、`importBackup`、`getLastBackupAt` 在各任务中名称和签名一致。
- **已知取舍**：词表页的“改”用 `prompt()`，简单但样式朴素，家长使用，可接受。“再来一轮”通过先改 hash 再跳转来强制重新渲染听写页。
