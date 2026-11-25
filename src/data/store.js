const DB_NAME = 'tingxie';
const DB_VERSION = 1;
// inputMode：'pad' 应用自带的手写板（自己识别）；'keyboard' 输入框 + iPad 系统手写输入法
export const DEFAULT_SETTINGS = { sessionSize: 10, newPerDay: 5, inputMode: 'pad' };

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('cards', { keyPath: 'id' });
      req.result.createObjectStore('meta'); // key-value：settings、lastBackupAt
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    // fn 返回读请求时取它的结果（键不存在时是 undefined）；写操作返回 undefined
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAllCards = () => run('cards', 'readonly', (s) => s.getAll());
export const putCards = (cards) => run('cards', 'readwrite', (s) => { cards.forEach((c) => s.put(c)); });
export const deleteCard = (id) => run('cards', 'readwrite', (s) => { s.delete(id); });

const getMeta = (key) => run('meta', 'readonly', (s) => s.get(key));
const setMeta = (key, value) => run('meta', 'readwrite', (s) => { s.put(value, key); });

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await getMeta('settings')) ?? {}) };
}
// 只改传入的字段，其余设置保持不变
export const saveSettings = async (patch) => setMeta('settings', { ...(await getSettings()), ...patch });
export const getLastBackupAt = () => getMeta('lastBackupAt');

// DeepSeek 密钥单独存放，不放进 settings：备份文件里不会带上它，导入备份也不会覆盖它
export const getDeepseekKey = async () => (await getMeta('deepseekKey')) ?? '';
export const setDeepseekKey = (key) => setMeta('deepseekKey', key);

export async function buildBackup() {
  return { app: 'tingxie', version: 1, exportedAt: Date.now(), settings: await getSettings(), cards: await getAllCards() };
}
export const markBackedUp = (at) => setMeta('lastBackupAt', at);

export async function importBackup(backup) {
  if (backup?.app !== 'tingxie' || !Array.isArray(backup.cards)) throw new Error('不是有效的备份文件');
  await putCards(backup.cards);
  if (backup.settings) await saveSettings({ ...DEFAULT_SETTINGS, ...backup.settings });
  return backup.cards.length;
}

export async function requestPersistence() {
  try { await navigator.storage?.persist?.(); } catch { /* 忽略 */ }
}
