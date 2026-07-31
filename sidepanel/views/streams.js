// chrome-xray streams view: live entry list with filters + full detail pane.

import { el, copyBtn, fmtMs, fmtBytes, fmtTime, fmtDateTime, statusClass, toCurl } from '../../lib/util.js';
import { renderBody } from '../../lib/jsonview.js';

const LIST_MAX = 400;

export function createStreamsView(root, ctx) {
  let entries = [];
  let paused = false;
  let filter = { q: '', method: '', status: '' };
  let detailEntry = null;

  // ---- toolbar ----
  const search = el('input', { type: 'search', placeholder: 'filter url, body, headers…' });
  search.addEventListener('input', () => { filter.q = search.value.toLowerCase(); renderList(); });

  const methodSel = el('select', {},
    el('option', { value: '' }, 'method'),
    ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((m) => el('option', { value: m }, m)));
  methodSel.addEventListener('change', () => { filter.method = methodSel.value; renderList(); });

  const statusSel = el('select', {},
    el('option', { value: '' }, 'status'),
    el('option', { value: '2' }, '2xx'),
    el('option', { value: '3' }, '3xx'),
    el('option', { value: '4' }, '4xx'),
    el('option', { value: '5' }, '5xx'),
    el('option', { value: 'err' }, 'errors'));
  statusSel.addEventListener('change', () => { filter.status = statusSel.value; renderList(); });

  const pauseBtn = el('button', { title: 'Pause live list' }, '⏸');
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶' : '⏸';
    if (!paused) renderList();
  });

  const clearBtn = el('button', { title: 'Clear captured history for this profile', class: 'danger' }, 'Clear');
  clearBtn.addEventListener('click', async () => {
    const p = ctx.currentProfile();
    if (!p) return;
    await ctx.db.clearEntries(p.id);
    entries = [];
    renderList();
    ctx.toast('History cleared');
  });

  const toolbar = el('div', { class: 'stream-toolbar' }, search, methodSel, statusSel, pauseBtn, clearBtn);

  const list = el('div', { class: 'entry-list' });
  const body = el('div', { class: 'streams-body' }, list);
  root.append(toolbar, body);

  // ---- filtering ----
  function matches(e) {
    if (filter.method && e.method !== filter.method) return false;
    if (filter.status) {
      if (filter.status === 'err') { if (!e.error) return false; }
      else if (!e.status || String(e.status)[0] !== filter.status) return false;
    }
    if (filter.q) {
      const hay = [
        e.url, e.reqBody, e.resBody,
        JSON.stringify(e.reqHeaders || {}), JSON.stringify(e.resHeaders || {}),
      ].join(' ').toLowerCase();
      for (const term of filter.q.split(/\s+/).filter(Boolean)) {
        if (!hay.includes(term)) return false;
      }
    }
    return true;
  }

  function entryRow(e) {
    const u = safePath(e.url);
    const row = el('div', { class: 'entry-row', dataset: { id: e.id } },
      el('span', { class: `method ${e.method}` }, e.method),
      e.replayed ? el('span', { class: 'replay-mark', title: 'replayed by x-ray' }, '↻') : null,
      el('span', { class: 'path', title: e.url }, '‎' + u),
      el('span', { class: `status ${statusClass(e)}` }, e.error ? 'ERR' : (e.status ?? '…')),
      el('span', { class: 'dur' }, fmtMs(e.durationMs)),
      el('span', { class: 'when' }, fmtTime(e.ts || e.startedAt)),
    );
    row.addEventListener('click', () => openDetail(e));
    return row;
  }

  function renderList() {
    const shown = entries.filter(matches).slice(0, LIST_MAX);
    list.replaceChildren();
    if (!shown.length) {
      list.append(el('div', { class: 'list-empty' },
        el('div', {}, entries.length ? 'Nothing matches the filter.' : 'No traffic captured yet.'),
        el('div', { class: 'hint' }, entries.length ? '' :
          'Activate x-ray for a site from the toolbar popup, then use the app — fetch/XHR calls land here live.')));
      return;
    }
    for (const e of shown) list.append(entryRow(e));
  }

  function safePath(url) {
    try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
  }

  // ---- detail ----
  function headersSection(title, headers, extraBtns = []) {
    const rows = Object.entries(headers || {});
    const allText = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    const table = el('table', { class: 'headers-table' },
      ...rows.map(([k, v]) => el('tr', {},
        el('td', { class: 'hk' }, k),
        el('td', { class: 'hv' }, v),
        el('td', { class: 'hc' }, copyBtn(`${k}: ${v}`, 'Copy header')))));
    return el('div', { class: 'section' },
      el('h3', {}, title, el('span', { class: 'spacer' }), ...extraBtns,
        rows.length ? copyBtn(allText, 'Copy all headers') : null),
      rows.length ? table : el('div', { class: 'body-empty' }, '∅ none captured'));
  }

  function bodySection(title, text, contentType, truncated, note) {
    const { node, pretty } = renderBody(text, contentType || '');
    const box = el('div', { class: 'body-box' }, node);
    return el('div', { class: 'section' },
      el('h3', {}, title, el('span', { class: 'spacer' }),
        text ? copyBtn(() => pretty, 'Copy body') : null),
      note ? el('div', { class: 'body-empty' }, `[${note}]`) : box,
      truncated ? el('div', { class: 'trunc-note' }, `⚠ truncated at capture cap`) : null);
  }

  function openDetail(e) {
    detailEntry = e;
    closeDetail();
    const reqCT = (e.reqHeaders || {})['content-type'] || '';
    const resCT = (e.resHeaders || {})['content-type'] || '';

    const scroll = el('div', { class: 'detail-scroll' },
      el('dl', { class: 'kv-summary' },
        el('dt', {}, 'URL'), el('dd', {}, e.url, copyBtn(e.url, 'Copy URL')),
        el('dt', {}, 'Status'), el('dd', { class: `status ${statusClass(e)}` },
          e.error ? 'failed' : `${e.status} ${e.statusText || ''}`),
        el('dt', {}, 'Time'), el('dd', {}, `${fmtDateTime(e.ts || e.startedAt)}`),
        el('dt', {}, 'Duration'), el('dd', {}, fmtMs(e.durationMs) || '—'),
        e.resBodySize != null ? el('dt', {}, 'Body size') : null,
        e.resBodySize != null ? el('dd', {}, fmtBytes(e.resBodySize)) : null,
        el('dt', {}, 'Source'), el('dd', {}, `${e.api}${e.replayed ? ' · replayed' : ''}`),
      ),
      e.error ? el('div', { class: 'section' },
        el('h3', {}, 'Error'),
        el('div', { class: 'error-box' }, e.error)) : null,
      headersSection('Request headers', e.reqHeaders),
      bodySection('Request payload', e.reqBody, reqCT, e.reqBodyTruncated, !e.reqBody && e.reqBodyNote),
      headersSection('Response headers', e.resHeaders),
      bodySection('Response body', e.resBody, resCT, e.resBodyTruncated, !e.resBody && e.resBodyNote),
    );

    const back = el('button', { class: 'back' }, '← back');
    back.addEventListener('click', closeDetail);
    const detail = el('div', { class: 'detail' },
      el('div', { class: 'detail-header' },
        back,
        el('span', { class: `method ${e.method}` }, e.method),
        el('span', { class: 'title' }, safePath(e.url)),
        copyBtn(() => toCurl(e), 'Copy as cURL')),
      scroll);
    detail.dataset.detail = '1';
    body.append(detail);
  }

  function closeDetail() {
    for (const d of body.querySelectorAll('[data-detail]')) d.remove();
  }

  // ---- data ----
  async function load() {
    closeDetail();
    const p = ctx.currentProfile();
    entries = p ? await ctx.db.listEntries(p.id, LIST_MAX) : [];
    renderList();
  }

  ctx.onProfileChange(load);

  return {
    onEntry(entry) {
      entries.unshift(entry);
      if (entries.length > LIST_MAX + 100) entries.length = LIST_MAX;
      if (!paused) renderList();
    },
    refresh: load,
  };
}
