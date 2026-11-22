// App shell: hash router, tab bar, theme, lifecycle.
import { h, closeSheet, isSheetOpen } from './ui/ui.mjs';
import { icon } from './ui/icons.mjs';
import { settings, prefersReducedMotion } from './core/settings.mjs';
import { route } from './audio/route.mjs';
import * as E from './audio/engine.mjs';
import { native } from './core/native.mjs';
import { installShortcuts } from './ui/shortcuts.mjs';

const app = document.getElementById('app');
const TABS = [
  { path: '/', label: 'Studio', icon: 'studio' },
  { path: '/train', label: 'Train', icon: 'train' },
  { path: '/learn', label: 'Learn', icon: 'learn' },
  { path: '/progress', label: 'Progress', icon: 'progress' },
];

const ROUTES = [
  [/^\/$/, () => import('./screens/home.mjs'), true],
  [/^\/train$/, () => import('./screens/train.mjs'), true],
  [/^\/learn$/, () => import('./screens/learn.mjs'), true],
  [/^\/progress$/, () => import('./screens/progress.mjs'), true],
  [/^\/settings$/, () => import('./screens/settings.mjs'), false],
  [/^\/monitor$/, () => import('./screens/monitor.mjs'), false],
  [/^\/project\/([\w-]+)$/, () => import('./screens/project.mjs'), false],
  [/^\/t\/([\w-]+)$/, () => import('./screens/trainers.mjs'), false],
  [/^\/lesson\/([\w-]+)$/, () => import('./screens/lesson.mjs'), false],
  [/^\/calibrate$/, () => import('./screens/calibrate.mjs'), false],
  [/^\/import$/, () => import('./screens/import.mjs'), false],
  [/^\/welcome$/, () => import('./screens/onboarding.mjs'), false],
];

let current = null; // {el, destroy}
let tabbar = null;
let depth = 0;

export function go(path, { replace = false } = {}) {
  if (replace) location.replace('#' + path); else location.hash = path;
}
export function back(fallback = '/') {
  if (history.length > 1 && depth > 0) history.back(); else go(fallback, { replace: true });
}
window.__go = go;

function currentPath() { return (location.hash || '#/').slice(1) || '/'; }

let navSeq = 0;
async function render() {
  const path = currentPath();
  const seq = ++navSeq;
  closeSheet(true);
  let match = null, isTab = false, loader = null;
  for (const [re, l, tab] of ROUTES) { const m = path.match(re); if (m) { match = m; loader = l; isTab = tab; break; } }
  if (!loader) { go('/', { replace: true }); return; }
  const mod = await loader();
  if (seq !== navSeq) return;
  const prev = current;
  try { prev?.destroy?.(); } catch (e) { console.warn(e); }
  const view = await mod.render(...match.slice(1));
  if (seq !== navSeq) { view.destroy?.(); return; }
  current = view;
  view.el.classList.add('screen');
  if (isTab) view.el.classList.add('with-tabs');
  if (!prefersReducedMotion()) view.el.classList.add(isTab ? 'enter-back' : 'enter');
  app.replaceChildren(view.el);
  if (isTab) { ensureTabbar(); app.append(tabbar); markTab(path); }
  view.mounted?.();
  // focus management for screen readers
  const hd = view.el.querySelector('[role=heading], h1');
  if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus({ preventScroll: true }); }
}

function ensureTabbar() {
  if (tabbar) return;
  tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    ...TABS.map((t) => h('a', { class: 'tab', href: '#' + t.path, 'data-path': t.path, html: icon(t.icon) + `<span>${t.label}</span>` })));
}
function markTab(path) {
  for (const a of tabbar.children) { if (a.dataset.path === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
}

function applyTheme() {
  let t = settings.get('theme');
  if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  if (settings.get('palette') === 'cb') document.documentElement.dataset.palette = 'cb'; else delete document.documentElement.dataset.palette;
  document.documentElement.classList.toggle('reduce-motion', prefersReducedMotion());
  document.documentElement.classList.toggle('left-handed', !!settings.get('leftHanded'));
  document.documentElement.dataset.text = settings.get('textSize');
  document.documentElement.dataset.contrast = settings.get('contrast') ? 'high' : 'normal';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = t === 'light' ? '#F4F5FA' : '#0B0F1A';
  try { if (window.Capacitor?.isNativePlatform?.()) native('SystemBars').setStyle({ style: t === 'light' ? 'LIGHT' : 'DARK' }).catch(() => {}); } catch { /* */ }
}
settings.on((k) => { if (['theme', 'palette', 'reduceMotion', 'leftHanded', 'textSize', 'contrast', '*'].includes(k)) applyTheme(); });
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  // naive depth tracking for back()
  depth = Math.max(0, depth + (TABS.some((t) => '#' + t.path === location.hash) ? -depth : 1));
  lastHash = location.hash;
  render();
});
void lastHash;

// Android hardware back
try {
  native('App')?.addListener('backButton', () => {
    if (isSheetOpen()) { closeSheet(); return; }
    if (current?.onBack?.()) return;
    if (currentPath() === '/') native('App').exitApp();
    else back();
  });
  native('App')?.addListener('pause', () => current?.onHide?.());
} catch { /* */ }

// lifecycle: pause audio-heavy screens when backgrounded
document.addEventListener('visibilitychange', () => { if (document.hidden) current?.onHide?.(); else current?.onShow?.(); });
E.engineEvents.addEventListener('interrupted', () => current?.onInterrupt?.());
window.addEventListener('ht-interruption', () => current?.onInterrupt?.());

applyTheme();
installShortcuts({ getView: () => current, tabs: TABS.map((t) => t.path), currentPath, go, back });
route.init();
if (!settings.meta('onboarded') && !location.hash.startsWith('#/welcome')) go('/welcome', { replace: true });
render();
