// Onboarding: welcome → microphone → straight into Live.
import { h, haptic } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { heroArt } from '../ui/art.mjs';
import { go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { route } from '../audio/route.mjs';
import { settings } from '../core/settings.mjs';

export async function render() {
  const root = h('div', { class: 'onb', role: 'dialog', 'aria-label': 'Welcome' });
  const el = h('div', {}, root);
  let step = 0, art = null;
  const dots = () => h('div', { class: 'dots', 'aria-hidden': 'true' }, ...[0, 1].map((i) => h('i', { class: i === step ? 'on' : '' })));
  const cleanup = () => { art?.stop(); art = null; };
  function show(...kids) { root.replaceChildren(...kids); root.querySelector('h1')?.focus?.(); }

  function welcome() {
    step = 0; cleanup();
    art = heroArt();
    show(h('div', { class: 'body' },
      h('div', { class: 'art' }, art.canvas),
      h('h1', { tabindex: '-1' }, 'See your voice'),
      h('p', { class: 'dim' }, 'Sing and watch your pitch live. Add a song or record yourself, and we will show you a harmony part to sing.'),
      h('p', { class: 'small faint' }, 'Everything stays on your phone. No account needed.')),
      dots(), h('button', { class: 'btn primary block', onclick: mic }, 'Get started'));
  }
  function mic() {
    step = 1; cleanup();
    const status = h('p', { class: 'small', style: { color: 'var(--c-coral)', minHeight: '1.2em' }, role: 'alert' });
    const btn = h('button', { class: 'btn primary block', onclick: async () => {
      try { await E.startMic(); settings.meta('micOk', true); await route.refresh(); haptic('light'); done(); }
      catch { status.textContent = 'Microphone access was blocked. You can allow it in your device settings later.'; btn.textContent = 'Continue anyway'; btn.onclick = done; }
    } }, 'Allow microphone');
    show(h('div', { class: 'body' },
      h('div', { style: { width: '72px', height: '72px', borderRadius: '24px', display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }, html: icon('mic') }),
      h('h1', { tabindex: '-1' }, 'Let’s hear you'),
      h('p', { class: 'dim' }, 'The microphone is used to follow your pitch. Audio is analysed on this device and never uploaded.'),
      status), dots(), btn);
  }
  function done() {
    settings.meta('onboarded', true);
    go('/', { replace: true });
  }
  welcome();
  return { el, destroy() { cleanup(); } };
}
