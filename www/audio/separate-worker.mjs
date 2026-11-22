// Worker: vocal separation off the main thread.
// msg {L, R, sr, model: ArrayBuffer} → posts {progress} … then {vocals, backing, sr}
import { stft, istft, resampleTo, SPLEETER, spleeterInput, applySpleeterMask } from '../dsp/separate.mjs';

self.onmessage = async (e) => {
  const { L, R, sr, model } = e.data;
  const progress = (k, label) => self.postMessage({ progress: k, label });
  try {
    const ort = await import('../vendor/ort/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    progress(0.02, 'Loading model…');
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const S = SPLEETER;
    const l = resampleTo(L, sr, S.sr), r = R === L ? l : resampleTo(R, sr, S.sr);
    progress(0.05, 'Analysing…');
    const SL = stft(l, { nfft: S.nfft, hop: S.hop }), SR = r === l ? SL : stft(r, { nfft: S.nfft, hop: S.hop });
    const splits = Math.ceil(SL.frames / S.split);
    const outL = { re: new Float32Array(SL.re.length), im: new Float32Array(SL.im.length) };
    const outR = SR === SL ? outL : { re: new Float32Array(SR.re.length), im: new Float32Array(SR.im.length) };
    for (let s = 0; s < splits; s++) {
      const x = spleeterInput(SL, SR, s);
      const res = await session.run({ x: new ort.Tensor('float32', x, [2, 1, S.split, S.bins]) });
      const y = res.y.data;
      applySpleeterMask(SL, SR, s, x, y, [outL, outR]);
      progress(0.08 + 0.85 * ((s + 1) / splits), `Separating vocals… ${s + 1}/${splits}`);
    }
    progress(0.95, 'Rebuilding audio…');
    const vl = istft({ ...SL, ...outL }, l.length);
    const vr = SR === SL ? vl : istft({ ...SR, ...outR }, r.length);
    const vocalsHi = new Float32Array(vl.length);
    for (let i = 0; i < vl.length; i++) vocalsHi[i] = 0.5 * (vl[i] + vr[i]);
    const vocals = resampleTo(vocalsHi, S.sr, sr);
    const backing = new Float32Array(Math.min(L.length, vocals.length));
    for (let i = 0; i < backing.length; i++) backing[i] = 0.5 * (L[i] + R[i]) - vocals[i];
    self.postMessage({ vocals, backing, sr }, [vocals.buffer, backing.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err?.message || err) });
  }
};
