import { h, mount } from './dom.js';
import { getSettings, saveSettings, buildBackup, markBackedUp, importBackup } from '../data/store.js';
import { speak, speakChinese, hasEnglishVoice, hasChineseVoice } from '../platform/speech.js';

// 去服务器取最新的 version.js。带上时间戳参数，绕过 Service Worker 里缓存的那份。
async function fetchLatestVersion() {
  const res = await fetch(`version.js?check=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(await res.text());
  if (!m) throw new Error('读不出版本号');
  return m[1];
}

// 立即更新：1) 新版本已下载好但页面还没换上 → 直接重新加载；2) 去检查服务器上有没有新版本，装好后重新加载
async function updateNow(say, current) {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) { say('没有启用离线缓存，直接刷新页面…'); location.reload(); return; }

  const cachedVersion = (await caches.keys()).find((k) => k.startsWith('tingxie-'))?.slice('tingxie-'.length);
  if (cachedVersion && cachedVersion !== current) {
    say(`新版本 ${cachedVersion} 已下载好，正在重新打开…`); location.reload(); return;
  }

  say('正在检查更新…');
  await reg.update();
  const worker = reg.installing ?? reg.waiting;
  if (!worker) { say('没有发现新版本。如果刚刚发布过，请等几分钟再试。'); return; }

  say('发现新版本，正在下载…');
  await new Promise((resolve, reject) => {
    const check = () => {
      if (worker.state === 'activated') resolve();
      else if (worker.state === 'redundant') reject(new Error('安装失败，请稍后再试'));
    };
    worker.addEventListener('statechange', check);
    check();
  });
  say('更新完成，正在重新打开…');
  location.reload();
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
        : `服务器上有新版本 ${latest}：请完全关闭应用后重新打开（必要时重复一次）`;
    },
    () => { latestLine.textContent = '无法检查最新版本（可能没有网络）'; },
  );
  const size = h('select', {}, ...[5, 10, 20].map((n) => h('option', { value: n, selected: n === settings.sessionSize }, `${n} 个`)));
  const newPer = h('input', { type: 'number', min: 0, max: 100, value: settings.newPerDay });
  const msg = h('div', { class: 'muted' });

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
