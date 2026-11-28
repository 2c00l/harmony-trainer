// Small DOM helpers: element builder, sheets, toasts, haptics, formatting.
import { icon } from './icons.mjs';
import { settings } from '../core/settings.mjs';
import { native } from '../core/native.mjs';

// Ignore null/false children everywhere (conditional UI) instead of rendering "null".
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['append', 'replaceChildren', 'prepend']) {
    const orig = proto[m];
    proto[m] = function (...a) { return orig.apply(this, a.filter((x) => x != null && x !== false)); };
  }
}

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

/** small (i) button that explains something in plain words; hidden if the user turned help buttons off */
export function infoBtn(title, ...paras) {
  if (settings.get('infoButtons') === false) return null;
  const b = h('button', { class: 'infobtn', 'aria-label': `About ${title}`, title: `About ${title}`, onclick: (e) => {
    e.stopPropagation();
    sheet(() => [h('h2', {}, title), ...paras.map((t) => h('p', { class: 'dim', style: { marginTop: '8px' } }, t))], { label: title });
  } });
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v6M12 7.6v.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  return b;
}

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
  const opener = document.activeElement;
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' }, h('div', { class: 'grab', 'aria-hidden': 'true' }));
  const api = { close: () => closeSheet(), el: box };
  const content = build(api);
  if (content) box.append(...[content].flat());
  scrim.addEventListener('click', () => closeSheet());
  document.body.append(scrim, box);
  sheetOpen = { scrim, box, onClose, opener };
  // hide the page behind from screen readers while the sheet is open
  document.getElementById('app')?.setAttribute('aria-hidden', 'true');
  // keyboard: Esc closes, Tab stays inside the sheet
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // drag down to dismiss
  let y0 = null, dy = 0;
  box.addEventListener('touchstart', (e) => { if (box.scrollTop <= 0 && e.target.closest('.grab,h2')) y0 = e.touches[0].clientY; }, { passive: true });
  box.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); box.style.transform = `translateY(${dy}px)`; }, { passive: true });
  box.addEventListener('touchend', () => { if (y0 == null) return; y0 = null; if (dy > 110) closeSheet(); else box.style.transform = ''; dy = 0; });
  setTimeout(() => (box.querySelector('h2') ? (box.querySelector('h2').setAttribute('tabindex', '-1'), box.querySelector('h2')) : box).focus({ preventScroll: true }), 60);
  return api;
}
export function closeSheet(immediate = false) {
  if (!sheetOpen) return;
  const { scrim, box, onClose, opener } = sheetOpen;
  sheetOpen = null;
  document.getElementById('app')?.removeAttribute('aria-hidden');
  try { if (opener && opener.isConnected) opener.focus({ preventScroll: true }); } catch { /* */ }
  if (immediate) { scrim.remove(); box.remove(); } else {
    scrim.classList.add('out'); box.classList.add('out');
    setTimeout(() => { scrim.remove(); box.remove(); }, 260);
  }
  onClose?.();
}
export const isSheetOpen = () => !!sheetOpen;

// screen-reader announcements (polite live region shared by the whole app)
let announcer = null, lastSay = 0;
export function announce(text, { force = false } = {}) {
  if (!force && !settings.get('announce')) return;
  const now = performance.now();
  if (!force && now - lastSay < 900) return;
  lastSay = now;
  if (!announcer) { announcer = h('div', { class: 'sr', 'aria-live': 'polite', role: 'status' }); document.body.append(announcer); }
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = text; }, 30);
}

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
    Haptics = Haptics || native('Haptics');
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
