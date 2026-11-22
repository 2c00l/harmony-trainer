// Home: live pitch, full screen. The "Add vocals" box at the bottom records a voice or
// imports a song (it can be hidden for good in Settings).
import { h, iconBtn, sheet, toast, infoBtn } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { SingView } from '../ui/singview.mjs';
import { go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { settings } from '../core/settings.mjs';
import { db } from '../core/db.mjs';
import { keyName, SHARP_NAMES } from '../dsp/theory.mjs';
import { micGate } from './mic-gate.mjs';
import { pickSong, SONGS_CHANGED } from '../core/importer.mjs';

export async function render() {
  let projects = await db.listProjects().catch(() => []);
  const sv = new SingView({ roll: { nowX: 0.72 } });
  let key = null, alive = true;
  const keyBtn = h('button', { class: 'chip', onclick: pickKey, 'aria-label': 'Show a key' }, 'Key');
  const addBtn = iconBtn('plus', 'Add vocals', addSheet);
  const songsBtn = iconBtn('folder', 'My songs', () => go('/songs'));
  const el = h('div', {},
    h('header', { class: 'topbar' },
      h('div', { class: 'title big', role: 'heading', 'aria-level': '1' }, 'Live'),
      infoBtn('Live pitch', 'Sing and your voice draws the glowing line. The big letter is the note you are nearest to.', 'The small meter shows how many cents (hundredths of a semitone) you are sharp or flat. Within about 15 cents sounds in tune.', 'Tap Key to highlight the notes of a scale.'),
      keyBtn, addBtn,
      songsBtn,
      iconBtn('settings', 'Settings', () => go('/settings'))),
    sv.el);

  const box = h('div', { class: 'dock addbox' });
  function drawBox() {
    songsBtn.style.display = projects.length ? '' : 'none';
    const hidden = settings.get('hideAddBox');
    addBtn.style.display = hidden ? '' : 'none';
    box.remove();
    if (hidden) return;
    box.replaceChildren(
      h('div', { class: 'bar' },
        h('div', { class: 'grow', style: { fontWeight: 750 } }, 'Add vocals'),
        h('button', { class: 'btn sm ghost', onclick: () => { settings.set('hideAddBox', true); drawBox(); toast('Hidden. Bring it back in Settings, or use the + button.', { ms: 3200 }); } }, 'Hide')),
      addButtons(),
      projects.length ? h('div', { class: 'chips' }, ...projects.slice(0, 6).map((p) => h('button', { class: 'chip', onclick: () => go(`/project/${p.id}`), html: icon('play') + esc(p.name) }))) : null);
    el.append(box);
  }
  function addButtons(close) {
    return h('div', { class: 'addrow' },
      h('button', { class: 'btn primary', onclick: () => { close?.(); go('/project/new'); }, html: icon('mic') + 'Record my voice' }),
      h('button', { class: 'btn violet', onclick: () => { close?.(); pickSong(); }, html: icon('import') + 'Import a song' }));
  }
  function addSheet() {
    sheet((api) => [h('h2', {}, 'Add vocals'), h('p', { class: 'small dim' }, 'Record a melody yourself, or take the vocal out of a song on your phone.'), addButtons(() => api.close())], { label: 'Add vocals' });
  }
  function pickKey() {
    sheet((api) => [
      h('h2', {}, 'Show a key'),
      h('p', { class: 'dim small' }, 'Highlights the notes of the scale.'),
      h('div', { class: 'chips wrapc', style: { marginTop: '12px' } },
        h('button', { class: `chip ${key ? '' : 'on'}`, onclick: () => { key = null; apply(); api.close(); } }, 'None'),
        ...SHARP_NAMES.flatMap((n, r) => ['major', 'minor'].map((mode) => h('button', { class: `chip ${key && key.root === r && key.mode === mode ? 'on' : ''}`, onclick: () => { key = { root: r, mode }; apply(); api.close(); } }, keyName({ root: r, mode }))))),
    ], { label: 'Show a key' });
  }
  function apply() { sv.roll.set({ key }); keyBtn.textContent = key ? keyName(key) : 'Key'; }
  const unSet = settings.on((k) => { if (k === 'hideAddBox' || k === '*') drawBox(); });
  drawBox();
  const onSongs = async () => { projects = await db.listProjects().catch(() => projects); if (alive) drawBox(); };
  window.addEventListener(SONGS_CHANGED, onSongs);

  return {
    el,
    async mounted() {
      const ok = await micGate(sv.el);
      if (!ok || !alive) { if (!alive) E.stopMic(); return; }
      try { await E.startMic(); } catch { toast('Microphone unavailable'); }
      if (!alive) E.stopMic(); // left Live while the mic was starting
    },
    destroy() { alive = false; window.removeEventListener(SONGS_CHANGED, onSongs); unSet(); sv.destroy(); E.stopMic(); },
    onHide() { E.stopMic(); },
    onShow() { if (alive) E.startMic().catch(() => {}); },
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
