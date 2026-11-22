// Pitch detection: McLeod Pitch Method (NSDF) computed via FFT autocorrelation,
// with octave-error correction, confidence gating and a hysteresis tracker.
// Pure module, no DOM; runs in the browser and in node tests.

export const A4_DEFAULT = 440;
export const freqToMidi = (f, a4 = A4_DEFAULT) => 69 + 12 * Math.log2(f / a4);
export const midiToFreq = (m, a4 = A4_DEFAULT) => a4 * Math.pow(2, (m - 69) / 12);

// ---- radix-2 in-place complex FFT ----
export function makeFFT(n) {
  const rev = new Uint32Array(n);
  const bits = Math.log2(n) | 0;
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
  return function fft(re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    const sgn = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step], wi = sgn * sin[k * step];
          const a = start + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  };
}

/**
 * Create a stateless-per-frame detector for a fixed window size.
 * detect(buf) → { hz, clarity, rms } with hz = 0 when unvoiced.
 */
export function createDetector({ sampleRate, windowSize = 2048, minHz = 60, maxHz = 1500, clarityThreshold = 0.6, rmsGate = 0.004, octaveCorrection = true, k = 0.88 } = {}) {
  const n = windowSize;
  let fftN = 1; while (fftN < 2 * n) fftN <<= 1;
  const fft = makeFFT(fftN);
  const re = new Float64Array(fftN), im = new Float64Array(fftN);
  const nsdf = new Float64Array(n);
  const sq = new Float64Array(n + 1);
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / minHz) + 2);
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz) - 1);

  function detect(buf, opts = {}) {
    const thr = opts.clarityThreshold ?? clarityThreshold;
    const gate = opts.rmsGate ?? rmsGate;
    let rmsAcc = 0, mean = 0;
    for (let i = 0; i < n; i++) mean += buf[i];
    mean /= n;
    for (let i = 0; i < n; i++) { const v = buf[i] - mean; re[i] = v; im[i] = 0; rmsAcc += v * v; }
    const rms = Math.sqrt(rmsAcc / n);
    if (rms < gate) return { hz: 0, clarity: 0, rms };
    for (let i = n; i < fftN; i++) { re[i] = 0; im[i] = 0; }
    fft(re, im, false);
    for (let i = 0; i < fftN; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft(re, im, true); // re[tau]*fftN = autocorrelation r(tau)
    // m(tau) = sum_{j=0}^{n-1-tau} x_j^2 + x_{j+tau}^2, computed via prefix sums
    sq[0] = 0;
    for (let i = 0; i < n; i++) { const v = buf[i] - mean; sq[i + 1] = sq[i] + v * v; }
    const total = sq[n];
    for (let tau = 0; tau < maxLag; tau++) {
      const m = (sq[n - tau]) + (total - sq[tau]);
      nsdf[tau] = m > 0 ? (2 * re[tau] / fftN) / m : 0;
    }
    // key maxima between positive-going and negative-going zero crossings
    const peaksPos = [], peaksVal = [];
    let tau = 1;
    while (tau < maxLag && nsdf[tau] > 0) tau++;
    while (tau < maxLag) {
      while (tau < maxLag && nsdf[tau] <= 0) tau++;
      let best = -1, bestPos = -1;
      while (tau < maxLag && nsdf[tau] > 0) {
        if (nsdf[tau] > best) { best = nsdf[tau]; bestPos = tau; }
        tau++;
      }
      if (bestPos > 0 && bestPos >= minLag && bestPos < maxLag - 1) { peaksPos.push(bestPos); peaksVal.push(best); }
    }
    if (!peaksPos.length) return { hz: 0, clarity: 0, rms };
    let gmax = 0;
    for (const v of peaksVal) if (v > gmax) gmax = v;
    let idx = 0;
    for (let i = 0; i < peaksVal.length; i++) if (peaksVal[i] >= k * gmax) { idx = i; break; }
    let [lag, clar] = interp(peaksPos[idx]);
    // Octave correction 1: if a peak at ~2x this lag is clearly stronger (sub-octave
    // is the true period, e.g. strong 2nd harmonic in low male voices), prefer it.
    if (octaveCorrection) {
      for (let i = idx + 1; i < peaksPos.length; i++) {
        const ratio = peaksPos[i] / peaksPos[idx];
        if (Math.abs(ratio - 2) < 0.06 && peaksVal[i] > peaksVal[idx] + 0.025) {
          [lag, clar] = interp(peaksPos[i]);
          break;
        }
      }
    }
    if (clar < thr) return { hz: 0, clarity: clar, rms };
    const hz = sampleRate / lag;
    if (hz < minHz || hz > maxHz) return { hz: 0, clarity: clar, rms };
    return { hz, clarity: Math.min(1, clar), rms };
  }

  function interp(p) {
    const a = nsdf[p - 1], b = nsdf[p], c = nsdf[p + 1];
    const d = a - 2 * b + c;
    if (d === 0) return [p, b];
    const shift = 0.5 * (a - c) / d;
    if (Math.abs(shift) >= 1) return [p, b];
    return [p + shift, b - 0.25 * (a - c) * shift];
  }

  return { detect, windowSize: n, sampleRate };
}

/**
 * Pitch tracker: smooths a stream of raw detections, rejects isolated octave
 * jumps (needs `jumpFrames` consecutive confirmations) and fills tiny dropouts.
 * push({hz, clarity, rms}) → { midi (float) | null, hz, clarity, voiced }
 */
// Live use passes jumpConfirm/onsetConfirm: a big non-octave leap must hold steady for
// `jumpConfirm` frames before the line follows it, and a note starting from silence must
// hold for `onsetConfirm` frames. This removes the brief spikes (breaths, consonants,
// harmonics) that made the live view swoop up and down.
export function createTracker({ a4 = A4_DEFAULT, smoothing = 0.35, jumpFrames = 3, holdFrames = 2, medianSize = 5, jumpConfirm = 0, onsetConfirm = 0 } = {}) {
  let leap = null, leapCount = 0, onset = [];
  let cur = null;        // current smoothed midi
  let pendingMidi = null, pendingCount = 0;
  let missing = 0;
  const hist = [];
  function reset() { cur = null; pendingMidi = null; pendingCount = 0; missing = 0; hist.length = 0; leap = null; leapCount = 0; onset = []; }
  function push(d, opts = {}) {
    const alpha = 1 - (opts.smoothing ?? smoothing);
    if (!d || !(d.hz > 0)) {
      missing++;
      onset = []; leap = null; leapCount = 0;
      if (missing > holdFrames) { cur = null; hist.length = 0; pendingMidi = null; pendingCount = 0; }
      return { midi: missing <= holdFrames ? cur : null, hz: 0, clarity: d ? d.clarity : 0, voiced: false };
    }
    missing = 0;
    let m = freqToMidi(d.hz, a4);
    if (cur == null && onsetConfirm > 1) {
      // from silence: wait until a few frames agree before drawing anything
      if (onset.length && Math.abs(m - onset[onset.length - 1]) > 1) onset = [];
      onset.push(m);
      if (onset.length < onsetConfirm) return { midi: null, hz: d.hz, clarity: d.clarity, voiced: false };
      onset = [];
    }
    if (cur != null && jumpConfirm > 1) {
      const diff = m - cur, oct = Math.round(diff / 12);
      const isOctave = oct !== 0 && Math.abs(diff - oct * 12) < 1.2;
      if (Math.abs(diff) > 2.5 && !isOctave) {
        if (leap != null && Math.abs(m - leap) < 1) leapCount++; else { leap = m; leapCount = 1; }
        if (leapCount < jumpConfirm) return { midi: cur, hz: d.hz, clarity: d.clarity, voiced: true };
        leap = null; leapCount = 0; hist.length = 0; cur = m;
      } else { leap = null; leapCount = 0; }
    }
    if (cur != null) {
      // treat a ±12 (or ±19/24) jump as suspicious: snap to the octave nearest to cur unless sustained
      const diff = m - cur;
      const oct = Math.round(diff / 12);
      if (oct !== 0 && Math.abs(diff - oct * 12) < 1.2) {
        const folded = m - oct * 12;
        if (pendingMidi != null && Math.abs(m - pendingMidi) < 1.5) pendingCount++; else { pendingMidi = m; pendingCount = 1; }
        if (pendingCount < jumpFrames) m = folded;
        else { pendingMidi = null; pendingCount = 0; hist.length = 0; cur = m; }
      } else { pendingMidi = null; pendingCount = 0; }
    }
    hist.push(m); if (hist.length > medianSize) hist.shift();
    const sorted = hist.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    // median kills spikes; EMA keeps it silky. Big real moves (>1.5 st) pass quickly.
    const target = Math.abs(m - med) > 1.5 ? m : (med * 0.5 + m * 0.5);
    if (cur == null || Math.abs(target - cur) > 2) cur = target; else cur = cur + alpha * (target - cur);
    return { midi: cur, hz: d.hz, clarity: d.clarity, voiced: true };
  }
  return { push, reset };
}

/**
 * Offline analysis of a whole mono buffer → frames [{t, midi|null, clarity, rms}]
 */
export function analyseBuffer(samples, sampleRate, { hop = 256, windowSize, minHz = 60, maxHz = 1500, clarityThreshold = 0.6, a4 = A4_DEFAULT } = {}) {
  const win = windowSize || (sampleRate > 30000 ? 2048 : 1024);
  const det = createDetector({ sampleRate, windowSize: win, minHz, maxHz, clarityThreshold });
  const tr = createTracker({ a4, smoothing: 0.15 });
  const frames = [];
  const buf = new Float32Array(win);
  for (let start = 0; start + win <= samples.length; start += hop) {
    for (let i = 0; i < win; i++) buf[i] = samples[start + i];
    const d = det.detect(buf);
    const r = tr.push(d);
    frames.push({ t: (start + win / 2) / sampleRate, midi: r.voiced ? r.midi : null, clarity: d.clarity, rms: d.rms });
  }
  return frames;
}
