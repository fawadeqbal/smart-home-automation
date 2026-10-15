// Copies onnxruntime-web's browser files next to the wake-word models (public/voice/ort), so the
// hands-free worker can load them from this site. Run before `next dev` / `next build`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// the package's exports hide package.json: find dist/ from its main entry
const dist = path.join(path.dirname(require.resolve('onnxruntime-web')).replace(/[\\/]dist([\\/].*)?$/, ''), 'dist');
const out = path.join(import.meta.dirname, '..', 'public', 'voice', 'ort');
fs.mkdirSync(out, { recursive: true });
for (const f of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  fs.copyFileSync(path.join(dist, f), path.join(out, f));
}
console.log(`voice: onnxruntime-web copied to ${path.relative(process.cwd(), out)}`);
