// Harmony part generation with per-region harmony types and optional chord awareness.
import { harmonyNote } from './theory.mjs';

/**
 * melody: [{id,start,end,midi}]
 * regions: [{start,end,type,semis?}] — later regions override earlier ones
 * returns targets [{id, start, end, midi|null, src}] (null midi = rest)
 */
export function generateHarmony(melody, { key, regions = [], defaultType = 'third_above', defaultSemis = 0, diatonic = true, chordAware = false, chords = [], barLen = null, barOffset = 0 } = {}) {
  return melody.map((n) => {
    const mid = (n.start + n.end) / 2;
    let type = defaultType, semis = defaultSemis;
    for (const r of regions) if (mid >= r.start && mid < r.end) { type = r.type; semis = r.semis ?? 0; }
    let chord = null;
    if (chordAware && barLen && chords.length) {
      const b = Math.floor((mid - barOffset) / barLen);
      chord = chords[Math.max(0, Math.min(chords.length - 1, b))] || null;
    }
    const midi = harmonyNote(n.midi, { type, key, semis, chord, diatonic });
    return { id: n.id, start: n.start, end: n.end, midi, src: n.midi, type };
  });
}

/** Insert or replace a region [start,end) with type; trims/splits overlapping regions. */
export function setRegion(regions, start, end, type, semis = 0) {
  if (end <= start) return regions;
  const out = [];
  for (const r of regions) {
    if (r.end <= start || r.start >= end) { out.push(r); continue; }
    if (r.start < start) out.push({ ...r, end: start });
    if (r.end > end) out.push({ ...r, start: end });
  }
  out.push({ start, end, type, semis });
  return out.sort((a, b) => a.start - b.start);
}
