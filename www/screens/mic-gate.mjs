// Ensures mic permission before a singing screen starts; shows a friendly prompt in-place.
import { h, ic } from '../ui/ui.mjs';
import * as E from '../audio/engine.mjs';
import { route } from '../audio/route.mjs';
import { settings } from '../core/settings.mjs';

export async function micPermission() {
  try {
    const st = await navigator.permissions?.query?.({ name: 'microphone' });
    return st ? st.state : 'prompt';
  } catch { return 'prompt'; }
}

/** Resolves true once the mic is running. Overlays a prompt into `host` if needed. */
export function micGate(host) {
  return new Promise((resolve) => {
    (async () => {
      const state = await micPermission();
      // WebViews often report 'prompt' even when the OS permission is granted: if the mic
      // has worked before (or permission says granted), just try it.
      if (state === 'granted' || settings.meta('micOk') || window.Capacitor?.isNativePlatform?.()) {
        try { await E.startMic(); settings.meta('micOk', true); route.refresh(); resolve(true); return; } catch { /* fall through */ }
      }
      const box = h('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', zIndex: 5, background: 'color-mix(in srgb, var(--bg) 70%, transparent)', backdropFilter: 'blur(6px)', padding: '24px' } },
        h('div', { class: 'card', style: { maxWidth: '360px', textAlign: 'center' } },
          h('div', { style: { color: 'var(--accent)', margin: '0 auto 8px', width: '44px' } }, ic('mic')),
          h('h2', {}, state === 'denied' ? 'Microphone is blocked' : 'Let’s hear you'),
          h('p', { class: 'dim small', style: { margin: '8px 0 16px' } }, state === 'denied'
            ? 'Turn on microphone access for Harmony Trainer in your device settings, then come back.'
            : 'Harmony Trainer listens to your voice to show your pitch. Audio never leaves this device.'),
          h('button', { class: 'btn primary block', onclick: start }, state === 'denied' ? 'Try again' : 'Turn on microphone')));
      host.append(box);
      async function start() {
        try { await E.startMic(); settings.meta('micOk', true); route.refresh(); box.remove(); resolve(true); }
        catch { box.querySelector('h2').textContent = 'Microphone is blocked'; box.querySelector('p').textContent = 'Turn on microphone access for Harmony Trainer in your device settings, then come back.'; }
      }
    })();
  });
}
