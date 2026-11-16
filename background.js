// Cellcom Player – service worker
const PLAYER = chrome.runtime.getURL('player.html');
const REDIRECT_RULE_ID = 1;
const HEADER_RULE_BASE = 100;
const STREAM_RE = /\.(m3u8|mpd)(\?|#|$)/i;

const openPlayer = (url) =>
  chrome.tabs.create({ url: PLAYER + (url ? '#' + url : '') });

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return Object.assign({ intercept: true }, settings || {});
}

// Redirige la navegación directa a .m3u8/.mpd hacia el reproductor
async function applyRedirect() {
  const { intercept } = await getSettings();
  const mk = (id, regexFilter) => ({
    id, priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: PLAYER + '#\\0' } },
    condition: { regexFilter, resourceTypes: ['main_frame'] }
  });
  const addRules = intercept ? [
    mk(REDIRECT_RULE_ID, '^https?://[^#]*\\.(m3u8|m3u|w3u|mpd)(\\?[^#]*)?$'),          // .m3u8 / .m3u / .mpd
    mk(REDIRECT_RULE_ID + 1, '^https?://[^#]*/get\\.php\\?[^#]*type=m3u[^#]*$')     // listas Xtream get.php
  ] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [REDIRECT_RULE_ID, REDIRECT_RULE_ID + 1], addRules });
}

// Cabeceras personalizadas (Referer, Origin, User-Agent…) solo para pedidos del reproductor
// Una regla por pestaña del reproductor (condición tabIds: fiable en Chrome y Brave)
async function setHeaders(headers = {}, tabId) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) if (k && v) h[k.toLowerCase()] = String(v);
  // Si hay Referer y no Origin, el Origin sale del Referer; si no hay ninguno, se quita el
  // Origin chrome-extension:// que muchos CDN rechazan con 403.
  if (h.referer && !h.origin) { try { h.origin = new URL(h.referer).origin; } catch { } }
  const requestHeaders = Object.entries(h).map(([header, value]) => ({ header, operation: 'set', value }));
  if (!h.origin) requestHeaders.push({ header: 'origin', operation: 'remove' });
  const id = HEADER_RULE_BASE + (tabId ?? 0);
  const condition = { resourceTypes: ['xmlhttprequest', 'media', 'other', 'image'] };
  if (tabId != null) condition.tabIds = [tabId]; else condition.initiatorDomains = [chrome.runtime.id];
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{ id, priority: 2, action: { type: 'modifyHeaders', requestHeaders }, condition }]
  });
}

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'play-link', title: 'Reproducir con Cellcom Player', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'play-media', title: 'Reproducir con Cellcom Player', contexts: ['video', 'audio'] });
    chrome.contextMenus.create({ id: 'play-selection', title: 'Reproducir "%s" con Cellcom Player', contexts: ['selection'] });
  });
}

chrome.runtime.onInstalled.addListener(() => { applyRedirect(); setupMenus(); });
chrome.runtime.onStartup.addListener(() => { applyRedirect(); });

chrome.contextMenus.onClicked.addListener((info) => {
  const url = info.linkUrl || info.srcUrl || (info.selectionText || '').trim();
  if (url) openPlayer(url);
});

chrome.commands.onCommand.addListener((cmd) => { if (cmd === 'open-player') openPlayer(); });

// Detector de streams en las pestañas (para el popup)
chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (d.tabId < 0 || !STREAM_RE.test(d.url) || d.initiator?.startsWith('chrome-extension://')) return;
  const key = 'tab_' + d.tabId;
  chrome.storage.session.get(key).then((o) => {
    const list = o[key] || [];
    if (list.some(x => x.url === d.url)) return;
    list.unshift({ url: d.url, type: /\.mpd/i.test(d.url) ? 'DASH' : 'HLS', time: Date.now(), referer: d.initiator ? d.initiator + '/' : '' });
    list.length = Math.min(list.length, 40);
    chrome.storage.session.set({ [key]: list });
    chrome.action.setBadgeBackgroundColor({ color: '#00b4e6', tabId: d.tabId });
    chrome.action.setBadgeText({ text: String(list.length), tabId: d.tabId });
  });
}, { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other', 'main_frame', 'sub_frame'] });

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('tab_' + tabId);
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [HEADER_RULE_BASE + tabId] }).catch(() => { });
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {   // sin permiso "tabs" no se lee la URL: se limpia en cada carga
    chrome.storage.session.remove('tab_' + tabId);
    chrome.action.setBadgeText({ text: '', tabId });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'setHeaders') await setHeaders(msg.headers, sender.tab?.id);
    else if (msg.type === 'applyRedirect') await applyRedirect();
    else if (msg.type === 'open') await openPlayer(msg.url);
    else if (msg.type === 'openHere' && sender.tab) await chrome.tabs.update(sender.tab.id, { url: PLAYER + '#' + msg.url });
    reply({ ok: true });
  })().catch(e => reply({ ok: false, error: String(e) }));
  return true;
});
