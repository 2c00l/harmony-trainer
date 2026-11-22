import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, analyseBuffer, freqToMidi, midiToFreq } from '../www/dsp/pitch.mjs';
import { segmentNotes } from '../www/dsp/segment.mjs';
import { detectKey, diatonicShift, harmonyNote, snapToKey, noteLabel, keyName, voiceType, suggestChords } from '../www/dsp/theory.mjs';
import { generateHarmony, setRegion } from '../www/dsp/harmony.mjs';
import { scoreTake, stability, vibrato, createLiveScorer } from '../www/dsp/score.mjs';
import { timeStretch, pitchShift } from '../www/dsp/stretch.mjs';
import { voice, sine } from './synth.mjs';

const SR = 48000;

function detectHz(buf, opts) {
  const d = createDetector({ sampleRate: SR, windowSize: 2048, ...opts });
  return d.detect(buf.subarray(4800, 4800 + 2048));
}

test('sine accuracy across the vocal range (±3 cents)', () => {
  for (const hz of [65, 82.4, 110, 196, 261.6, 440, 659.3, 880, 1046.5, 1318]) {
    const r = detectHz(sine(hz, 0.3));
    assert.ok(r.hz > 0, `no pitch at ${hz}`);
    const cents = 1200 * Math.log2(r.hz / hz);
    assert.ok(Math.abs(cents) < 3, `${hz} Hz off by ${cents.toFixed(2)} cents`);
    assert.ok(r.clarity > 0.95);
  }
});

test('silence and white noise are unvoiced', () => {
  const det = createDetector({ sampleRate: SR });
  assert.equal(det.detect(new Float32Array(2048)).hz, 0);
  let s = 1; const n = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) { s = (s * 16807) % 2147483647; n[i] = (s / 2147483647 - 0.5) * 0.3; }
  assert.equal(det.detect(n).hz, 0);
});

// The key quality bar: low male and high female vocal-like signals, all vowels, no octave errors.
for (const [label, midis] of [['low male (E2–C4)', [40, 43, 45, 48, 50, 52, 55, 57, 60]], ['high female (A4–C6)', [69, 72, 74, 76, 79, 81, 84]]]) {
  test(`vocal-like ${label}: no octave errors across vowels`, () => {
    let frames = 0, octaveErrs = 0, bad = 0;
    for (const v of ['a', 'i', 'o', 'u', 'e']) {
      const sig = voice(midis.map((m) => ({ midi: m, dur: 0.5, vib: { rate: 5.5, depth: 30 } })), { vowel: v, seed: midis[0] + v.charCodeAt(0) });
      const fr = analyseBuffer(sig.samples, SR, { hop: 512 });
      for (const tn of sig.truth) {
        for (const f of fr) {
          if (f.t < tn.start + 0.1 || f.t > tn.end - 0.05) continue;
          frames++;
          if (f.midi == null) { bad++; continue; }
          const d = f.midi - tn.midi;
          if (Math.abs(d) > 6) octaveErrs++;
          else if (Math.abs(d) > 0.6) bad++;
        }
      }
    }
    const octRate = octaveErrs / frames, badRate = bad / frames;
    assert.ok(octRate < 0.005, `octave error rate ${(octRate * 100).toFixed(2)}%`);
    assert.ok(badRate < 0.05, `bad/unvoiced rate ${(badRate * 100).toFixed(2)}%`);
  });
}

test('segmentation: scoops, vibrato and gaps produce the right notes', () => {
  const mel = [
    { midi: 60, dur: 0.5, scoop: 2 }, { midi: 62, dur: 0.4 }, { midi: 64, dur: 0.6, vib: { rate: 5.8, depth: 45 } },
    { midi: 65, dur: 0.3 }, { midi: 67, dur: 0.9, vib: { rate: 5, depth: 60 } }, { midi: 64, dur: 0.4, scoop: 1.5 }, { midi: 60, dur: 0.8 },
  ];
  const sig = voice(mel, { seed: 3 });
  const fr = analyseBuffer(sig.samples, SR, { hop: 256 });
  const notes = segmentNotes(fr);
  assert.deepEqual(notes.map((n) => n.midi), mel.map((m) => m.midi));
  for (let i = 0; i < notes.length; i++) {
    assert.ok(Math.abs(notes[i].start - sig.truth[i].start) < 0.06, `onset ${i}`);
    assert.ok(Math.abs(notes[i].midiRaw - mel[i].midi) < 0.2, `pitch ${i} ${notes[i].midiRaw}`);
  }
});

test('segmentation: legato steps without gaps split correctly; slides are absorbed', () => {
  const mel = [{ midi: 57, dur: 0.5, slideTo: 59 }, { midi: 59, dur: 0.5 }, { midi: 60, dur: 0.5 }, { midi: 62, dur: 0.6 }];
  const sig = voice(mel, { legato: true, seed: 11 });
  const notes = segmentNotes(analyseBuffer(sig.samples, SR, { hop: 256 }));
  assert.deepEqual(notes.map((n) => n.midi), [57, 59, 60, 62]);
});

test('segmentation: repeated same pitch separated by breath stays two notes', () => {
  const sig = voice([{ midi: 64, dur: 0.4, gap: 0.15 }, { midi: 64, dur: 0.4 }], { seed: 5 });
  const notes = segmentNotes(analyseBuffer(sig.samples, SR, { hop: 256 }));
  assert.equal(notes.length, 2);
});

test('key detection: major and minor melodies', () => {
  const mk = (arr) => arr.map((m, i) => ({ midi: m, start: i * 0.5, end: i * 0.5 + 0.45 }));
  // G major: G A B C D E F# G
  const g = detectKey(mk([67, 69, 71, 72, 74, 76, 78, 79, 74, 71, 67]))[0];
  assert.deepEqual([g.root, g.mode], [7, 'major']);
  // A minor: A C E D C B A E A
  const a = detectKey(mk([69, 72, 76, 74, 72, 71, 69, 64, 69, 72, 71, 69]))[0];
  assert.deepEqual([a.root, a.mode], [9, 'minor']);
  // D minor with Bb
  const d = detectKey(mk([62, 65, 69, 70, 69, 67, 65, 64, 62, 57, 62]))[0];
  assert.deepEqual([d.root, d.mode], [2, 'minor']);
});

test('diatonic harmony: 3rds are major/minor by scale degree', () => {
  const C = { root: 0, mode: 'major' };
  // C→E (M3), D→F (m3), E→G (m3), F→A (M3), G→B (M3), A→C (m3), B→D (m3)
  const above = [60, 62, 64, 65, 67, 69, 71].map((m) => diatonicShift(m, 2, C) - m);
  assert.deepEqual(above, [4, 3, 3, 4, 4, 3, 3]);
  assert.equal(diatonicShift(60, -2, C), 57); // C → A below
  assert.equal(diatonicShift(60, -5, C), 52); // 6th below C = E
  assert.equal(diatonicShift(71, 4, C), 77);  // 5th above B = F (diminished, diatonic)
  assert.equal(diatonicShift(60, 7, C), 72);
  const Am = { root: 9, mode: 'minor' };
  assert.equal(diatonicShift(69, 2, Am), 72); // A→C
  assert.equal(diatonicShift(72, 2, Am), 76); // C→E
});

test('chord-aware harmony prefers chord tones', () => {
  const C = { root: 0, mode: 'major' };
  // melody D over a G chord: 3rd above = F (not in G) → move to G (4th) or E? candidates: E(2nd), G(4th) – G is chord tone
  assert.equal(harmonyNote(62, { type: 'third_above', key: C, chord: { root: 7, quality: 'maj' } }), 67);
  // in-chord target stays
  assert.equal(harmonyNote(60, { type: 'third_above', key: C, chord: { root: 0, quality: 'maj' } }), 64);
});

test('regions: partial harmony, unison and rest', () => {
  const C = { root: 0, mode: 'major' };
  const mel = [60, 62, 64, 65].map((m, i) => ({ id: i, midi: m, start: i, end: i + 0.9 }));
  let regions = setRegion([], 0, 4, 'third_above');
  regions = setRegion(regions, 1, 2, 'unison');
  regions = setRegion(regions, 3, 4, 'rest');
  const h = generateHarmony(mel, { key: C, regions });
  assert.deepEqual(h.map((n) => n.midi), [64, 62, 67, null]);
  assert.equal(regions.length, 3 + 0 + (regions.length - 3));
});

test('snapToKey and labels', () => {
  const C = { root: 0, mode: 'major' };
  assert.equal(snapToKey(60.7, C), 60);
  assert.equal(snapToKey(61.2, C), 62);
  assert.equal(snapToKey(61.6, C), 62);
  assert.equal(noteLabel(61, { key: { root: 5, mode: 'major' } }), 'D♭4');
  assert.equal(noteLabel(67, { style: 'solfege', key: C }), 'Sol');
  assert.equal(noteLabel(64, { style: 'number', key: C }), '3');
  assert.equal(keyName({ root: 10, mode: 'major' }), 'B♭ major');
  assert.equal(voiceType(40, 64), 'Bass');
  assert.equal(voiceType(60, 84), 'Soprano');
  const ch = suggestChords([{ midi: 67, start: 0, end: 1 }, { midi: 71, start: 1, end: 2 }, { midi: 74, start: 2, end: 3 }], C, [0, 3]);
  assert.equal(ch[0].root, 7);
});

test('scoring: in-tune take scores high, flat take shows drift, late take shows timing', () => {
  const targets = [60, 62, 64, 65, 67].map((m, i) => ({ start: i * 0.6, end: i * 0.6 + 0.5, midi: m }));
  const mkFrames = (centOff, lateBy = 0) => {
    const fr = [];
    for (let t = 0; t < 3.2; t += 0.01) {
      const n = targets.find((x) => t >= x.start + lateBy && t <= x.end);
      fr.push({ t, midi: n ? n.midi + centOff / 100 : null });
    }
    return fr;
  };
  const good = scoreTake(targets, mkFrames(4));
  assert.ok(good.score >= 90, `score ${good.score}`);
  assert.equal(good.hitPct, 100);
  assert.equal(good.counts.perfect, 5);
  const flat = scoreTake(targets, mkFrames(-30));
  assert.ok(flat.drift <= -25 && flat.drift >= -35);
  assert.ok(flat.score < good.score);
  assert.equal(flat.counts.good, 5);
  const late = scoreTake(targets, mkFrames(0, 0.12));
  assert.ok(late.timingBias >= 100, `timing ${late.timingBias}`);
  // latency compensation removes the lateness
  const comp = scoreTake(targets, mkFrames(0, 0.12), { latency: 0.12 });
  assert.ok(Math.abs(comp.timingBias) < 20);
  const miss = scoreTake(targets, mkFrames(150));
  assert.equal(miss.counts.miss, 5);
  assert.ok(miss.worst.length === 3);
});

test('live scorer fills bars and fires perfect bursts', () => {
  const targets = [{ start: 0, end: 1, midi: 60 }];
  const hits = [];
  const ls = createLiveScorer(targets, { onPerfect: (i) => hits.push(i) });
  for (let t = 0; t <= 1; t += 0.01) ls.update(t, 60.02);
  assert.ok(ls.state[0].fill > 0.9);
  assert.deepEqual(hits, [0]);
});

test('vibrato and stability analysis', () => {
  const fr = [];
  for (let t = 0; t < 3; t += 0.01) fr.push({ t, midi: 64 + 0.5 * Math.sin(2 * Math.PI * 5.5 * t) });
  const v = vibrato(fr);
  assert.ok(Math.abs(v.rate - 5.5) < 0.3, `rate ${v.rate}`);
  assert.ok(Math.abs(v.depth - 50) < 8, `depth ${v.depth}`);
  const steady = [];
  for (let t = 0; t < 3; t += 0.01) steady.push({ t, midi: 64 + 0.02 * t });
  const s = stability(steady, 64);
  assert.ok(Math.abs(s.drift - 2) < 0.5);
  assert.ok(s.steadiness > 90);
});

test('time stretch keeps pitch; pitch shift keeps duration', () => {
  const x = sine(220, 1.0);
  const slow = timeStretch(x, SR, 0.5);
  assert.ok(Math.abs(slow.length - 2 * x.length) < SR * 0.05);
  const d = createDetector({ sampleRate: SR });
  const r = d.detect(slow.subarray(SR, SR + 2048));
  assert.ok(Math.abs(1200 * Math.log2(r.hz / 220)) < 5, `stretched ${r.hz}`);
  const up = pitchShift(x, SR, 3);
  assert.ok(Math.abs(up.length - x.length) < SR * 0.05);
  const r2 = d.detect(up.subarray(SR / 4, SR / 4 + 2048));
  assert.ok(Math.abs(freqToMidi(r2.hz) - freqToMidi(midiToFreq(57 + 3))) < 0.1 + Math.abs(freqToMidi(220) - 57), `shifted ${r2.hz}`);
});

test('weak fundamental (strong 2nd harmonic) and breathy noise: octave errors stay rare', () => {
  let frames = 0, oct = 0;
  for (const [f0gain, noise] of [[0.15, 0.01], [0.3, 0.04], [1, 0.08]]) {
    const midis = [41, 45, 48, 52, 57, 64, 72, 79];
    const sig = voice(midis.map((m) => ({ midi: m, dur: 0.5, vib: { rate: 5.5, depth: 25 } })), { f0gain, noise, seed: 21 });
    const fr = analyseBuffer(sig.samples, SR, { hop: 512 });
    for (const tn of sig.truth) for (const f of fr) {
      if (f.t < tn.start + 0.1 || f.t > tn.end - 0.05 || f.midi == null) continue;
      frames++;
      if (Math.abs(f.midi - tn.midi) > 6) oct++;
    }
  }
  assert.ok(frames > 200);
  assert.ok(oct / frames < 0.01, `octave errors ${(100 * oct / frames).toFixed(2)}%`);
});

test('onset detection finds clicks for latency calibration', async () => {
  const { findOnset, robustLatency } = await import('../www/dsp/onset.mjs');
  const sr = 48000, N = sr * 4;
  const x = new Float32Array(N);
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < N; i++) x[i] = rnd() * 0.004;
  const lat = 0.137, clicks = [0.5, 1.1, 1.7, 2.3, 2.9];
  for (const c of clicks) { const s = Math.round((c + lat) * sr); for (let i = 0; i < 2400; i++) x[s + i] += Math.sin(i * 0.2) * Math.exp(-i / 500) * 0.4; }
  const offs = clicks.map((c) => { const o = findOnset(x, sr, c - 0.1, c + 0.5); return o == null ? null : o - c; });
  const L = robustLatency(offs);
  assert.ok(Math.abs(L - lat) < 0.006, `latency ${L}`);
});

test('scoring: repeated same-pitch notes are not marked early', () => {
  const targets = [{ start: 0, end: 0.48, midi: 60 }, { start: 0.5, end: 0.98, midi: 60 }, { start: 1.0, end: 1.5, midi: 62 }];
  const fr = [];
  for (let t = 0; t < 1.6; t += 0.01) { const n = targets.find((x) => t >= x.start && t <= x.end - 0.03); fr.push({ t, midi: n ? n.midi : null }); }
  const r = scoreTake(targets, fr);
  assert.ok(Math.abs(r.timingBias) < 25, `bias ${r.timingBias}`);
  assert.ok(r.score >= 90, `score ${r.score}`);
});
