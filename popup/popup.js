// chrome-xray popup: per-site activation, panel + overlay launchers.

import { initTheme } from '../lib/theme.js';

initTheme();

document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;

const originEl = document.getElementById('origin');
const dot = document.getElementById('dot');
const stateText = document.getElementById('state-text');
const toggleBtn = document.getElementById('toggle');

let tab = null;
let active = false;

async function refresh() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    originEl.textContent = 'not a capturable page';
    toggleBtn.disabled = true;
    stateText.textContent = 'unavailable';
    return;
  }
  originEl.textContent = new URL(tab.url).origin;
  const res = await chrome.runtime.sendMessage({ type: 'xray:get-state', url: tab.url });
  active = !!(res && res.active);
  dot.classList.toggle('on', active);
  stateText.textContent = active
    ? `capturing → ${res.profile.name}`
    : 'not capturing';
  toggleBtn.textContent = active ? 'Deactivate for this site' : 'Activate for this site';
  toggleBtn.classList.toggle('primary', !active);
  toggleBtn.classList.toggle('danger', active);
}

toggleBtn.addEventListener('click', async () => {
  if (!tab) return;
  toggleBtn.disabled = true;
  await chrome.runtime.sendMessage({
    type: active ? 'xray:deactivate' : 'xray:activate',
    url: tab.url,
  });
  toggleBtn.disabled = false;
  await refresh();
});

document.getElementById('open-panel').addEventListener('click', async () => {
  if (tab) await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});

document.getElementById('overlay').addEventListener('click', async () => {
  if (tab) await chrome.runtime.sendMessage({ type: 'xray:overlay-toggle', tabId: tab.id });
  window.close();
});

refresh();
