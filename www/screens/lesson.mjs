// Lesson: explanation → demo (hear melody + part) → scored exercise.
import { h, topbar, seg } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { SingView } from '../ui/singview.mjs';
import { back, go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { settings } from '../core/settings.mjs';
import { LESSONS, buildLesson, userRange } from '../core/exercises.mjs';
import { keyName } from '../dsp/theory.mjs';
import { micGate } from './mic-gate.mjs';
import { runExercise, recordHistory, resultSheet } from './runner.mjs';

const PASS = 60;

export async function render(id) {
  const idx = LESSONS.findIndex((l) => l.id === id);
  const L = LESSONS[idx];
  if (!L) { go('/learn', { replace: true }); return { el: h('div') }; }
  const mat = buildLesson(L, userRange(settings.meta('range')));
  const sv = new SingView({ roll: { nowX: 0.55, key: mat.key } });
  const panel = h('div', { class: 'dock' });
  const el = h('div', {}, topbar({ title: `${idx + 1}. ${L.title}`, back: () => back('/learn') }), sv.el, panel);
  let stop = null, demo = null, alive = true, step = 'read', speed = 1;
  const melodyAcc = [...mat.melody, ...mat.extra.filter((n) => n.midi != null)];

  // preview the material statically on the roll
  function preview() {
    const t0 = E.now() + 0.4;
    const off = (ns, kind) => ns.filter((n) => n.midi != null).map((n) => ({ ...n, start: n.start + t0, end: n.end + t0, kind }));
    sv.roll.set({ targets: [...off(melodyAcc, 'ghost'), ...off(mat.target, 'target')], mode: 'scroll', follow: true });
    sv.freeze = t0 + 2.2; // hold the preview still while reading
  }

  function draw() {
    const tabs = seg([['read', 'Read'], ['listen', 'Listen'], ['sing', 'Sing']], step, (v) => { step = v; stopAll(); draw(); }, 'Lesson step');
    const body = [];
    if (step === 'read') {
      const prose = h('div', { class: 'prose', style: { maxHeight: '28vh', overflowY: 'auto' } });
      prose.innerHTML = L.text.map((t) => `<p>${t}</p>`).join('');
      body.push(prose, h('p', { class: 'small faint' }, `In ${keyName(mat.key)}, fitted to your range.`), h('button', { class: 'btn primary block', onclick: () => { step = 'listen'; draw(); playDemo(); }, html: icon('play') + 'Hear the demo' }));
    } else if (step === 'listen') {
      body.push(h('p', { class: 'dim small' }, L.drone ? 'The drone plays, with the target notes as a guide.' : 'Grey bars are the melody; coloured bars are your part. Both play now.'),
        h('div', { style: { display: 'flex', gap: '10px' } },
          h('button', { class: 'btn ghost', style: { flex: 1 }, onclick: () => (demo ? stopAll() : playDemo()), html: icon(demo ? 'stop' : 'play') + (demo ? 'Stop' : 'Play again') }),
          h('button', { class: 'btn primary', style: { flex: 1 }, onclick: () => { step = 'sing'; stopAll(); draw(); } }, 'I’m ready')));
    } else {
      body.push(
        h('div', { class: 'kv' }, h('span', { class: 'small dim' }, 'Speed'), seg([['0.75', 'Slow'], ['1', 'Normal']], String(speed), (v) => { speed = Number(v); }, 'Speed')),
        h('button', { class: 'btn primary block', onclick: sing, html: icon('mic') + 'Sing your part' }),
        h('p', { class: 'small faint' }, `Score ${PASS}+ to complete the lesson. The melody plays; your part shows as bars.`));
    }
    panel.replaceChildren(tabs, ...body);
  }

  async function playDemo() {
    stopAll();
    await E.ensureContext();
    const T = await E.play({ guide: [...melodyAcc, ...mat.target], guideGain: 0.16 });
    if (L.drone) E.startDrone(mat.droneMidi - 12);
    demo = T;
    sv.startTransport(T, { record: false });
    sv.setTargets([...melodyAcc.map((n) => ({ ...n, kind: 'ghost' })), ...mat.target.map((n) => ({ ...n, kind: 'target' }))]);
    draw();
    const end = Math.max(...mat.target.map((n) => n.end)) + 0.5;
    const tick = () => { if (demo !== T) return; if (T.heard() > end) { stopAll(); draw(); } else setTimeout(tick, 120); };
    tick();
  }
  function stopAll() { if (demo) { demo.stop(); demo = null; sv.transport = null; } E.stopDrone(); stop?.(); stop = null; }

  async function sing() {
    if (!(await micGate(sv.el))) return;
    await E.startMic();
    panel.replaceChildren(h('button', { class: 'btn ghost block', onclick: () => stop?.(), html: icon('stop') + 'Stop' }));
    const scale = (ns) => ns.map((n) => ({ ...n, start: n.start / speed, end: n.end / speed }));
    const res = await runExercise(sv, {
      targets: scale(mat.target), accompany: scale(melodyAcc), guide: L.drone || idx === 0 || settings.get('guideTones'), guideGain: melodyAcc.length ? 0.07 : 0.12, accompanyGain: 0.2,
      bpm: mat.bpm * speed, countInBeats: 4, drone: L.drone ? mat.droneMidi - 12 : null, onStop: (f) => (stop = f),
    });
    stop = null;
    if (!res || !alive) { draw(); return; }
    recordHistory('lesson', L.id, L.title, res);
    const all = settings.meta('lessons') || {};
    const prev = all[L.id] || {};
    const passed = prev.passed || res.score >= PASS;
    all[L.id] = { passed, best: Math.max(prev.best || 0, res.score), at: Date.now() };
    settings.meta('lessons', all);
    const nextL = LESSONS[idx + 1];
    resultSheet(res, {
      title: res.score >= PASS ? (res.score >= 85 ? 'Lesson mastered!' : 'Lesson complete') : 'Nearly there',
      again: sing,
      next: res.score >= PASS ? () => go(nextL ? `/lesson/${nextL.id}` : '/learn', { replace: true }) : null,
      nextLabel: nextL ? `Next: ${nextL.title}` : 'Back to course',
      extra: res.score < PASS ? h('p', { class: 'small dim', style: { textAlign: 'center' } }, `Score ${PASS} or more to complete the lesson. Try the slow speed.`) : null,
    });
    draw();
  }

  preview();
  draw();
  return {
    el,
    mounted() { E.ensureContext().catch(() => {}); },
    onHide() { stopAll(); E.stopMic(); },
    destroy() { alive = false; stopAll(); sv.destroy(); E.stopMic(); },
  };
}
