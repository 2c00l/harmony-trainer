// Piano-roll renderer (Canvas 2D, DPR-aware, rAF-driven).
import { noteLabel, scalePcs, pc } from '../dsp/theory.mjs';

const BLACK = new Set([1, 3, 6, 8, 10]);

export const REGION_COLORS = {
  third_above: '--c-teal', third_below: '--c-violet', sixth_below: '--c-amber', sixth_above: '--c-amber', fifth_above: '--c-coral',
  fourth_below: '--c-sky', octave_above: '--c-pink', octave_below: '--c-pink', unison: '--c-mint', rest: '--c-muted', custom: '--c-sky',
};

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export class Roll {
  constructor(canvas, opts = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.dpr = 1; this.w = 0; this.h = 0;
    this.s = {
      mode: 'scroll', now: 0, nowX: 0.62, pxPerSec: 110, view: { t0: 0, t1: 8 },
      centerMidi: 60, semis: 14, follow: true, minMidi: 28, maxMidi: 100,
      key: null, labelStyle: 'letter', accidentals: 'auto', leftHanded: false,
      targets: [], lines: [], live: null, regions: [], selection: null, beats: null, loop: null,
      liveNote: null, showRegions: false, playhead: null, dim: 0, gutter: 46, bandH: 0,
      followTarget: null, semisGoal: null, guideCurve: null, emptyHint: '',
      ...opts,
    };
    this.particles = [];
    this.colors = {};
    this.refreshColors();
    this._lastT = performance.now();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas);
    this.resize();
  }
  destroy() { this._ro.disconnect(); }
  /** fixed-size rendering (offscreen video export) */
  setSize(w, h, dpr) {
    this._ro.disconnect();
    this.w = w; this.h = h; this.dpr = dpr;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
  }
  refreshColors() {
    const names = ['--bg', '--roll-bg', '--roll-row', '--roll-row-key', '--roll-line', '--roll-beat', '--roll-bar', '--text', '--text-dim', '--text-faint', '--accent', '--c-teal', '--c-violet', '--c-coral', '--c-amber', '--c-mint', '--c-sky', '--c-pink', '--c-muted', '--g-perfect', '--g-good', '--g-ok', '--g-miss', '--bar-idle', '--bar-edge'];
    for (const n of names) this.colors[n] = cssVar(n) || '#888';
    this.isLight = document.documentElement.dataset.theme === 'light';
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.c.width = Math.round(this.w * this.dpr); this.c.height = Math.round(this.h * this.dpr);
  }
  set(p) { Object.assign(this.s, p); }

  // ---- geometry ----
  get plotX0() { return this.s.leftHanded ? 0 : this.s.gutter; }
  get plotX1() { return this.s.leftHanded ? this.w - this.s.gutter : this.w; }
  get plotY0() { return this.s.bandH; }
  /** visible semitones: the zoom setting is tuned for ~640px of roll; taller rolls show more notes */
  semisVisible() { return this.s.semis * Math.max(1, Math.min(1.8, (this.h - this.plotY0) / 640)); }
  rowH() { return (this.h - this.plotY0) / this.semisVisible(); }
  /** pixels per second: wider screens (tablets, landscape) scroll proportionally faster so a
   * note is as readable as on a phone, instead of squeezing 15 s of song across the screen */
  pps() { return this.s.pxPerSec * Math.max(1, Math.min(2.4, (this.plotX1 - this.plotX0) / 400)); }
  midiToY(m) { return this.plotY0 + (this.h - this.plotY0) / 2 - (m - this.s.centerMidi) * this.rowH(); }
  yToMidi(y) { return this.s.centerMidi - (y - this.plotY0 - (this.h - this.plotY0) / 2) / this.rowH(); }
  timeToX(t) {
    const s = this.s;
    if (s.mode === 'scroll') return this.plotX0 + (this.plotX1 - this.plotX0) * s.nowX + (t - s.now) * this.pps();
    return this.plotX0 + ((t - s.view.t0) / (s.view.t1 - s.view.t0)) * (this.plotX1 - this.plotX0);
  }
  xToTime(x) {
    const s = this.s;
    if (s.mode === 'scroll') return s.now + (x - this.plotX0 - (this.plotX1 - this.plotX0) * s.nowX) / this.pps();
    return s.view.t0 + ((x - this.plotX0) / (this.plotX1 - this.plotX0)) * (s.view.t1 - s.view.t0);
  }
  visibleTime() { return [this.xToTime(this.plotX0), this.xToTime(this.plotX1)]; }

  burst(x, y, color, n = 18) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 120;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.6 + Math.random() * 0.5, age: 0, color, r: 1.2 + Math.random() * 2.2 });
    }
  }

  // ---- follow ----
  // The view follows a *steady* estimate of the voice: the median of the last ~0.4 s of
  // voiced pitch, with a wide dead zone and gentle easing. A brief spike never moves it.
  updateFollow(dt) {
    const s = this.s;
    if (s.semisGoal != null && Math.abs(s.semisGoal - s.semis) > 0.01) s.semis += (s.semisGoal - s.semis) * (1 - Math.exp(-dt * 2.5));
    if (!s.follow) return;
    const tNow = performance.now() / 1000;
    let target = null, dzK = 0.45, speed = 2.2;
    if (s.followTarget != null) { target = s.followTarget; dzK = 0.2; speed = 2.5; }
    else if (s.liveNote != null) {
      const fh = this._fh || (this._fh = []);
      fh.push([tNow, s.liveNote]);
      while (fh.length && fh[0][0] < tNow - 0.4) fh.shift();
      if (fh.length < 8) return; // not enough steady voice yet
      const v = fh.map((x) => x[1]).sort((a, b) => a - b);
      target = v[v.length >> 1];
    } else {
      if (this._fh) this._fh.length = 0;
      if (s.mode === 'scroll' && s.live) return; // live view: hold still during silence
      const [ta, tb] = this.visibleTime();
      const vis = s.targets.filter((n) => n.midi != null && n.end > ta && n.start < tb);
      if (vis.length) { let lo = Infinity, hi = -Infinity; for (const n of vis) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); } target = (lo + hi) / 2; }
    }
    if (target == null) return;
    const half = this.semisVisible() / 2;
    const dz = half * dzK;
    let goal = s.centerMidi;
    if (target > s.centerMidi + dz) goal = target - dz;
    else if (target < s.centerMidi - dz) goal = target + dz;
    goal = Math.max(s.minMidi + half, Math.min(s.maxMidi - half, goal));
    s.centerMidi += (goal - s.centerMidi) * (1 - Math.exp(-dt * speed));
  }

  render(fixedDt = null) {
    const t = performance.now();
    const dt = fixedDt ?? Math.min(0.05, (t - this._lastT) / 1000);
    this._lastT = t;
    this.updateFollow(dt);
    const g = this.g, s = this.s, C = this.colors;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = C['--roll-bg'];
    g.fillRect(0, 0, this.w, this.h);
    const rh = this.rowH();
    const lo = Math.floor(this.yToMidi(this.h)) - 1, hi = Math.ceil(this.yToMidi(this.plotY0)) + 1;
    const pcs = s.key ? new Set(scalePcs(s.key)) : null;
    const x0 = this.plotX0, x1 = this.plotX1;
    // rows
    for (let m = lo; m <= hi; m++) {
      const y = this.midiToY(m) - rh / 2;
      const p = pc(m);
      const inKey = pcs ? pcs.has(p) : !BLACK.has(p);
      if (inKey) { g.fillStyle = C['--roll-row-key']; g.fillRect(x0, y, x1 - x0, rh); }
      else if (BLACK.has(p) || pcs) { g.fillStyle = C['--roll-row']; g.fillRect(x0, y, x1 - x0, rh); }
      if (s.key && p === s.key.root) {
        // the key's home note: a faint accent wash across its row
        g.fillStyle = C['--accent']; g.globalAlpha = 0.07; g.fillRect(x0, y, x1 - x0, rh); g.globalAlpha = 1;
        g.fillStyle = C['--roll-line']; g.fillRect(x0, y + rh - 1, x1 - x0, 1);
      }
      else if (p === 0 && !s.key) { g.fillStyle = C['--roll-line']; g.fillRect(x0, y + rh - 1, x1 - x0, 1); }
    }
    // beats / bars
    if (s.beats?.bpm) {
      const beat = 60 / s.beats.bpm;
      const [ta, tb] = this.visibleTime();
      const off = s.beats.offset || 0;
      for (let k = Math.ceil((ta - off) / beat); off + k * beat <= tb; k++) {
        if (k < 0) continue;
        const x = this.timeToX(off + k * beat);
        const bar = k % s.beats.beatsPerBar === 0;
        g.fillStyle = bar ? C['--roll-bar'] : C['--roll-beat'];
        g.fillRect(Math.round(x), this.plotY0, 1, this.h - this.plotY0);
      }
    }
    // loop shading
    if (s.loop) {
      const xa = this.timeToX(s.loop.a), xb = this.timeToX(s.loop.b);
      g.fillStyle = this.isLight ? 'rgba(80,70,200,0.06)' : 'rgba(139,124,255,0.07)';
      g.fillRect(xa, this.plotY0, xb - xa, this.h);
      g.fillStyle = C['--c-violet'];
      g.fillRect(xa, this.plotY0, 2, this.h); g.fillRect(xb - 2, this.plotY0, 2, this.h);
    }
    // selection
    if (s.selection) {
      const xa = this.timeToX(Math.min(s.selection.start, s.selection.end)), xb = this.timeToX(Math.max(s.selection.start, s.selection.end));
      g.fillStyle = this.isLight ? 'rgba(20,140,120,0.10)' : 'rgba(62,230,193,0.10)';
      g.fillRect(xa, 0, xb - xa, this.h);
      g.strokeStyle = C['--c-teal']; g.lineWidth = 1; g.setLineDash([4, 4]);
      g.strokeRect(xa + 0.5, 0.5, xb - xa - 1, this.h - 1); g.setLineDash([]);
    }
    // guide curve (sirens)
    if (s.guideCurve) this.drawGuideCurve(s.guideCurve);
    // target bars
    this.drawBars(rh);
    // layer lines
    for (const L of s.lines) this.drawLine(L.frames, L.color, L.alpha ?? 0.85, L.width ?? 2.2, false, L.offset || 0);
    // live line
    if (s.live) this.drawLive(s.live);
    // particles
    if (this.particles.length) this.drawParticles(dt);
    // playhead
    const phT = s.playhead ?? (s.mode === 'scroll' ? s.now : null);
    if (phT != null) {
      const x = this.timeToX(phT);
      const grad = g.createLinearGradient(0, 0, 0, this.h);
      grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, this.isLight ? 'rgba(20,20,40,0.35)' : 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(x - 0.75, this.plotY0, 1.5, this.h - this.plotY0);
    }
    // region band
    if (s.bandH > 0) this.drawRegions();
    // gutter labels (on top)
    this.drawGutter(lo, hi, rh, pcs);
    if (s.dim > 0) { g.fillStyle = `rgba(0,0,0,${s.dim})`; g.fillRect(0, 0, this.w, this.h); }
  }

  drawGutter(lo, hi, rh, pcs) {
    const g = this.g, s = this.s, C = this.colors;
    const gx = s.leftHanded ? this.w - s.gutter : 0;
    g.fillStyle = C['--roll-bg'];
    g.globalAlpha = 0.92; g.fillRect(gx, 0, s.gutter, this.h); g.globalAlpha = 1;
    g.fillStyle = C['--roll-line']; g.fillRect(s.leftHanded ? gx : s.gutter - 1, 0, 1, this.h);
    const live = s.liveNote != null ? Math.round(s.liveNote) : null;
    const fs = Math.max(9, Math.min(13, rh * 0.62));
    g.textBaseline = 'middle';
    g.textAlign = s.leftHanded ? 'left' : 'right';
    const tx = s.leftHanded ? gx + 8 : s.gutter - 8;
    for (let m = lo; m <= hi; m++) {
      const y = this.midiToY(m);
      if (y < this.plotY0 + 4 || y > this.h - 4) continue;
      const p = pc(m);
      const inKey = pcs ? pcs.has(p) : !BLACK.has(p);
      const isLive = m === live;
      if (!inKey && !isLive && rh < 22) continue;
      const lbl = noteLabel(m, { style: s.labelStyle, accidentals: s.accidentals, key: s.key, octave: s.labelStyle === 'letter' });
      // with a key chosen, the notes of its scale are marked on the keyboard: a stripe on the
      // inside edge, solid for the home note
      if (s.key && inKey) {
        const root = p === s.key.root;
        g.fillStyle = C['--accent'];
        g.globalAlpha = root ? 0.95 : 0.5;
        const sw = root ? 4 : 3, sh = Math.max(4, rh * 0.7);
        roundRect(g, s.leftHanded ? gx + 1 : s.gutter - sw - 1, y - sh / 2, sw, sh, 1.5); g.fill();
        if (root && !isLive) { roundRect(g, s.leftHanded ? gx + 3 : 3, y - rh * 0.42, s.gutter - 6, rh * 0.84, Math.min(8, rh * 0.4)); g.globalAlpha = 0.14; g.fill(); }
        g.globalAlpha = 1;
      }
      if (isLive) {
        g.fillStyle = C['--accent'];
        const wv = s.gutter - 6;
        roundRect(g, s.leftHanded ? gx + 3 : 3, y - rh * 0.42, wv, rh * 0.84, Math.min(8, rh * 0.4));
        g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
        g.font = `700 ${fs + 1}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        g.fillStyle = C['--accent'];
      } else {
        const root = s.key && p === s.key.root;
        g.font = `${root ? 800 : s.key && inKey ? 650 : 500} ${fs}px system-ui, sans-serif`;
        g.fillStyle = root ? C['--accent'] : s.key ? (inKey ? C['--text'] : C['--text-faint']) : (inKey ? C['--text-dim'] : C['--text-faint']);
      }
      g.fillText(lbl, tx, y + 0.5);
    }
  }

  drawRegions() {
    const g = this.g, s = this.s, C = this.colors;
    g.fillStyle = C['--roll-bg']; g.fillRect(this.plotX0, 0, this.plotX1 - this.plotX0, s.bandH);
    for (const r of s.regions) {
      const xa = Math.max(this.plotX0, this.timeToX(r.start)), xb = Math.min(this.plotX1, this.timeToX(r.end));
      if (xb <= xa) continue;
      const col = C[REGION_COLORS[r.type] || '--c-sky'];
      g.fillStyle = col; g.globalAlpha = r.type === 'rest' ? 0.25 : 0.55;
      roundRect(g, xa + 1, 3, xb - xa - 2, s.bandH - 6, 5); g.fill(); g.globalAlpha = 1;
      if (xb - xa > 46) {
        g.fillStyle = this.isLight ? '#fff' : '#0B0F1A';
        g.font = '600 10px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(r.label || r.type, xa + 7, s.bandH / 2 + 0.5);
      }
    }
  }

  drawBars(rh) {
    const g = this.g, s = this.s, C = this.colors;
    const [ta, tb] = this.visibleTime();
    const bh = Math.max(6, Math.min(rh * 0.72, 30));
    const gradeCol = { perfect: C['--g-perfect'], good: C['--g-good'], ok: C['--g-ok'], miss: C['--g-miss'] };
    for (const n of s.targets) {
      if (n.midi == null || n.end < ta - 0.1 || n.start > tb + 0.1) continue;
      const xa = this.timeToX(n.start), xb = this.timeToX(n.end);
      const y = this.midiToY(n.midi);
      const w = Math.max(bh, xb - xa - 2);
      const r = bh / 2;
      const st = n.st || null;
      const base = n.color || (n.kind === 'base' ? C['--c-violet'] : n.kind === 'ghost' ? C['--c-muted'] : C['--c-teal']);
      // glow for perfect
      if (st && st.glow > 0.05) {
        g.save();
        g.globalCompositeOperation = this.isLight ? 'source-over' : 'lighter';
        g.shadowColor = C['--g-perfect']; g.shadowBlur = 18 * st.glow;
        g.fillStyle = C['--g-perfect']; g.globalAlpha = 0.25 * st.glow;
        roundRect(g, xa + 1, y - bh / 2, w, bh, r); g.fill();
        g.restore();
      }
      // body
      g.globalAlpha = n.kind === 'ghost' ? 0.28 : (n.active ? 0.34 : 0.2);
      g.fillStyle = base;
      roundRect(g, xa + 1, y - bh / 2, w, bh, r); g.fill();
      g.globalAlpha = 1;
      // fill progress
      if (st && st.fill > 0) {
        g.save();
        roundRect(g, xa + 1, y - bh / 2, w, bh, r); g.clip();
        const fc = gradeCol[st.fg || 'good'] || C['--g-good'];
        const grad = g.createLinearGradient(xa, 0, xa + w, 0);
        grad.addColorStop(0, fc); grad.addColorStop(1, fc);
        g.fillStyle = grad; g.globalAlpha = 0.9;
        g.fillRect(xa + 1, y - bh / 2, w * st.fill, bh);
        g.restore();
      }
      // result tint after scoring
      if (n.result) {
        g.globalAlpha = 0.75; g.fillStyle = gradeCol[n.result];
        roundRect(g, xa + 1, y - bh / 2, w, bh, r); g.fill(); g.globalAlpha = 1;
      }
      // edge
      g.lineWidth = n.selected ? 2.5 : 1.25;
      g.strokeStyle = n.selected ? C['--text'] : base;
      g.globalAlpha = n.kind === 'ghost' ? 0.4 : 0.95;
      roundRect(g, xa + 1.5, y - bh / 2 + 0.5, w - 1, bh - 1, r); g.stroke();
      g.globalAlpha = 1;
      if (n.selected) {
        // resize handles
        g.fillStyle = C['--text'];
        roundRect(g, xa - 1, y - bh * 0.35, 4, bh * 0.7, 2); g.fill();
        roundRect(g, xa + w - 1, y - bh * 0.35, 4, bh * 0.7, 2); g.fill();
      }
      if (n.label && w > 34) {
        g.fillStyle = this.isLight ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
        g.font = `600 ${Math.min(12, bh * 0.55)}px system-ui, sans-serif`;
        g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(n.label, xa + r * 0.8 + 2, y + 0.5);
      }
    }
  }

  drawGuideCurve(pts) {
    const g = this.g, C = this.colors;
    g.save();
    g.strokeStyle = C['--c-violet']; g.globalAlpha = 0.55; g.lineWidth = Math.max(8, this.rowH() * 0.55); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    let started = false;
    for (const p of pts) {
      const x = this.timeToX(p.t), y = this.midiToY(p.midi);
      if (x < this.plotX0 - 50 || x > this.plotX1 + 50) { started = false; continue; }
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }

  pathFrames(frames, offset, tMin, tMax) {
    // returns array of polyline segments [[x,y],...] split at gaps
    // Also split where the pitch leaps more than JUMP semitones from one frame to the next: a voice
    // can't really do that, it's the tracker flipping octave (common on separated vocals), and joining
    // the two points drew a tall vertical stroke. Short islands between two such leaps that come back
    // to where they left are dropped (the blip); longer ones stay as their own short line.
    const JUMP = 3;
    const segs = [];
    let cur = null, lastT = -1, lastM = null;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const t = f.t + offset;
      if (t < tMin || t > tMax) { if (t > tMax) break; continue; }
      if (f.midi == null || (lastT >= 0 && t - lastT > 0.06)) { cur = null; lastM = null; if (f.midi == null) { lastT = t; continue; } }
      if (cur && lastM != null && Math.abs(f.midi - lastM) > JUMP) { cur.leapOut = true; cur = null; }
      if (!cur) { cur = []; cur.leapIn = lastM != null; segs.push(cur); }
      cur.push([this.timeToX(t), this.midiToY(f.midi), t, f.midi]);
      lastT = t; lastM = f.midi;
    }
    if (segs.length < 2) return segs;
    const out = [];
    let joinNext = false;
    for (let k = 0; k < segs.length; k++) {
      const sg = segs[k];
      if (sg.leapIn && sg.leapOut) {
        const dur = sg[sg.length - 1][2] - sg[0][2];
        const a = out[out.length - 1], b = segs[k + 1];
        const returns = a && b && Math.abs(a[a.length - 1][3] - b[0][3]) <= JUMP;
        if (dur < 0.03 || (dur < 0.12 && returns)) { joinNext = !!returns; continue; } // blip: drop, and bridge over it
      }
      if (joinNext) { const a = out[out.length - 1]; for (const pt of sg) a.push(pt); a.leapOut = sg.leapOut; }
      else out.push(sg);
      joinNext = false;
    }
    return out;
  }

  strokeSmooth(pts) {
    const g = this.g;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) { g.lineTo(pts[0][0] + 0.1, pts[0][1]); return; }
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const l = pts[pts.length - 1];
    g.lineTo(l[0], l[1]);
  }

  drawLine(frames, color, alpha, width, glow, offset = 0) {
    if (!frames || !frames.length) return;
    const [ta, tb] = this.visibleTime();
    const segs = this.pathFrames(frames, offset, ta - 0.2, tb + 0.2);
    const g = this.g;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = color; g.globalAlpha = alpha; g.lineWidth = width;
    for (const sg of segs) { this.strokeSmooth(sg); g.stroke(); }
    g.restore();
  }

  drawLive(live) {
    const g = this.g, s = this.s, C = this.colors;
    const frames = live.frames;
    if (!frames.length) return;
    const tNow = live.tNow ?? s.now;
    const trail = live.trail ?? 2.2; // seconds of visible trail
    const segs = this.pathFrames(frames, live.offset || 0, tNow - trail, tNow + 0.05);
    const acc = Math.max(0, Math.min(1, live.accuracy ?? 0.5));
    const col = live.color || C['--accent'];
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    const additive = !this.isLight;
    // one stroke per layer; the fade is a horizontal gradient (time maps linearly to x)
    const xs = this.timeToX(tNow - trail), xe = this.timeToX(tNow);
    const grad = (alpha) => {
      const gr = g.createLinearGradient(xs, 0, xe, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.55, col);
      gr.addColorStop(1, col);
      g.globalAlpha = alpha;
      return gr;
    };
    const passes = [[16 + 8 * acc, 0.06 + 0.12 * acc, additive], [7, 0.18 + 0.22 * acc, additive], [3, 1, false]];
    for (const [lw, al, add] of passes) {
      g.globalCompositeOperation = add ? 'lighter' : 'source-over';
      g.strokeStyle = grad(al); g.lineWidth = lw;
      for (const sg of segs) { this.strokeSmooth(sg); g.stroke(); }
    }
    g.globalCompositeOperation = 'source-over';
    // head
    const last = frames[frames.length - 1];
    if (last && last.midi != null && tNow - (last.t + (live.offset || 0)) < 0.12) {
      const x = this.timeToX(last.t + (live.offset || 0)), y = this.midiToY(last.midi);
      g.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      const rg = g.createRadialGradient(x, y, 0, x, y, 18 + 10 * acc);
      rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.45 + 0.35 * acc; g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, 18 + 10 * acc, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1; g.fillStyle = this.isLight ? col : '#fff';
      g.beginPath(); g.arc(x, y, 4.2, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  drawParticles(dt) {
    const g = this.g;
    g.save();
    g.globalCompositeOperation = this.isLight ? 'source-over' : 'lighter';
    this.particles = this.particles.filter((p) => (p.age += dt) < p.life);
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 140 * dt; p.vx *= 0.98;
      const a = 1 - p.age / p.life;
      g.globalAlpha = a; g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, p.r * (0.6 + a * 0.6), 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // ---- hit testing for editing ----
  hitBar(x, y) {
    const rh = this.rowH();
    const bh = Math.max(6, Math.min(rh * 0.72, 30));
    let best = null;
    for (const n of this.s.targets) {
      if (n.midi == null || n.kind === 'ghost') continue;
      const xa = this.timeToX(n.start), xb = this.timeToX(n.end), yc = this.midiToY(n.midi);
      if (x >= xa - 8 && x <= xb + 8 && Math.abs(y - yc) <= Math.max(bh / 2 + 6, 14)) {
        const edge = x < xa + 12 ? 'start' : x > xb - 12 ? 'end' : 'body';
        best = { note: n, edge: (xb - xa) < 30 ? 'body' : edge };
      }
    }
    return best;
  }
}

export function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
