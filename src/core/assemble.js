// 手写板每格认出一个字母（空字符串表示空格子）：首尾空格子忽略，中间的空格子（连续多个也一样）算一个空格
export function assembleCells(letters) {
  const words = [[]];
  for (const l of letters) {
    if (l) words.at(-1).push(l);
    else if (words.at(-1).length) words.push([]);
  }
  return words.filter((w) => w.length).map((w) => w.join('')).join(' ');
}
