// chrome-xray sidepanel bootstrap: profile bar, tabs, view wiring.

import * as db from '../db.js';
import { initTheme, cycleTheme } from '../lib/theme.js';
import { el } from '../lib/util.js';
import { createStreamsView } from './views/streams.js';
import { createApiView } from './views/api.js';
import { createSettingsView } from './views/settings.js';

const state = {
  profiles: [],
  profileId: null,
  listeners: new Set(),
};

function currentProfile() {
  return state.profiles.find((p) => p.id === state.profileId) || null;
}

function onProfileChange(cb) { state.listeners.add(cb); }
function emitProfileChange() { for (const cb of state.listeners) cb(currentProfile()); }

const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

const ctx = {
  currentProfile,
  onProfileChange,
  toast,
  reloadProfiles,   // settings view mutates profiles
  db,
};

// ---- profile selector ----
const profileSelect = document.getElementById('profile-select');
const captureToggle = document.getElementById('capture-toggle');

async function reloadProfiles(keepId) {
  state.profiles = (await db.getProfiles()).sort((a, b) => b.createdAt - a.createdAt);
  const keep = keepId || state.profileId;
  state.profileId = state.profiles.some((p) => p.id === keep)
    ? keep
    : (state.profiles[0] && state.profiles[0].id) || null;
  renderProfileBar();
  emitProfileChange();
}

function renderProfileBar() {
  profileSelect.replaceChildren();
  if (!state.profiles.length) {
    profileSelect.append(el('option', {}, 'no profiles — activate a site'));
    profileSelect.disabled = true;
  } else {
    profileSelect.disabled = false;
    for (const p of state.profiles) {
      const opt = el('option', { value: p.id }, `${p.enabled ? '●' : '○'} ${p.name}`);
      if (p.id === state.profileId) opt.selected = true;
      profileSelect.append(opt);
    }
  }
  const p = currentProfile();
  captureToggle.textContent = p && p.enabled ? '⏸' : '▶';
  captureToggle.title = p && p.enabled ? 'Pause capture for this profile' : 'Resume capture for this profile';
  captureToggle.disabled = !p;
}

profileSelect.addEventListener('change', () => {
  state.profileId = profileSelect.value;
  renderProfileBar();
  emitProfileChange();
});

captureToggle.addEventListener('click', async () => {
  const p = currentProfile();
  if (!p) return;
  p.enabled = !p.enabled;
  await db.putProfile(p);
  renderProfileBar();
  chrome.runtime.sendMessage({ type: 'xray:profiles-changed-by-panel' }).catch(() => {});
  // nudge open tabs to re-sync their shims
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'xray:state-changed' }).catch(() => {});
  toast(p.enabled ? 'Capture resumed' : 'Capture paused');
});

// ---- theme ----
const themeToggle = document.getElementById('theme-toggle');
const THEME_ICON = { system: '◐', light: '☀', dark: '☾' };
initTheme().then((t) => { themeToggle.textContent = THEME_ICON[t] || '◐'; });
themeToggle.addEventListener('click', async () => {
  const next = await cycleTheme();
  themeToggle.textContent = THEME_ICON[next] || '◐';
  toast(`Theme: ${next}`);
});

// ---- tabs ----
const tabs = document.querySelectorAll('#tabs .tab');
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const t of tabs) t.classList.toggle('active', t === tab);
    for (const v of document.querySelectorAll('.view')) {
      v.classList.toggle('active', v.id === `view-${tab.dataset.tab}`);
    }
  });
}

// ---- views ----
const streams = createStreamsView(document.getElementById('view-streams'), ctx);
const api = createApiView(document.getElementById('view-api'), ctx);
ctx.refreshApi = () => api.refresh();
createSettingsView(document.getElementById('view-settings'), ctx);

// ---- live updates from the service worker ----
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'xray:new-entry') {
    if (msg.entry.profileId === state.profileId) streams.onEntry(msg.entry);
  } else if (msg.type === 'xray:endpoint-updated') {
    if (msg.profileId === state.profileId) api.scheduleRefresh();
  } else if (msg.type === 'xray:profiles-changed') {
    reloadProfiles();
  }
});

reloadProfiles();
