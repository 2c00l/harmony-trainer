// Vocal → pitch line, melody notes and key. Pure (no settings, storage or DOM), so it runs the
// same in a worker as on the main thread.
import { analyseBuffer } from './pitch.mjs';
import { segmentNotes } from './segment.mjs';
import { detectKey, snapToKey } from './theory.mjs';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** samples: Float32Array at sr, index 0 = time 0 */
export function analyseSamples(samples, sr, { a4 = 440, clarity = 0.62, key = null } = {}) {
  const frames = analyseBuffer(samples, sr, { hop: Math.round(sr / 200), a4, clarityThreshold: Math.max(0.5, clarity - 0.05) });
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
