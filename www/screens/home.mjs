import { h, iconBtn, ic, toast, confirmSheet, sheet, fmtTime } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { go } from '../app.mjs';
import { db, computeStreak } from '../core/db.mjs';
import { newProject, saveNow, LAYER_COLORS } from '../core/project.mjs';
import { keyName } from '../dsp/theory.mjs';
import { heroArt } from '../ui/art.mjs';

export async function render() {
  const [projects, history] = await Promise.all([db.listProjects().catch(() => []), db.listHistory().catch(() => [])]);
  const st = computeStreak(history);
  const art = heroArt();
  const el = h('div', {},
    h('header', { class: 'topbar' },
      h('div', { class: 'title big', role: 'heading', 'aria-level': '1' }, 'Studio'),
      st.streak ? h('span', { class: 'pill accent', title: 'Practice streak' }, ic('flame'), `${st.streak} day${st.streak > 1 ? 's' : ''}`) : null,
      iconBtn('settings', 'Settings', () => go('/settings'))),
    h('div', { class: 'scroll' }, h('div', { class: 'wrap' },
      h('section', { class: 'hero' }, art.canvas,
        h('h1', {}, 'Sing in harmony with yourself'),
        h('p', {}, 'Record a melody, and we will write a harmony part for you to sing over it, scored as you go.'),
        h('button', { class: 'btn primary', onclick: create, html: icon('plus') + 'New harmony' })),
      h('div', { class: 'grid2 wide section' },
        tile('Live pitch', 'See your voice on the roll', 'wave', '--c-teal', () => go('/monitor')),
        tile('Drone', 'Tune against a steady tonic', 'drone', '--c-violet', () => go('/t/drone')),
        tile('Import a song', 'Separate the vocal and harmonise', 'import', '--c-amber', () => go('/import')),
        tile('Warm up', 'Sirens, scales and hums', 'siren', '--c-coral', () => go('/t/warmups'))),
      h('div', { class: 'section-h' }, h('h2', {}, 'Your projects'), projects.length ? h('span', { class: 'faint small' }, `${projects.length}`) : null),
      projects.length ? h('div', { class: 'list' }, ...projects.map(row)) : h('div', { class: 'card empty' }, ic('layers'), h('p', {}, 'No projects yet.'), h('p', { class: 'small faint' }, 'Tap New harmony to record your first melody.')),
    )));

  async function create() {
    const p = newProject(`Harmony ${projects.length + 1}`);
    await saveNow(p);
    go(`/project/${p.id}`);
  }
  function row(p) {
    const r = h('button', { class: 'row', onclick: () => go(`/project/${p.id}`) },
      h('div', { style: { display: 'flex', gap: '3px' }, 'aria-hidden': 'true' }, ...(p.layers.length ? p.layers.slice(0, 5) : [{ colorIdx: -1 }]).map((l) => h('span', { class: 'layerdot', style: { color: l.colorIdx >= 0 ? `var(${LAYER_COLORS[l.colorIdx]})` : 'var(--text-faint)', boxShadow: 'none', width: '10px', height: '10px' } }))),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, p.name), h('div', { class: 'small faint' }, [p.layers.length ? `${p.layers.length} layer${p.layers.length > 1 ? 's' : ''}` : 'Not recorded', p.key ? keyName(p.key) : null, p.duration ? fmtTime(p.duration) : null].filter(Boolean).join(' · '))),
      h('span', { class: 'iconbtn', role: 'button', tabindex: '0', 'aria-label': `More for ${p.name}`, html: icon('dots'), onclick: (e) => { e.stopPropagation(); more(p); } }));
    return r;
  }
  function more(p) {
    sheet((api) => [
      h('h2', {}, p.name),
      h('div', { class: 'list', style: { marginTop: '10px' } },
        h('button', { class: 'row', onclick: async () => { api.close(); const name = await askName(p.name); if (name) { p.name = name; await db.putProject(p); go('/', { replace: true }); location.reload(); } } }, ic('edit'), h('div', { class: 'grow' }, 'Rename')),
        h('button', { class: 'row', onclick: async () => { api.close(); if (await confirmSheet({ title: 'Delete project?', body: 'This removes all its recordings from this device.', ok: 'Delete', danger: true })) { await db.deleteProject(p); toast('Project deleted'); location.reload(); } } }, ic('trash'), h('div', { class: 'grow', style: { color: 'var(--c-coral)' } }, 'Delete'))),
    ]);
  }
  return { el, destroy: () => art.stop() };
}

function tile(title, sub, ico, color, onclick) {
  return h('button', { class: 'tile', style: { '--tc': `var(${color})` }, onclick }, h('div', { class: 'ic', html: icon(ico) }), h('div', {}, h('h3', {}, title), h('p', {}, sub)));
}

export function askName(initial) {
  return new Promise((res) => {
    let done = false;
    const inp = h('input', { type: 'text', value: initial, 'aria-label': 'Name', maxlength: '60' });
    sheet((api) => [
      h('h2', {}, 'Name'), h('div', { style: { marginTop: '10px' } }, inp),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { done = true; api.close(); res(null); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { done = true; api.close(); res(inp.value.trim() || initial); } }, 'Save')),
    ], { onClose: () => { if (!done) res(null); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 80);
  });
}
