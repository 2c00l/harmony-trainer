// Individual trainers: range, warm-ups, pitch match, intervals, sustain, vibrato, drone.
import { h, topbar, toast, sheet, seg, ic, haptic, fmtCents, toggle } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { SingView } from '../ui/singview.mjs';
import { back, go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { settings } from '../core/settings.mjs';
import { db } from '../core/db.mjs';
import { noteLabel, voiceType, keyName, SHARP_NAMES } from '../dsp/theory.mjs';
import { stability, vibrato as vibratoAnalyse, centsErr } from '../dsp/score.mjs';
import { userRange, WARMUPS, warmupSteps, sirenCurve, pickInterval, adaptLevel, pitchMatchNote } from '../core/exercises.mjs';
import { micGate } from './mic-gate.mjs';
import { runExercise, recordHistory, resultSheet } from './runner.mjs';
import { TRAINERS } from './train.mjs';

export async function render(id) {
  const meta = TRAINERS.find((t) => t.id === id);
  if (!meta) { go('/train', { replace: true }); return { el: h('div') }; }
  const sv = new SingView({ roll: { nowX: 0.62 } });
  const panel = h('div', { class: 'dock' });
  const el = h('div', {}, topbar({ title: meta.title, back: () => back('/train') }), sv.el, panel);
  let stopFn = null, alive = true;
  const cleanups = [];
  const range = () => userRange(settings.meta('range'));
  const label = (m, oct = true) => noteLabel(m, { style: settings.get('labels'), accidentals: settings.get('accidentals'), octave: oct });
  const setPanel = (...kids) => panel.replaceChildren(...kids.flat().filter(Boolean));
  const bigBtn = (txt, onclick, cls = 'primary', ico = 'play') => h('button', { class: `btn ${cls} block`, onclick, html: icon(ico) + txt });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function ensureMic() { if (!(await micGate(sv.el))) return false; await E.startMic(); return true; }

  // ---------------- RANGE ----------------
  async function rangeFinder() {
    let lo = null, hi = null;
    const intro = () => setPanel(
      h('p', { class: 'dim' }, 'Two quick slides. First glide down to your lowest comfortable note on “ah”, then up to your highest. No straining: comfortable is what counts.'),
      bigBtn('Start with the low slide', () => capture('low')));
    async function capture(which) {
      if (!(await ensureMic())) return;
      const frames = [];
      const un = E.onPitch((f) => { if (f.midi != null && f.clarity > 0.75 && f.rms > settings.get('noiseGate') * 2) frames.push(f.midi); });
      let left = 6;
      const msg = h('p', { style: { fontWeight: 700, textAlign: 'center' } });
      const bar = h('div', { class: 'progressbar' }, h('i', { style: { width: '0%' } }));
      setPanel(h('p', { class: 'dim', style: { textAlign: 'center' } }, which === 'low' ? 'Glide down slowly… and hold the bottom.' : 'Now glide up slowly… and hold the top.'), bar, msg);
      for (; left > 0 && alive; left--) { msg.textContent = `${left}`; bar.firstChild.style.width = `${((6 - left + 1) / 6) * 100}%`; await wait(1000); }
      un();
      if (frames.length < 15) { toast('Didn’t catch enough. Try again a little louder.'); intro(); return; }
      const s = frames.slice().sort((a, b) => a - b);
      if (which === 'low') { lo = Math.round(s[Math.floor(s.length * 0.04)]); setPanel(h('p', {}, `Lowest: `, h('b', {}, label(lo))), bigBtn('Now the high slide', () => capture('high'))); }
      else { hi = Math.round(s[Math.ceil(s.length * 0.96) - 1]); done(); }
    }
    function done() {
      if (hi - lo < 5) { toast('That range looks very narrow. Let’s try again.'); intro(); return; }
      settings.meta('range', { lo, hi, at: Date.now() });
      haptic('medium');
      sv.roll.set({ targets: [{ start: E.now() - 3, end: E.now() + 30, midi: lo, kind: 'ghost' }, { start: E.now() - 3, end: E.now() + 30, midi: hi, kind: 'ghost' }] });
      setPanel(
        h('div', { style: { textAlign: 'center' } },
          h('div', { class: 'small dim' }, 'Your comfortable range'),
          h('div', { class: 'big-num' }, `${label(lo)} – ${label(hi)}`),
          h('p', { class: 'dim' }, `${hi - lo} semitones. Roughly a ${voiceType(lo, hi).toLowerCase()} range. Voice types are only a guide.`)),
        h('div', { style: { display: 'flex', gap: '10px' } }, h('button', { class: 'btn ghost', style: { flex: 1 }, onclick: intro }, 'Redo'), h('button', { class: 'btn primary', style: { flex: 1 }, onclick: () => back('/train') }, 'Done')));
    }
    intro();
    if (await ensureMic()) { /* show live line straight away */ }
  }

  // ---------------- WARM-UPS ----------------
  async function warmups() {
    const list = () => setPanel(
      h('p', { class: 'small dim' }, `Fitted to your range: ${label(range().lo)}–${label(range().hi)}.`),
      h('div', { class: 'list', style: { maxHeight: '40vh', overflowY: 'auto' } }, ...WARMUPS.map((w) => h('button', { class: 'row', onclick: () => run(w) }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, w.title), h('div', { class: 'small faint' }, w.sub)), h('span', { html: icon('play'), style: { width: '22px', color: 'var(--accent)' } })))));
    async function run(w) {
      if (!(await ensureMic())) return;
      if (w.kind === 'curve') return siren(w);
      const { notes, bpm } = warmupSteps(w, range(), 4);
      setPanel(h('p', { class: 'dim', style: { textAlign: 'center' } }, `${w.title}: follow the bars. ${w.id === 'hum' ? 'Hum or lip-trill gently.' : 'Sing on “ah” or “oo”.'}`), bigBtn('Stop', () => stopFn?.(), 'ghost', 'stop'));
      const res = await runExercise(sv, { targets: notes, guide: true, guideGain: 0.16, bpm, countInBeats: 4, onStop: (f) => (stopFn = f) });
      if (!res || !alive) { list(); return; }
      recordHistory('warmups', w.id, w.title, res);
      resultSheet(res, { again: () => run(w), next: list, nextLabel: 'More warm-ups' });
      list();
    }
    async function siren(w) {
      const t0 = E.now() + 0.6;
      const curve = sirenCurve(range(), 7, t0);
      sv.roll.set({ guideCurve: curve, followTarget: (range().lo + range().hi) / 2, semis: Math.max(settings.get('zoom'), range().hi - range().lo + 4) });
      E.sequence([{ start: 0.4, end: 0.9, midi: range().lo + 1 }], { gain: 0.2 });
      const errs = [];
      const un = E.onPitch((f) => {
        if (f.midi == null) return;
        const p = curve.find((c) => c.t >= f.t);
        if (p) errs.push(Math.abs(f.midi - p.midi));
      });
      setPanel(h('p', { class: 'dim', style: { textAlign: 'center' } }, `${w.title}: trace the violet curve with your voice, smoothly like a siren.`), bigBtn('Stop', () => stopFn?.(), 'ghost', 'stop'));
      let aborted = false; stopFn = () => { aborted = true; };
      for (let i = 0; i < 80 && !aborted && alive; i++) await wait(100);
      un();
      sv.roll.set({ guideCurve: null, followTarget: null, semis: settings.get('zoom') });
      if (aborted || !alive) { list(); return; }
      if (errs.length < 20) { toast('Didn’t hear much. Try again with a clear “oo”.'); list(); return; }
      const within = errs.filter((e) => e < 1).length / errs.length;
      const score = Math.round(within * 100);
      recordHistory('warmups', 'siren', 'Sirens', { score, hitPct: score, drift: 0, timingBias: 0, notes: [] });
      toast(`Siren smoothness: ${score}%`, { icon: 'check' });
      list();
    }
    list();
    await ensureMic();
  }

  // ---------------- PITCH MATCH ----------------
  async function pitchMatch() {
    let level = settings.meta('pmLevel') || 1, round = 0, scores = [], prev = null;
    const status = h('div', { class: 'kv' });
    const show = (txt) => setPanel(status, h('p', { class: 'dim', style: { textAlign: 'center', minHeight: '2.6em' } }, txt), bigBtn('Stop', () => { stopFn?.(); intro(); }, 'ghost', 'stop'));
    const drawStatus = () => status.replaceChildren(h('span', { class: 'pill accent' }, `Level ${level}`), h('span', { class: 'small dim' }, `Round ${round}/10`), h('span', { class: 'small dim' }, scores.length ? `Avg ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}` : ''));
    const intro = () => setPanel(h('p', { class: 'dim' }, 'Listen to a note, then sing it back and hold it. The range widens as you get better.'), h('div', { class: 'kv' }, h('span', {}, 'Starting level'), h('span', { class: 'pill accent' }, `Level ${level}`)), bigBtn('Start 10 rounds', start));
    async function start() {
      if (!(await ensureMic())) return;
      round = 0; scores = [];
      let aborted = false; stopFn = () => { aborted = true; };
      const notes = [];
      while (round < 10 && !aborted && alive) {
        round++; drawStatus();
        const m = pitchMatchNote(level, range(), prev); prev = m;
        show('Listen…');
        sv.roll.set({ followTarget: m });
        await E.tone(m, 1.0, { gain: 0.32 });
        await wait(1150);
        if (aborted) break;
        show(`Now sing it: ${label(m)}`);
        const t0 = E.now();
        sv.roll.set({ targets: [{ start: t0, end: t0 + 1.8, midi: m, kind: 'target', label: label(m, false) }] });
        const errs = [];
        const un = E.onPitch((f) => { if (f.midi != null && f.t > t0 + 0.25 && f.t < t0 + 1.8) errs.push(centsErr(f.midi, m, true)); });
        await wait(1900);
        un();
        const sorted = errs.slice().sort((a, b) => a - b);
        const med = sorted.length > 5 ? sorted[sorted.length >> 1] : null;
        const sc = med == null ? 0 : Math.max(0, Math.round(100 - Math.max(0, Math.abs(med) - 8) * 1.6));
        scores.push(sc);
        notes.push({ midi: m, grade: med == null ? 'miss' : Math.abs(med) <= settings.get('tolPerfect') ? 'perfect' : Math.abs(med) <= settings.get('tolGood') ? 'good' : Math.abs(med) <= settings.get('tolOk') ? 'ok' : 'miss', cents: med == null ? null : Math.round(med) });
        sv.roll.s.targets[0].result = notes[notes.length - 1].grade;
        if (sc >= 85) { haptic('light'); if (settings.get('particles')) sv.roll.burst(sv.roll.timeToX(t0 + 1.8), sv.roll.midiToY(m), sv.roll.colors['--g-perfect']); }
        show(med == null ? 'Didn’t hear that one.' : `${sc >= 85 ? 'Spot on!' : sc >= 60 ? 'Close.' : 'Not quite.'} ${fmtCents(med)}`);
        level = adaptLevel(level, scores);
        await wait(900);
      }
      sv.roll.set({ followTarget: null });
      if (scores.length < 3 || !alive) { intro(); return; }
      settings.meta('pmLevel', level);
      const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      const counts = { perfect: 0, good: 0, ok: 0, miss: 0 }; notes.forEach((n) => counts[n.grade]++);
      const hits = notes.filter((n) => n.grade !== 'miss');
      const res = { score: avg, hitPct: Math.round((hits.length / notes.length) * 100), drift: hits.length ? Math.round(hits.reduce((a, n) => a + n.cents, 0) / hits.length) : 0, timingBias: 0, counts, notes };
      recordHistory('match', 'match', 'Pitch match', res);
      resultSheet(res, { again: start, next: () => back('/train'), nextLabel: 'Done', extra: h('p', { class: 'small dim', style: { textAlign: 'center' } }, `Next session starts at level ${level}.`) });
      intro();
    }
    intro();
    await ensureMic();
  }

  // ---------------- INTERVALS ----------------
  async function intervals() {
    let level = settings.meta('ivLevel') || 1;
    const intro = () => setPanel(h('p', { class: 'dim' }, 'The app plays a starting note. Sing the named interval and hold it. The target stays hidden until you have sung.'),
      seg([['1', 'Easy'], ['2', 'Medium'], ['3', 'Hard'], ['4', 'All']], String(Math.min(4, level)), (v) => { level = Number(v); settings.meta('ivLevel', level); }, 'Difficulty'),
      bigBtn('Start 8 questions', start));
    async function start() {
      if (!(await ensureMic())) return;
      let aborted = false; stopFn = () => { aborted = true; };
      const results = [];
      for (let q = 1; q <= 8 && !aborted && alive; q++) {
        const iv = pickInterval(level);
        const r = range();
        let root = Math.round(r.lo + 2 + Math.random() * Math.max(1, r.hi - r.lo - 4 - iv.semis));
        if (iv.dir < 0) root = Math.min(r.hi - 1, root + iv.semis);
        const target = root + iv.dir * iv.semis;
        const prompt = h('div', { style: { textAlign: 'center' } }, h('div', { class: 'small dim' }, `Question ${q} of 8`), h('h2', {}, `${iv.name} ${iv.semis === 12 || iv.semis === 0 ? (iv.dir > 0 ? 'up' : 'down') : iv.dir > 0 ? 'above' : 'below'}`));
        setPanel(prompt, h('p', { class: 'dim', style: { textAlign: 'center' } }, 'Listen to the root…'), bigBtn('Stop', () => { stopFn?.(); }, 'ghost', 'stop'));
        sv.roll.set({ followTarget: (root + target) / 2, targets: [] });
        const t0 = E.now();
        sv.roll.set({ targets: [{ start: t0, end: t0 + 1.1, midi: root, kind: 'ghost', label: label(root, false) }] });
        await E.tone(root, 1.0, { gain: 0.3 });
        await wait(1100);
        if (aborted) break;
        setPanel(prompt, h('p', { style: { textAlign: 'center', fontWeight: 700 } }, 'Sing it now and hold…'), bigBtn('Stop', () => { stopFn?.(); }, 'ghost', 'stop'));
        const t1 = E.now();
        const errs = [];
        const un = E.onPitch((f) => { if (f.midi != null && f.t > t1 + 0.3) errs.push(centsErr(f.midi, target, false)); });
        await wait(2200);
        un();
        const s = errs.slice().sort((a, b) => a - b);
        const med = s.length > 6 ? s[s.length >> 1] : null;
        const ok = med != null && Math.abs(med) <= Math.max(50, settings.get('tolOk'));
        sv.roll.set({ targets: [...sv.roll.s.targets, { start: t1, end: t1 + 2.2, midi: target, kind: 'target', result: med == null ? 'miss' : ok ? (Math.abs(med) <= settings.get('tolPerfect') ? 'perfect' : 'good') : 'miss', label: label(target, false) }] });
        results.push({ midi: target, grade: med == null ? 'miss' : ok ? (Math.abs(med) <= settings.get('tolPerfect') ? 'perfect' : 'good') : 'miss', cents: med == null ? null : Math.round(med) });
        setPanel(prompt, h('p', { style: { textAlign: 'center' } }, med == null ? 'Didn’t hear that.' : ok ? `Yes! ${label(target)} (${fmtCents(med)})` : `That was ${med > 0 ? 'above' : 'below'} the target, which was ${label(target)}.`));
        if (ok) haptic('light');
        await E.tone(target, 0.8, { gain: 0.25 });
        await wait(1300);
      }
      sv.roll.set({ followTarget: null });
      if (results.length < 3 || !alive) { intro(); return; }
      const counts = { perfect: 0, good: 0, ok: 0, miss: 0 }; results.forEach((n) => counts[n.grade]++);
      const score = Math.round(((counts.perfect + counts.good * 0.85) / results.length) * 100);
      const hits = results.filter((r) => r.grade !== 'miss');
      const res = { score, hitPct: Math.round((hits.length / results.length) * 100), drift: hits.length ? Math.round(hits.reduce((a, n) => a + n.cents, 0) / hits.length) : 0, timingBias: 0, counts, notes: results };
      recordHistory('intervals', 'intervals', 'Intervals', res);
      if (score >= 85 && level < 4) { level++; settings.meta('ivLevel', level); }
      resultSheet(res, { again: start, next: () => back('/train'), nextLabel: 'Done' });
      intro();
    }
    intro();
    await ensureMic();
  }

  // ---------------- SUSTAIN ----------------
  async function sustain() {
    const graph = h('canvas', { class: 'spark', 'aria-label': 'Drift graph' });
    const intro = () => setPanel(h('p', { class: 'dim' }, 'Hold one comfortable note as steadily as you can for 8 seconds. The graph shows how far you drift.'), bigBtn('Hold a note', start));
    async function start() {
      if (!(await ensureMic())) return;
      const m = Math.round((range().lo + range().hi) / 2 - 2);
      await E.tone(m, 1, { gain: 0.3 });
      await wait(1100);
      const t0 = E.now();
      const dur = 8;
      sv.roll.set({ followTarget: m, targets: [{ start: t0, end: t0 + dur, midi: m, kind: 'target', label: label(m, false) }] });
      sv.setTargets(sv.roll.s.targets, { live: false });
      const frames = [];
      const un = E.onPitch((f) => { if (f.t > t0 + 0.3 && f.t < t0 + dur) frames.push({ t: f.t - t0, midi: f.midi }); });
      setPanel(h('p', { style: { textAlign: 'center', fontWeight: 700 } }, `Hold ${label(m)}…`), graph);
      const g2 = graph.getContext('2d');
      let aborted = false; stopFn = () => { aborted = true; };
      for (let i = 0; i < dur * 10 && !aborted && alive; i++) { drawDrift(g2, graph, frames, m, dur); await wait(100); }
      un();
      sv.roll.set({ followTarget: null });
      const st = stability(frames, m);
      if (!st) { toast('Didn’t catch a steady note. Try again.'); intro(); return; }
      drawDrift(g2, graph, frames, m, dur);
      recordHistory('sustain', 'sustain', 'Sustain', { score: st.steadiness, hitPct: st.steadiness, drift: st.meanCents, timingBias: 0, notes: [{ midi: m, grade: Math.abs(st.meanCents) <= 15 ? 'perfect' : Math.abs(st.meanCents) <= 35 ? 'good' : Math.abs(st.meanCents) <= 50 ? 'ok' : 'miss', cents: st.meanCents }] });
      setPanel(graph,
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', {}, `${st.steadiness}`), h('span', {}, 'Steadiness')),
          h('div', { class: 'stat' }, h('b', {}, fmtCents(st.meanCents)), h('span', {}, 'Average')),
          h('div', { class: 'stat' }, h('b', {}, `${st.drift > 0 ? '+' : ''}${st.drift}¢/s`), h('span', {}, Math.abs(st.drift) < 2 ? 'No drift' : st.drift > 0 ? 'Drifting up' : 'Drifting down'))),
        h('p', { class: 'small dim' }, `Wobble ±${st.sd}¢. ${st.sd < 10 ? 'Very steady.' : st.sd < 20 ? 'Steady. Vibrato counts as wobble here.' : 'Try a straight tone with relaxed, steady breath.'}`),
        bigBtn('Again', start));
    }
    intro();
    await ensureMic();
  }
  function drawDrift(g, c, frames, m, dur) {
    const r = c.getBoundingClientRect(); const d = devicePixelRatio || 1;
    c.width = r.width * d; c.height = r.height * d; g.setTransform(d, 0, 0, d, 0, 0);
    const W = r.width, H = r.height;
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    g.clearRect(0, 0, W, H);
    g.fillStyle = css('--surface-2'); g.fillRect(0, 0, W, H);
    const y = (c0) => H / 2 - (Math.max(-60, Math.min(60, c0)) / 60) * (H / 2 - 6);
    g.fillStyle = css('--g-perfect'); g.globalAlpha = 0.12; g.fillRect(0, y(15), W, y(-15) - y(15)); g.globalAlpha = 1;
    g.strokeStyle = css('--text-faint'); g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.strokeStyle = css('--accent'); g.lineWidth = 2; g.beginPath();
    let st = false;
    for (const f of frames) { if (f.midi == null) { st = false; continue; } const x = (f.t / dur) * W, yy = y((f.midi - m) * 100); if (!st) { g.moveTo(x, yy); st = true; } else g.lineTo(x, yy); }
    g.stroke();
  }

  // ---------------- VIBRATO ----------------
  async function vibratoTrainer() {
    const readout = h('div', { class: 'stats' });
    const intro = () => setPanel(h('p', { class: 'dim' }, 'Sing a long note with your natural vibrato. Most singers sit around 5–7 Hz and 30–100 cents wide.'), bigBtn('Analyse my vibrato', start));
    const draw = (v) => readout.replaceChildren(
      h('div', { class: 'stat' }, h('b', { style: { color: v && v.rate >= 4.5 && v.rate <= 7.5 ? 'var(--g-perfect)' : 'var(--text)' } }, v && v.rate ? `${v.rate} Hz` : '—'), h('span', {}, 'Rate (5–7)')),
      h('div', { class: 'stat' }, h('b', { style: { color: v && v.depth >= 25 && v.depth <= 110 ? 'var(--g-perfect)' : 'var(--text)' } }, v ? `±${v.depth}¢` : '—'), h('span', {}, 'Depth (30–100)')),
      h('div', { class: 'stat' }, h('b', {}, v ? `${Math.round(v.regularity * 100)}%` : '—'), h('span', {}, 'Evenness')));
    async function start() {
      if (!(await ensureMic())) return;
      const frames = [];
      const un = E.onPitch((f) => { frames.push({ t: f.t, midi: f.midi }); if (frames.length > 600) frames.shift(); });
      draw(null);
      setPanel(h('p', { style: { textAlign: 'center', fontWeight: 700 } }, 'Sing a long “ah” with vibrato…'), readout, bigBtn('Stop', () => stopFn?.(), 'ghost', 'stop'));
      let aborted = false; stopFn = () => { aborted = true; };
      let best = null;
      for (let i = 0; i < 80 && !aborted && alive; i++) {
        await wait(150);
        const recent = frames.slice(-200);
        const v = vibratoAnalyse(recent);
        if (v && v.rate) { draw(v); if (!best || v.regularity > best.regularity) best = v; }
      }
      un();
      if (best) {
        const inBand = (best.rate >= 4.5 && best.rate <= 7.5 ? 50 : 25) + (best.depth >= 25 && best.depth <= 110 ? 30 : 10) + Math.round(best.regularity * 20);
        recordHistory('vibrato', 'vibrato', 'Vibrato', { score: inBand, hitPct: inBand, drift: 0, timingBias: 0, notes: [] });
        draw(best);
        setPanel(readout, h('p', { class: 'small dim' }, best.rate < 4.5 ? 'A slow, wide vibrato. Try lighter, quicker pulses.' : best.rate > 7.5 ? 'Quite fast. Try relaxing the throat and letting it slow down.' : 'Right in the classic band.'), bigBtn('Again', start));
      } else { toast('No vibrato detected. Hold a longer, freer note.'); intro(); }
    }
    intro();
    await ensureMic();
  }

  // ---------------- DRONE ----------------
  async function drone() {
    let root = (settings.meta('droneRoot') ?? 0), on = false, fifth = true;
    const key = () => ({ root, mode: 'major' });
    const tonicMidi = () => { const r = range(); let m = root + 36; while (m < r.lo - 12) m += 12; return m; };
    const draw = () => setPanel(
      h('div', { class: 'chips' }, ...SHARP_NAMES.map((n, i) => h('button', { class: `chip ${i === root ? 'on' : ''}`, onclick: () => { root = i; settings.meta('droneRoot', i); sv.roll.set({ key: key() }); if (on) E.startDrone(tonicMidi(), { fifth }); draw(); } }, noteLabel(i + 60, { octave: false, accidentals: settings.get('accidentals') })))),
      h('div', { class: 'kv' }, h('span', {}, 'Add the 5th'), toggle(fifth, (v) => { fifth = v; if (on) E.startDrone(tonicMidi(), { fifth }); }, 'Add the fifth')),
      bigBtn(on ? 'Stop drone' : `Start ${keyName(key()).replace(' major', '')} drone`, () => { on = !on; if (on) E.startDrone(tonicMidi(), { fifth }); else E.stopDrone(); draw(); }, on ? 'ghost' : 'primary', on ? 'stop' : 'play'),
      h('p', { class: 'small faint' }, 'Sing scale notes against the drone. In-tune notes feel calm; out-of-tune notes beat and wobble.'));
    sv.roll.set({ key: key() });
    draw();
    await ensureMic();
    cleanups.push(() => E.stopDrone());
  }

  const runners = { range: rangeFinder, warmups, match: pitchMatch, intervals, sustain, vibrato: vibratoTrainer, drone };
  return {
    el,
    mounted() { runners[id](); },
    onHide() { stopFn?.(); E.stopDrone(); E.stopMic(); },
    onShow() { E.startMic().catch(() => {}); },
    destroy() { alive = false; stopFn?.(); cleanups.forEach((f) => f()); sv.destroy(); E.stopDrone(); E.stopMic(); },
  };
}
void sheet; void ic; void db;
