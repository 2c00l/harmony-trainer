import { h, iconBtn } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { go } from '../app.mjs';
import { db } from '../core/db.mjs';
import { settings } from '../core/settings.mjs';
import { noteLabel, voiceType } from '../dsp/theory.mjs';

export const TRAINERS = [
  { id: 'range', title: 'Range finder', sub: 'Find your lowest and highest notes', icon: 'range', color: '--c-sky' },
  { id: 'warmups', title: 'Warm-ups', sub: 'Sirens, scales, arpeggios, hums', icon: 'siren', color: '--c-coral' },
  { id: 'match', title: 'Pitch match', sub: 'Hear a note, sing it back', icon: 'match', color: '--c-teal' },
  { id: 'intervals', title: 'Intervals', sub: 'Sing a named interval', icon: 'interval', color: '--c-violet' },
  { id: 'sustain', title: 'Sustain', sub: 'Hold a note steady', icon: 'sustain', color: '--c-mint' },
  { id: 'vibrato', title: 'Vibrato', sub: 'Measure its rate and depth', icon: 'vibrato', color: '--c-pink' },
  { id: 'drone', title: 'Drone', sub: 'Free tuning over a tonic', icon: 'drone', color: '--c-amber' },
];

export async function render() {
  const hist = await db.listHistory().catch(() => []);
  const best = {};
  for (const e of hist) best[e.kind] = Math.max(best[e.kind] || 0, e.score || 0);
  const r = settings.meta('range');
  const el = h('div', {},
    h('header', { class: 'topbar' }, h('div', { class: 'title big', role: 'heading', 'aria-level': '1' }, 'Train'), iconBtn('settings', 'Settings', () => go('/settings'))),
    h('div', { class: 'scroll' }, h('div', { class: 'wrap' },
      h('button', { class: 'card', style: { width: '100%', textAlign: 'left', display: 'flex', gap: '14px', alignItems: 'center' }, onclick: () => go('/t/range') },
        h('div', { class: 'tile', style: { minHeight: '0', padding: '0', border: '0', background: 'none', '--tc': 'var(--c-sky)' } }, h('div', { class: 'ic', html: icon('range') })),
        h('div', { style: { flex: '1' } },
          h('div', { class: 'small dim' }, 'Your range'),
          h('h3', {}, r ? `${noteLabel(r.lo)} – ${noteLabel(r.hi)}` : 'Not measured yet'),
          h('div', { class: 'small faint' }, r ? `Roughly ${voiceType(r.lo, r.hi).toLowerCase()}. Exercises fit this range.` : 'Takes 20 seconds. Exercises will fit your voice.')),
        h('span', { html: icon('right'), style: { width: '22px', color: 'var(--text-faint)' } })),
      h('div', { class: 'grid2 wide section' }, ...TRAINERS.filter((t) => t.id !== 'range').map((t) => h('button', { class: 'tile', style: { '--tc': `var(${t.color})` }, onclick: () => go(`/t/${t.id}`) },
        h('div', { class: 'ic', html: icon(t.icon) }),
        best[t.id] ? h('span', { class: 'pill badge' }, `Best ${best[t.id]}`) : null,
        h('div', {}, h('h3', {}, t.title), h('p', {}, t.sub))))),
    )));
  return { el };
}
