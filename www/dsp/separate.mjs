// Source separation helpers (pure): STFT/iSTFT, Fast centre-channel vocal extraction,
// and Spleeter (2-stem vocals) pre/post-processing. Model inference lives in a worker.
import { makeFFT } from './pitch.mjs';

export const SPLEETER = { sr: 44100, nfft: 4096, hop: 1024, bins: 1024, split: 512 };

function hann(n) { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); return w; }

/** STFT (no centering) → {re, im: Float32Array[frames*keep], frames, keep} keeping the first `keep` bins */
export function stft(x, { nfft = 4096, hop = 1024, keep = nfft / 2 + 1 } = {}) {
  const fft = makeFFT(nfft);
  const w = hann(nfft);
  const frames = Math.max(1, Math.floor((x.length - nfft) / hop) + 1);
  const re = new Float32Array(frames * keep), im = new Float32Array(frames * keep);
  const R = new Float64Array(nfft), I = new Float64Array(nfft);
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    for (let i = 0; i < nfft; i++) { R[i] = (x[o + i] || 0) * w[i]; I[i] = 0; }
    fft(R, I, false);
    for (let k = 0; k < keep; k++) { re[f * keep + k] = R[k]; im[f * keep + k] = I[k]; }
  }
  return { re, im, frames, keep, nfft, hop };
}

/** inverse of stft with weighted overlap-add; bins above `keep` are treated as zero */
export function istft({ re, im, frames, keep, nfft, hop }, length) {
  const fft = makeFFT(nfft);
  const w = hann(nfft);
  const out = new Float32Array(length || (frames - 1) * hop + nfft);
  const norm = new Float32Array(out.length);
  const R = new Float64Array(nfft), I = new Float64Array(nfft);
  for (let f = 0; f < frames; f++) {
    R.fill(0); I.fill(0);
    for (let k = 0; k < keep && k <= nfft / 2; k++) {
      R[k] = re[f * keep + k]; I[k] = im[f * keep + k];
      if (k > 0 && k < nfft / 2) { R[nfft - k] = R[k]; I[nfft - k] = -I[k]; }
    }
    fft(R, I, true);
    const o = f * hop;
    for (let i = 0; i < nfft && o + i < out.length; i++) { out[o + i] += (R[i] / nfft) * w[i]; norm[o + i] += w[i] * w[i]; }
  }
  for (let i = 0; i < out.length; i++) if (norm[i] > 1e-6) out[i] /= norm[i];
  return out;
}

/** linear resample to a target rate */
export function resampleTo(x, from, to) {
  if (from === to) return x;
  const n = Math.floor((x.length * to) / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const p = i * r, a = Math.floor(p), f = p - a; out[i] = (x[a] || 0) * (1 - f) + (x[a + 1] || 0) * f; }
  return out;
}

/**
 * Fast mode: centre-panned, band-limited, harmonic-emphasis vocal estimate.
 * L, R: Float32Array (R may equal L for mono). Returns {vocals, backing} at the input rate.
 */
export function fastSeparate(L, R, sr, onProgress) {
  const nfft = 2048, hop = 512;
  const SL = stft(L, { nfft, hop }), SR = R === L ? SL : stft(R, { nfft, hop });
  const keep = SL.keep, frames = SL.frames;
  const vre = new Float32Array(SL.re.length), vim = new Float32Array(SL.im.length);
  const loBin = Math.floor((90 / sr) * nfft), hiBin = Math.ceil((6000 / sr) * nfft);
  // harmonic emphasis: temporal median of magnitude (sustained partials) vs spectral median (percussive)
  const mag = new Float32Array(frames * keep);
  for (let i = 0; i < mag.length; i++) {
    const mr = (SL.re[i] + SR.re[i]) * 0.5, mi = (SL.im[i] + SR.im[i]) * 0.5;
    mag[i] = Math.hypot(mr, mi);
  }
  const H = 8; // frames each side for the time median
  const tmp = new Float32Array(2 * H + 1);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < keep; k++) {
      const i = f * keep + k;
      if (k < loBin || k > hiBin) continue;
      const lr = Math.hypot(SL.re[i], SL.im[i]), rr = Math.hypot(SR.re[i], SR.im[i]);
      const dr = Math.hypot(SL.re[i] - SR.re[i], SL.im[i] - SR.im[i]);
      const centre = R === L ? 1 : Math.max(0, 1 - dr / (lr + rr + 1e-9));
      let n = 0;
      for (let d = -H; d <= H; d++) { const ff = f + d; if (ff >= 0 && ff < frames) tmp[n++] = mag[ff * keep + k]; }
      const t = tmp.subarray(0, n).sort()[n >> 1];
      const sp = [mag[i - 2] || 0, mag[i - 1] || 0, mag[i], mag[i + 1] || 0, mag[i + 2] || 0].sort((a, b) => a - b)[2];
      const harm = (t * t) / (t * t + sp * sp + 1e-12);
      const m = Math.pow(centre, 3) * harm;
      vre[i] = (SL.re[i] + SR.re[i]) * 0.5 * m;
      vim[i] = (SL.im[i] + SR.im[i]) * 0.5 * m;
    }
    if (onProgress && f % 200 === 0) onProgress(f / frames);
  }
  const vocals = istft({ re: vre, im: vim, frames, keep, nfft, hop }, L.length);
  const backing = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) backing[i] = 0.5 * (L[i] + R[i]) - vocals[i];
  return { vocals, backing };
}

/** Build the Spleeter input for one split: Float32Array [2, 1, 512, 1024] of magnitudes */
export function spleeterInput(SL, SR, split) {
  const { bins, split: S } = SPLEETER;
  const x = new Float32Array(2 * S * bins);
  for (let c = 0; c < 2; c++) {
    const st = c ? SR : SL;
    for (let f = 0; f < S; f++) {
      const ff = split * S + f;
      if (ff >= st.frames) break;
      for (let k = 0; k < bins; k++) {
        const i = ff * st.keep + k;
        x[c * S * bins + f * bins + k] = Math.hypot(st.re[i], st.im[i]);
      }
    }
  }
  return x;
}

/**
 * Apply the vocal estimate y (same shape as x) as a soft ratio mask to the complex STFTs in place.
 * Accompaniment magnitude is approximated as max(|X| - y, 0) (we only ship the vocal model).
 */
export function applySpleeterMask(SL, SR, split, x, y, out) {
  const { bins, split: S } = SPLEETER;
  for (let c = 0; c < 2; c++) {
    const st = c ? SR : SL, o = out[c];
    for (let f = 0; f < S; f++) {
      const ff = split * S + f;
      if (ff >= st.frames) break;
      for (let k = 0; k < bins; k++) {
        const j = c * S * bins + f * bins + k;
        const v = Math.max(0, y[j]), a = Math.max(0, x[j] - v);
        const m = (v * v + 5e-11) / (v * v + a * a + 1e-10);
        const i = ff * st.keep + k;
        o.re[i] = st.re[i] * m; o.im[i] = st.im[i] * m;
      }
    }
  }
}
