// Video export: draws the notes scrolling past offscreen, frame by frame, and encodes H.264 + AAC
// into MP4 with WebCodecs; falls back to real-time MediaRecorder capture.
import { Roll, roundRect } from '../ui/roll.mjs';
import { settings } from '../core/settings.mjs';
import { keyName } from '../dsp/theory.mjs';
import * as E from '../audio/engine.mjs';

const W = 360, H = 640, DPR = 2, FPS = 30;

/** view: {lines, targets, key} as shown in the player; from: musical start of the mix */
export function makeStage(p, view, from) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;`;
  document.body.append(canvas);
  const roll = new Roll(canvas, { mode: 'scroll', nowX: 0.35, pxPerSec: 70, semis: 14, key: view.key, labelStyle: settings.get('labels'), accidentals: settings.get('accidentals'), gutter: 40 });
  roll.setSize(W, H, DPR);
  roll.set({ lines: view.lines.map((l) => ({ ...l, width: 2.6 })), targets: view.targets, follow: true });
  const notes = view.targets;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const g = roll.g;
  const light = document.documentElement.dataset.theme === 'light';
  // zoom and follow like the player: the notes around "now"
  const fit = (t) => {
    const ms = notes.filter((n) => n.end > t - 1.5 && n.start < t + 4).map((n) => n.midi);
    if (ms.length) { const lo = Math.min(...ms), hi = Math.max(...ms); roll.set({ followTarget: (lo + hi) / 2, semisGoal: Math.max(9, Math.min(16, hi - lo + 5)) }); }
  };
  fit(from);
  roll.s.centerMidi = roll.s.followTarget ?? roll.s.centerMidi;
  roll.s.semis = roll.s.semisGoal ?? roll.s.semis;
  function draw(i) {
    const t = from + i / FPS;
    fit(t);
    roll.set({ now: t });
    roll.render(1 / FPS);
    const grad = g.createLinearGradient(0, 0, 0, 90);
    grad.addColorStop(0, light ? 'rgba(244,245,250,0.97)' : 'rgba(11,15,26,0.95)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, W, 90);
    g.fillStyle = css('--text'); g.font = '800 22px system-ui, -apple-system, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(p.name.slice(0, 26), 18, 38);
    g.fillStyle = css('--text-dim'); g.font = '600 13px system-ui, -apple-system, sans-serif';
    g.fillText(view.key ? keyName(view.key, settings.get('accidentals')) : '', 18, 60);
    g.fillStyle = css('--text-faint'); g.font = '700 12px system-ui, -apple-system, sans-serif'; g.textAlign = 'right';
    g.fillText('Made with Harmony Trainer', W - 16, H - 18);
  }
  return { canvas, draw, destroy() { canvas.remove(); roll.destroy(); } };
}
void roundRect;

export async function encodeWebCodecs(stage, mix, progress, isCancelled) {
  if (!window.VideoEncoder || !window.VideoFrame || !window.AudioEncoder) return null;
  const vcfg = { codec: 'avc1.640020', width: W * DPR, height: H * DPR, bitrate: 3_500_000, framerate: FPS, avc: { format: 'avc' } };
  if (!(await VideoEncoder.isConfigSupported(vcfg).catch(() => ({}))).supported) { vcfg.codec = 'avc1.42E020'; if (!(await VideoEncoder.isConfigSupported(vcfg).catch(() => ({}))).supported) return null; }
  const acfg = { codec: 'mp4a.40.2', sampleRate: mix.sr, numberOfChannels: 2, bitrate: 160000 };
  if (!(await AudioEncoder.isConfigSupported(acfg).catch(() => ({}))).supported) return null; // a silent video is no use
  const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W * DPR, height: H * DPR, frameRate: FPS }, audio: { codec: 'aac', sampleRate: mix.sr, numberOfChannels: 2 }, fastStart: 'in-memory' });
  let err = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { err = e; } });
  venc.configure(vcfg);
  const n = Math.ceil((mix.L.length / mix.sr) * FPS);
  for (let i = 0; i < n; i++) {
    if (isCancelled()) { venc.close(); return null; }
    if (err) throw err;
    stage.draw(i);
    const vf = new VideoFrame(stage.canvas, { timestamp: Math.round((i / FPS) * 1e6), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    if (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (i % 10 === 0) { progress(i / n); await new Promise((r) => setTimeout(r, 0)); }
  }
  await venc.flush(); venc.close();
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { err = e; } });
  aenc.configure(acfg);
  const F = 4096;
  for (let i = 0; i < mix.L.length; i += F) {
    const k = Math.min(F, mix.L.length - i);
    const data = new Float32Array(k * 2); data.set(mix.L.subarray(i, i + k), 0); data.set(mix.R.subarray(i, i + k), k);
    aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: mix.sr, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round((i / mix.sr) * 1e6), data }));
  }
  await aenc.flush(); aenc.close();
  if (err) throw err;
  muxer.finalize();
  progress(1);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

export async function encodeRealtime(stage, mix, progress, isCancelled) {
  const ctx = await E.ensureContext();
  const dur = mix.L.length / mix.sr;
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource(); src.buffer = mix.buffer; src.connect(dest);
  const vs = stage.canvas.captureStream(FPS);
  const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const types = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mime = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
  if (!mime) throw new Error('No recorder');
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start(500);
  const t0 = ctx.currentTime + 0.05;
  src.start(t0);
  await new Promise((resolve) => {
    const step = () => {
      const t = ctx.currentTime - t0;
      if (isCancelled() || t > dur) { resolve(); return; }
      stage.draw(Math.max(0, t) * FPS);
      progress(Math.max(0, t) / dur);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  try { src.stop(); } catch { /* */ }
  rec.stop();
  await done;
  if (isCancelled()) return null;
  return new Blob(chunks, { type: mime.split(';')[0] });
}
