// Pitch track → note events. Handles scoops (onset glides), vibrato (period-averaged
// smoothing), slides (short transitional fragments are absorbed) and dropouts.
import { snapToKey } from './theory.mjs';

const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/**
 * frames: [{t, midi|null}] uniformly spaced.
 * returns notes [{start, end, midiRaw, midi}] (midi = rounded, or key-snapped if key given)
 */
export function segmentNotes(frames, {
  gapMerge = 0.035,       // s: unvoiced gaps shorter than this don't break a note
  splitSemis = 0.7,       // semitone deviation (on the smoothed curve) that starts a new note
  splitHold = 0.06,       // s the deviation must persist
  minNote = 0.09,         // s: shorter fragments are absorbed into neighbours
  vibratoWindow = 0.2,    // s: moving average window (≈1 vibrato cycle)
  scoopIgnore = 0.08,     // s at the onset excluded from pitch estimate
  key = null,
} = {}) {
  if (frames.length < 2) return [];
  const dt = (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) || 0.005;
  // 1. voiced runs
  const runs = [];
  let cur = null, lastVoiced = -1;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.midi == null) continue;
    if (cur && (f.t - frames[lastVoiced].t) <= gapMerge + dt * 0.5) cur.idx.push(i);
    else { cur = { idx: [i] }; runs.push(cur); }
    lastVoiced = i;
  }
  const notes = [];
  const halfW = Math.max(1, Math.round(vibratoWindow / dt / 2));
  for (const run of runs) {
    const ids = run.idx;
    const p = ids.map((i) => frames[i].midi);
    const tt = ids.map((i) => frames[i].t);
    // 2. vibrato-cancelling smooth
    const sm = new Array(p.length);
    let acc = 0, cnt = 0, lo = 0, hi = -1;
    for (let i = 0; i < p.length; i++) {
      while (hi < Math.min(p.length - 1, i + halfW)) { hi++; acc += p[hi]; cnt++; }
      while (lo < i - halfW) { acc -= p[lo]; cnt--; lo++; }
      sm[i] = acc / cnt;
    }
    // 3. split where the smoothed curve departs from the running segment centre
    const holdN = Math.max(1, Math.round(splitHold / dt));
    let devStart = -1, settling = false;
    const cuts = [];
    const settleLag = Math.max(1, Math.round(0.03 / dt));
    let ref = sm[0], refN = 1;
    for (let i = 1; i < p.length; i++) {
      if (settling) {
        // follow the curve through a transition; no new cuts until it flattens
        ref = sm[i]; refN = 1;
        if (i >= settleLag && Math.abs(sm[i] - sm[i - settleLag]) < 0.12) settling = false;
        continue;
      }
      const dev = Math.abs(sm[i] - ref);
      if (dev > splitSemis) {
        if (devStart < 0) devStart = i;
        if (i - devStart + 1 >= holdN) {
          // place the cut where the RAW pitch crosses halfway between old and new levels
          const from = ref;
          let c = devStart;
          for (let j = Math.max(1, devStart - halfW); j <= i; j++) {
            if (Math.abs(p[j] - from) > splitSemis * 0.8) { c = j; break; }
          }
          if (!cuts.length || c > cuts[cuts.length - 1]) cuts.push(c);
          settling = true; devStart = -1;
        }
      } else {
        devStart = -1;
        refN = Math.min(refN + 1, Math.round(0.3 / dt));
        ref += (sm[i] - ref) / refN;
      }
    }
    const bounds = [0, ...cuts, p.length];
    const segs = [];
    for (let b = 0; b < bounds.length - 1; b++) {
      const a = bounds[b], z = bounds[b + 1];
      if (z <= a) continue;
      segs.push({ a, z, start: tt[a], end: tt[z - 1] + dt });
    }
    // 4. pitch estimate per segment (skip scoop at onset, release at end)
    for (const s of segs) {
      const skip = Math.round(scoopIgnore / dt);
      const tail = Math.round(0.03 / dt);
      let a = s.a + skip, z = s.z - tail;
      if (z - a < 3) { a = s.a + Math.floor((s.z - s.a) / 3); z = s.z; }
      const vals = p.slice(a, Math.max(a + 1, z));
      // average of the central half: robust to scoops/fall-offs, unbiased under vibrato
      const sorted = vals.slice().sort((x, y) => x - y);
      const q1 = Math.floor(sorted.length * 0.25), q3 = Math.ceil(sorted.length * 0.75);
      const core = sorted.slice(q1, Math.max(q1 + 1, q3));
      s.midiRaw = core.reduce((x, y) => x + y, 0) / core.length;
      s.med = median(vals);
    }
    // 5. absorb short fragments (slides / glitches)
    let changed = true;
    while (changed && segs.length > 1) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.end - s.start >= minNote) continue;
        const L = segs[i - 1], R = segs[i + 1];
        let tgt = null;
        if (L && R) tgt = Math.abs(L.midiRaw - s.midiRaw) <= Math.abs(R.midiRaw - s.midiRaw) ? L : R;
        else tgt = L || R;
        if (!tgt) break;
        if (tgt === L) L.end = s.end; else R.start = s.start;
        segs.splice(i, 1);
        changed = true;
        break;
      }
    }
    // 6. merge neighbours that round to the same note (vibrato that crossed the split threshold)
    for (let i = 1; i < segs.length; i++) {
      const L = segs[i - 1], R = segs[i];
      if (Math.round(L.midiRaw) === Math.round(R.midiRaw) && Math.abs(L.midiRaw - R.midiRaw) < 0.45) {
        const wl = L.end - L.start, wr = R.end - R.start;
        L.midiRaw = (L.midiRaw * wl + R.midiRaw * wr) / (wl + wr);
        L.end = R.end;
        segs.splice(i, 1); i--;
      }
    }
    for (const s of segs) {
      if (s.end - s.start < minNote && segs.length === 1 && s.end - s.start < minNote * 0.8) continue;
      notes.push({ start: s.start, end: s.end, midiRaw: s.midiRaw });
    }
  }
  for (const n of notes) n.midi = key ? snapToKey(n.midiRaw, key) : Math.round(n.midiRaw);
  return notes;
}

/** Snap note times to a tempo grid (division in beats, e.g. 0.5 = eighth notes). */
export function quantise(notes, { bpm, division = 0.5, offset = 0 }) {
  const g = (60 / bpm) * division;
  const out = notes.map((n) => {
    let s = Math.round((n.start - offset) / g) * g + offset;
    let e = Math.round((n.end - offset) / g) * g + offset;
    if (e <= s) e = s + g;
    return { ...n, start: s, end: e };
  });
  for (let i = 1; i < out.length; i++) if (out[i].start < out[i - 1].end) out[i - 1].end = out[i].start;
  return out.filter((n) => n.end > n.start);
}
