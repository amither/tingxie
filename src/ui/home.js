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
