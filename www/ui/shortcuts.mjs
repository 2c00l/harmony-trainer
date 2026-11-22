// Global gestures and keyboard shortcuts (touch, hardware keyboards, switch access).
import { h, sheet, isSheetOpen, closeSheet } from './ui.mjs';

export const SHORTCUTS = [
  ['Swipe right from the left edge', 'Go back'],
  ['Swipe down on a panel', 'Close it'],
  ['Space', 'Play or stop (or start and stop recording)'],
  ['Left and right arrows', 'Skip back or forward 5 seconds'],
  ['H', 'Show or hide the harmony'],
  ['P', 'Play the harmony notes on or off'],
  ['V', 'Vocal on or off'],
  ['Esc', 'Close a panel, or go back'],
  ['?', 'Show this list'],
];

export function showShortcuts() {
  sheet(() => [
    h('h2', {}, 'Gestures and shortcuts'),
    h('p', { class: 'small dim' }, 'Everything also works with a screen reader, switch control or a keyboard.'),
    h('div', { class: 'list', style: { marginTop: '10px' } }, ...SHORTCUTS.map(([k, v]) => h('div', { class: 'row', style: { minHeight: '48px' } },
      h('span', { class: 'kbd', style: { maxWidth: '48%' } }, k), h('div', { class: 'grow small' }, v)))),
  ], { label: 'Gestures and shortcuts' });
}

/**
 * getView(): current screen object (may expose `keys` {key: fn} and `onBack`)
 */
export function installShortcuts({ getView, root, currentPath, back }) {
  const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isSheetOpen()) { if (e.key === 'Escape') closeSheet(); return; }
    if (isTyping(document.activeElement)) return;
    const view = getView();
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === '?') { e.preventDefault(); showShortcuts(); return; }
    if (k === 'Escape') { if (currentPath() !== root) { e.preventDefault(); if (!view?.onBack?.()) back(); } return; }
    // Space on a focused button already activates it; only take Space when nothing interactive is focused
    if (k === ' ' && document.activeElement && document.activeElement.closest('button, a, [role=button], input, [role=switch]')) return;
    const fn = view?.keys?.[k === ' ' ? 'space' : k];
    if (fn) { e.preventDefault(); fn(); }
  });

  // swipes
  let sx = 0, sy = 0, st = 0, ok = false, edge = false;
  const blocked = (el) => !!el?.closest?.('canvas.roll, input[type=range], .chips, .tools, .sheet, .heat, .seg, .stepper');
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || isSheetOpen()) { ok = false; return; }
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; st = performance.now();
    edge = sx < 24;
    ok = edge && !blocked(e.target);
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!ok) return;
    ok = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy, dt = performance.now() - st;
    if (dt > 650 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (edge && dx > 0 && currentPath() !== root) { const view = getView(); if (!view?.onBack?.()) back(); }
  }, { passive: true });
}
