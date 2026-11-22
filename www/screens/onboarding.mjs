// Onboarding: welcome → microphone → headphones tip → sing (quick range check). ~30 s to singing.
import { h, haptic } from '../ui/ui.mjs';
import { icon } from '../ui/icons.mjs';
import { heroArt } from '../ui/art.mjs';
import { SingView } from '../ui/singview.mjs';
import { go } from '../app.mjs';
import * as E from '../audio/engine.mjs';
import { route } from '../audio/route.mjs';
import { settings } from '../core/settings.mjs';
import { noteLabel, voiceType } from '../dsp/theory.mjs';

export async function render() {
  const root = h('div', { class: 'onb', role: 'dialog', 'aria-label': 'Welcome' });
  const el = h('div', {}, root);
  let step = 0, art = null, sv = null, alive = true;
  const dots = () => h('div', { class: 'dots', 'aria-hidden': 'true' }, ...[0, 1, 2, 3].map((i) => h('i', { class: i === step ? 'on' : '' })));
  const cleanup = () => { art?.stop(); art = null; };

  function show(...kids) { root.replaceChildren(...kids); root.querySelector('h1')?.focus?.(); }

  function welcome() {
    step = 0;
    cleanup();
    art = heroArt();
    show(h('div', { class: 'body' },
      h('div', { class: 'art' }, art.canvas),
      h('h1', { tabindex: '-1' }, 'Sing in harmony with yourself'),
      h('p', { class: 'dim' }, 'See your voice as you sing. Record a melody, get a harmony part written for you, then sing it over your own recording and get scored.'),
      h('p', { class: 'small faint' }, 'Everything stays on your phone. No account needed.')),
      dots(), h('button', { class: 'btn primary block', onclick: mic }, 'Get started'));
  }
  function mic() {
    step = 1; cleanup();
    const status = h('p', { class: 'small', style: { color: 'var(--c-coral)', minHeight: '1.2em' }, role: 'alert' });
    show(h('div', { class: 'body' },
      h('div', { style: { width: '72px', height: '72px', borderRadius: '24px', display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }, html: icon('mic') }),
      h('h1', { tabindex: '-1' }, 'Let’s hear you'),
      h('p', { class: 'dim' }, 'Harmony Trainer uses the microphone to follow your pitch. Audio is analysed on this device and is never uploaded.'),
      status),
      dots(), h('button', { class: 'btn primary block', onclick: async () => {
        try { await E.startMic(); settings.meta('micOk', true); await route.refresh(); haptic('light'); headphones(); }
        catch { status.textContent = 'Microphone access was blocked. You can allow it in your device settings, or carry on and turn it on later.'; root.querySelector('.btn.primary').textContent = 'Continue anyway'; root.querySelector('.btn.primary').onclick = headphones; }
      } }, 'Allow microphone'));
  }
  function headphones() {
    step = 2;
    const on = route.isHeadphones();
    show(h('div', { class: 'body' },
      h('div', { style: { width: '72px', height: '72px', borderRadius: '24px', display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--accent-2) 18%, transparent)', color: 'var(--accent-2)' }, html: icon('headphones') }),
      h('h1', { tabindex: '-1' }, on ? 'Headphones detected' : 'Headphones help'),
      h('p', { class: 'dim' }, 'When you sing over your own recording, headphones stop the mic hearing the playback, which gives the cleanest scores.'),
      h('p', { class: 'small faint' }, 'No headphones? That’s fine. Echo cancellation switches on automatically when you use the speaker.')),
      dots(), h('button', { class: 'btn primary block', onclick: sing }, 'Next: sing a note'));
  }
  function sing() {
    step = 3;
    sv = new SingView({ roll: { nowX: 0.7 } });
    sv.el.style.borderRadius = '24px'; sv.el.style.overflow = 'hidden'; sv.el.style.minHeight = '260px';
    const msg = h('p', { class: 'dim', 'aria-live': 'polite' }, 'Sing a relaxed “ah”, then slide a little up and down. Watch your line.');
    const bar = h('div', { class: 'progressbar' }, h('i', { style: { width: '0%' } }));
    const frames = [];
    let voiced = 0;
    const un = E.onPitch((f) => { if (f.midi != null && f.clarity > 0.7) { frames.push(f.midi); voiced++; bar.firstChild.style.width = `${Math.min(100, (voiced / 260) * 100)}%`; if (voiced === 260) finish(); } });
    const skip = h('button', { class: 'btn ghost block', onclick: () => finish(true) }, 'Skip for now');
    show(h('div', { class: 'body', style: { justifyContent: 'flex-start' } }, h('h1', { tabindex: '-1' }, 'Sing!'), msg, sv.el, bar), dots(), skip);
    E.startMic().catch(() => {});
    function finish(skipped = false) {
      un();
      if (!skipped && frames.length > 40) {
        const s = frames.slice().sort((a, b) => a - b);
        const p10 = s[Math.floor(s.length * 0.1)], p90 = s[Math.floor(s.length * 0.9)], med = s[s.length >> 1];
        // a quick slide shows only part of the range; widen around it conservatively
        const lo = Math.round(Math.min(p10, med - 7)), hi = Math.round(Math.max(p90, med + 8));
        settings.meta('range', { lo, hi, at: Date.now(), quick: true });
        haptic('medium');
        root.replaceChildren(h('div', { class: 'body' },
          h('div', { style: { width: '72px', height: '72px', borderRadius: '24px', display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }, html: icon('check') }),
          h('h1', { tabindex: '-1' }, 'Lovely!'),
          h('p', { class: 'dim' }, `Your voice sits around ${noteLabel(Math.round(med))}. We’ll pitch exercises from ${noteLabel(lo)} to ${noteLabel(hi)}, roughly a ${voiceType(lo, hi).toLowerCase()} range. Use the Range finder in Train to fine-tune it.`)),
          dots(), h('button', { class: 'btn primary block', onclick: done }, 'Start singing harmony'));
      } else done();
    }
  }
  function done() {
    settings.meta('onboarded', true);
    sv?.destroy(); sv = null;
    E.stopMic();
    go('/', { replace: true });
  }
  welcome();
  return { el, destroy() { alive = false; cleanup(); sv?.destroy(); void alive; } };
}
