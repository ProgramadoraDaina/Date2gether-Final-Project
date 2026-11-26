// Copia el WASM de MediaPipe a public/ para servir el desenfoque desde la app y no desde un CDN.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve('@mediapipe/tasks-vision'));
const source = join(packageDir, 'wasm');
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'mediapipe', 'wasm');

if (!existsSync(source)) {
  console.warn(`copy-mediapipe: no se encontró ${source}; el desenfoque no va a estar disponible.`);
} else {
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}
