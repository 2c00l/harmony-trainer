// 9:16 video export: renders the stacked piano roll frame by frame offscreen and encodes
// H.264 + AAC into MP4 with WebCodecs; falls back to real-time MediaRecorder capture.
import { h, sheet, toast } from '../ui/ui.mjs';
import { Roll, roundRect } from '../ui/roll.mjs';
import { settings } from '../core/settings.mjs';
import { unpackFrames, LAYER_COLORS, harmonyTargets } from '../core/project.mjs';
import { keyName } from '../dsp/theory.mjs';
import { saveFile, safeName, encodeM4a } from './export.mjs';
import * as E from '../audio/engine.mjs';

const W = 360, H = 640, DPR = 3, FPS = 30;

function makeStage(p) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;`;
  document.body.append(canvas);
  const roll = new Roll(canvas, { mode: 'scroll', nowX: 0.62, pxPerSec: 70, semis: 16, key: p.key, labelStyle: settings.get('labels'), accidentals: settings.get('accidentals'), gutter: 40 });
  roll.setSize(W, H, DPR);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const layers = p.layers.filter((l) => !l.mute).map((l) => ({ name: l.name, color: css(LAYER_COLORS[l.colorIdx % LAYER_COLORS.length]), frames: unpackFrames(l.frames) }));
  const all = layers.flatMap((l) => l.frames.filter((f) => f.midi != null).map((f) => f.midi));
  const lo = Math.min(...all), hi = Math.max(...all);
  roll.set({ centerMidi: (lo + hi) / 2, semis: Math.max(14, Math.ceil(hi - lo) + 6), follow: false, lines: layers.map((l) => ({ frames: l.frames, color: l.color, alpha: 0.95, width: 2.6 })), targets: harmonyTargets(p).filter((t) => t.midi != null).map((t) => ({ ...t, kind: 'ghost' })), beats: p.bpm ? { bpm: p.bpm, beatsPerBar: p.beatsPerBar, offset: p.beatOffset } : null });
  const g = roll.g;
  const light = document.documentElement.dataset.theme === 'light';
  function draw(t) {
    roll.set({ now: t });
    roll.render(1 / FPS);
    // glowing heads where each layer is now
    g.save();
    g.globalCompositeOperation = light ? 'source-over' : 'lighter';
    for (const l of layers) {
      let f = null;
      for (let i = 0; i < l.frames.length; i++) { if (l.frames[i].t > t) { f = l.frames[Math.max(0, i - 1)]; break; } }
      if (!f || f.midi == null || t - f.t > 0.1) continue;
      const x = roll.timeToX(f.t), y = roll.midiToY(f.midi);
      const rg = g.createRadialGradient(x, y, 0, x, y, 22);
      rg.addColorStop(0, l.color); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.globalAlpha = 0.8; g.beginPath(); g.arc(x, y, 22, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1; g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // header overlay
    const grad = g.createLinearGradient(0, 0, 0, 120);
    grad.addColorStop(0, light ? 'rgba(244,245,250,0.97)' : 'rgba(11,15,26,0.95)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, W, 120);
    g.fillStyle = css('--text'); g.font = '800 22px system-ui, -apple-system, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(p.name.slice(0, 26), 18, 40);
    g.fillStyle = css('--text-dim'); g.font = '600 13px system-ui, -apple-system, sans-serif';
    g.fillText(`${p.key ? keyName(p.key) : ''}${p.bpm ? ` · ${p.bpm} bpm` : ''} · ${layers.length} voice${layers.length > 1 ? 's' : ''}`, 18, 62);
    let x = 18;
    g.font = '700 12px system-ui, -apple-system, sans-serif';
    for (const l of layers) {
      const w = g.measureText(l.name).width + 26;
      if (x + w > W - 10) break;
      g.fillStyle = l.color; g.globalAlpha = 0.18; roundRect(g, x, 74, w, 24, 12); g.fill(); g.globalAlpha = 1;
      g.beginPath(); g.arc(x + 12, 86, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = css('--text'); g.fillText(l.name, x + 21, 90.5);
      x += w + 6;
    }
    // footer brand
    g.fillStyle = css('--text-faint'); g.font = '700 12px system-ui, -apple-system, sans-serif'; g.textAlign = 'right';
    g.fillText('Made with Harmony Trainer', W - 16, H - 18);
  }
  return { canvas, draw, destroy() { canvas.remove(); roll.destroy(); } };
}

export async function exportVideo(p, { bufferFor, backingBuffer, mixdown }) {
  let cancelled = false;
  const bar = h('div', { class: 'progressbar' }, h('i', { style: { width: '0%' } }));
  const label = h('p', { class: 'small dim', 'aria-live': 'polite' }, 'Mixing audio…');
  const s = sheet((api) => [h('h2', {}, 'Making your video'), label, bar, h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { cancelled = true; api.close(); } }, 'Cancel'))], { onClose: () => { cancelled = true; }, label: 'Video export' });
  const setP = (k, txt) => { bar.firstChild.style.width = `${Math.round(k * 100)}%`; if (txt) label.textContent = txt; };
  try {
    const mix = await mixdown(p, { bufferFor, backingBuffer });
    const dur = mix.L.length / mix.sr;
    const stage = makeStage(p);
    let blob = null;
    try {
      blob = await encodeWebCodecs(stage, mix, dur, (k) => setP(k, `Rendering frames… ${Math.round(k * 100)}%`), () => cancelled);
    } catch (e) { console.warn('WebCodecs video failed, using real-time capture', e); }
    if (!blob && !cancelled) blob = await encodeRealtime(stage, mix, dur, (k) => setP(k, `Recording in real time… ${Math.round(k * 100)}%`), () => cancelled);
    stage.destroy();
    if (cancelled || !blob) return;
    s.close();
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    await saveFile(blob, `${safeName(p.name)}.${ext}`);
  } catch (e) {
    console.warn(e);
    s.close();
    toast('Video export failed on this device');
  }
}

async function encodeWebCodecs(stage, mix, dur, progress, isCancelled) {
  if (!window.VideoEncoder || !window.VideoFrame) return null;
  const vcfg = { codec: 'avc1.640028', width: W * DPR, height: H * DPR, bitrate: 6_000_000, framerate: FPS, avc: { format: 'avc' } };
  const sup = await VideoEncoder.isConfigSupported(vcfg).catch(() => ({ supported: false }));
  if (!sup.supported) { vcfg.codec = 'avc1.42E028'; if (!(await VideoEncoder.isConfigSupported(vcfg).catch(() => ({}))).supported) return null; }
  let audioOk = false;
  if (window.AudioEncoder) { const a = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: mix.sr, numberOfChannels: 2, bitrate: 160000 }).catch(() => ({})); audioOk = !!a.supported; }
  if (!audioOk) return null; // a silent video is not useful; use the realtime path that captures audio
  const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W * DPR, height: H * DPR, frameRate: FPS }, audio: { codec: 'aac', sampleRate: mix.sr, numberOfChannels: 2 }, fastStart: 'in-memory' });
  let err = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { err = e; } });
  venc.configure(vcfg);
  const n = Math.ceil(dur * FPS);
  for (let i = 0; i < n; i++) {
    if (isCancelled()) { venc.close(); return null; }
    if (err) throw err;
    stage.draw(i / FPS);
    const vf = new VideoFrame(stage.canvas, { timestamp: Math.round((i / FPS) * 1e6), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    if (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (i % 10 === 0) { progress(i / n); await new Promise((r) => setTimeout(r, 0)); }
  }
  await venc.flush(); venc.close();
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { err = e; } });
  aenc.configure({ codec: 'mp4a.40.2', sampleRate: mix.sr, numberOfChannels: 2, bitrate: 160000 });
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

async function encodeRealtime(stage, mix, dur, progress, isCancelled) {
  const ctx = await E.ensureContext();
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
      stage.draw(Math.max(0, t));
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
void encodeM4a;
