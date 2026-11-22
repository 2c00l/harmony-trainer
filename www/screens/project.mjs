// Project studio: record melody → analyse → edit target bars → harmony regions → sing over layers → mix.
import { h, iconBtn, ic, sheet, toast, confirmSheet, seg, toggle, slider, fmtTime, fmtCents, scoreRing, gradeBar, haptic, infoBtn, announce } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { SingView } from '../ui/singview.mjs';
import { back, go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { route } from '../audio/route.mjs';
import { db, uid } from '../core/db.mjs';
import { settings, scoringOpts } from '../core/settings.mjs';
import { autosave, saveNow, analyseTake, packFrames, unpackFrames, nextColorIdx, LAYER_COLORS, harmonyTargets, harmonyLabel, barLen, ensureChords } from '../core/project.mjs';
import { keyName, noteLabel, snapToKey, SHARP_NAMES, HARMONY_TYPES, chordName, diatonicTriad, MODES } from '../dsp/theory.mjs';
import { setRegion } from '../dsp/harmony.mjs';
import { scoreTake } from '../dsp/score.mjs';
import { analyseBuffer } from '../dsp/pitch.mjs';
import { quantise } from '../dsp/segment.mjs';
import { timeStretch, pitchShift } from '../dsp/stretch.mjs';
import { micGate } from './mic-gate.mjs';
import { askName } from './home.mjs';
import { openExport } from './export.mjs';

const HARMONY_CHOICES = ['third_above', 'third_below', 'sixth_below', 'fifth_above', 'octave_below', 'octave_above', 'unison', 'rest'];

export async function render(id) {
  const p = await db.getProject(id);
  if (!p) { go('/', { replace: true }); return { el: h('div') }; }
  p._buf = {}; p._cache = {};
  let tab = p.layers.length ? 'harmony' : 'record';
  let playing = null; // transport
  let recording = false;
  let selectedId = null;
  let selection = null; // {start,end} musical
  let loop = null;
  let rate = 1, transpose = 0;
  let practiceOnly = false;
  let undo = [];
  let stacked = true;
  let speakerNoticeDismissed = false;

  const sv = new SingView({ roll: { nowX: 0.5 } });
  const roll = sv.roll;
  const keyChip = h('button', { class: 'chip', onclick: keySheet, 'aria-label': 'Key' });
  const titleEl = h('button', { class: 'title', style: { textAlign: 'left' }, onclick: rename, role: 'heading', 'aria-level': '1' }, p.name);
  const el = h('div', {},
    h('header', { class: 'topbar' }, iconBtn('back', 'Back', () => back()), titleEl, keyChip, iconBtn('dots', 'Project options', menu)),
    sv.el,
  );
  const noticeHost = h('div', { style: { position: 'absolute', left: '12px', right: '12px', bottom: '10px', zIndex: 4 } });
  sv.el.append(noticeHost);
  const dock = h('div', { class: 'dock' });
  el.append(dock);

  // ---------- helpers ----------
  const base = () => p.layers.find((l) => l.id === p.baseLayerId) || p.layers[0];
  const colorOf = (l) => getComputedStyle(document.documentElement).getPropertyValue(LAYER_COLORS[l.colorIdx % LAYER_COLORS.length]).trim();
  function save() { autosave(p); }
  function pushUndo() { undo.push(JSON.stringify({ notes: p.notes, regions: p.harmony.regions })); if (undo.length > 60) undo.shift(); }
  function doUndo() {
    const s = undo.pop(); if (!s) return;
    const o = JSON.parse(s); p.notes = o.notes; p.harmony.regions = o.regions; syncBaseNotes(); refresh();
  }
  function syncBaseNotes() { const b = base(); if (b) b.notes = p.notes; save(); }

  async function bufferFor(l) {
    if (!p._buf[l.id]) {
      const samples = await db.getAudio(l.audioKey);
      if (!samples) return null;
      await E.ensureContext();
      p._buf[l.id] = { samples, buffer: E.makeBuffer(samples) };
    }
    const key = `${l.id}:${rate}:${transpose}`;
    if (rate === 1 && transpose === 0) return p._buf[l.id].buffer;
    if (!p._cache[key]) {
      const raw = p._buf[l.id].samples;
      const out = transpose ? pitchShift(raw, E.sampleRate(), transpose, rate) : timeStretch(raw, E.sampleRate(), rate);
      p._cache[key] = E.makeBuffer(out);
    }
    return p._cache[key];
  }
  async function backingBuffer() {
    if (!p.backingKey) return null;
    if (!p._buf.backing) { const s = await db.getAudio(p.backingKey); if (!s) return null; await E.ensureContext(); p._buf.backing = { samples: s, buffer: E.makeBuffer(s) }; }
    const key = `backing:${rate}:${transpose}`;
    if (rate === 1 && transpose === 0) return p._buf.backing.buffer;
    if (!p._cache[key]) { const raw = p._buf.backing.samples; p._cache[key] = E.makeBuffer(transpose ? pitchShift(raw, E.sampleRate(), transpose, rate) : timeStretch(raw, E.sampleRate(), rate)); }
    return p._cache[key];
  }
  async function playLayers(exclude = null) {
    const out = [];
    const bb = await backingBuffer();
    if (bb) out.push({ buffer: bb, gain: p.backingGain, mute: !!p.backingMute, solo: false });
    for (const l of p.layers) {
      if (l.id === exclude) continue;
      out.push({ buffer: await bufferFor(l), gain: l.gain, mute: l.mute, solo: l.solo });
    }
    return out;
  }
  function clicksCfg(countIn) {
    if (!p.bpm) return null;
    return { bpm: p.bpm, beatsPerBar: p.beatsPerBar, offset: p.beatOffset, countInBars: countIn ? Number(settings.get('countIn')) : 0, metronome: settings.get('metronome') || tab === 'record' && settings.get('metronome') };
  }
  function layerLines() {
    return p.layers.filter((l) => stacked || l.id === p.baseLayerId).map((l) => {
      l._frames = l._frames || unpackFrames(l.frames);
      return { frames: l._frames, color: colorOf(l), alpha: l.mute ? 0.25 : (tab === 'sing' ? 0.55 : 0.8), width: 2.2 };
    });
  }

  // ---------- roll content per tab ----------
  function refresh() {
    keyChip.textContent = p.key ? keyName(p.key, settings.get('accidentals')) : 'Key';
    keyChip.style.display = p.layers.length ? '' : 'none';
    const targets = [];
    const lbl = (m) => noteLabel(m, { style: settings.get('labels'), accidentals: settings.get('accidentals'), key: p.key, octave: false });
    if (tab === 'edit') {
      for (const n of p.notes) targets.push({ ...n, kind: 'base', selected: n.id === selectedId, label: lbl(n.midi), ref: n });
    } else if (tab === 'harmony' || tab === 'sing') {
      if (tab === 'harmony') for (const n of p.notes) targets.push({ ...n, kind: 'ghost' });
      for (const t of harmonyTargets(p)) if (t.midi != null) targets.push({ ...t, midi: t.midi + (tab === 'sing' ? transpose : 0), kind: 'target', label: lbl(t.midi + (tab === 'sing' ? transpose : 0)) });
    }
    const editLike = tab === 'edit' || tab === 'harmony' || tab === 'mix';
    roll.set({
      key: p.key, mode: editLike ? 'edit' : 'scroll', follow: !editLike, targets,
      lines: tab === 'record' ? [] : layerLines(),
      regions: p.harmony.regions.map((r) => ({ ...r, label: harmonyLabel(r.type, r.semis) })),
      bandH: tab === 'harmony' ? 24 : 0, selection: tab === 'harmony' ? selection : null, loop,
      beats: p.bpm ? { bpm: p.bpm, beatsPerBar: p.beatsPerBar, offset: p.beatOffset } : null,
    });
    if (tab === 'sing') sv.setTargets(targets, { live: true });
    else sv.setTargets(targets);
    if (editLike) fitView(false);
    renderDock();
  }
  let viewFitted = false;
  function fitView(force) {
    if (viewFitted && !force) return;
    viewFitted = true;
    const dur = Math.max(4, p.duration || 8);
    const span = Math.min(dur + 0.5, Math.max(3.5, (roll.w || 390) / 95));
    roll.set({ view: { t0: -0.2, t1: span } });
    const ms = p.notes.map((n) => n.midi);
    if (ms.length) {
      const lo = Math.min(...ms), hi = Math.max(...ms);
      roll.set({ centerMidi: (lo + hi) / 2 + (tab === 'harmony' ? 1.5 : 0), semis: Math.max(settings.get('zoom'), hi - lo + 8) });
    }
  }

  // ---------- dock ----------
  function renderDock() {
    dock.replaceChildren();
    if (!p.layers.length) { dock.append(recordMelodyDock()); return; }
    const tabs = seg([['harmony', 'Harmony'], ['sing', 'Sing'], ['mix', 'Mix'], ['edit', 'Notes']], tab, (v) => { stopAll(); tab = v; selection = null; refresh(); }, 'Studio mode');
    dock.append(tabs);
    if (tab === 'edit') dock.append(editDock());
    if (tab === 'harmony') dock.append(...harmonyDock().filter(Boolean));
    if (tab === 'sing') dock.append(...singDock().filter(Boolean));
    if (tab === 'mix') dock.append(...mixDock().filter(Boolean));
    applyLiveMode();
    updateSpeakerNotice();
  }

  function transportBtn(onPlay) {
    return h('button', { class: `recbtn play`, style: { width: '56px', height: '56px' }, 'aria-label': playing ? 'Stop' : 'Play', html: icon(playing ? 'stop' : 'play'), onclick: () => (playing ? stopAll() : onPlay()) });
  }

  function recordMelodyDock() {
    const tempoChip = h('button', { class: 'chip', onclick: tempoSheet, html: icon('metronome') + (p.bpm ? `${p.bpm} bpm · ${p.beatsPerBar}/4` : 'Free time') });
    const rec = h('button', { class: `recbtn ${recording ? 'live' : ''}`, 'aria-label': recording ? 'Stop recording' : 'Record melody', html: icon(recording ? 'stop' : 'record'), onclick: () => (recording ? stopMelody() : recordMelody()) });
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' } },
      h('div', { class: 'chips', style: { justifyContent: 'center' } }, tempoChip),
      rec,
      h('p', { class: 'small dim', style: { textAlign: 'center' } }, recording ? 'Recording… sing your melody, then tap stop.' : 'Sing any melody you like, a few phrases long. We will write a harmony for it.'));
  }

  function editDock() {
    const sel = p.notes.find((n) => n.id === selectedId);
    const t = (name, label, fn, dis = false) => h('button', { class: 'tool', disabled: dis, onclick: fn, html: icon(name) + `<span>${label}</span>` });
    return h('div', { class: 'bar' },
      transportBtn(() => playPreview()),
      h('div', { class: 'tools grow' },
        t('up', 'Up', () => moveSel(0, 1), !sel), t('down', 'Down', () => moveSel(0, -1), !sel),
        t('left', 'Earlier', () => moveSel(-0.05, 0), !sel), t('right', 'Later', () => moveSel(0.05, 0), !sel),
        t('split', 'Split', splitSel, !sel), t('merge', 'Merge', mergeSel, !sel || p.notes.indexOf(sel) >= p.notes.length - 1),
        t('trash', 'Delete', deleteSel, !sel), t('plus', 'Add', addNote),
        t('key', 'Snap', snapAll), p.bpm ? t('metronome', 'Quantise', quantiseAll) : null,
        t('back', 'Undo', doUndo, !undo.length)));
  }

  const MAIN_HARMONIES = ['third_above', 'third_below', 'sixth_below', 'fifth_above'];
  function harmonyDock() {
    const H = p.harmony;
    const cur = selection ? null : H.defaultType;
    const extraOn = cur && !MAIN_HARMONIES.includes(cur);
    const chips = h('div', { class: 'chips' },
      ...MAIN_HARMONIES.map((type) => h('button', { class: `chip ${cur === type ? 'on' : ''}`, 'aria-pressed': String(cur === type), onclick: () => applyHarmony(type) }, harmonyLabel(type))),
      h('button', { class: `chip ${extraOn ? 'on' : ''}`, onclick: harmonyMore }, extraOn ? `${harmonyLabel(cur, H.defaultSemis)} ▾` : 'More ▾'));
    const info = h('p', { class: 'small dim' }, selection
      ? `Pick a part for ${fmtTime(Math.min(selection.start, selection.end))}–${fmtTime(Math.max(selection.start, selection.end))}`
      : 'Tap play to hear it. Drag across the roll to change just one section.');
    const row = h('div', { class: 'bar' },
      transportBtn(() => playPreview(true)),
      h('div', { class: 'grow' }, info),
      infoBtn('Your harmony part', 'The coloured bars are the harmony part we wrote for you. The grey bars are the melody you sang.', 'A 3rd above is two scale steps higher than the melody, and the most common harmony in pop and folk. A 6th below is warm and low; a 5th sounds open and strong.', 'Harmony stays in the key of your melody, so it always fits. To harmonise only part of the song, drag across that section of the roll and choose a different part for it, or Rest to leave a gap.'),
      selection ? h('button', { class: 'btn sm ghost', onclick: () => { selection = null; refresh(); } }, 'Done') : null,
      !selection && p.harmony.regions.length ? h('button', { class: 'btn sm ghost', onclick: () => { pushUndo(); p.harmony.regions = []; save(); refresh(); } }, 'Reset sections') : null);
    const next = !selection ? h('button', { class: 'btn primary block', onclick: () => { stopAll(); tab = 'sing'; refresh(); }, html: icon('mic') + 'Sing this part' }) : null;
    return [row, chips, next];
  }
  function harmonyMore() {
    const H = p.harmony;
    sheet((api) => [
      h('h2', {}, 'More harmony options'),
      h('div', { class: 'chips wrapc', style: { marginTop: '10px' } },
        ...HARMONY_CHOICES.filter((t) => !MAIN_HARMONIES.includes(t)).map((type) => h('button', { class: 'chip', style: { '--cc': `var(${{ rest: '--c-muted', unison: '--c-mint' }[type] || '--accent'})` }, onclick: () => { api.close(); applyHarmony(type); } }, harmonyLabel(type))),
        h('button', { class: 'chip', onclick: () => { api.close(); customInterval(); } }, 'Custom interval…')),
      h('div', { class: 'list', style: { marginTop: '14px' } },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, 'Stay in key'), h('div', { class: 'small faint' }, 'Harmony notes follow the scale, so thirds are major or minor as needed.')), toggle(H.diatonic, (v) => { H.diatonic = v; save(); refresh(); }, 'Stay in key')),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, 'Chord-aware'), h('div', { class: 'small faint' }, p.bpm ? 'Prefer chord tones, one chord per bar.' : 'Needs a tempo. Set one from the ⋯ menu.')), toggle(H.chordAware, (v) => { if (!p.bpm) { toast('Set a tempo first'); return; } H.chordAware = v; ensureChords(p); save(); refresh(); }, 'Chord-aware'))),
      H.chordAware && p.bpm ? h('div', { class: 'chips wrapc', style: { marginTop: '10px' } }, chordChips()) : null,
    ], { label: 'More harmony options' });
  }
  function chordChips() {
    ensureChords(p);
    return h('span', { style: { display: 'contents' } }, ...p.harmony.chords.map((c, i) => h('button', { class: 'chip', style: { '--cc': 'var(--c-amber)' }, onclick: () => chordSheet(i) }, `${i + 1}: ${chordName(c, settings.get('accidentals'), p.key)}`)));
  }

  const T_LABEL = () => (practiceOnly || loop || rate !== 1 || transpose ? 'Practising' : 'Recording a take');
  function singDock() {
    const practising = practiceOnly || loop || rate !== 1 || transpose !== 0;
    const rec = h('button', { class: `recbtn ${recording ? 'live' : ''} ${practising && !recording ? 'play' : ''}`, 'aria-label': recording ? 'Stop' : practising ? 'Practise' : 'Record harmony take', html: icon(recording ? 'stop' : practising ? 'play' : 'record'), onclick: () => (recording ? stopTake() : startTake()) });
    if (recording) {
      return [h('div', { class: 'bar' }, rec, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, T_LABEL()), h('p', { class: 'small dim' }, 'Sing the coloured bars. Tap stop when you are done.')))];
    }
    const active = [loop && 'Loop', rate !== 1 && `${Math.round(rate * 100)}%`, transpose && `${transpose > 0 ? '+' : ''}${transpose} st`, practiceOnly && !loop && rate === 1 && !transpose && 'Practice only'].filter(Boolean);
    return [
      h('div', { class: 'bar' }, rec,
        h('div', { class: 'grow' },
          h('div', { style: { fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' } }, practising ? 'Practice run' : 'Sing your part', infoBtn('How scoring works', 'Sing along with your melody and follow the coloured bars. Each bar fills up while you hold it in tune: green-blue for Perfect, blue for Good, amber for OK.', 'You get a score out of 100, plus whether you tend to sing sharp or flat, early or late. The first moment of each note is forgiven, so a gentle scoop into the note is fine.', 'Singing an octave higher or lower than the bars also counts.')),
          h('p', { class: 'small dim' }, practising ? 'Scored, but not saved as a layer.' : 'Each take is scored. Keep the good ones as layers.'))),
      h('div', { class: 'chips' },
        h('button', { class: `chip ${settings.get('guideTones') ? 'on' : ''}`, 'aria-pressed': String(settings.get('guideTones')), onclick: () => { settings.set('guideTones', !settings.get('guideTones')); renderDock(); } }, 'Guide tones'),
        h('button', { class: `chip ${active.length ? 'on' : ''}`, onclick: practiceTools, html: icon('sliders') + (active.length ? active.join(' · ') : 'Practice tools') })),
    ];
  }
  function practiceTools() {
    let box = null, grab = null;
    const redraw = () => { if (box) box.replaceChildren(grab, ...content()); };
    const stepper = (label, get, fmt, dec, inc) => h('div', { class: 'stepper', role: 'group', 'aria-label': label },
      h('button', { 'aria-label': `Decrease ${label}`, onclick: () => { dec(); redraw(); } }, '−'), h('span', {}, fmt(get())),
      h('button', { 'aria-label': `Increase ${label}`, onclick: () => { inc(); redraw(); } }, '+'));
    const row = (title, sub, control) => h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, title), h('div', { class: 'small faint' }, sub)), control);
    const content = () => [
      h('h2', {}, 'Practice tools'),
      h('p', { class: 'small dim' }, 'These turn a run into practice: it is scored but not saved as a layer.'),
      h('div', { class: 'list', style: { marginTop: '12px' } },
        row('Practice only', 'Sing along without recording a layer.', toggle(practiceOnly, (v) => { practiceOnly = v; renderDock(); }, 'Practice only')),
        row('Loop a section', loop ? `${fmtTime(loop.a)}–${fmtTime(loop.b)}` : 'Select a section in Harmony first, or loop the opening.', toggle(!!loop, () => { toggleLoop(); redraw(); }, 'Loop a section')),
        row('Speed', 'Slower, without changing pitch.', stepper('Speed', () => rate, (v) => `${Math.round(v * 100)}%`, () => setRate(Math.max(0.5, Math.round((rate - 0.1) * 10) / 10)), () => setRate(Math.min(1, Math.round((rate + 0.1) * 10) / 10)))),
        row('Transpose', 'Move everything to suit your voice.', stepper('Transpose', () => transpose, (v) => (v > 0 ? `+${v}` : `${v}`) + ' st', () => setTranspose(Math.max(-7, transpose - 1)), () => setTranspose(Math.min(7, transpose + 1)))),
        h('button', { class: 'row', onclick: () => { api.close(); tempoSheet(); } }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, 'Tempo, metronome and count-in'), h('div', { class: 'small faint' }, p.bpm ? `${p.bpm} bpm` : 'Free time')), h('span', { html: icon('right'), style: { width: '20px', display: 'inline-flex' } }))),
      h('div', { class: 'actions' },
        (practiceOnly || loop || rate !== 1 || transpose) ? h('button', { class: 'btn ghost', onclick: () => { practiceOnly = false; loop = null; rate = 1; transpose = 0; refresh(); redraw(); } }, 'Reset') : null,
        h('button', { class: 'btn primary', onclick: () => api.close() }, 'Done')),
    ];
    const api = sheet(() => content(), { label: 'Practice tools' });
    box = api.el; grab = box.querySelector('.grab');
  }
  function mixDock() {
    const rows = p.layers.map((l, i) => {
      const vol = slider({ min: 0, max: 1.5, step: 0.01, value: l.gain, label: `${l.name} volume`, oninput: (v) => { l.gain = v; save(); } });
      return h('div', { class: 'row', style: { padding: '8px 2px', minHeight: '0', gap: '8px' } },
        h('span', { class: 'layerdot', style: { color: colorOf(l) }, 'aria-hidden': 'true' }),
        h('div', { style: { width: '92px', flex: 'none' } }, h('div', { style: { fontWeight: 700, fontSize: '.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, l.name), h('div', { class: 'tiny faint' }, l.id === p.baseLayerId ? 'Melody base' : (l.score != null ? `Score ${l.score}` : l.part || ''))),
        h('div', { class: 'grow' }, vol),
        h('button', { class: `iconbtn ${l.mute ? 'on' : ''}`, 'aria-pressed': String(!!l.mute), 'aria-label': `Mute ${l.name}`, html: icon('mute'), onclick: () => { l.mute = !l.mute; save(); refresh(); } }),
        h('button', { class: `iconbtn ${l.solo ? 'on' : ''}`, 'aria-pressed': String(!!l.solo), 'aria-label': `Solo ${l.name}`, html: icon('solo'), onclick: () => { l.solo = !l.solo; save(); refresh(); } }),
        h('button', { class: 'iconbtn', 'aria-label': `More for ${l.name}`, html: icon('dots'), onclick: () => layerMenu(l, i) }));
    });
    const backingRow = p.backingKey ? h('div', { class: 'row', style: { padding: '8px 2px', minHeight: '0', gap: '8px' } },
      h('span', { class: 'layerdot', style: { color: 'var(--text-faint)' } }), h('div', { style: { width: '92px', flex: 'none', fontWeight: 700, fontSize: '.9rem' } }, 'Backing'),
      h('div', { class: 'grow' }, slider({ min: 0, max: 1.5, step: 0.01, value: p.backingGain, label: 'Backing volume', oninput: (v) => { p.backingGain = v; save(); } })),
      h('button', { class: `iconbtn ${p.backingMute ? 'on' : ''}`, 'aria-label': 'Mute backing', html: icon('mute'), onclick: () => { p.backingMute = !p.backingMute; save(); refresh(); } })) : null;
    return [
      h('div', { class: 'bar' }, transportBtn(() => playPreview(false, true)), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, `${p.layers.length} layer${p.layers.length > 1 ? 's' : ''}`), h('div', { class: 'small dim', style: { display: 'flex', alignItems: 'center', gap: '2px' } }, 'Play the stack', infoBtn('Layers', 'Every take you keep becomes a layer. Play them together to hear your harmony stack.', 'M mutes a layer and S plays it on its own. Use the ⋯ menu on a layer to harmonise it again, so you can build three or four parts.'))),
        h('button', { class: `iconbtn ${stacked ? 'on' : ''}`, 'aria-pressed': String(stacked), 'aria-label': 'Show all layers', title: 'Show all layers', onclick: () => { stacked = !stacked; refresh(); }, html: icon('stack') }),
        h('button', { class: 'btn sm primary', onclick: () => openExport(p, { bufferFor, backingBuffer }), html: icon('export') + 'Export' })),
      h('div', { style: { maxHeight: '34vh', overflowY: 'auto' } }, backingRow, ...rows),
    ];
  }

  function applyLiveMode() {
    const live = tab === 'record' || tab === 'sing' || !p.layers.length;
    if (sv.hudEl) sv.hudEl.style.display = live ? '' : 'none';
    sv.showLive = live;
    if (live) { if (micReady) E.startMic().catch(() => {}); } else if (!playing) E.stopMic();
  }
  let micReady = false;

  // ---------- speaker notice ----------
  function updateSpeakerNotice() {
    noticeHost.replaceChildren();
    if (tab !== 'sing' || speakerNoticeDismissed || !E.onSpeaker() || !p.layers.length) return;
    noticeHost.append(h('div', { class: 'notice', role: 'note' }, ic('headphones'),
      h('div', { class: 'grow' }, h('b', {}, 'Headphones recommended. '), 'On the speaker, the mic can hear the playback. Echo cancellation is on, but headphones give the cleanest score.'),
      h('button', { class: 'iconbtn', 'aria-label': 'Dismiss', html: icon('close'), onclick: () => { speakerNoticeDismissed = true; updateSpeakerNotice(); } })));
  }
  const unRoute = route.on(() => updateSpeakerNotice());

  // ---------- recording the melody ----------
  async function recordMelody() {
    if (!(await micGate(sv.el))) return;
    await E.startMic();
    E.startRecording();
    const T = await E.play({ layers: await playLayers(), from: 0, clicks: clicksCfg(true) && { ...clicksCfg(true), metronome: settings.get('metronome') } });
    T.beatDur = p.bpm ? 60 / p.bpm : 0.5;
    playing = T; recording = true;
    sv.startTransport(T, { record: true });
    roll.set({ mode: 'scroll', follow: true, targets: [], lines: [] });
    haptic('medium');
    renderDock();
    clearTimeout(maxRecTimer);
    maxRecTimer = setTimeout(() => { if (recording && playing === T) { toast('Takes are limited to 5 minutes'); stopMelody(); } }, 5 * 60 * 1000);
  }
  let maxRecTimer = null;
  async function stopMelody() {
    clearTimeout(maxRecTimer);
    const T = playing; if (!T) return;
    const lat = E.roundTripLatency();
    T.stop(); playing = null; recording = false; sv.transport = null; sv.showCount(0);
    const rec = E.stopRecording();
    const aligned = E.alignRecording(rec, T, lat);
    if (aligned.length < E.sampleRate() * 0.6) { toast('That was very short. Try again.'); renderDock(); return; }
    dock.replaceChildren(h('div', { class: 'empty', style: { padding: '14px' } }, h('p', {}, 'Finding your notes…')));
    await new Promise((r) => setTimeout(r, 30));
    const res = analyseTake(aligned, E.sampleRate());
    if (!res.notes.length) { toast('No clear notes found. Sing a little louder, or move closer.', { ms: 4000 }); renderDock(); return; }
    // trim the tail silence
    const lastEnd = res.notes[res.notes.length - 1].end;
    const trimmed = aligned.subarray(0, Math.min(aligned.length, Math.round((lastEnd + 1) * E.sampleRate())));
    const audioKey = uid();
    await db.putAudio(audioKey, trimmed.slice());
    const layer = { id: uid(), name: 'Melody', colorIdx: nextColorIdx(p), gain: 1, mute: false, solo: false, audioKey, frames: packFrames(res.frames.filter((f, i) => i % 2 === 0)), role: 'melody', part: 'Melody', notes: res.notes, duration: trimmed.length / E.sampleRate() };
    p.layers.push(layer);
    p.baseLayerId = layer.id;
    p.notes = res.notes;
    p.key = res.key; p.keyCandidates = res.keyCandidates; p.keyConfirmed = false;
    p.duration = Math.max(p.duration, layer.duration);
    p._buf[layer.id] = { samples: trimmed, buffer: E.makeBuffer(trimmed) };
    await saveNow(p);
    tab = 'harmony';
    viewFitted = false;
    refresh();
    const c = p.keyCandidates || [];
    if (c.length > 1 && c[0].score - c[1].score < 0.04) keySheet(true);
    else toast(`Here is a ${harmonyLabel(p.harmony.defaultType).toLowerCase()} in ${keyName(p.key, settings.get('accidentals'))}. Tap play to hear it.`, { ms: 4200 });
  }

  // ---------- singing a harmony take ----------
  async function startTake() {
    if (!(await micGate(sv.el))) return;
    micReady = true;
    await E.startMic();
    const canRecordLayer = rate === 1 && transpose === 0 && !loop && !practiceOnly;
    if (canRecordLayer && p.layers.length >= settings.get('maxLayers')) { toast(`Layer limit reached (${settings.get('maxLayers')}). Delete one in Mix, or raise it in Settings.`); return; }
    toast('Preparing…', { ms: 900 });
    const layers = await playLayers();
    const targets = harmonyTargets(p).filter((t) => t.midi != null).map((t) => ({ ...t, midi: t.midi + transpose }));
    E.setPlaybackPitchProvider((ct) => {
      if (!playing) return null;
      const m = playing.toMusical(ct - E.outputLatency());
      const tgt = targets.find((t) => m >= t.start && m <= t.end);
      const out = [];
      for (const n of p.notes) if (m >= n.start && m <= n.end) out.push(n.midi + transpose);
      for (const l of p.layers) if (l.notes && l.id !== p.baseLayerId) for (const n of l.notes) if (m >= n.start && m <= n.end) out.push(n.midi + transpose);
      // a pitch on the current target is what the singer should be singing: never reject it
      return tgt ? out.filter((x) => Math.abs(x - tgt.midi) > 0.5) : out;
    });
    if (canRecordLayer) E.startRecording();
    const T = await E.play({ layers, from: loop ? loop.a : 0, rate, loop, guide: settings.get('guideTones') ? targets.map((t) => ({ ...t, midi: t.midi - transpose })) : [], guideGain: E.onSpeaker() ? 0.05 : 0.1, transpose, clicks: clicksCfg(!loop) });
    T.beatDur = p.bpm ? 60 / p.bpm / rate : 0.5;
    T._record = canRecordLayer;
    playing = T; recording = true;
    sv.startTransport(T, { record: true });
    refresh();
    sv.setTargets(roll.s.targets, { live: true });
    haptic('medium');
    watchEnd(T, () => stopTake());
  }
  function watchEnd(T, onEnd) {
    const end = Math.max(p.duration, ...p.notes.map((n) => n.end)) + 0.6;
    const tick = () => {
      if (T.stopped || playing !== T) return;
      if (!T.loop && T.heard() > end) { onEnd(); return; }
      setTimeout(tick, 100);
    };
    tick();
  }
  async function stopTake() {
    const T = playing; if (!T) return;
    const lat = E.roundTripLatency();
    T.stop(); playing = null; recording = false; sv.transport = null; sv.showCount(0);
    E.setPlaybackPitchProvider(null);
    const frames = sv.taken.slice();
    const rec = T._record ? E.stopRecording() : null;
    const targets = harmonyTargets(p).filter((t) => t.midi != null).map((t) => ({ ...t, midi: t.midi + transpose }));
    const inRange = loop ? targets.filter((t) => t.end > loop.a && t.start < loop.b) : targets.filter((t) => t.start < (frames.length ? frames[frames.length - 1].t : 0));
    const res = scoreTake(inRange, frames, scoringOpts());
    renderDock();
    if (!inRange.length || !frames.some((f) => f.midi != null)) { toast('No singing heard. Check the mic and try again.'); return; }
    announce(`Score ${res.score}. ${res.hitPct} percent of notes hit.`, { force: true });
    db.addHistory({ kind: 'harmony', ref: p.id, title: p.name, score: res.score, hitPct: res.hitPct, drift: res.drift, timing: res.timingBias, notes: res.notes.map((n) => ({ midi: n.midi, grade: n.grade, cents: n.cents == null ? null : Math.round(n.cents) })) });
    summarySheet(res, rec, T, lat, inRange);
  }

  function summarySheet(res, rec, T, lat, scoredTargets) {
    const worst = res.worst.map((i) => res.notes.find((n) => n.index === i)).filter(Boolean);
    const drift = res.drift;
    const tim = res.timingBias;
    // tint bars with results
    const byStart = new Map(res.notes.map((n) => [n.start.toFixed(3), n.grade]));
    for (const t of roll.s.targets) if (t.kind === 'target') t.result = byStart.get(t.start.toFixed(3)) || null;
    sheet((api) => [
      h('h2', { style: { textAlign: 'center' } }, res.score >= 90 ? 'Beautiful!' : res.score >= 75 ? 'Lovely harmony' : res.score >= 55 ? 'Getting there' : 'Keep going'),
      scoreRing(res.score),
      gradeBar(res.counts),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, `${res.hitPct}%`), h('span', {}, 'Notes hit')),
        h('div', { class: 'stat' }, h('b', {}, res.hitPct ? fmtCents(drift) : '—'), h('span', {}, !res.hitPct ? 'Pitch' : Math.abs(drift) < 5 ? 'Centred' : drift > 0 ? 'Tends sharp' : 'Tends flat')),
        h('div', { class: 'stat' }, h('b', {}, `${tim > 0 ? '+' : ''}${tim}ms`), h('span', {}, Math.abs(tim) < 40 ? 'On time' : tim > 0 ? 'Tends late' : 'Tends early'))),
      worst.length ? h('div', { class: 'list', style: { marginTop: '6px' } }, ...worst.map((n) => h('div', { class: 'row', style: { minHeight: '48px', padding: '10px 2px' } },
        h('span', { class: 'pill', style: { background: `color-mix(in srgb, var(--g-${n.grade}) 20%, transparent)`, color: `var(--g-${n.grade})` } }, n.grade),
        h('div', { class: 'grow' }, `${noteLabel(n.midi, { key: p.key, accidentals: settings.get('accidentals') })} at ${fmtTime(n.start)}`),
        h('span', { class: 'small dim mono' }, n.cents == null ? 'not sung' : fmtCents(n.cents))))) : null,
      h('div', { class: 'actions', style: { flexWrap: 'wrap' } },
        worst.length ? h('button', { class: 'btn ghost', onclick: () => { api.close(); practiceBit(worst); }, html: icon('loop') + 'Practise this bit' }) : null,
        rec ? h('button', { class: 'btn primary', onclick: async () => { api.close(); await keepLayer(rec, T, lat, res); }, html: icon('layers') + 'Keep as layer' }) : h('button', { class: 'btn primary', onclick: () => { api.close(); clearResults(); } }, 'Again')),
      rec ? h('button', { class: 'btn block', style: { marginTop: '8px', background: 'transparent' }, onclick: () => { api.close(); clearResults(); } }, 'Discard take') : null,
    ], { onClose: () => setTimeout(clearResults, 1200), label: 'Take summary' });
    void scoredTargets;
  }
  function clearResults() { for (const t of roll.s.targets) t.result = null; }

  function practiceBit(worst) {
    const n = worst[0];
    const bl = barLen(p);
    if (bl) { const b = Math.floor((n.start - p.beatOffset) / bl); loop = { a: p.beatOffset + b * bl, b: p.beatOffset + (b + 1) * bl }; if (loop.b - loop.a < 1.5) loop.b += bl; }
    else {
      const idx = p.notes.findIndex((x) => x.start <= n.start + 0.01 && x.end >= n.start);
      const a = p.notes[Math.max(0, idx - 1)] || n, b = p.notes[Math.min(p.notes.length - 1, idx + 1)] || n;
      loop = { a: Math.max(0, a.start - 0.4), b: b.end + 0.4 };
    }
    practiceOnly = true;
    tab = 'sing';
    refresh();
    toast('Looping the tricky bit. Tap play when ready.');
  }

  async function keepLayer(rec, T, lat, res) {
    const aligned = E.alignRecording(rec, T, lat);
    const sr = E.sampleRate();
    const trimmed = aligned.subarray(0, Math.min(aligned.length, Math.round((p.duration + 1) * sr)));
    const frames = analyseBuffer(trimmed, sr, { hop: Math.round(sr / 100), a4: settings.get('a4') });
    const audioKey = uid();
    await db.putAudio(audioKey, trimmed.slice());
    const type = p.harmony.regions.length ? 'Mixed parts' : harmonyLabel(p.harmony.defaultType, p.harmony.defaultSemis);
    const notes = harmonyTargets(p).filter((t) => t.midi != null).map((t) => ({ id: uid(), start: t.start, end: t.end, midi: t.midi }));
    const layer = { id: uid(), name: `Layer ${p.layers.length + 1}`, colorIdx: nextColorIdx(p), gain: 1, mute: false, solo: false, audioKey, frames: packFrames(frames), role: 'harmony', part: type, notes, score: res.score, duration: trimmed.length / sr };
    p.layers.push(layer);
    p._buf[layer.id] = { samples: trimmed, buffer: E.makeBuffer(trimmed) };
    p.bestScores.push({ at: Date.now(), score: res.score });
    await saveNow(p);
    haptic('heavy');
    toast(`Saved as ${layer.name}`, { icon: 'check' });
    clearResults();
    refresh();
  }

  // ---------- preview playback (edit / harmony / mix) ----------
  async function playPreview(withHarmonyGuide = false, all = false) {
    stopAll();
    const layers = await playLayers();
    const guide = withHarmonyGuide ? harmonyTargets(p).filter((t) => t.midi != null) : (all ? [] : []);
    const from = selection ? Math.min(selection.start, selection.end) : Math.max(0, roll.s.view.t0);
    const T = await E.play({ layers, from: from < p.duration - 0.2 ? from : 0, guide, guideGain: 0.16 });
    playing = T;
    renderDock();
    const step = () => {
      if (playing !== T) return;
      const m = T.heard();
      roll.set({ playhead: m });
      // keep playhead in view
      const v = roll.s.view, span = v.t1 - v.t0;
      if (m > v.t1 - span * 0.1) roll.set({ view: { t0: m - span * 0.2, t1: m + span * 0.8 } });
      if (m > Math.max(p.duration, ...p.notes.map((n) => n.end)) + 0.4) { stopAll(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function stopAll() {
    if (playing) { playing.stop(); playing = null; }
    if (recording) { recording = false; E.stopRecording(); }
    sv.transport = null; sv.showCount(0);
    roll.set({ playhead: null });
    E.setPlaybackPitchProvider(null);
    if (dock.isConnected) renderDock();
  }

  // ---------- edit operations ----------
  function sel() { return p.notes.find((n) => n.id === selectedId); }
  function moveSel(dt, dm) {
    const n = sel(); if (!n) return;
    pushUndo();
    n.start = Math.max(0, n.start + dt); n.end = Math.max(n.start + 0.05, n.end + dt); n.midi += dm; n.edited = true;
    if (dm) E.tone(n.midi, 0.35, { gain: 0.25 });
    syncBaseNotes(); refresh();
  }
  function splitSel() {
    const n = sel(); if (!n || n.end - n.start < 0.16) return;
    pushUndo();
    const mid = (n.start + n.end) / 2;
    const b = { ...n, id: uid(), start: mid };
    n.end = mid;
    p.notes.splice(p.notes.indexOf(n) + 1, 0, b);
    syncBaseNotes(); refresh();
  }
  function mergeSel() {
    const n = sel(); const i = p.notes.indexOf(n); const nx = p.notes[i + 1];
    if (!nx) return;
    pushUndo();
    n.end = nx.end; p.notes.splice(i + 1, 1);
    syncBaseNotes(); refresh();
  }
  function deleteSel() {
    const n = sel(); if (!n) return;
    pushUndo();
    p.notes.splice(p.notes.indexOf(n), 1); selectedId = null;
    syncBaseNotes(); refresh();
  }
  function addNote() {
    pushUndo();
    const v = roll.s.view;
    const t = (v.t0 + v.t1) / 2;
    const n = { id: uid(), start: t, end: t + 0.5, midi: snapToKey(roll.s.centerMidi, p.key), edited: true };
    p.notes.push(n); p.notes.sort((a, b) => a.start - b.start);
    selectedId = n.id;
    syncBaseNotes(); refresh();
  }
  function snapAll() {
    pushUndo();
    for (const n of p.notes) n.midi = snapToKey(n.raw ?? n.midi, p.key);
    syncBaseNotes(); refresh(); toast('All notes snapped to the key');
  }
  function quantiseAll() {
    pushUndo();
    const q = quantise(p.notes, { bpm: p.bpm, division: 0.5, offset: p.beatOffset });
    p.notes = q.map((n) => ({ ...n })); syncBaseNotes(); refresh(); toast('Snapped to eighth notes');
  }

  // ---------- harmony ops ----------
  function applyHarmony(type, semis = 0) {
    pushUndo();
    if (selection) {
      const a = Math.min(selection.start, selection.end), b = Math.max(selection.start, selection.end);
      p.harmony.regions = setRegion(p.harmony.regions, a, b, type, semis);
    } else { p.harmony.defaultType = type; p.harmony.defaultSemis = semis; p.harmony.regions = p.harmony.regions.filter((r) => r.type !== type); }
    save(); refresh();
    haptic('light');
  }
  function customInterval() {
    let v = p.harmony.defaultType === 'custom' ? p.harmony.defaultSemis : 4;
    const val = h('div', { class: 'big-num', style: { textAlign: 'center', margin: '12px 0' } });
    const draw = () => { val.textContent = `${v > 0 ? '+' : ''}${v}`; };
    draw();
    sheet((api) => [
      h('h2', {}, 'Custom interval'), h('p', { class: 'dim small' }, `Semitones from the melody${p.harmony.diatonic ? ', then nudged into the key' : ''}.`),
      val,
      h('div', { class: 'bar', style: { display: 'flex', gap: '10px', justifyContent: 'center' } }, h('button', { class: 'btn', onclick: () => { v = Math.max(-12, v - 1); draw(); } }, '−1'), h('button', { class: 'btn', onclick: () => { v = Math.min(12, v + 1); draw(); } }, '+1')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { api.close(); applyHarmony('custom', v); } }, 'Apply')),
    ]);
  }
  function chordSheet(i) {
    const k = p.key;
    const degs = [0, 1, 2, 3, 4, 5, 6];
    sheet((api) => [
      h('h2', {}, `Bar ${i + 1} chord`),
      h('div', { class: 'chips wrapc', style: { marginTop: '10px' } }, ...degs.map((d) => {
        const tri = diatonicTriad(d, k); const third = (tri[1] - tri[0] + 12) % 12, fifth = (tri[2] - tri[0] + 12) % 12;
        const ch = { root: tri[0], quality: fifth === 6 ? 'dim' : third === 3 ? 'min' : 'maj' };
        return h('button', { class: 'chip', onclick: () => { p.harmony.chords[i] = ch; save(); api.close(); refresh(); } }, chordName(ch, settings.get('accidentals'), k));
      })),
    ]);
  }

  // ---------- gestures on the roll ----------
  const ptrs = new Map();
  let drag = null;
  sv.canvas.addEventListener('pointerdown', (e) => {
    if (tab === 'record' || tab === 'sing' || !p.layers.length) return;
    sv.canvas.setPointerCapture(e.pointerId);
    const r = sv.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    ptrs.set(e.pointerId, { x, y });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, view: { ...roll.s.view }, t: roll.xToTime((a.x + b.x) / 2) }; return; }
    const hit = roll.hitBar(x, y);
    if (tab === 'edit' && hit && hit.note.ref) {
      const n = hit.note.ref;
      if (selectedId !== n.id) { selectedId = n.id; E.tone(n.midi, 0.3, { gain: 0.22 }); }
      pushUndo();
      drag = { kind: 'bar', edge: hit.edge, n, x0: x, y0: y, start: n.start, end: n.end, midi: n.midi, moved: false };
      refresh();
      return;
    }
    if (tab === 'harmony' && y > roll.s.bandH) {
      const t = roll.xToTime(x);
      drag = { kind: 'select', t0: t, x0: x, moved: false, hit };
      return;
    }
    drag = { kind: 'pan', x0: x, y0: y, view: { ...roll.s.view }, c0: roll.s.centerMidi, moved: false };
  });
  sv.canvas.addEventListener('pointermove', (e) => {
    if (!drag || !ptrs.has(e.pointerId)) return;
    const r = sv.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    ptrs.set(e.pointerId, { x, y });
    const pxPerSec = (roll.plotX1 - roll.plotX0) / (roll.s.view.t1 - roll.s.view.t0);
    if (drag.kind === 'pinch' && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.max(0.2, Math.min(5, drag.d0 / Math.max(10, d)));
      const span = Math.max(1, Math.min(120, (drag.view.t1 - drag.view.t0) * k));
      const frac = (drag.cx - roll.plotX0) / (roll.plotX1 - roll.plotX0);
      const cxNow = (a.x + b.x) / 2;
      const shift = ((cxNow - drag.cx) / (roll.plotX1 - roll.plotX0)) * span;
      roll.set({ view: { t0: drag.t - frac * span - shift, t1: drag.t + (1 - frac) * span - shift } });
      return;
    }
    if (drag.kind === 'bar') {
      const dx = (x - drag.x0) / pxPerSec, dm = Math.round((drag.y0 - y) / roll.rowH());
      if (Math.abs(x - drag.x0) > 4 || Math.abs(y - drag.y0) > 4) drag.moved = true;
      const n = drag.n;
      if (drag.edge === 'start') n.start = Math.min(drag.end - 0.06, Math.max(0, drag.start + dx));
      else if (drag.edge === 'end') n.end = Math.max(drag.start + 0.06, drag.end + dx);
      else {
        const nm = drag.midi + dm;
        if (nm !== n.midi) { n.midi = nm; E.tone(nm, 0.25, { gain: 0.2 }); haptic('light'); }
        const len = drag.end - drag.start;
        n.start = Math.max(0, drag.start + dx); n.end = n.start + len;
      }
      n.edited = true;
      refresh();
      return;
    }
    if (drag.kind === 'select') {
      if (Math.abs(x - drag.x0) > 6) drag.moved = true;
      if (drag.moved) { selection = { start: Math.max(0, drag.t0), end: Math.max(0, roll.xToTime(x)) }; roll.set({ selection }); }
      return;
    }
    if (drag.kind === 'pan') {
      if (Math.abs(x - drag.x0) > 4 || Math.abs(y - drag.y0) > 4) drag.moved = true;
      const dt = (x - drag.x0) / pxPerSec;
      roll.set({ view: { t0: drag.view.t0 - dt, t1: drag.view.t1 - dt }, centerMidi: drag.c0 + (y - drag.y0) / roll.rowH() });
    }
  });
  const endPtr = (e) => {
    ptrs.delete(e.pointerId);
    if (!drag) return;
    if (drag.kind === 'bar') {
      if (!drag.moved) undo.pop();
      p.notes.sort((a, b) => a.start - b.start);
      syncBaseNotes();
    } else if (drag.kind === 'select') {
      if (!drag.moved) {
        // tap: select the note's span under the finger, or clear
        if (drag.hit) selection = { start: drag.hit.note.start, end: drag.hit.note.end };
        else selection = null;
      } else if (selection && Math.abs(selection.end - selection.start) < 0.1) selection = null;
      // snap selection to note boundaries for musicality
      if (selection) {
        const a = Math.min(selection.start, selection.end), b = Math.max(selection.start, selection.end);
        const inside = p.notes.filter((n) => (n.start + n.end) / 2 >= a && (n.start + n.end) / 2 <= b);
        if (inside.length) selection = { start: inside[0].start - 0.01, end: inside[inside.length - 1].end + 0.01 };
      }
      renderDock(); refresh();
    } else if (drag.kind === 'pan' && !drag.moved && tab === 'edit') { selectedId = null; refresh(); }
    if (ptrs.size === 0) drag = null;
  };
  sv.canvas.addEventListener('pointerup', endPtr);
  sv.canvas.addEventListener('pointercancel', endPtr);
  sv.canvas.addEventListener('wheel', (e) => {
    if (roll.s.mode !== 'edit') return;
    e.preventDefault();
    const v = roll.s.view, span = v.t1 - v.t0;
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(e.deltaY * 0.01);
      const r = sv.canvas.getBoundingClientRect();
      const t = roll.xToTime(e.clientX - r.left);
      const ns = Math.max(1, Math.min(120, span * k));
      roll.set({ view: { t0: t - (t - v.t0) * (ns / span), t1: t + (v.t1 - t) * (ns / span) } });
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dt = ((e.deltaX || e.deltaY) / 400) * span;
      roll.set({ view: { t0: v.t0 + dt, t1: v.t1 + dt } });
    } else roll.set({ centerMidi: roll.s.centerMidi - e.deltaY / 60 });
  }, { passive: false });
  // keyboard editing for accessibility
  sv.canvas.tabIndex = 0;
  sv.canvas.addEventListener('keydown', (e) => {
    if (tab !== 'edit') return;
    const i = p.notes.findIndex((n) => n.id === selectedId);
    if (e.key === 'Tab') { e.preventDefault(); const j = (i + (e.shiftKey ? -1 : 1) + p.notes.length) % p.notes.length; selectedId = p.notes[j]?.id; refresh(); return; }
    if (i < 0) return;
    if (e.key === 'ArrowUp') moveSel(0, 1); else if (e.key === 'ArrowDown') moveSel(0, -1);
    else if (e.key === 'ArrowLeft') moveSel(-0.05, 0); else if (e.key === 'ArrowRight') moveSel(0.05, 0);
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
    else return;
    e.preventDefault();
  });

  // ---------- sheets ----------
  function keySheet(afterAnalysis = false) {
    const cands = (p.keyCandidates || []).slice(0, 3);
    let chosen = p.key || { root: 0, mode: 'major' };
    const grid = h('div', { class: 'chips wrapc', style: { marginTop: '8px' } });
    const draw = () => {
      grid.replaceChildren(...SHARP_NAMES.flatMap((_, r) => ['major', 'minor'].map((mode) => h('button', { class: `chip ${chosen.root === r && chosen.mode === mode ? 'on' : ''}`, onclick: () => { chosen = { root: r, mode }; draw(); E.sequence(MODES[mode].concat(12).map((s, i) => ({ start: i * 0.13, end: i * 0.13 + 0.12, midi: 60 + ((r + 5) % 12) - 5 + s })), { gain: 0.18 }); } }, keyName({ root: r, mode }, settings.get('accidentals'))))));
    };
    draw();
    sheet((api) => [
      h('h2', {}, afterAnalysis ? 'Is this the right key?' : 'Key'),
      h('p', { class: 'dim small' }, afterAnalysis ? `We found ${p.notes.length} notes. The key decides which notes the harmony uses.` : 'Changing the key re-fits your notes and harmony.'),
      cands.length ? h('div', { class: 'chips wrapc', style: { marginTop: '12px' } }, ...cands.map((c, i) => h('button', { class: `chip ${chosen.root === c.root && chosen.mode === c.mode ? 'on' : ''}`, onclick: () => { chosen = { root: c.root, mode: c.mode }; draw(); api.el.querySelectorAll('.chips')[0].querySelectorAll('.chip').forEach((b, j) => b.classList.toggle('on', j === i)); } }, `${i === 0 ? 'Best match: ' : ''}${keyName(c, settings.get('accidentals'))}`))) : null,
      h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'small dim', style: { cursor: 'pointer', padding: '6px 0' } }, 'All keys'), grid),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
        const changed = !p.key || chosen.root !== p.key.root || chosen.mode !== p.key.mode;
        p.key = chosen; p.keyConfirmed = true;
        if (changed) { pushUndo(); for (const n of p.notes) if (!n.edited) n.midi = snapToKey(n.raw ?? n.midi, p.key); p.harmony.chords = []; syncBaseNotes(); }
        save(); api.close(); refresh();
        if (afterAnalysis) toast('Drag bars to fix any notes, then open Harmony.', { ms: 3500 });
      } }, afterAnalysis ? 'Looks right' : 'Use this key')),
    ], { label: 'Key' });
  }

  function tempoSheet() {
    let bpm = p.bpm || 90, bpb = p.beatsPerBar || 4, free = !p.bpm;
    const num = h('div', { class: 'big-num', style: { textAlign: 'center' } });
    const draw = () => { num.textContent = free ? 'Free' : `${bpm}`; };
    draw();
    let tapTimes = [];
    sheet((api) => [
      h('h2', {}, 'Tempo'),
      seg([['free', 'Free time'], ['tempo', 'Tempo']], free ? 'free' : 'tempo', (v) => { free = v === 'free'; draw(); }, 'Time mode'),
      h('div', { style: { margin: '14px 0' } }, num, h('p', { class: 'small dim', style: { textAlign: 'center' } }, 'beats per minute')),
      h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
        h('button', { class: 'btn sm', onclick: () => { free = false; bpm = Math.max(40, bpm - 5); draw(); } }, '−5'),
        h('button', { class: 'btn sm', onclick: () => { free = false; bpm = Math.max(40, bpm - 1); draw(); } }, '−1'),
        h('button', { class: 'btn sm violet', onclick: () => { const t = performance.now(); tapTimes = tapTimes.filter((x) => t - x < 3000); tapTimes.push(t); if (tapTimes.length > 1) { free = false; bpm = Math.round(60000 / ((tapTimes[tapTimes.length - 1] - tapTimes[0]) / (tapTimes.length - 1))); bpm = Math.max(40, Math.min(220, bpm)); draw(); } } }, 'Tap'),
        h('button', { class: 'btn sm', onclick: () => { free = false; bpm = Math.min(220, bpm + 1); draw(); } }, '+1'),
        h('button', { class: 'btn sm', onclick: () => { free = false; bpm = Math.min(220, bpm + 5); draw(); } }, '+5')),
      h('div', { class: 'kv', style: { marginTop: '16px' } }, h('span', {}, 'Beats per bar'), seg([['2', '2'], ['3', '3'], ['4', '4'], ['6', '6']], String(bpb), (v) => { bpb = Number(v); }, 'Beats per bar')),
      h('div', { class: 'kv', style: { marginTop: '12px' } }, h('span', {}, 'Metronome'), toggle(settings.get('metronome'), (v) => settings.set('metronome', v), 'Metronome')),
      h('div', { class: 'kv', style: { marginTop: '12px' } }, h('span', {}, 'Count-in'), seg([['0', 'Off'], ['1', '1 bar'], ['2', '2 bars']], settings.get('countIn'), (v) => settings.set('countIn', v), 'Count-in')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { p.bpm = free ? null : bpm; p.beatsPerBar = bpb; p.harmony.chords = []; save(); api.close(); refresh(); } }, 'Done')),
    ], { label: 'Tempo' });
  }

  function toggleLoop() {
    if (loop) { loop = null; refresh(); return; }
    if (selection) { loop = { a: Math.min(selection.start, selection.end), b: Math.max(selection.start, selection.end) }; }
    else {
      const bl = barLen(p);
      const span = bl ? bl * 2 : 4;
      loop = { a: 0, b: Math.min(p.duration, span) };
      toast('Looping the opening. Select a section in Harmony to loop it instead.');
    }
    practiceOnly = true;
    refresh();
  }
  function setRate(v) { rate = v; if (rate !== 1) practiceOnly = true; renderDock(); }
  function setTranspose(v) { transpose = v; if (v) practiceOnly = true; refresh(); }

  function layerMenu(l) {
    sheet((api) => [
      h('h2', {}, l.name), h('p', { class: 'dim small' }, l.part || ''),
      h('div', { class: 'list', style: { marginTop: '10px' } },
        h('button', { class: 'row', onclick: async () => { api.close(); const n = await askName(l.name); if (n) { l.name = n; save(); refresh(); } } }, ic('edit'), h('div', { class: 'grow' }, 'Rename')),
        l.id !== p.baseLayerId ? h('button', { class: 'row', onclick: () => { api.close(); useAsBase(l); } }, ic('layers'), h('div', { class: 'grow' }, h('div', {}, 'Harmonise this layer'), h('div', { class: 'small faint' }, 'Use it as the melody for a new part'))) : null,
        h('button', { class: 'row', onclick: () => { api.close(); l.colorIdx = (l.colorIdx + 1) % LAYER_COLORS.length; save(); refresh(); } }, ic('spark'), h('div', { class: 'grow' }, 'Change colour')),
        h('button', { class: 'row', onclick: async () => { api.close(); if (await confirmSheet({ title: `Delete ${l.name}?`, body: 'This recording will be removed.', ok: 'Delete', danger: true })) await deleteLayer(l); } }, ic('trash'), h('div', { class: 'grow', style: { color: 'var(--c-coral)' } }, 'Delete layer'))),
    ]);
  }
  async function useAsBase(l) {
    syncBaseNotes();
    let notes = l.notes;
    if (!notes || !notes.length) {
      const s = p._buf[l.id]?.samples || await db.getAudio(l.audioKey);
      notes = analyseTake(s, E.sampleRate(), { key: p.key }).notes;
    }
    l.notes = notes.map((n) => ({ ...n, id: n.id || uid() }));
    p.baseLayerId = l.id; p.notes = l.notes; p.harmony.regions = [];
    save(); tab = 'harmony'; refresh();
    toast(`${l.name} is now the melody. Pick a harmony for it.`);
  }
  async function deleteLayer(l) {
    p.layers = p.layers.filter((x) => x !== l);
    await db.deleteAudio(l.audioKey);
    delete p._buf[l.id];
    if (p.baseLayerId === l.id) {
      const nb = p.layers[0];
      p.baseLayerId = nb ? nb.id : null;
      p.notes = nb ? (nb.notes || []) : [];
      if (!nb) { tab = 'record'; p.key = null; p.harmony.regions = []; p.duration = 0; }
    }
    await saveNow(p);
    refresh();
  }

  function menu() {
    sheet((api) => [
      h('h2', {}, p.name),
      h('div', { class: 'list', style: { marginTop: '10px' } },
        h('button', { class: 'row', onclick: () => { api.close(); tempoSheet(); } }, ic('metronome'), h('div', { class: 'grow' }, 'Tempo and count-in')),
        p.layers.length ? h('button', { class: 'row', onclick: () => { api.close(); keySheet(); } }, ic('key'), h('div', { class: 'grow' }, 'Key')) : null,
        p.layers.length ? h('button', { class: 'row', onclick: () => { api.close(); openExport(p, { bufferFor, backingBuffer }); } }, ic('export'), h('div', { class: 'grow' }, 'Export audio or video')) : null,
        h('button', { class: 'row', onclick: () => { api.close(); rename(); } }, ic('edit'), h('div', { class: 'grow' }, 'Rename')),
        h('button', { class: 'row', onclick: () => { api.close(); go('/calibrate'); } }, ic('calibrate'), h('div', { class: 'grow' }, 'Calibrate latency')),
        h('button', { class: 'row', onclick: async () => { api.close(); if (await confirmSheet({ title: 'Delete project?', body: 'All its recordings will be removed from this device.', ok: 'Delete', danger: true })) { await db.deleteProject(p); go('/', { replace: true }); } } }, ic('trash'), h('div', { class: 'grow', style: { color: 'var(--c-coral)' } }, 'Delete project'))),
    ]);
  }
  async function rename() { const n = await askName(p.name); if (n) { p.name = n; titleEl.textContent = n; save(); } }

  refresh();
  return {
    el,
    async mounted() {
      if (!p.layers.length) { const ok = await micGate(sv.el); if (ok) { micReady = true; await E.startMic().catch(() => {}); } }
      else E.ensureContext().catch(() => {});
    },
    keys: {
      space: () => {
        if (!p.layers.length) { recording ? stopMelody() : recordMelody(); return; }
        if (tab === 'sing') { recording ? stopTake() : startTake(); return; }
        if (playing) stopAll(); else playPreview(tab === 'harmony', tab === 'mix');
      },
      r: () => { if (!p.layers.length) { recording ? stopMelody() : recordMelody(); } else { if (tab !== 'sing') { stopAll(); tab = 'sing'; refresh(); } recording ? stopTake() : startTake(); } },
      h: () => { if (p.layers.length && !recording) { stopAll(); tab = 'harmony'; refresh(); } },
      s: () => { if (p.layers.length && !recording) { stopAll(); tab = 'sing'; refresh(); } },
      m: () => { if (p.layers.length && !recording) { stopAll(); tab = 'mix'; refresh(); } },
      n: () => { if (p.layers.length && !recording) { stopAll(); tab = 'edit'; refresh(); sv.canvas.focus(); } },
    },
    onBack() {
      if (recording) { tab === 'record' || !p.layers.length ? stopMelody() : stopTake(); return true; }
      if (playing) { stopAll(); return true; }
      return false;
    },
    onHide() { if (recording) { recording ? (tab === 'record' ? stopMelody() : stopTake()) : null; } else stopAll(); saveNow(p); },
    onInterrupt() { if (recording) { toast('Recording interrupted. Your take was kept.'); tab === 'record' ? stopMelody() : stopTake(); } else stopAll(); },
    destroy() {
      // leaving mid-recording: keep the take rather than silently discarding it
      if (recording && playing && (tab === 'record' || !p.layers.length)) { stopMelody().catch(() => {}); }
      else stopAll();
      clearTimeout(maxRecTimer);
      sv.destroy(); unRoute(); E.stopMic(); saveNow(p).catch(() => {});
    },
  };
}
