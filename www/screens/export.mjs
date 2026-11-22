// Export a song as audio (M4A or WAV) or as a 9:16 video of the notes scrolling past.
// Everything is made on the phone; the file goes to the share sheet (Save, Files, WhatsApp…).
import { h, sheet, toast } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
const ic = (name) => h('span', { style: { width: '24px', height: '24px', display: 'inline-flex', flex: 'none', color: 'var(--accent)' }, html: icon(name) });
import { native, isNative } from '../core/native.mjs';
import * as E from '../audio/engine.mjs';

/**
 * src: {
 *   parts: [{id, label, on, get: () => Promise<{buffer, gain, at}>}]   what can be in the mix
 *   view: () => ({lines, targets, key})                                  what the video shows
 *   from, to: musical seconds to export
 * }
 */
export function openExport(p, src) {
  const chosen = new Map(src.parts.map((x) => [x.id, x.on]));
  const box = (x) => {
    const inp = h('input', { type: 'checkbox', onchange: () => chosen.set(x.id, inp.checked) });
    inp.checked = !!x.on;
    return h('label', { class: 'tick' }, inp, h('span', {}, x.label));
  };
  const pick = () => src.parts.filter((x) => chosen.get(x.id));
  const go = (fn) => async () => { if (!pick().length) { toast('Tick at least one part to include.'); return; } api.close(); await fn(); };
  const api = sheet(() => [
    h('h2', {}, 'Export'),
    h('p', { class: 'dim small' }, 'Made on your phone, then you choose where to save or send it.'),
    h('div', { class: 'small dim', style: { margin: '14px 2px 6px' } }, 'Include'),
    h('div', { class: 'ticks' }, ...src.parts.map(box)),
    h('div', { class: 'list', style: { marginTop: '14px' } },
      h('button', { class: 'row', onclick: go(() => exportVideo(p, src, pick())) }, ic('video'),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, 'Video'), h('div', { class: 'small faint' }, 'The notes and harmony scrolling past, with the sound. Portrait, ready to post.'))),
      h('button', { class: 'row', onclick: go(() => exportAudio(p, src, pick(), 'm4a')) }, ic('export'),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, 'Audio (M4A)'), h('div', { class: 'small faint' }, 'Small file, plays anywhere'))),
      h('button', { class: 'row', onclick: go(() => exportAudio(p, src, pick(), 'wav')) }, ic('export'),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, 'Audio (WAV)'), h('div', { class: 'small faint' }, 'Full quality, bigger file')))),
  ], { label: 'Export' });
}

/** Mix the chosen parts offline → stereo Float32 at the context rate, from..to */
export async function mixdown(parts, from, to) {
  await E.ensureContext();
  const sr = E.sampleRate();
  const dur = Math.max(0.5, to - from);
  const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  for (const x of parts) {
    const l = await x.get();
    if (!l?.buffer) continue;
    const s = off.createBufferSource(); s.buffer = l.buffer;
    const g = off.createGain(); g.gain.value = l.gain ?? 1;
    s.connect(g).connect(off.destination);
    const o = from - (l.at || 0);
    if (o >= 0) { if (o < l.buffer.duration) s.start(0, o); } else s.start(-o, 0);
  }
  const rendered = await off.startRendering();
  const L = rendered.getChannelData(0), R = rendered.getChannelData(1);
  let peak = 0; for (let k = 0; k < L.length; k++) peak = Math.max(peak, Math.abs(L[k]), Math.abs(R[k]));
  const gain = peak > 0 ? 0.89 / peak : 1; // normalise to −1 dBFS
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

/** AAC in MP4 via WebCodecs; null when the device can't */
export async function encodeM4a(L, R, sr) {
  if (!window.AudioEncoder) return null;
  try {
    const cfg = { codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: 2, bitrate: 192000 };
    if (!(await AudioEncoder.isConfigSupported(cfg)).supported) return null;
    const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
    const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: 'aac', sampleRate: sr, numberOfChannels: 2 }, fastStart: 'in-memory' });
    let err = null;
    const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { err = e; } });
    enc.configure(cfg);
    const F = 4096;
    for (let i = 0; i < L.length; i += F) {
      const n = Math.min(F, L.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      enc.encode(new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sr) * 1e6), data }));
    }
    await enc.flush(); enc.close();
    if (err) throw err;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'audio/mp4' });
  } catch (e) { console.warn('AAC encode failed', e); return null; }
}

function progressSheet(title) {
  let cancelled = false;
  const bar = h('div', { class: 'progressbar' }, h('i', { style: { width: '0%' } }));
  const label = h('p', { class: 'small dim', 'aria-live': 'polite', style: { margin: '8px 0 12px' } }, 'Mixing…');
  const api = sheet((a) => [h('h2', {}, title), label, bar, h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { cancelled = true; a.close(); } }, 'Cancel'))], { onClose: () => { cancelled = true; }, label: title });
  return { set: (k, t) => { bar.firstChild.style.width = `${Math.round(k * 100)}%`; if (t) label.textContent = t; }, cancelled: () => cancelled, close: () => api.close() };
}

export async function exportAudio(p, src, parts, fmt) {
  const ui = progressSheet('Making your audio');
  try {
    const { L, R, sr } = await mixdown(parts, src.from, src.to);
    if (ui.cancelled()) return;
    ui.set(0.6, 'Encoding…');
    let blob = fmt === 'm4a' ? await encodeM4a(L, R, sr) : null;
    let ext = 'm4a';
    if (!blob) { if (fmt === 'm4a') toast('M4A isn’t available on this phone, so it’s saved as WAV.'); blob = encodeWav(L, R, sr); ext = 'wav'; }
    if (ui.cancelled()) return;
    ui.close();
    await saveFile(blob, `${safeName(p.name)}.${ext}`);
  } catch (e) { console.warn(e); ui.close(); toast('Couldn’t make the audio file.'); }
}

export async function exportVideo(p, src, parts) {
  const ui = progressSheet('Making your video');
  try {
    const mix = await mixdown(parts, src.from, src.to);
    if (ui.cancelled()) return;
    const { makeStage, encodeWebCodecs, encodeRealtime } = await import('./export-video.mjs');
    const stage = makeStage(p, src.view(), src.from);
    let blob = null;
    try { blob = await encodeWebCodecs(stage, mix, (k) => ui.set(k, `Drawing the video… ${Math.round(k * 100)}%`), ui.cancelled); }
    catch (e) { console.warn('WebCodecs video failed, using real-time capture', e); }
    if (!blob && !ui.cancelled()) blob = await encodeRealtime(stage, mix, (k) => ui.set(k, `Recording the video in real time… ${Math.round(k * 100)}%`), ui.cancelled);
    stage.destroy();
    if (ui.cancelled() || !blob) return;
    ui.close();
    await saveFile(blob, `${safeName(p.name)}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  } catch (e) { console.warn(e); ui.close(); toast('Couldn’t make the video on this phone.'); }
}

export const safeName = (s) => (s || 'harmony').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'harmony';

export async function saveFile(blob, filename) {
  if (isNative()) {
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
      const w = await native('Filesystem').writeFile({ path: filename, data: b64, directory: 'CACHE' });
      await native('Share').share({ title: filename, files: [w.uri], dialogTitle: 'Save or share' });
    } catch (e) { if (!String(e?.message || e).toLowerCase().includes('cancel')) { console.warn(e); toast('Couldn’t share the file.'); } }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(`Saved ${filename}`, { icon: 'check' });
}
