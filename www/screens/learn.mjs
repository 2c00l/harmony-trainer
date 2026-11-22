import { h, iconBtn } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { go } from '../app.mjs';
import { settings } from '../core/settings.mjs';
import { LESSONS } from '../core/exercises.mjs';

export async function render() {
  const done = settings.meta('lessons') || {};
  const nDone = LESSONS.filter((l) => done[l.id]?.passed).length;
  const nextIdx = LESSONS.findIndex((l) => !done[l.id]?.passed);
  const el = h('div', {},
    h('header', { class: 'topbar' }, h('div', { class: 'title big', role: 'heading', 'aria-level': '1' }, 'Learn'), iconBtn('settings', 'Settings', () => go('/settings'))),
    h('div', { class: 'scroll' }, h('div', { class: 'wrap' },
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, h('div', {}, h('div', { class: 'small dim' }, 'Harmony course'), h('h2', {}, nDone === LESSONS.length ? 'Course complete!' : `${nDone} of ${LESSONS.length} lessons`)),
          nextIdx >= 0 ? h('button', { class: 'btn primary sm', onclick: () => go(`/lesson/${LESSONS[nextIdx].id}`), html: icon('play') + (nDone ? 'Continue' : 'Start') }) : null),
        h('div', { class: 'progressbar', style: { marginTop: '12px' } }, h('i', { style: { width: `${(nDone / LESSONS.length) * 100}%` } }))),
      h('div', { class: 'list section' }, ...LESSONS.map((l, i) => {
        const d = done[l.id];
        return h('button', { class: 'row', onclick: () => go(`/lesson/${l.id}`) },
          h('div', { class: `lesson-num ${d?.passed ? 'done' : ''}`, html: d?.passed ? icon('check') : String(i + 1), 'aria-hidden': 'true' }),
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, l.title), h('div', { class: 'small faint' }, l.sub)),
          d?.best != null ? h('span', { class: 'pill' }, `${d.best}`) : null,
          h('span', { class: 'sr' }, d?.passed ? 'Completed' : 'Not completed'));
      })),
      h('p', { class: 'small faint section' }, 'All melodies are original and written for Harmony Trainer. Lessons are pitched to your range. Run the range finder in Train to fine-tune it.'),
    )));
  return { el };
}
