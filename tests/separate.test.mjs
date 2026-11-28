import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { stft, istft, fastSeparate, SPLEETER, spleeterInput, applySpleeterMask, resampleTo, separateInChunks } from '../www/dsp/separate.mjs';
import { analyseBuffer } from '../www/dsp/pitch.mjs';
import { segmentNotes } from '../www/dsp/segment.mjs';
import { voice, mulberry } from './synth.mjs';

const SR = 44100;
function song() {
  const mel = [64, 67, 69, 67, 64, 62, 60, 62, 64, 64, 62, 60].map((m) => ({ midi: m, dur: 0.55, vib: { rate: 5.5, depth: 25 } }));
  const v = voice(mel, { sr: SR, seed: 4, noise: 0 });
  const n = v.samples.length;
  const L = new Float32Array(n), R = new Float32Array(n);
  const rnd = mulberry(8);
  const chords = [[48, 55, 64], [53, 57, 60], [55, 59, 62], [48, 52, 55]];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ch = chords[Math.floor(t / 1.65) % 4];
    let a = 0, b = 0;
    for (let j = 0; j < 3; j++) {
      const f = 440 * Math.pow(2, (ch[j] - 69) / 12);
      const ph = (t * f) % 1;
      const saw = (2 * ph - 1) * 0.09;
      if (j === 0) { a += saw * 1.0; b += saw * 0.3; } else if (j === 1) { a += saw * 0.3; b += saw; } else { a += saw * 0.6; b += saw * 0.6; }
    }
    const beat = t % 0.4 < 0.03 ? (rnd() - 0.5) * 0.6 * (1 - (t % 0.4) / 0.03) : 0;
    L[i] = v.samples[i] * 0.8 + a + beat; R[i] = v.samples[i] * 0.8 + b + beat;
  }
  return { L, R, truth: v.truth };
}
function accuracy(samples, truth) {
  const fr = analyseBuffer(samples, SR, { hop: 441 });
  let ok = 0, tot = 0;
  for (const tn of truth) for (const f of fr) { if (f.t < tn.start + 0.1 || f.t > tn.end - 0.05) continue; tot++; if (f.midi != null && Math.abs(f.midi - tn.midi) < 0.5) ok++; }
  return ok / tot;
}

test('STFT/iSTFT round trip is near-perfect', () => {
  const x = new Float32Array(SR); for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 0.05) * 0.5 + Math.sin(i * 0.31) * 0.2;
  const y = istft(stft(x, { nfft: 4096, hop: 1024 }), x.length);
  let err = 0; for (let i = 5000; i < x.length - 5000; i++) err = Math.max(err, Math.abs(x[i] - y[i]));
  assert.ok(err < 1e-3, `err ${err}`);
});

test('fast separation recovers the centred melody better than the mix', () => {
  const { L, R, truth } = song();
  const mix = L.map((v, i) => 0.5 * (v + R[i]));
  const before = accuracy(mix, truth);
  const { vocals } = fastSeparate(L, R, SR);
  const after = accuracy(vocals, truth);
  console.log(`  pitch accuracy mix ${(before * 100).toFixed(1)}% → fast ${(after * 100).toFixed(1)}%`);
  assert.ok(after > 0.85, `after ${after}`);
  assert.ok(after >= before);
});

test('chunked separation has no split-boundary clicks, retains the tail, and preserves stereo mix', async () => {
  const sr = 48000, length = sr*25+197;
  const L = new Float32Array(length), R = new Float32Array(length);
  for (let i = 0; i < length; i++) { L[i] = .2*Math.sin(2*Math.PI*220*i/sr); R[i] = .3*Math.sin(2*Math.PI*440*i/sr); }
  let calls = 0;
  const out = await separateInChunks(L,R,sr,async x => { calls++; assert.equal(x.length,2*512*1024); return x; });
  assert.ok(calls >= 3);
  assert.equal(out.vocals.length,length); assert.equal(out.backing.length,length);
  let worst = 0;
  // Includes both split joins and the formerly dropped final partial window.
  for (let i = 5000; i < length-100; i++) {
    const mix = .5*(L[i]+R[i]);
    worst = Math.max(worst,Math.abs(out.vocals[i]-mix));
    assert.ok(Math.abs(out.vocals[i]+out.backing[i]-mix) < 1e-6);
  }
  assert.ok(worst < .002,`reconstruction error ${worst}`);
});

const MODEL = 'www/models/vocals.fp16.onnx';
test('quality (Spleeter ONNX) separation runs and recovers the melody', { skip: !existsSync(MODEL) }, async () => {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(readFileSync(MODEL));
  const { L, R, truth } = song();
  const S = SPLEETER;
  const SL = stft(L, { nfft: S.nfft, hop: S.hop }), SRr = stft(R, { nfft: S.nfft, hop: S.hop });
  const outL = { re: new Float32Array(SL.re.length), im: new Float32Array(SL.im.length) }, outR = { re: new Float32Array(SRr.re.length), im: new Float32Array(SRr.im.length) };
  const t0 = Date.now();
  for (let s = 0; s < Math.ceil(SL.frames / S.split); s++) {
    const x = spleeterInput(SL, SRr, s);
    const input = new ort.Tensor('float32',x,[2,1,S.split,S.bins]);
    const res = await session.run({ x:input });
    try { applySpleeterMask(SL, SRr, s, x, res.y.data, [outL, outR]); }
    finally { input.dispose(); res.y.dispose(); }
  }
  const vl = istft({ ...SL, ...outL }, L.length), vr = istft({ ...SRr, ...outR }, R.length);
  const voc = vl.map((v, i) => 0.5 * (v + vr[i]));
  const acc = accuracy(voc, truth);
  console.log(`  spleeter: ${(acc * 100).toFixed(1)}% in ${Date.now() - t0} ms for ${(L.length / SR).toFixed(1)} s`);
  assert.ok(acc > 0.7, `acc ${acc}`);
  const chunked = await separateInChunks(L,R,SR,async x => {
    const input = new ort.Tensor('float32',x,[2,1,S.split,S.bins]);
    const output = await session.run({ x:input });
    const values = output.y.data.slice(); input.dispose(); output.y.dispose(); return values;
  });
  const chunkedAcc = accuracy(chunked.vocals,truth);
  assert.ok(chunkedAcc > .7 && chunkedAcc >= acc,`chunked pitch accuracy ${chunkedAcc} must not be lower than ${acc}`);
  await session.release();
  void resampleTo;
});
