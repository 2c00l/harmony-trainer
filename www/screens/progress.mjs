import { h, iconBtn, ic } from '../ui/ui.mjs';
import { go } from '../app.mjs';
import { db, computeStreak, troubleMap, dayKey } from '../core/db.mjs';
import { settings } from '../core/settings.mjs';
import { noteLabel } from '../dsp/theory.mjs';
import { userRange } from '../core/exercises.mjs';

const KIND_NAMES = { harmony: 'Harmony takes', lesson: 'Lessons', match: 'Pitch match', intervals: 'Intervals', warmups: 'Warm-ups', sustain: 'Sustain', vibrato: 'Vibrato' };

export async function render() {
  const hist = (await db.listHistory().catch(() => [])).sort((a, b) => a.at - b.at);
  const st = computeStreak(hist);
  const el = h('div', {},
    h('header', { class: 'topbar' }, h('div', { class: 'title big', role: 'heading', 'aria-level': '1' }, 'Progress'), iconBtn('settings', 'Settings', () => go('/settings'))),
    h('div', { class: 'scroll' }, h('div', { class: 'wrap' }, ...(hist.length ? content() : [empty()]))));

  function empty() {
    return h('div', { class: 'card empty' }, ic('progress'), h('h3', {}, 'Your progress shows up here'), h('p', { class: 'small' }, 'Sing a lesson, a trainer or a harmony take to start your streak.'),
      h('button', { class: 'btn primary', style: { marginTop: '14px' }, onclick: () => go('/learn') }, 'Start the course'));
  }

  function content() {
    // streak + calendar
    const days = [];
    const today = new Date();
    for (let i = 27; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(d); }
    const cal = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: '4px', marginTop: '12px' }, role: 'img', 'aria-label': `Practised on ${days.filter((d) => st.days.has(dayKey(d.getTime()))).length} of the last 28 days` },
      ...days.map((d) => h('i', { style: { aspectRatio: '1', borderRadius: '5px', background: st.days.has(dayKey(d.getTime())) ? 'var(--accent)' : 'var(--surface-3)', opacity: st.days.has(dayKey(d.getTime())) ? '1' : '.6' } })));
    const streakCard = h('div', { class: 'card' },
      h('div', { class: 'kv' },
        h('div', {}, h('div', { class: 'small dim' }, 'Practice streak'), h('div', { class: 'big-num', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('span', { style: { color: 'var(--c-amber)', width: '30px', display: 'inline-flex' } }, ic('flame')), `${st.streak}`, h('span', { class: 'small dim', style: { fontWeight: 600, fontSize: '1rem' } }, st.streak === 1 ? 'day' : 'days'))),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'small dim' }, 'Best'), h('div', { style: { fontWeight: 800, fontSize: '1.3rem' } }, `${st.best}`))),
      cal,
      h('p', { class: 'small faint', style: { marginTop: '8px' } }, st.practisedToday ? 'You have practised today. Nice.' : st.streak ? 'Sing something today to keep your streak.' : 'Practise today to start a streak.'));

    // trends
    const kinds = Object.keys(KIND_NAMES).filter((k) => hist.some((e) => e.kind === k));
    const trends = kinds.map((k) => {
      const pts = hist.filter((e) => e.kind === k).slice(-30).map((e) => e.score);
      const c = h('canvas', { class: 'spark', style: { height: '56px' }, 'aria-label': `${KIND_NAMES[k]} scores: latest ${pts[pts.length - 1]}` });
      requestAnimationFrame(() => spark(c, pts));
      const last = pts[pts.length - 1], first = pts[0];
      return h('div', { class: 'row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        h('div', { class: 'kv' }, h('b', {}, KIND_NAMES[k]), h('span', { class: 'small dim' }, `${pts.length} session${pts.length > 1 ? 's' : ''} · latest ${last}${pts.length > 2 ? ` · ${last >= first ? '+' : ''}${last - first} since first` : ''}`)), c);
    });

    // heatmap across the user's range
    const tm = troubleMap(hist);
    const r = userRange(settings.meta('range'));
    const lo = Math.min(r.lo, ...[...tm.keys()]), hi = Math.max(r.hi, ...[...tm.keys()]);
    const cells = [];
    for (let m = lo; m <= hi; m++) {
      const e = tm.get(m);
      let bg = 'var(--surface-2)', title = `${noteLabel(m)}: no data`;
      if (e && e.n) {
        const missRate = e.miss / e.n, err = e.cn ? e.absCents / e.cn : 50;
        const bad = Math.min(1, missRate * 0.7 + (err / 60) * 0.5);
        bg = `color-mix(in srgb, var(--g-miss) ${Math.round(bad * 100)}%, var(--g-perfect))`;
        title = `${noteLabel(m)}: ${e.n} notes, ${Math.round(missRate * 100)}% missed, average ${Math.round(err)} cents off`;
      }
      cells.push(h('i', { style: { background: bg, color: e ? '#0B0F1A' : '' }, title, 'aria-label': title, role: 'img' }, m % 12 === 0 || m === lo ? noteLabel(m) : ''));
    }
    const worst = [...tm.entries()].filter(([, e]) => e.n >= 3).sort((a, b) => (b[1].miss / b[1].n) - (a[1].miss / a[1].n)).slice(0, 3);
    const heat = h('div', { class: 'card section' },
      h('h3', {}, 'Trouble notes'),
      h('p', { class: 'small dim', style: { margin: '4px 0 10px' } }, 'Green notes are reliable; red ones need work.'),
      h('div', { class: 'heat' }, ...cells),
      worst.length ? h('p', { class: 'small', style: { marginTop: '10px' } }, 'Most missed: ', h('b', {}, worst.map(([m]) => noteLabel(m)).join(', '))) : null);

    const recent = hist.slice(-8).reverse().map((e) => h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, e.title || KIND_NAMES[e.kind]), h('div', { class: 'small faint' }, `${KIND_NAMES[e.kind] || e.kind} · ${new Date(e.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`)),
      h('span', { class: 'pill accent' }, `${e.score}`)));

    return [streakCard, h('div', { class: 'section-h' }, h('h2', {}, 'Scores over time')), h('div', { class: 'list' }, ...trends), heat, h('div', { class: 'section-h' }, h('h2', {}, 'Recent')), h('div', { class: 'list' }, ...recent)];
  }
  return { el };
}

function spark(c, pts) {
  const r = c.getBoundingClientRect(); const d = devicePixelRatio || 1;
  c.width = r.width * d; c.height = r.height * d;
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  const W = r.width, H = r.height;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const acc = css('--accent');
  const x = (i) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * (W - 8) + 4), y = (v) => H - 4 - (v / 100) * (H - 8);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, acc); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.beginPath(); g.moveTo(x(0), H);
  pts.forEach((v, i) => g.lineTo(x(i), y(v)));
  g.lineTo(x(pts.length - 1), H); g.closePath();
  g.globalAlpha = 0.18; g.fillStyle = grad; g.fill(); g.globalAlpha = 1;
  g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
  g.strokeStyle = acc; g.lineWidth = 2.2; g.lineJoin = 'round'; g.stroke();
  const lx = x(pts.length - 1), ly = y(pts[pts.length - 1]);
  g.fillStyle = acc; g.beginPath(); g.arc(lx, ly, 3.5, 0, Math.PI * 2); g.fill();
}
