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
