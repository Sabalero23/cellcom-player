// Compila mpegts.js (vendor/mpegts.js/src, sin modificar) a módulos ES en lib/mpegts/ para la extensión.
//
// Cambios que se aplican sobre una copia temporal del código fuente:
//   1. utils/webworkify-webpack.js -> función que avisa que no hay workers (la extensión usa enableWorker:false;
//      los workers de webpack no funcionan en extensiones MV3).
//   2. Módulo 'events' de Node -> events.js propio (EventEmitter mínimo para el navegador).
//   3. Se quita el polyfill es6-promise (los navegadores actuales ya tienen Promise).
//   4. Después de compilar: se agrega la extensión .js a los imports relativos y se fija __VERSION__.
//
// Uso:  npm ci && npm run build:mpegts      (requiere Node 18+ y typescript 7.0.2 de package.json)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'vendor/mpegts.js/src');
const TMP = path.join(ROOT, '.build/mpegts');
const OUT = path.join(ROOT, 'lib/mpegts');
const VERSION = '1.8.2-cellcom';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

// 1) copia limpia
fs.rmSync(path.join(ROOT, '.build'), { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.cpSync(SRC, path.join(TMP, 'src'), { recursive: true });

// 2) parches
fs.writeFileSync(path.join(TMP, 'src/utils/webworkify-webpack.js'),
`// Cellcom: sin workers (los workers de webpack no aplican en la extensión). Se usa enableWorker:false.
export default function work() { throw new Error('mpegts.js: workers deshabilitados en esta compilación'); }
`);
fs.writeFileSync(path.join(TMP, 'src/events.js'),
`// Cellcom: EventEmitter mínimo compatible con el módulo 'events' de Node, para el navegador.
class EventEmitter {
  constructor() { this._ev = Object.create(null); }
  on(n, f) { (this._ev[n] || (this._ev[n] = [])).push(f); return this; }
  addListener(n, f) { return this.on(n, f); }
  once(n, f) { const w = (...a) => { this.off(n, w); f.apply(this, a); }; w._orig = f; return this.on(n, w); }
  off(n, f) { const l = this._ev[n]; if (l) this._ev[n] = l.filter(x => x !== f && x._orig !== f); return this; }
  removeListener(n, f) { return this.off(n, f); }
  removeAllListeners(n) { if (n === undefined) this._ev = Object.create(null); else delete this._ev[n]; return this; }
  emit(n, ...a) { const l = this._ev[n]; if (!l || !l.length) return false; for (const f of l.slice()) f.apply(this, a); return true; }
  listenerCount(n) { return (this._ev[n] || []).length; }
  listeners(n) { return (this._ev[n] || []).slice(); }
  setMaxListeners() { return this; }
}
export default EventEmitter;
export { EventEmitter };
`);
const poly = path.join(TMP, 'src/utils/polyfill.js');
fs.writeFileSync(poly, fs.readFileSync(poly, 'utf8').replace("require('es6-promise').polyfill();", '/* sin polyfill */'));
for (const f of walk(path.join(TMP, 'src'))) {
  if (!/\.(js|ts)$/.test(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  if (!s.includes("from 'events'")) continue;
  let rel = path.relative(path.dirname(f), path.join(TMP, 'src/events.js')).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  fs.writeFileSync(f, s.split("from 'events'").join(`from '${rel}'`));
}

// 3) compilar con TypeScript (los errores de tipos del proyecto original no impiden la salida)
fs.writeFileSync(path.join(TMP, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    outDir: './out', allowJs: true, module: 'es2020', target: 'es2019', moduleResolution: 'bundler',
    rewriteRelativeImportExtensions: true, allowSyntheticDefaultImports: true, strict: false, noEmitOnError: false,
    skipLibCheck: true, experimentalDecorators: true, declaration: false, sourceMap: false, noImplicitAny: false,
    rootDir: './src', lib: ['dom', 'ESNext', 'WebWorker'], types: [],
  },
  include: ['./src/**/*'], exclude: ['./src/index.js'],
}, null, 2));
const require = createRequire(import.meta.url);
const tscBin = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
try { execFileSync(process.execPath, [tscBin, '-p', TMP], { stdio: 'pipe' }); }
catch { /* tsc sale con código 2 por errores de tipos del original; la salida igual se genera */ }
const OUTTMP = path.join(TMP, 'out');
if (!fs.existsSync(path.join(OUTTMP, 'mpegts.js'))) throw new Error('La compilación no generó out/mpegts.js');

// 4) imports con extensión .js y versión
const imp = /(\b(?:from|import)\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;
for (const f of walk(OUTTMP)) {
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(imp, (m, a, q, p) => a + q + (p.endsWith('.ts') ? p.slice(0, -3) + '.js' : p.endsWith('.js') ? p : p + '.js') + q);
  s = s.replace('return __VERSION__;', `return '${VERSION}';`);
  fs.writeFileSync(f, s);
}

// 5) publicar en lib/mpegts
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(OUTTMP, OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'vendor/mpegts.js/LICENSE'), path.join(OUT, 'LICENSE'));
fs.rmSync(path.join(ROOT, '.build'), { recursive: true, force: true });
console.log('mpegts.js compilado en lib/mpegts/');
