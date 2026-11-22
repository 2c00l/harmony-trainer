// Latency calibration wizard: loopback click (speaker) or say "ta" on each click (headphones).
import { h, topbar, seg, toast, ic, haptic } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { back } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { route } from '../audio/route.mjs';
import { settings } from '../core/settings.mjs';
import { findOnset, robustLatency } from '../dsp/onset.mjs';
import { micGate } from './mic-gate.mjs';

const ROUTE_NAMES = { wired: 'Wired headphones', bluetooth: 'Bluetooth', usb: 'USB audio', speaker: 'Phone speaker', unknown: 'Current output' };

export async function render() {
  await route.refresh();
  let method = route.isHeadphones() ? 'sing' : 'loop';
  const body = h('div', { class: 'wrap' });
  const el = h('div', {}, topbar({ title: 'Latency calibration', back: () => back('/settings') }), h('div', { class: 'scroll' }, body));
  let running = false;

  function draw(result = null) {
    const map = settings.meta('latency') || {};
    const kind = route.kind();
    body.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, h('div', {}, h('div', { class: 'small dim' }, 'Audio route'), h('h3', {}, ROUTE_NAMES[kind] || kind)),
          h('div', { style: { textAlign: 'right' } }, h('div', { class: 'small dim' }, 'Delay'), h('div', { class: 'big-num', style: { fontSize: '1.8rem' } }, map[kind] != null ? `${Math.round(map[kind] * 1000)} ms` : '—'))),
        h('p', { class: 'small dim', style: { marginTop: '8px' } }, map[kind] != null ? 'Calibrated. Scores and layers line up using this delay.' : `Not calibrated yet. Using an estimate of ${Math.round(E.roundTripLatency() * 1000)} ms.`)),
      h('div', { class: 'section' }, seg([['sing', 'Say “ta” (headphones)'], ['loop', 'Loopback (speaker)']], method, (v) => { method = v; draw(); }, 'Method')),
      h('div', { class: 'card section prose' },
        method === 'sing'
          ? h('p', {}, 'Put your headphones on. You will hear 8 clicks. Say a short ', h('b', {}, '“ta”'), ' exactly on each click, like a drummer.')
          : h('p', {}, 'Take off headphones and turn the volume up. Hold the phone still in a quiet room. The mic listens for the clicks coming out of the speaker.')),
      result ? h('div', { class: 'card section', style: { textAlign: 'center' } }, result) : null,
      h('div', { class: 'section', style: { display: 'flex', gap: '10px' } },
        h('button', { class: 'btn primary block', onclick: run, disabled: running, html: icon('calibrate') + (running ? 'Listening…' : 'Start') }),
        map[kind] != null ? h('button', { class: 'btn ghost', onclick: () => { const m = { ...(settings.meta('latency') || {}) }; delete m[kind]; settings.meta('latency', m); draw(); } }, 'Reset') : null),
      h('p', { class: 'small faint section' }, 'Wired and Bluetooth headphones are stored separately. Bluetooth usually adds 150–250 ms.'),
    );
  }

  async function run() {
    if (running) return;
    if (!(await micGate(body))) return;
    running = true; draw();
    try {
      await E.startMic({ aec: false });
      await new Promise((r) => setTimeout(r, 400));
      const beat = 0.6, n = 8;
      const t0 = E.now() + 1.0;
      const times = Array.from({ length: n + 2 }, (_, i) => t0 + i * beat);
      E.startRecording();
      await E.clicksAt(times, method === 'loop' ? 1.4 : 1);
      let i = 0;
      const tick = setInterval(() => { if (E.now() > times[i]) { haptic('light'); i++; } if (i >= times.length) clearInterval(tick); }, 20);
      await new Promise((r) => setTimeout(r, (times[times.length - 1] - E.now() + 0.9) * 1000));
      clearInterval(tick);
      const rec = E.stopRecording();
      const sr = E.sampleRate();
      const start = rec.startFrame / sr;
      // skip the first two (lead-in) clicks
      const offs = times.slice(2).map((t) => { const o = findOnset(rec.samples, sr, t - start - 0.12, t - start + 0.55); return o == null ? null : o + start - t; });
      const L = robustLatency(offs);
      E.stopMic();
      running = false;
      if (L == null) { draw(h('div', {}, h('h3', {}, 'Couldn’t get a steady reading'), h('p', { class: 'small dim' }, method === 'sing' ? 'Try again with a crisp “ta” right on the clicks.' : 'Try again with the volume up and less background noise.'))); return; }
      const m = { ...(settings.meta('latency') || {}) };
      m[route.kind()] = Math.round(L * 1000) / 1000;
      settings.meta('latency', m);
      haptic('medium');
      draw(h('div', {}, h('div', { style: { color: 'var(--accent)', width: '40px', margin: '0 auto' } }, ic('check')), h('h3', {}, `Measured ${Math.round(L * 1000)} ms`), h('p', { class: 'small dim' }, 'Saved for this audio route.')));
    } catch (e) {
      running = false; E.stopMic(); toast('Calibration failed. Check microphone access.'); draw();
      console.warn(e);
    }
  }
  draw();
  const un = route.on(() => draw());
  return { el, destroy() { un(); E.stopRecording(); E.stopMic(); } };
}
