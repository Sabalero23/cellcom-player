// Si la pestaña muestra una lista M3U, un manifiesto HLS o una lista W3U (JSON de Wiseplay) como texto
// (ej. raw de GitHub, pastebin, gist), la abre en Cellcom Player.
(() => {
  const ct = (document.contentType || '').toLowerCase();
  if (!/text\/plain|mpegurl|octet-stream|json/.test(ct) || !document.body) return;
  const head = (document.body.innerText || '').slice(0, 4096).replace(/^﻿/, '').trimStart();
  const m3u = head.startsWith('#EXTM3U') || /^#EXTINF:/m.test(head);
  const w3u = (head[0] === '{' || head[0] === '[') && /"(stations|groups)"\s*:/.test(head);
  if (!m3u && !w3u) return;
  chrome.storage.local.get('settings').then(({ settings }) => {
    if (settings && settings.intercept === false) return;
    chrome.runtime.sendMessage({ type: 'openHere', url: location.href });
  });
})();
