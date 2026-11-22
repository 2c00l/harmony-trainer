import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, buildLesson, WARMUPS, warmupSteps, sirenCurve, adaptLevel, pitchMatchNote, pickInterval, fromDegrees } from '../www/core/exercises.mjs';
import { inKey } from '../www/dsp/theory.mjs';

for (const range of [{ lo: 40, hi: 62 }, { lo: 48, hi: 69 }, { lo: 57, hi: 81 }]) {
  test(`lessons fit range ${range.lo}-${range.hi} and stay diatonic`, () => {
    for (const l of LESSONS) {
      const b = buildLesson(l, range);
      assert.ok(b.target.length >= 4, l.id);
      const ms = b.target.map((n) => n.midi);
      assert.ok(Math.min(...ms) >= range.lo - 2 && Math.max(...ms) <= range.hi + 2, `${l.id}: ${Math.min(...ms)}-${Math.max(...ms)}`);
      for (const n of [...b.target, ...b.melody]) assert.ok(inKey(n.midi, b.key), `${l.id} note ${n.midi} not in key`);
      for (let i = 1; i < b.target.length; i++) assert.ok(b.target[i].start >= b.target[i - 1].start);
    }
  });
}

test('thirds lesson: every target is 3-4 semitones above the melody', () => {
  const b = buildLesson(LESSONS.find((l) => l.id === 'thirds'), { lo: 48, hi: 69 });
  b.target.forEach((t, i) => { const d = t.midi - b.melody[i].midi; assert.ok(d === 3 || d === 4, `diff ${d}`); });
});

test('partial lesson splits into unison and thirds', () => {
  const b = buildLesson(LESSONS.find((l) => l.id === 'partial'), { lo: 48, hi: 69 });
  const diffs = b.target.map((t, i) => t.midi - b.melody[i].midi);
  assert.equal(diffs[0], 0); assert.equal(diffs[diffs.length - 1], 0);
  assert.ok(diffs.some((d) => d === 3 || d === 4));
});

test('warm-ups stay in range and step by semitone', () => {
  const range = { lo: 48, hi: 69 };
  for (const w of WARMUPS.filter((x) => x.kind === 'steps')) {
    const { notes } = warmupSteps(w, range, 4);
    const ms = notes.map((n) => n.midi);
    assert.ok(Math.min(...ms) >= range.lo - 1 && Math.max(...ms) <= range.hi + 1, `${w.id} ${Math.min(...ms)}-${Math.max(...ms)}`);
    const per = w.seq.length;
    assert.equal(Math.abs(notes[per].midi - notes[0].midi), 1, w.id);
  }
  const c = sirenCurve(range);
  assert.ok(Math.max(...c.map((p) => p.midi)) <= range.hi && Math.min(...c.map((p) => p.midi)) >= range.lo);
});

test('adaptive difficulty and interval picking', () => {
  assert.equal(adaptLevel(1, [90, 85, 95]), 2);
  assert.equal(adaptLevel(3, [30, 20]), 2);
  assert.equal(adaptLevel(2, [70, 50, 90]), 2);
  let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 50; i++) { const m = pitchMatchNote(3, { lo: 50, hi: 70 }, 60, rnd); assert.ok(m >= 50 && m <= 70); }
  for (let i = 0; i < 50; i++) { const iv = pickInterval(1, rnd); assert.ok([12, 7, 4].includes(iv.semis)); }
  const { notes } = fromDegrees([[0, 1], [null, 1], [2, 1]], { tonic: 60, bpm: 60 });
  assert.equal(notes.length, 2); assert.equal(notes[1].midi, 64); assert.ok(Math.abs(notes[1].start - 2) < 1e-9);
});
