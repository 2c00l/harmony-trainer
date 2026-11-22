// IndexedDB storage: projects (JSON), audio (Float32 PCM blobs), history entries.
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
  addHistory: (e) => tx('history', 'readwrite', (s) => s.add({ ...e, at: e.at || Date.now() })),
  listHistory: () => tx('history', 'readonly', (s) => s.getAll()).then((a) => a || []),
  clearAll: async () => {
    const d = await open();
    await Promise.all(['projects', 'audio', 'history'].map((n) => new Promise((res) => { const t = d.transaction(n, 'readwrite'); t.objectStore(n).clear(); t.oncomplete = res; t.onerror = res; })));
  },
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---- streaks: consecutive days with any scored practice ----
export function dayKey(ts = Date.now()) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

export function computeStreak(history, today = Date.now()) {
  const days = new Set(history.map((h) => dayKey(h.at)));
  let streak = 0;
  const d = new Date(today);
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1); // today not practised yet: streak still alive from yesterday
  while (days.has(dayKey(d.getTime()))) { streak++; d.setDate(d.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  for (const k of [...days].sort()) {
    const t = new Date(k + 'T12:00:00').getTime();
    run = prev != null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = t;
  }
  return { streak, best, practisedToday: days.has(dayKey(today)), days };
}

/** per-midi trouble stats from history entries that contain note results */
export function troubleMap(history) {
  const m = new Map();
  for (const h of history) for (const n of h.notes || []) {
    if (n.midi == null) continue;
    const e = m.get(n.midi) || { n: 0, miss: 0, absCents: 0, cn: 0 };
    e.n++;
    if (n.grade === 'miss') e.miss++;
    if (n.cents != null) { e.absCents += Math.abs(n.cents); e.cn++; }
    m.set(n.midi, e);
  }
  return m;
}
