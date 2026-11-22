// Shared exercise runner: plays accompaniment/guide, shows targets, scores the take.
import { h, sheet, scoreRing, gradeBar, fmtCents } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import * as E from '../audio/engine.mjs';
import { scoreTake } from '../dsp/score.mjs';
import { scoringOpts } from '../core/settings.mjs';
import { db } from '../core/db.mjs';

/**
 * sv: SingView; targets: [{start,end,midi}] scored; accompany: notes played as tones (melody/extra);
 * guide: whether to softly play the targets too. Returns a promise of the score result (or null if stopped).
 */
export function runExercise(sv, { targets, accompany = [], guide = false, guideGain = 0.1, accompanyGain = 0.2, bpm = 90, countInBeats = 4, drone = null, onStop, rate = 1 }) {
  return new Promise(async (resolve) => {
    const beat = 60 / bpm;
    const lead = countInBeats * beat;
    const shift = (ns) => ns.map((n) => ({ ...n, start: n.start + lead, end: n.end + lead }));
    const T = await E.play({
      from: 0, rate,
      guide: [...shift(accompany).map((n) => ({ ...n })), ...(guide ? shift(targets) : [])],
      guideGain: accompany.length ? accompanyGain : guideGain,
      clicks: countInBeats ? { bpm, beatsPerBar: countInBeats, offset: 0, countInBars: 0, metronome: false } : null,
    });
    // count-in clicks in musical time [0, lead)
    if (countInBeats) await E.clicksAt(Array.from({ length: countInBeats }, (_, i) => T.tStart + i * beat), 0.8);
    if (drone != null) E.startDrone(drone);
    const tg = shift(targets).map((t) => ({ ...t, kind: 'target' }));
    sv.roll.set({ mode: 'scroll', follow: true });
    sv.setTargets(tg, { live: true });
    sv.roll.set({ targets: [...tg, ...shift(accompany).map((n) => ({ ...n, kind: 'ghost' }))] });
    sv.startTransport(T, { record: true });
    const end = Math.max(...tg.map((t) => t.end)) + 0.6;
    let stopped = false;
    const finish = (aborted) => {
      if (stopped) return; stopped = true;
      T.stop(); sv.transport = null;
      if (drone != null) E.stopDrone();
      if (aborted) { resolve(null); return; }
      const res = scoreTake(tg, sv.taken, scoringOpts());
      resolve(res);
    };
    onStop?.(() => finish(true));
    const tick = () => { if (stopped) return; if (T.heard() > end) finish(false); else setTimeout(tick, 80); };
    tick();
  });
}

export async function recordHistory(kind, ref, title, res) {
  try { await db.addHistory({ kind, ref, title, score: res.score, hitPct: res.hitPct, drift: res.drift, timing: res.timingBias, notes: res.notes.map((n) => ({ midi: n.midi, grade: n.grade, cents: n.cents == null ? null : Math.round(n.cents) })) }); } catch { /* storage blocked */ }
}

export function resultSheet(res, { title, again, next, nextLabel = 'Next', extra = null }) {
  sheet((api) => [
    h('h2', { style: { textAlign: 'center' } }, title || (res.score >= 85 ? 'Great singing!' : res.score >= 60 ? 'Nice work' : 'Keep practising')),
    scoreRing(res.score),
    gradeBar(res.counts),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, `${res.hitPct}%`), h('span', {}, 'Notes hit')),
      h('div', { class: 'stat' }, h('b', {}, fmtCents(res.drift)), h('span', {}, Math.abs(res.drift) < 5 ? 'Centred' : res.drift > 0 ? 'Tends sharp' : 'Tends flat')),
      h('div', { class: 'stat' }, h('b', {}, `${res.timingBias > 0 ? '+' : ''}${res.timingBias}ms`), h('span', {}, Math.abs(res.timingBias) < 40 ? 'On time' : res.timingBias > 0 ? 'Tends late' : 'Tends early'))),
    extra,
    h('div', { class: 'actions' },
      again ? h('button', { class: 'btn ghost', onclick: () => { api.close(); again(); }, html: icon('loop') + 'Again' }) : null,
      next ? h('button', { class: 'btn primary', onclick: () => { api.close(); next(); } }, nextLabel) : null),
  ], { label: 'Result' });
}
