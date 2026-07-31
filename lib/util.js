// chrome-xray shared helpers: formatting, clipboard, cURL, redaction, DOM.

export const REDACT_HEADERS = [
  'authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token',
  'proxy-authorization', 'x-csrf-token', 'x-xsrf-token',
];

export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function fmtMs(n) {
  if (n == null) return '';
  if (n < 1000) return `${n} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

export function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (x, w = 2) => String(x).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

export function statusClass(entry) {
  if (entry.error) return 'err';
  const s = entry.status;
  if (s >= 500) return 's5';
  if (s >= 400) return 's4';
  if (s >= 300) return 's3';
  if (s >= 200) return 's2';
  return 'err';
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

// el('div', {class: 'row', onclick: fn}, child1, 'text', ...)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const COPY_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M11 5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5.5A1.5 1.5 0 0 0 4 11h1"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8.5 6.5 12 13 4.5"/></svg>';

// Small copy-to-clipboard icon button. getText may be a string or fn.
export function copyBtn(getText, title = 'Copy') {
  const btn = el('button', { class: 'copy-btn', title });
  btn.innerHTML = COPY_SVG;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const text = typeof getText === 'function' ? getText() : getText;
    const ok = await copyText(text);
    btn.innerHTML = ok ? CHECK_SVG : COPY_SVG;
    btn.classList.toggle('copied', ok);
    setTimeout(() => { btn.innerHTML = COPY_SVG; btn.classList.remove('copied'); }, 1200);
  });
  return btn;
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function toCurl(entry) {
  const lines = [
    `curl${entry.method && entry.method !== 'GET' ? ` -X ${entry.method}` : ''} ${shellQuote(entry.url)}`,
  ];
  for (const [k, v] of Object.entries(entry.reqHeaders || {})) {
    lines.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  }
  if (entry.reqBody) lines.push(`--data-raw ${shellQuote(entry.reqBody)}`);
  return lines.join(' \\\n  ');
}

export function redactHeaders(headers) {
  if (!headers) return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT_HEADERS.includes(k.toLowerCase()) ? '••• redacted' : v;
  }
  return out;
}

// Wildcard match: pattern like "https://api.example.com/*" against a URL.
export function matchPattern(pattern, url) {
  const re = new RegExp('^' + pattern.trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*') + '$');
  return re.test(url);
}

export function profileMatches(profile, url) {
  if (!profile.enabled || !Array.isArray(profile.patterns)) return false;
  return profile.patterns.some((p) => p && matchPattern(p, url));
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
