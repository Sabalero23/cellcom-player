// Empaqueta la extensión en dist/ sin dependencias externas (sirve en Windows, macOS y Linux).
//
//   node tools/build.mjs            -> los tres paquetes
//   node tools/build.mjs chrome     -> dist/cellcom-player-chrome-X.zip   (Chrome Web Store, Edge, Opera, Brave)
//   node tools/build.mjs firefox    -> dist/cellcom-player-firefox-X.zip  (subir a addons.mozilla.org)
//   node tools/build.mjs source     -> dist/cellcom-player-source-X.zip   (código fuente para la revisión de AMO)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const V = manifest.version;

// Archivos que forman la extensión instalada
const EXT_FILES = ['manifest.json', 'background.js', 'detect.js', 'popup.html', 'popup.js', 'player.html', 'player.css', 'player.js', 'icons', 'lib'];
// Código fuente para AMO (todo lo necesario para recompilar, sin node_modules ni dist)
const SRC_FILES = [...EXT_FILES, 'vendor', 'tools', 'package.json', 'package-lock.json', 'README.md', 'BUILD.md', 'LICENSE'];

const walk = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).sort().flatMap(n => walk(path.posix.join(rel.split(path.sep).join('/'), n)));
};

// ── ZIP mínimo (deflate) ──
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zip(entries, out) {   // entries: [{name, data: Buffer}]
  const parts = [], central = []; let off = 0;
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // fecha fija: zips reproducibles
  for (const { name, data } of entries) {
    const n = Buffer.from(name, 'utf8'), z = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(DOS_TIME, 10); h.writeUInt16LE(DOS_DATE, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    parts.push(h, n, z);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n); off += h.length + n.length + z.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  fs.writeFileSync(out, Buffer.concat([...parts, cd, e]));
  console.log('✓', path.relative(ROOT, out), `(${entries.length} archivos, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}
const read = (files) => files.flatMap(walk).filter(f => !/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(f)).map(f => ({ name: f, data: fs.readFileSync(path.join(ROOT, f)) }));

// ── manifiestos por navegador ──
function chromeManifest() {
  const m = structuredClone(manifest);
  m.background = { service_worker: manifest.background.service_worker };
  delete m.browser_specific_settings;
  return m;
}
function firefoxManifest() {
  const m = structuredClone(manifest);
  m.background = { scripts: [manifest.background.service_worker] };
  return m;
}
const withManifest = (entries, m) => entries.map(e => e.name === 'manifest.json' ? { name: e.name, data: Buffer.from(JSON.stringify(m, null, 2)) } : e);

fs.mkdirSync(DIST, { recursive: true });
const want = process.argv[2];
if (!want || want === 'chrome') zip(withManifest(read(EXT_FILES), chromeManifest()), path.join(DIST, `cellcom-player-chrome-${V}.zip`));
if (!want || want === 'firefox') zip(withManifest(read(EXT_FILES), firefoxManifest()), path.join(DIST, `cellcom-player-firefox-${V}.zip`));
if (!want || want === 'source') zip(read(SRC_FILES), path.join(DIST, `cellcom-player-source-${V}.zip`));
