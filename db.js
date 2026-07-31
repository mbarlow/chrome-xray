// chrome-xray IndexedDB layer. Shared by the service worker and the
// sidepanel (same extension origin, same database).
//
// Stores:
//   profiles  { id, name, patterns[], enabled, bodyCap, maxEntries,
//               redactExport, createdAt }
//   entries   { id, profileId, ts, ...capture fields }
//   endpoints { id, profileId, method, host, template, ... }

const DB_NAME = 'xray';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('profiles')) {
        db.createObjectStore('profiles', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('byProfileTs', ['profileId', 'ts']);
      }
      if (!db.objectStoreNames.contains('endpoints')) {
        const s = db.createObjectStore('endpoints', { keyPath: 'id' });
        s.createIndex('byProfile', 'profileId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqValue(request) {
  const holder = { __value: undefined };
  request.onsuccess = () => { holder.__value = request.result; };
  return holder;
}

// ---- profiles ----

export async function getProfiles() {
  const db = await openDB();
  return tx(db, 'profiles', 'readonly', (s) => reqValue(s.getAll()));
}

export async function getProfile(id) {
  const db = await openDB();
  return tx(db, 'profiles', 'readonly', (s) => reqValue(s.get(id)));
}

export async function putProfile(profile) {
  const db = await openDB();
  await tx(db, 'profiles', 'readwrite', (s) => { s.put(profile); });
  return profile;
}

export async function deleteProfile(id) {
  const db = await openDB();
  await clearEntries(id);
  await clearEndpoints(id);
  await tx(db, 'profiles', 'readwrite', (s) => { s.delete(id); });
}

export function newProfile(name, patterns) {
  return {
    id: crypto.randomUUID(),
    name,
    patterns,
    enabled: true,
    bodyCap: 262144,
    maxEntries: 1000,
    redactExport: true,
    createdAt: Date.now(),
  };
}

// ---- entries ----

export async function addEntry(entry) {
  const db = await openDB();
  await tx(db, 'entries', 'readwrite', (s) => { s.put(entry); });
  return entry;
}

export async function getEntry(id) {
  const db = await openDB();
  return tx(db, 'entries', 'readonly', (s) => reqValue(s.get(id)));
}

// Newest-first list for a profile.
export async function listEntries(profileId, limit = 300) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('entries', 'readonly');
    const idx = t.objectStore('entries').index('byProfileTs');
    const range = IDBKeyRange.bound([profileId, 0], [profileId, Infinity]);
    const out = [];
    const cur = idx.openCursor(range, 'prev');
    cur.onsuccess = () => {
      const c = cur.result;
      if (c && out.length < limit) { out.push(c.value); c.continue(); }
      else resolve(out);
    };
    cur.onerror = () => reject(cur.error);
  });
}

export async function countEntries(profileId) {
  const db = await openDB();
  return tx(db, 'entries', 'readonly', (s) =>
    reqValue(s.index('byProfileTs').count(IDBKeyRange.bound([profileId, 0], [profileId, Infinity]))));
}

export async function pruneEntries(profileId, max) {
  const db = await openDB();
  const count = await countEntries(profileId);
  const excess = count - max;
  if (excess <= 0) return 0;
  return new Promise((resolve, reject) => {
    const t = db.transaction('entries', 'readwrite');
    const idx = t.objectStore('entries').index('byProfileTs');
    const range = IDBKeyRange.bound([profileId, 0], [profileId, Infinity]);
    let removed = 0;
    const cur = idx.openCursor(range, 'next'); // oldest first
    cur.onsuccess = () => {
      const c = cur.result;
      if (c && removed < excess) { c.delete(); removed++; c.continue(); }
      else resolve(removed);
    };
    cur.onerror = () => reject(cur.error);
  });
}

export async function clearEntries(profileId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('entries', 'readwrite');
    const idx = t.objectStore('entries').index('byProfileTs');
    const range = IDBKeyRange.bound([profileId, 0], [profileId, Infinity]);
    const cur = idx.openCursor(range);
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { c.delete(); c.continue(); } else resolve();
    };
    cur.onerror = () => reject(cur.error);
  });
}

// ---- endpoints ----

export async function putEndpoint(endpoint) {
  const db = await openDB();
  await tx(db, 'endpoints', 'readwrite', (s) => { s.put(endpoint); });
  return endpoint;
}

export async function getEndpoint(id) {
  const db = await openDB();
  return tx(db, 'endpoints', 'readonly', (s) => reqValue(s.get(id)));
}

export async function listEndpoints(profileId) {
  const db = await openDB();
  return tx(db, 'endpoints', 'readonly', (s) =>
    reqValue(s.index('byProfile').getAll(profileId)));
}

export async function deleteEndpoint(id) {
  const db = await openDB();
  await tx(db, 'endpoints', 'readwrite', (s) => { s.delete(id); });
}

export async function clearEndpoints(profileId) {
  const db = await openDB();
  const all = await listEndpoints(profileId);
  await tx(db, 'endpoints', 'readwrite', (s) => { for (const e of all) s.delete(e.id); });
}
