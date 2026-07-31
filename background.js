// chrome-xray service worker: profile matching, capture storage, endpoint
// collation, replay orchestration, overlay injection, badge state.

import * as db from './db.js';
import { collateEntry } from './lib/collate.js';
import { profileMatches } from './lib/util.js';

// tabId -> profileId for tabs currently capturing (session cache).
const tabProfile = new Map();
// serialize endpoint read-modify-write per endpoint identity
const collateQueue = new Map();
let insertsSincePrune = 0;

async function findMatch(url) {
  const profiles = await db.getProfiles();
  return profiles.find((p) => profileMatches(p, url)) || null;
}

function setBadge(tabId, on) {
  chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' }).catch(() => {});
  if (on) chrome.action.setBadgeBackgroundColor({ tabId, color: '#a6e3a1' }).catch(() => {});
}

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function notifyMatchingTabs(patternsProfile) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    chrome.tabs.sendMessage(tab.id, { type: 'xray:state-changed' }).catch(() => {});
  }
}

async function handleEntry(entry, sender) {
  const tabId = sender.tab && sender.tab.id;
  let profileId = tabId != null ? tabProfile.get(tabId) : null;
  if (!profileId) {
    const profile = await findMatch(entry.pageUrl || entry.url);
    if (!profile) return;
    profileId = profile.id;
    if (tabId != null) tabProfile.set(tabId, profileId);
  }

  entry.profileId = profileId;
  entry.tabId = tabId;
  entry.ts = entry.startedAt || Date.now();
  await db.addEntry(entry);

  // collate into endpoint definition, serialized per profile
  const prev = collateQueue.get(profileId) || Promise.resolve();
  const next = prev.then(async () => {
    try {
      const probe = collateEntry(null, entry, profileId); // computes id
      const existing = await db.getEndpoint(probe.id);
      const merged = existing ? collateEntry(existing, entry, profileId) : probe;
      await db.putEndpoint(merged);
      broadcast({ type: 'xray:endpoint-updated', endpointId: merged.id, profileId });
    } catch { /* malformed URL — skip collation */ }
  });
  collateQueue.set(profileId, next.catch(() => {}));

  broadcast({ type: 'xray:new-entry', entry });
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { type: 'xray:new-entry', entry }).catch(() => {});
  }

  if (++insertsSincePrune >= 50) {
    insertsSincePrune = 0;
    const profile = await db.getProfile(profileId);
    if (profile) db.pruneEntries(profileId, profile.maxEntries || 1000).catch(() => {});
  }
}

async function activateFor(url) {
  let profile = await findMatch(url);
  if (!profile) {
    // reuse a disabled profile matching this origin, else create one
    const origin = new URL(url).origin;
    const profiles = await db.getProfiles();
    profile = profiles.find((p) => (p.patterns || []).includes(origin + '/*'));
    if (profile) {
      profile.enabled = true;
    } else {
      profile = db.newProfile(new URL(url).host, [origin + '/*']);
    }
    await db.putProfile(profile);
  } else if (!profile.enabled) {
    profile.enabled = true;
    await db.putProfile(profile);
  }
  await notifyMatchingTabs(profile);
  broadcast({ type: 'xray:profiles-changed' });
  return profile;
}

async function deactivateFor(url) {
  const profiles = await db.getProfiles();
  const matches = profiles.filter((p) => p.enabled && profileMatches({ ...p, enabled: true }, url));
  for (const p of matches) {
    p.enabled = false;
    await db.putProfile(p);
  }
  for (const [tabId, pid] of tabProfile) {
    if (matches.some((p) => p.id === pid)) {
      tabProfile.delete(tabId);
      setBadge(tabId, false);
    }
  }
  await notifyMatchingTabs();
  broadcast({ type: 'xray:profiles-changed' });
}

// Replay a request inside a tab's page context so cookies/origin apply.
async function replayInTab(tabId, req) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (r) => {
      try {
        window.__xrayReplay = true;
        const p = fetch(r.url, {
          method: r.method,
          headers: r.headers || {},
          body: ['GET', 'HEAD'].includes(r.method) ? undefined : (r.body ?? undefined),
        });
        window.__xrayReplay = false;
        const resp = await p;
        const text = await resp.text();
        return {
          ok: true,
          status: resp.status,
          statusText: resp.statusText,
          headers: Object.fromEntries(resp.headers.entries()),
          body: text.slice(0, 524288),
          truncated: text.length > 524288,
        };
      } catch (e) {
        window.__xrayReplay = false;
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    args: [req],
  });
  return res && res.result;
}

async function toggleOverlay(tabId) {
  try {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!window.__XRAY_OVERLAY__,
    });
    if (probe && probe.result) {
      await chrome.tabs.sendMessage(tabId, { type: 'xray:overlay-toggle' });
    } else {
      // first injection shows itself
      await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay/overlay.js'] });
    }
  } catch { /* chrome:// pages etc. */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  switch (msg.type) {
    case 'xray:hello': {
      (async () => {
        const profile = await findMatch(msg.url);
        const tabId = sender.tab && sender.tab.id;
        if (profile && tabId != null) {
          tabProfile.set(tabId, profile.id);
          setBadge(tabId, true);
        } else if (tabId != null) {
          tabProfile.delete(tabId);
          setBadge(tabId, false);
        }
        sendResponse(profile
          ? { active: true, profileId: profile.id, bodyCap: profile.bodyCap || 262144 }
          : { active: false });
      })();
      return true;
    }
    case 'xray:entry': {
      handleEntry(msg.entry, sender).catch(() => {});
      return false;
    }
    case 'xray:get-state': {
      (async () => {
        const profile = await findMatch(msg.url);
        sendResponse({ active: !!profile, profile });
      })();
      return true;
    }
    case 'xray:activate': {
      activateFor(msg.url).then((profile) => sendResponse({ ok: true, profile }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    case 'xray:deactivate': {
      deactivateFor(msg.url).then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    case 'xray:replay': {
      (async () => {
        let tabId = msg.tabId;
        if (tabId == null) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tab && tab.id;
        }
        if (tabId == null) { sendResponse({ ok: false, error: 'no active tab' }); return; }
        const result = await replayInTab(tabId, msg.request);
        sendResponse(result || { ok: false, error: 'no result from tab' });
      })();
      return true;
    }
    case 'xray:overlay-toggle': {
      (async () => {
        let tabId = msg.tabId;
        if (tabId == null) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tab && tab.id;
        }
        if (tabId != null) await toggleOverlay(tabId);
        sendResponse({ ok: true });
      })();
      return true;
    }
    case 'xray:open-panel': {
      (async () => {
        try {
          const windowId = msg.windowId ?? (sender.tab && sender.tab.windowId);
          await chrome.sidePanel.open(windowId != null ? { windowId } : {});
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
    default:
      return false;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-overlay') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) await toggleOverlay(tab.id);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabProfile.delete(tabId);
});
