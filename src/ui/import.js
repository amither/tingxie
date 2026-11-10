import { h, mount } from './dom.js';
export async function render(root, { navigate }) {
  mount(root, h('h1', {}, '导入单词（待实现）'), h('button', { onclick: () => navigate('home') }, '回首页'));
}
