const MAX_SIDE = 2200;
let workerPromise;
let tesseractLoaded;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('加载失败：' + src));
    document.head.append(s);
  });
}

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      tesseractLoaded ??= loadScript('vendor/tesseract.min.js');
      await tesseractLoaded;
      return Tesseract.createWorker('eng+chi_sim', 1, {
        workerPath: new URL('vendor/worker.min.js', document.baseURI).href,
        corePath: new URL('vendor/', document.baseURI).href,
        langPath: new URL('vendor/lang/', document.baseURI).href,
        logger: (m) => { if (m.status === 'recognizing text') onProgress?.(`识别中 ${Math.round(m.progress * 100)}%`); },
      });
    })();
  }
  return workerPromise;
}

// 缩放 + 灰度 + 对比度拉伸，提高斜拍屏幕照片的识别率
function preprocess(bitmap) {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < lo) lo = g; if (g > hi) hi = g;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = ((d[i] - lo) * 255) / range;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function ocrCanvas(canvas, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return data.text;
}

async function imageToText(file, onProgress) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return ocrCanvas(preprocess(bitmap), onProgress);
}

async function pdfToText(file, onProgress) {
  const pdfjs = await import('../../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

  // 1) 先尝试文字层
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
  const text = lines.join('\n');
  if (text.replace(/\s/g, '').length >= 30) return text;

  // 2) 没有文字层：渲染成图片再 OCR
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(`识别 PDF 第 ${p}/${pdf.numPages} 页`);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    out.push(await ocrCanvas(canvas, onProgress));
  }
  return out.join('\n');
}

export function extractText(file, onProgress) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? pdfToText(file, onProgress) : imageToText(file, onProgress);
}
