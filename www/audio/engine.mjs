// Audio engine: context lifecycle, mic capture + live pitch, recording, synced
// multi-layer playback with loop/rate, guide tones, metronome, drone and test tones.
import { createDetector, createTracker, midiToFreq } from '../dsp/pitch.mjs';
import { settings, detectRange } from '../core/settings.mjs';
import { route } from './route.mjs';

let ctx = null, master = null, workletReady = null;
let micStream = null, micSource = null, micGain = null, captureNode = null, sink = null;
let detector = null, tracker = null;
let ring = new Float32Array(2048);
let ringFill = 0, ringFrame = 0, sinceHop = 0;
const HOP = 256;
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

function wantAec() {
  const mode = settings.get('audioMode');
  const onSpeaker = mode === 'speaker' || (mode === 'auto' && route.kind() !== 'wired' && route.kind() !== 'bluetooth' && route.kind() !== 'usb');
  return onSpeaker && settings.get('aec');
}

export function onSpeaker() {
  const mode = settings.get('audioMode');
  if (mode === 'speaker') return true;
  if (mode === 'headphones') return false;
  return route.kind() === 'speaker';
}

export async function startMic() {
  await ensureContext();
  const aec = wantAec();
  if (micStream && micAec === aec) return true;
  if (micStream) stopMic();
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: aec, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  micAec = aec;
  micSource = ctx.createMediaStreamSource(micStream);
  micGain = ctx.createGain();
  micGain.gain.value = settings.get('inputGain');
  captureNode = new AudioWorkletNode(ctx, 'ht-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  sink = ctx.createGain(); sink.gain.value = 0;
  micSource.connect(micGain).connect(captureNode).connect(sink).connect(ctx.destination);
  rebuildDetector();
  ring = new Float32Array(detector.windowSize); ringFill = 0; ringW = 0;
  captureNode.port.onmessage = (e) => onBlock(e.data.frame, e.data.data);
  for (const t of micStream.getAudioTracks()) t.addEventListener('ended', () => engineEvents.dispatchEvent(new Event('micended')));
  return true;
}

export function rebuildDetector() {
  const [minHz, maxHz] = detectRange();
  detector = createDetector({ sampleRate: ctx.sampleRate, windowSize: ctx.sampleRate > 30000 ? 2048 : 1024, minHz, maxHz, clarityThreshold: settings.get('clarity'), rmsGate: settings.get('noiseGate'), octaveCorrection: settings.get('octaveFix') });
  tracker = createTracker({ a4: settings.get('a4'), smoothing: settings.get('smoothing') });
}

settings.on((k) => {
  if (!ctx) return;
  if (['clarity', 'noiseGate', 'octaveFix', 'voiceRange', 'a4', 'smoothing'].includes(k) && micStream) rebuildDetector();
  if (k === 'inputGain' && micGain) micGain.gain.setTargetAtTime(settings.get('inputGain'), ctx.currentTime, 0.05);
  if ((k === 'aec' || k === 'audioMode') && micStream) startMic();
});
route.on(() => { if (micStream && wantAec() !== micAec) startMic().catch(() => {}); });

export function stopMic() {
  if (captureNode) { captureNode.port.onmessage = null; try { captureNode.disconnect(); } catch { /* */ } }
  if (micSource) try { micSource.disconnect(); } catch { /* */ }
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = micSource = captureNode = micGain = null;
  ringFill = 0; ringW = 0; lastPitch = null;
  tracker?.reset();
}

export function micActive() { return !!micStream; }

let ringW = 0; // circular write index
function onBlock(frame, data) {
  if (recorder) recorder.chunks.push({ frame, data: data.slice() });
  const W = detector.windowSize;
  for (let i = 0; i < data.length; i++) {
    ring[ringW] = data[i];
    ringW = (ringW + 1) % W;
    if (ringFill < W) ringFill++;
    sinceHop++;
    if (ringFill === W && sinceHop >= HOP) {
      sinceHop = 0;
      ringFrame = frame + i + 1;
      analyse();
    }
  }
}

const win = new Float32Array(2048);
function analyse() {
  const W = detector.windowSize;
  // unroll circular buffer oldest→newest
  const tail = W - ringW;
  win.set(ring.subarray(ringW, W), 0);
  if (ringW) win.set(ring.subarray(0, ringW), tail);
  const d = detector.detect(win);
  const centreFrame = ringFrame - W / 2;
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

// ---------- synthesis helpers ----------
function voiceTone(when, dur, midi, gain = 0.25, dest = master, { attack = 0.03, timbre = 'warm' } = {}) {
  const f = midiToFreq(midi, settings.get('a4'));
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * (timbre === 'bright' ? 8 : 4.5)); lp.Q.value = 0.5;
  const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f; o2.detune.value = 4;
  const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = f * 2;
  const g2 = ctx.createGain(); g2.gain.value = 0.35;
  const g3 = ctx.createGain(); g3.gain.value = 0.12;
  // gentle vibrato after the attack
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
  const lfoG = ctx.createGain(); lfoG.gain.value = 0;
  lfo.connect(lfoG); lfoG.connect(o1.detune); lfoG.connect(o2.detune); lfoG.connect(o3.detune);
  if (dur > 0.6) { lfoG.gain.setValueAtTime(0, when + 0.35); lfoG.gain.linearRampToValueAtTime(9, when + 0.8); }
  o1.connect(lp); o2.connect(g2).connect(lp); o3.connect(g3).connect(lp); lp.connect(g).connect(dest);
  const rel = Math.min(0.12, dur * 0.3);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + attack);
  g.gain.setTargetAtTime(gain * 0.8, when + attack, 0.2);
  g.gain.setValueAtTime(gain * 0.8, Math.max(when + attack, when + dur - rel));
  g.gain.linearRampToValueAtTime(0, when + dur);
  const end = when + dur + 0.05;
  for (const o of [o1, o2, o3, lfo]) { o.start(when); o.stop(end); }
  return { stop(t = ctx.currentTime) { try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.02); for (const o of [o1, o2, o3, lfo]) o.stop(t + 0.1); } catch { /* already stopped */ } } };
}

function click(when, accent, gain) {
  const kind = settings.get('clickSound');
  const vol = settings.get('clickVolume') * (gain ?? 1) * (accent ? 1 : 0.6);
  if (vol <= 0) return;
  const g = ctx.createGain();
  g.connect(master);
  if (kind === 'beep') {
    const o = ctx.createOscillator(); o.frequency.value = accent ? 1760 : 1320; o.connect(g);
    g.gain.setValueAtTime(vol * 0.5, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    o.start(when); o.stop(when + 0.08);
  } else {
    const len = Math.round(ctx.sampleRate * 0.05);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const f = kind === 'soft' ? (accent ? 1500 : 1100) : (accent ? 2100 : 1600);
    for (let i = 0; i < len; i++) { const t = i / ctx.sampleRate; d[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * (kind === 'soft' ? 120 : 70)) * (kind === 'soft' ? 0.5 : 1); }
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(g);
    g.gain.value = vol * 0.7;
    s.start(when);
  }
}

/** Play a single reference tone now (or at `when`). */
export async function tone(midi, dur = 1, { gain = 0.3, delay = 0.02 } = {}) {
  await ensureContext();
  return voiceTone(ctx.currentTime + delay, dur, midi, gain);
}

/** Play a sequence [{start, end, midi}] relative to now. Returns {tStart, stop()} */
export async function sequence(notes, { gain = 0.28, delay = 0.08, rate = 1, transpose = 0 } = {}) {
  await ensureContext();
  const t0 = ctx.currentTime + delay;
  const voices = notes.filter((n) => n.midi != null).map((n) => voiceTone(t0 + n.start / rate, Math.max(0.08, (n.end - n.start) / rate), n.midi + transpose, gain));
  return { tStart: t0, stop() { voices.forEach((v) => v.stop()); } };
}

// ---------- drone ----------
let drone = null;
export async function startDrone(midi, { fifth = true, gain = 0.18 } = {}) {
  await ensureContext();
  stopDrone();
  const f = midiToFreq(midi, settings.get('a4'));
  const out = ctx.createGain(); out.gain.value = 0; out.connect(master);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(out);
  const oscs = [];
  const add = (freq, type, g, det = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det; const gg = ctx.createGain(); gg.gain.value = g; o.connect(gg).connect(lp); o.start(); oscs.push(o); };
  add(f / 2, 'sawtooth', 0.12, -3); add(f / 2, 'sawtooth', 0.12, 3); add(f, 'triangle', 0.3); add(f, 'sine', 0.3, 2);
  if (fifth) { add(f * 1.5, 'triangle', 0.12); add(f * 0.75, 'sine', 0.14); }
  // slow breathing movement
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13; const lg = ctx.createGain(); lg.gain.value = 300; lfo.connect(lg).connect(lp.frequency); lfo.start(); oscs.push(lfo);
  out.gain.setTargetAtTime(gain, ctx.currentTime, 0.4);
  drone = { out, oscs, midi };
}
export function stopDrone() {
  if (!drone) return;
  const d = drone; drone = null;
  d.out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
  d.oscs.forEach((o) => o.stop(ctx.currentTime + 1));
}
export function droneMidi() { return drone ? drone.midi : null; }

// ---------- transport ----------
/**
 * layers: [{buffer: AudioBuffer (already rate-stretched), gain, mute, solo, transpose}]
 * from: musical seconds; rate: tempo factor (buffers pre-stretched by caller)
 * loop: {a, b} musical seconds or null
 * guide: [{start,end,midi}] musical time, played softly
 * clicks: {bpm, beatsPerBar, offset, countInBars, metronome}
 */
export async function play({ layers = [], from = 0, rate = 1, loop = null, guide = [], guideGain = 0.12, transpose = 0, clicks = null, lead = 0.12 } = {}) {
  await ensureContext();
  const anySolo = layers.some((l) => l.solo && !l.mute);
  const bus = ctx.createGain(); bus.connect(master);
  const beat = clicks?.bpm ? 60 / clicks.bpm : 0;
  const countInDur = clicks?.countInBars ? clicks.countInBars * clicks.beatsPerBar * beat / rate : 0;
  const tStart = ctx.currentTime + lead + countInDur;
  if (loop && (from < loop.a || from >= loop.b)) from = loop.a;
  const sources = [];
  for (const l of layers) {
    if (!l.buffer || l.mute || (anySolo && !l.solo)) continue;
    const s = ctx.createBufferSource();
    s.buffer = l.buffer;
    const g = ctx.createGain(); g.gain.value = l.gain ?? 1;
    s.connect(g).connect(bus);
    if (loop) { s.loop = true; s.loopStart = loop.a / rate; s.loopEnd = Math.min(l.buffer.duration, loop.b / rate); }
    const off = from / rate;
    if (off < l.buffer.duration || loop) s.start(tStart, Math.min(off, l.buffer.duration - 0.001));
    sources.push(s);
  }
  // count-in clicks
  if (countInDur > 0) {
    const n = clicks.countInBars * clicks.beatsPerBar;
    for (let i = 0; i < n; i++) click(tStart - countInDur + (i * beat) / rate, i % clicks.beatsPerBar === 0, 1);
  }
  const T = {
    tStart, from, rate, loop, stopped: false, layersPlaying: sources.length,
    /** musical time currently being HEARD */
    heard() { return toMusical(ctx.currentTime - outputLatency()); },
    /** musical time of a context-time (e.g. a mic frame minus latency) */
    toMusical,
    countInRemaining() { return Math.max(0, tStart - ctx.currentTime); },
    stop() {
      if (T.stopped) return; T.stopped = true;
      clearInterval(timer);
      const t = ctx.currentTime;
      bus.gain.setTargetAtTime(0, t, 0.015);
      sources.forEach((s) => { try { s.stop(t + 0.08); } catch { /* not started */ } });
      liveVoices.forEach((v) => v.stop(t));
    },
  };
  function toMusical(ct) {
    const u = from + (ct - tStart) * rate;
    if (!loop || u < loop.b) return u;
    const L = loop.b - loop.a;
    return loop.a + ((u - loop.a) % L);
  }
  // lookahead scheduler for guide tones + metronome (handles loop wrap)
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
        const v = voiceTone(Math.max(ctx.currentTime, when), Math.max(0.06, dur - 0.01), n.midi + transpose, guideGain, bus, { attack: 0.02 });
        liveVoices.add(v);
        setTimeout(() => liveVoices.delete(v), (dur + 1) * 1000 + (when - ctx.currentTime) * 1000);
      }
      if (clicks?.metronome && beat) {
        const off = clicks.offset || 0;
        const first = Math.ceil((sg.ma - off) / beat - 1e-9);
        for (let k = first; off + k * beat < sg.mb; k++) {
          const m = off + k * beat;
          if (m < 0) continue;
          click(sg.base + m / rate, k % clicks.beatsPerBar === 0, 0.8);
        }
      }
    }
    schedUntil = until;
  }
  scheduleWindow();
  const timer = setInterval(scheduleWindow, 60);
  return T;
}

/** decode an ArrayBuffer (imported file) to mono Float32 at the context rate */
export async function decodeToMono(arrayBuffer) {
  await ensureContext();
  const ab = await ctx.decodeAudioData(arrayBuffer);
  const n = ab.length, out = new Float32Array(n);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ab.numberOfChannels; }
  return { mono: out, buffer: ab };
}

export function makeBuffer(samples, sr = ctx.sampleRate) {
  const b = ctx.createBuffer(1, Math.max(1, samples.length), sr);
  b.copyToChannel(samples, 0);
  return b;
}
