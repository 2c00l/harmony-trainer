// Demo content for store screenshots: an original melody ("Evening Lantern") sung by a synthetic
// voice, a soft chord backing (so it looks like an imported song with music), and a sing-along
// take that follows the 3rd-above harmony. Returns a JSON-able payload stored in IndexedDB.
import { generateHarmony } from '../../www/dsp/harmony.mjs';
import { analyseBuffer } from '../../www/dsp/pitch.mjs';
import { diatonicShift } from '../../www/dsp/theory.mjs';
import { packFrames } from '../../www/core/project.mjs';
import { voice } from '../../tests/synth.mjs';

const SR = 48000;
const TUNE = [[2, 1], [2, 1], [3, 1], [4, 1], [4, 1], [3, 1], [2, 1], [1, 1], [0, 1], [0, 1], [1, 1], [2, 1], [2, 1.5], [1, 0.5], [1, 2],
  [2, 1], [2, 1], [3, 1], [4, 1], [4, 1], [3, 1], [2, 1], [1, 1], [0, 1], [0, 1], [1, 1], [2, 1], [1, 1.5], [0, 0.5], [0, 2]];

function fromDegrees(seq, { tonic, key, bpm, start }) {
  const beat = 60 / bpm;
  let t = start;
  const out = [];
  for (const [deg, beats] of seq) {
    out.push({ start: t, end: t + beats * beat - Math.min(0.06, beat * 0.12), midi: diatonicShift(tonic, deg, key) });
    t += beats * beat;
  }
  return out;
}

function sing(notes, seed, vowel, total) {
  const out = new Float32Array(Math.ceil(total * SR));
  for (const n of notes) {
    const v = voice([{ midi: n.midi, dur: n.end - n.start, vib: n.end - n.start > 0.9 ? { rate: 5.4, depth: 28 } : null, scoop: 0.4 }], { sr: SR, seed: seed + Math.round(n.start * 10), noise: 0.002, vowel });
    const off = Math.round(n.start * SR) - Math.round(0.1 * SR);
    for (let i = 0; i < v.samples.length && off + i < out.length; i++) if (off + i >= 0) out[off + i] += v.samples[i] * 0.8;
  }
  return out;
}

function pad(total, bpm) {
  // gentle I–V–vi–IV pad in G, one chord per bar
  const out = new Float32Array(Math.ceil(total * SR));
  const chords = [[55, 59, 62], [50, 54, 57], [52, 55, 59], [48, 52, 55]];
  const bar = (60 / bpm) * 4;
  for (let b = 0; b * bar < total; b++) {
    const a = Math.round((0.5 + b * bar) * SR), e = Math.min(out.length, Math.round((0.5 + (b + 1) * bar) * SR));
    for (const m of chords[b % 4]) {
      const f = 440 * 2 ** ((m - 69) / 12);
      for (let i = a; i < e; i++) { const t = (i - a) / SR; out[i] += 0.05 * Math.sin(2 * Math.PI * f * i / SR) * Math.min(1, t * 4) * Math.exp(-t * 0.35); }
    }
  }
  return out;
}

const b64 = (f) => Buffer.from(f.buffer).toString('base64');

export function buildDemo() {
  const key = { root: 7, mode: 'major' }; // G major
  const bpm = 84;
  const melody = fromDegrees(TUNE, { tonic: 55, key, bpm, start: 1.5 }).map((n, i) => ({ ...n, id: 'm' + i, raw: n.midi }));
  const total = melody[melody.length - 1].end + 1.5;
  const vocal = sing(melody, 3, 'a', total);
  const third = generateHarmony(melody, { key, defaultType: 'third_above' }).filter((n) => n.midi != null);
  const take = sing(third.slice(0, 15), 9, 'o', third[14].end + 0.6);
  // a clean sung-looking pitch line for the demo: a small scoop into each note, gentle vibrato on
  // long ones, silence between (the synthetic voice's decay tails analyse as jagged noise)
  const frames = (_s, notes) => {
    const out = [];
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const n of notes) {
      for (let t = n.start; t < n.end - 0.03; t += 0.02) {
        const into = t - n.start;
        const midi = n.midi - (into < 0.08 ? 0.45 * (1 - into / 0.08) : 0) + (n.end - n.start > 0.9 ? Math.sin(into * 2 * Math.PI * 5.4) * 0.05 * Math.min(1, Math.max(0, (into - 0.3) / 0.3)) : 0) + (rnd() - 0.5) * 0.03;
        out.push({ t, midi });
      }
      out.push({ t: n.end, midi: null });
    }
    return packFrames(out);
  };
  void analyseBuffer;
  const now = Date.now();
  const project = {
    id: 'demo-lantern', name: 'Evening Lantern', created: now - 86400000 * 2, updated: now, v: 2,
    key, keyCandidates: [{ ...key, score: 0.9 }, { root: 4, mode: 'minor', score: 0.8 }],
    baseLayerId: 'L0', notes: melody,
    layers: [{ id: 'L0', name: 'Vocal', audioKey: 'demo-vocal', frames: frames(vocal, melody), notes: melody, duration: total }],
    duration: total, backingKey: 'demo-music', imported: true, transpose: 0,
    takes: [{ id: 'T1', name: 'Take 1', audioKey: 'demo-take', at: 0, duration: take.length / SR, created: now, transpose: 0, frames: frames(take, third.slice(0, 15)) }],
    takeId: 'T1', playTake: false,
  };
  const others = [
    { id: 'demo-2', name: 'Morning round', key: { root: 2, mode: 'major' }, imported: false },
    { id: 'demo-3', name: 'Harbour song', key: { root: 9, mode: 'minor' }, imported: true },
    { id: 'demo-4', name: 'Choir warm-up', key: { root: 0, mode: 'major' }, imported: false },
  ].map((o, k) => ({ ...project, ...o, updated: now - (k + 1) * 86400000 * 2, takes: [], playTake: false }));
  return { project, others, audio: { 'demo-vocal': b64(vocal), 'demo-music': b64(pad(total, bpm)), 'demo-take': b64(take) } };
}
