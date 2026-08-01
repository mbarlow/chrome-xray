// chrome-xray settings view: profile configuration + lifecycle.

import { el } from '../../lib/util.js';
import { collateEntry, templatize, endpointId } from '../../lib/collate.js';

export function createSettingsView(root, ctx) {
  // id of the profile awaiting a second click to confirm deletion
  let pendingDelete = null;
  let renderToken = 0;

  function field(labelText, input, note) {
    return el('div', { class: 'field' },
      el('label', {}, labelText),
      input,
      note ? el('div', { class: 'note' }, note) : null);
  }

  // Tabs still capturing under a removed/renamed profile re-handshake and drop it.
  async function resyncTabs() {
    chrome.runtime.sendMessage({ type: 'xray:profiles-changed-by-panel' }).catch(() => {});
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'xray:state-changed' }).catch(() => {});
  }

  async function removeProfile(profile) {
    await ctx.db.deleteProfile(profile.id);
    pendingDelete = null;
    await ctx.reloadProfiles();
    await resyncTabs();
    ctx.toast(`Deleted "${profile.name}"`);
  }

  // -- profile list: pick or delete any profile, not just the selected one --
  function profileList(current) {
    const profiles = ctx.allProfiles();
    if (!profiles.length) {
      return el('div', { class: 'settings-group' },
        el('h3', {}, 'Profiles'),
        el('div', { class: 'body-empty' }, 'No profiles yet. Activate a site from the popup or create one below.'));
    }

    const token = ++renderToken;
    const metaEls = new Map();
    const rows = profiles.map((p) => {
      const active = current && p.id === current.id;
      const meta = el('div', { class: 'profile-meta' }, (p.patterns || []).join(' ') || 'no patterns');
      metaEls.set(p.id, meta);
      const pick = el('button', { class: 'profile-pick', title: 'Select this profile' },
        el('div', { class: 'profile-name' }, `${p.enabled ? '●' : '○'} ${p.name}`),
        meta);
      pick.addEventListener('click', () => {
        pendingDelete = null;
        ctx.selectProfile(p.id);   // triggers re-render via onProfileChange
      });

      let actions;
      if (pendingDelete === p.id) {
        const yes = el('button', { class: 'danger' }, 'Delete');
        yes.addEventListener('click', () => { removeProfile(p); });
        const no = el('button', {}, 'Cancel');
        no.addEventListener('click', () => { pendingDelete = null; render(); });
        actions = el('div', { class: 'profile-actions' }, yes, no);
      } else {
        const del = el('button', { class: 'danger icon-btn', title: `Delete "${p.name}" and all its data` }, '✕');
        del.addEventListener('click', () => { pendingDelete = p.id; render(); });
        actions = el('div', { class: 'profile-actions' }, del);
      }

      return el('div', { class: `profile-row${active ? ' active' : ''}` }, pick, actions);
    });

    // counts are async; fill them in once, unless a newer render superseded us
    (async () => {
      for (const p of profiles) {
        const n = await ctx.db.countEntries(p.id).catch(() => null);
        if (token !== renderToken) return;
        const node = metaEls.get(p.id);
        if (node && n != null) {
          node.textContent = `${n} ${n === 1 ? 'entry' : 'entries'} · ${(p.patterns || []).join(' ') || 'no patterns'}`;
        }
      }
    })();

    return el('div', { class: 'settings-group' },
      el('h3', {}, 'Profiles'),
      el('div', { class: 'profile-list' }, ...rows),
      el('div', { class: 'note' }, 'Click a profile to select it. ✕ deletes it with all its history and endpoints.'));
  }

  function render() {
    root.replaceChildren();
    const p = ctx.currentProfile();
    if (pendingDelete && !ctx.allProfiles().some((x) => x.id === pendingDelete)) pendingDelete = null;
    root.append(profileList(p));

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
      await resyncTabs();
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
    // window.confirm() is suppressed in the side panel, so confirm in place
    const deleteBtn = el('button', { class: 'danger' }, 'Delete profile');
    let armed = false;
    let armTimer = null;
    deleteBtn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        deleteBtn.textContent = 'Click again to delete';
        armTimer = setTimeout(() => {
          armed = false;
          deleteBtn.textContent = 'Delete profile';
        }, 4000);
        return;
      }
      clearTimeout(armTimer);
      await removeProfile(p);
    });
    root.append(el('div', { class: 'settings-group' },
      el('h3', {}, 'Danger zone'),
      el('div', { class: 'btn-row' }, clearBtn, clearEpBtn, deleteBtn)));

    // -- maintenance --
    const rebuildBtn = el('button', {}, 'Rebuild endpoints from history');
    rebuildBtn.addEventListener('click', async () => {
      rebuildBtn.disabled = true;
      rebuildBtn.textContent = 'Rebuilding…';
      try {
        // oldest first so firstSeen and example ordering come out right
        const entries = (await ctx.db.listEntries(p.id, Infinity)).reverse();
        const byId = new Map();
        let skipped = 0;
        for (const e of entries) {
          try {
            const u = new URL(e.url);
            const { template } = templatize(u.pathname);
            const id = endpointId(p.id, e.method, u.host, template);
            byId.set(id, collateEntry(byId.get(id) || null, e, p.id));
          } catch { skipped++; }
        }
        await ctx.db.clearEndpoints(p.id);
        for (const ep of byId.values()) await ctx.db.putEndpoint(ep);
        await ctx.reloadProfiles(p.id);
        ctx.toast(`Rebuilt ${byId.size} endpoints from ${entries.length} entries${skipped ? ` (${skipped} skipped)` : ''}`);
      } finally {
        rebuildBtn.disabled = false;
        rebuildBtn.textContent = 'Rebuild endpoints from history';
      }
    });
    root.append(el('div', { class: 'settings-group' },
      el('h3', {}, 'Maintenance'),
      el('div', { class: 'field' },
        el('div', { class: 'note' },
          'Drops current endpoint definitions and re-collates them from every stored history entry. Use after an upgrade or import.'),
        el('div', { class: 'btn-row' }, rebuildBtn))));

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
