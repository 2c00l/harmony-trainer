// Writes a synthetic sung melody WAV used as a fake microphone in browser tests.
import { writeFileSync, mkdirSync } from 'node:fs';
import { voice } from './synth.mjs';
export function wav(samples, sr) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}
if (process.argv[1] && process.argv[1].endsWith("make-wav.mjs")) {
  mkdirSync('artifacts', { recursive: true });
  const mel = [64, 62, 60, 62, 64, 64, 64, 62, 62, 64, 67, 67, 64, 62, 60, 62, 64, 64, 64, 64, 62, 62, 64, 62, 60];
  const notes = mel.map((m, i) => ({ midi: m, dur: i % 7 === 6 ? 0.8 : 0.42, vib: i % 7 === 6 ? { rate: 5.5, depth: 35 } : null, scoop: i % 5 === 0 ? 1 : 0, gap: 0.06 }));
  const { samples } = voice([{ midi: 60, dur: 0.01, gap: 1.0 }, ...notes, ...notes], { sr: 48000, seed: 9 });
  writeFileSync('artifacts/fake-voice.wav', wav(samples, 48000));
  console.log('artifacts/fake-voice.wav', (samples.length / 48000).toFixed(1) + 's');
}
