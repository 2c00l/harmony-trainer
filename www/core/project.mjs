// Song model: one vocal (recorded or isolated from an imported song), optional instrumental,
// the melody notes found in the vocal, and the key. The harmony part comes from Settings.
import { db, uid } from './db.mjs';
import { settings } from './settings.mjs';
import { HARMONY_TYPES } from '../dsp/theory.mjs';
import { analyseSamples, dropOutliers } from '../dsp/analyse.mjs';
import { generateHarmony } from '../dsp/harmony.mjs';

export function harmonyLabel(type) { return HARMONY_TYPES[type]?.label || type; }

export function newProject(name = 'My song') {
  const now = Date.now();
  return {
    id: uid(), name, created: now, updated: now, v: 2,
    key: null, baseLayerId: null, notes: [],
    layers: [], // [{id, audioKey, frames:[t,midi,...], notes, duration}] — the first is the vocal
    duration: 0, backingKey: null, imported: false,
  };
}

const saveTimers = new Map();
export function autosave(p, delay = 400) {
  p.updated = Date.now();
  clearTimeout(saveTimers.get(p.id));
  saveTimers.set(p.id, setTimeout(() => { saveTimers.delete(p.id); db.putProject(strip(p)).catch((e) => console.warn('autosave failed', e)); }, delay));
}
/** Forget any pending save (the song is being deleted). */
export function cancelSave(id) { clearTimeout(saveTimers.get(id)); saveTimers.delete(id); }
export async function saveNow(p) {
  clearTimeout(saveTimers.get(p.id)); saveTimers.delete(p.id);
  p.updated = Date.now();
  await db.putProject(strip(p));
}
function strip(p) {
  // drop runtime-only fields (decoded AudioBuffers, caches)
  return JSON.parse(JSON.stringify(p, (k, v) => (k.startsWith('_') ? undefined : v)));
}

// frames are stored as a flat array [t0, m0, t1, m1, ...] with m = -1 for unvoiced (compact JSON)
export function packFrames(frames) {
  const out = [];
  for (const f of frames) out.push(Math.round(f.t * 1000) / 1000, f.midi == null ? -1 : Math.round(f.midi * 100) / 100);
  return out;
}
export function unpackFrames(arr) {
  const out = [];
  if (!arr) return out;
  for (let i = 0; i < arr.length; i += 2) out.push({ t: arr[i], midi: arr[i + 1] < 0 ? null : arr[i + 1] });
  return out;
}

/** Analyse a vocal (Float32Array at sr, index 0 = time 0) into a pitch line, notes and key. */
export function analyseTake(samples, sr, { a4 = settings.get('a4'), key = null } = {}) {
  return analyseSamples(samples, sr, { a4, clarity: settings.get('clarity'), key });
}

/**
 * The same, in a worker: the screen stays responsive (and Back works) while a long vocal is
 * analysed. `signal.cancelled = true` stops it. Falls back to the main thread if workers fail.
 */
export function analyseTakeAsync(samples, sr, { key = null, signal = null } = {}) {
  const opts = { a4: settings.get('a4'), clarity: settings.get('clarity'), key };
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('../audio/analyse-worker.mjs', import.meta.url), { type: 'module' }); }
    catch { resolve(analyseSamples(samples, sr, opts)); return; }
    const poll = signal ? setInterval(() => { if (signal.cancelled) { clearInterval(poll); w.terminate(); reject(new Error('cancelled')); } }, 100) : null;
    w.onmessage = (e) => { clearInterval(poll); w.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.res); };
    w.onerror = (e) => { clearInterval(poll); w.terminate(); reject(e.error || new Error('analysis failed')); };
    const copy = samples.slice();
    w.postMessage({ samples: copy, sr, opts }, [copy.buffer]);
  });
}

export { dropOutliers };

/** Harmony notes for the song, using the harmony choices in Settings. */
export function harmonyTargets(p) {
  const oct = { up: 12, down: -12 }[settings.get('harmonyOctave')] || 0;
  return generateHarmony(p.notes, { key: p.key || { root: 0, mode: 'major' }, defaultType: settings.get('harmonyType'), diatonic: settings.get('diatonic') })
    .filter((t) => t.midi != null)
    .map((t) => ({ ...t, midi: t.midi + oct }));
}
