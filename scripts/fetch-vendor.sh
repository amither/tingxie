#!/bin/sh
# 把 pdf.js、Tesseract.js 及中英文语言包拷贝到 vendor/，供离线使用
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
cd "$WORK"
npm init -y >/dev/null
npm install pdfjs-dist@4 tesseract.js@5 tesseract.js-core@5 @tesseract.js-data/eng @tesseract.js-data/chi_sim

mkdir -p "$ROOT/vendor/lang"
cp node_modules/pdfjs-dist/build/pdf.min.mjs node_modules/pdfjs-dist/build/pdf.worker.min.mjs "$ROOT/vendor/"
cp node_modules/tesseract.js/dist/tesseract.min.js node_modules/tesseract.js/dist/worker.min.js "$ROOT/vendor/"
cp node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js "$ROOT/vendor/"
cp node_modules/tesseract.js-core/tesseract-core-lstm.wasm node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm "$ROOT/vendor/" 2>/dev/null || true
cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz "$ROOT/vendor/lang/"
cp node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz "$ROOT/vendor/lang/"
echo "vendor ready:"; ls -la "$ROOT/vendor" "$ROOT/vendor/lang"
