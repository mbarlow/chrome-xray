// chrome-xray theme selection: system | light | dark, persisted in
// chrome.storage.local, applied as data-theme on <html>.

export async function initTheme() {
  const { theme } = await chrome.storage.local.get('theme');
  applyTheme(theme || 'system');
  return theme || 'system';
}

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export async function setTheme(theme) {
  await chrome.storage.local.set({ theme });
  applyTheme(theme);
}

export async function cycleTheme() {
  const { theme } = await chrome.storage.local.get('theme');
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(theme || 'system') + 1) % order.length];
  await setTheme(next);
  return next;
}
