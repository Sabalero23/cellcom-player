const $ = (id) => document.getElementById(id);
const open = (url) => { chrome.runtime.sendMessage({ type: 'open', url }); window.close(); };

$('play').onclick = () => { const u = $('url').value.trim(); if (u) open(u); };
$('url').onkeydown = (e) => { if (e.key === 'Enter') $('play').click(); };
$('open').onclick = () => open('');

chrome.storage.local.get('settings').then(({ settings }) => {
  $('intercept').checked = (settings?.intercept ?? true);
});
$('intercept').onchange = async (e) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...(settings || {}), intercept: e.target.checked } });
  chrome.runtime.sendMessage({ type: 'applyRedirect' });
};

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = 'tab_' + tab?.id;
  const list = (await chrome.storage.session.get(key))[key] || [];
  const ul = $('list');
  if (!list.length) { ul.innerHTML = '<div class="empty">Todavía no se detectaron streams. Reproducí el video en la página y volvé a abrir este menú.</div>'; return; }
  for (const s of list) {
    const li = document.createElement('li');
    li.title = s.url;
    li.innerHTML = `<span class="t"></span><span class="u"></span>`;
    li.querySelector('.t').textContent = s.type;
    li.querySelector('.u').textContent = s.url;
    const ref = s.referer || (tab?.url?.startsWith('http') ? tab.url : '');
    li.onclick = () => open(ref ? `${s.url}|Referer=${encodeURIComponent(ref)}` : s.url);
    ul.appendChild(li);
  }
})();
