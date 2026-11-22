// Import a song: decode → separate the vocal on device (Spleeter model) → find the melody →
// open the player with the isolated vocal ready to play.
import { h, topbar, toast } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { back, go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { db, uid } from '../core/db.mjs';
import { newProject, saveNow, analyseTake, packFrames } from '../core/project.mjs';

const MODEL_KEY = 'model:spleeter-2stems-vocals-fp16:v1';
const MODEL_URLS = [
  'https://studymusictheory.com/harmony-trainer/models/vocals.fp16.onnx',
  'https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems-fp16/resolve/main/vocals.fp16.onnx',
];
const MODEL_BYTES = 19681017;
const MAX_SEC = 6 * 60;
const ACCEPT = 'audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg';

let handoff = null;
/** Open the file picker straight from a tap, then go to the import screen with the file. */
export function pickSong() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = ACCEPT; inp.style.display = 'none';
  inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (f) { handoff = f; go('/import'); } };
  document.body.append(inp);
  inp.click();
}

async function getModel(progress) {
  const cached = await db.getAudio(MODEL_KEY).catch(() => null);
  if (cached && cached.byteLength === MODEL_BYTES) return cached;
  let lastErr = null;
  for (const url of MODEL_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const buf = new Uint8Array(MODEL_BYTES);
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (got + value.length > buf.length) throw new Error('unexpected size');
        buf.set(value, got); got += value.length;
        progress(got / MODEL_BYTES);
      }
      if (got !== MODEL_BYTES) throw new Error('incomplete download');
      await db.putAudio(MODEL_KEY, buf.buffer);
      return buf.buffer;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('download failed');
}

export async function render() {
  let file = handoff, busy = false;
  handoff = null;
  const body = h('div', { class: 'wrap' });
  const el = h('div', {}, topbar({ title: 'Import a song', back: () => back() }), h('div', { class: 'scroll' }, body));
  const input = h('input', { type: 'file', accept: ACCEPT, style: { display: 'none' }, onchange: () => { file = input.files[0] || null; if (file) go_(); else draw(); } });
  const bar = h('div', { class: 'progressbar' }, h('i', { style: { width: '0%' } }));
  const status = h('p', { class: 'small dim', 'aria-live': 'polite' });

  function draw() {
    body.replaceChildren(
      h('div', { class: 'card prose' },
        h('p', {}, 'Pick a song on your phone. Harmony Trainer takes the vocal out of it ', h('b', {}, 'on this phone'), ', finds the melody and writes a harmony for it.'),
        h('p', { class: 'small faint' }, 'It takes about a minute. The first time, a 20 MB separation model downloads once. Use only music you have the right to use; nothing is uploaded.')),
      h('div', { class: 'section' },
        h('button', { class: 'btn primary block', disabled: busy, onclick: () => input.click(), html: icon('import') + (busy ? 'Working…' : file ? 'Choose a different song' : 'Choose a song') }), input),
      busy || file ? h('div', { class: 'section' }, file ? h('p', { class: 'small', style: { fontWeight: 650 } }, file.name) : null, busy ? bar : null, status) : null,
    );
  }

  async function go_() {
    if (!file || busy) return;
    busy = true; draw();
    const setP = (k, txt) => { bar.firstChild.style.width = `${Math.round(k * 100)}%`; if (txt) status.textContent = txt; };
    try {
      setP(0.01, 'Reading the file…');
      const ab = await file.arrayBuffer();
      const { buffer } = await E.decodeToMono(ab);
      if (buffer.duration > MAX_SEC) { toast('Please use a song under 6 minutes, or trim it first.'); busy = false; draw(); return; }
      const sr = buffer.sampleRate;
      const L = buffer.getChannelData(0).slice(), R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : L;
      let model;
      try { model = await getModel((k) => setP(k * 0.3, `Downloading the separation model… ${Math.round(k * 100)}%`)); }
      catch { throw new Error('model download'); }
      const worker = new Worker(new URL('../audio/separate-worker.mjs', import.meta.url), { type: 'module' });
      const out = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          const d = e.data;
          if (d.error) reject(new Error(d.error));
          else if (d.progress != null) setP(0.3 + d.progress * 0.6, d.label);
          else resolve(d);
        };
        worker.onerror = (e) => reject(e.error || new Error('worker failed'));
        const transfer = R === L ? [L.buffer] : [L.buffer, R.buffer];
        worker.postMessage({ L, R, sr, model }, transfer);
      });
      worker.terminate();
      setP(0.93, 'Finding the melody…');
      await new Promise((r) => setTimeout(r, 20));
      const res = analyseTake(out.vocals, sr);
      if (!res.notes.length) throw new Error('no melody found');
      const p = newProject(file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Imported song');
      p.imported = true;
      p.backingKey = uid();
      await db.putAudio(p.backingKey, out.backing);
      const vk = uid();
      await db.putAudio(vk, out.vocals);
      const layer = { id: uid(), name: 'Vocal', audioKey: vk, frames: packFrames(res.frames.filter((_, i) => i % 2 === 0)), notes: res.notes, duration: out.vocals.length / sr };
      p.layers.push(layer); p.baseLayerId = layer.id; p.notes = res.notes;
      p.key = res.key; p.keyCandidates = res.keyCandidates;
      p.duration = layer.duration;
      await saveNow(p);
      setP(1, 'Done');
      go(`/project/${p.id}`, { replace: true });
    } catch (e) {
      console.warn(e);
      const msg = String(e?.message || '');
      toast(msg.includes('no melody') ? 'No clear vocal melody found in that song.' : msg.includes('model download') ? 'Couldn’t download the separation model. Check your connection and try again.' : 'Couldn’t import that file. Try MP3, M4A or WAV.', { ms: 4000 });
      status.textContent = '';
      busy = false; draw();
    }
  }
  draw();
  return { el, mounted() { if (file) go_(); } };
}
