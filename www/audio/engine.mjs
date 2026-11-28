// Audio engine: context lifecycle, mic capture + live pitch, recording, synced
// synced playback of vocal + music with piano harmony notes.
import { createTracker, midiToFreq } from '../dsp/pitch.mjs';
import { LivePitch } from './live-pitch.mjs';
import { settings, detectRange } from '../core/settings.mjs';
import { route } from './route.mjs';
import { loopSamples } from '../core/practice.mjs';

let ctx = null, master = null, workletReady = null;
let micStream = null, micSource = null, micGain = null, captureNode = null, sink = null;
let analysis = null, tracker = null;
const pitchSubs = new Set();
let recorder = null;
let playbackPitchFn = null;
let lastPitch = null;
let micAec = null;

export function audioContext() { return ctx; }

export async function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    master.connect(comp).connect(ctx.destination);
    workletReady = ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url).href);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
    ctx.onstatechange = () => { if (ctx.state === 'interrupted' || ctx.state === 'suspended') engineEvents.dispatchEvent(new Event('interrupted')); };
  }
  await resume();
  await workletReady;
  return ctx;
}

export const engineEvents = new EventTarget();

// iOS/Safari: an AudioContext may only start inside a user gesture. Create/resume on the
// first touch and on every later one while suspended, so awaited playback still works.
function unlock() {
  try {
    if (!ctx) { ensureContext(); return; }
    if (ctx.state !== 'running') ctx.resume();
  } catch { /* */ }
}
if (typeof document !== 'undefined') for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, unlock, { capture: true, passive: true });

export async function resume() {
  if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch { /* needs gesture */ } }
}

export function sampleRate() { return ctx ? ctx.sampleRate : 48000; }
export function now() { return ctx ? ctx.currentTime : 0; }
export function outputLatency() { return ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0.03; }

/** Round-trip latency used for scoring/alignment: calibrated per route, else an estimate. */
export function roundTripLatency() {
  const map = settings.meta('latency') || {};
  const r = route.kind();
  if (map[r] != null) return map[r];
  return outputLatency() + 0.025 + (r === 'bluetooth' ? 0.15 : 0);
}

function wantAec() { return onSpeaker() && settings.get('aec'); }

export function onSpeaker() {
  const mode = settings.get('audioMode');
  if (mode === 'speaker') return true;
  if (mode === 'headphones') return false;
  return !route.isHeadphones(); // unknown counts as speaker for optional echo/bleed filtering
}

let micPending = null;
let micEpoch = 0;
export async function startMic(opts = {}) {
  // serialise: concurrent callers share one attempt (prevents a leaked second stream)
  const requestedEpoch = micEpoch;
  while (micPending) { try { await micPending; } catch { /* retry below */ } }
  if (requestedEpoch !== micEpoch) return false;
  micPending = startMicInner(opts);
  try { return await micPending; } finally { micPending = null; }
}
async function startMicInner({ aec: forceAec } = {}) {
  let epoch = micEpoch;
  await ensureContext();
  if (epoch !== micEpoch) return false;
  const aec = forceAec ?? wantAec();
  if (micStream && micAec === aec && micStream.getAudioTracks().some((t) => t.readyState === 'live')) return true;
  if (micStream) { stopMic(); epoch = micEpoch; }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: aec, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  if (epoch !== micEpoch) { stream.getTracks().forEach(t => t.stop()); return false; }
  micStream = stream;
  micAec = aec;
  micSource = ctx.createMediaStreamSource(micStream);
  micGain = ctx.createGain();
  micGain.gain.value = settings.get('inputGain');
  captureNode = new AudioWorkletNode(ctx, 'ht-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  sink = ctx.createGain(); sink.gain.value = 0;
  micSource.connect(micGain).connect(captureNode).connect(sink).connect(ctx.destination);
  rebuildDetector();
  captureNode.port.onmessage = (e) => onBlock(e.data.frame, e.data.data);
  for (const t of micStream.getAudioTracks()) t.addEventListener('ended', () => engineEvents.dispatchEvent(new Event('micended')));
  return true;
}

export function rebuildDetector() {
  const [minHz, maxHz] = detectRange();
  const options = { windowSize: 2 ** Math.ceil(Math.log2(ctx.sampleRate * .04)), minHz, maxHz, clarityThreshold: settings.get('clarity'), rmsGate: settings.get('noiseGate'), octaveCorrection: settings.get('octaveFix') };
  if (analysis) analysis.configure(options);
  else analysis = new LivePitch({ sampleRate: ctx.sampleRate, options, onResult: acceptPitch, nowFrame: () => ctx.currentTime * ctx.sampleRate });
  tracker = createTracker({ a4: settings.get('a4'), smoothing: settings.get('smoothing'), jumpConfirm: 3, onsetConfirm: 2, medianSize: 3, holdFrames: 1 });
}

settings.on((k) => {
  if (!ctx) return;
  if (['clarity', 'noiseGate', 'octaveFix', 'voiceRange', 'a4', 'smoothing', '*'].includes(k) && micStream) rebuildDetector();
  if ((k === 'inputGain' || k === '*') && micGain) micGain.gain.setTargetAtTime(settings.get('inputGain'), ctx.currentTime, 0.05);
  if (['aec', 'audioMode', '*'].includes(k) && micStream) startMic().catch(() => {});
});
route.on(() => { if (micStream && wantAec() !== micAec) startMic().catch(() => {}); });

export function stopMic() {
  micEpoch++;
  analysis?.close(); analysis = null;
  if (captureNode) { captureNode.port.onmessage = null; captureNode.port.close(); try { captureNode.disconnect(); } catch { /* */ } }
  if (micSource) try { micSource.disconnect(); } catch { /* */ }
  if (micGain) try { micGain.disconnect(); } catch { /* */ }
  if (sink) try { sink.disconnect(); } catch { /* */ }
  sink = null;
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = micSource = captureNode = micGain = null;
  lastPitch = null;
  tracker?.reset();
}

export function micActive() { return !!micStream; }

function onBlock(frame, data) {
  // Worklet transfers ownership: recording can retain the block without copying it.
  if (recorder) recorder.chunks.push({ frame, data });
  analysis?.push(frame, data);
}

function acceptPitch(d, centreFrame) {
  const t = centreFrame / ctx.sampleRate;
  // speaker-mode bleed rejection: an uncertain pitch matching what we're playing is probably the playback
  if (d.hz > 0 && playbackPitchFn && settings.get('playbackReject') && onSpeaker() && d.clarity < 0.85) {
    const m = 69 + 12 * Math.log2(d.hz / settings.get('a4'));
    const playing = playbackPitchFn(t);
    if (playing && playing.some((p) => Math.abs(p - m) < 0.35 || Math.abs(p - m - 12) < 0.35 || Math.abs(p - m + 12) < 0.35)) d.hz = 0;
  }
  const r = tracker.push(d);
  const frameOut = { t, frame: centreFrame, midi: r.voiced ? r.midi : null, held: r.midi, hz: d.hz, clarity: d.clarity, rms: d.rms };
  lastPitch = frameOut;
  pitchSubs.forEach((f) => f(frameOut));
}

/** Feed a pitch frame as if detected from the mic (store screenshots / automated demos). */
export function injectPitch(f) { lastPitch = f; pitchSubs.forEach((fn) => fn(f)); }

export function onPitch(f) { pitchSubs.add(f); return () => pitchSubs.delete(f); }
export function latestPitch() { return lastPitch; }
export function setPlaybackPitchProvider(fn) { playbackPitchFn = fn; }

// ---------- recording ----------
export function startRecording() { recorder = { chunks: [] }; }
export function isRecording() { return !!recorder; }
/** Stop and return {samples, startFrame} of everything captured. */
export function stopRecording() {
  captureNode?.port.postMessage('flush');
  const r = recorder; recorder = null;
  if (!r || !r.chunks.length) return { samples: new Float32Array(0), startFrame: 0 };
  const start = r.chunks[0].frame;
  const last = r.chunks[r.chunks.length - 1];
  const len = last.frame + last.data.length - start;
  const out = new Float32Array(len);
  for (const c of r.chunks) out.set(c.data, c.frame - start);
  return { samples: out, startFrame: start };
}

/** Extract the part of a recording aligned to musical time: m=0 ↦ index 0. */
export function alignRecording(rec, transport, latency) {
  const sr = ctx.sampleRate;
  const mStart = transport.from;
  // musical m is captured at ctx frame (tStart + latency + (m - from)) * sr
  const frameAtFrom = Math.round((transport.tStart + latency) * sr);
  const offset = frameAtFrom - rec.startFrame; // index in rec of musical `from`
  const preRoll = Math.round(mStart * sr);
  const avail = rec.samples.length - Math.max(0, offset);
  const out = new Float32Array(Math.max(0, preRoll + avail));
  for (let i = 0; i < avail; i++) {
    const src = offset + i;
    if (src >= 0 && src < rec.samples.length) out[preRoll + i] = rec.samples[src];
  }
  return out;
}

// ---------- piano ----------
// Each note is rendered once into an AudioBuffer (additive synthesis: stretched partials,
// per-partial two-stage decay, paired-string beating, hammer thump) and cached.
const pianoCache = new Map();
function pianoBuffer(midi) {
  const a4 = settings.get('a4');
  const m = Math.round(midi);
  const key = `${m}:${a4}:${ctx.sampleRate}`;
  if (pianoCache.has(key)) return pianoCache.get(key);
  const sr = ctx.sampleRate;
  const f0 = midiToFreq(m, a4);
  const rel = (m - 60) / 12; // octaves from middle C
  const dur = Math.max(1.6, Math.min(5, 3.6 - rel * 0.9));
  const n = Math.round(sr * dur);
  const out = new Float32Array(n);
  const B = 0.00008 * Math.pow(2, rel * 1.1); // inharmonicity grows up the keyboard
  const tau1 = Math.max(0.7, 2.6 * Math.pow(2, -rel * 0.55)); // slow (aftersound) decay of the fundamental
  const nyq = sr * 0.45;
  for (let k = 1; k <= 16; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > nyq) break;
    // hammer strikes ~1/8 of the string: weak 8th partial; brightness falls with k
    let amp = Math.pow(k, -1.15) * (0.25 + 0.75 * Math.abs(Math.sin((Math.PI * k) / 8.2)));
    if (k === 1) amp *= 1.1;
    if (rel > 1) amp *= Math.pow(k, -0.25 * (rel - 1)); // high notes are purer
    const tauSlow = tau1 / (1 + 0.45 * (k - 1));
    const tauFast = Math.min(0.35, tauSlow * 0.18);
    const strings = k <= 4 ? 2 : 1;
    for (let s = 0; s < strings; s++) {
      const det = strings === 2 ? (s ? 1 : -1) * 0.9 : 0; // cents
      const w = (2 * Math.PI * fk * Math.pow(2, det / 1200)) / sr;
      const cw = Math.cos(w), sw = Math.sin(w);
      let re = 1, im = 0; // rotating phasor, cheaper than sin() per sample
      const a = amp / strings;
      const kf = Math.exp(-1 / (tauFast * sr)), ks = Math.exp(-1 / (tauSlow * sr));
      let ef = 0.62, es = 0.38;
      for (let i = 0; i < n; i++) {
        out[i] += a * (ef + es) * im;
        const r2 = re * cw - im * sw; im = re * sw + im * cw; re = r2;
        ef *= kf; es *= ks;
        if (ef + es < 1e-4) break;
      }
    }
  }
  // hammer thump: a few ms of low-passed noise
  let lp = 0;
  const thumpN = Math.round(sr * 0.012);
  for (let i = 0; i < thumpN; i++) { lp += 0.25 * ((Math.random() * 2 - 1) - lp); out[i] += lp * 0.35 * Math.exp(-i / (sr * 0.0025)); }
  // soft attack edge, soundboard-ish low-pass, normalise
  const att = Math.round(sr * 0.003);
  for (let i = 0; i < att; i++) out[i] *= i / att;
  let y = 0, peak = 0;
  const cut = Math.min(0.9, (2 * Math.PI * Math.min(9000, f0 * 14)) / sr);
  for (let i = 0; i < n; i++) { y += cut * (out[i] - y); out[i] = y; peak = Math.max(peak, Math.abs(y)); }
  const norm = peak > 0 ? 0.5 / peak : 1;
  for (let i = 0; i < n; i++) out[i] *= norm;
  const b = ctx.createBuffer(1, n, sr);
  b.copyToChannel(out, 0);
  pianoCache.set(key, b);
  return b;
}

/** Render piano notes ahead of time so playback never stalls on the first note. */
export function warmPiano(midis) { if (ctx) for (const m of new Set(midis.map((x) => Math.round(x)))) pianoBuffer(m); }

function pianoNote(when, dur, midi, gain = 0.5, dest = master) {
  const src = ctx.createBufferSource();
  src.buffer = pianoBuffer(midi);
  const g = ctx.createGain();
  src.connect(g).connect(dest);
  const end = when + Math.max(0.08, dur);
  g.gain.setValueAtTime(gain, when);
  g.gain.setTargetAtTime(0, end, 0.06); // damper
  src.start(when);
  src.stop(end + 0.5);
  return { stop(t = ctx.currentTime) { try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.03); src.stop(t + 0.2); } catch { /* already stopped */ } } };
}

/** Play a single piano note now. */
export async function tone(midi, dur = 1, { gain = 0.5, delay = 0.02 } = {}) {
  await ensureContext();
  return pianoNote(ctx.currentTime + delay, dur, midi, gain);
}

/** Play a sequence [{start, end, midi}] relative to now. Returns {tStart, stop()} */
export async function sequence(notes, { gain = 0.45, delay = 0.08 } = {}) {
  await ensureContext();
  const t0 = ctx.currentTime + delay;
  const voices = notes.filter((n) => n.midi != null).map((n) => pianoNote(t0 + n.start, Math.max(0.08, n.end - n.start), n.midi, gain));
  return { tStart: t0, stop() { voices.forEach((v) => v.stop()); } };
}

// ---------- transport ----------
/**
 * layers: [{buffer: AudioBuffer (already rate-stretched), gain, mute, solo, at}] (at: musical start of the buffer)
 * from: musical seconds; rate: tempo factor (buffers pre-stretched by caller)
 * loop: {a, b} musical seconds or null
 * guide: [{start,end,midi,gain?}] musical time, played on the piano
 */
export async function play({ layers = [], from = 0, rate = 1, loop = null, guide = [], guideGain = 0.5, transpose = 0, lead = 0.12 } = {}) {
  await ensureContext();
  warmPiano(guide.filter((n) => n.midi != null).map((n) => n.midi + transpose));
  const anySolo = layers.some((l) => l.solo && !l.mute);
  const bus = ctx.createGain(); bus.connect(master);
  const tStart = ctx.currentTime + lead;
  if (loop && (from < loop.a || from >= loop.b)) from = loop.a;
  const sources = [];
  const layerGains = new Map();
  for (const l of layers) {
    if (!l.buffer || l.mute || (anySolo && !l.solo)) continue;
    let buf = l.buffer;
    if (loop) buf=makeBuffer(loopSamples(buf.getChannelData(0),buf.sampleRate,l.at||0,loop,rate),buf.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = l.gain ?? 1;
    s.connect(g).connect(bus);
    if (l.id) layerGains.set(l.id, g);
    s.onended = () => { s.disconnect(); g.disconnect(); };
    if (loop) { s.loop = true; s.loopStart = 0; s.loopEnd = buf.duration; }
    // a layer can begin part-way into the song (a take recorded from the middle)
    const off = (from - (loop ? loop.a : (l.at || 0))) / rate;
    if (off >= 0) { if (off < buf.duration) s.start(tStart, off); } else s.start(tStart - off, 0);
    sources.push(s);
  }
  const T = {
    tStart, from, rate, loop, stopped: false, layersPlaying: sources.length,
    /** musical time currently being HEARD */
    heard() { return toMusical(ctx.currentTime - outputLatency()); },
    /** musical time of a context-time (e.g. a mic frame minus latency) */
    toMusical,
    countInRemaining() { return Math.max(0, tStart - ctx.currentTime); },
    setLayerGain(id, value) {
      const node = layerGains.get(id);
      if (!T.stopped && node) node.gain.setTargetAtTime(Math.max(0, Math.min(4, value)), ctx.currentTime, .025);
    },
    stop() {
      if (T.stopped) return; T.stopped = true;
      clearInterval(timer);
      const t = ctx.currentTime;
      bus.gain.setTargetAtTime(0, t, 0.015);
      sources.forEach((s) => { try { s.stop(t + 0.08); } catch { /* not started */ } });
      liveVoices.forEach((v) => v.stop(t));
      setTimeout(() => { bus.disconnect(); layerGains.clear(); }, 250);
    },
  };
  function toMusical(ct) {
    const u = from + (ct - tStart) * rate;
    if (!loop || u < loop.b) return u;
    const L = loop.b - loop.a;
    return loop.a + ((u - loop.a) % L);
  }
  // lookahead scheduler for piano notes (handles loop wrap)
  const liveVoices = new Set();
  let schedUntil = ctx.currentTime;
  const guideSorted = guide.filter((n) => n.midi != null).sort((a, b) => a.start - b.start);
  function scheduleWindow() {
    if (T.stopped) return;
    const until = ctx.currentTime + 0.35;
    const a0 = Math.max(schedUntil, tStart - 0.001);
    if (until <= a0) return;
    // map ctx window to musical segments
    const segs = [];
    if (!loop) segs.push({ ma: from + (a0 - tStart) * rate, mb: from + (until - tStart) * rate, base: tStart - from / rate });
    else {
      const L = loop.b - loop.a;
      let ua = from + (a0 - tStart) * rate, ub = from + (until - tStart) * rate;
      while (ua < ub) {
        const k = Math.floor((ua - loop.a) / L);
        const iterStartU = loop.a + k * L;
        const segEndU = Math.min(ub, iterStartU + L);
        segs.push({ ma: ua - k * L, mb: segEndU - k * L, base: tStart + (iterStartU - from) / rate - loop.a / rate });
        ua = segEndU;
      }
    }
    for (const sg of segs) {
      for (const n of guideSorted) {
        if (n.start < sg.ma || n.start >= sg.mb) continue;
        const when = sg.base + n.start / rate;
        let dur = (n.end - n.start) / rate;
        if (loop) dur = Math.min(dur, (loop.b - n.start) / rate);
        const v = pianoNote(Math.max(ctx.currentTime, when), Math.max(0.06, dur - 0.01), n.midi + transpose, n.gain ?? guideGain, bus);
        liveVoices.add(v);
        setTimeout(() => liveVoices.delete(v), (dur + 1) * 1000 + (when - ctx.currentTime) * 1000);
      }
    }
    schedUntil = until;
  }
  // a note already sounding at the start point (seek mid-note) still plays for its remainder
  for (const n of guideSorted) if (n.start < from && n.end > from + 0.12) {
    const v = pianoNote(tStart, (n.end - from) / rate, n.midi + transpose, n.gain ?? guideGain, bus);
    liveVoices.add(v);
  }
  scheduleWindow();
  const timer = guideSorted.length ? setInterval(scheduleWindow, 60) : null;
  return T;
}

/** decode an ArrayBuffer (imported file) to mono Float32 at the context rate */
export async function decodeAudioBuffer(arrayBuffer) {
  await ensureContext();
  return ctx.decodeAudioData(arrayBuffer);
}

export async function decodeToMono(arrayBuffer) {
  const ab = await decodeAudioBuffer(arrayBuffer);
  const n = ab.length, out = new Float32Array(n);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ab.numberOfChannels; }
  return { mono: out, buffer: ab };
}

export function makeBuffer(samples, sr = ctx.sampleRate) {
  const b = ctx.createBuffer(1, Math.max(1, samples.length), sr);
  b.copyToChannel(samples, 0);
  return b;
}
