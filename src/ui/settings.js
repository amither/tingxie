import { h, mount } from './dom.js';
import { getSettings, saveSettings, buildBackup, markBackedUp, importBackup, getDeepseekKey, setDeepseekKey } from '../data/store.js';
import { speak, speakChinese, hasEnglishVoice, hasChineseVoice } from '../platform/speech.js';
import { checkKey } from '../platform/deepseek.js';

// 去服务器取最新的 version.js。带上时间戳参数，绕过 Service Worker 里缓存的那份。
async function fetchLatestVersion() {
  const res = await fetch(`version.js?check=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(await res.text());
  if (!m) throw new Error('读不出版本号');
  return m[1];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UPDATE_TIMEOUT_MS = 120000;

// 立即更新：去服务器取最新版本号，用带这个版本号的地址重新注册 Service Worker（地址变了，浏览器一定会重新下载安装），
// 等新版本接管后重新加载页面。不用 reg.update()：iOS Safari 上它可能读到 HTTP 缓存里的旧文件，认为“没有更新”
async function updateNow(say, current) {
  say('正在检查更新…');
  const latest = await fetchLatestVersion();
  if (latest === current) { say('已是最新版本 ✓'); return; }
  if (!navigator.serviceWorker || !window.isSecureContext) { say('正在刷新页面…'); location.reload(); return; }

  const cached = (await caches.keys()).find((k) => k.startsWith('tingxie-'))?.slice('tingxie-'.length);
  if (cached === latest) { say(`新版本 ${latest} 已下载好，正在重新打开…`); location.reload(); return; }

  say(`发现新版本 ${latest}，正在下载…`);
  const reg = await navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(latest)}`, { updateViaCache: 'none' });
  const isLatest = (w) => w && new URL(w.scriptURL).searchParams.get('v') === latest;
  // 轮询而不是只等 statechange 事件：Safari 上 register() 返回时新 worker 可能还没出现
  let seen = null;
  const deadline = Date.now() + UPDATE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isLatest(reg.active) && reg.active.state === 'activated') {
      say('更新完成，正在重新打开…');
      location.reload();
      return;
    }
    seen = [reg.installing, reg.waiting, reg.active].find(isLatest) ?? seen;
    if (seen?.state === 'redundant') throw new Error('新版本安装失败，请检查网络后再试');
    await sleep(300);
  }
  throw new Error('下载新版本超时，请检查网络后再试');
}

export async function render(root, { navigate }) {
  const settings = await getSettings();
  const current = self.APP_VERSION ?? '未知';
  const updateMsg = h('div', { class: 'muted' });
  const updateBtn = h('button', { class: 'secondary' }, '🔄 检查并更新');
  updateBtn.onclick = async () => {
    updateBtn.disabled = true;
    try { await updateNow((t) => { updateMsg.textContent = t; }, current); }
    catch (e) { updateMsg.textContent = '更新失败：' + e.message; }
    updateBtn.disabled = false;
  };
  const latestLine = h('div', { class: 'muted' }, '正在检查最新版本…');
  fetchLatestVersion().then(
    (latest) => {
      latestLine.textContent = latest === current
        ? '已是最新版本 ✓'
        : `服务器上有新版本 ${latest}：点下面的按钮更新`;
    },
    () => { latestLine.textContent = '无法检查最新版本（可能没有网络）'; },
  );
  const size = h('select', {}, ...[5, 10, 20].map((n) => h('option', { value: n, selected: n === settings.sessionSize }, `${n} 个`)));
  const newPer = h('input', { type: 'number', min: 0, max: 100, value: settings.newPerDay });
  const msg = h('div', { class: 'muted' });
  const modeSel = h('select', {},
    h('option', { value: 'pad', selected: settings.inputMode === 'pad' }, '✍️ 手写板（应用自己识别，没有候选词）'),
    h('option', { value: 'keyboard', selected: settings.inputMode === 'keyboard' }, '⌨️ 输入框（用 iPad 的手写输入法）'));
  modeSel.addEventListener('change', async () => {
    await saveSettings({ inputMode: modeSel.value });
    msg.textContent = '输入方式已保存';
  });

  // DeepSeek 密钥：只存在这台设备上，不进备份文件
  const keyInput = h('input', { type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'sk-…' });
  const keyState = h('div', { class: 'muted' });
  const showKeyState = (key) => {
    keyState.textContent = key ? `已设置（…${key.slice(-4)}）：拍照导入用 DeepSeek 识别` : '未设置：拍照导入用本机识别';
  };
  showKeyState(await getDeepseekKey());
  const saveKey = async () => {
    const key = keyInput.value.trim();
    if (!key) { keyState.textContent = '请先填写密钥'; return; }
    keyState.textContent = '正在验证密钥…';
    const state = await checkKey(key);
    if (state === 'invalid') { keyState.textContent = '密钥无效，没有保存'; return; }
    await setDeepseekKey(key);
    keyInput.value = '';
    showKeyState(key);
    if (state === 'offline') keyState.textContent += '（现在没联网，没法验证密钥）';
  };
  const clearKey = async () => { await setDeepseekKey(''); showKeyState(''); };

  const save = async () => {
    await saveSettings({ sessionSize: Number(size.value), newPerDay: Math.max(0, Number(newPer.value) || 0) });
    msg.textContent = '已保存';
  };
  const testVoice = () => {
    if (!hasEnglishVoice()) { msg.textContent = '没有找到英文语音：到 iPad 设置 → 辅助功能 → 朗读内容 → 声音 → 英语，下载一个语音。'; return; }
    speak('apple'); msg.textContent = '正在朗读 apple';
  };
  const testChineseVoice = () => {
    if (!hasChineseVoice()) { msg.textContent = '没有找到中文语音：到 iPad 设置 → 辅助功能 → 朗读内容 → 声音 → 中文，下载一个语音。'; return; }
    speakChinese('苹果'); msg.textContent = '正在朗读 苹果';
  };
  // Safari 要求 navigator.share 必须紧跟在点击里调用，中间不能 await 别的异步操作，
  // 所以备份文件在页面打开（和导入完成）时就先准备好
  let prepared;
  const prepare = async () => {
    const backup = await buildBackup();
    const name = `tingxie-backup-${new Date().toISOString().slice(0, 10)}.json`;
    prepared = { backup, file: new File([JSON.stringify(backup)], name, { type: 'application/json' }) };
  };
  await prepare();

  const downloadFile = (file) => {
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const doBackup = async () => {
    const { backup, file } = prepared;
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '听写备份' });
        msg.textContent = `已备份 ${backup.cards.length} 个词。请确认你在分享面板里选了“存储到文件”→“iCloud 云盘”。`;
      } else {
        downloadFile(file);
        msg.textContent = `已下载 ${backup.cards.length} 个词的备份文件，请到“文件”App 里把它移到 iCloud 云盘。`;
      }
      await markBackedUp(backup.exportedAt);
    } catch (e) {
      msg.textContent = e.name === 'AbortError' ? '已取消备份' : '备份失败：' + e.message;
    }
  };
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    try {
      msg.textContent = `已导入 ${await importBackup(JSON.parse(await fileInput.files[0].text()))} 个词`;
      await prepare();
    } catch (e) { msg.textContent = '导入失败：' + e.message; }
    fileInput.value = ''; // 允许再次选择同一个文件
  });

  mount(root,
    h('h1', {}, '设置'),
    h('div', { class: 'card' }, h('h2', {}, '每轮词数'), size, h('h2', {}, '每天新词上限'), newPer,
      h('div', { class: 'row' }, h('button', { onclick: save }, '保存'))),
    h('div', { class: 'card' }, h('h2', {}, '听写输入方式'), modeSel,
      h('div', { class: 'muted' }, '听写时也可以点右上角的按钮随时切换。')),
    h('div', { class: 'card' }, h('h2', {}, '照片识别（DeepSeek）'),
      h('div', { class: 'muted' }, '填了密钥后，拍照导入会把照片发给 DeepSeek 识别，比本机识别准得多，每张约 0.0015 元，需要联网。不填就用本机识别，离线也能用。密钥只存在这台 iPad 上，不会进备份文件。'),
      keyInput,
      h('div', { class: 'row' },
        h('button', { onclick: saveKey }, '保存密钥'),
        h('button', { class: 'secondary', onclick: clearKey }, '清除')),
      keyState),
    h('div', { class: 'card' }, h('h2', {}, '发音'),
      h('div', { class: 'row' },
        h('button', { class: 'secondary', onclick: testVoice }, '🔊 测试英文发音'),
        h('button', { class: 'secondary', onclick: testChineseVoice }, '🔊 测试中文发音'))),
    h('div', { class: 'card' }, h('h2', {}, '备份到 iCloud'),
      h('div', { class: 'muted' }, '点“备份”后在弹出的面板里选“存储到文件”，再选“iCloud 云盘”。换机器时，点“从 iCloud 导入”，到 iCloud 云盘里选这个备份文件。'),
      h('div', { class: 'row' },
        h('button', { onclick: doBackup }, '☁️ 备份'),
        h('button', { class: 'secondary', onclick: () => fileInput.click() }, '从 iCloud 导入')), fileInput),
    msg,
    h('div', { class: 'card' }, h('h2', {}, '版本'), h('div', {}, `当前版本：${current}`), latestLine,
      h('div', { class: 'row' }, updateBtn), updateMsg),
    h('button', { class: 'secondary', onclick: () => navigate('home') }, '返回'),
  );
}
