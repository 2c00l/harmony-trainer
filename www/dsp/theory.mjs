// Music theory: note naming, scales, key detection, diatonic harmony.

export const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const SOLFEGE = ['Do', 'Di', 'Re', 'Ri', 'Mi', 'Fa', 'Fi', 'Sol', 'Si', 'La', 'Li', 'Ti'];
const FLAT_KEYS = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb (major roots)

export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};

export const pc = (m) => ((Math.round(m) % 12) + 12) % 12;

export function prefersFlats(key) {
  if (!key) return false;
  const rel = key.mode === 'minor' ? (key.root + 3) % 12 : key.root;
  return FLAT_KEYS.has(rel);
}

/** label for a midi note. style: 'letter' | 'solfege' | 'number'; accidentals: 'sharp'|'flat'|'auto' */
export function noteLabel(midi, { style = 'letter', accidentals = 'auto', key = null, octave = true } = {}) {
  const m = Math.round(midi);
  const p = pc(m);
  const oct = Math.floor(m / 12) - 1;
  if (style === 'solfege') {
    const root = key ? key.root : 0;
    return SOLFEGE[(p - root + 12) % 12];
  }
  if (style === 'number') {
    const root = key ? key.root : 0;
    const scale = MODES[key?.mode || 'major'];
    const rel = (p - root + 12) % 12;
    const deg = scale.indexOf(rel);
    if (deg >= 0) return String(deg + 1);
    const below = scale.indexOf((rel + 11) % 12);
    return below >= 0 ? `♯${below + 1}` : `♭${scale.indexOf((rel + 1) % 12) + 1}`;
  }
  const flats = accidentals === 'flat' || (accidentals === 'auto' && prefersFlats(key));
  const name = (flats ? FLAT_NAMES : SHARP_NAMES)[p];
  return octave ? name + oct : name;
}

export function keyName(key, accidentals = 'auto') {
  if (!key) return '—';
  const flats = accidentals === 'flat' || (accidentals === 'auto' && prefersFlats(key));
  return (flats ? FLAT_NAMES : SHARP_NAMES)[key.root] + (key.mode === 'minor' ? ' minor' : ' major');
}

export function scalePcs(key) { return MODES[key.mode].map((s) => (s + key.root) % 12); }
export function inKey(midi, key) { return scalePcs(key).includes(pc(midi)); }

/** nearest midi note that belongs to the key (ties → keep lower) */
export function snapToKey(midiFloat, key) {
  const base = Math.round(midiFloat);
  if (!key) return base;
  const pcs = scalePcs(key);
  let best = base, bestD = Infinity;
  for (let d = -2; d <= 2; d++) {
    const c = base + d;
    if (!pcs.includes(pc(c))) continue;
    const dist = Math.abs(c - midiFloat);
    if (dist < bestD - 1e-9) { bestD = dist; best = c; }
  }
  return best;
}

// Krumhansl-Kessler profiles
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * Key detection from notes [{midi, start, end}] weighted by duration, with a small
 * bonus for the final note and the first note as tonic candidates.
 * Returns ranked [{root, mode, score}] (best first).
 */
export function detectKey(notes) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[pc(n.midi)] += Math.max(0.05, n.end - n.start);
  if (!notes.length) return [{ root: 0, mode: 'major', score: 0 }];
  const last = pc(notes[notes.length - 1].midi), first = pc(notes[0].midi);
  const res = [];
  for (let r = 0; r < 12; r++) {
    for (const [mode, prof] of [['major', KK_MAJOR], ['minor', KK_MINOR]]) {
      const rot = prof.map((_, i) => prof[(i - r + 12) % 12]);
      let s = corr(hist, rot);
      if (last === r) s += 0.08;
      if (first === r) s += 0.03;
      // melodies that never touch a scale's pcs get penalised a little more
      const pcs = MODES[mode].map((x) => (x + r) % 12);
      let outside = 0, tot = 0;
      for (let i = 0; i < 12; i++) { tot += hist[i]; if (!pcs.includes(i)) outside += hist[i]; }
      if (tot) s -= 0.3 * outside / tot;
      res.push({ root: r, mode, score: s });
    }
  }
  res.sort((a, b) => b.score - a.score);
  return res;
}

// Harmony intervals expressed in diatonic steps (scale degrees) or semitones (custom chromatic)
export const HARMONY_TYPES = {
  third_above: { label: '3rd above', steps: 2 },
  third_below: { label: '3rd below', steps: -2 },
  sixth_below: { label: '6th below', steps: -5 },
  sixth_above: { label: '6th above', steps: 5 },
  fifth_above: { label: '5th above', steps: 4 },
  fourth_above: { label: '4th above', steps: 3 },
  fourth_below: { label: '4th below', steps: -3 },
  fifth_below: { label: '5th below', steps: -4 },
  octave_above: { label: 'Octave above', steps: 7 },
  octave_below: { label: 'Octave below', steps: -7 },
  unison: { label: 'Unison', steps: 0 },
};

/** Shift a melody note by diatonic steps within key. Chromatic notes keep their offset. */
export function diatonicShift(midi, steps, key) {
  const scale = MODES[key.mode];
  const m = Math.round(midi);
  const rel = m - key.root;
  const oct = Math.floor(rel / 12);
  const within = ((rel % 12) + 12) % 12;
  let deg = scale.indexOf(within), chroma = 0;
  if (deg < 0) {
    // chromatic note: treat as the scale note below + 1 semitone
    deg = scale.indexOf((within + 11) % 12);
    chroma = 1;
    if (deg < 0) { deg = scale.indexOf((within + 1) % 12); chroma = -1; }
  }
  const total = deg + steps;
  const newOct = oct + Math.floor(total / 7);
  const newDeg = ((total % 7) + 7) % 7;
  return key.root + newOct * 12 + scale[newDeg] + chroma;
}

// Simple chords for chord-aware mode, as scale-degree roots (0-based) with triad quality inferred diatonically
export function diatonicTriad(degree, key) {
  const scale = MODES[key.mode];
  return [0, 2, 4].map((s) => (key.root + scale[(degree + s) % 7]) % 12);
}

export function chordPcs(chord) {
  // chord: {root: pc, quality: 'maj'|'min'|'dim'|'7'}
  const q = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], '7': [0, 4, 7, 10], sus4: [0, 5, 7] }[chord.quality] || [0, 4, 7];
  return q.map((x) => (x + chord.root) % 12);
}

/**
 * Generate a harmony note for one melody note.
 * opts: {type, key, chromaticSemis?, chord?, diatonic=true}
 * Returns midi or null (rest).
 */
export function harmonyNote(melodyMidi, { type, key, semis = 0, chord = null, diatonic = true }) {
  if (type === 'rest') return null;
  if (type === 'custom') {
    return diatonic ? snapToKey(melodyMidi + semis, key) : Math.round(melodyMidi + semis);
  }
  const t = HARMONY_TYPES[type];
  if (!t) return Math.round(melodyMidi);
  if (!diatonic) {
    const semitoneMap = { 2: 4, [-2]: -3, [-5]: -8, 5: 9, 4: 7, [-4]: -7, 3: 5, [-3]: -5, 7: 12, [-7]: -12, 0: 0 };
    return Math.round(melodyMidi) + (semitoneMap[t.steps] ?? 0);
  }
  const target = diatonicShift(melodyMidi, t.steps, key);
  if (!chord || t.steps === 0 || Math.abs(t.steps) === 7) return target;
  const tones = chordPcs(chord);
  if (tones.includes(pc(target))) return target;
  // prefer a chord tone 1 diatonic step either side, staying on the same side of the melody
  const cands = [diatonicShift(melodyMidi, t.steps - 1, key), diatonicShift(melodyMidi, t.steps + 1, key)]
    .filter((c) => tones.includes(pc(c)) && Math.sign(c - melodyMidi) === Math.sign(target - melodyMidi) && c !== Math.round(melodyMidi));
  if (!cands.length) return target;
  cands.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  return cands[0];
}

/** Suggest a simple diatonic chord per bar from the melody notes in it (I IV V vi ii iii for major) */
export function suggestChords(notes, key, barStarts) {
  const out = [];
  const degs = key.mode === 'major' ? [0, 3, 4, 5, 1, 2] : [0, 3, 4, 5, 2, 6];
  for (let b = 0; b < barStarts.length; b++) {
    const s = barStarts[b], e = barStarts[b + 1] ?? Infinity;
    const w = new Array(12).fill(0);
    for (const n of notes) {
      const ov = Math.min(e, n.end) - Math.max(s, n.start);
      if (ov > 0) w[pc(n.midi)] += ov;
    }
    let best = degs[0], bestS = -1;
    for (const d of degs) {
      const tri = diatonicTriad(d, key);
      const sc = tri.reduce((acc, p, i) => acc + w[p] * (i === 0 ? 1.2 : 1), 0) + (d === 0 ? 0.01 : 0);
      if (sc > bestS) { bestS = sc; best = d; }
    }
    const tri = diatonicTriad(best, key);
    const third = (tri[1] - tri[0] + 12) % 12, fifth = (tri[2] - tri[0] + 12) % 12;
    out.push({ root: tri[0], quality: fifth === 6 ? 'dim' : third === 3 ? 'min' : 'maj' });
  }
  return out;
}

export function chordName(ch, accidentals = 'auto', key = null) {
  const names = (accidentals === 'flat' || (accidentals === 'auto' && prefersFlats(key))) ? FLAT_NAMES : SHARP_NAMES;
  return names[ch.root] + ({ maj: '', min: 'm', dim: '°', '7': '7', sus4: 'sus4' }[ch.quality] ?? '');
}

/** approximate voice type from a midi range */
export function voiceType(lo, hi) {
  const mid = (lo + hi) / 2;
  const types = [
    { name: 'Bass', lo: 40, hi: 64 }, { name: 'Baritone', lo: 45, hi: 69 }, { name: 'Tenor', lo: 48, hi: 72 },
    { name: 'Alto', lo: 53, hi: 77 }, { name: 'Mezzo-soprano', lo: 57, hi: 81 }, { name: 'Soprano', lo: 60, hi: 84 },
  ];
  let best = types[0], bestD = Infinity;
  for (const t of types) {
    const d = Math.abs((t.lo + t.hi) / 2 - mid) + 0.3 * Math.abs((t.hi - t.lo) - (hi - lo));
    if (d < bestD) { bestD = d; best = t; }
  }
  return best.name;
}
