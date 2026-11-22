import { h, topbar, toggle, slider, seg, confirmSheet, toast, ic, sheet } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { back, go } from '../app.mjs';
import { settings, SCHEMA } from '../core/settings.mjs';
import { db } from '../core/db.mjs';
import * as E from '../audio/engine.mjs';
import { route } from '../audio/route.mjs';

export async function render() {
  const body = h('div', { class: 'wrap' });
  const el = h('div', {}, topbar({ title: 'Settings', back: () => back() }), h('div', { class: 'scroll' }, body));

  function control(it) {
    const v = settings.get(it.id);
    if (it.type === 'bool') return toggle(v, (x) => settings.set(it.id, x), it.label);
    if (it.type === 'range') {
      const out = h('span', { class: 'small mono', style: { minWidth: '64px', textAlign: 'right', fontWeight: 700 } }, it.fmt ? it.fmt(v) : String(v));
      const s = slider({ min: it.min, max: it.max, step: it.step, value: v, label: it.label, oninput: (x) => { settings.set(it.id, x); out.textContent = it.fmt ? it.fmt(x) : String(x); if (it.id.startsWith('tol')) drawSoon(); } });
      return { slider: s, out };
    }
    if (it.type === 'choice') {
      if (it.options.length <= 4 && it.options.every(([, l]) => l.length <= 12)) return seg(it.options, v, (x) => { settings.set(it.id, x); if (it.id === 'preset') draw(); }, it.label);
      const btn = h('button', { class: 'chip', onclick: () => pick(it, btn) }, (it.options.find(([k]) => k === v) || [, v])[1]);
      return btn;
    }
    if (it.type === 'action') return h('button', { class: 'btn sm ghost', onclick: () => action(it.action) }, it.action === 'reset' ? 'Reset' : 'Open');
    return null;
  }
  function pick(it, btn) {
    sheet((api) => [h('h2', {}, it.label), h('p', { class: 'small dim' }, it.help),
      h('div', { class: 'list', style: { marginTop: '10px' } }, ...it.options.map(([k, l]) => h('button', { class: 'row', onclick: () => { settings.set(it.id, k); btn.textContent = l; api.close(); } }, h('div', { class: 'grow' }, l), settings.get(it.id) === k ? h('span', { style: { color: 'var(--accent)', width: '22px' }, html: icon('check') }) : null)))]);
  }
  async function action(a) {
    if (a === 'calibrate') go('/calibrate');
    if (a === 'reset') { if (await confirmSheet({ title: 'Reset all settings?', body: 'Your projects, progress and calibration are kept.', ok: 'Reset' })) { settings.reset(); toast('Settings reset'); draw(); } }
  }
  let t = null; const drawSoon = () => { clearTimeout(t); t = setTimeout(draw, 600); };

  function draw() {
    const preset = settings.get('preset');
    body.replaceChildren(
      ...SCHEMA.map((g) => h('section', { class: 'section', 'aria-label': g.group },
        h('div', { class: 'section-h', style: { marginTop: '8px' } }, h('h2', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { style: { width: '22px', color: 'var(--accent)', display: 'inline-flex' }, html: icon(g.icon) }), g.group)),
        h('div', { class: 'list' }, ...g.items.filter((it) => !(it.custom && preset !== 'custom' && false)).map((it) => {
          const c = control(it);
          const isRange = c && c.slider;
          const isSeg = it.type === 'choice' && c.classList?.contains('seg');
          const stacked = isRange || isSeg;
          return h('div', { class: 'row', style: { flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center', gap: stacked ? '6px' : '12px' } },
            h('div', { class: 'kv', style: { flex: 1, width: '100%' } },
              h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 650 } }, it.label), h('div', { class: 'small faint' }, it.help)),
              isRange ? c.out : (isSeg ? null : c)),
            isRange ? c.slider : (isSeg ? h('div', { style: { width: '100%', marginTop: '2px' } }, c) : null));
        })),
        g.group === 'Audio' ? h('p', { class: 'small faint', style: { margin: '8px 4px 0' } }, `Current output: ${route.kind()}. Headphones are recommended for harmony takes.`) : null)),
      h('section', { class: 'section', 'aria-label': 'Privacy' },
        h('div', { class: 'section-h', style: { marginTop: '8px' } }, h('h2', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { style: { width: '22px', color: 'var(--accent)', display: 'inline-flex' }, html: icon('info') }), 'Privacy and data')),
        h('div', { class: 'card prose small' },
          h('p', {}, 'All audio and analysis stay on this device. There are no accounts, no analytics and no tracking. The microphone is the only permission used.'),
          h('div', { style: { display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' } },
            h('button', { class: 'btn sm ghost', onclick: () => openUrl('https://studymusictheory.com/harmony-trainer/privacy') }, 'Privacy policy'),
            h('button', { class: 'btn sm danger', onclick: deleteAll, html: icon('trash') + 'Delete all my data' })))),
      h('p', { class: 'small faint section', style: { textAlign: 'center' } }, 'Harmony Trainer 1.0 · Made by Study Music Theory'),
    );
  }
  async function deleteAll() {
    if (!(await confirmSheet({ title: 'Delete everything?', body: 'This permanently removes all projects, recordings, scores, streaks and settings from this device.', ok: 'Delete all', danger: true }))) return;
    E.stopMic();
    await db.clearAll();
    try { localStorage.clear(); } catch { /* */ }
    toast('All data deleted');
    setTimeout(() => { location.hash = '#/welcome'; location.reload(); }, 700);
  }
  draw();
  return { el };
}

function openUrl(url) {
  const C = window.Capacitor;
  if (C?.Plugins?.Browser) C.Plugins.Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}
void ic;
