// Synthetic vocal-like signal generator for DSP tests.
// Glottal-ish source (harmonics with -12 dB/oct rolloff), vowel formant weighting,
// vibrato, jitter, shimmer, breath noise, scoops and slides.

export function mulberry(seed = 1) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const VOWELS = { a: [800, 1150, 2900], i: [270, 2300, 3000], o: [450, 800, 2830], u: [325, 700, 2530], e: [400, 2000, 2550] };

function formantGain(f, vowel) {
  const F = VOWELS[vowel] || VOWELS.a;
  let g = 0.02;
  for (let k = 0; k < F.length; k++) { const bw = 80 + F[k] * 0.06; g += (k === 0 ? 1 : 0.6 / k) / (1 + ((f - F[k]) / bw) ** 2); }
  return g;
}

/**
 * notes: [{midi, dur, scoop?: semis (start below and glide up over 80ms), vib?: {rate, depth cents}, vowel?, gap?}]
 * returns {samples, truth:[{start,end,midi}]}
 */
export function voice(notes, { sr = 48000, seed = 7, noise = 0.01, jitter = 0.003, harmonics = 20, a4 = 440, vowel = 'a', legato = false, f0gain = 1 } = {}) {
  const rnd = mulberry(seed);
  let total = 0;
  for (const n of notes) total += n.dur + (n.gap ?? (legato ? 0 : 0.08));
  const N = Math.ceil((total + 0.2) * sr);
  const out = new Float32Array(N);
  let phase = 0, t0 = 0.1;
  const truth = [];
  let i0 = Math.round(t0 * sr);
  for (const n of notes) {
    const len = Math.round(n.dur * sr);
    const base = a4 * Math.pow(2, (n.midi - 69) / 12);
    const vib = n.vib || null;
    const vw = n.vowel || vowel;
    // precompute harmonic gains for the base pitch (formants move little vs pitch changes)
    const H = Math.min(harmonics, Math.floor(18000 / base));
    const gains = [];
    for (let h = 1; h <= H; h++) gains.push(formantGain(base * h, vw) / Math.pow(h, 1.0));
    gains[0] *= f0gain;
    const gnorm = gains.reduce((a, b) => a + b, 0);
    let jit = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let semis = 0;
      if (n.scoop && t < 0.08) semis = -n.scoop * (1 - t / 0.08);
      if (n.slideTo != null) semis += (n.slideTo - n.midi) * Math.max(0, (t - (n.dur - 0.12)) / 0.12);
      if (vib && t > 0.15) semis += (vib.depth / 100) * Math.sin(2 * Math.PI * vib.rate * (t - 0.15)) * Math.min(1, (t - 0.15) / 0.2);
      if (i % 240 === 0) jit = (rnd() - 0.5) * 2 * jitter;
      const f = base * Math.pow(2, semis / 12) * (1 + jit);
      phase += (2 * Math.PI * f) / sr;
      let s = 0;
      for (let h = 0; h < H; h++) s += gains[h] * Math.sin((h + 1) * phase);
      const env = Math.min(1, i / (0.015 * sr), (len - i) / (0.02 * sr));
      out[i0 + i] = 0.5 * (s / gnorm) * env * (1 + (rnd() - 0.5) * 0.05);
    }
    truth.push({ start: i0 / sr, end: (i0 + len) / sr, midi: n.midi });
    i0 += len + Math.round((n.gap ?? (legato ? 0 : 0.08)) * sr);
  }
  for (let i = 0; i < N; i++) out[i] += (rnd() - 0.5) * 2 * noise;
  return { samples: out, truth, sr };
}

export function sine(freq, sec, sr = 48000, amp = 0.5) {
  const n = Math.round(sec * sr), o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return o;
}
