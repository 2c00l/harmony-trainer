// IndexedDB storage: projects (JSON), audio (Float32 PCM blobs), (history store kept for old installs).
const NAME = 'harmony-trainer', VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      if (!db.objectStoreNames.contains('history')) { const h = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true }); h.createIndex('kind', 'kind'); }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  try { navigator.storage?.persist?.(); } catch { /* */ }
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const db = {
  putProject: (p) => tx('projects', 'readwrite', (s) => s.put(p)),
  getProject: (id) => tx('projects', 'readonly', (s) => s.get(id)),
  listProjects: () => tx('projects', 'readonly', (s) => s.getAll()).then((a) => (a || []).sort((x, y) => y.updated - x.updated)),
  deleteProject: async (p) => {
    for (const l of p.layers || []) await db.deleteAudio(l.audioKey);
    if (p.backingKey) await db.deleteAudio(p.backingKey);
    return tx('projects', 'readwrite', (s) => s.delete(p.id));
  },
  putAudio: (key, samples) => tx('audio', 'readwrite', (s) => s.put(samples, key)),
  getAudio: (key) => tx('audio', 'readonly', (s) => s.get(key)),
  deleteAudio: (key) => key ? tx('audio', 'readwrite', (s) => s.delete(key)) : Promise.resolve(),
  clearAll: async () => {
    const d = await open();
    await Promise.all(['projects', 'audio', 'history'].map((n) => new Promise((res) => { const t = d.transaction(n, 'readwrite'); t.objectStore(n).clear(); t.oncomplete = res; t.onerror = res; })));
  },
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
