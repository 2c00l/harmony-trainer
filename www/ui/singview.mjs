// SingView: a stage (roll canvas + HUD) bound to the live mic pitch stream,
// an optional playback transport and optional live scoring against targets.
import { Roll } from './roll.mjs';
import { h, haptic, fmtCents } from './ui.mjs';
import * as E from '../audio/engine.mjs';
import { settings, scoringOpts, prefersReducedMotion } from '../core/settings.mjs';
import { createLiveScorer, centsErr } from '../dsp/score.mjs';
import { noteLabel } from '../dsp/theory.mjs';
import { midiToFreq } from '../dsp/pitch.mjs';

export class SingView {
  constructor({ roll = {}, hud = true, onFrame = null, accuracyMode = 'semitone' } = {}) {
    this.el = h('div', { class: 'stage' });
    this.canvas = h('canvas', { class: 'roll', role: 'img', 'aria-label': 'Piano roll showing your pitch' });
    this.el.append(this.canvas);
    this.hudEl = null;
    if (hud) {
      this.noteEl = h('div', { class: 'bignote off', 'aria-live': 'off' }, '—');
      this.meterI = h('i');
      this.centsEl = h('span', {}, '');
      this.hzEl = h('div', { class: 'hz' }, '');
      this.hudEl = h('div', { class: 'hud' }, this.noteEl, settings.get('showCents') ? h('div', { class: 'cents' }, h('div', { class: 'meter', 'aria-hidden': 'true' }, this.meterI), this.centsEl) : null, this.hzEl);
      this.el.append(this.hudEl);
      // screen-reader friendly, throttled note announcements
      this.srEl = h('div', { class: 'sr', 'aria-live': 'polite' });
      this.el.append(this.srEl);
    }
    this.countEl = h('div', { class: 'countin', 'aria-live': 'assertive' });
    this.el.append(this.countEl);
    const s = settings.all();
    this.roll = new Roll(this.canvas, { semis: s.zoom, pxPerSec: 110 * s.scrollSpeed, labelStyle: s.labels, accidentals: s.accidentals, leftHanded: s.leftHanded, ...roll });
    this.live = []; // musical-time frames for drawing
    this.taken = []; // frames captured during the transport (for scoring/recording analysis)
    this.transport = null;
    this.scorer = null;
    this.targets = [];
    this.onFrame = onFrame;
    this.accuracyMode = accuracyMode;
    this.reduce = prefersReducedMotion();
    this.alive = true;
    this.lastAnnounce = 0;
    this.curNote = null; this.curCents = 0; this.accuracy = 0.5;
    this.unsub = E.onPitch((f) => this.onPitch(f));
    this.unsubSettings = settings.on((k) => this.applySettings(k));
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }
  applySettings() {
    const s = settings.all();
    this.roll.set({ semis: s.zoom, pxPerSec: 110 * s.scrollSpeed, labelStyle: s.labels, accidentals: s.accidentals, leftHanded: s.leftHanded });
    this.roll.refreshColors();
    this.reduce = prefersReducedMotion();
  }
  destroy() { this.alive = false; this.unsub(); this.unsubSettings(); this.roll.destroy(); this.stopTransport(); }

  setTargets(targets, { live = false, onPerfect } = {}) {
    this.targets = targets;
    this.roll.set({ targets });
    this.scorer = live ? createLiveScorer(targets.filter((t) => t.midi != null && t.kind !== 'ghost'), { ...scoringOpts(), onPerfect: (i) => this.perfect(i, onPerfect) }) : null;
    if (this.scorer) {
      const scored = targets.filter((t) => t.midi != null && t.kind !== 'ghost');
      scored.forEach((t, i) => { t.st = this.scorer.state[i]; });
      this._scored = scored;
    }
  }
  perfect(i, cb) {
    const n = this._scored[i];
    if (!n) return;
    if (settings.get('particles') && !this.reduce) {
      const x = this.roll.timeToX(Math.min(this.roll.s.now, n.end)), y = this.roll.midiToY(n.midi);
      this.roll.burst(x, y, this.roll.colors['--g-perfect']);
    }
    haptic('light');
    cb?.(n);
  }

  /** attach a playback transport: musical time = transport time */
  startTransport(T, { record = true } = {}) {
    this.transport = T;
    this.taken = [];
    this.recordFrames = record;
    this.latency = E.roundTripLatency();
    this.live = [];
    this.scorer?.reset();
  }
  stopTransport() { if (this.transport) { this.transport.stop?.(); this.transport = null; } }

  musicalNow() {
    if (this.transport) return this.transport.heard();
    return E.now() - 0.03;
  }

  onPitch(f) {
    let t;
    if (this.transport) t = this.transport.toMusical(f.t - this.latency);
    else t = f.t;
    const show = settings.get('confidentOnly') ? f.midi : (f.midi ?? f.held);
    const fr = { t, midi: show, clarity: f.clarity, rms: f.rms };
    // loop wrap: drop the trail when time jumps backwards
    if (this.live.length && t < this.live[this.live.length - 1].t - 0.2) this.live = [];
    this.live.push(fr);
    if (this.live.length > 1200) this.live.splice(0, this.live.length - 900);
    if (this.transport && this.recordFrames && (!this.transport.countInRemaining || this.transport.countInRemaining() <= 0)) this.taken.push({ t, midi: f.midi, clarity: f.clarity });
    let res = null;
    if (this.scorer && this.transport) res = this.scorer.update(t, f.midi);
    this.updateReadout(f, res);
    this.onFrame?.(fr, f, res);
  }

  updateReadout(f, res) {
    const m = f.midi;
    if (m == null) {
      this.curNote = null;
      this.accuracy *= 0.9;
      if (this.noteEl) { this.noteEl.classList.add('off'); }
      return;
    }
    let target = Math.round(m), cents;
    if (res && res.activeIdx >= 0 && res.cents != null) { target = this._scored[res.activeIdx].midi; cents = res.cents; }
    else cents = (m - Math.round(m)) * 100;
    this.curNote = m; this.curCents = cents;
    const acc = Math.max(0, 1 - Math.abs(cents) / 50);
    this.accuracy += (acc - this.accuracy) * 0.25;
    if (!this.noteEl) return;
    const lbl = noteLabel(Math.round(m), { style: settings.get('labels'), accidentals: settings.get('accidentals'), key: this.roll.s.key });
    this.noteEl.textContent = lbl;
    this.noteEl.classList.remove('off');
    const col = Math.abs(cents) <= 15 ? 'var(--g-perfect)' : Math.abs(cents) <= 35 ? 'var(--g-good)' : Math.abs(cents) <= 50 ? 'var(--g-ok)' : 'var(--g-miss)';
    this.noteEl.style.color = col;
    if (this.meterI) {
      this.meterI.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
      this.meterI.style.background = col;
      this.centsEl.textContent = fmtCents(cents);
    }
    if (this.hzEl) this.hzEl.textContent = `${f.hz ? f.hz.toFixed(1) : midiToFreq(m, settings.get('a4')).toFixed(1)} Hz`;
    const nowMs = performance.now();
    if (this.srEl && nowMs - this.lastAnnounce > 2500) { this.lastAnnounce = nowMs; this.srEl.textContent = `${lbl}, ${Math.abs(Math.round(cents))} cents ${cents > 0 ? 'sharp' : cents < 0 ? 'flat' : ''}`; }
  }

  showCount(n) {
    this.countEl.innerHTML = '';
    if (n) this.countEl.append(h('b', { key: String(Math.random()) }, String(n)));
  }

  loop() {
    if (!this.alive) return;
    const now = this.musicalNow();
    if (this.transport?.countInRemaining) {
      const rem = this.transport.countInRemaining();
      const beatDur = this.transport.beatDur || 0.5;
      const n = rem > 0.02 ? Math.ceil(rem / beatDur) : 0;
      if (n !== this._lastCount) { this._lastCount = n; this.showCount(n); }
    }
    const showLive = this.showLive !== false;
    this.roll.set({ now, liveNote: showLive ? this.curNote : null, live: showLive ? { frames: this.live, tNow: now, accuracy: this.accuracy, color: this.liveColor || null } : null });
    this.roll.render();
    requestAnimationFrame(this.loop);
  }
}

/** accuracy helper exposed for screens */
export { centsErr };
