// Audio output route: 'wired' | 'bluetooth' | 'usb' | 'speaker' | 'unknown'.
// Native builds use the local AudioRoute Capacitor plugin; the web falls back to
// device-label heuristics (labels are only exposed after mic permission).
const subs = new Set();
let kind = 'unknown';
let label = '';

import { native } from '../core/native.mjs';
function plugin() { return native('AudioRoute'); }

function set(k, l = '') {
  if (k === kind && l === label) return;
  kind = k; label = l;
  subs.forEach((f) => f(kind));
}

async function refreshWeb() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const outs = devs.filter((d) => d.kind === 'audiooutput' || d.kind === 'audioinput');
    const txt = outs.map((d) => d.label.toLowerCase()).join(' | ');
    if (!txt.trim()) return; // no labels yet
    if (/airpods|bluetooth|buds|bt |hands-free|headset \(/.test(txt)) set('bluetooth');
    else if (/headphone|headset|earphone|wired/.test(txt)) set('wired');
    else if (/usb/.test(txt)) set('usb');
    else set('speaker');
  } catch { /* unsupported */ }
}

export const route = {
  kind: () => kind,
  label: () => label,
  isHeadphones: () => kind === 'wired' || kind === 'bluetooth' || kind === 'usb',
  on(f) { subs.add(f); return () => subs.delete(f); },
  async refresh() {
    const p = plugin();
    if (p) {
      try { const r = await p.getRoute(); set(r.type || 'unknown', r.name || ''); return kind; } catch { /* fall through */ }
    }
    await refreshWeb();
    return kind;
  },
  async init() {
    const p = plugin();
    if (p) {
      try { await p.addListener('routeChange', (r) => set(r.type || 'unknown', r.name || '')); } catch { /* */ }
      try { await p.addListener('interruption', (d) => { if (d.began) window.dispatchEvent(new Event('ht-interruption')); }); } catch { /* */ }
    } else if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshWeb);
    }
    await this.refresh();
  },
};
