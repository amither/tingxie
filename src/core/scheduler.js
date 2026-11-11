export const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
export const MAX_BOX = INTERVAL_DAYS.length - 1;

// 本地时间 now 所在日往后 offset 天的零点时间戳
function dayStart(now, offset = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

// crypto.randomUUID 只在 HTTPS/localhost 下可用；局域网 http 访问时退回到随机串
export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

export function newCard({ en, zh, batch }, now = new Date()) {
  return {
    id: newId(),
    en, zh, batch,
    box: 0, dueAt: 0, reps: 0, lapses: 0,
    createdAt: now.getTime(),
    firstSeenAt: null,
  };
}

export const isNew = (c) => c.firstSeenAt == null;

const seenAt = (c, now) => (c.firstSeenAt == null ? now.getTime() : c.firstSeenAt);

// 第一次就写对
export function gradeCorrect(c, now) {
  const box = Math.min(c.box + 1, MAX_BOX);
  return { ...c, box, dueAt: dayStart(now, INTERVAL_DAYS[box]), reps: c.reps + 1, firstSeenAt: seenAt(c, now) };
}

// 写错：归零，本轮末尾会再出现
export function markWrong(c, now) {
  return { ...c, box: 0, lapses: c.lapses + 1, dueAt: now.getTime(), firstSeenAt: seenAt(c, now) };
}

// 写错后重试才写对：盒子保持 0，明天再考
export function markRetryCorrect(c, now) {
  return { ...c, box: 0, dueAt: dayStart(now, 1), firstSeenAt: seenAt(c, now) };
}

function newAvailable(cards, now, newPerDay) {
  const today = dayStart(now, 0);
  const newToday = cards.filter((c) => !isNew(c) && c.firstSeenAt >= today).length;
  return Math.max(0, newPerDay - newToday);
}

export function pickSession(cards, now, { sessionSize, newPerDay }) {
  const t = now.getTime();
  // 先取新词：最近导入的批次优先；批内按导入顺序（createdAt 升序）
  const pool = cards.filter(isNew);
  const latest = new Map();
  for (const c of pool) latest.set(c.batch, Math.max(latest.get(c.batch) ?? 0, c.createdAt));
  pool.sort((a, b) => latest.get(b.batch) - latest.get(a.batch)
    || (a.batch < b.batch ? -1 : a.batch > b.batch ? 1 : 0)
    || a.createdAt - b.createdAt);
  const fresh = pool.slice(0, Math.min(sessionSize, newAvailable(cards, now, newPerDay)));
  // 名额有剩余再用到期词补：盒子低的优先，同盒子按到期时间
  const due = cards
    .filter((c) => !isNew(c) && c.dueAt <= t)
    .sort((a, b) => a.box - b.box || a.dueAt - b.dueAt)
    .slice(0, sessionSize - fresh.length);
  return fresh.concat(due);
}

// 今天的任务做完后的“额外练习”：只练学过的词，最容易忘的优先（盒子低、到期早）。
// exclude 里是已经练过的词，排到后面；名额不够时才补回来。
export function pickPractice(cards, size, exclude = new Set()) {
  const learned = cards
    .filter((c) => !isNew(c))
    .sort((a, b) => a.box - b.box || a.dueAt - b.dueAt);
  const fresh = learned.filter((c) => !exclude.has(c.id));
  const repeats = learned.filter((c) => exclude.has(c.id));
  return fresh.concat(repeats).slice(0, size);
}

export function summary(cards, now, { newPerDay }) {
  const t = now.getTime();
  const due = cards.filter((c) => !isNew(c) && c.dueAt <= t).length;
  const freshCount = cards.filter(isNew).length;
  return { due, newAvail: Math.min(freshCount, newAvailable(cards, now, newPerDay)) };
}
