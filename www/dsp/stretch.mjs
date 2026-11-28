// WSOLA time-stretch (tempo change without pitch change) and pitch shift via stretch+resample.

/** rate < 1 = slower. Returns new Float32Array of length ≈ input.length / rate */
export function timeStretch(input, sampleRate, rate) {
  if (!input || !input.length) return new Float32Array(0);
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
    if (nominal >= input.length) break;
    let best = nominal;
    if (k > 0) {
      // natural continuation of the previous frame; find the best-matching candidate:
      // a coarse search on a thinned signal, then a fine search around the winner
      const nat = prevIn + hopOut;
      const corr = (cand, di) => {
        let c = 0;
        for (let i = 0; i < hopOut; i += di) c += input[nat + i] * input[cand + i];
        return c;
      };
      const ok = (c) => c >= 0 && c + hopOut < input.length && nat + hopOut < input.length;
      let bestC = -Infinity;
      for (let d = -tol; d <= tol; d += 8) { const c0 = nominal + d; if (!ok(c0)) continue; const c = corr(c0, 16); if (c > bestC) { bestC = c; best = c0; } }
      const coarse = best; bestC = -Infinity;
      for (let d = -8; d <= 8; d++) { const c0 = coarse + d; if (!ok(c0)) continue; const c = corr(c0, 3); if (c > bestC) { bestC = c; best = c0; } }
    }
    for (let i = 0; i < win; i++) {
      const o = outPos + i;
      if (o >= outLen) break;
      out[o] += (input[best + i] || 0) * w[i];
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
