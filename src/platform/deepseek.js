// 调 DeepSeek OCR 识别照片 / PDF。浏览器直接请求（接口允许跨域），密钥由调用方传入。
// 文档：https://api-docs.deepseek.com/zh-cn/guides/ocr/
const API = 'https://api.deepseek.com';
const TIMEOUT_MS = 180000; // 接口从开始上传算起最多 180 秒

const HTTP_ERRORS = {
  401: '密钥无效，请到设置里检查',
  402: '账户余额不足',
  408: '上传超时',
  413: '文件太大',
  429: '请求太频繁，请稍后再试',
};

// 用一个很轻的请求核对密钥：'ok' | 'invalid' | 'offline'
export async function checkKey(key) {
  try {
    const res = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) return 'invalid';
    return res.ok ? 'ok' : 'offline';
  } catch {
    return 'offline';
  }
}

// 返回所有页的识别文字（表格是 HTML）
export async function deepseekOcr(blob, filename, key) {
  const form = new FormData();
  form.append('purpose', 'text_recognition');
  form.append('file', blob, filename);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API}/v1/tools/ocr`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: ctrl.signal });
    if (!res.ok) throw new Error(HTTP_ERRORS[res.status] ?? `服务出错（HTTP ${res.status}）`);
    const data = await res.json(); // 识别时服务端会先发一串换行保持连接，JSON 解析会忽略它们
    if (data.error) throw new Error('识别失败：' + (data.error.message ?? JSON.stringify(data.error)));
    return data.pages.map((p) => p.text).join('\n');
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('识别超时');
    if (res) throw e;
    // 请求没拿到响应：密钥不对时服务端会在上传完之前就断开，浏览器只报网络错误，所以再核对一下密钥
    const state = await checkKey(key);
    if (state === 'invalid') throw new Error(HTTP_ERRORS[401]);
    if (state === 'offline') throw new Error('连不上 DeepSeek（可能没有网络）');
    throw new Error('上传被中断（网络不稳定，或当前网络拦截了上传）');
  } finally {
    clearTimeout(timer);
  }
}
