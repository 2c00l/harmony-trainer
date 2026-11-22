// Global gestures and keyboard shortcuts (touch, hardware keyboards, switch access).
import { h, sheet, isSheetOpen, closeSheet } from './ui.mjs';

export const SHORTCUTS = [
  ['Swipe left or right', 'Move between Studio, Train, Learn and Progress'],
  ['Swipe right from the left edge', 'Go back'],
  ['Swipe down on a panel', 'Close it'],
  ['Space', 'Play, stop, or start and stop a take'],
  ['R', 'Record'],
  ['H · S · M · N', 'Studio: Harmony, Sing, Mix and Notes'],
  ['Arrow keys', 'Notes: move the selected bar (Tab picks the next bar)'],
  ['D', 'Live pitch: drone on or off'],
  ['1 – 4', 'Jump to a main tab'],
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
 * getView(): current screen object (may expose `keys` {key: fn} and `isTab`)
 * tabs: ['/', '/train', ...]; currentPath(): string; go(path), back()
 */
export function installShortcuts({ getView, tabs, currentPath, go, back }) {
  const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isSheetOpen()) { if (e.key === 'Escape') closeSheet(); return; }
    if (isTyping(document.activeElement)) return;
    const view = getView();
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === '?') { e.preventDefault(); showShortcuts(); return; }
    if (k === 'Escape') { if (!tabs.includes(currentPath())) { e.preventDefault(); if (!view?.onBack?.()) back(); } return; }
    if (/^[1-4]$/.test(k)) { e.preventDefault(); go(tabs[Number(k) - 1]); return; }
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
    ok = edge || !blocked(e.target);
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!ok) return;
    ok = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy, dt = performance.now() - st;
    if (dt > 650 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const path = currentPath();
    const i = tabs.indexOf(path);
    if (edge && dx > 0 && i < 0) { const view = getView(); if (!view?.onBack?.()) back(); return; }
    if (i >= 0 && !edge) {
      const j = dx < 0 ? i + 1 : i - 1;
      if (j >= 0 && j < tabs.length) go(tabs[j]);
    }
  }, { passive: true });
}
