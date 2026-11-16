# Build instructions / Instrucciones de compilación

*(English for AMO reviewers — español más abajo)*

## For addons.mozilla.org reviewers

Environment: any OS with **Node.js 18+** and npm (tested with Node 22). No other tools are needed.

```bash
npm install            # installs typescript 7.0.2 (only dev dependency)
npm run build-for-amo  # = node tools/build-mpegts.mjs && node tools/build.mjs firefox
```

The result is `dist/cellcom-player-firefox-<version>.zip`, byte-identical to the uploaded package (zip timestamps are fixed).

### What is machine-generated
| Path | Origin |
|---|---|
| `lib/hls.min.js` | Unmodified official release **hls.js 1.7.0**: https://github.com/video-dev/hls.js/releases/download/v1.7.0/release.zip (`dist/hls.min.js`) |
| `lib/dash.all.min.js` | Unmodified official **dash.js 4.7.4**: https://github.com/Dash-Industry-Forum/dash.js/tree/v4.7.4/dist (`dash.all.min.js`) |
| `lib/mpegts/**` | **Built by us** from the unmodified source of mpegts.js 1.8.2 (`vendor/mpegts.js/src`, commit `7f189dd95cda246c56d9239ec73f532c5982d60c` of https://github.com/xqq/mpegts.js) with `tools/build-mpegts.mjs`. The output is readable, non-minified ES modules. |

`tools/build-mpegts.mjs` documents every change applied before compiling: webpack's worker loader is replaced by a stub (workers are disabled with `enableWorker:false`), Node's `events` module is replaced by a tiny EventEmitter, the `es6-promise` polyfill is removed, and `.js` extensions are added to relative imports after compiling.

All other files (`background.js`, `detect.js`, `popup.*`, `player.*`) are hand-written, non-minified source.

## Para desarrolladores

| Comando | Qué hace |
|---|---|
| `npm install` | Instala TypeScript (solo hace falta para recompilar mpegts.js). |
| `npm run build:mpegts` | Recompila `lib/mpegts/` desde `vendor/mpegts.js/src`. |
| `npm run build` | Genera en `dist/` los paquetes de Chrome, Firefox y el código fuente. |
| `npm run build:chrome` / `build:firefox` | Solo uno de los paquetes. |

`tools/build.mjs` no usa dependencias: arma los ZIP con Node solo, así que funciona igual en Windows, macOS y Linux. Para cargar la extensión sin empaquetar no hace falta compilar nada: el `manifest.json` de la raíz funciona tanto en Chrome 121+ como en Firefox 140+.
