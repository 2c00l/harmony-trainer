// Song model: one vocal (recorded or isolated from an imported song), optional instrumental,
// the melody notes found in the vocal, and the key. The harmony part comes from Settings.
import { db, uid } from './db.mjs';
import { settings } from './settings.mjs';
import { analyseBuffer } from '../dsp/pitch.mjs';
import { segmentNotes } from '../dsp/segment.mjs';
import { detectKey, snapToKey, HARMONY_TYPES } from '../dsp/theory.mjs';
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
  const frames = analyseBuffer(samples, sr, { hop: Math.round(sr / 200), a4, clarityThreshold: Math.max(0.5, settings.get('clarity') - 0.05) });
  const raw = dropOutliers(segmentNotes(frames, { scoopIgnore: 0.08 }));
  const ranked = detectKey(raw.map((n) => ({ ...n, midi: Math.round(n.midiRaw) })));
  const k = key || { root: ranked[0].root, mode: ranked[0].mode };
  const notes = raw.map((n) => ({ id: uid(), start: n.start, end: n.end, midi: snapToKey(n.midiRaw, k), raw: Math.round(n.midiRaw * 100) / 100 }));
  return { frames, notes, key: k, keyCandidates: ranked.slice(0, 4) };
}

/**
 * Remove notes that cannot be part of the sung melody: outside a singable range, or a short
 * note far away from everything around it (a whistle, a harmonic, a bleed-through instrument).
 * These were what occasionally produced a shrill wrong note in playback.
 */
export function dropOutliers(notes) {
  const ok = notes.filter((n) => n.midiRaw >= 36 && n.midiRaw <= 86 && n.end - n.start >= 0.07);
  return ok.filter((n) => {
    const near = ok.filter((o) => o !== n && Math.abs((o.start + o.end) / 2 - (n.start + n.end) / 2) < 5).map((o) => o.midiRaw).sort((a, b) => a - b);
    if (near.length < 3) return true;
    const med = near[near.length >> 1];
    const far = Math.abs(n.midiRaw - med);
    return !(far > 9 && n.end - n.start < 0.8) && far <= 16;
  });
}

/** Harmony notes for the song, using the harmony choices in Settings. */
export function harmonyTargets(p) {
  const oct = { up: 12, down: -12 }[settings.get('harmonyOctave')] || 0;
  return generateHarmony(p.notes, { key: p.key || { root: 0, mode: 'major' }, defaultType: settings.get('harmonyType'), diatonic: settings.get('diatonic') })
    .filter((t) => t.midi != null)
    .map((t) => ({ ...t, midi: t.midi + oct }));
}
