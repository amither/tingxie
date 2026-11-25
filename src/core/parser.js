const POS = '(?:n|v|adj|adv|prep|pron|conj|art|num|int|aux|det)';
// OCR 把词性认坏的样子：nm、I.、/.（词组的词性写成 /.）
const JUNK_POS = '(?:nm|[/Il1])';
const CJK = '\\u4e00-\\u9fff';
const HAS_CJK = new RegExp(`[${CJK}]`);
const POS_WORD = new RegExp(`^${POS}$`, 'i');
const POS_TOKEN = new RegExp(`(^|\\s)(?:${POS}|${JUNK_POS})[.。,:]?(?=\\s|$)`, 'g');

// 英文：单词之间只隔一个空格（整页识别时两栏之间是一大段空格，不能连成一个词组）
// 中间可选词性；中文可含括号、省略号、分号等（OCR 可能夹空格）
const ENTRY = new RegExp(
  `([A-Za-z][A-Za-z'’]*(?: [A-Za-z][A-Za-z'’]*)*?)(?:\\s+(?:${POS}|${JUNK_POS})[.。,:]?)?\\s*`
  + `([${CJK}][${CJK}（）()\\s…⋯.．。·;；,，、:：~～]*)`,
  'g',
);

const SENTENCES_HEADER = /^\W*sentences\b/i;
const HEADERS = new Set(['词汇', '词性', '词义', '中文', '英文', '单词', '释义']);
const latinWords = (s) => s.match(/[A-Za-z][A-Za-z'’]*/g) ?? [];
const wordCount = (en) => (en ? en.split(' ').length : 0);

export function cleanEn(s) {
  return s.replace(/[’‘`]/g, "'").replace(/[^A-Za-z' -]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[' -]+|[' -]+$/g, '');
}

export function cleanZh(s) {
  return s
    .replace(/[|[\]{}<>]/g, '')
    .replace(/\s+/g, '')
    .replace(/[(〈《]/g, '（').replace(/[)〉》]/g, '）')
    .replace(new RegExp(`([${CJK}])[.．。…⋯·]+(?=[${CJK}])`, 'g'), '$1…') // 在…里面：OCR 常把省略号认成 . 或 .…
    .replace(/;/g, '；').replace(/,/g, '，')
    .replace(/^[。.，,；;、:：…⋯·]+|[。.，,；;、:：…⋯·]+$/g, '');
}

const isEnglishWord = (en) => wordCount(en) >= 1 && wordCount(en) <= 3 && !POS_WORD.test(en)
  && en.split(' ').every((w) => /^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(w));

export function parseText(text) {
  const entries = [];
  const unrecognized = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[|[\]{}]/g, ' ').trim(); // 残留的表格线
    if (!line) continue;
    if (SENTENCES_HEADER.test(line)) break;

    let matched = false, rest = line;
    for (const m of line.matchAll(ENTRY)) {
      matched = true;
      rest = rest.replace(m[0], '  ');
      const en = cleanEn(m[1]);
      const zh = cleanZh(m[2]);
      if (wordCount(en) > 3 || POS_WORD.test(en)) continue; // 句子，或把词性当成了英文
      entries.push({ en, zh });
    }
    if (matched) {
      // 同一行另一栏的中文没认出来：把那个英文留给家长补
      for (const seg of rest.split(/\s{2,}/)) {
        const s = seg.replace(POS_TOKEN, ' ').trim();
        if (/^[a-z][a-z' -]*$/.test(s) && isEnglishWord(cleanEn(s))) unrecognized.push(cleanEn(s));
      }
      continue;
    }

    const words = latinWords(line).length;
    if (words >= 1 && words <= 3 && !/[.?!]/.test(line)) unrecognized.push(line);
  }
  return { entries, unrecognized };
}

// 逐格识别的结果 → 词条。rows: [[{ en, zh, enConf? }, ...], ...]，每行里从左到右是各栏；enConf 是英文格的识别置信度（0–100）。
// 先左栏从上到下，再右栏（和纸上的顺序一致）；跳过表头，遇到 Sentences 那一行就停。
const MIN_EN_CONF = 60;
const lowConf = (p) => p.enConf != null && p.enConf < MIN_EN_CONF;

export function entriesFromCells(rows) {
  const stop = rows.findIndex((pairs) => pairs.some((p) => /^sentences?\b/i.test(cleanEn(p.en))));
  let used = stop < 0 ? rows : rows.slice(0, stop);
  // 表头“词汇”用英文模型认，只会得到置信度很低的乱码
  if (used.length && used[0].every(lowConf)) used = used.slice(1);
  const cols = Math.max(0, ...used.map((pairs) => pairs.length));
  const entries = [], unrecognized = [];
  for (let c = 0; c < cols; c++) {
    for (const pairs of used) {
      const p = pairs[c];
      if (!p) continue;
      const en = lowConf(p) ? '' : cleanEn(p.en), zh = cleanZh(p.zh);
      if (HEADERS.has(zh) || HEADERS.has(cleanZh(p.en))) continue;
      if (wordCount(en) > 3) continue; // 整句
      const enOk = isEnglishWord(en), zhOk = HAS_CJK.test(zh);
      if (enOk && zhOk) entries.push({ en, zh });
      else if (enOk || zhOk) unrecognized.push({ en: enOk ? en : '', zh: zhOk ? zh : '' });
    }
  }
  return { entries, unrecognized };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? m;
});
const stripTags = (s) => decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
// 词性格（n. / adj. / 词组的 /. 或只剩一个点）不是英文
const isPosCell = (s) => new RegExp(`^(?:${POS}|/)?\\s*[.。]?$`, 'i').test(s.trim());

// DeepSeek OCR 的结果：表格是 HTML（<table><tr><td>…）。每行里英文格后面、下一个英文格之前的第一个中文格是它的词义；
// 表头、词性格自然被跳过。没有表格时去掉标记按普通文字逐行解析。
export function entriesFromHtml(text) {
  const tables = [...text.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
  if (!tables.length) return parseText(stripTags(text));
  const rows = [];
  for (const table of tables) {
    for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]).trim());
      const pairs = [];
      let en = null;
      for (const cell of cells) {
        if (!cell || isPosCell(cell)) continue;
        if (HAS_CJK.test(cell)) {
          if (en !== null) { pairs.push({ en, zh: cell }); en = null; }
        } else if (/[A-Za-z]/.test(cell)) {
          if (en !== null) pairs.push({ en, zh: '' }); // 上一个英文没有词义
          en = cell;
        }
      }
      if (en !== null) pairs.push({ en, zh: '' });
      if (pairs.length) rows.push(pairs);
    }
  }
  return entriesFromCells(rows);
}

// 词表标题（如 “First grammar&writing-Lesson 8”），和 PDF 导入时用文件名得到的批次名一致。
// 取表格之外第一个带 Lesson/Unit 编号的行；去掉 “Paper Check—” 前缀、“.pdf” 后缀和两边的杂字符。找不到返回 null
const TITLE = /[A-Za-z][A-Za-z0-9&'’ .\-–—]*?\b(?:lesson|unit)\s*\d+/i;
export function titleFromText(text) {
  const outside = text.replace(/<table\b[\s\S]*?<\/table>/gi, '\n');
  for (const raw of outside.split(/\r?\n/)) {
    const line = stripTags(raw).replace(/^.*?paper\s*check\s*[-–—:：]*\s*/i, '');
    const m = TITLE.exec(line);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}
