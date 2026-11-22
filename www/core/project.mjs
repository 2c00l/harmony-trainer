// Project model: layers (takes), base notes (editable target bars), key, harmony regions.
import { db, uid } from './db.mjs';
import { settings } from './settings.mjs';
import { analyseBuffer } from '../dsp/pitch.mjs';
import { segmentNotes } from '../dsp/segment.mjs';
import { detectKey, snapToKey, HARMONY_TYPES, suggestChords } from '../dsp/theory.mjs';
import { generateHarmony } from '../dsp/harmony.mjs';

export const LAYER_COLORS = ['--c-teal', '--c-violet', '--c-coral', '--c-amber', '--c-sky', '--c-pink', '--c-mint', '--c-lime'];

export function harmonyLabel(type, semis) {
  if (type === 'custom') return `${semis > 0 ? '+' : ''}${semis} semitones`;
  if (type === 'rest') return 'Rest';
  return HARMONY_TYPES[type]?.label || type;
}

export function newProject(name = 'Untitled harmony') {
  const now = Date.now();
  return {
    id: uid(), name, created: now, updated: now, v: 1,
    sampleRate: 48000, bpm: null, beatsPerBar: 4, beatOffset: 0, timeMode: 'free',
    key: null, keyConfirmed: false,
    baseLayerId: null, notes: [], // base melody notes (editable)
    harmony: { defaultType: settings.get('defaultHarmony'), defaultSemis: 0, regions: [], diatonic: settings.get('diatonic'), chordAware: settings.get('chordAware'), chords: [] },
    layers: [], // {id, name, colorIdx, gain, mute, solo, audioKey, frames:[t,midi]..., role, part, notes, score, duration}
    duration: 0, backingKey: null, backingGain: 0.8, imported: false,
    bestScores: [],
  };
}

const saveTimers = new Map();
export function autosave(p, delay = 400) {
  p.updated = Date.now();
  clearTimeout(saveTimers.get(p.id));
  saveTimers.set(p.id, setTimeout(() => { saveTimers.delete(p.id); db.putProject(strip(p)).catch((e) => console.warn('autosave failed', e)); }, delay));
}
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

/** Analyse an aligned take (Float32Array at sr, index 0 = musical 0). */
export function analyseTake(samples, sr, { a4 = settings.get('a4'), key = null } = {}) {
  const frames = analyseBuffer(samples, sr, { hop: Math.round(sr / 200), a4, clarityThreshold: Math.max(0.5, settings.get('clarity') - 0.05) });
  const raw = segmentNotes(frames, { scoopIgnore: settings.get('scoopIgnore') / 1000 });
  const ranked = detectKey(raw.map((n) => ({ ...n, midi: Math.round(n.midiRaw) })));
  const k = key || { root: ranked[0].root, mode: ranked[0].mode };
  const notes = raw.map((n) => ({ id: uid(), start: n.start, end: n.end, midi: snapToKey(n.midiRaw, k), raw: Math.round(n.midiRaw * 100) / 100 }));
  return { frames, notes, key: k, keyCandidates: ranked.slice(0, 4) };
}

export function nextColorIdx(p) {
  const used = new Set(p.layers.map((l) => l.colorIdx));
  for (let i = 0; i < LAYER_COLORS.length; i++) if (!used.has(i)) return i;
  return p.layers.length % LAYER_COLORS.length;
}

export function barLen(p) { return p.bpm ? (60 / p.bpm) * p.beatsPerBar : null; }

export function harmonyTargets(p) {
  const bl = barLen(p);
  const H = p.harmony;
  return generateHarmony(p.notes, {
    key: p.key || { root: 0, mode: 'major' }, regions: H.regions, defaultType: H.defaultType, defaultSemis: H.defaultSemis,
    diatonic: H.diatonic, chordAware: H.chordAware && !!bl, chords: H.chords, barLen: bl, barOffset: p.beatOffset,
  });
}

export function ensureChords(p) {
  const bl = barLen(p);
  if (!bl || !p.key) return;
  const nBars = Math.max(1, Math.ceil((p.duration - p.beatOffset) / bl));
  if (p.harmony.chords.length >= nBars) return;
  const starts = []; for (let b = 0; b < nBars; b++) starts.push(p.beatOffset + b * bl);
  const sug = suggestChords(p.notes, p.key, starts);
  p.harmony.chords = sug.map((c, i) => p.harmony.chords[i] || c);
}

export async function listProjects() { return db.listProjects(); }
export async function loadProject(id) { return db.getProject(id); }
