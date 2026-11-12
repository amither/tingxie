// 词表页勾选的词，交给听写页使用。只在页面存活期间有效；听写页读取后即清空。
let picked = null;

export const setPicked = (ids) => { picked = ids.length ? [...ids] : null; };

export function takePicked() {
  const ids = picked;
  picked = null;
  return ids;
}
