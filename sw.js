const CACHE = 'tingxie-v3'; // 改动任何文件后把版本号 +1，旧缓存会在 activate 时清掉
const CORE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
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
    await cache.addAll(CORE);
    await Promise.allSettled(VENDOR.map((u) => cache.add(u)));
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
