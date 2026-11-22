// Song player: the vocal (recorded or isolated) with its melody bars and a harmony part.
// Play starts straight away from wherever the playhead is; drag the notes or the slider to move.
// Transpose shifts the real audio (vocal and music) without changing the speed.
// "Sing and record" plays the song and records you over it as a take you can play back.
// /project/new records a melody first, then becomes the player.
import { h, iconBtn, sheet, toast, seg, toggle, fmtTime, haptic, infoBtn, announce, confirmSheet } from '../ui/ui.mjs';
const ic = (name) => h('span', { style: { width: '24px', height: '24px', display: 'inline-flex', flex: 'none', color: 'var(--accent)' }, html: icon(name) });
import { icon } from '../ui/icons.mjs';
import { SingView } from '../ui/singview.mjs';
import { back, go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { db, uid } from '../core/db.mjs';
import { settings, HARMONY_OPTIONS } from '../core/settings.mjs';
import { saveNow, autosave, analyseTakeAsync, packFrames, unpackFrames, harmonyTargets, harmonyLabel, newProject, dropOutliers } from '../core/project.mjs';
import { keyName, noteLabel, snapToKey, SHARP_NAMES, MODES } from '../dsp/theory.mjs';
import { micGate } from './mic-gate.mjs';
import { askName } from './songs.mjs';
import { openExport } from './export.mjs';

const MAX_REC = 5 * 60;
const MAX_TR = 7;
const fmtSemis = (t) => (t > 0 ? `+${t}` : t < 0 ? `−${-t}` : '0');
const shiftKey = (k, t) => (k ? { ...k, root: (((k.root + t) % 12) + 12) % 12 } : k);

export async function render(id) {
  let p;
  if (id === 'new') {
    const n = (await db.listProjects().catch(() => [])).length;
    p = newProject(`My song ${n + 1}`);
  } else p = await db.getProject(id);
  if (!p) { go('/', { replace: true }); return { el: h('div') }; }
  p._buf = {};
  // older songs: clear out stray notes (the odd whistle) using the stored raw pitch
  if (p.notes?.length && p.v !== 2) {
    const kept = new Set(dropOutliers(p.notes.map((n) => ({ ...n, midiRaw: n.raw ?? n.midi }))).map((n) => n.id));
    p.notes = p.notes.filter((n) => kept.has(n.id));
    p.v = 2; autosave(p);
  }
  p.takes = p.takes || [];
  const vocal = () => p.layers.find((l) => l.id === p.baseLayerId) || p.layers[0];
  const take = () => p.takes.find((t) => t.id === p.takeId) || p.takes[p.takes.length - 1] || null;
  let mode = vocal() ? 'player' : 'record';
  let playing = null, recording = false, alive = true;
  let tr = p.transpose || 0; // semitones the audio (and everything drawn) is moved by
  let taking = false, takeFrames = [], unTakePitch = null, busyMsg = '';
  let harm = [];
  const firstStart = () => (p.notes.length ? Math.max(0, p.notes[0].start - 1.2) : 0);
  const takeEnd = () => { const t = p.playTake && take(); return t ? t.at + t.duration : 0; };
  const endTime = () => Math.max(p.duration || 0, takeEnd(), ...p.notes.map((n) => n.end));
  let redo = null; // the melody being replaced while recording it again
  let deleted = false;
  let finding = null; // note-finding in progress (cancellable)
  let pos = firstStart();

  const sv = new SingView({ roll: { nowX: mode === 'player' ? 0.3 : 0.72 } });
  const roll = sv.roll;
  const keyChip = h('button', { class: 'chip', onclick: keySheet, 'aria-label': 'Key' });
  const titleEl = h('button', { class: 'title', style: { textAlign: 'left' }, onclick: rename, role: 'heading', 'aria-level': '1' }, p.name);
  const el = h('div', {},
    h('header', { class: 'topbar' }, iconBtn('back', 'Back', () => back()), titleEl, keyChip,
      iconBtn('share', 'Export audio or video', exportSheet),
      iconBtn('dots', 'More: help, settings, rename, delete', moreSheet)),
    sv.el);
  const dock = h('div', { class: 'dock' });
  el.append(dock);

  // ---------- audio ----------
  async function baseBuffer(key, slot) {
    if (!key) return null;
    if (!p._buf[slot]) { const s = await db.getAudio(key); if (!s) return null; await E.ensureContext(); p._buf[slot] = E.makeBuffer(s); }
    return p._buf[slot];
  }
  // transposed copies are made in a worker, once per amount, and kept while it stays the same
  const shifted = new Map();
  async function bufferFor(key, slot) {
    if (!key) return null;
    if (!tr) return baseBuffer(key, slot);
    const amt = tr;
    const k = `${slot}@${amt}`;
    if (!shifted.has(k)) {
      const store = `${key}@${amt}`;
      const job = (async () => {
        const saved = await db.getAudio(store).catch(() => null);
        if (saved) { await E.ensureContext(); return E.makeBuffer(saved); }
        const base = await baseBuffer(key, slot);
        if (!base) return null;
        const b = await shiftBuffer(base, amt);
        // keep it for next time, unless the amount changed or the song was left meanwhile
        if (alive && amt === tr) {
          db.putAudio(store, b.getChannelData(0).slice()).then(() => {
            if (!alive || deleted || amt !== tr) { db.deleteAudio(store).catch(() => {}); return; }
            p.shiftKeys = [...new Set([...(p.shiftKeys || []), store])];
            autosave(p);
          }).catch(() => {});
        }
        return b;
      })();
      job.then(() => { job.done = true; }, () => shifted.delete(k));
      shifted.set(k, job);
    }
    return shifted.get(k);
  }
  // keep only the saved copies for the current amount
  function dropOldShifts() {
    const keep = (p.shiftKeys || []).filter((k) => k.endsWith(`@${tr}`));
    for (const k of p.shiftKeys || []) if (!keep.includes(k)) db.deleteAudio(k).catch(() => {});
    p.shiftKeys = keep;
  }
  function shiftBuffer(buf, semis) {
    return new Promise((res, rej) => {
      const w = new Worker(new URL('../audio/shift-worker.mjs', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { w.terminate(); if (e.data.error) rej(new Error(e.data.error)); else res(E.makeBuffer(e.data.out, buf.sampleRate)); };
      w.onerror = (e) => { w.terminate(); rej(e.error || new Error('transpose failed')); };
      const samples = buf.getChannelData(0).slice();
      w.postMessage({ samples, sr: buf.sampleRate, semis }, [samples.buffer]);
    });
  }
  const isReady = (slot) => !tr || !!shifted.get(`${slot}@${tr}`)?.done;
  function prepare() {
    // drop copies for other amounts, then start the current one in the background
    for (const k of [...shifted.keys()]) if (!k.endsWith(`@${tr}`)) shifted.delete(k);
    if (!tr || mode !== 'player') return;
    const want = [['vocal', vocal()?.audioKey], ['backing', p.backingKey]].filter(([, k]) => k);
    Promise.all(want.map(([slot, k]) => bufferFor(k, slot))).catch(() => {});
  }
  let prepTimer = null;
  function setTranspose(t) {
    t = Math.max(-MAX_TR, Math.min(MAX_TR, t));
    if (t === tr) return;
    stop();
    tr = t; p.transpose = t;
    dropOldShifts(); autosave(p);
    refreshRoll(); renderDock();
    announce(t ? `Transposed ${t > 0 ? 'up' : 'down'} ${Math.abs(t)} semitone${Math.abs(t) === 1 ? '' : 's'}` : 'Original key', { force: true });
    clearTimeout(prepTimer);
    prepTimer = setTimeout(prepare, 450);
  }

  // Cancel (or Back) while transposing or finding notes: give the controls back straight away
  let playCancelled = false;
  function cancelBusy() {
    if (finding) finding.cancelled = true;
    if (starting) playCancelled = true;
    busyMsg = ''; starting = false;
    renderDock();
  }
  let starting = false;
  async function play() {
    if (playing || recording || starting) return;
    starting = true; playCancelled = false;
    try {
      await E.ensureContext();
      if (pos >= endTime() - 0.2) pos = firstStart();
      const v = vocal();
      const wantVocal = settings.get('playVocal'), wantMusic = !!p.backingKey && settings.get('playMusic');
      if ((wantVocal && !isReady('vocal')) || (wantMusic && !isReady('backing'))) { busyMsg = 'Transposing…'; renderDock(); }
      const layers = [];
      try {
        if (wantVocal) layers.push({ buffer: await bufferFor(v.audioKey, 'vocal'), gain: settings.get('vocalVolume') });
        if (wantMusic) layers.push({ buffer: await bufferFor(p.backingKey, 'backing'), gain: settings.get('musicVolume') });
      } catch (e) {
        console.warn(e);
        toast('Couldn’t transpose this song. Playing it in the original key.');
        tr = 0; p.transpose = 0; autosave(p); refreshRoll();
        layers.length = 0;
        if (wantVocal) layers.push({ buffer: await baseBuffer(v.audioKey, 'vocal'), gain: settings.get('vocalVolume') });
        if (wantMusic) layers.push({ buffer: await baseBuffer(p.backingKey, 'backing'), gain: settings.get('musicVolume') });
      }
      if (playCancelled) { if (taking) endTake(); return; }
      busyMsg = '';
      const tk = take();
      if (!wantVocal && !wantMusic && !(tk && p.playTake) && !taking) toast('Vocal and Music are both off, so you will only see the notes.', { ms: 3000 });
      if (tk && p.playTake && !taking) layers.push({ buffer: await baseBuffer(tk.audioKey, `take:${tk.id}`), gain: settings.get('takeVolume'), at: tk.at });
      const singAlong = settings.get('singAlong') || taking;
      if (singAlong && settings.meta('micOk')) await E.startMic().catch(() => {});
      else if (!singAlong) E.stopMic();
      E.setPlaybackPitchProvider(wantVocal ? (ct) => {
        if (!playing) return null;
        const m = playing.toMusical(ct - E.outputLatency());
        const tgt = harm.find((t) => m >= t.start && m <= t.end);
        const out = p.notes.filter((n) => m >= n.start && m <= n.end).map((n) => n.midi + tr);
        // the harmony note is what the singer should sing: never treat it as bleed
        return tgt ? out.filter((x) => Math.abs(x - tgt.midi) > 0.5) : out;
      } : null);
      if (!alive) return;
      const T = await E.play({ layers, from: pos });
      if (!alive) { T.stop(); return; }
      playing = T;
      sv.startTransport(T);
      sv.showLive = singAlong && E.micActive();
      if (sv.hudEl) sv.hudEl.style.display = sv.showLive ? '' : 'none';
      renderDock();
    } finally { starting = false; }
  }
  function endTake() { const r = E.stopRecording(); taking = false; unTakePitch?.(); unTakePitch = null; return r; }
  function stop() {
    if (!playing) { if (taking) endTake(); return; }
    const T = playing;
    const at = T.heard();
    const rec = taking ? endTake() : null;
    T.stop(); playing = null;
    sv.transport = null;
    pos = Math.max(0, Math.min(endTime(), at));
    E.setPlaybackPitchProvider(null);
    if (!settings.get('singAlong') || !alive) E.stopMic();
    sv.showLive = false;
    if (sv.hudEl) sv.hudEl.style.display = 'none';
    if (rec) saveTake(rec, T, at, takeFrames);
    if (dock.isConnected) renderDock();
  }

  // ---------- sing over the song and keep it as a take ----------
  async function recordTake() {
    if (playing || starting || mode !== 'player') return;
    if (!(await micGate(sv.el))) return;
    try { await E.startMic(); } catch { toast('Microphone unavailable'); return; }
    if (E.onSpeaker() && !recordTake.tipped) { recordTake.tipped = true; toast('Tip: headphones keep the song out of your recording.', { ms: 3000 }); }
    takeFrames = [];
    E.startRecording();
    taking = true;
    await play();
    if (!playing) { if (taking) endTake(); renderDock(); return; }
    const lat = E.roundTripLatency();
    let n = 0;
    unTakePitch = E.onPitch((f) => { if (playing && (n++ & 1) === 0) takeFrames.push({ t: playing.toMusical(f.t - lat), midi: f.midi }); });
    haptic('medium');
    renderDock();
    announce('Recording. Sing along.', { force: true });
  }
  async function saveTake(rec, T, endAt, frames) {
    const sr = E.sampleRate();
    // index in the recording of the moment the song's start point was heard
    const offset = Math.round((T.tStart + E.roundTripLatency()) * sr) - rec.startFrame;
    let s;
    if (offset >= 0) s = rec.samples.subarray(offset);
    else { s = new Float32Array(rec.samples.length - offset); s.set(rec.samples, -offset); }
    s = s.slice(0, Math.max(0, Math.min(s.length, Math.round((endAt - T.from + 0.3) * sr))));
    if (s.length < sr) { toast('That take was too short to keep.'); return; }
    const t = { id: uid(), name: `Take ${p.takes.length + 1}`, audioKey: uid(), at: T.from, duration: s.length / sr, created: Date.now(), transpose: tr, frames: packFrames(frames.filter((f) => f.t >= T.from - 0.1)) };
    try { await db.putAudio(t.audioKey, s); } catch { toast('Couldn’t save the take. Your device may be out of space.'); return; }
    p.takes.push(t); p.takeId = t.id; p.playTake = true;
    await saveNow(p).catch(() => {});
    if (!alive) return;
    refreshRoll(); renderDock();
    toast(`${t.name} saved. Press play to hear yourself with the song.`, { ms: 3600 });
  }
  function takesSheet() {
    let box;
    const content = (api) => [
      h('h2', {}, 'My takes'),
      h('p', { class: 'small dim' }, 'Recordings of you singing along. Tick “My take” to hear the chosen one with the song.'),
      p.takes.length ? h('div', { class: 'list', style: { marginTop: '10px' } }, ...p.takes.slice().reverse().map((t) => h('div', { class: 'row' },
        h('button', { class: 'grow', style: { textAlign: 'left', minHeight: '48px', display: 'flex', alignItems: 'center', gap: '10px' }, 'aria-pressed': String(take() === t), onclick: () => { p.takeId = t.id; p.playTake = true; saveNow(p); refreshRoll(); renderDock(); redraw(api); } },
          h('span', { style: { width: '22px', color: 'var(--accent)', display: 'inline-flex' }, html: take() === t ? icon('check') : '' }),
          h('span', {}, h('div', { style: { fontWeight: 700 } }, t.name), h('div', { class: 'small faint' }, `From ${fmtTime(t.at)} · ${fmtTime(t.duration)} long${(t.transpose || 0) !== tr ? ` · sung at transpose ${fmtSemis(t.transpose || 0)}` : ''}`))),
        h('button', { class: 'iconbtn', 'aria-label': `Delete ${t.name}`, html: icon('trash'), onclick: async () => {
          if (!(await confirmSheet({ title: `Delete ${t.name}?`, body: 'This recording is removed from this device.', ok: 'Delete', danger: true }))) return;
          await db.deleteAudio(t.audioKey).catch(() => {});
          p.takes = p.takes.filter((x) => x !== t); delete p._buf[`take:${t.id}`];
          if (p.takeId === t.id) p.takeId = p.takes[p.takes.length - 1]?.id || null;
          if (!p.takes.length) p.playTake = false;
          saveNow(p); refreshRoll(); renderDock();
          if (p.takes.length) takesSheet();
        } })))) : h('p', { class: 'dim', style: { marginTop: '12px' } }, 'No takes yet.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => api.close() }, 'Done')),
    ];
    function redraw(api) { const grab = box.querySelector('.grab'); box.replaceChildren(grab, ...content(api)); }
    const api = sheet((a) => content(a), { label: 'My takes' });
    box = api.el;
  }
  async function restart() { if (playing && !taking) { stop(); await play(); } }
  function seek(t) { if (taking) return; const was = !!playing; stop(); pos = Math.max(0, Math.min(endTime(), t)); if (was) play(); else renderDock(); }

  // ---------- roll content ----------
  const lbl = (m) => noteLabel(m, { style: settings.get('labels'), accidentals: settings.get('accidentals'), key: shiftKey(p.key, tr), octave: false });
  function refreshRoll() {
    keyChip.textContent = p.key ? keyName(shiftKey(p.key, tr), settings.get('accidentals')) : 'Key';
    keyChip.style.display = mode === 'player' ? '' : 'none';
    if (mode === 'record') { roll.set({ mode: 'scroll', follow: true, targets: [], lines: [], followTarget: null, semisGoal: null, nowX: 0.72, semis: settings.get('zoom') }); return; }
    harm = harmonyTargets(p).map((t) => ({ ...t, midi: t.midi + tr }));
    const named = settings.get('barLabels');
    const targets = p.notes.map((n) => ({ ...n, midi: n.midi + tr, kind: 'ghost', label: named ? lbl(n.midi + tr) : undefined }));
    if (settings.get('showHarmony')) for (const t of harm) targets.push({ ...t, kind: 'target', label: named ? lbl(t.midi) : undefined });
    const v = vocal();
    v._frames = v._frames || unpackFrames(v.frames);
    if (v._shiftedBy !== tr || !v._shifted) { v._shifted = v._frames.map((f) => ({ t: f.t, midi: f.midi == null ? null : f.midi + tr })); v._shiftedBy = tr; }
    const lines = [{ frames: v._shifted, color: roll.colors['--c-violet'], alpha: 0.75, width: 2 }];
    const tk = take();
    if (tk && p.playTake) { tk._frames = tk._frames || unpackFrames(tk.frames); lines.push({ frames: tk._frames, color: roll.colors['--c-coral'], alpha: 0.8, width: 2 }); }
    roll.set({ mode: 'scroll', follow: true, key: shiftKey(p.key, tr), targets, nowX: 0.3, lines });
    sv.setTargets(targets);
  }

  // follow the part being played, zoomed in to just the notes around the playhead
  function frame() {
    if (!alive) return;
    if (mode === 'player') {
      const now = playing ? playing.heard() : pos;
      if (!playing) sv.freeze = pos;
      const ms = [];
      for (const n of p.notes) if (n.end > now - 1.5 && n.start < now + 4) ms.push(n.midi + tr);
      if (settings.get('showHarmony')) for (const t of harm) if (t.end > now - 1.5 && t.start < now + 4) ms.push(t.midi);
      if (ms.length) {
        const lo = Math.min(...ms), hi = Math.max(...ms);
        roll.set({ followTarget: (lo + hi) / 2, semisGoal: Math.max(9, Math.min(16, hi - lo + 5)) });
      } else roll.set({ followTarget: null });
      if (playing) {
        pos = now;
        const pastEnd = taking && settings.get('recordPastEnd');
        if (now > endTime() + (pastEnd ? MAX_REC : 0.4)) { stop(); pos = firstStart(); renderDock(); }
        updatePosUi();
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- dock ----------
  let posSlider = null, timeEl = null, lastUi = 0;
  function updatePosUi() {
    const t = performance.now();
    if (t - lastUi < 120 || !timeEl) return;
    lastUi = t;
    if (posSlider && !posSlider.matches(':active')) posSlider.value = String(pos);
    fillPos();
    timeEl.textContent = `${fmtTime(pos)} / ${fmtTime(endTime())}`;
  }
  function fillPos() { if (posSlider) posSlider.style.setProperty('--p', `${(100 * pos) / Math.max(1, endTime())}%`); }
  function tick(label, id, extra) {
    const inp = h('input', { type: 'checkbox', onchange: () => { settings.set(id, inp.checked); haptic('light'); extra?.(); } });
    inp.checked = !!settings.get(id);
    return h('label', { class: 'tick' }, inp, h('span', {}, label));
  }
  function renderDock() {
    dock.replaceChildren();
    const active = !!(playing || recording || busyMsg);
    dock.classList.toggle('compact', active);
    // while playing or recording the top bar steps aside too, so the notes get the screen
    el.classList.toggle('immersive', !!(playing || recording));
    if (mode === 'record') { dock.append(recordDock()); return; }
    timeEl = h('span', { class: 'small mono dim', style: { whiteSpace: 'nowrap' } }, `${fmtTime(pos)} / ${fmtTime(endTime())}`);
    posSlider = null;
    if (busyMsg) { dock.append(h('div', { class: 'bar', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('div', { class: 'grow' }, busyMsg), h('button', { class: 'btn sm ghost', onclick: cancelBusy }, 'Cancel'))); return; }
    if (playing) {
      // while playing, the dock shrinks to one slim row so the notes get the screen
      dock.append(h('div', { class: 'bar' },
        h('button', { class: 'recbtn play', style: { width: '48px', height: '48px' }, 'aria-label': taking ? 'Stop and save the take' : 'Stop', html: icon('stop'), onclick: stop }),
        taking ? h('span', { class: 'recdot', role: 'status' }, 'Recording') : null,
        h('div', { class: 'grow', style: { textAlign: 'right' } }, timeEl)));
      return;
    }
    const big = h('button', { class: 'recbtn play', style: { width: '64px', height: '64px' }, 'aria-label': 'Play', html: icon('play'), onclick: () => play() });
    const folded = !!settings.meta('dockFolded');
    const fold = h('button', { class: 'iconbtn', 'aria-label': folded ? 'Show all controls' : 'Fold the controls away', 'aria-expanded': String(!folded), title: folded ? 'More controls' : 'Fewer controls', html: icon(folded ? 'up' : 'down'), onclick: () => { settings.meta('dockFolded', !folded); renderDock(); announce(folded ? 'All controls shown' : 'Controls folded away', { force: true }); } });
    const recB = h('button', { class: 'recbtn', style: { width: '52px', height: '52px' }, 'aria-label': 'Sing along and record', title: 'Sing along and record', html: icon('record'), onclick: recordTake });
    const skip = (d, name) => h('button', { class: 'iconbtn', 'aria-label': d < 0 ? 'Back 5 seconds' : 'Forward 5 seconds', html: icon(name), onclick: () => seek(pos + d) });
    posSlider = h('input', { type: 'range', min: '0', max: String(Math.max(1, endTime())), step: '0.1', 'aria-label': 'Position in the song', class: 'pos' });
    posSlider.value = String(pos);
    fillPos();
    posSlider.addEventListener('input', () => { pos = Number(posSlider.value); fillPos(); timeEl.textContent = `${fmtTime(pos)} / ${fmtTime(endTime())}`; });
    posSlider.addEventListener('change', () => renderDock());
    const jump = p.notes.length && pos < p.notes[0].start - 2 ? h('button', { class: 'chip', onclick: () => seek(firstStart()) }, 'Jump to the singing') : null;
    const H = settings.get('harmonyType'), O = settings.get('harmonyOctave');
    let takeTick = null;
    if (p.takes.length) {
      const inp = h('input', { type: 'checkbox', onchange: () => { p.playTake = inp.checked; saveNow(p); refreshRoll(); haptic('light'); } });
      inp.checked = !!p.playTake;
      takeTick = h('label', { class: 'tick' }, inp, h('span', {}, 'My take'));
    }
    const transport = h('div', { class: 'bar', style: { justifyContent: 'center' } }, skip(-5, 'left'), big, skip(5, 'right'), recB, h('div', { class: 'grow', style: { textAlign: 'right' } }, timeEl), fold);
    if (folded) { dock.append(transport, posSlider); return; }
    dock.append(
      transport,
      posSlider,
      h('div', { class: 'ticks' },
        tick('Show harmony', 'showHarmony', refreshRoll),
        tick('Vocal', 'playVocal'),
        p.backingKey ? tick('Music', 'playMusic') : null,
        takeTick),
      h('div', { class: 'chips' },
        h('button', { class: 'chip on', onclick: harmonySheet, html: icon('layers') + `Harmony: ${harmonyLabel(H)}${O === 'up' ? ' · octave up' : O === 'down' ? ' · octave down' : ''} ▾` }),
        h('span', { class: 'trans', role: 'group', 'aria-label': 'Transpose' },
          h('button', { class: 'chip', 'aria-label': 'Transpose down a semitone', disabled: tr <= -MAX_TR, onclick: () => setTranspose(tr - 1) }, '−'),
          h('button', { class: `chip ${tr ? 'on' : ''}`, 'aria-label': `Transpose ${fmtSemis(tr)} semitones. Tap to go back to the original key.`, onclick: () => setTranspose(0), html: icon('transpose') + `Transpose ${fmtSemis(tr)}` }),
          h('button', { class: 'chip', 'aria-label': 'Transpose up a semitone', disabled: tr >= MAX_TR, onclick: () => setTranspose(tr + 1) }, '+')),
        p.takes.length ? h('button', { class: 'chip', onclick: takesSheet, html: icon('stack') + `Takes (${p.takes.length})` }) : null,
        jump));
  }

  function harmonySheet() {
    let box;
    const content = (api) => [
      h('h2', {}, 'Harmony'),
      h('p', { class: 'small dim' }, 'Pick the part to sing. It is written in the key of the song.'),
      h('div', { class: 'chips wrapc', style: { marginTop: '10px' } }, ...HARMONY_OPTIONS.map(([k, l]) => h('button', { class: `chip ${settings.get('harmonyType') === k ? 'on' : ''}`, 'aria-pressed': String(settings.get('harmonyType') === k), onclick: () => { settings.set('harmonyType', k); changed(api); } }, l))),
      h('div', { class: 'small dim', style: { margin: '16px 2px 6px' } }, 'Octave'),
      seg([['down', 'Octave down'], ['same', 'As written'], ['up', 'Octave up']], settings.get('harmonyOctave'), (v) => { settings.set('harmonyOctave', v); changed(api); }, 'Octave'),
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, 'Stay in key'), h('div', { class: 'small faint' }, 'On: the harmony only uses notes from the song’s scale, so it always fits. Off: it copies the melody’s exact shape and can clash.')), toggle(settings.get('diatonic'), (v) => { settings.set('diatonic', v); changed(api); }, 'Stay in key')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => api.close() }, 'Done')),
    ];
    function changed(api) {
      refreshRoll(); renderDock(); restart();
      const grab = box.querySelector('.grab');
      box.replaceChildren(grab, ...content(api));
    }
    const api = sheet((a) => content(a), { label: 'Harmony' });
    box = api.el;
  }

  // ---------- recording a melody ----------
  let recTimer = null;
  function recordDock() {
    const rec = h('button', { class: `recbtn ${recording ? 'live' : ''}`, 'aria-label': recording ? 'Stop recording' : 'Record', html: icon(recording ? 'stop' : 'record'), onclick: () => (recording ? stopRecording() : startRecording()) });
    if (recording) {
      rec.style.width = rec.style.height = '48px';
      return h('div', { class: 'bar' }, rec, h('span', { class: 'recdot', role: 'status' }, 'Recording'), h('div', { class: 'grow small dim', style: { textAlign: 'right' } }, 'Tap stop when you’re done'));
    }
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' } }, rec,
      redo ? h('button', { class: 'btn sm ghost', onclick: cancelRedo }, 'Cancel, keep the old recording') : null,
      h('p', { class: 'small dim', style: { textAlign: 'center' } }, recording ? 'Recording. Sing your melody, then tap stop.' : 'Tap to record. Sing any melody, a few phrases long, and we will write a harmony for it.'));
  }
  let recStarting = false;
  async function startRecording() {
    if (recording || recStarting) return;
    recStarting = true;
    try {
      if (!(await micGate(sv.el))) return;
      try { await E.startMic(); } catch { toast('The microphone isn’t available. Check it is allowed in your phone’s settings.', { ms: 4000 }); return; }
      if (!alive) { E.stopMic(); return; }
      E.startRecording();
      playing = await E.play({ layers: [] });
      recording = true;
    } finally { recStarting = false; }
    if (!recording) return;
    const T = playing;
    sv.startTransport(T);
    sv.showLive = true;
    haptic('medium');
    renderDock();
    clearTimeout(recTimer);
    recTimer = setTimeout(() => { if (recording) { toast('Recordings are limited to 5 minutes'); stopRecording(); } }, MAX_REC * 1000);
  }
  async function stopRecording() {
    clearTimeout(recTimer);
    const T = playing; if (!T || !recording) return;
    const lat = E.roundTripLatency();
    T.stop(); playing = null; recording = false; sv.transport = null;
    const rec = E.stopRecording();
    const aligned = E.alignRecording(rec, T, lat);
    if (aligned.length < E.sampleRate() * 0.6) { toast('That was very short. Try again.'); renderDock(); return; }
    finding = { cancelled: false };
    const me = finding;
    if (dock.isConnected) dock.replaceChildren(h('div', { class: 'bar', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('div', { class: 'grow' }, 'Finding your notes…'), h('button', { class: 'btn sm ghost', onclick: () => { me.cancelled = true; } }, 'Cancel')));
    let res;
    try { res = await analyseTakeAsync(aligned, E.sampleRate(), { signal: me }); }
    catch { finding = null; if (alive) { if (!me.cancelled) toast('Couldn’t read that recording. Try again.'); renderDock(); } return; }
    finding = null;
    if (!alive) return;
    if (!res.notes.length) { toast('No clear notes found. Sing a little louder, or move closer.', { ms: 4000 }); renderDock(); return; }
    const lastEnd = res.notes[res.notes.length - 1].end;
    const trimmed = aligned.slice(0, Math.min(aligned.length, Math.round((lastEnd + 1) * E.sampleRate())));
    const audioKey = uid();
    await db.putAudio(audioKey, trimmed);
    const layer = { id: uid(), name: 'Vocal', audioKey, frames: packFrames(res.frames.filter((_, i) => i % 2 === 0)), notes: res.notes, duration: trimmed.length / E.sampleRate() };
    // a re-recorded melody replaces the old one (its audio and any transposed copies)
    for (const old of p.layers) db.deleteAudio(old.audioKey).catch(() => {});
    for (const k of p.shiftKeys || []) db.deleteAudio(k).catch(() => {});
    p.shiftKeys = []; shifted.clear(); redo = null;
    p.layers = [layer]; p.baseLayerId = layer.id; p.notes = res.notes;
    p.key = res.key; p.keyCandidates = res.keyCandidates;
    p.duration = layer.duration;
    p._buf.vocal = E.makeBuffer(trimmed);
    await saveNow(p);
    if (!alive) return;
    history.replaceState(null, '', `#/project/${p.id}`);
    E.stopMic();
    mode = 'player'; pos = firstStart();
    sv.showLive = false;
    if (sv.hudEl) sv.hudEl.style.display = 'none';
    refreshRoll(); renderDock();
    announce('Saved. Tap play to hear it back.', { force: true });
    toast('Saved. Tap ▶ to hear it back. The green bars are a harmony you can sing with it.', { ms: 4500 });
  }

  // ---------- drag the notes to move through the song; tap to play or stop ----------
  let drag = null;
  sv.canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'player' || taking || busyMsg) return;
    sv.canvas.setPointerCapture(e.pointerId);
    drag = { x0: e.clientX, pos0: pos, moved: false, was: !!playing };
  });
  sv.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; if (playing) stop(); }
    if (drag.moved) { pos = Math.max(0, Math.min(endTime(), drag.pos0 - dx / roll.s.pxPerSec)); lastUi = 0; updatePosUi(); }
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { if (playing) stop(); else play(); return; }
    renderDock();
    if (d.was) play();
  };
  sv.canvas.addEventListener('pointerup', endDrag);
  sv.canvas.addEventListener('pointercancel', endDrag);

  // ---------- key ----------
  function keySheet() {
    const cands = (p.keyCandidates || []).slice(0, 3);
    let chosen = shiftKey(p.key || { root: 0, mode: 'major' }, tr);
    const grid = h('div', { class: 'chips wrapc', style: { marginTop: '8px' } });
    const hear = (r, m) => E.sequence(MODES[m].concat(12).map((s, i) => ({ start: i * 0.16, end: i * 0.16 + 0.3, midi: 60 + ((r + 5) % 12) - 5 + s })), { gain: 0.4 });
    const draw = () => {
      grid.replaceChildren(...SHARP_NAMES.flatMap((_, r) => ['major', 'minor'].map((m) => h('button', { class: `chip ${chosen.root === r && chosen.mode === m ? 'on' : ''}`, onclick: () => { chosen = { root: r, mode: m }; draw(); hear(r, m); } }, keyName({ root: r, mode: m }, settings.get('accidentals'))))));
    };
    draw();
    sheet((api) => [
      h('h2', {}, 'Key'),
      h('p', { class: 'dim small' }, 'The key decides which notes the harmony uses. Change it if the harmony sounds wrong.'),
      cands.length ? h('div', { class: 'chips wrapc', style: { marginTop: '12px' } }, ...cands.map((c0, i) => { const c = shiftKey(c0, tr); return h('button', { class: 'chip', onclick: () => { chosen = { root: c.root, mode: c.mode }; draw(); hear(c.root, c.mode); } }, `${i === 0 ? 'Best match: ' : ''}${keyName(c, settings.get('accidentals'))}`); })) : null,
      h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'small dim', style: { cursor: 'pointer', padding: '6px 0' } }, 'All keys'), grid),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
        p.key = shiftKey(chosen, -tr);
        for (const n of p.notes) n.midi = snapToKey(n.raw ?? n.midi, p.key);
        const v = vocal(); if (v) v.notes = p.notes;
        saveNow(p); api.close(); refreshRoll(); restart();
      } }, 'Use this key')),
    ], { label: 'Key' });
  }
  function exportSheet() {
    if (mode !== 'player') { toast('Record something first.'); return; }
    stop();
    const v = vocal(), tk = take();
    const parts = [{ id: 'vocal', label: 'Vocal', on: settings.get('playVocal'), get: async () => ({ buffer: await bufferFor(v.audioKey, 'vocal'), gain: settings.get('vocalVolume') }) }];
    if (p.backingKey) parts.push({ id: 'music', label: 'Music', on: settings.get('playMusic'), get: async () => ({ buffer: await bufferFor(p.backingKey, 'backing'), gain: settings.get('musicVolume') }) });
    if (tk) parts.push({ id: 'take', label: `My take (${tk.name})`, on: !!p.playTake, get: async () => ({ buffer: await baseBuffer(tk.audioKey, `take:${tk.id}`), gain: settings.get('takeVolume'), at: tk.at }) });
    if (!parts.some((x) => x.on)) parts[0].on = true;
    const from = firstStart();
    openExport(p, { parts, from: (chosen) => (chosen.some((x) => x.id === 'music') ? 0 : from), to: endTime() + 0.5, view: () => ({ lines: roll.s.lines, targets: roll.s.targets, key: shiftKey(p.key, tr) }) });
  }
  const HELP = ['The thin line is the vocal’s real pitch. Grey bars are the melody notes found in it.', 'Coloured bars are the harmony part. Pick a different one with the Harmony button, or move it an octave to suit your voice.', 'The glowing line is you, if you sing along. Drag the notes to move through the song; tap them to play or stop.', 'Transpose − and + move the whole song (vocal and music) up or down a semitone at a time, without changing the speed.', 'The red button plays the song and records you singing over it. Your takes are kept with the song; tick My take to hear yourself.', 'The arrow next to the time folds the controls away to give the notes more room.'];
  function moreSheet() {
    sheet((api) => [
      h('h2', {}, p.name),
      h('div', { class: 'list', style: { marginTop: '10px' } },
        settings.get('infoButtons') !== false ? h('button', { class: 'row', onclick: () => { api.close(); sheet(() => [h('h2', {}, 'How this screen works'), ...HELP.map((t) => h('p', { class: 'dim', style: { marginTop: '8px' } }, t))], { label: 'Help' }); } }, ic('info'), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, 'How this screen works'))) : null,
        h('button', { class: 'row', onclick: () => { api.close(); go('/settings'); } }, ic('settings'), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, 'Settings'))),
        mode === 'player' ? h('button', { class: 'row', onclick: () => { api.close(); rename(); } }, ic('edit'), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, 'Rename'))) : null,
        mode === 'player' ? h('button', { class: 'row', onclick: () => { api.close(); refind(); } }, ic('wave'), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, 'Find the notes again'), h('div', { class: 'small faint' }, 'Uses your current microphone settings. The vocal is not isolated again.'))) : null,
        mode === 'player' && !p.imported ? h('button', { class: 'row', onclick: () => { api.close(); recordAgain(); } }, ic('mic'), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, 'Record the melody again'))) : null,
        mode === 'player' ? h('button', { class: 'row', onclick: async () => {
          api.close();
          if (!(await confirmSheet({ title: `Delete ${p.name}?`, body: 'Its audio and takes are removed from this device.', ok: 'Delete', danger: true }))) return;
          stop(); deleted = true;
          await db.deleteProject(p).catch(() => {});
          toast('Deleted'); go('/', { replace: true });
        } }, ic('trash'), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700, color: 'var(--c-coral)' } }, 'Delete song'))) : null),
    ], { label: 'More' });
  }
  async function refind() {
    stop();
    const v = vocal();
    const buf = await baseBuffer(v.audioKey, 'vocal');
    if (!buf) { toast('This song’s audio is missing.'); return; }
    busyMsg = 'Finding the notes…'; renderDock();
    finding = { cancelled: false };
    const me = finding;
    try {
      let res;
      try { res = await analyseTakeAsync(buf.getChannelData(0), buf.sampleRate, { key: p.key, signal: me }); }
      catch { if (!me.cancelled) toast('Couldn’t read the vocal. Try again.'); return; }
      if (!alive) return;
      if (!res.notes.length) { toast('No clear notes found. Try a lower confidence setting.', { ms: 4000 }); return; }
      v.frames = packFrames(res.frames.filter((_, i) => i % 2 === 0)); v.notes = res.notes; v._frames = null; v._shifted = null;
      p.notes = res.notes; p.keyCandidates = res.keyCandidates;
      await saveNow(p);
      toast(`Found ${res.notes.length} notes.`);
    } finally { finding = null; busyMsg = ''; if (alive) { refreshRoll(); renderDock(); } }
  }
  async function recordAgain() {
    if (!(await confirmSheet({ title: 'Record the melody again?', body: 'Your new recording replaces this one. Your sing-along takes are kept.', ok: 'Record again' }))) return;
    stop();
    redo = { notes: p.notes };
    mode = 'record'; pos = 0;
    sv.showLive = true;
    if (sv.hudEl) sv.hudEl.style.display = '';
    roll.set({ nowX: 0.72 });
    refreshRoll(); renderDock();
    if (await micGate(sv.el)) await E.startMic().catch(() => {});
  }
  function cancelRedo() {
    redo = null;
    E.stopMic();
    mode = 'player'; pos = firstStart();
    sv.showLive = false;
    if (sv.hudEl) sv.hudEl.style.display = 'none';
    refreshRoll(); renderDock();
  }
  async function rename() { if (mode !== 'player') return; const n = await askName(p.name); if (n) { p.name = n; titleEl.textContent = n; saveNow(p); } }

  const unSet = settings.on((k) => { if (['showHarmony', 'harmonyType', 'harmonyOctave', 'diatonic', 'labels', 'accidentals', 'barLabels', '*'].includes(k)) refreshRoll(); });
  sv.showLive = mode === 'record';
  if (sv.hudEl && mode === 'player') sv.hudEl.style.display = 'none';
  refreshRoll();
  renderDock();
  requestAnimationFrame(frame);
  const NAMES = { showHarmony: 'Harmony shown', playVocal: 'Vocal' };
  const toggleSetting = (id, after) => { settings.set(id, !settings.get(id)); refreshRoll(); renderDock(); after?.(); announce(`${NAMES[id]} ${settings.get(id) ? 'on' : 'off'}`, { force: true }); };

  return {
    el,
    async mounted() {
      if (mode === 'record') { const ok = await micGate(sv.el); if (ok && alive) await E.startMic().catch(() => {}); if (!alive) E.stopMic(); }
      else {
        E.ensureContext().catch(() => {}); prepare();
        if (settings.get('singAlong') && settings.meta('micOk')) E.startMic().then(() => { if (!alive) E.stopMic(); }).catch(() => {});
      }
    },
    keys: {
      space: () => { if (mode === 'record') { if (recording) stopRecording(); else startRecording(); } else if (playing) stop(); else play(); },
      ArrowLeft: () => { if (mode === 'player') seek(pos - 5); },
      ArrowRight: () => { if (mode === 'player') seek(pos + 5); },
      h: () => { if (mode === 'player') toggleSetting('showHarmony'); },
      r: () => { if (mode !== 'player') return; if (playing) stop(); else recordTake(); },
      v: () => { if (mode === 'player') toggleSetting('playVocal', restart); },
    },
    onBack() {
      if (busyMsg || finding) { cancelBusy(); return true; }
      if (recording) { stopRecording(); return true; }
      if (playing) { stop(); return true; }
      return false;
    },
    onHide() { if (recording) stopRecording(); else stop(); E.stopMic(); },
    onShow() { if (mode === 'player' && settings.get('singAlong') && settings.meta('micOk')) E.startMic().catch(() => {}); },
    onInterrupt() { if (recording) { toast('Recording interrupted. Your take was kept.'); stopRecording(); } else stop(); },
    destroy() {
      if (recording) stopRecording().catch(() => {}); else stop();
      alive = false;
      clearTimeout(recTimer); unSet();
      sv.destroy(); E.stopMic();
      if (mode === 'player' && !deleted) saveNow(p).catch(() => {});
    },
  };
}
