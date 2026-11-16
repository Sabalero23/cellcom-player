/* Cellcom Player – IPTV · HLS · DASH · EPG
   Motores: hls.js (HLS), dash.js (DASH + ClearKey/Widevine), <video> nativo (MP4/WebM/MP3…) */
'use strict';

// ───────────────────────── utilidades ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const store = {
  get: async (k, d) => (await chrome.storage.local.get(k))[k] ?? d,
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  del: (k) => chrome.storage.local.remove(k),
};
const hhmm = (t) => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
const uid = () => Math.random().toString(36).slice(2, 10);
const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, '').replace(/\b(fhd|uhd|hd|sd|4k|hevc|h265|720p|1080p|backup|alt)\b/g, '')
  .replace(/[^a-z0-9]/g, '');
const decodeEnt = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms);
}

const DEFAULTS = { intercept: true, lowLatency: false, autoplay: true, tsFix: true, epgShift: 0, headers: {}, clearkey: '', widevine: '', layout: 1, sidebar: true, lite: false, bigBuffer: true };
let S = { ...DEFAULTS };

// ───────────────────────── cabeceras / DRM ─────────────────────────
async function applyHeaders(h = {}) {
  const headers = { ...(S.headers || {}), ...h };
  try { await chrome.runtime.sendMessage({ type: 'setHeaders', headers }); } catch { }
}

const hex2b64u = (h) => btoa(h.match(/../g).map(x => String.fromCharCode(parseInt(x, 16))).join(''))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function parseClearKeys(str = '') {
  const out = {};
  for (const pair of str.split(/[,\s]+/).filter(Boolean)) {
    let [kid, key] = pair.split(':');
    if (!kid || !key) continue;
    kid = kid.replace(/-/g, ''); key = key.replace(/-/g, '');
    const isHex = (x) => /^[0-9a-f]{32}$/i.test(x);
    out[isHex(kid) ? hex2b64u(kid) : kid] = isHex(key) ? hex2b64u(key) : key;
  }
  return Object.keys(out).length ? out : null;
}

// ───────────────────────── detección de tipo ─────────────────────────
function extOf(url) {
  try { const p = new URL(url).pathname.toLowerCase(); const m = p.match(/\.([a-z0-9]{2,5})$/); return m ? m[1] : ''; }
  catch { return ''; }
}
async function sniff(url) {
  const ext = extOf(url);
  if (ext === 'mpd') return 'dash';
  if (ext === 'flv') return 'flv';
  if (['mp4', 'webm', 'mkv', 'mov', 'mp3', 'aac', 'ogg', 'm4a', 'wav', 'flac', 'm4v'].includes(ext)) return 'native';
  const ctrl = new AbortController();
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('dash+xml')) { ctrl.abort(); return 'dash'; }
    if (/^(video|audio)\/(?!mp2t)/.test(ct) && !ct.includes('mpegurl')) { ctrl.abort(); return 'native'; }
    const reader = r.body.getReader();
    let txt = '', bytes = 0;
    while (bytes < 65536) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.length; txt += new TextDecoder().decode(value, { stream: true });
      if (value[0] === 0x47 && bytes > 188 && !txt.includes('#EXTM3U')) { ctrl.abort(); return 'ts'; }
      if (txt.length > 4000 && (txt.includes('#EXT-X-') || txt.includes('#EXTINF') || txt.includes('<MPD') || isW3U(txt))) break;
    }
    ctrl.abort();
    if (txt.includes('<MPD')) return 'dash';
    if (isW3U(txt)) return 'playlist';
    if (txt.includes('#EXTM3U') || txt.includes('#EXTINF')) {
      if (/#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|VERSION|KEY|MAP|PLAYLIST-TYPE|MEDIA:)/.test(txt)) return 'hls';
      return 'playlist';
    }
    if (ct.includes('mpegurl')) return 'hls';
    if (ct.includes('mp2t') || ext === 'ts') return 'ts';
  } catch { ctrl.abort(); }
  if (ext === 'm3u' || ext === 'w3u') return 'playlist';
  if (ext === 'm3u8') return 'hls';
  return 'native';
}

let _mpegtsP = null;
const loadMpegts = () => (_mpegtsP ||= import(chrome.runtime.getURL('lib/mpegts/mpegts.js')).then(m => { m.default.LoggingControl.enableAll = false; return m.default; }));

// ───────────────────────── Tile (un reproductor) ─────────────────────────
class Tile {
  constructor(idx) {
    this.idx = idx;
    this.root = el('div', 'tile');
    this.video = el('video'); this.video.controls = true; this.video.playsInline = true; this.video.autoplay = true;
    this.label = el('div', 'label');
    this.msg = el('div', 'msg');
    this.amb = el('canvas', 'amb'); this.amb.width = 8; this.amb.height = 5;
    this.root.append(this.amb, this.video, this.label, this.msg);
    const actx = this.amb.getContext('2d', { willReadFrequently: false });
    setInterval(() => {
      if (S.lite || tiles.length > 1 || document.hidden || this.video.paused || this.video.readyState < 2) return;
      try { actx.drawImage(this.video, 0, 0, 8, 5); this.root.classList.add('glow'); } catch { }
    }, 1000);
    this.video.addEventListener('playing', markPlaying); this.video.addEventListener('pause', markPlaying);
    this.video.addEventListener('loadedmetadata', () => updateBar());
    this.video.addEventListener('emptied', () => this.root.classList.remove('glow'));
    this.root.addEventListener('mousedown', () => setActive(this.idx));
    this.video.addEventListener('playing', () => this.setMsg());
    this.video.addEventListener('waiting', () => this.setMsg('spin'));
    this.video.addEventListener('error', () => {
      if (this.engine === 'native' && this.video.error) this.setMsg('err', 'No se pudo reproducir (' + (this.video.error.message || 'formato no soportado') + ')');
    });
    this.video.addEventListener('dblclick', (e) => { e.preventDefault(); toggleFullscreen(); });
    this.hls = null; this.dash = null; this.engine = ''; this.item = null; this.statsOn = false;
    // medición de cuadros reales (para diagnosticar "cámara lenta")
    this.fpsInfo = null; const win = { f: 0, w: 0, m: null };
    const tick = (now, md) => {
      if (win.m === null) { win.w = now; win.m = md.mediaTime; win.f = 0; }
      else {
        win.f++;
        const dw = (now - win.w) / 1000, dm = md.mediaTime - win.m;
        if (dw >= 2) {
          this.fpsInfo = { shown: win.f / dw, content: dm > 0 ? win.f / dm : 0, rate: dm / dw };
          win.w = now; win.m = md.mediaTime; win.f = 0;
        }
      }
      this.video.requestVideoFrameCallback(tick);
    };
    if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(tick);
    this.video.addEventListener('emptied', () => { win.m = null; this.fpsInfo = null; });
  }
  setMsg(kind, text) {
    this.msg.className = 'msg'; this.msg.innerHTML = '';
    if (kind === 'spin') this.msg.append(el('div', 'spin'));
    else if (kind) { this.msg.classList.add(kind); this.msg.textContent = text; }
  }
  // MPEG-TS continuo (IPTV/Xtream sin m3u8) y FLV en vivo, con mpegts.js
  async loadTs(url, type, item, attempt = 0) {
    let mpegts;
    try { mpegts = await loadMpegts(); } catch (e) { return this.setMsg('err', 'No se pudo cargar el motor MPEG-TS: ' + e.message); }
    if (this.item !== item) return;
    if (!mpegts.getFeatureList().mseLivePlayback) return this.setMsg('err', 'Este navegador no soporta MPEG-TS en vivo.');
    this.engine = type === 'flv' ? 'flv' : 'mpegts';
    const p = this.ts = mpegts.createPlayer({ type: type === 'flv' ? 'flv' : 'mpegts', isLive: true, url, withCredentials: !!S.withCredentials }, {
      enableWorker: false, lazyLoad: false, enableStashBuffer: true, stashInitialSize: 512 * 1024,
      liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: S.bigBuffer ? 10 : 5, liveBufferLatencyMinRemain: S.bigBuffer ? 3 : 1,
      autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 60, autoCleanupMinBackwardDuration: 30,
      fixAudioTimestampGap: true,
    });
    const retry = (why) => {
      if (this.ts !== p || this.item !== item) return;
      if (attempt >= 6) return this.setMsg('err', 'El canal TS se cortó: ' + why);
      this.setMsg('spin'); try { p.destroy(); } catch { } this.ts = null;
      setTimeout(() => { if (this.item === item) this.loadTs(url, type, item, attempt + 1); }, 1500 + attempt * 1000);
    };
    p.on(mpegts.Events.ERROR, (t, d, info) => retry(`${d}${info?.code ? ' (HTTP ' + info.code + ')' : ''}`));
    let ended = false;
    p.on(mpegts.Events.LOADING_COMPLETE, () => { ended = true; }); // se reconecta cuando se termine lo que quedó en buffer
    p.on(mpegts.Events.MEDIA_INFO, () => updateBar());
    p.attachMediaElement(this.video); p.load();
    this.video.play().catch(() => { });
    // si queda congelado (el servidor deja de mandar datos), reconectar
    let lastT = -1, still = 0;
    clearInterval(this.tsWatch);
    this.tsWatch = setInterval(() => {
      if (this.ts !== p) return clearInterval(this.tsWatch);
      const v = this.video, b = v.buffered, ahead = b.length ? b.end(b.length - 1) - v.currentTime : 0;
      if (ended && ahead < 0.5) { ended = false; return retry('el servidor cerró la conexión'); }
      if (v.paused) return;
      still = v.currentTime === lastT ? still + 1 : 0; lastT = v.currentTime;
      if (still >= 8) { still = 0; retry('sin datos'); }
    }, 1000);
  }
  destroy() {
    try { this.hls?.destroy(); } catch { }
    try { this.dash?.reset(); } catch { }
    try { this.ts?.destroy(); } catch { }
    clearInterval(this.tsWatch);
    this.hls = this.dash = this.ts = null; this.engine = '';
    this.video.removeAttribute('src'); try { this.video.load(); } catch { }
  }
  async load(item) {
    // item: {url, name, logo, headers, drm:{clearkey, widevine}, type}
    this.destroy();
    this.item = item;
    this.label.textContent = item.name || item.url;
    this.root.classList.add('show-label'); setTimeout(() => this.root.classList.remove('show-label'), 2500);
    this.setMsg('spin');
    let url = item.url;
    await applyHeaders(item.headers);

    let type = item.type || await sniff(url);
    if (type === 'ts' && S.tsFix && /\/live\/[^/]+\/[^/]+\/\d+\.ts/.test(url)) { url = url.replace(/\.ts(\?|$)/, '.m3u8$1'); type = 'hls'; }
    if (type === 'playlist') { this.setMsg(); return loadPlaylistFromUrl(url, item.name); }
    if (type === 'ts' || type === 'flv') return this.loadTs(url, type, item);
    this.engine = type;
    const v = this.video;

    if (type === 'hls') {
      if (!Hls.isSupported()) { v.src = url; return; }
      const hls = this.hls = new Hls({
        enableWorker: false, // sin worker: estable en extensiones MV3 y los errores internos se capturan
        lowLatencyMode: !!S.lowLatency, backBufferLength: 30, maxBufferLength: S.bigBuffer ? 60 : 30, maxMaxBufferLength: 120,
        liveSyncDurationCount: S.lowLatency ? 2 : (S.bigBuffer ? 5 : 3), liveMaxLatencyDurationCount: S.bigBuffer ? 12 : 8,
        maxBufferHole: 0.5, nudgeMaxRetry: 10, startFragPrefetch: true, abrEwmaDefaultEstimate: 2e6, testBandwidth: true,
        // políticas de reintento (formato de hls.js 1.6+)
        manifestLoadPolicy: { default: { maxTimeToFirstByteMs: 10000, maxLoadTimeMs: 20000, timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 } } },
        playlistLoadPolicy: { default: { maxTimeToFirstByteMs: 10000, maxLoadTimeMs: 20000, timeoutRetry: { maxNumRetry: 3, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 } } },
        fragLoadPolicy: { default: { maxTimeToFirstByteMs: 10000, maxLoadTimeMs: 120000, timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 10, retryDelayMs: 500, maxRetryDelayMs: 4000 } } },
        xhrSetup: (xhr) => { if (S.withCredentials) xhr.withCredentials = true; },
        startLevel: -1, capLevelToPlayerSize: tiles.length > 1, capLevelOnFPSDrop: true,
      });
      let mediaRecover = 0;
      hls.on(Hls.Events.ERROR, (_, d) => {
        // error interno de hls.js (remux de un segmento roto): se recrea el reproductor
        if (d.details === 'internalException' || d.type === Hls.ErrorTypes.OTHER_ERROR && d.fatal) {
          if ((item._internalRetry = (item._internalRetry || 0) + 1) <= 3) {
            setTimeout(() => { if (this.item === item) this.load(item); }, 800);
            return;
          }
        }
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecover++ < 3) { hls.recoverMediaError(); return; }
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && d.details !== 'manifestLoadError' && mediaRecover++ < 5) { setTimeout(() => hls.startLoad(), 1500); return; }
        const code = d.response?.code;
        const hint = (code === 403 || code === 401) ? ' — El servidor pide Referer/Origin o cookies: abrilo desde el detector del ícono (agrega el Referer solo) o cargalo en Ajustes.' : '';
        this.setMsg('err', `Error: ${d.details}${code ? ` (HTTP ${code})` : ''}${hint}`);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { v.play().catch(() => { }); updateBar(); });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => updateBar());
      hls.loadSource(url); hls.attachMedia(v);
    } else if (type === 'dash') {
      const p = this.dash = dashjs.MediaPlayer().create();
      p.initialize();
      p.updateSettings({ debug: { logLevel: dashjs.Debug.LOG_LEVEL_NONE }, streaming: { abr: { autoSwitchBitrate: { video: true }, limitBitrateByPortal: tiles.length > 1 }, buffer: { fastSwitchEnabled: true, stableBufferTime: S.bigBuffer ? 20 : 12, bufferTimeAtTopQuality: S.bigBuffer ? 30 : 20 }, delay: { liveDelayFragmentCount: S.bigBuffer ? 5 : 3 } } });
      const prot = {};
      const ck = parseClearKeys(item.drm?.clearkey || S.clearkey);
      if (ck) prot['org.w3.clearkey'] = { clearkeys: ck };
      const wv = item.drm?.widevine || S.widevine;
      if (wv) prot['com.widevine.alpha'] = { serverURL: wv };
      if (Object.keys(prot).length) p.setProtectionData(prot);
      p.on(dashjs.MediaPlayer.events.ERROR, (e) => this.setMsg('err', 'Error DASH: ' + (e.error?.message || e.error?.code || 'desconocido')));
      p.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => updateBar());
      p.on(dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, () => updateBar());
      p.setAutoPlay(true); p.attachView(v); p.attachSource(url);
    } else {
      v.src = url; v.play().catch(() => { });
    }
  }
  // Calidades / pistas
  qualities() {
    if (this.hls) return { list: this.hls.levels.map((l, i) => ({ i, label: (l.height ? l.height + 'p' : l.name || 'Nivel ' + i) + (l.bitrate ? ` · ${(l.bitrate / 1e6).toFixed(1)} Mbps` : '') })), cur: this.hls.autoLevelEnabled ? -1 : this.hls.currentLevel, auto: true };
    if (this.dash) {
      const l = this.dash.getBitrateInfoListFor('video') || [];
      const auto = this.dash.getSettings().streaming.abr.autoSwitchBitrate.video;
      return { list: l.map(b => ({ i: b.qualityIndex, label: `${b.height}p · ${(b.bitrate / 1e6).toFixed(1)} Mbps` })), cur: auto ? -1 : this.dash.getQualityFor('video'), auto: true };
    }
    return { list: [], cur: -1 };
  }
  setQuality(i) {
    if (this.hls) { this.hls.currentLevel = i; }
    if (this.dash) {
      this.dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: i < 0 } } } });
      if (i >= 0) this.dash.setQualityFor('video', i, true);
    }
  }
  audios() {
    if (this.hls) return { list: this.hls.audioTracks.map((t, i) => ({ i, label: t.name || t.lang || 'Pista ' + (i + 1) })), cur: this.hls.audioTrack };
    if (this.dash) {
      const tr = this.dash.getTracksFor('audio') || []; const c = this.dash.getCurrentTrackFor('audio');
      return { list: tr.map((t, i) => ({ i, label: (t.labels?.[0]?.text || t.lang || 'Pista ' + (i + 1)) + (t.audioChannelConfiguration?.[0]?.value ? ` (${t.audioChannelConfiguration[0].value}ch)` : '') })), cur: tr.indexOf(c) };
    }
    return { list: [], cur: -1 };
  }
  setAudio(i) {
    if (this.hls) this.hls.audioTrack = i;
    if (this.dash) this.dash.setCurrentTrack(this.dash.getTracksFor('audio')[i]);
  }
  subs() {
    if (this.hls) return { list: this.hls.subtitleTracks.map((t, i) => ({ i, label: t.name || t.lang || 'Sub ' + (i + 1) })), cur: this.hls.subtitleTrack };
    if (this.dash) {
      const tr = this.dash.getTracksFor('text') || [];
      return { list: tr.map((t, i) => ({ i, label: t.labels?.[0]?.text || t.lang || 'Sub ' + (i + 1) })), cur: this.dash.getCurrentTextTrackIndex?.() ?? -1 };
    }
    const tt = [...this.video.textTracks];
    return { list: tt.map((t, i) => ({ i, label: t.label || t.language || 'Sub ' + (i + 1) })), cur: tt.findIndex(t => t.mode === 'showing') };
  }
  setSub(i) {
    if (this.hls) { this.hls.subtitleDisplay = i >= 0; this.hls.subtitleTrack = i; }
    else if (this.dash) { this.dash.enableText(i >= 0); this.dash.setTextTrack(i); }
    else [...this.video.textTracks].forEach((t, k) => t.mode = k === i ? 'showing' : 'disabled');
  }
  statsText() {
    const v = this.video, q = v.getVideoPlaybackQuality?.() || {};
    let buf = 0; for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) buf = v.buffered.end(i) - v.currentTime;
    const lines = [
      `Motor:      ${this.engine || '-'}`,
      `Resolución: ${v.videoWidth}x${v.videoHeight}`,
      `Buffer:     ${buf.toFixed(1)} s`,
      `Frames:     ${q.totalVideoFrames || 0} (perdidos ${q.droppedVideoFrames || 0})`,
    ];
    if (this.hls) {
      const l = this.hls.levels[this.hls.currentLevel];
      if (l) lines.push(`Bitrate:    ${(l.bitrate / 1e6).toFixed(2)} Mbps`, `Códecs:     ${l.videoCodec || ''} ${l.audioCodec || ''}`);
      if (this.hls.latency) lines.push(`Latencia:   ${this.hls.latency.toFixed(1)} s`);
      lines.push(`Ancho banda:${(this.hls.bandwidthEstimate / 1e6).toFixed(2)} Mbps`);
    }
    if (this.ts) {
      const st = this.ts.statisticsInfo || {}, mi = this.ts.mediaInfo || {};
      lines.push(`Descarga:   ${((st.speed || 0) * 8 / 1000).toFixed(2)} Mbps`);
      if (mi.videoCodec) lines.push(`Códecs:     ${mi.videoCodec} ${mi.audioCodec || ''}`);
    }
    if (this.dash) {
      const l = (this.dash.getBitrateInfoListFor('video') || [])[this.dash.getQualityFor('video')];
      if (l) lines.push(`Bitrate:    ${(l.bitrate / 1e6).toFixed(2)} Mbps`);
    }
    const nominal = this.ts?.mediaInfo?.fps || this.hls?.levels?.[this.hls.currentLevel]?.frameRate || 0;
    const f = this.fpsInfo;
    if (f) lines.push(`Cuadros/s:  ${f.shown.toFixed(1)} mostrados · ${f.content.toFixed(1)} por tiempo de señal${nominal ? ' · ' + (+nominal).toFixed(2) + ' declarados' : ''}`, `Velocidad:  ${(f.rate * 100).toFixed(0)} % del tiempo real`);
    const drop = q.totalVideoFrames ? q.droppedVideoFrames / q.totalVideoFrames : 0;
    let diag = '✓ Reproducción estable';
    if (f && !v.paused && f.rate < 0.9) diag = '⚠ Se reproduce más lento que el tiempo real: buffer o red insuficiente';
    else if (f && nominal && f.content < nominal * 0.7) diag = '⚠ Los tiempos de los cuadros vienen mal desde la señal (posible video entrelazado)';
    else if (drop > 0.05 || (f && f.content && f.shown < f.content * 0.85)) diag = '⚠ El equipo no llega a decodificar todos los cuadros: activá la aceleración por hardware';
    else if (buf < 2 && !v.paused) diag = '⚠ Buffer bajo: la red o el servidor no alcanzan';
    lines.push('', diag);
    return lines.join('\n');
  }
}

function markPlaying() { document.body.classList.toggle('playing', tiles.some(t => !t.video.paused && !t.video.ended)); }

// ───────────────────────── multivista ─────────────────────────
const tiles = [];
let active = 0;
const T = () => tiles[active];

function setLayout(n) {
  n = +n || 1;
  S.layout = n; saveSettings();
  $('#stage').dataset.layout = n;
  $$('#layoutSeg button').forEach(b => b.classList.toggle('on', +b.dataset.layout === n));
  while (tiles.length < n) { const t = new Tile(tiles.length); tiles.push(t); $('#stage').append(t.root); }
  while (tiles.length > n) { const t = tiles.pop(); t.destroy(); t.root.remove(); }
  if (active >= n) active = 0;
  setActive(active);
}
function setActive(i) {
  active = i;
  tiles.forEach((t, k) => { t.root.classList.toggle('active', k === i); if (tiles.length > 1) t.video.muted = k !== i; });
  if (tiles.length === 1) tiles[0].video.muted = false;
  updateBar(); renderEpgPanel(); renderList();
}

// ───────────────────────── listas M3U ─────────────────────────
let playlists = [];     // {id,name,url,epg,text?}
let curPl = null;
let channels = [];      // canales de la lista actual
let view = [];          // filtrados
let favs = new Set();
let groupFilter = '', searchQ = '', favOnly = false;

function splitExtinf(line) {
  // #EXTINF:-1 tvg-id="x" group-title="a,b",Nombre
  const body = line.slice(line.indexOf(':') + 1);
  let q = false, i = 0;
  for (; i < body.length; i++) { const c = body[i]; if (c === '"') q = !q; else if (c === ',' && !q) break; }
  const head = body.slice(0, i), name = body.slice(i + 1).trim();
  const attrs = {}; head.replace(/([\w-]+)=("([^"]*)"|'([^']*)'|(\S+))/g, (_, k, __, a, b, c) => { attrs[k.toLowerCase()] = a ?? b ?? c; });
  return { attrs, name };
}
function parseM3U(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out = []; let meta = {}, cur = null, epgUrl = [];
  const head = lines.find(l => l.startsWith('#EXTM3U')) || '';
  const hm = head.match(/(?:x-tvg-url|url-tvg|tvg-url)="([^"]+)"/i); if (hm) epgUrl = hm[1].split(',').map(x => x.trim()).filter(Boolean);
  for (let raw of lines) {
    const l = raw.trim(); if (!l) continue;
    if (l.startsWith('#EXTINF')) {
      const { attrs, name } = splitExtinf(l);
      cur = { name: name || attrs['tvg-name'] || 'Canal', logo: attrs['tvg-logo'] || '', group: attrs['group-title'] || '', tvgId: attrs['tvg-id'] || '', tvgName: attrs['tvg-name'] || '', chno: attrs['tvg-chno'] || '', headers: { ...meta.headers }, drm: { ...meta.drm } };
      if (attrs['user-agent']) cur.headers['User-Agent'] = attrs['user-agent'];
      if (attrs['http-referrer'] || attrs['referer']) cur.headers['Referer'] = attrs['http-referrer'] || attrs['referer'];
      meta = {};
    } else if (l.startsWith('#EXTGRP:')) { if (cur) cur.group ||= l.slice(8).trim(); }
    else if (l.startsWith('#EXTHTTP:')) {
      try { const j = JSON.parse(l.slice(9)); const h = cur ? cur.headers : (meta.headers ||= {}); for (const [k, v] of Object.entries(j)) h[normHeader(k)] = String(v); } catch { }
    }
    else if (l.startsWith('#EXTVLCOPT:')) {
      const [k, ...v] = l.slice(11).split('='); const val = v.join('=').trim(); const key = k.trim().toLowerCase();
      const h = cur ? cur.headers : (meta.headers ||= {});
      if (key === 'http-referrer' || key === 'http-referer') h['Referer'] = val;
      else if (key === 'http-user-agent') h['User-Agent'] = val;
      else if (key === 'http-origin') h['Origin'] = val;
    } else if (l.startsWith('#KODIPROP:')) {
      const [k, ...v] = l.slice(10).split('='); const val = v.join('=').trim(); const key = k.trim().toLowerCase();
      const d = cur ? cur.drm : (meta.drm ||= {});
      if (key.endsWith('license_key')) {
        if (/^https?:/.test(val)) d.widevine = val.split('|')[0];
        else if (val.startsWith('{')) { try { const j = JSON.parse(val); d.clearkey = (j.keys || []).map(x => b64u2hex(x.kid) + ':' + b64u2hex(x.k)).join(','); } catch { } }
        else d.clearkey = val;
      }
    } else if (!l.startsWith('#')) {
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(l) && !(cur && /^[\w./-]+\.(m3u8|mpd|ts|mp4)/i.test(l))) continue; // separadores tipo ===ARGENTINA===
      if (!cur) cur = { name: l.split('/').pop(), logo: '', group: '', tvgId: '', tvgName: '', chno: '', headers: {}, drm: {} };
      const sp = splitPipe(l); Object.assign(cur.headers, sp.headers);
      cur.url = sp.url; cur.num = out.length + 1;
      out.push(cur); cur = null;
    }
  }
  return { channels: out, epgUrl };
}
function splitPipe(raw) {
  const i = raw.indexOf('|'); if (i < 0) return { url: raw, headers: {} };
  const headers = {};
  for (const [k, v] of new URLSearchParams(raw.slice(i + 1))) {
    const lk = k.toLowerCase();
    headers[lk === 'user-agent' ? 'User-Agent' : lk === 'referer' || lk === 'referrer' ? 'Referer' : lk === 'origin' ? 'Origin' : lk === 'cookie' ? 'Cookie' : k] = v;
  }
  return { url: raw.slice(0, i), headers };
}
const normHeader = (k) => ({ 'user-agent': 'User-Agent', referer: 'Referer', referrer: 'Referer', origin: 'Origin', cookie: 'Cookie' })[k.toLowerCase()] || k;

// ── W3U (listas JSON de Wiseplay) ──
const isW3U = (t) => { const s = t.replace(/^\uFEFF/, '').trimStart(); return (s[0] === '{' || s[0] === '[') && /"(stations|groups)"\s*:/.test(s.slice(0, 200000)); };
function looseJSON(t) {
  t = t.replace(/^\uFEFF/, '');
  try { return JSON.parse(t); } catch { }
  // tolera comentarios y comas finales, comunes en listas hechas a mano
  const clean = t.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n\r]*|\/\*[\s\S]*?\*\/|,(\s*[}\]])/g, (m, str, close) => str ?? close ?? '');
  return JSON.parse(clean);
}
async function parseW3U(text, baseUrl) {
  const root = looseJSON(text);
  const out = []; let skipped = 0, remote = 0;
  const val = (x) => (typeof x === 'string' && x.trim() && !/^(true|false|null|undefined)$/i.test(x.trim())) ? x.trim() : '';
  const abs = (u) => { try { return new URL(u, baseUrl && /^https?:/.test(baseUrl) ? baseUrl : undefined).href; } catch { return u; } };
  async function walk(node, path, depth, isRoot = depth === 0) {
    if (!node || depth > 4) return;
    if (Array.isArray(node)) { for (const n of node) await walk(n, path, depth, isRoot); return; }
    const name = val(node.name);
    const here = name && !isRoot ? [...path, name] : path;
    for (const st of node.stations || []) {
      const url = val(st.url);
      if (!url || st.embed === true || st.isHost === true || st.isParser === true) { skipped++; continue; }
      if (/\.w3u(\?|$)/i.test(url) && remote < 30) { remote++; try { await walk(looseJSON(await fetchText(abs(url))), [...here, val(st.name) || 'Lista'], depth + 1, true); } catch { skipped++; } continue; }
      const headers = {};
      if (val(st.referer)) headers.Referer = val(st.referer);
      if (val(st.userAgent)) headers['User-Agent'] = val(st.userAgent);
      if (val(st.origin)) headers.Origin = val(st.origin);
      if (val(st.cookie)) headers.Cookie = val(st.cookie);
      const drm = {};
      if (val(st.clearkey) || val(st.key)) drm.clearkey = val(st.clearkey) || val(st.key);
      if (val(st.license) || val(st.licenseUrl)) drm.widevine = val(st.license) || val(st.licenseUrl);
      const sp = splitPipe(url); Object.assign(headers, sp.headers); sp.url = abs(sp.url);
      out.push({ name: val(st.name) || 'Canal', logo: val(st.image) || val(st.logo), group: here.join(' › ') || val(root.name) || 'W3U', tvgId: val(st.epgId) || val(st.tvgId), tvgName: '', chno: '', headers, drm, url: sp.url, num: out.length + 1 });
    }
    for (const g of node.groups || []) {
      // grupo que apunta a otra lista W3U
      if (!g.stations && !g.groups && val(g.url) && remote < 30) { remote++; try { await walk(looseJSON(await fetchText(abs(val(g.url)))), [...here, val(g.name) || 'Lista'], depth + 1, true); } catch { skipped++; } continue; }
      await walk(g, here, depth + 1);
    }
  }
  await walk(root, [], 0);
  const epg = [root.epg, root.epgUrl, root['x-tvg-url']].map(val).filter(Boolean).flatMap(x => x.split(',').map(s => s.trim()));
  return { channels: out, epgUrl: epg, skipped };
}
function b64u2hex(s) { try { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return [...b].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); } catch { return s; } }

async function fetchText(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(ds).text();
  }
  return new TextDecoder().decode(buf);
}

async function savePlaylists() { await store.set('playlists', playlists); }
function renderPlaylistSel() {
  const s = $('#playlistSel'); s.innerHTML = '';
  if (!playlists.length) s.append(new Option('— Sin listas —', ''));
  for (const p of playlists) s.append(new Option(p.name, p.id));
  if (curPl) s.value = curPl.id;
}

async function loadPlaylistFromUrl(url, name) {
  let p = playlists.find(x => x.url === url);
  if (!p) { const u = new URL(url); const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '').replace(/\.(m3u8?|w3u|json|txt)$/i, ''); p = { id: uid(), name: name && name !== url ? name : (last && !/^get\.php$/i.test(last) ? last : u.hostname), url, epg: '', epgMode: 'auto' }; playlists.push(p); await savePlaylists(); }
  return openPlaylist(p.id);
}

async function openPlaylist(id, force = false) {
  const p = playlists.find(x => x.id === id); if (!p) return;
  curPl = p; await store.set('lastPlaylist', id); renderPlaylistSel();
  $('#listInfo').textContent = 'Cargando lista…';
  try {
    const text = p.text ?? await fetchText(p.url);
    const res = isW3U(text) ? await parseW3U(text, p.url) : parseM3U(text);
    if (res.skipped) toast(`${res.skipped} entradas web/embebidas de la lista W3U se omitieron (no son streams directos)`, 4500);
    channels = res.channels;
    p.autoEpgList = res.epgUrl;
    groupFilter = ''; testFilter = ''; stopTest();
    testRes = new Map((await store.get('test_' + p.id, [])).map(x => [x[0], { ok: x[1], ms: x[2], why: x[3], kind: x[4] }]));
    updateTestUi(); renderGroups(); applyFilter();
    $('#listInfo').textContent = `${channels.length} canales`;
    document.body.classList.remove('no-side'); S.sidebar = true;
    loadEpg(p, force);
  } catch (e) {
    $('#listInfo').textContent = 'No se pudo cargar la lista: ' + e.message;
  }
}

function renderGroups() {
  const s = $('#groupSel'); s.innerHTML = '';
  const groups = [...new Set(channels.map(c => c.group).filter(Boolean))];
  s.append(new Option(`Todos los grupos (${groups.length})`, ''));
  for (const g of groups) s.append(new Option(g, g));
  s.value = groupFilter;
}
function baseList() {
  const q = norm(searchQ);
  return channels.filter(c => (!groupFilter || c.group === groupFilter) && (!favOnly || favs.has(c.url)) && (!q || norm(c.name).includes(q) || String(c.chno || c.num) === searchQ.trim()));
}
function applyFilter() {
  view = baseList();
  if (testFilter) view = view.filter(c => { const r = testRes.get(c.url); return r && (testFilter === 'ok' ? r.ok : !r.ok); });
  $('#chanSpacer').style.height = (view.length * 56) + 'px';
  $('#listInfo').textContent = `${view.length} de ${channels.length} canales` + (Object.keys(epgByUrl).length ? ` · EPG: ${Object.keys(epgByUrl).length} canales` : '');
  renderList();
}

const ROW = 56;
const hueOf = (s = '') => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; };
const badLogos = new Set();
function renderList() {
  const box = $('#chanList'), rows = $('#chanRows');
  const from = Math.max(0, Math.floor(box.scrollTop / ROW) - 5);
  const to = Math.min(view.length, Math.ceil((box.scrollTop + box.clientHeight) / ROW) + 5);
  rows.innerHTML = '';
  const now = Date.now(), curUrl = T()?.item?.url;
  for (let i = from; i < to; i++) {
    const c = view[i];
    const r = el('div', 'ch' + (c.url === curUrl ? ' active' : '')); r.style.top = (i * ROW) + 'px';
    r.style.setProperty('--h', hueOf(c.group || c.name));
    r.append(el('div', 'num', c.chno || c.num));
    if (c.logo && !badLogos.has(c.logo)) { const im = el('img'); im.loading = 'lazy'; im.src = c.logo; im.onerror = () => { badLogos.add(c.logo); im.replaceWith(el('div', 'ph', c.name.slice(0, 2).toUpperCase())); }; r.append(im); }
    else r.append(el('div', 'ph', c.name.slice(0, 2).toUpperCase()));
    const info = el('div', 'info'); info.append(el('div', 'n', c.name));
    const pr = progNow(c, now);
    if (pr) {
      info.append(el('div', 'p', `${hhmm(pr.s)} ${pr.t}`));
      const b = el('div', 'bar'), f = el('i'); f.style.width = Math.min(100, (now - pr.s) / (pr.e - pr.s) * 100) + '%'; b.append(f); info.append(b);
    } else if (c.group) info.append(el('div', 'p grp', c.group));
    const tr = testRes.get(c.url);
    if (tr && !tr.ok && testFilter === 'fail') { info.querySelectorAll('.p, .bar').forEach(x => x.remove()); info.append(el('div', 'p why', tr.why)); }
    r.append(info);
    if (tr) { const d = el('span', 'tdot ' + (tr.ok ? 'ok' : 'fail'), tr.ok ? (tr.ms < 1000 ? tr.ms + ' ms' : (tr.ms / 1000).toFixed(1) + ' s') : ''); d.title = tr.ok ? `Responde (${tr.ms} ms · ${tr.kind})` : 'No responde: ' + tr.why; r.append(d); }
    if (favs.has(c.url)) r.append(el('span', 'star', '★'));
    r.onclick = () => playChannel(c);
    r.title = c.name + (c.group ? ' — ' + c.group : '');
    rows.append(r);
  }
}

// ───────────────────────── EPG (XMLTV) ─────────────────────────
// Servidores EPG online (epgshare01.online, se actualizan a diario)
const EPG_BASE = 'https://epgshare01.online/epgshare01/epg_ripper_';
const EPG_CATALOG = [
  ['AR1', 'Argentina', 'Latinoamérica'], ['UY1', 'Uruguay', 'Latinoamérica'], ['CL1', 'Chile', 'Latinoamérica'], ['CO1', 'Colombia', 'Latinoamérica'],
  ['PE1', 'Perú', 'Latinoamérica'], ['EC1', 'Ecuador', 'Latinoamérica'], ['MX1', 'México', 'Latinoamérica'], ['BR1', 'Brasil 1', 'Latinoamérica'],
  ['BR2', 'Brasil 2', 'Latinoamérica'], ['CR1', 'Costa Rica', 'Latinoamérica'], ['PA1', 'Panamá', 'Latinoamérica'], ['DO1', 'Rep. Dominicana', 'Latinoamérica'],
  ['SV1', 'El Salvador', 'Latinoamérica'], ['JM1', 'Jamaica', 'Latinoamérica'],
  ['ES1', 'España', 'Europa'], ['PT1', 'Portugal', 'Europa'], ['IT1', 'Italia', 'Europa'], ['FR1', 'Francia', 'Europa'], ['DE1', 'Alemania', 'Europa'],
  ['UK1', 'Reino Unido', 'Europa'], ['NL1', 'Países Bajos', 'Europa'], ['BE2', 'Bélgica', 'Europa'], ['CH1', 'Suiza', 'Europa'], ['AT1', 'Austria', 'Europa'],
  ['PL1', 'Polonia', 'Europa'], ['RO1', 'Rumania', 'Europa'], ['GR1', 'Grecia', 'Europa'], ['TR1', 'Turquía', 'Europa'],
  ['US2', 'Estados Unidos', 'Norteamérica'], ['US_LOCALS1', 'EE.UU. locales (pesado)', 'Norteamérica'], ['CA2', 'Canadá', 'Norteamérica'],
  ['DIRECTVSPORTS1', 'DirecTV Sports', 'Deportes'], ['US_SPORTS1', 'Deportes EE.UU.', 'Deportes'], ['BEIN1', 'beIN Sports', 'Deportes'],
  ['SSPORTPLUS1', 'S Sport Plus', 'Deportes'], ['SPORTKLUB1', 'Sport Klub', 'Deportes'], ['RALLY_TV1', 'Rally TV', 'Deportes'],
  ['PLEX1', 'Plex', 'Plataformas'], ['RAKUTEN1', 'Rakuten TV', 'Plataformas'], ['DISTROTV1', 'DistroTV', 'Plataformas'], ['AMCCHANNELS1', 'AMC', 'Plataformas'],
  ['ALJAZEERA1', 'Al Jazeera', 'Plataformas'], ['VOA1', 'VOA', 'Plataformas'], ['ALL_SOURCES1', 'TODAS las fuentes (muy pesado)', 'Plataformas'],
];
const EPG_LABEL = Object.fromEntries(EPG_CATALOG.map(x => [x[0], x[1]]));
const epgUrlOf = (code) => /^https?:/.test(code) ? code : EPG_BASE + code + '.xml.gz';
// país del canal → servidor EPG
const SUFFIX_EPG = { ar: 'AR1', uy: 'UY1', cl: 'CL1', co: 'CO1', pe: 'PE1', ec: 'EC1', mx: 'MX1', br: 'BR1', cr: 'CR1', pa: 'PA1', do: 'DO1', sv: 'SV1', es: 'ES1', pt: 'PT1', it: 'IT1', fr: 'FR1', de: 'DE1', uk: 'UK1', gb: 'UK1', nl: 'NL1', us: 'US2', ca: 'CA2', tr: 'TR1', pl: 'PL1', ro: 'RO1', gr: 'GR1' };
const GROUP_EPG = [[/argentin/, 'AR1'], [/urugua/, 'UY1'], [/chile/, 'CL1'], [/colombi/, 'CO1'], [/peru/, 'PE1'], [/ecuador/, 'EC1'], [/mexic/, 'MX1'],
  [/brasil|brazil/, 'BR1'], [/costa ?rica/, 'CR1'], [/panama/, 'PA1'], [/dominican/, 'DO1'], [/salvador/, 'SV1'], [/espana|spain|dazn|movistar|laliga/, 'ES1'],
  [/portugal/, 'PT1'], [/itali/, 'IT1'], [/franc/, 'FR1'], [/aleman|german/, 'DE1'], [/reino unido|\buk\b|england/, 'UK1'], [/usa|estados unidos|\bus\b|united states/, 'US2'],
  [/canada/, 'CA2'], [/directv|dsports/, 'DIRECTVSPORTS1'], [/bein/, 'BEIN1'], [/pluto|plex/, 'PLEX1']];
function countryOf(c) {
  if (c._cc !== undefined) return c._cc;
  const suf = (c.tvgId.match(/\.([a-z]{2})$/i) || [])[1]?.toLowerCase();
  let cc = SUFFIX_EPG[suf] || null;
  if (!cc) { const g = (c.group || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); cc = (GROUP_EPG.find(([re]) => re.test(g)) || [])[1] || null; }
  return (c._cc = cc);
}
function autoEpgCodes(list) {
  const n = {}; for (const c of list) { const cc = countryOf(c); if (cc) n[cc] = (n[cc] || 0) + 1; }
  const codes = Object.entries(n).filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1]).slice(0, 14).map(x => x[0]);
  return [...new Set(['AR1', ...codes])]; // Argentina siempre incluida
}
// fuentes de una lista: modo auto = x-tvg-url de la lista + países detectados; modo manual = lo elegido
function epgSourcesOf(p) {
  const manual = (p.epg || '').split(/[\s,]+/).filter(u => /^https?:/.test(u));
  let list;
  if (p.epgMode === 'off') list = [];
  else if (p.epgMode === 'custom') list = [...(p.epgCodes || []), ...manual];
  else list = [...manual, ...(p.autoEpgList || []), ...autoEpgCodes(channels)];
  return [...new Set(list)].slice(0, 16);
}

let epg = new Map();       // clave → [{s,e,t,d}]
let epgByUrl = {};         // url canal → clave
let epgStats = [];         // [{src, ok, matched, err}]
function epgKey(c) { return epgByUrl[c.url] || null; }
function progsOf(c) { const k = epgKey(c); return k ? epg.get(k) || [] : []; }
function progNow(c, now = Date.now()) { return progsOf(c).find(p => p.s <= now && p.e > now); }

function parseTime(s) {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/); if (!m) return 0;
  let t = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) { const sg = m[7][0] === '-' ? -1 : 1; t -= sg * (+m[7].slice(1, 3) * 60 + +m[7].slice(3)) * 60000; }
  return t + (S.epgShift || 0) * 3600000;
}
const loose = (n) => n.replace(/^(canal|tv)(?=.{3})/, '').replace(/(?<=.{3})(tv|canal|channel|television|network)$/, '');
function nameKeys(c) {
  const out = new Set();
  for (const raw of [c.tvgName, c.name]) { if (!raw) continue; const n = norm(raw); if (n) { out.add('n:' + n); out.add('l:' + loose(n)); } }
  return [...out];
}
function matchIn(names, c) {
  if (c.tvgId && names['id:' + c.tvgId.toLowerCase()]) return names['id:' + c.tvgId.toLowerCase()];
  for (const k of nameKeys(c)) if (names[k]) return names[k];
  return null;
}

async function loadEpg(p, force) {
  const sources = epgSourcesOf(p);
  const sig = sources.join('|') + '#' + channels.length + '#' + (S.epgShift || 0);
  if (!sources.length) { epg = new Map(); epgByUrl = {}; epgStats = []; applyFilter(); renderEpgPanel(); return; }
  const cacheKey = 'epg_' + p.id;
  const cache = await store.get(cacheKey);
  if (!force && cache && cache.sig === sig && Date.now() - cache.time < 6 * 3600000) { useEpg(cache); return; }
  const info = $('#listInfo'); const base = info.textContent;
  info.textContent = base + ` · cargando EPG (${sources.length} fuente${sources.length > 1 ? 's' : ''})…`;
  const parsed = []; let done = 0;
  await Promise.all(sources.map(async (src) => {
    try {
      const xml = await fetchText(epgUrlOf(src));
      parsed.push({ src, ...parseXmltv(xml) });
    } catch (e) { parsed.push({ src, err: e.message, names: {}, p: {} }); }
    info.textContent = base + ` · EPG ${++done}/${sources.length}`;
  }));
  parsed.sort((a, b) => sources.indexOf(a.src) - sources.indexOf(b.src));
  // cada canal busca primero en el servidor de su país, después en el resto
  const out = { p: {}, byUrl: {}, stats: [], sig, time: Date.now() };
  const matched = Object.fromEntries(parsed.map(x => [x.src, 0]));
  for (const c of channels) {
    const cc = countryOf(c);
    const order = cc ? [...parsed.filter(x => x.src === cc), ...parsed.filter(x => x.src !== cc)] : parsed;
    for (const src of order) {
      const id = matchIn(src.names, c);
      if (id && src.p[id]?.length) { const key = src.src + '|' + id; out.byUrl[c.url] = key; out.p[key] ||= src.p[id]; matched[src.src]++; break; }
    }
  }
  out.stats = parsed.map(x => ({ src: x.src, err: x.err || '', matched: matched[x.src], total: Object.keys(x.p).length }));
  try { await store.set(cacheKey, out); } catch { }
  useEpg(out);
  const n = Object.keys(out.byUrl).length;
  toast(`EPG: ${n} de ${channels.length} canales con programación (${sources.length} fuente${sources.length > 1 ? 's' : ''})`, 4500);
}
function parseXmltv(xml) {
  const names = {};
  const chRe = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/g; let m;
  const add = (k, id) => { if (k.length > 2 && !names[k]) names[k] = id; };
  while ((m = chRe.exec(xml))) {
    const id = decodeEnt(m[1]); names['id:' + id.toLowerCase()] = id;
    const dn = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g; let d;
    while ((d = dn.exec(m[2]))) { const n = norm(decodeEnt(d[1])); if (n) { add('n:' + n, id); add('l:' + loose(n), id); } }
    const nid = norm(id.replace(/\.[a-z]{2,3}$/i, '')); if (nid) { add('n:' + nid, id); add('l:' + loose(nid), id); }
  }
  const wanted = new Set();
  for (const c of channels) { const k = matchIn(names, c); if (k) wanted.add(k); }
  const lo = Date.now() - 12 * 3600000, hi = Date.now() + 4 * 86400000;
  const p = {};
  if (wanted.size) {
    const prRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    while ((m = prRe.exec(xml))) {
      const a = m[1];
      const ch = decodeEnt((a.match(/channel="([^"]*)"/) || [])[1] || ''); if (!wanted.has(ch)) continue;
      const st = parseTime((a.match(/start="([^"]*)"/) || [])[1] || ''), e = parseTime((a.match(/stop="([^"]*)"/) || [])[1] || '');
      if (!st || e < lo || st > hi) continue;
      const t = decodeEnt((m[2].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '');
      const d = decodeEnt((m[2].match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1] || '').slice(0, 300);
      (p[ch] ||= []).push([st, e || st + 1800000, t, d]);
    }
    for (const k in p) p[k].sort((x, y) => x[0] - y[0]);
  }
  const keep = {}; for (const k in names) if (p[names[k]]) keep[k] = names[k];
  return { names: keep, p };
}
function useEpg(data) {
  epg = new Map(Object.entries(data.p || {}).map(([k, v]) => [k, v.map(x => ({ s: x[0], e: x[1], t: x[2], d: x[3] }))]));
  epgByUrl = data.byUrl || {}; epgStats = data.stats || [];
  applyFilter(); renderEpgPanel(); updateBar();
}

// ── diálogo "Fuentes EPG"
function buildEpgChecklist(box, selected) {
  box.innerHTML = '';
  const groups = [...new Set(EPG_CATALOG.map(x => x[2]))];
  for (const g of groups) {
    box.append(el('div', 'epg-g', g));
    const wrap = el('div', 'epg-grid');
    for (const [code, label] of EPG_CATALOG.filter(x => x[2] === g)) {
      const l = el('label', 'epg-opt'); const cb = el('input'); cb.type = 'checkbox'; cb.value = code; cb.checked = selected.includes(code);
      l.append(cb, el('span', '', label)); wrap.append(l);
    }
    box.append(wrap);
  }
}
function openEpgDialog() {
  if (!curPl) return toast('Primero cargá una lista IPTV');
  const p = curPl, mode = p.epgMode || 'auto';
  $('#eMode').value = mode;
  const autoCodes = autoEpgCodes(channels);
  buildEpgChecklist($('#eList'), mode === 'custom' ? (p.epgCodes || []) : autoCodes);
  $('#eManual').value = (p.epg || '');
  $('#eAuto').textContent = 'Detectado en la lista: ' + autoCodes.map(c => EPG_LABEL[c] || c).join(', ') + (p.autoEpgList?.length ? ' + EPG propia de la lista' : '');
  const st = $('#eStats'); st.innerHTML = '';
  for (const x of epgStats) {
    const r = el('div', 'epg-st ' + (x.err ? 'bad' : x.matched ? 'ok' : 'none'));
    r.append(el('b', '', EPG_LABEL[x.src] || x.src.replace(/^https?:\/\//, '').slice(0, 48)), el('span', '', x.err ? 'Error: ' + x.err : `${x.matched} canales vinculados`));
    st.append(r);
  }
  syncEpgMode(); $('#dlgEpg').showModal();
}
function syncEpgMode() { $('#eList').classList.toggle('disabled', $('#eMode').value !== 'custom'); }
$('#eMode').onchange = () => {
  if ($('#eMode').value === 'custom' && !$$('#eList input:checked').length) buildEpgChecklist($('#eList'), autoEpgCodes(channels));
  syncEpgMode();
};
$('#eSave').onclick = async () => {
  const p = curPl; if (!p) return;
  p.epgMode = $('#eMode').value;
  p.epgCodes = $$('#eList input:checked').map(x => x.value);
  p.epg = $('#eManual').value.trim();
  await savePlaylists(); loadEpg(p, true);
};
function renderEpgPanel() {
  const box = $('#epgList'); if (!box) return;
  const it = T()?.item; $('#epgChan').textContent = it?.name ? '— ' + it.name : '';
  const ch = it && channels.find(c => c.url === it.url);
  const list = ch ? progsOf(ch) : [];
  box.innerHTML = '';
  if (!list.length) { box.textContent = ch ? 'Sin datos de EPG para este canal.' : 'Cargá una lista con EPG para ver la programación.'; return; }
  const now = Date.now(); let start = list.findIndex(p => p.e > now); if (start < 0) start = list.length - 1;
  let liveEl;
  for (const p of list.slice(Math.max(0, start - 1), start + 14)) {
    const live = p.s <= now && p.e > now;
    const c = el('div', 'prg' + (live ? ' live' : ''));
    c.append(el('div', 'h', `${new Date(p.s).toLocaleDateString('es-AR', { weekday: 'short' })} ${hhmm(p.s)} – ${hhmm(p.e)}${live ? ' · AHORA' : ''}`), el('div', 't', p.t), el('div', 'd', p.d));
    c.title = p.t + '\n\n' + p.d;
    box.append(c); if (live) liveEl = c;
  }
  liveEl?.scrollIntoView({ inline: 'start', block: 'nearest' });
}

// ───────────────────────── reproducción ─────────────────────────
async function playChannel(c, tileIdx = active) {
  const t = tiles[tileIdx];
  await t.load({ url: c.url, name: c.name, logo: c.logo, headers: c.headers, drm: c.drm });
  store.set('lastChannel', { playlist: curPl?.id, url: c.url });
  history.replaceState(null, '', '#');
  updateBar(); renderEpgPanel(); renderList();
}
async function playUrl(url) {
  const raw = url.trim(); if (!raw) return;
  let { url: u, headers } = splitPipe(raw);
  if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u;
  pushHistory(raw);
  const ch = channels.find(c => c.url === u);
  if (ch && !Object.keys(headers).length) return playChannel(ch);
  await T().load({ url: u, name: u, headers });
  if (T().engine) history.replaceState(null, '', '#' + raw);
  updateBar(); renderEpgPanel();
}
async function pushHistory(url) {
  const h = (await store.get('history', [])).filter(x => x !== url); h.unshift(url); h.length = Math.min(h.length, 30); store.set('history', h);
}
function step(dir) {
  const list = view.length ? view : channels; if (!list.length) return;
  const i = list.findIndex(c => c.url === T()?.item?.url);
  const n = list[(i + dir + list.length) % list.length]; playChannel(n);
  const box = $('#chanList'); const idx = view.indexOf(n);
  if (idx >= 0) { const y = idx * ROW; if (y < box.scrollTop || y > box.scrollTop + box.clientHeight - ROW) box.scrollTop = y - box.clientHeight / 2; }
}

function updateBar() {
  const t = T(); const it = t?.item;
  $('#nowTitle').textContent = it ? (it.name || it.url) : 'Sin reproducción';
  const logo = $('#nowLogo'); if (it?.logo && !badLogos.has(it.logo)) logo.src = it.logo; else logo.removeAttribute('src');
  const ch = it && channels.find(c => c.url === it.url);
  const p = ch && progNow(ch);
  if (p) {
    const nx = progsOf(ch).find(x => x.s >= p.e);
    $('#nowProg').textContent = `${hhmm(p.s)}–${hhmm(p.e)}  ${p.t}` + (nx ? `   ·   Luego: ${hhmm(nx.s)} ${nx.t}` : '');
    $('#nowProgBar').style.width = Math.min(100, (Date.now() - p.s) / (p.e - p.s) * 100) + '%';
  } else { $('#nowProg').textContent = it && t.engine ? `Motor: ${t.engine.toUpperCase()}` : ''; $('#nowProgBar').style.width = '0'; }
  if (t) {
    const q = t.qualities(); const cur = q.list.find(x => x.i === q.cur);
    $('#tQuality').textContent = q.cur < 0 ? 'Auto' : (cur ? cur.label.split(' ')[0] : 'HD');
    $('#tFav').classList.toggle('fav', !!(it && favs.has(it.url)));
    const live = t.engine && t.video.readyState > 0 && !isFinite(t.video.duration);
    $('#liveBadge').classList.toggle('hidden', !live);
    $('#tSpeed').textContent = t.video.playbackRate + '×';
  }
}

// ───────────────────────── menús de herramientas ─────────────────────────
function showMenu(anchor, title, items, cur, onPick, withAuto) {
  const m = $('#menu'); m.innerHTML = ''; m.append(el('h5', '', title));
  if (withAuto) items = [{ i: -1, label: withAuto }, ...items];
  if (!items.length) m.append(el('div', 'it muted', 'No disponible'));
  for (const it of items) { const d = el('div', 'it' + (it.i === cur ? ' sel' : ''), it.label); d.onclick = () => { onPick(it.i); hideMenu(); setTimeout(updateBar, 300); }; m.append(d); }
  m.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = (r.top - m.offsetHeight - 8) + 'px';
}
const hideMenu = () => $('#menu').classList.add('hidden');
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu') && !e.target.closest('.tools')) hideMenu(); });

$('#tQuality').onclick = (e) => { const q = T().qualities(); showMenu(e.currentTarget, 'Calidad', q.list.slice().reverse(), q.cur, i => T().setQuality(i), 'Automática'); };
$('#tAudio').onclick = (e) => { const a = T().audios(); showMenu(e.currentTarget, 'Audio', a.list, a.cur, i => T().setAudio(i)); };
$('#tSubs').onclick = (e) => { const s = T().subs(); showMenu(e.currentTarget, 'Subtítulos', s.list, s.cur, i => T().setSub(i), 'Desactivados'); };
$('#tSpeed').onclick = (e) => { const v = T().video; showMenu(e.currentTarget, 'Velocidad', [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(x => ({ i: x, label: x + '×' })), v.playbackRate, x => v.playbackRate = x); };
$('#tPrev').onclick = () => step(-1);
$('#tNext').onclick = () => step(1);
$('#tPip').onclick = togglePip;
$('#tFull').onclick = toggleFullscreen;
$('#tShot').onclick = screenshot;
$('#tStats').onclick = toggleStats;
$('#tFav').onclick = toggleFav;

async function togglePip() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await T().video.requestPictureInPicture();
  } catch (e) { toast('Imagen en imagen no disponible: ' + e.message); }
}
function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  (tiles.length > 1 ? $('#stage') : T().root).requestFullscreen().catch(() => { });
}
function screenshot() {
  const v = T().video; if (!v.videoWidth) return toast('No hay imagen para capturar');
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  try {
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `captura-${(T().item?.name || 'video').replace(/[^\w-]+/g, '_')}-${Date.now()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
  } catch { toast('El origen del video no permite capturas'); }
}
let statsTimer;
function toggleStats() {
  const t = T(); t.statsOn = !t.statsOn;
  t.root.querySelector('.stats')?.remove();
  if (t.statsOn) { const s = el('div', 'stats'); t.root.append(s); }
  clearInterval(statsTimer);
  statsTimer = setInterval(() => tiles.forEach(x => { const s = x.root.querySelector('.stats'); if (s) s.textContent = x.statsText(); }), 1000);
}
async function toggleFav() {
  const u = T()?.item?.url; if (!u) return;
  favs.has(u) ? favs.delete(u) : favs.add(u);
  await store.set('favs', [...favs]); updateBar(); applyFilter();
}

// ───────────────────────── test de señales ─────────────────────────
let testRes = new Map();   // url → {ok, ms, why, kind}
let testFilter = '';       // '' | 'ok' | 'fail'
let testRun = null;        // {ctrl, total, done}
const TEST_TIMEOUT = 10000, TEST_CONC = 8;

function nextUri(txt, tag) {
  const L = txt.split('\n'); const i = L.findIndex(l => l.startsWith(tag));
  for (let k = i + 1; i >= 0 && k < L.length; k++) { const l = L[k].trim(); if (l && !l.startsWith('#')) return l; }
  return null;
}
async function firstBytes(r) {
  const rd = r.body.getReader(); const { value } = await rd.read(); rd.cancel().catch(() => { });
  if (!value || !value.length) throw new Error('Sin datos');
  return value;
}
async function probe(c, parent) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(TEST_TIMEOUT)]);
  const t0 = performance.now();
  const get = async (u) => { const r = await fetch(u, { signal, cache: 'no-store', credentials: S.withCredentials ? 'include' : 'omit' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r; };
  try {
    let url = c.url;
    if (S.tsFix && /\/live\/[^/]+\/[^/]+\/\d+\.ts(\?|$)/.test(url)) url = url.replace(/\.ts(\?|$)/, '.m3u8$1');
    let r = await get(url);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const textual = /mpegurl|dash|xml|text|json/.test(ct) || /\.(m3u8?|mpd)(\?|$)/i.test(url);
    if (!textual) { // MP4 / TS continuo / etc.
      const b = await firstBytes(r);
      if (b[0] === 0x3c) throw new Error('Devuelve una página HTML');
      return { ok: true, ms: Math.round(performance.now() - t0), kind: ct.includes('mp2t') || b[0] === 0x47 ? 'TS' : 'Video' };
    }
    let txt = await r.text(), base = r.url || url;
    if (txt.includes('<MPD')) return { ok: true, ms: Math.round(performance.now() - t0), kind: 'DASH' };
    if (!txt.includes('#EXTM3U') && !txt.includes('#EXTINF')) throw new Error('Respuesta no válida');
    if (txt.includes('#EXT-X-STREAM-INF')) {           // lista maestra → primera calidad
      const v = nextUri(txt, '#EXT-X-STREAM-INF'); if (!v) throw new Error('Lista maestra vacía');
      const vu = new URL(v, base).href; r = await get(vu); txt = await r.text(); base = r.url || vu;
    }
    const segs = txt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (!segs.length) throw new Error('Lista sin segmentos');
    await firstBytes(await get(new URL(segs[segs.length - 1], base).href)); // el segmento tiene que bajar
    return { ok: true, ms: Math.round(performance.now() - t0), kind: 'HLS' };
  } catch (e) {
    if (parent.aborted) return null;
    const why = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'Sin respuesta (10 s)' : /Failed to fetch|NetworkError/i.test(e.message) ? 'Servidor caído o inaccesible' : e.message;
    return { ok: false, ms: Math.round(performance.now() - t0), why };
  }
}

async function startTest() {
  if (testRun) return stopTest();
  const list = baseList();
  if (!list.length) return toast('No hay canales para probar');
  const ctrl = new AbortController();
  testRun = { ctrl, total: list.length, done: 0 };
  list.forEach(c => testRes.delete(c.url));
  testFilter = 'ok'; updateTestUi(); applyFilter();
  // se agrupan por cabeceras para aplicarlas una sola vez por grupo
  const byHdr = new Map();
  for (const c of list) { const k = JSON.stringify(c.headers || {}); (byHdr.get(k) || byHdr.set(k, []).get(k)).push(c); }
  let lastPaint = 0;
  const paint = (force) => { const n = Date.now(); if (force || n - lastPaint > 350) { lastPaint = n; updateTestUi(); applyFilter(); } };
  for (const [k, group] of byHdr) {
    if (ctrl.signal.aborted) break;
    await applyHeaders(JSON.parse(k));
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(TEST_CONC, group.length) }, async () => {
      while (i < group.length && !ctrl.signal.aborted) {
        const c = group[i++];
        const res = await probe(c, ctrl.signal);
        if (res) { testRes.set(c.url, res); testRun && testRun.done++; paint(); }
      }
    }));
  }
  const aborted = ctrl.signal.aborted;
  await applyHeaders(T()?.item?.headers);              // vuelve a las cabeceras del canal en pantalla
  if (curPl) store.set('test_' + curPl.id, [...testRes].map(([u, r]) => [u, r.ok, r.ms, r.why || '', r.kind || '']));
  const ok = list.filter(c => testRes.get(c.url)?.ok).length;
  testRun = null; paint(true);
  toast(aborted ? `Test detenido · ${ok} responden` : `Test terminado: ${ok} de ${list.length} señales responden`, 4000);
}
function stopTest() { if (testRun) { testRun.ctrl.abort(); testRun = null; updateTestUi(); } }

function updateTestUi() {
  const base = baseList();
  let ok = 0, fail = 0; for (const c of base) { const r = testRes.get(c.url); if (r) r.ok ? ok++ : fail++; }
  $('#tcOk').textContent = ok; $('#tcFail').textContent = fail;
  const has = ok + fail > 0 || !!testRun;
  $('#testChips').classList.toggle('hidden', !has);
  $('#btnExportOk').classList.toggle('hidden', !ok || !!testRun);
  $$('#testChips .tc').forEach(b => b.classList.toggle('on', b.dataset.tf === testFilter && has));
  const btn = $('#btnTest'); btn.classList.toggle('running', !!testRun);
  btn.querySelector('span').textContent = testRun ? 'Detener' : 'Test';
  const pr = $('#testProg'); pr.classList.toggle('hidden', !testRun);
  if (testRun) {
    pr.querySelector('i').style.width = (testRun.done / testRun.total * 100) + '%';
    pr.querySelector('span').textContent = `Probando ${testRun.done} / ${testRun.total}`;
  }
}

// Arma un M3U con las cabeceras, DRM y EPG de cada canal
function buildM3U(list, epgUrls) {
  const q = (s) => String(s).replace(/"/g, "'");
  let out = '#EXTM3U' + (epgUrls ? ` x-tvg-url="${q(epgUrls)}"` : '') + '\n';
  for (const c of list) {
    const a = [['tvg-id', c.tvgId], ['tvg-name', c.tvgName], ['tvg-logo', c.logo], ['tvg-chno', c.chno], ['group-title', c.group]].filter(x => x[1]).map(([k, v]) => `${k}="${q(v)}"`).join(' ');
    out += `#EXTINF:-1 ${a},${c.name}\n`;
    const h = c.headers || {};
    if (h.Referer) out += `#EXTVLCOPT:http-referrer=${h.Referer}\n`;
    if (h['User-Agent']) out += `#EXTVLCOPT:http-user-agent=${h['User-Agent']}\n`;
    if (h.Origin) out += `#EXTVLCOPT:http-origin=${h.Origin}\n`;
    if (c.drm?.clearkey) out += `#KODIPROP:inputstream.adaptive.license_type=clearkey\n#KODIPROP:inputstream.adaptive.license_key=${c.drm.clearkey}\n`;
    if (c.drm?.widevine) out += `#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n#KODIPROP:inputstream.adaptive.license_key=${c.drm.widevine}\n`;
    out += c.url + '\n';
  }
  return out;
}
function downloadText(text, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'audio/x-mpegurl' }));
  a.download = filename.replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]+/g, '_').trim();
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function exportOk() {
  const list = baseList().filter(c => testRes.get(c.url)?.ok);
  const eu = curPl ? epgSourcesOf(curPl).map(epgUrlOf).join(',') : '';
  downloadText(buildM3U(list, eu), `${curPl?.name || 'lista'}-funcionan.m3u`);
  toast(`Exportadas ${list.length} señales que responden`);
}
// Exporta solo el canal que se está viendo en la pantalla activa
function exportCurrent() {
  const it = T()?.item;
  if (!it) return toast('No hay ningún canal reproduciéndose');
  const ch = channels.find(c => c.url === it.url);
  const c = ch ? { ...ch } : { name: it.name && it.name !== it.url ? it.name : (new URL(it.url).hostname), url: it.url, logo: it.logo || '', group: '', tvgId: '', tvgName: '', chno: '', headers: it.headers || {}, drm: it.drm || {} };
  // si el canal tiene EPG vinculada, se exporta con esa fuente y su id para que funcione en otros reproductores
  let eu = '';
  const key = ch && epgKey(ch);
  if (key) { const i = key.indexOf('|'); eu = epgUrlOf(key.slice(0, i)); if (!c.tvgId) c.tvgId = key.slice(i + 1); }
  downloadText(buildM3U([c], eu), `${c.name}.m3u`);
  toast(`Exportado "${c.name}"` + (eu ? ' con su EPG' : ''));
}

$('#btnTest').onclick = startTest;
$('#btnExportOk').onclick = exportOk;
$('#tExport').onclick = exportCurrent;
$$('#testChips .tc').forEach(b => b.onclick = () => { testFilter = b.dataset.tf; $('#chanList').scrollTop = 0; updateTestUi(); applyFilter(); });

// ───────────────────────── guía ─────────────────────────
const PXMIN = 5; let guideStart = 0;
function openGuide() {
  if (!channels.length) return toast('Primero cargá una lista IPTV');
  const now = Date.now(); guideStart = Math.floor((now - 30 * 60000) / 1800000) * 1800000;
  $('#dlgGuide').showModal(); renderGuide(true);
}
function renderGuide(scrollNow) {
  const span = 12 * 3600000, end = guideStart + span, W = span / 60000 * PXMIN;
  const times = $('#guideTimes'); times.innerHTML = ''; times.style.width = W + 'px';
  for (let t = guideStart; t < end; t += 1800000) { const s = el('span', '', `${hhmm(t)}`); s.style.left = ((t - guideStart) / 60000 * PXMIN) + 'px'; times.append(s); }
  const rows = $('#guideRows'); rows.innerHTML = '';
  const list = (view.length ? view : channels).slice(0, 400);
  const now = Date.now(); let withData = 0;
  for (const c of list) {
    const r = el('div', 'grow-row');
    const h = el('div', 'g-ch'); if (c.logo && !badLogos.has(c.logo)) { const i = el('img'); i.loading = 'lazy'; i.src = c.logo; i.onerror = () => { badLogos.add(c.logo); i.remove(); }; h.append(i); } h.append(el('span', '', c.name)); h.title = c.name;
    h.onclick = () => { $('#dlgGuide').close(); playChannel(c); };
    const line = el('div', 'g-line'); line.style.width = W + 'px';
    const ps = progsOf(c).filter(p => p.e > guideStart && p.s < end); if (ps.length) withData++;
    for (const p of ps) {
      const x = Math.max(0, (p.s - guideStart) / 60000 * PXMIN), x2 = Math.min(W, (p.e - guideStart) / 60000 * PXMIN);
      const b = el('div', 'g-p' + (p.s <= now && p.e > now ? ' live' : '')); b.style.left = x + 'px'; b.style.width = Math.max(4, x2 - x - 2) + 'px';
      b.append(el('b', '', p.t), el('small', '', `${hhmm(p.s)} – ${hhmm(p.e)}`)); b.title = `${p.t}\n${hhmm(p.s)} – ${hhmm(p.e)}\n\n${p.d}`;
      b.onclick = () => { $('#dlgGuide').close(); playChannel(c); };
      line.append(b);
    }
    r.append(h, line); rows.append(r);
  }
  $('#guideInfo').textContent = `${list.length} canales · ${withData} con EPG · ${new Date(guideStart).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  const nl = $('#guideNow'), chw = 200;
  if (now >= guideStart && now < end) { nl.style.display = ''; nl.style.left = (chw + (now - guideStart) / 60000 * PXMIN) + 'px'; nl.style.height = (30 + list.length * 54) + 'px'; }
  else nl.style.display = 'none';
  if (scrollNow) $('#guideBody').scrollLeft = Math.max(0, (now - guideStart) / 60000 * PXMIN - 100);
}
$('#btnGuide').onclick = openGuide;
$('#gClose').onclick = () => $('#dlgGuide').close();
$('#gPrev').onclick = () => { guideStart -= 3 * 3600000; renderGuide(); $('#guideBody').scrollLeft = 0; };
$('#gNext').onclick = () => { guideStart += 3 * 3600000; renderGuide(); $('#guideBody').scrollLeft = 0; };
$('#gNow').onclick = () => { guideStart = Math.floor((Date.now() - 30 * 60000) / 1800000) * 1800000; renderGuide(true); };

// ───────────────────────── diálogos ─────────────────────────
let listTab = 'm3u';
$$('#listTabs button').forEach(b => b.onclick = () => {
  listTab = b.dataset.tab; $$('#listTabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('#dlgList [data-pane]').forEach(p => p.hidden = p.dataset.pane !== listTab);
});
$('#btnAddList').onclick = () => { $('#dlgList form').reset(); $('#dlgList').showModal(); };
$('#lSave').onclick = async (e) => {
  e.preventDefault();
  const name = $('#lName').value.trim(); let epgUrl = $('#lEpg').value.trim();
  const p = { id: uid(), name: name || 'Lista', url: '', epg: epgUrl };
  if (listTab === 'm3u') { p.url = $('#lUrl').value.trim(); if (!p.url) return toast('Ingresá la URL de la lista'); if (!name) p.name = new URL(p.url).hostname; }
  else if (listTab === 'file') { const f = $('#lFile').files[0]; if (!f) return toast('Elegí un archivo'); p.text = await f.text(); p.url = 'file:' + f.name; if (!name) p.name = f.name; }
  else {
    const srv = $('#xServer').value.trim().replace(/\/+$/, ''), u = encodeURIComponent($('#xUser').value.trim()), pw = encodeURIComponent($('#xPass').value);
    if (!srv || !u) return toast('Completá servidor y usuario');
    p.url = `${srv}/get.php?username=${u}&password=${pw}&type=m3u_plus&output=${$('#xOut').value}`;
    p.epg = epgUrl || `${srv}/xmltv.php?username=${u}&password=${pw}`;
    if (!name) p.name = new URL(srv).hostname + ' (' + decodeURIComponent(u) + ')';
  }
  playlists.push(p); await savePlaylists(); $('#dlgList').close(); openPlaylist(p.id);
};
$('#playlistSel').onchange = (e) => openPlaylist(e.target.value);
$('#btnEpgSrc').onclick = openEpgDialog;
$('#btnReload').onclick = () => curPl && openPlaylist(curPl.id, true);
$('#btnDelList').onclick = async () => {
  if (!curPl || !confirm(`¿Quitar la lista "${curPl.name}"?`)) return;
  playlists = playlists.filter(p => p !== curPl); await store.del('epg_' + curPl.id); await savePlaylists();
  curPl = null; channels = []; epg = new Map(); applyFilter(); renderGroups(); renderPlaylistSel();
  if (playlists[0]) openPlaylist(playlists[0].id);
};
$('#groupSel').onchange = (e) => { groupFilter = e.target.value; $('#chanList').scrollTop = 0; updateTestUi(); applyFilter(); };
$('#search').oninput = (e) => { searchQ = e.target.value; $('#chanList').scrollTop = 0; updateTestUi(); applyFilter(); };
$('#btnFavs').onclick = (e) => { favOnly = !favOnly; e.currentTarget.classList.toggle('on', favOnly); applyFilter(); };
$('#chanList').addEventListener('scroll', () => requestAnimationFrame(renderList), { passive: true });
addEventListener('resize', () => renderList());
$('#btnSidebar').onclick = () => { document.body.classList.toggle('no-side'); S.sidebar = !document.body.classList.contains('no-side'); saveSettings(); renderList(); };
$$('#layoutSeg button').forEach(b => b.onclick = () => setLayout(b.dataset.layout));

$('#btnSettings').onclick = () => {
  $('#sReferer').value = S.headers.Referer || ''; $('#sOrigin').value = S.headers.Origin || '';
  $('#sUA').value = S.headers['User-Agent'] || ''; $('#sCookie').value = S.headers.Cookie || '';
  $('#sClearKey').value = S.clearkey || ''; $('#sWidevine').value = S.widevine || '';
  $('#sIntercept').checked = S.intercept; $('#sLowLat').checked = S.lowLatency; $('#sAutoplay').checked = S.autoplay; $('#sTsFix').checked = S.tsFix; $('#sCreds').checked = !!S.withCredentials; $('#sLite').checked = !!S.lite; $('#sBigBuf').checked = !!S.bigBuffer;
  $('#sEpgShift').value = S.epgShift || 0;
  $('#dlgSettings').showModal();
};
$('#sSave').onclick = async () => {
  S.headers = { Referer: $('#sReferer').value.trim(), Origin: $('#sOrigin').value.trim(), 'User-Agent': $('#sUA').value.trim(), Cookie: $('#sCookie').value.trim() };
  S.clearkey = $('#sClearKey').value.trim(); S.widevine = $('#sWidevine').value.trim();
  const shiftChanged = +$('#sEpgShift').value !== (S.epgShift || 0);
  S.intercept = $('#sIntercept').checked; S.lowLatency = $('#sLowLat').checked; S.autoplay = $('#sAutoplay').checked; S.tsFix = $('#sTsFix').checked; S.withCredentials = $('#sCreds').checked; S.lite = $('#sLite').checked; S.bigBuffer = $('#sBigBuf').checked;
  document.body.classList.toggle('lite', S.lite);
  S.epgShift = +$('#sEpgShift').value || 0;
  await saveSettings(); chrome.runtime.sendMessage({ type: 'applyRedirect' }); applyHeaders();
  if (shiftChanged && curPl) loadEpg(curPl, true);
  toast('Ajustes guardados');
};
async function saveSettings() { await store.set('settings', S); }

$('#urlForm').onsubmit = (e) => { e.preventDefault(); playUrl($('#urlInput').value); };
addEventListener('hashchange', () => { const u = hashToUrl(); if (u && splitPipe(u).url !== T()?.item?.url) { $('#urlInput').value = u; playUrl(u); } });

function hashToUrl() { const raw = location.hash.slice(1).replace(/%7C/gi, '|'); return /^[a-z]+%3A/i.test(raw) ? decodeURIComponent(raw) : raw; }

// ───────────────────────── teclado ─────────────────────────
let numBuf = '', numT;
addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || $('dialog[open]')) { if (e.key === 'Escape') e.target.blur?.(); return; }
  const v = T()?.video; const k = e.key;
  if (k === ' ' || k === 'k') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
  else if (k === 'f' || k === 'F') toggleFullscreen();
  else if (k === 'm' || k === 'M') v.muted = !v.muted;
  else if (k === 'p' || k === 'P') togglePip();
  else if (k === 's' || k === 'S') screenshot();
  else if (k === 'i' || k === 'I') toggleStats();
  else if (k === 'g' || k === 'G') openGuide();
  else if (k === 't' || k === 'T') startTest();
  else if (k === 'x' || k === 'X') exportCurrent();
  else if (k === 'c' || k === 'C') $('#btnSidebar').click();
  else if (k === 'e' || k === 'E') document.body.classList.toggle('no-epg');
  else if (k === 'F2') toggleFav();
  else if (k === '/') { e.preventDefault(); $('#search').focus(); }
  else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); step(-1); }
  else if (k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); step(1); }
  else if (k === 'ArrowLeft') v.currentTime -= 10;
  else if (k === 'ArrowRight') v.currentTime += 10;
  else if (k === '+') v.volume = Math.min(1, v.volume + .1);
  else if (k === '-') v.volume = Math.max(0, v.volume - .1);
  else if (/^\d$/.test(k)) {
    numBuf += k; toast('Canal ' + numBuf, 1300); clearTimeout(numT);
    numT = setTimeout(() => { const c = channels.find(x => String(x.chno || x.num) === numBuf); numBuf = ''; if (c) playChannel(c); else toast('Canal no encontrado'); }, 1200);
  }
});

// refresco del "ahora" de la EPG
setInterval(() => { renderList(); updateBar(); }, 30000);

// ───────────────────────── inicio ─────────────────────────
(async function init() {
  S = { ...DEFAULTS, ...(await store.get('settings', {})) };
  favs = new Set(await store.get('favs', []));
  playlists = await store.get('playlists', []);
  if (!S.sidebar) document.body.classList.add('no-side');
  document.body.classList.toggle('lite', !!S.lite);
  setLayout(S.layout || 1);
  renderPlaylistSel();

  const hashUrl = hashToUrl();
  const lastPl = await store.get('lastPlaylist');
  if (lastPl && playlists.some(p => p.id === lastPl)) await openPlaylist(lastPl);
  else if (playlists[0]) await openPlaylist(playlists[0].id);
  else document.body.classList.add('no-side');

  if (hashUrl) { $('#urlInput').value = hashUrl; playUrl(hashUrl); }
  else if (S.autoplay) {
    const last = await store.get('lastChannel');
    const c = last && channels.find(x => x.url === last.url);
    if (c) playChannel(c);
  }
  if (!hashUrl && !channels.length) tiles[0].setMsg('info', 'Pegá un enlace arriba o agregá una lista IPTV con "＋ Lista"');
})();
