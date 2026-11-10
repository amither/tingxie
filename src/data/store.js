const DB_NAME = 'tingxie';
const DB_VERSION = 1;
export const DEFAULT_SETTINGS = { sessionSize: 10, newPerDay: 5 };

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
    tx.oncomplete = () => resolve(result?.result ?? result);
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
export const saveSettings = (settings) => setMeta('settings', settings);
export const getLastBackupAt = () => getMeta('lastBackupAt');

export async function exportBackup() {
  const backup = { app: 'tingxie', version: 1, exportedAt: Date.now(), settings: await getSettings(), cards: await getAllCards() };
  await setMeta('lastBackupAt', backup.exportedAt);
  return backup;
}

export async function importBackup(backup) {
  if (backup?.app !== 'tingxie' || !Array.isArray(backup.cards)) throw new Error('不是有效的备份文件');
  await putCards(backup.cards);
  if (backup.settings) await saveSettings({ ...DEFAULT_SETTINGS, ...backup.settings });
  return backup.cards.length;
}

export async function requestPersistence() {
  try { await navigator.storage?.persist?.(); } catch { /* 忽略 */ }
}
