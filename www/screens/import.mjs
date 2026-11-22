// Import a song: decode → separate vocals on device (Fast DSP or Quality Spleeter model) →
// extract melody into editable bars → project with the instrumental as a backing track.
import { h, topbar, seg, toast } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { back, go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { db, uid } from '../core/db.mjs';
import { newProject, saveNow, analyseTake, packFrames, nextColorIdx } from '../core/project.mjs';

const MODEL_KEY = 'model:spleeter-2stems-vocals-fp16:v1';
const MODEL_URLS = [
  'https://studymusictheory.com/harmony-trainer/models/vocals.fp16.onnx',
  'https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems-fp16/resolve/main/vocals.fp16.onnx',
];
const MODEL_BYTES = 19681017;
const MAX_SEC = 6 * 60;

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
  let mode = 'quality', file = null, busy = false;
  const body = h('div', { class: 'wrap' });
  const el = h('div', {}, topbar({ title: 'Import a song', back: () => back() }), h('div', { class: 'scroll' }, body));
  const input = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg', style: { display: 'none' }, onchange: () => { file = input.files[0] || null; draw(); } });
  const bar = h('div', { class: 'progressbar' }, h('i', { style: { width: '0%' } }));
  const status = h('p', { class: 'small dim', 'aria-live': 'polite' });

  function draw() {
    body.replaceChildren(
      h('div', { class: 'card prose' },
        h('p', {}, 'Bring in a song you have on your device. Harmony Trainer separates the vocal from the music ', h('b', {}, 'on this phone'), ', turns the sung melody into bars you can edit, and lets you sing harmony over the instrumental.'),
        h('p', { class: 'small faint' }, 'Use only music you have the right to use. The app ships no songs, and nothing is uploaded.')),
      h('div', { class: 'section' },
        h('button', { class: 'btn block ghost', onclick: () => input.click(), html: icon('import') + (file ? file.name.slice(0, 34) : 'Choose an audio file') }), input),
      h('div', { class: 'section' },
        h('div', { class: 'small dim', style: { margin: '0 4px 8px' } }, 'Separation quality'),
        seg([['fast', 'Fast'], ['quality', 'Quality']], mode, (v) => { mode = v; draw(); }, 'Separation mode'),
        h('p', { class: 'small faint', style: { margin: '8px 4px 0' } }, mode === 'fast'
          ? 'Instant. Pulls out centre-panned vocals with signal processing. Best for clean studio mixes.'
          : 'Uses a neural separation model (Spleeter, MIT licence). It runs entirely on this device and takes about a minute per song. The 20 MB model downloads once, on first use.')),
      h('div', { class: 'section' }, h('button', { class: 'btn primary block', disabled: !file || busy, onclick: go_, html: icon('wave') + (busy ? 'Working…' : 'Separate and extract melody') })),
      busy ? h('div', { class: 'section' }, bar, status) : null,
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
      let model = null;
      if (mode === 'quality') {
        try { model = await getModel((k) => setP(k * 0.3, `Downloading the separation model… ${Math.round(k * 100)}%`)); }
        catch { toast('Couldn’t download the model. Using Fast mode instead.', { ms: 3500 }); mode = 'fast'; }
      }
      const worker = new Worker(new URL('../audio/separate-worker.mjs', import.meta.url), { type: 'module' });
      const out = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          const d = e.data;
          if (d.error) reject(new Error(d.error));
          else if (d.progress != null) setP((mode === 'quality' ? 0.3 : 0) + d.progress * (mode === 'quality' ? 0.6 : 0.85), d.label);
          else resolve(d);
        };
        worker.onerror = (e) => reject(e.error || new Error('worker failed'));
        const transfer = R === L ? [L.buffer] : [L.buffer, R.buffer];
        worker.postMessage({ mode, L, R, sr, model }, transfer);
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
      const layer = { id: uid(), name: 'Original vocal', colorIdx: nextColorIdx(p), gain: 0.9, mute: false, solo: false, audioKey: vk, frames: packFrames(res.frames.filter((_, i) => i % 2 === 0)), role: 'melody', part: 'Imported vocal', notes: res.notes, duration: out.vocals.length / sr };
      p.layers.push(layer); p.baseLayerId = layer.id; p.notes = res.notes;
      p.key = res.key; p.keyCandidates = res.keyCandidates;
      p.duration = layer.duration;
      await saveNow(p);
      setP(1, 'Done');
      go(`/project/${p.id}`, { replace: true });
    } catch (e) {
      console.warn(e);
      toast(String(e?.message || '').includes('no melody') ? 'No clear vocal melody found in that song.' : 'Couldn’t import that file. Try MP3, M4A or WAV.', { ms: 3500 });
      busy = false; draw();
    }
  }
  draw();
  return { el };
}
