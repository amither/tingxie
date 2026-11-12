import { h, mount } from './dom.js';
import { getAllCards, putCards, deleteCard } from '../data/store.js';
import { isNew } from '../core/scheduler.js';
import { setPicked } from './selection.js';

// 勾选的词；改/重置/删之后页面会重新渲染，所以放在模块里保留
const chosen = new Set();

function dueText(c, now) {
  if (isNew(c)) return '新词';
  const days = Math.ceil((c.dueAt - now) / 86400000);
  return days <= 0 ? '今天' : `${days} 天后`;
}

export async function render(root, { navigate }) {
  const cards = await getAllCards();
  const now = Date.now();
  const existing = new Set(cards.map((c) => c.id));
  for (const id of [...chosen]) if (!existing.has(id)) chosen.delete(id); // 已删除的词不再保留勾选
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

  // 勾选只更新底部栏和各批次的“全选”，不重画整页
  const startBtn = h('button', { onclick: () => { setPicked([...chosen]); navigate('dictation'); } });
  const clearBtn = h('button', { class: 'secondary', onclick: () => { chosen.clear(); syncBoxes(); } }, '清空');
  const selbar = h('div', { class: 'selbar' }, startBtn, clearBtn);
  const rowBoxes = new Map(); // id -> checkbox
  const batchBoxes = []; // [{ box, list }]
  function syncBoxes() {
    for (const [id, box] of rowBoxes) box.checked = chosen.has(id);
    for (const { box, list } of batchBoxes) box.checked = list.every((c) => chosen.has(c.id));
    startBtn.textContent = `听写选中的 ${chosen.size} 个词`;
    startBtn.disabled = chosen.size === 0;
    clearBtn.disabled = chosen.size === 0;
  }
  const toggle = (id, on) => { if (on) chosen.add(id); else chosen.delete(id); syncBoxes(); };

  mount(root,
    h('h1', {}, `词表（${cards.length}）`),
    selbar,
    h('div', { class: 'muted' }, '勾选今天要听写的词，再点上面的按钮开始。'),
    ...newestFirst.map(([batch, list]) => {
      const allBox = h('input', { type: 'checkbox', 'aria-label': `全选 ${batch}` });
      allBox.addEventListener('change', () => { for (const c of list) { if (allBox.checked) chosen.add(c.id); else chosen.delete(c.id); } syncBoxes(); });
      batchBoxes.push({ box: allBox, list });
      return h('div', { class: 'card' },
        h('h2', { class: 'batch-title' }, allBox, `${batch}（${list.length}）`),
        h('table', {}, ...list.map((c) => {
          const box = h('input', { type: 'checkbox', 'aria-label': `选择 ${c.en}` });
          box.addEventListener('change', () => toggle(c.id, box.checked));
          rowBoxes.set(c.id, box);
          return h('tr', {},
            h('td', { class: 'pick' }, box),
            h('td', {}, c.en), h('td', {}, c.zh),
            h('td', { class: 'muted' }, `盒${c.box} · ${dueText(c, now)}`),
            h('td', {}, h('div', { class: 'row' },
              h('button', { class: 'small secondary', onclick: () => edit(c) }, '改'),
              h('button', { class: 'small secondary', onclick: async () => { await putCards([{ ...c, box: 0, dueAt: 0, reps: 0, lapses: 0, firstSeenAt: null }]); reload(); } }, '重置'),
              h('button', { class: 'small danger', onclick: async () => { if (confirm(`删除 ${c.en}？`)) { await deleteCard(c.id); reload(); } } }, '删'))));
        })));
    }),
    h('button', { class: 'secondary', onclick: () => navigate('home') }, '返回'),
  );
  syncBoxes();
}
