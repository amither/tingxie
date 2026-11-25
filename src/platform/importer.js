import { parseText, entriesFromCells, entriesFromHtml, titleFromText } from '../core/parser.js';
import { toGray, estimateSkew, rotate, findCells, wordPairs, inset, crop, removeLines, resize } from '../core/table.js';
import { deepseekOcr } from './deepseek.js';

const MAX_SIDE = 3000;          // 再大的照片先缩到这个尺寸，免得 iPad 内存吃紧
const CELL_TEXT_HEIGHT = 110;   // 逐格识别时把格子放大到这个高度左右
const PAGE_SIDE = 2400;         // 整页识别时的目标尺寸
const UPLOAD_SIDE = 2400;       // 上传给 DeepSeek 的照片最长边
const EN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ '-";

let tesseractLoaded;
const workers = new Map();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('加载失败：' + src));
    document.head.append(s);
  });
}

// 每种语言 + 参数一个 worker，用完不销毁，下次导入直接复用
function getWorker(langs, params) {
  const key = langs + JSON.stringify(params);
  if (!workers.has(key)) {
    workers.set(key, (async () => {
      tesseractLoaded ??= loadScript('vendor/tesseract.min.js');
      await tesseractLoaded;
      const worker = await Tesseract.createWorker(langs, 1, {
        workerPath: new URL('vendor/worker.min.js', document.baseURI).href,
        corePath: new URL('vendor/', document.baseURI).href,
        langPath: new URL('vendor/lang/', document.baseURI).href,
      });
      await worker.setParameters(params);
      return worker;
    })().catch((e) => { workers.delete(key); throw e; }));
  }
  return workers.get(key);
}

function grayToCanvas({ width, height, data }) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = data[i];
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function canvasToGray(source) {
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return toGray(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

// 词表是带格子的表格时：逐格识别，英文格只用英文模型，中文格只用中文模型，词性格不识别
async function readCells(img, rows, onProgress) {
  const eng = await getWorker('eng', { tessedit_pageseg_mode: '7', tessedit_char_whitelist: EN_CHARS });
  const chi = await getWorker('chi_sim', { tessedit_pageseg_mode: '7' });
  const read = async (worker, cell) => {
    const c = inset(cell);
    const f = Math.min(4, Math.max(1, CELL_TEXT_HEIGHT / (c.y1 - c.y0 + 1)));
    const { data } = await worker.recognize(grayToCanvas(crop(img, c, f)));
    return data;
  };
  const total = rows.reduce((n, pairs) => n + pairs.length, 0);
  let done = 0;
  const texts = [];
  for (const pairs of rows) {
    const out = [];
    for (const p of pairs) {
      onProgress?.(`识别中 ${++done}/${total}`);
      const en = await read(eng, p.en);
      const zh = await read(chi, p.zh);
      out.push({ en: en.text, zh: zh.text, enConf: en.confidence });
    }
    texts.push(out);
  }
  return entriesFromCells(texts);
}

// 标题在表格上方：只识别这一条，找不到返回 null
async function readTitle(img, tableTop) {
  const bottom = tableTop - 4;
  if (bottom < 20) return null;
  const strip = { x0: 0, y0: 0, x1: img.width - 1, y1: bottom };
  const f = Math.max(1, Math.min(3, PAGE_SIDE / img.width));
  const worker = await getWorker('eng', { tessedit_pageseg_mode: '3' });
  const { data } = await worker.recognize(grayToCanvas(crop(img, strip, f)));
  return titleFromText(data.text);
}

// 找不到格子（不是表格、拍得太斜）时：去掉表格线后整页识别，再按行解析
async function readPage(img, onProgress) {
  onProgress?.('整页识别中…');
  const worker = await getWorker('eng+chi_sim', { preserve_interword_spaces: '1' });
  const f = Math.max(1, Math.min(3, PAGE_SIDE / Math.max(img.width, img.height)));
  const { data } = await worker.recognize(grayToCanvas(resize(removeLines(img), f)));
  return { ...parseText(data.text), title: titleFromText(data.text) };
}

async function imageEntries(source, onProgress) {
  onProgress?.('分析图片…');
  let img = canvasToGray(source);
  const skew = estimateSkew(img);
  if (Math.abs(skew) >= 0.1) img = rotate(img, -skew);
  const rows = wordPairs(findCells(img));
  if (rows.reduce((n, pairs) => n + pairs.length, 0) >= 3) {
    const result = await readCells(img, rows, onProgress);
    if (result.entries.length >= 3) return { ...result, title: await readTitle(img, rows[0][0].en.y0) }; // 标题在词表第一行（表头）上方
  }
  return readPage(img, onProgress);
}

async function loadPdf(file) {
  const pdfjs = await import('../../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href;
  return pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
}

// PDF 的文字层（电子版 PDF 有，扫描版没有）
async function pdfText(pdf, onProgress) {
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(`读取 PDF 第 ${p}/${pdf.numPages} 页`);
    const content = await (await pdf.getPage(p)).getTextContent();
    const byY = new Map();
    for (const it of content.items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 4); // 同一行的 y 相近
      (byY.get(y) ?? byY.set(y, []).get(y)).push(it);
    }
    [...byY.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => {
      lines.push(items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' '));
    });
  }
  return lines.join('\n');
}

// 没有文字层的 PDF：每页渲染成图片，和照片走同样的本机识别流程
async function pdfLocal(pdf, onProgress) {
  const entries = [], unrecognized = [];
  let title = null;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const r = await imageEntries(canvas, (msg) => onProgress?.(`第 ${p}/${pdf.numPages} 页 ${msg}`));
    entries.push(...r.entries); unrecognized.push(...r.unrecognized);
    title ??= r.title;
  }
  return { entries, unrecognized, title };
}

// 照片缩小并转成 JPEG 再上传：iPad 拍的照片动辄几 MB，上传慢
function toJpeg(source) {
  const scale = Math.min(1, UPLOAD_SIDE / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片转换失败'))), 'image/jpeg', 0.9));
}

// 返回 { entries: [{ en, zh }], unrecognized: [string | { en, zh }], title?, notice? }。title 是从词表里认出的标题（如 Lesson 8），PDF 不用它（用文件名）。
// 有 DeepSeek 密钥时照片（和没有文字层的 PDF）交给 DeepSeek 识别；没有密钥或调用失败时用本机识别，notice 说明原因
export async function extractEntries(file, onProgress, { deepseekKey = '' } = {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  let pdf = null, bitmap = null;
  if (isPdf) {
    pdf = await loadPdf(file);
    const text = await pdfText(pdf, onProgress);
    if (text.replace(/\s/g, '').length >= 30) return parseText(text);
  } else {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  }

  let notice = '';
  if (deepseekKey) {
    try {
      onProgress?.('DeepSeek 识别中，通常要几秒…');
      const text = isPdf ? await deepseekOcr(file, file.name, deepseekKey) : await deepseekOcr(await toJpeg(bitmap), 'photo.jpg', deepseekKey);
      const result = entriesFromHtml(text);
      if (result.entries.length || result.unrecognized.length) return { ...result, title: titleFromText(text) };
      notice = 'DeepSeek 没识别出词条，已改用本机识别。';
    } catch (e) {
      console.error(e);
      notice = `DeepSeek 识别失败（${e.message}），已改用本机识别。`;
    }
  }
  const result = isPdf ? await pdfLocal(pdf, onProgress) : await imageEntries(bitmap, onProgress);
  return notice ? { ...result, notice } : result;
}
