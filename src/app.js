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
// updateViaCache: 'none'：检查更新时 sw.js 和它引入的 version.js 都绕过 HTTP 缓存
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
