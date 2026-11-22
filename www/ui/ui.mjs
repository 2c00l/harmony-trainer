// Small DOM helpers: element builder, sheets, toasts, haptics, formatting.
import { icon } from './icons.mjs';
import { settings } from '../core/settings.mjs';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const ic = (name, cls) => { const s = document.createElement('span'); s.innerHTML = icon(name, cls); return s.firstChild; };

export function iconBtn(name, label, onclick, cls = '') {
  return h('button', { class: `iconbtn ${cls}`, 'aria-label': label, title: label, onclick, html: icon(name) });
}

export function topbar({ title, back, right = [], big = false }) {
  return h('header', { class: 'topbar' },
    back ? iconBtn('back', 'Back', back) : null,
    h('div', { class: `title ${big ? 'big' : ''}`, role: 'heading', 'aria-level': '1' }, title),
    ...right);
}

let sheetOpen = null;
export function sheet(build, { onClose, label = 'Dialog' } = {}) {
  closeSheet(true);
  const scrim = h('div', { class: 'scrim' });
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, h('div', { class: 'grab' }));
  const api = { close: () => closeSheet(), el: box };
  const content = build(api);
  if (content) box.append(...[content].flat());
  scrim.addEventListener('click', () => closeSheet());
  document.body.append(scrim, box);
  sheetOpen = { scrim, box, onClose };
  // drag down to dismiss
  let y0 = null, dy = 0;
  box.addEventListener('touchstart', (e) => { if (box.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  box.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); box.style.transform = `translateY(${dy}px)`; }, { passive: true });
  box.addEventListener('touchend', () => { if (y0 == null) return; y0 = null; if (dy > 110) closeSheet(); else box.style.transform = ''; dy = 0; });
  setTimeout(() => box.querySelector('button, [tabindex], input')?.focus({ preventScroll: true }), 50);
  return api;
}
export function closeSheet(immediate = false) {
  if (!sheetOpen) return;
  const { scrim, box, onClose } = sheetOpen;
  sheetOpen = null;
  if (immediate) { scrim.remove(); box.remove(); } else {
    scrim.classList.add('out'); box.classList.add('out');
    setTimeout(() => { scrim.remove(); box.remove(); }, 260);
  }
  onClose?.();
}
export const isSheetOpen = () => !!sheetOpen;

let toastEl = null, toastTimer = null;
export function toast(msg, { icon: ico = null, ms = 2600 } = {}) {
  if (toastEl) toastEl.remove();
  clearTimeout(toastTimer);
  toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }, ico ? ic(ico) : null, msg);
  document.body.append(toastEl);
  const el = toastEl;
  toastTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

export function confirmSheet({ title, body, ok = 'OK', danger = false }) {
  return new Promise((res) => {
    let done = false;
    sheet((api) => [
      h('h2', {}, title),
      body ? h('p', { class: 'dim' }, body) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => { done = true; api.close(); res(false); } }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { done = true; api.close(); res(true); } }, ok)),
    ], { onClose: () => { if (!done) res(false); }, label: title });
  });
}

export function seg(options, value, onchange, label = '') {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const draw = (v) => { for (const b of el.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); };
  for (const [v, l] of options) el.append(h('button', { 'data-v': v, onclick: () => { draw(v); onchange(v); } }, l));
  draw(value);
  return el;
}

export function toggle(checked, onchange, label) {
  const inp = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  inp.checked = !!checked;
  inp.addEventListener('change', () => onchange(inp.checked));
  return h('label', { class: 'switch' }, inp, h('span'));
}

export function slider({ min, max, step, value, oninput, label }) {
  const el = h('input', { type: 'range', min, max, step, 'aria-label': label });
  el.value = value;
  const paint = () => el.style.setProperty('--p', `${((el.value - min) / (max - min)) * 100}%`);
  paint();
  el.addEventListener('input', () => { paint(); oninput(Number(el.value)); });
  return el;
}

let Haptics = null;
export function haptic(kind = 'light') {
  if (!settings.get('haptics')) return;
  try {
    Haptics = Haptics || window.Capacitor?.Plugins?.Haptics;
    if (Haptics) { Haptics.impact({ style: kind === 'heavy' ? 'HEAVY' : kind === 'medium' ? 'MEDIUM' : 'LIGHT' }); return; }
    navigator.vibrate?.(kind === 'heavy' ? 25 : 10);
  } catch { /* */ }
}

export const fmtTime = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); const r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
export const fmtCents = (c) => (c > 0 ? '+' : c < 0 ? '−' : '±') + Math.abs(Math.round(c)) + '¢';

export function scoreRing(score, color = 'var(--accent)') {
  const R = 64, C = 2 * Math.PI * R;
  const el = h('div', { class: 'ring', role: 'img', 'aria-label': `Score ${score} out of 100` });
  el.innerHTML = `<svg viewBox="0 0 148 148"><circle cx="74" cy="74" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="12"/><circle class="arc" cx="74" cy="74" r="${R}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition: stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)"/></svg><div class="val">0</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.querySelector('.arc').style.strokeDashoffset = String(C * (1 - score / 100));
    const v = el.querySelector('.val');
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 1000); v.textContent = String(Math.round(score * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }));
  return el;
}

export function gradeBar(counts) {
  const tot = counts.perfect + counts.good + counts.ok + counts.miss || 1;
  const el = h('div', { class: 'grades', role: 'img', 'aria-label': `${counts.perfect} perfect, ${counts.good} good, ${counts.ok} OK, ${counts.miss} missed` });
  for (const [k, c] of [['perfect', '--g-perfect'], ['good', '--g-good'], ['ok', '--g-ok'], ['miss', '--g-miss']]) {
    if (counts[k]) el.append(h('i', { style: { flex: String(counts[k] / tot), background: `var(${c})` } }));
  }
  return el;
}
