// chrome-xray settings view: profile configuration + lifecycle.

import { el } from '../../lib/util.js';

export function createSettingsView(root, ctx) {
  function field(labelText, input, note) {
    return el('div', { class: 'field' },
      el('label', {}, labelText),
      input,
      note ? el('div', { class: 'note' }, note) : null);
  }

  function render() {
    root.replaceChildren();
    const p = ctx.currentProfile();

    // -- new profile --
    const newName = el('input', { type: 'text', placeholder: 'name (e.g. myapp staging)' });
    const newPatterns = el('input', { type: 'text', placeholder: 'https://api.example.com/*' });
    const createBtn = el('button', { class: 'primary' }, 'Create profile');
    createBtn.addEventListener('click', async () => {
      const name = newName.value.trim();
      const pattern = newPatterns.value.trim();
      if (!name || !pattern) { ctx.toast('Name and pattern required'); return; }
      const profile = ctx.db.newProfile(name, pattern.split(/\s+/));
      await ctx.db.putProfile(profile);
      await ctx.reloadProfiles(profile.id);
      ctx.toast(`Profile "${name}" created`);
    });
    root.append(el('div', { class: 'settings-group' },
      el('h3', {}, 'New profile'),
      field('Name', newName),
      field('URL patterns (space-separated, * wildcard)', newPatterns,
        'Matched against full page URLs to decide when capture turns on.'),
      el('div', { class: 'btn-row' }, createBtn)));

    if (!p) {
      root.append(el('div', { class: 'settings-group' },
        el('h3', {}, 'Profile'),
        el('div', { class: 'body-empty' },
          'No profile selected. Activate a site from the popup or create one above.')));
      return;
    }

    // -- edit current profile --
    const nameIn = el('input', { type: 'text', value: p.name });
    const patternsIn = el('textarea', { rows: '3', spellcheck: 'false' });
    patternsIn.value = (p.patterns || []).join('\n');
    const bodyCapIn = el('input', { type: 'number', value: String(p.bodyCap || 262144), min: '1024', step: '1024' });
    const maxEntriesIn = el('input', { type: 'number', value: String(p.maxEntries || 1000), min: '50', step: '50' });
    const redactIn = el('input', { type: 'checkbox' });
    redactIn.checked = p.redactExport !== false;
    const enabledIn = el('input', { type: 'checkbox' });
    enabledIn.checked = !!p.enabled;

    const saveBtn = el('button', { class: 'primary' }, 'Save');
    saveBtn.addEventListener('click', async () => {
      p.name = nameIn.value.trim() || p.name;
      p.patterns = patternsIn.value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      p.bodyCap = Math.max(1024, Number(bodyCapIn.value) || 262144);
      p.maxEntries = Math.max(50, Number(maxEntriesIn.value) || 1000);
      p.redactExport = redactIn.checked;
      p.enabled = enabledIn.checked;
      await ctx.db.putProfile(p);
      await ctx.reloadProfiles(p.id);
      const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
      for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'xray:state-changed' }).catch(() => {});
      ctx.toast('Profile saved');
    });

    root.append(el('div', { class: 'settings-group' },
      el('h3', {}, `Profile: ${p.name}`),
      field('Name', nameIn),
      field('URL patterns (one per line)', patternsIn),
      field('Body capture cap (bytes)', bodyCapIn, 'Request/response bodies larger than this are truncated.'),
      field('Max stored entries', maxEntriesIn, 'Oldest entries are pruned past this count.'),
      el('div', { class: 'field-inline' }, enabledIn, el('label', {}, 'Capture enabled')),
      el('div', { class: 'field-inline' }, redactIn,
        el('label', {}, 'Redact auth headers on export (authorization, cookie, api keys)')),
      el('div', { class: 'btn-row' }, saveBtn)));

    // -- danger zone --
    const clearBtn = el('button', { class: 'danger' }, 'Clear history');
    clearBtn.addEventListener('click', async () => {
      await ctx.db.clearEntries(p.id);
      ctx.toast('History cleared');
    });
    const clearEpBtn = el('button', { class: 'danger' }, 'Clear endpoints');
    clearEpBtn.addEventListener('click', async () => {
      await ctx.db.clearEndpoints(p.id);
      await ctx.reloadProfiles(p.id);
      ctx.toast('Endpoints cleared');
    });
    const deleteBtn = el('button', { class: 'danger' }, 'Delete profile');
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete profile "${p.name}" and all its data?`)) return;
      await ctx.db.deleteProfile(p.id);
      await ctx.reloadProfiles();
      ctx.toast('Profile deleted');
    });
    root.append(el('div', { class: 'settings-group' },
      el('h3', {}, 'Danger zone'),
      el('div', { class: 'btn-row' }, clearBtn, clearEpBtn, deleteBtn)));

    // -- about --
    root.append(el('div', { class: 'settings-group' },
      el('h3', {}, 'About'),
      el('div', { style: 'font-size:11.5px;color:var(--subtext0)' },
        `chrome-xray v${chrome.runtime.getManifest().version} — all data stays in this browser (IndexedDB). `,
        'Capture is a MAIN-world fetch/XHR shim: silent, per-profile, no debugger banner.')));
  }

  ctx.onProfileChange(render);
  render();
}
