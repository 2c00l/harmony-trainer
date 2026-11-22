import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { dropOutliers } = await import('../www/core/project.mjs');

test('a short stray note far from the melody is removed (no whistle)', () => {
  const mel = [60, 62, 64, 65, 67, 65, 64, 62].map((m, i) => ({ start: i * 0.5, end: i * 0.5 + 0.45, midiRaw: m }));
  const stray = { start: 2.1, end: 2.3, midiRaw: 84 };
  const out = dropOutliers([...mel, stray].sort((a, b) => a.start - b.start));
  assert.equal(out.length, mel.length);
  assert.ok(!out.includes(stray));
  // a real leap of an octave within a phrase, held, stays
  const leap = { start: 4.1, end: 5.3, midiRaw: 72 };
  assert.ok(dropOutliers([...mel, leap]).includes(leap));
});
