// Export: offline mixdown to WAV / M4A, and 9:16 video of the stacked piano roll.
import { h, sheet, toast, ic } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { settings } from '../core/settings.mjs';
import * as E from '../audio/engine.mjs';
import { native, isNative } from '../core/native.mjs';

export function openExport(p, { bufferFor, backingBuffer }) {
  sheet((api) => [
    h('h2', {}, 'Export'),
    h('p', { class: 'dim small' }, 'Files are made on this device. Nothing is uploaded.'),
    h('div', { class: 'list', style: { marginTop: '12px' } },
      h('button', { class: 'row', onclick: () => { api.close(); exportAudio(p, { bufferFor, backingBuffer }, settings.get('exportFormat')); } }, ic('export'),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, `Audio (${settings.get('exportFormat') === 'm4a' ? 'M4A' : 'WAV'})`), h('div', { class: 'small faint' }, 'The stacked mix, with your volume and mute settings'))),
      h('button', { class: 'row', onclick: () => { api.close(); exportAudio(p, { bufferFor, backingBuffer }, settings.get('exportFormat') === 'm4a' ? 'wav' : 'm4a'); } }, ic('export'),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, `Audio (${settings.get('exportFormat') === 'm4a' ? 'WAV' : 'M4A'})`), h('div', { class: 'small faint' }, settings.get('exportFormat') === 'm4a' ? 'Lossless, larger file' : 'Smaller file'))),
      h('button', { class: 'row', onclick: async () => { api.close(); const m = await import('./export-video.mjs'); m.exportVideo(p, { bufferFor, backingBuffer, mixdown }); } }, ic('video'),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, 'Video (9:16)'), h('div', { class: 'small faint' }, 'Your stacked pitch lines with the mix, ready to post')))),
  ], { label: 'Export' });
}

/** Render the stacked mix offline → Float32 stereo [L, R] at the context rate */
export async function mixdown(p, { bufferFor, backingBuffer }) {
  await E.ensureContext();
  const sr = E.sampleRate();
  const dur = Math.max(p.duration, ...p.layers.map((l) => l.duration || 0)) + 0.5;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const anySolo = p.layers.some((l) => l.solo && !l.mute);
  const n = p.layers.filter((l) => !l.mute && (!anySolo || l.solo)).length;
  // gentle stereo spread so stacked parts are distinct
  let i = 0;
  const bb = backingBuffer ? await backingBuffer() : null;
  if (bb && !p.backingMute) { const s = off.createBufferSource(); s.buffer = bb; const g = off.createGain(); g.gain.value = p.backingGain; s.connect(g).connect(off.destination); s.start(0); }
  for (const l of p.layers) {
    if (l.mute || (anySolo && !l.solo)) continue;
    const buf = await bufferFor(l);
    if (!buf) continue;
    const s = off.createBufferSource(); s.buffer = buf;
    const g = off.createGain(); g.gain.value = l.gain;
    const pan = off.createStereoPanner(); pan.pan.value = n > 1 ? -0.5 + (i / (n - 1)) : 0;
    s.connect(g).connect(pan).connect(off.destination); s.start(0);
    i++;
  }
  const comp = off.createDynamicsCompressor();
  void comp;
  const rendered = await off.startRendering();
  const L = rendered.getChannelData(0), R = rendered.getChannelData(1);
  // normalise to -1 dBFS peak
  let peak = 0; for (let k = 0; k < L.length; k++) peak = Math.max(peak, Math.abs(L[k]), Math.abs(R[k]));
  const gain = peak > 0 ? 0.89 / peak : 1;
  if (gain < 1 || peak < 0.3) for (let k = 0; k < L.length; k++) { L[k] *= gain; R[k] *= gain; }
  return { L, R, sr, buffer: rendered };
}

export function encodeWav(L, R, sr) {
  const n = L.length, ch = R ? 2 : 1;
  const buf = new ArrayBuffer(44 + n * 2 * ch);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2 * ch, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2 * ch, true); v.setUint16(32, 2 * ch, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2 * ch, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); o += 2;
    if (R) { v.setInt16(o, Math.max(-1, Math.min(1, R[i])) * 32767, true); o += 2; }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** AAC in MP4 via WebCodecs + mp4 muxer; falls back to MediaRecorder; returns {blob, ext} */
export async function encodeM4a(L, R, sr) {
  if (window.AudioEncoder) {
    try {
      const cfg = { codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: 2, bitrate: 192000 };
      const sup = await AudioEncoder.isConfigSupported(cfg);
      if (sup.supported) {
        const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
        const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: 'aac', sampleRate: sr, numberOfChannels: 2 }, fastStart: 'in-memory' });
        const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { throw e; } });
        enc.configure(cfg);
        const F = 1024 * 4;
        for (let i = 0; i < L.length; i += F) {
          const n = Math.min(F, L.length - i);
          const data = new Float32Array(n * 2);
          data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
          enc.encode(new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sr) * 1e6), data }));
        }
        await enc.flush(); enc.close();
        muxer.finalize();
        return { blob: new Blob([muxer.target.buffer], { type: 'audio/mp4' }), ext: 'm4a' };
      }
    } catch (e) { console.warn('AAC encode failed, falling back', e); }
  }
  return null;
}

export async function exportAudio(p, sources, fmt) {
  toast('Mixing…', { ms: 1500 });
  const { L, R, sr } = await mixdown(p, sources);
  let out = null;
  if (fmt === 'm4a') out = await encodeM4a(L, R, sr);
  if (!out) { if (fmt === 'm4a') toast('M4A is not available on this device; saving WAV instead.'); out = { blob: encodeWav(L, R, sr), ext: 'wav' }; }
  await saveFile(out.blob, `${safeName(p.name)}.${out.ext}`);
}

export const safeName = (s) => (s || 'harmony').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'harmony';

export async function saveFile(blob, filename) {
  if (isNative()) {
    const C = { Plugins: { Filesystem: native('Filesystem'), Share: native('Share') } };
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
      const w = await C.Plugins.Filesystem.writeFile({ path: filename, data: b64, directory: 'CACHE' });
      await C.Plugins.Share.share({ title: filename, files: [w.uri], dialogTitle: 'Save or share' });
      return;
    } catch (e) { if (String(e?.message || e).includes('cancel')) return; console.warn(e); toast('Could not share the file'); return; }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(`Saved ${filename}`, { icon: 'check' });
}
void icon;
