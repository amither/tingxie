export function createSession(ids) {
  return { queue: [...ids], failed: new Set(), total: ids.length, done: 0, firstTryCorrect: 0 };
}

export const currentId = (s) => (s.queue.length ? s.queue[0] : null);
export const isFinished = (s) => s.queue.length === 0;

// 答错时不换词：原地重写，直到写对才进入下一个
// 返回 'correct' | 'retry-correct' | 'wrong' | 'wrong-again'
export function answer(s, correct) {
  const id = s.queue[0];
  const failedBefore = s.failed.has(id);
  if (correct) {
    s.queue.shift();
    s.done += 1;
    if (!failedBefore) { s.firstTryCorrect += 1; return 'correct'; }
    return 'retry-correct';
  }
  s.failed.add(id);
  return failedBefore ? 'wrong-again' : 'wrong';
}

export function stats(s) {
  return { total: s.total, firstTryCorrect: s.firstTryCorrect, done: s.done, struggled: [...s.failed] };
}
