// WSOLA time-stretch (tempo change without pitch change) and pitch shift via stretch+resample.

/** rate < 1 = slower. Returns new Float32Array of length ≈ input.length / rate */
export function timeStretch(input, sampleRate, rate) {
  if (Math.abs(rate - 1) < 1e-3) return input.slice();
  const win = Math.round(sampleRate * 0.04);       // 40 ms
  const hopOut = win >> 1;
  const hopIn = hopOut * rate;
  const tol = Math.round(sampleRate * 0.012);      // ±12 ms search
  const outLen = Math.floor(input.length / rate) + win;
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const w = new Float32Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  let prevIn = 0; // where the previous frame came from
  let outPos = 0;
  for (let k = 0; ; k++) {
    const nominal = Math.round(k * hopIn);
    if (nominal + win + tol >= input.length) break;
    let best = nominal;
    if (k > 0) {
      // natural continuation of previous frame
      const nat = prevIn + hopOut;
      let bestC = -Infinity;
      const step = 2;
      for (let d = -tol; d <= tol; d += step) {
        const cand = nominal + d;
        if (cand < 0 || cand + hopOut >= input.length) continue;
        let c = 0;
        for (let i = 0; i < hopOut; i += 4) c += input[nat + i] * input[cand + i];
        if (c > bestC) { bestC = c; best = cand; }
      }
    }
    for (let i = 0; i < win; i++) {
      const o = outPos + i;
      if (o >= outLen) break;
      out[o] += input[best + i] * w[i];
      norm[o] += w[i];
    }
    prevIn = best;
    outPos += hopOut;
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) out[i] /= norm[i];
  return out.subarray(0, Math.min(outLen, Math.floor(input.length / rate)));
}

/** linear-interp resample by factor (output length = input.length / factor) */
export function resample(input, factor) {
  const n = Math.floor(input.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * factor, i0 = Math.floor(x), fr = x - i0;
    const a = input[i0] || 0, b = input[i0 + 1] || 0;
    out[i] = a + (b - a) * fr;
  }
  return out;
}

/** shift pitch by semitones keeping duration, optionally with a tempo rate */
export function pitchShift(input, sampleRate, semis, rate = 1) {
  const f = Math.pow(2, semis / 12);
  if (Math.abs(semis) < 0.01) return timeStretch(input, sampleRate, rate);
  // stretch longer by f then resample by f → same duration, pitch * f
  const st = timeStretch(input, sampleRate, rate / f);
  return resample(st, f);
}
