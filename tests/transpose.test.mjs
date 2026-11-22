import test from 'node:test';
import assert from 'node:assert/strict';
import { pitchShift } from '../www/dsp/stretch.mjs';
import { createDetector } from '../www/dsp/pitch.mjs';
import { voice, sine } from './synth.mjs';

const SR = 48000;
const cents = (a, b) => 1200 * Math.log2(a / b);

test('transpose moves the pitch by the right amount and keeps the length', () => {
  const d = createDetector({ sampleRate: SR });
  for (const semis of [-5, -2, 1, 3, 7]) {
    const x = sine(220, 1.5);
    const y = pitchShift(x, SR, semis);
    assert.ok(Math.abs(y.length - x.length) < SR * 0.05, `length ${semis}`);
    const r = d.detect(y.subarray(SR / 2, SR / 2 + 2048));
    const want = 220 * 2 ** (semis / 12);
    assert.ok(Math.abs(cents(r.hz, want)) < 8, `${semis}: got ${r.hz} want ${want}`);
  }
});

test('transpose a sung phrase: notes stay in time', () => {
  const { samples: x, truth } = voice([{ midi: 57, dur: 0.5 }, { midi: 60, dur: 0.5 }, { midi: 64, dur: 0.5 }]);
  const y = pitchShift(x, SR, 2);
  const d = createDetector({ sampleRate: SR });
  const at = (t) => d.detect(y.subarray(Math.round(t * SR), Math.round(t * SR) + 2048)).hz;
  for (const n of truth) {
    const mid = (n.start + n.end) / 2 - 0.02;
    assert.ok(Math.abs(cents(at(mid), 440 * 2 ** ((n.midi + 2 - 69) / 12))) < 20, `note ${n.midi}`);
  }
});

test('a 3-minute vocal transposes in reasonable time', () => {
  const x = sine(220, 180);
  const t0 = performance.now();
  pitchShift(x, SR, 3);
  const ms = performance.now() - t0;
  console.log(`3 min at 48 kHz: ${Math.round(ms)} ms`);
  assert.ok(ms < 20000);
});
