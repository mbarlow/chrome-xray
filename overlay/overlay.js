// chrome-xray on-page overlay: a shadow-DOM live ticker of captured calls.
// Injected on demand (isolated world); toggled via runtime messages.
(() => {
  if (window.__XRAY_OVERLAY__) return;
  window.__XRAY_OVERLAY__ = true;

  const MAX_ROWS = 20;
  let visible = false;
  let expanded = false;
  let count = 0;

  const host = document.createElement('div');
  host.id = 'chrome-xray-overlay';
  host.style.cssText = 'position:fixed;z-index:2147483646;bottom:16px;right:16px;display:none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-monospace, 'JetBrains Mono', monospace; }
    .pill {
      display: flex; align-items: center; gap: 8px;
      background: rgba(24, 24, 37, .92);
      color: #cdd6f4;
      border: 1px solid #45475a;
      border-radius: 10px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
      backdrop-filter: blur(6px);
      box-shadow: 0 4px 16px rgba(0,0,0,.35);
    }
    .zap { color: #cba6f7; }
    .count { color: #a6adc8; font-size: 11px; }
    .last { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
    .panel {
      display: none;
      margin-top: 6px;
      width: 380px; max-width: 90vw;
      max-height: 40vh; overflow-y: auto;
      background: rgba(24, 24, 37, .95);
      border: 1px solid #45475a;
      border-radius: 10px;
      backdrop-filter: blur(6px);
      box-shadow: 0 4px 16px rgba(0,0,0,.35);
    }
    .panel.open { display: block; }
    .row {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 10px; font-size: 11px; color: #cdd6f4;
      border-bottom: 1px solid rgba(69,71,90,.5);
    }
    .m { font-weight: 700; font-size: 10px; }
    .m.GET { color: #89b4fa; } .m.POST { color: #a6e3a1; } .m.PUT { color: #fab387; }
    .m.PATCH { color: #f9e2af; } .m.DELETE { color: #f38ba8; }
    .p { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
    .s2 { color: #a6e3a1; } .s3 { color: #89dceb; } .s4 { color: #fab387; } .s5, .err { color: #f38ba8; }
    .d { color: #6c7086; font-size: 10px; }
    ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #45475a; border-radius: 3px; }
  `;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;';

  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.innerHTML = '<span class="zap">⚡</span><span class="count">0</span><span class="last">x-ray listening…</span>';
  const countEl = pill.querySelector('.count');
  const lastEl = pill.querySelector('.last');

  const panel = document.createElement('div');
  panel.className = 'panel';

  pill.addEventListener('click', () => {
    expanded = !expanded;
    panel.classList.toggle('open', expanded);
  });

  wrap.append(pill, panel);
  shadow.append(style, wrap);
  (document.documentElement || document.body).append(host);

  function statusCls(entry) {
    if (entry.error) return 'err';
    const s = entry.status || 0;
    return 's' + String(s)[0];
  }

  function shortPath(url) {
    try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
  }

  function addRow(entry) {
    count++;
    countEl.textContent = String(count);
    lastEl.textContent = `${entry.method} ${shortPath(entry.url)} → ${entry.error ? 'ERR' : entry.status}`;
    const row = document.createElement('div');
    row.className = 'row';
    const m = document.createElement('span');
    m.className = 'm ' + entry.method;
    m.textContent = entry.method;
    const p = document.createElement('span');
    p.className = 'p';
    p.textContent = '‎' + shortPath(entry.url);
    p.title = entry.url;
    const s = document.createElement('span');
    s.className = statusCls(entry);
    s.textContent = entry.error ? 'ERR' : String(entry.status ?? '…');
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = entry.durationMs != null ? entry.durationMs + 'ms' : '';
    row.append(m, p, s, d);
    panel.prepend(row);
    while (panel.children.length > MAX_ROWS) panel.lastChild.remove();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'xray:overlay-toggle') {
      visible = !visible;
      host.style.display = visible ? '' : 'none';
    } else if (msg.type === 'xray:new-entry' && visible) {
      addRow(msg.entry);
    }
  });

  // first injection = show immediately
  visible = true;
  host.style.display = '';
})();
