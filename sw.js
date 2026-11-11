importScripts('version.js'); // 定义 self.APP_VERSION；它的内容变化也会触发 Service Worker 更新
const CACHE = 'tingxie-' + self.APP_VERSION; // 旧版本的缓存会在 activate 时清掉
const CORE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'version.js',
  'src/app.js', 'src/core/scheduler.js', 'src/core/parser.js', 'src/core/session.js',
  'src/data/store.js', 'src/platform/speech.js', 'src/platform/importer.js',
  'src/ui/dom.js', 'src/ui/home.js', 'src/ui/dictation.js', 'src/ui/import.js', 'src/ui/words.js', 'src/ui/settings.js',
  'icons/icon-180.png', 'icons/icon-512.png',
];
const VENDOR = [
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/tesseract.min.js', 'vendor/worker.min.js',
  'vendor/tesseract-core-lstm.wasm.js', 'vendor/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract-core-lstm.wasm', 'vendor/tesseract-core-simd-lstm.wasm',
  'vendor/lang/eng.traineddata.gz', 'vendor/lang/chi_sim.traineddata.gz',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 核心文件绕过浏览器 HTTP 缓存（GitHub Pages 默认缓存 10 分钟），保证装到的是最新版
    await Promise.all(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    // vendor 很少变化：旧缓存里有就直接复用，省得每次升级都重新下载十几 MB
    await Promise.allSettled(VENDOR.map(async (u) => {
      const old = await caches.match(u);
      if (old) await cache.put(u, old); else await cache.add(u);
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request)));
});
