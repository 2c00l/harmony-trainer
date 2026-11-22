// Builds demo content (original melody + synthesized harmony layers + practice history)
// for store screenshots. Returns a JSON-able payload the page stores in IndexedDB.
import { fromDegrees } from '../../www/core/exercises.mjs';
import { generateHarmony } from '../../www/dsp/harmony.mjs';
import { analyseBuffer } from '../../www/dsp/pitch.mjs';
import { packFrames } from '../../www/core/project.mjs';
import { voice } from '../../tests/synth.mjs';

const SR = 48000;
// "Evening Lantern" — an original melody written for this app.
const TUNE = [[2, 1], [2, 1], [3, 1], [4, 1], [4, 1], [3, 1], [2, 1], [1, 1], [0, 1], [0, 1], [1, 1], [2, 1], [2, 1.5], [1, 0.5], [1, 2],
  [2, 1], [2, 1], [3, 1], [4, 1], [4, 1], [3, 1], [2, 1], [1, 1], [0, 1], [0, 1], [1, 1], [2, 1], [1, 1.5], [0, 0.5], [0, 2]];

function render(notes, seed, vowel) {
  // render a part as a continuous sung line aligned to the note times
  const total = notes[notes.length - 1].end + 1;
  const out = new Float32Array(Math.ceil(total * SR));
  for (const n of notes) {
    const v = voice([{ midi: n.midi, dur: n.end - n.start, vib: n.end - n.start > 0.9 ? { rate: 5.4, depth: 28 } : null, scoop: 0.4 }], { sr: SR, seed: seed + Math.round(n.start * 10), noise: 0.002, vowel });
    const off = Math.round(n.start * SR) - Math.round(0.1 * SR);
    for (let i = 0; i < v.samples.length && off + i < out.length; i++) if (off + i >= 0) out[off + i] += v.samples[i];
  }
  return out;
}

export function buildDemo() {
  const key = { root: 7, mode: 'major' }; // G major
  const bpm = 84;
  const { notes } = fromDegrees(TUNE, { tonic: 55, bpm, start: 0.5 });
  const melody = notes.map((n, i) => ({ ...n, id: 'm' + i }));
  const third = generateHarmony(melody, { key, defaultType: 'third_above' });
  const sixth = generateHarmony(melody, { key, defaultType: 'sixth_below' });
  const parts = [
    { name: 'Melody', part: 'Melody', colorIdx: 0, notes: melody, seed: 3, vowel: 'a' },
    { name: 'High third', part: '3rd above', colorIdx: 1, notes: third, seed: 9, vowel: 'o' },
    { name: 'Low sixth', part: '6th below', colorIdx: 2, notes: sixth, seed: 17, vowel: 'u' },
  ];
  const audio = {};
  const layers = parts.map((p, i) => {
    const samples = render(p.notes.filter((n) => n.midi != null), p.seed, p.vowel);
    const frames = analyseBuffer(samples, SR, { hop: 480 });
    const key2 = 'demo-audio-' + i;
    audio[key2] = Buffer.from(samples.buffer).toString('base64');
    return { id: 'L' + i, name: p.name, colorIdx: p.colorIdx, gain: i ? 0.8 : 1, mute: false, solo: false, audioKey: key2, frames: packFrames(frames.filter((_, k) => k % 2 === 0)), role: i ? 'harmony' : 'melody', part: p.part, notes: p.notes.filter((n) => n.midi != null).map((n, k) => ({ id: `${i}-${k}`, start: n.start, end: n.end, midi: n.midi })), score: [null, 94, 88][i], duration: samples.length / SR };
  });
  const dur = layers[0].duration;
  const now = Date.now();
  const project = {
    id: 'demo-lantern', name: 'Evening Lantern', created: now - 86400000 * 3, updated: now, v: 1, sampleRate: SR, bpm, beatsPerBar: 4, beatOffset: 0.5, timeMode: 'tempo',
    key, keyConfirmed: true, keyCandidates: [{ ...key, score: 0.9 }, { root: 4, mode: 'minor', score: 0.8 }],
    baseLayerId: 'L0', notes: layers[0].notes,
    harmony: { defaultType: 'third_above', defaultSemis: 0, regions: [{ start: 0, end: 5.9, type: 'unison', semis: 0 }, { start: 5.9, end: 17.6, type: 'third_above', semis: 0 }], diatonic: true, chordAware: false, chords: [] },
    layers, duration: dur, backingKey: null, backingGain: 0.8, imported: false, bestScores: [{ at: now, score: 94 }],
  };
  const others = [
    { id: 'demo-2', name: 'Morning round', layers: 2, key: { root: 2, mode: 'major' } },
    { id: 'demo-3', name: 'Harbour song', layers: 4, key: { root: 9, mode: 'minor' } },
  ].map((o, k) => ({ ...project, id: o.id, name: o.name, key: o.key, updated: now - (k + 1) * 86400000 * 2, layers: layers.slice(0, Math.min(3, o.layers)).map((l) => ({ ...l, audioKey: l.audioKey })) }));
  // ~3 weeks of practice history with improving scores
  const history = [];
  const kinds = ['harmony', 'lesson', 'match', 'intervals', 'warmups', 'sustain'];
  let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let d = 20; d >= 0; d--) {
    if (d % 6 === 4) continue; // a couple of rest days
    for (let j = 0; j < 2; j++) {
      const kind = kinds[(d + j) % kinds.length];
      const base = 58 + (20 - d) * 1.6 + rnd() * 10;
      const notes = [];
      for (let k = 0; k < 10; k++) { const m = 50 + Math.floor(rnd() * 20); const hard = m >= 66 || m === 52; const miss = rnd() < (hard ? 0.45 : 0.08); notes.push({ midi: m, grade: miss ? 'miss' : rnd() < 0.6 ? 'perfect' : 'good', cents: miss ? 70 : Math.round((rnd() - 0.5) * 30) }); }
      history.push({ kind, ref: kind, title: { harmony: 'Evening Lantern', lesson: 'Thirds above', match: 'Pitch match', intervals: 'Intervals', warmups: 'Five-note scale', sustain: 'Sustain' }[kind], score: Math.min(97, Math.round(base)), hitPct: Math.min(100, Math.round(base + 5)), drift: -4, timing: 12, notes, at: now - d * 86400000 - j * 3600000 });
    }
  }
  return { project, others, audio, history };
}
