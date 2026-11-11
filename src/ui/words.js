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
  // 最近导入的批次排在最上面；list 已按 createdAt 升序，末尾那个就是该批次最近导入的词
  const newestFirst = [...batches.entries()].sort((a, b) => b[1].at(-1).createdAt - a[1].at(-1).createdAt);

  const reload = () => render(root, { navigate });
  const edit = async (c) => {
    const en = prompt('英文', c.en); if (en === null) return;
    const zh = prompt('中文', c.zh); if (zh === null) return;
    if (en.trim() && zh.trim()) { await putCards([{ ...c, en: en.trim(), zh: zh.trim() }]); reload(); }
  };

  mount(root,
    h('h1', {}, `词表（${cards.length}）`),
    ...newestFirst.map(([batch, list]) => h('div', { class: 'card' },
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
