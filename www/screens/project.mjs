// Song player: the vocal (recorded or isolated) with its melody bars and a harmony part.
// Play starts straight away from wherever the playhead is; drag the notes or the slider to move.
// /project/new records a melody first, then becomes the player.
import { h, iconBtn, sheet, toast, seg, toggle, fmtTime, haptic, infoBtn, announce } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { SingView } from '../ui/singview.mjs';
import { back, go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { db, uid } from '../core/db.mjs';
import { settings, HARMONY_OPTIONS } from '../core/settings.mjs';
import { saveNow, autosave, analyseTake, packFrames, unpackFrames, harmonyTargets, harmonyLabel, newProject, dropOutliers } from '../core/project.mjs';
import { keyName, noteLabel, snapToKey, SHARP_NAMES, MODES } from '../dsp/theory.mjs';
import { micGate } from './mic-gate.mjs';
import { askName } from './songs.mjs';

const MAX_REC = 5 * 60;

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
  const vocal = () => p.layers.find((l) => l.id === p.baseLayerId) || p.layers[0];
  let mode = vocal() ? 'player' : 'record';
  let playing = null, recording = false, alive = true;
  let harm = [];
  const firstStart = () => (p.notes.length ? Math.max(0, p.notes[0].start - 1.2) : 0);
  const endTime = () => Math.max(p.duration || 0, ...p.notes.map((n) => n.end));
  let pos = firstStart();

  const sv = new SingView({ roll: { nowX: mode === 'player' ? 0.3 : 0.72 } });
  const roll = sv.roll;
  const keyChip = h('button', { class: 'chip', onclick: keySheet, 'aria-label': 'Key' });
  const titleEl = h('button', { class: 'title', style: { textAlign: 'left' }, onclick: rename, role: 'heading', 'aria-level': '1' }, p.name);
  const el = h('div', {},
    h('header', { class: 'topbar' }, iconBtn('back', 'Back', () => back()), titleEl, keyChip,
      infoBtn('What you are seeing', 'The thin line is the vocal’s real pitch. Grey bars are the melody notes found in it.', 'Coloured bars are the harmony part. Pick a different one with the Harmony button, or move it an octave to suit your voice.', 'The glowing line is you, if you sing along. Drag the notes to move through the song; tap them to play or stop.'),
      iconBtn('settings', 'Settings', () => go('/settings'))),
    sv.el);
  const dock = h('div', { class: 'dock' });
  el.append(dock);

  // ---------- audio ----------
  async function bufferFor(key, slot) {
    if (!key) return null;
    if (!p._buf[slot]) { const s = await db.getAudio(key); if (!s) return null; await E.ensureContext(); p._buf[slot] = E.makeBuffer(s); }
    return p._buf[slot];
  }

  let starting = false;
  async function play() {
    if (playing || recording || starting) return;
    starting = true;
    try {
      await E.ensureContext();
      if (pos >= endTime() - 0.2) pos = firstStart();
      const v = vocal();
      const layers = [{ buffer: await bufferFor(v.audioKey, 'vocal'), gain: settings.get('vocalVolume'), mute: !settings.get('playVocal') }];
      if (p.backingKey) layers.push({ buffer: await bufferFor(p.backingKey, 'backing'), gain: settings.get('musicVolume'), mute: !settings.get('playMusic') });
      const guide = settings.get('playHarmony') ? harm : [];
      const singAlong = settings.get('singAlong');
      if (singAlong && settings.meta('micOk')) await E.startMic().catch(() => {});
      E.setPlaybackPitchProvider(settings.get('playVocal') ? (ct) => {
        if (!playing) return null;
        const m = playing.toMusical(ct - E.outputLatency());
        const tgt = harm.find((t) => m >= t.start && m <= t.end);
        const out = p.notes.filter((n) => m >= n.start && m <= n.end).map((n) => n.midi);
        // the harmony note is what the singer should sing: never treat it as bleed
        return tgt ? out.filter((x) => Math.abs(x - tgt.midi) > 0.5) : out;
      } : null);
      const T = await E.play({ layers, from: pos, guide, guideGain: 0.75 * settings.get('harmonyVolume') });
      if (!alive) { T.stop(); return; }
      playing = T;
      sv.startTransport(T);
      sv.showLive = singAlong && E.micActive();
      if (sv.hudEl) sv.hudEl.style.display = sv.showLive ? '' : 'none';
      renderDock();
    } finally { starting = false; }
  }
  function stop() {
    if (!playing) return;
    const at = playing.heard();
    playing.stop(); playing = null;
    sv.transport = null;
    pos = Math.max(0, Math.min(endTime(), at));
    E.setPlaybackPitchProvider(null);
    E.stopMic();
    sv.showLive = false;
    if (sv.hudEl) sv.hudEl.style.display = 'none';
    if (dock.isConnected) renderDock();
  }
  async function restart() { if (playing) { stop(); await play(); } }
  function seek(t) { const was = !!playing; stop(); pos = Math.max(0, Math.min(endTime(), t)); if (was) play(); else renderDock(); }

  // ---------- roll content ----------
  const lbl = (m) => noteLabel(m, { style: settings.get('labels'), accidentals: settings.get('accidentals'), key: p.key, octave: false });
  function refreshRoll() {
    keyChip.textContent = p.key ? keyName(p.key, settings.get('accidentals')) : 'Key';
    keyChip.style.display = mode === 'player' ? '' : 'none';
    if (mode === 'record') { roll.set({ mode: 'scroll', follow: true, targets: [], lines: [], followTarget: null, semisGoal: null, nowX: 0.72, semis: settings.get('zoom') }); return; }
    harm = harmonyTargets(p);
    const targets = p.notes.map((n) => ({ ...n, kind: 'ghost' }));
    if (settings.get('showHarmony')) for (const t of harm) targets.push({ ...t, kind: 'target', label: lbl(t.midi) });
    const v = vocal();
    v._frames = v._frames || unpackFrames(v.frames);
    roll.set({ mode: 'scroll', follow: true, key: p.key, targets, nowX: 0.3, lines: [{ frames: v._frames, color: roll.colors['--c-violet'], alpha: 0.75, width: 2 }] });
    sv.setTargets(targets);
  }

  // follow the part being played, zoomed in to just the notes around the playhead
  function frame() {
    if (!alive) return;
    if (mode === 'player') {
      const now = playing ? playing.heard() : pos;
      if (!playing) sv.freeze = pos;
      const ms = [];
      for (const n of p.notes) if (n.end > now - 1.5 && n.start < now + 4) ms.push(n.midi);
      if (settings.get('showHarmony')) for (const t of harm) if (t.end > now - 1.5 && t.start < now + 4) ms.push(t.midi);
      if (ms.length) {
        const lo = Math.min(...ms), hi = Math.max(...ms);
        roll.set({ followTarget: (lo + hi) / 2, semisGoal: Math.max(9, Math.min(16, hi - lo + 5)) });
      } else roll.set({ followTarget: null });
      if (playing) {
        pos = now;
        if (now > endTime() + 0.4) { stop(); pos = firstStart(); renderDock(); }
        updatePosUi();
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- dock ----------
  let posSlider = null, timeEl = null, lastUi = 0;
  function updatePosUi() {
    const t = performance.now();
    if (t - lastUi < 120 || !posSlider) return;
    lastUi = t;
    if (!posSlider.matches(':active')) posSlider.value = String(pos);
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
    if (mode === 'record') { dock.append(recordDock()); return; }
    const big = h('button', { class: 'recbtn play', style: { width: '64px', height: '64px' }, 'aria-label': playing ? 'Stop' : 'Play', html: icon(playing ? 'stop' : 'play'), onclick: () => (playing ? stop() : play()) });
    const skip = (d, name) => h('button', { class: 'iconbtn', 'aria-label': d < 0 ? 'Back 5 seconds' : 'Forward 5 seconds', html: icon(name), onclick: () => seek(pos + d) });
    timeEl = h('span', { class: 'small mono dim' }, `${fmtTime(pos)} / ${fmtTime(endTime())}`);
    posSlider = h('input', { type: 'range', min: '0', max: String(Math.max(1, endTime())), step: '0.1', 'aria-label': 'Position in the song', class: 'pos' });
    posSlider.value = String(pos);
    fillPos();
    let resume = false;
    posSlider.addEventListener('input', () => { if (playing) { resume = true; stop(); } pos = Number(posSlider.value); fillPos(); timeEl.textContent = `${fmtTime(pos)} / ${fmtTime(endTime())}`; });
    posSlider.addEventListener('change', () => { if (resume) { resume = false; play(); } else renderDock(); });
    const jump = p.notes.length && pos < p.notes[0].start - 2 ? h('button', { class: 'chip', onclick: () => seek(firstStart()) }, 'Jump to the singing') : null;
    const H = settings.get('harmonyType'), O = settings.get('harmonyOctave');
    dock.append(
      h('div', { class: 'bar', style: { justifyContent: 'center' } }, skip(-5, 'left'), big, skip(5, 'right'), h('div', { class: 'grow', style: { textAlign: 'right' } }, timeEl)),
      posSlider,
      h('div', { class: 'ticks' },
        tick('Show harmony', 'showHarmony', refreshRoll),
        tick('Play harmony', 'playHarmony', restart),
        tick('Vocal', 'playVocal', restart),
        p.backingKey ? tick('Music', 'playMusic', restart) : null),
      h('div', { class: 'chips' },
        h('button', { class: 'chip on', onclick: harmonySheet, html: icon('layers') + `Harmony: ${harmonyLabel(H)}${O === 'up' ? ' · octave up' : O === 'down' ? ' · octave down' : ''} ▾` }),
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
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, 'Stay in key'), h('div', { class: 'small faint' }, 'Thirds become major or minor to fit the scale.')), toggle(settings.get('diatonic'), (v) => { settings.set('diatonic', v); changed(api); }, 'Stay in key')),
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
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' } }, rec,
      h('p', { class: 'small dim', style: { textAlign: 'center' } }, recording ? 'Recording. Sing your melody, then tap stop.' : 'Tap to record. Sing any melody, a few phrases long, and we will write a harmony for it.'));
  }
  async function startRecording() {
    if (recording) return;
    if (!(await micGate(sv.el))) return;
    await E.startMic();
    E.startRecording();
    const T = await E.play({ layers: [] });
    playing = T; recording = true;
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
    if (dock.isConnected) dock.replaceChildren(h('div', { class: 'empty', style: { padding: '14px' } }, h('p', {}, 'Finding your notes…')));
    await new Promise((r) => setTimeout(r, 30));
    const res = analyseTake(aligned, E.sampleRate());
    if (!res.notes.length) { toast('No clear notes found. Sing a little louder, or move closer.', { ms: 4000 }); renderDock(); return; }
    const lastEnd = res.notes[res.notes.length - 1].end;
    const trimmed = aligned.slice(0, Math.min(aligned.length, Math.round((lastEnd + 1) * E.sampleRate())));
    const audioKey = uid();
    await db.putAudio(audioKey, trimmed);
    const layer = { id: uid(), name: 'Vocal', audioKey, frames: packFrames(res.frames.filter((_, i) => i % 2 === 0)), notes: res.notes, duration: trimmed.length / E.sampleRate() };
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
    announce('Recorded. Tap play to hear it with the harmony.', { force: true });
    toast(`Here is a ${harmonyLabel(settings.get('harmonyType')).toLowerCase()} in ${keyName(p.key, settings.get('accidentals'))}. Tap play.`, { ms: 4000 });
  }

  // ---------- drag the notes to move through the song; tap to play or stop ----------
  let drag = null;
  sv.canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'player') return;
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
    let chosen = p.key || { root: 0, mode: 'major' };
    const grid = h('div', { class: 'chips wrapc', style: { marginTop: '8px' } });
    const hear = (r, m) => E.sequence(MODES[m].concat(12).map((s, i) => ({ start: i * 0.16, end: i * 0.16 + 0.3, midi: 60 + ((r + 5) % 12) - 5 + s })), { gain: 0.4 });
    const draw = () => {
      grid.replaceChildren(...SHARP_NAMES.flatMap((_, r) => ['major', 'minor'].map((m) => h('button', { class: `chip ${chosen.root === r && chosen.mode === m ? 'on' : ''}`, onclick: () => { chosen = { root: r, mode: m }; draw(); hear(r, m); } }, keyName({ root: r, mode: m }, settings.get('accidentals'))))));
    };
    draw();
    sheet((api) => [
      h('h2', {}, 'Key'),
      h('p', { class: 'dim small' }, 'The key decides which notes the harmony uses. Change it if the harmony sounds wrong.'),
      cands.length ? h('div', { class: 'chips wrapc', style: { marginTop: '12px' } }, ...cands.map((c, i) => h('button', { class: 'chip', onclick: () => { chosen = { root: c.root, mode: c.mode }; draw(); hear(c.root, c.mode); } }, `${i === 0 ? 'Best match: ' : ''}${keyName(c, settings.get('accidentals'))}`))) : null,
      h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'small dim', style: { cursor: 'pointer', padding: '6px 0' } }, 'All keys'), grid),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
        p.key = chosen;
        for (const n of p.notes) n.midi = snapToKey(n.raw ?? n.midi, p.key);
        const v = vocal(); if (v) v.notes = p.notes;
        saveNow(p); api.close(); refreshRoll(); restart();
      } }, 'Use this key')),
    ], { label: 'Key' });
  }
  async function rename() { if (mode !== 'player') return; const n = await askName(p.name); if (n) { p.name = n; titleEl.textContent = n; saveNow(p); } }

  const unSet = settings.on((k) => { if (['showHarmony', 'harmonyType', 'harmonyOctave', 'diatonic', 'labels', 'accidentals', '*'].includes(k)) refreshRoll(); });
  sv.showLive = mode === 'record';
  if (sv.hudEl && mode === 'player') sv.hudEl.style.display = 'none';
  refreshRoll();
  renderDock();
  requestAnimationFrame(frame);
  const NAMES = { showHarmony: 'Harmony shown', playHarmony: 'Harmony notes', playVocal: 'Vocal' };
  const toggleSetting = (id, after) => { settings.set(id, !settings.get(id)); refreshRoll(); renderDock(); after?.(); announce(`${NAMES[id]} ${settings.get(id) ? 'on' : 'off'}`, { force: true }); };

  return {
    el,
    async mounted() {
      if (mode === 'record') { const ok = await micGate(sv.el); if (ok) await E.startMic().catch(() => {}); }
      else E.ensureContext().catch(() => {});
    },
    keys: {
      space: () => { if (mode === 'record') { if (recording) stopRecording(); else startRecording(); } else if (playing) stop(); else play(); },
      ArrowLeft: () => { if (mode === 'player') seek(pos - 5); },
      ArrowRight: () => { if (mode === 'player') seek(pos + 5); },
      h: () => { if (mode === 'player') toggleSetting('showHarmony'); },
      p: () => { if (mode === 'player') toggleSetting('playHarmony', restart); },
      v: () => { if (mode === 'player') toggleSetting('playVocal', restart); },
    },
    onBack() {
      if (recording) { stopRecording(); return true; }
      if (playing) { stop(); return true; }
      return false;
    },
    onHide() { if (recording) stopRecording(); else stop(); },
    onInterrupt() { if (recording) { toast('Recording interrupted. Your take was kept.'); stopRecording(); } else stop(); },
    destroy() {
      if (recording) stopRecording().catch(() => {}); else stop();
      alive = false;
      clearTimeout(recTimer); unSet();
      sv.destroy(); E.stopMic();
      if (mode === 'player') saveNow(p).catch(() => {});
    },
  };
}
