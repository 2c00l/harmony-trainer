// Onset detection for latency calibration: returns the time (s) of the first energy
// rise in a window, relative to the samples' start, or null.
export function findOnset(samples, sr, fromSec, toSec, { win = 0.004 } = {}) {
  const W = Math.max(16, Math.round(win * sr));
  const a = Math.max(0, Math.round(fromSec * sr)), b = Math.min(samples.length, Math.round(toSec * sr));
  const env = [];
  for (let i = a; i + W <= b; i += W) {
    let e = 0; for (let j = 0; j < W; j++) e += samples[i + j] * samples[i + j];
    env.push(Math.sqrt(e / W));
  }
  if (env.length < 8) return null;
  const floorWin = env.slice(0, Math.max(4, Math.floor(env.length * 0.12))).slice().sort((x, y) => x - y);
  const floor = floorWin[floorWin.length >> 1] + 1e-5;
  const peak = Math.max(...env);
  if (peak < floor * 6 || peak < 0.004) return null;
  const thr = floor + (peak - floor) * 0.25;
  for (let i = 1; i < env.length; i++) if (env[i] >= thr) return (a + i * W) / sr;
  return null;
}

/** robust centre of a list of offsets (median after dropping outliers) */
export function robustLatency(offsets) {
  const v = offsets.filter((x) => x != null && x > -0.05 && x < 0.8).sort((x, y) => x - y);
  if (v.length < 3) return null;
  const med = v[v.length >> 1];
  const close = v.filter((x) => Math.abs(x - med) < 0.04);
  if (close.length < Math.max(3, v.length * 0.5)) return null;
  return close.reduce((s, x) => s + x, 0) / close.length;
}
