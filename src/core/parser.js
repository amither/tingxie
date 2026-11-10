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
