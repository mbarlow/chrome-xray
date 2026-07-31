// chrome-xray API view: collated endpoint workbench — browse discovered
// endpoints, inspect schemas, try calls with arbitrary data, replay history.

import { el, copyBtn, fmtMs, fmtDateTime, statusClass } from '../../lib/util.js';
import { renderBody } from '../../lib/jsonview.js';
import { toOpenAPI } from '../../lib/openapi.js';
import { download, redactHeaders } from '../../lib/util.js';

export function createApiView(root, ctx) {
  let endpoints = [];
  let refreshTimer = null;
  let query = '';

  // ---- toolbar ----
  const search = el('input', { type: 'search', placeholder: 'filter endpoints…' });
  search.addEventListener('input', () => { query = search.value.toLowerCase(); renderList(); });

  const exportBtn = el('button', { title: 'Export profile definitions as .xray.json' }, 'Export');
  exportBtn.addEventListener('click', exportXray);
  const openapiBtn = el('button', { title: 'Export as OpenAPI 3.1' }, 'OpenAPI');
  openapiBtn.addEventListener('click', exportOpenAPI);
  const importBtn = el('button', { title: 'Import a .xray.json export' }, 'Import');
  const importInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', importXray);

  const toolbar = el('div', { class: 'api-toolbar' },
    search, el('span', { class: 'spacer' }), importBtn, exportBtn, openapiBtn, importInput);

  const list = el('div', { class: 'endpoint-list' });
  const body = el('div', { class: 'api-body' }, list);
  root.append(toolbar, body);

  // ---- list ----
  function templateNode(tmpl) {
    const span = el('span', { class: 'tmpl' });
    for (const part of tmpl.split(/(\{[^}]+\})/)) {
      if (!part) continue;
      span.append(part.startsWith('{') ? el('span', { class: 'param' }, part) : part);
    }
    return span;
  }

  function renderList() {
    closeDetail();
    list.replaceChildren();
    const shown = endpoints.filter((e) =>
      !query || `${e.method} ${e.host}${e.template}`.toLowerCase().includes(query));
    if (!shown.length) {
      list.append(el('div', { class: 'list-empty' },
        el('div', {}, endpoints.length ? 'Nothing matches.' : 'No endpoints discovered yet.'),
        el('div', { class: 'hint' }, endpoints.length ? '' :
          'As traffic flows, x-ray collates calls into templated endpoints here — your API builds itself.')));
      return;
    }
    const byHost = new Map();
    for (const e of shown) {
      if (!byHost.has(e.host)) byHost.set(e.host, []);
      byHost.get(e.host).push(e);
    }
    for (const [host, eps] of [...byHost.entries()].sort()) {
      eps.sort((a, b) => a.template.localeCompare(b.template) || a.method.localeCompare(b.method));
      const rows = eps.map((ep) => {
        const row = el('div', { class: 'endpoint-row' },
          el('span', { class: `method ${ep.method}` }, ep.method),
          templateNode(ep.template),
          el('span', { class: 'hits' }, `×${ep.count}`));
        row.addEventListener('click', () => openDetail(ep));
        return row;
      });
      const group = el('div', { class: 'host-group' },
        el('div', { class: 'host-head' }, host, el('span', { class: 'count' }, `(${eps.length})`)),
        ...rows);
      group.querySelector('.host-head').addEventListener('click', () => {
        for (const r of group.querySelectorAll('.endpoint-row')) {
          r.style.display = r.style.display === 'none' ? '' : 'none';
        }
      });
      list.append(group);
    }
  }

  // ---- endpoint detail + try form ----
  async function openDetail(ep) {
    closeDetail();
    const p = ctx.currentProfile();
    const examples = (await Promise.all((ep.exampleIds || []).map((id) => ctx.db.getEntry(id))))
      .filter(Boolean);

    const avg = ep.count ? Math.round(ep.totalMs / ep.count) : 0;
    const statusChips = el('div', { class: 'status-chips' },
      ...Object.entries(ep.statuses || {}).map(([s, n]) =>
        el('span', { class: `chip ${s === 'error' ? 'err' : 's' + String(s)[0]}` }, `${s} ×${n}`)));

    // --- try form ---
    const methodSel = el('select', {},
      ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((m) => {
        const o = el('option', { value: m }, m);
        if (m === ep.method) o.selected = true;
        return o;
      }));
    const urlIn = el('input', { type: 'text', value: exampleUrl(ep, examples), spellcheck: 'false' });

    const hdrEditor = el('div', { class: 'hdr-editor' });
    function hdrLine(k = '', v = '') {
      const line = el('div', { class: 'hdr-line' },
        el('input', { class: 'hk-in', placeholder: 'header', value: k, spellcheck: 'false' }),
        el('input', { class: 'hv-in', placeholder: 'value', value: v, spellcheck: 'false' }));
      const rm = el('button', { title: 'Remove header' }, '×');
      rm.addEventListener('click', () => line.remove());
      line.append(rm);
      return line;
    }
    const addHdr = el('button', {}, '+ header');
    addHdr.addEventListener('click', () => hdrEditor.insertBefore(hdrLine(), addHdr));
    hdrEditor.append(addHdr);
    function setHeaders(obj) {
      for (const l of hdrEditor.querySelectorAll('.hdr-line')) l.remove();
      for (const [k, v] of Object.entries(obj || {})) hdrEditor.insertBefore(hdrLine(k, v), addHdr);
    }
    function getHeaders() {
      const out = {};
      for (const l of hdrEditor.querySelectorAll('.hdr-line')) {
        const k = l.querySelector('.hk-in').value.trim();
        const v = l.querySelector('.hv-in').value;
        if (k) out[k] = v;
      }
      return out;
    }

    const bodyIn = el('textarea', { class: 'body-in', placeholder: 'request body (JSON or raw)', spellcheck: 'false' });
    const sendBtn = el('button', { class: 'primary' }, 'Send');
    const sendNote = el('span', { class: 'note', style: 'font-size:10.5px;color:var(--overlay1)' },
      'runs in the active tab’s page context — cookies apply');
    const result = el('div', { class: 'try-result' });

    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = true;
      sendBtn.textContent = '…';
      result.replaceChildren();
      const res = await chrome.runtime.sendMessage({
        type: 'xray:replay',
        request: {
          method: methodSel.value,
          url: urlIn.value,
          headers: getHeaders(),
          body: bodyIn.value || null,
        },
      }).catch((e) => ({ ok: false, error: String(e) }));
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
      renderResult(res);
    });

    function renderResult(res) {
      if (!res) return;
      if (!res.ok && res.error) {
        result.replaceChildren(el('div', { class: 'error-box' }, res.error));
        return;
      }
      const cls = res.status >= 500 ? 's5' : res.status >= 400 ? 's4' : res.status >= 300 ? 's3' : 's2';
      const { node, pretty } = renderBody(res.body, (res.headers || {})['content-type'] || '');
      result.replaceChildren(
        el('div', { class: 'section' },
          el('h3', {}, el('span', { class: `status ${cls}` }, `${res.status} ${res.statusText || ''}`),
            el('span', { class: 'spacer' }),
            res.body ? copyBtn(() => pretty, 'Copy response') : null),
          el('div', { class: 'body-box' }, node),
          res.truncated ? el('div', { class: 'trunc-note' }, '⚠ truncated') : null));
    }

    // --- history / replay ---
    const historyRows = examples.map((ex) => {
      const row = el('div', { class: 'entry-row' },
        el('span', { class: `status ${statusClass(ex)}` }, ex.error ? 'ERR' : ex.status),
        el('span', { class: 'path', title: ex.url }, '‎' + shortUrl(ex.url)),
        el('span', { class: 'dur' }, fmtMs(ex.durationMs)),
        el('span', { class: 'when' }, fmtDateTime(ex.ts)));
      const loadBtn = el('button', { title: 'Load this call into the form' }, '→ form');
      loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        methodSel.value = ex.method;
        urlIn.value = ex.url;
        setHeaders(ex.reqHeaders || {});
        bodyIn.value = ex.reqBody || '';
        ctx.toast('Loaded into form');
      });
      row.append(loadBtn);
      return row;
    });

    const back = el('button', { class: 'back' }, '← back');
    back.addEventListener('click', closeDetail);

    const detail = el('div', { class: 'detail' },
      el('div', { class: 'detail-header' },
        back,
        el('span', { class: `method ${ep.method}` }, ep.method),
        el('span', { class: 'title' }, `${ep.host}${ep.template}`),
        copyBtn(`${ep.scheme}://${ep.host}${ep.template}`, 'Copy template')),
      el('div', { class: 'detail-scroll' },
        el('dl', { class: 'kv-summary' },
          el('dt', {}, 'Observed'), el('dd', {}, `${ep.count}× · avg ${fmtMs(avg)}`),
          el('dt', {}, 'Last seen'), el('dd', {}, fmtDateTime(ep.lastSeen)),
          el('dt', {}, 'Statuses'), el('dd', {}, statusChips),
          Object.keys(ep.queryKeys || {}).length ? el('dt', {}, 'Query keys') : null,
          Object.keys(ep.queryKeys || {}).length
            ? el('dd', {}, Object.keys(ep.queryKeys).map((k) => el('span', { class: 'chip' }, k)))
            : null),
        schemaSection('Request schema (inferred)', ep.reqSchema),
        schemaSection('Response schema (inferred)', ep.resSchema),
        el('div', { class: 'section' },
          el('h3', {}, 'Try it'),
          el('div', { class: 'try-form' },
            el('div', { class: 'try-row' }, methodSel, urlIn),
            hdrEditor,
            bodyIn,
            el('div', { class: 'try-actions' }, sendBtn, sendNote),
            result)),
        el('div', { class: 'section' },
          el('h3', {}, 'History'),
          historyRows.length ? el('div', {}, ...historyRows)
            : el('div', { class: 'body-empty' }, '∅ no stored examples'))));
    detail.dataset.detail = '1';
    body.append(detail);
  }

  function schemaSection(title, schema) {
    if (!schema) return null;
    const pretty = JSON.stringify(schema, null, 2);
    const { node } = renderBody(pretty, 'application/json');
    return el('div', { class: 'section' },
      el('h3', {}, title, el('span', { class: 'spacer' }), copyBtn(pretty, 'Copy schema')),
      el('div', { class: 'body-box' }, node));
  }

  function exampleUrl(ep, examples) {
    if (examples.length) return examples[0].url;
    return `${ep.scheme}://${ep.host}${ep.template}`;
  }

  function shortUrl(url) {
    try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
  }

  function closeDetail() {
    for (const d of body.querySelectorAll('[data-detail]')) d.remove();
  }

  // ---- export / import ----
  async function exportXray() {
    const p = ctx.currentProfile();
    if (!p) return;
    const examples = [];
    const seen = new Set();
    for (const ep of endpoints) {
      for (const id of ep.exampleIds || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const e = await ctx.db.getEntry(id);
        if (e) examples.push(p.redactExport
          ? { ...e, reqHeaders: redactHeaders(e.reqHeaders), resHeaders: redactHeaders(e.resHeaders) }
          : e);
      }
    }
    const payload = {
      format: 'chrome-xray',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      profile: { ...p, enabled: false },
      endpoints,
      examples,
    };
    download(`${p.name.replace(/[^\w.-]+/g, '_')}.xray.json`, JSON.stringify(payload, null, 2));
    ctx.toast(`Exported ${endpoints.length} endpoints`);
  }

  async function exportOpenAPI() {
    const p = ctx.currentProfile();
    if (!p) return;
    const doc = toOpenAPI(p, endpoints);
    download(`${p.name.replace(/[^\w.-]+/g, '_')}.openapi.json`, JSON.stringify(doc, null, 2));
    ctx.toast('OpenAPI 3.1 exported');
  }

  async function importXray(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'chrome-xray') throw new Error('not a chrome-xray export');
      const profile = { ...data.profile, id: data.profile.id || crypto.randomUUID() };
      const existing = await ctx.db.getProfile(profile.id);
      await ctx.db.putProfile(existing ? { ...existing, ...profile, enabled: existing.enabled } : profile);
      for (const ep of data.endpoints || []) await ctx.db.putEndpoint(ep);
      for (const ex of data.examples || []) await ctx.db.addEntry(ex);
      await ctx.reloadProfiles(profile.id);
      ctx.toast(`Imported ${data.endpoints?.length || 0} endpoints into "${profile.name}"`);
    } catch (err) {
      ctx.toast(`Import failed: ${err.message}`);
    }
  }

  // ---- data ----
  async function load() {
    const p = ctx.currentProfile();
    endpoints = p ? await ctx.db.listEndpoints(p.id) : [];
    renderList();
  }

  ctx.onProfileChange(load);

  return {
    refresh: load,
    scheduleRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        // refresh the list only when no detail is open, to not stomp the form
        if (!body.querySelector('[data-detail]')) await load();
        else {
          const p = ctx.currentProfile();
          endpoints = p ? await ctx.db.listEndpoints(p.id) : [];
        }
      }, 500);
    },
  };
}
