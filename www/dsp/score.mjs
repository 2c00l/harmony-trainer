// Scoring of a sung take against target notes, plus live (per-frame) scoring.

export const PRESETS = {
  easy: { perfect: 25, good: 50, ok: 80, label: 'Easy' },
  normal: { perfect: 15, good: 35, ok: 50, label: 'Normal' },
  hard: { perfect: 10, good: 25, ok: 40, label: 'Hard' },
  pro: { perfect: 6, good: 15, ok: 28, label: 'Pro' },
};

export const DEFAULT_SCORING = { ...PRESETS.normal, scoopIgnore: 0.08, timingWeight: 0.2, octaveFree: true };

/** cents of sung relative to target, octave-folded if octaveFree */
export function centsErr(sungMidi, targetMidi, octaveFree = true) {
  let d = (sungMidi - targetMidi) * 100;
  if (octaveFree) { d = ((d % 1200) + 1200) % 1200; if (d > 600) d -= 1200; }
  return d;
}

export function grade(absCents, tol) {
  if (absCents <= tol.perfect) return 'perfect';
  if (absCents <= tol.good) return 'good';
  if (absCents <= tol.ok) return 'ok';
  return 'miss';
}

const GRADE_PTS = { perfect: 1, good: 0.82, ok: 0.55, miss: 0 };

/**
 * targets: [{start,end,midi}] (midi null = rest, skipped)
 * frames: [{t, midi|null}] — t already in the targets' timeline (latency applied by caller or via opts.latency)
 */
export function scoreTake(targets, frames, opts = {}) {
  const o = { ...DEFAULT_SCORING, ...opts };
  const lat = o.latency || 0;
  const res = [];
  let fi = 0;
  const F = frames.map((f) => ({ t: f.t - lat, midi: f.midi }));
  for (let ni = 0; ni < targets.length; ni++) {
    const n = targets[ni];
    if (n.midi == null) continue;
    const dur = n.end - n.start;
    const scoop = Math.min(o.scoopIgnore, dur * 0.4);
    const errs = [];
    let voicedN = 0, totalN = 0, inTolN = 0, onset = null;
    while (fi > 0 && F[fi - 1].t > n.start - 0.3) fi--;
    for (let i = fi; i < F.length; i++) {
      const f = F[i];
      if (f.t < n.start - 0.25) { fi = i; continue; }
      if (f.t > n.end) break;
      if (f.midi != null && onset == null && f.t <= n.start + Math.max(0.3, dur * 0.5)) {
        if (Math.abs(centsErr(f.midi, n.midi, o.octaveFree)) <= o.ok) onset = f.t;
      }
      if (f.t < n.start + scoop) continue;
      totalN++;
      if (f.midi == null) continue;
      voicedN++;
      const e = centsErr(f.midi, n.midi, o.octaveFree);
      errs.push(e);
      if (Math.abs(e) <= o.ok) inTolN++;
    }
    const coverage = totalN ? inTolN / totalN : 0;
    let cents = null, g = 'miss', pts = 0;
    if (errs.length) {
      const s = errs.slice().sort((a, b) => a - b);
      cents = s[s.length >> 1];
      g = coverage < 0.3 ? 'miss' : grade(Math.abs(cents), o);
      // continuous within-grade interpolation keeps scores from being lumpy
      const a = Math.abs(cents);
      const cont = a <= o.perfect ? 1 : a >= o.ok * 1.6 ? 0 : 1 - (a - o.perfect) / (o.ok * 1.6 - o.perfect);
      pts = (0.5 * GRADE_PTS[g] + 0.5 * cont) * Math.min(1, coverage / 0.8);
    }
    const timing = onset != null ? onset - n.start : null;
    const timingPts = timing == null ? 0 : Math.max(0, 1 - Math.abs(timing) / 0.3);
    const score = g === 'miss' ? pts * 0.5 : (1 - o.timingWeight) * pts + o.timingWeight * timingPts;
    res.push({ index: ni, start: n.start, end: n.end, midi: n.midi, cents, grade: g, coverage, timing, score: Math.round(score * 100), voiced: totalN ? voicedN / totalN : 0 });
  }
  return { notes: res, ...summarise(res) };
}

export function summarise(notes) {
  if (!notes.length) return { score: 0, hitPct: 0, drift: 0, timingBias: 0, worst: [], counts: { perfect: 0, good: 0, ok: 0, miss: 0 } };
  let wsum = 0, ssum = 0, hits = 0, dsum = 0, dn = 0, tsum = 0, tn = 0;
  const counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
  for (const n of notes) {
    const w = Math.max(0.1, n.end - n.start);
    wsum += w; ssum += w * n.score;
    counts[n.grade]++;
    if (n.grade !== 'miss') { hits++; if (n.cents != null) { dsum += n.cents; dn++; } }
    if (n.timing != null) { tsum += n.timing; tn++; }
  }
  const worst = notes.slice().sort((a, b) => a.score - b.score).slice(0, 3).filter((n) => n.score < 90).map((n) => n.index);
  return {
    score: Math.round(ssum / wsum),
    hitPct: Math.round((hits / notes.length) * 100),
    drift: dn ? Math.round(dsum / dn) : 0,
    timingBias: tn ? Math.round((tsum / tn) * 1000) : 0,
    worst,
    counts,
  };
}

/**
 * Live scorer: feed frames in time order, read per-note fill (0..1) and state.
 * onPerfect(noteIdx) fires once per note when it has been held perfectly ≥ perfectHold s.
 */
export function createLiveScorer(targets, opts = {}) {
  const o = { ...DEFAULT_SCORING, perfectHold: 0.35, ...opts };
  const state = targets.map(() => ({ fill: 0, perfectRun: 0, burst: false, last: null, glow: 0 }));
  let lastT = null, ptr = 0;
  function update(t, midi) {
    const dt = lastT == null ? 0 : Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    while (ptr < targets.length && targets[ptr].end < t) ptr++;
    let activeIdx = -1, cents = null, g = null;
    for (let i = Math.max(0, ptr - 1); i < Math.min(targets.length, ptr + 2); i++) {
      const n = targets[i];
      if (n.midi == null || t < n.start || t > n.end) continue;
      activeIdx = i;
      const s = state[i];
      const dur = n.end - n.start;
      if (midi == null) { s.perfectRun = 0; s.last = null; s.glow *= 0.9; break; }
      cents = centsErr(midi, n.midi, o.octaveFree);
      g = grade(Math.abs(cents), o);
      s.last = g;
      if (g !== 'miss') s.fg = g;
      if (t - n.start >= Math.min(o.scoopIgnore, dur * 0.4) && g !== 'miss') {
        s.fill = Math.min(1, s.fill + dt / Math.max(0.05, dur - Math.min(o.scoopIgnore, dur * 0.4)));
      }
      if (g === 'perfect') { s.perfectRun += dt; s.glow = Math.min(1, s.glow + dt * 4); } else { s.perfectRun = 0; s.glow *= 0.92; }
      if (!s.burst && s.perfectRun >= Math.min(o.perfectHold, dur * 0.6)) { s.burst = true; opts.onPerfect?.(i); }
      break;
    }
    return { activeIdx, cents, grade: g };
  }
  return { update, state, reset() { lastT = null; ptr = 0; for (const s of state) Object.assign(s, { fill: 0, perfectRun: 0, burst: false, last: null, glow: 0, fg: null }); } };
}

/** Stability: frames of a held note → {meanCents, sd, drift (cents/s), steadiness 0..100} relative to nearest note */
export function stability(frames, targetMidi = null) {
  const v = frames.filter((f) => f.midi != null);
  if (v.length < 5) return null;
  const ref = targetMidi ?? Math.round(v.reduce((a, f) => a + f.midi, 0) / v.length);
  const c = v.map((f) => (f.midi - ref) * 100);
  const t = v.map((f) => f.t);
  const n = c.length;
  const mc = c.reduce((a, b) => a + b, 0) / n, mt = t.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (t[i] - mt) * (c[i] - mc); den += (t[i] - mt) ** 2; }
  const slope = den ? num / den : 0;
  let ss = 0;
  for (let i = 0; i < n; i++) { const r = c[i] - (mc + slope * (t[i] - mt)); ss += r * r; }
  const sd = Math.sqrt(ss / n);
  const steadiness = Math.max(0, Math.min(100, Math.round(100 - sd * 2 - Math.abs(slope) * 0.8 - Math.abs(mc) * 0.5)));
  return { meanCents: Math.round(mc), sd: Math.round(sd * 10) / 10, drift: Math.round(slope * 10) / 10, steadiness, ref };
}

/** Vibrato: frames (≥1 s ideally) → {rate Hz, depth cents (half extent), regularity 0..1} or null */
export function vibrato(frames) {
  const v = frames.filter((f) => f.midi != null);
  if (v.length < 20) return null;
  const dt = (v[v.length - 1].t - v[0].t) / (v.length - 1);
  if (!(dt > 0)) return null;
  const c = v.map((f) => f.midi * 100);
  // detrend with ~0.35 s moving average
  const W = Math.max(2, Math.round(0.35 / dt / 2));
  const d = c.map((x, i) => {
    let s = 0, k = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(c.length - 1, i + W); j++) { s += c[j]; k++; }
    return x - s / k;
  });
  const core = d.slice(W, d.length - W);
  if (core.length < 10) return null;
  // zero crossings with hysteresis
  const crossings = [];
  let sign = 0;
  for (let i = 0; i < core.length; i++) {
    const x = core[i];
    const s = x > 3 ? 1 : x < -3 ? -1 : 0;
    if (s !== 0 && s !== sign) { if (sign !== 0) crossings.push(i); sign = s; }
  }
  const rms = Math.sqrt(core.reduce((a, x) => a + x * x, 0) / core.length);
  const depth = rms * Math.SQRT2;
  if (crossings.length < 3 || depth < 8) return { rate: 0, depth: Math.round(depth), regularity: 0 };
  const periods = [];
  for (let i = 1; i < crossings.length; i++) periods.push((crossings[i] - crossings[i - 1]) * dt * 2);
  const mp = periods.reduce((a, b) => a + b, 0) / periods.length;
  const sdp = Math.sqrt(periods.reduce((a, b) => a + (b - mp) ** 2, 0) / periods.length);
  return { rate: Math.round((1 / mp) * 10) / 10, depth: Math.round(depth), regularity: Math.max(0, Math.min(1, 1 - sdp / mp)) };
}
