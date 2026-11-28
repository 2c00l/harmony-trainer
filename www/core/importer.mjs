// Import a song in the background: decode → take the vocal out on the device (Spleeter model)
// → find the melody → save the song. Progress shows in a slim bar at the bottom of every
// screen, so the app stays usable while it works.
import { h, toast, sheet, announce } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import * as E from '../audio/engine.mjs';
import { db, uid } from './db.mjs';
import { settings } from './settings.mjs';
import { newProject, saveNow, analyseTakeAsync, packFrames } from './project.mjs';

const MODEL_KEY = 'model:spleeter-2stems-vocals-fp16:v1'; // where older builds kept a downloaded copy
// Spleeter 2-stem vocal model (Deezer, MIT licence), shipped inside the app: no download, works offline
const MODEL_URL = new URL('../models/vocals.fp16.onnx', import.meta.url).href;
const MODEL_BYTES = 19681017;
const MAX_SEC = 6 * 60;
const MIN_PER_MIN = 3; // rough isolation time on a phone: minutes per minute of song
const ACCEPT = 'audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg';

let job = null; // {name, k, label, eta, done, error, projectId}
let barEl = null;

export const SONGS_CHANGED = 'ht-songs-changed';
export const importBusy = () => !!job && !job.done && !job.error;

/** Tap handler for "Import a song". The first time, explains what happens before the picker opens. */
export function pickSong() {
  if (importBusy()) { toast('A song is already being imported. Watch the bar at the bottom.'); return; }
  if (settings.meta('importExplained')) { openPicker(); return; }
  sheet((api) => [
    h('h2', {}, 'Import a song'),
    h('p', { class: 'dim', style: { marginTop: '8px' } }, 'Pick a song and PitchSense takes the vocal out of it, finds the melody and writes a harmony for it.'),
    h('ul', { class: 'small dim', style: { margin: '12px 0 0 18px', display: 'grid', gap: '6px' } },
      h('li', {}, `It takes roughly ${MIN_PER_MIN} minutes per minute of song. You can keep using the app while it works.`),
      h('li', {}, 'Everything is done on your phone. Your songs are never uploaded or stored on a server.'),
      h('li', {}, 'Only use music you have the right to use.')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn ghost', onclick: () => api.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => { settings.meta('importExplained', true); api.close(); openPicker(); }, html: icon('import') + 'Choose a song' })),
  ], { label: 'Import a song' });
}

function openPicker() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = ACCEPT; inp.style.display = 'none';
  inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (f) startImport(f); };
  document.body.append(inp);
  inp.click();
}

async function getModel() {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== MODEL_BYTES) throw new Error('model size');
  db.deleteAudio(MODEL_KEY).catch(() => {}); // free the space an older downloaded copy used
  return buf;
}

const mins = (s) => (s < 90 ? 'about a minute' : `about ${Math.round(s / 60)} min`);

export async function startImport(file) {
  if (importBusy()) return;
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Imported song';
  job = { name, k: 0, label: 'Reading the file…', eta: '', done: false, error: null, projectId: null, cancelled: false };
  const me = job;
  const check = () => { if (me.cancelled || job !== me) throw new Error('cancelled'); };
  drawBar();
  const set = (k, label, eta) => { if (me.cancelled || job !== me) return; me.k = k; if (label) me.label = label; if (eta !== undefined) me.eta = eta; drawBar(); };
  let worker = null;
  let partial = null, saved = false;
  try {
    if (file.size > 128*1024*1024) throw new Error('file too large');
    let ab = await file.arrayBuffer();
    check();
    let buffer = await E.decodeAudioBuffer(ab);
    ab = null;
    check();
    if (buffer.duration > MAX_SEC) throw new Error('too long');
    const sr = buffer.sampleRate;
    const L = buffer.getChannelData(0).slice(), R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : L;
    const estimate = buffer.duration * MIN_PER_MIN;
    buffer = null;
    set(0.02, 'Getting ready…', `${mins(estimate)} left`);
    let model;
    try { model = await getModel(); }
    catch { check(); throw new Error('model missing'); }
    check();
    worker = new Worker(new URL('../audio/separate-worker.mjs', import.meta.url), { type: 'module' });
    const t0 = performance.now();
    const out = await new Promise((resolve, reject) => {
      me.abort = () => reject(new Error('cancelled'));
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.error) reject(new Error(d.error));
        else if (d.progress != null) {
          // time left: the phone's own pace once it has some, the rough estimate before that
          const el = (performance.now() - t0) / 1000;
          const left = d.progress > 0.08 ? (el / d.progress) * (1 - d.progress) : Math.max(30, estimate - el);
          set(0.1 + d.progress * 0.82, 'Taking the vocal out', `${mins(left)} left`);
        } else resolve(d);
      };
      worker.onerror = (e) => reject(e.error || new Error('worker failed'));
      const transfer = R === L ? [L.buffer] : [L.buffer, R.buffer];
      worker.postMessage({ L, R, sr, model }, [...transfer, model]);
    });
    worker.terminate(); worker = null;
    set(0.94, 'Finding the melody…', '');
    const res = await analyseTakeAsync(out.vocals, sr, { signal: me });
    check();
    if (!res.notes.length) throw new Error('no melody found');
    const p = newProject(name);
    partial = p;
    p.imported = true;
    p.backingKey = uid();
    await db.putAudio(p.backingKey, out.backing);
    check();
    const vk = uid();
    p.layers.push({ audioKey:vk }); // cancellation/error cleanup also owns this write
    await db.putAudio(vk, out.vocals);
    check();
    const layer = { id: uid(), name: 'Vocal', audioKey: vk, sampleRate: sr, frames: packFrames(res.frames.filter((_, i) => i % 2 === 0)), notes: res.notes, duration: out.vocals.length / sr };
    p.layers = [layer]; p.baseLayerId = layer.id; p.notes = res.notes;
    p.key = res.key; p.keyCandidates = res.keyCandidates;
    p.duration = layer.duration;
    await saveNow(p);
    check(); saved = true;
    me.done = true; me.projectId = p.id; me.k = 1; me.label = 'Ready'; me.eta = '';
    drawBar();
    announce(`${name} is ready`, { force: true });
    window.dispatchEvent(new Event(SONGS_CHANGED));
  } catch (e) {
    worker?.terminate();
    if (me.cancelled || job !== me) return;
    console.warn(e);
    const msg = String(e?.message || '');
    job.error = msg.includes('file too large') ? 'Please use a file under 128 MB. MP3 or M4A uses much less space than WAV.'
      : msg.includes('too long') ? 'Please use a song under 6 minutes, or trim it first.'
      : msg.includes('no melody') ? 'No clear vocal melody was found in that song.'
        : msg.includes('model missing') ? 'The vocal separation file is missing from the app. Please reinstall PitchSense.'
          : 'Couldn’t import that file. Try MP3, M4A or WAV.';
    drawBar();
  } finally {
    worker?.terminate();
    if (partial && !saved) await db.deleteProject(partial).catch(() => {});
  }
}

function drawBar() {
  if (!job) { barEl?.remove(); barEl = null; setInset(); return; }
  if (!barEl) {
    barEl = h('div', { class: 'importbar', role: 'status', 'aria-live': 'polite' });
    document.body.append(barEl);
    new ResizeObserver(setInset).observe(barEl);
  }
  const close = () => { job = null; drawBar(); };
  if (job.error) {
    barEl.replaceChildren(h('div', { class: 'ib-row' }, h('span', { class: 'ib-icon err', html: icon('warn') }), h('div', { class: 'grow small' }, job.error), h('button', { class: 'iconbtn', 'aria-label': 'Dismiss', html: icon('close'), onclick: close })));
  } else if (job.done) {
    barEl.replaceChildren(h('div', { class: 'ib-row' }, h('span', { class: 'ib-icon ok', html: icon('check') }),
      h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ib-name' }, job.name), h('div', { class: 'small faint' }, 'Vocal isolated. Ready to play.')),
      h('button', { class: 'btn sm primary', onclick: async () => { const id = job.projectId; close(); (await import('../app.mjs')).go(`/project/${id}`); } }, 'Open'),
      h('button', { class: 'iconbtn', 'aria-label': 'Dismiss', html: icon('close'), onclick: close })));
  } else {
    const pct = Math.round(job.k * 100);
    barEl.replaceChildren(
      h('div', { class: 'ib-row' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ib-name' }, `Importing ${job.name}`), h('div', { class: 'small faint' }, [job.label, job.eta].filter(Boolean).join(' · '))),
        h('span', { class: 'small mono dim' }, `${pct}%`),
        h('button', { class: 'btn sm ghost', 'aria-label': `Cancel importing ${job.name}`, onclick: cancelImport }, 'Cancel')),
      h('div', { class: 'progressbar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Import progress' }, h('i', { style: { width: `${pct}%` } })));
  }
}

function cancelImport() {
  if (!job || job.done) return;
  job.cancelled = true;
  job.abort?.();
  job = null; drawBar();
  toast('Import cancelled');
}

// the screens sit above the bar instead of underneath it
function setInset() {
  document.documentElement.style.setProperty('--ib', barEl ? `${barEl.offsetHeight}px` : '0px');
  window.dispatchEvent(new Event('resize'));
}
