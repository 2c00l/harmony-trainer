// Decorative animated art: two harmonising glowing curves over capsule bars.
import { prefersReducedMotion } from '../core/settings.mjs';

export function heroArt({ bars = true, intensity = 1 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'deco';
  canvas.setAttribute('aria-hidden', 'true');
  const g = canvas.getContext('2d');
  let alive = true, w = 0, hh = 0, dpr = 1;
  const ro = new ResizeObserver(() => { const r = canvas.getBoundingClientRect(); dpr = Math.min(2.5, devicePixelRatio || 1); w = r.width; hh = r.height; canvas.width = w * dpr; canvas.height = hh * dpr; });
  ro.observe(canvas);
  const reduce = prefersReducedMotion();
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const t0 = performance.now();
  function curve(t, phase, base) {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const x = i / 60;
      const y = base + 0.11 * Math.sin(x * 5.2 + t * 0.6 + phase) + 0.05 * Math.sin(x * 11 + t * 0.9 + phase * 2);
      pts.push([x * w, y * hh]);
    }
    return pts;
  }
  function stroke(pts, col, wide) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
    g.strokeStyle = col;
    g.globalAlpha = 0.12 * intensity; g.lineWidth = wide * 4; g.stroke();
    g.globalAlpha = 0.3 * intensity; g.lineWidth = wide * 1.8; g.stroke();
    g.globalAlpha = 0.95; g.lineWidth = wide * 0.7; g.stroke();
  }
  function frame() {
    if (!alive) return;
    const t = reduce ? 2 : (performance.now() - t0) / 1000;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const teal = css('--c-teal'), violet = css('--c-violet');
    const light = document.documentElement.dataset.theme === 'light';
    if (bars) {
      g.globalAlpha = light ? 0.16 : 0.13;
      const bw = w / 9;
      for (let i = 0; i < 10; i++) {
        const x = ((i * bw * 1.3 - t * 18) % (w + bw * 2)) - bw;
        const y = hh * (0.06 + 0.06 * ((i * 7) % 5));
        g.fillStyle = i % 2 ? violet : teal;
        const r = 7; const bh = 14;
        g.beginPath(); g.roundRect ? g.roundRect(x, y, bw, bh, r) : g.rect(x, y, bw, bh); g.fill();
      }
    }
    g.globalCompositeOperation = light ? 'source-over' : 'lighter';
    g.lineCap = 'round';
    stroke(curve(t, 0, 0.2), teal, 3);
    stroke(curve(t, 0.35, 0.33), violet, 3);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { canvas, stop() { alive = false; ro.disconnect(); } };
}
