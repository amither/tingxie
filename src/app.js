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
// 第一次打开时注册离线缓存。已经注册过就不再重复注册：换成别的地址会触发一次重装。
// 升级由设置页的“检查并更新”用新版本号的地址重新注册（见 settings.js）
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(self.APP_VERSION)}`, { updateViaCache: 'none' });
  });
}
