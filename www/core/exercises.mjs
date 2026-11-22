// Exercise and lesson content generation (pure). All melodies are original.
import { MODES, diatonicShift } from '../dsp/theory.mjs';
import { generateHarmony } from '../dsp/harmony.mjs';

export const DEFAULT_RANGE = { lo: 52, hi: 72 }; // E3–C5: comfortable for most untrained voices

export function userRange(meta) {
  const r = meta || DEFAULT_RANGE;
  return { lo: Math.min(r.lo, r.hi - 7), hi: Math.max(r.hi, r.lo + 7) };
}

/** degrees (0-based scale steps, may exceed 6 / go negative) + beats → notes at a tonic */
export function fromDegrees(seq, { tonic, mode = 'major', bpm = 80, start = 0 }) {
  const key = { root: ((tonic % 12) + 12) % 12, mode };
  const beat = 60 / bpm;
  let t = start;
  const out = [];
  for (const [deg, beats, rest] of seq) {
    if (deg == null || rest) { t += beats * beat; continue; }
    const midi = diatonicShift(tonic, deg, key);
    out.push({ start: t, end: t + beats * beat - Math.min(0.06, beat * 0.12), midi });
    t += beats * beat;
  }
  return { notes: out, key, duration: t };
}

/** Pick a tonic so that `notes` (built at tonic 0) sit centred in the user's range. */
export function fitTonic(buildAt, range, { mode = 'major' } = {}) {
  const probe = buildAt(60).map((n) => n.midi);
  const mid = (Math.min(...probe) + Math.max(...probe)) / 2;
  const centre = (range.lo + range.hi) / 2;
  let tonic = Math.round(60 + (centre - mid));
  // keep exercises comfortable: prefer tonics that keep everything inside the range
  const span = Math.max(...probe) - Math.min(...probe);
  if (span <= range.hi - range.lo) {
    const lo = Math.min(...probe) - 60 + tonic, hi = Math.max(...probe) - 60 + tonic;
    if (lo < range.lo) tonic += range.lo - lo;
    if (hi > range.hi) tonic -= hi - range.hi;
  }
  void mode;
  return tonic;
}

// ---------- warm-ups ----------
export const WARMUPS = [
  { id: 'siren', title: 'Sirens', sub: 'Glide low to high and back on “ng” or “oo”', kind: 'curve' },
  { id: 'five', title: 'Five-note scale', sub: '1-2-3-4-5-4-3-2-1, stepping up', kind: 'steps', seq: [0, 1, 2, 3, 4, 3, 2, 1, 0], beats: [1, 1, 1, 1, 1, 1, 1, 1, 2] },
  { id: 'arp', title: 'Arpeggio', sub: '1-3-5-8-5-3-1, stepping up', kind: 'steps', seq: [0, 2, 4, 7, 4, 2, 0], beats: [1, 1, 1, 2, 1, 1, 2] },
  { id: 'hum', title: 'Hum and lip trill', sub: 'Gentle 1-2-3-2-1 on a hum or “brrr”', kind: 'steps', seq: [0, 1, 2, 1, 0], beats: [2, 2, 2, 2, 3], bpm: 92 },
  { id: 'down', title: 'Descending fives', sub: '5-4-3-2-1, stepping down', kind: 'steps', seq: [4, 3, 2, 1, 0], beats: [1, 1, 1, 1, 2], direction: -1 },
];

/** a warm-up pattern repeated, moving by a semitone each time */
export function warmupSteps(w, range, reps = 4) {
  const bpm = w.bpm || 100;
  const beat = 60 / bpm;
  const top = Math.max(...w.seq.map((d) => MODES.major[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7)));
  const dir = w.direction || 1;
  let tonic = dir > 0 ? Math.max(range.lo, Math.round(range.lo + 2)) : Math.min(range.hi - top, Math.round(range.hi - top - 1));
  if (dir > 0 && tonic + top + reps - 1 > range.hi) tonic = Math.max(range.lo - 1, range.hi - top - reps + 1);
  const notes = [];
  let t = 0;
  for (let r = 0; r < reps; r++) {
    const k = tonic + dir * r;
    const seq = w.seq.map((d, i) => [d, w.beats[i]]);
    const { notes: ns, duration } = fromDegrees(seq, { tonic: k, bpm, start: t });
    notes.push(...ns);
    t = t + duration - 0 + beat; // one beat breath
    void duration;
    t = ns[ns.length - 1].end + beat * 1.5;
  }
  return { notes, duration: t, bpm };
}

/** siren guide curve: smooth low→high→low across the range */
export function sirenCurve(range, dur = 7, start = 0.5) {
  const pts = [];
  const lo = range.lo + 1, hi = range.hi - 1;
  for (let i = 0; i <= 140; i++) {
    const x = i / 140;
    const y = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
    pts.push({ t: start + x * dur, midi: lo + (hi - lo) * y });
  }
  return pts;
}

// ---------- intervals ----------
export const INTERVALS = [
  { name: 'Unison', semis: 0, level: 0 }, { name: 'Octave', semis: 12, level: 1 },
  { name: 'Perfect 5th', semis: 7, level: 1 }, { name: 'Major 3rd', semis: 4, level: 1 },
  { name: 'Perfect 4th', semis: 5, level: 2 }, { name: 'Minor 3rd', semis: 3, level: 2 },
  { name: 'Major 2nd', semis: 2, level: 2 }, { name: 'Major 6th', semis: 9, level: 3 },
  { name: 'Minor 6th', semis: 8, level: 3 }, { name: 'Minor 2nd', semis: 1, level: 3 },
  { name: 'Minor 7th', semis: 10, level: 4 }, { name: 'Major 7th', semis: 11, level: 4 }, { name: 'Tritone', semis: 6, level: 4 },
];

export function pickInterval(level, rnd = Math.random) {
  const pool = INTERVALS.filter((i) => i.level <= Math.max(1, level) && i.semis > 0);
  const iv = pool[Math.floor(rnd() * pool.length)];
  const dir = level >= 2 && rnd() < 0.4 ? -1 : 1;
  return { ...iv, dir };
}

/** adaptive pitch-match level: returns next level from recent results (0..1 accuracy) */
export function adaptLevel(level, lastScores) {
  const recent = lastScores.slice(-3);
  if (recent.length === 3 && recent.every((s) => s >= 80)) return Math.min(5, level + 1);
  if (recent.length >= 2 && recent.slice(-2).every((s) => s < 45)) return Math.max(1, level - 1);
  return level;
}
export function pitchMatchNote(level, range, prev, rnd = Math.random) {
  const span = [3, 5, 8, 12, 16, 20][Math.min(5, level)];
  const centre = prev ?? Math.round((range.lo + range.hi) / 2);
  let m;
  for (let k = 0; k < 20; k++) {
    m = centre + Math.round((rnd() * 2 - 1) * span);
    if (m >= range.lo && m <= range.hi && m !== prev) break;
  }
  return Math.max(range.lo, Math.min(range.hi, m));
}

// ---------- harmony course ----------
// Melodies are original, written for this app. Tuples: [scale degree, beats].
const M = {
  stroll: [[0, 1], [1, 1], [2, 1], [0, 1], [2, 1], [3, 1], [4, 2], [4, 1], [3, 1], [2, 1], [1, 1], [0, 3]],
  lantern: [[2, 1], [2, 1], [3, 1], [4, 1], [4, 1], [3, 1], [2, 1], [1, 1], [0, 1], [0, 1], [1, 1], [2, 1], [2, 1.5], [1, 0.5], [1, 2]],
  harbour: [[4, 1], [2, 1], [3, 1], [1, 1], [2, 1], [0, 1], [1, 2], [4, 1], [5, 1], [4, 1], [3, 1], [2, 1], [1, 1], [0, 2]],
  meadow: [[0, 2], [2, 2], [4, 2], [5, 1], [4, 1], [3, 2], [2, 2], [1, 2], [0, 4]],
  hill: [[0, 1], [0, 1], [4, 1], [4, 1], [5, 1], [3, 1], [4, 2], [3, 1], [3, 1], [2, 1], [2, 1], [1, 1], [1, 1], [0, 2]],
};

export const LESSONS = [
  { id: 'unison', title: 'Unison', sub: 'Match the melody exactly', melody: 'stroll', part: { type: 'unison' },
    text: ['Harmony starts with listening. In <b>unison</b>, two voices sing the same notes.', 'Sing along with the melody. Watch your line sit inside each bar, and listen for the moment your voice disappears into the tone. That “locking in” feeling is what you are aiming for in every harmony.'] },
  { id: 'drone', title: 'Singing against a drone', sub: 'Hear 1, 3 and 5 over a tonic', melody: null, drone: true, custom: [[0, 3], [2, 3], [4, 3], [2, 3], [0, 4]],
    text: ['A <b>drone</b> is one steady note. Against it, every note you sing has its own colour.', 'Hold the root, then the 3rd, then the 5th. Each should sound calm and settled when it is in tune. If it sounds rough or wobbly, move slightly until it settles.'] },
  { id: 'thirds', title: 'Thirds above', sub: 'The sweetest harmony', melody: 'lantern', part: { type: 'third_above' },
    text: ['A <b>3rd above</b> is the most common harmony in pop and folk. It stays two scale steps above the melody.', 'Some 3rds are major (4 semitones) and some are minor (3). The app works this out from the key, so the bars are always right. Keep the melody in your ear and let your part float above it.'] },
  { id: 'sixths', title: 'Sixths below', sub: 'Warm and full', melody: 'harbour', part: { type: 'sixth_below' },
    text: ['A <b>6th below</b> is a 3rd above, moved down an octave. It sounds warm and supportive.', 'Because it sits under the melody, it is great for lower voices. Listen for a rich, rounded blend.'] },
  { id: 'fifths', title: 'Fifths', sub: 'Open and strong', melody: 'meadow', part: { type: 'fifth_above' },
    text: ['A <b>5th</b> sounds open, bright and a little ancient. It is the backbone of power chords and folk harmony.', '5ths are very sensitive to tuning: when they are right, the two voices seem to merge into one bigger sound.'] },
  { id: 'moving', title: 'Moving lines', sub: 'Your part has its own shape', melody: 'hill', part: { type: 'custom-line', degrees: [[2, 1], [2, 1], [2, 1], [2, 1], [3, 1], [5, 1], [6, 2], [5, 1], [5, 1], [4, 1], [4, 1], [3, 1], [3, 1], [2, 2]] },
    text: ['Real harmony parts do not always move in parallel. Sometimes the harmony <b>stays still</b> while the melody moves, or moves the <b>opposite way</b>.', 'This part holds a note while the melody climbs, then gently steps down as it comes home. Trust the bars rather than copying the melody’s shape.'] },
  { id: 'partial', title: 'Partial harmony', sub: 'Unison, split, then rejoin', melody: 'lantern', part: { type: 'regions', regions: [[0, 0.33, 'unison'], [0.33, 0.8, 'third_above'], [0.8, 1, 'unison']] },
    text: ['Arrangers often keep voices together, then split into harmony for a lift, then rejoin.', 'Start in unison, split up to a 3rd for the middle phrase, then come back to unison for the ending. You can do the same in your own projects by selecting part of the timeline in Harmony.'] },
  { id: 'stack', title: 'Stacking three parts', sub: 'Complete the chord', melody: 'stroll', extra: { type: 'third_above' }, part: { type: 'sixth_below' },
    text: ['With three parts you can sing full chords. You will hear the melody <b>and</b> a 3rd above it.', 'Your job is the bottom part, a 6th below the melody. Together the three voices make a complete triad. This is how vocal groups build their sound.'] },
];

/** Build a lesson's playable material fitted to the user's range. */
export function buildLesson(lesson, range, bpm = 84) {
  const build = (tonic) => {
    const key = { root: ((tonic % 12) + 12) % 12, mode: 'major' };
    if (lesson.custom) {
      const { notes } = fromDegrees(lesson.custom, { tonic, bpm });
      return { melody: [], target: notes, extra: [], key, droneMidi: tonic };
    }
    const mel = fromDegrees(M[lesson.melody], { tonic, bpm });
    let target;
    if (lesson.part.type === 'custom-line') target = fromDegrees(lesson.part.degrees, { tonic, bpm }).notes;
    else if (lesson.part.type === 'regions') {
      const D = mel.duration;
      const regions = lesson.part.regions.map(([a, b, type]) => ({ start: a * D, end: b * D, type }));
      target = generateHarmony(mel.notes, { key, regions, defaultType: 'unison' });
    } else target = generateHarmony(mel.notes, { key, defaultType: lesson.part.type });
    const extra = lesson.extra ? generateHarmony(mel.notes, { key, defaultType: lesson.extra.type }) : [];
    return { melody: mel.notes, target: target.filter((n) => n.midi != null).map((n) => ({ start: n.start, end: n.end, midi: n.midi })), extra, key, duration: mel.duration };
  };
  const tonic = fitTonic((t) => build(t).target, range);
  const out = build(tonic);
  out.tonic = tonic;
  out.duration = out.duration || Math.max(...out.target.map((n) => n.end)) + 0.3;
  out.bpm = bpm;
  return out;
}
