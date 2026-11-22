// My songs: every recorded or imported vocal.
import { h, ic, toast, confirmSheet, sheet, fmtTime, topbar } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { back, go } from '../app.mjs';
import { db } from '../core/db.mjs';
import { keyName } from '../dsp/theory.mjs';
import { pickSong } from './import.mjs';

export async function render() {
  let projects = await db.listProjects().catch(() => []);
  const list = h('div', { class: 'list' });
  const el = h('div', {}, topbar({ title: 'My songs', back: () => back() }), h('div', { class: 'scroll' }, h('div', { class: 'wrap' },
    list,
    h('div', { class: 'addrow section' },
      h('button', { class: 'btn primary', onclick: () => go('/project/new'), html: icon('mic') + 'Record my voice' }),
      h('button', { class: 'btn violet', onclick: () => pickSong(), html: icon('import') + 'Import a song' })))));

  function draw() {
    list.replaceChildren(...(projects.length ? projects.map(row) : [h('div', { class: 'empty' }, h('p', {}, 'No songs yet.'))]));
  }
  function row(p) {
    return h('div', { class: 'row' },
      h('button', { class: 'grow', style: { textAlign: 'left', minHeight: '48px' }, onclick: () => go(`/project/${p.id}`) },
        h('div', { style: { fontWeight: 700 } }, p.name),
        h('div', { class: 'small faint' }, [p.imported ? 'Imported song' : 'Recorded', p.key ? keyName(p.key) : null, p.duration ? fmtTime(p.duration) : null].filter(Boolean).join(' · '))),
      h('button', { class: 'iconbtn', 'aria-label': `Rename ${p.name}`, html: icon('edit'), onclick: async () => { const n = await askName(p.name); if (n) { p.name = n; await db.putProject(p); draw(); } } }),
      h('button', { class: 'iconbtn', 'aria-label': `Delete ${p.name}`, html: icon('trash'), onclick: async () => {
        if (!(await confirmSheet({ title: `Delete ${p.name}?`, body: 'Its audio is removed from this device.', ok: 'Delete', danger: true }))) return;
        await db.deleteProject(p); projects = projects.filter((x) => x !== p); draw(); toast('Deleted');
      } }));
  }
  draw();
  return { el };
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
void ic;
