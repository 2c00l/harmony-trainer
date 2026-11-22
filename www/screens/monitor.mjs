import { h, iconBtn, topbar, sheet, toast } from '../ui/ui.mjs';
import { SingView } from '../ui/singview.mjs';
import { back } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { keyName, SHARP_NAMES } from '../dsp/theory.mjs';
import { micGate } from './mic-gate.mjs';

export async function render() {
  const sv = new SingView({ roll: { nowX: 0.72 } });
  let key = null, droneOn = false;
  const keyBtn = h('button', { class: 'chip', onclick: pickKey }, 'Key: none');
  const droneBtn = iconBtn('drone', 'Drone', toggleDrone);
  const el = h('div', {},
    topbar({ title: 'Live pitch', back: () => back(), right: [keyBtn, droneBtn] }),
    sv.el);
  async function toggleDrone() {
    droneOn = !droneOn;
    droneBtn.classList.toggle('on', droneOn);
    if (droneOn) E.startDrone((key ? key.root : 0) + 48); else E.stopDrone();
  }
  function pickKey() {
    sheet((api) => [
      h('h2', {}, 'Show a key'),
      h('p', { class: 'dim small' }, 'Highlights the scale notes on the roll.'),
      h('div', { class: 'chips wrapc', style: { marginTop: '12px' } },
        h('button', { class: `chip ${key ? '' : 'on'}`, onclick: () => { key = null; apply(); api.close(); } }, 'None'),
        ...SHARP_NAMES.flatMap((n, r) => ['major', 'minor'].map((mode) => h('button', { class: `chip ${key && key.root === r && key.mode === mode ? 'on' : ''}`, onclick: () => { key = { root: r, mode }; apply(); api.close(); } }, keyName({ root: r, mode }))))),
    ]);
  }
  function apply() {
    sv.roll.set({ key });
    keyBtn.textContent = key ? keyName(key) : 'Key: none';
    if (droneOn) E.startDrone(key.root + 48);
  }
  return {
    el,
    async mounted() {
      const ok = await micGate(sv.el);
      if (!ok) return;
      try { await E.startMic(); } catch { toast('Microphone unavailable'); }
    },
    destroy() { sv.destroy(); E.stopMic(); E.stopDrone(); },
    onHide() { E.stopMic(); E.stopDrone(); droneOn = false; droneBtn.classList.remove('on'); },
    onShow() { E.startMic().catch(() => {}); },
  };
}
