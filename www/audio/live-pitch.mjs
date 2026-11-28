import { createDetector } from '../dsp/pitch.mjs';

// One analysis in flight, always using the newest complete window. Audio capture and
// recording remain lossless; only obsolete visual analyses are skipped under load.
export class LivePitch {
  constructor({ sampleRate, options, onResult, nowFrame, createWorker = () => new Worker(new URL('./live-pitch-worker.mjs', import.meta.url), { type: 'module' }) }) {
    this.sampleRate = sampleRate;
    this.onResult = onResult;
    this.nowFrame = nowFrame;
    this.closed = false;
    this.busy = false;
    this.revision = 0;
    this.endFrame = 0;
    this.sentFrame = -Infinity;
    try {
      this.worker = createWorker();
      this.worker.onmessage = ({ data }) => {
        if (this.closed) return;
        this.busy = false;
        if (data.samples?.length === this.ring.length) this.scratch = data.samples;
        if (data.error) this.fallback();
        else if (data.revision === this.revision && this.fresh(data.endFrame)) this.onResult(data.result, data.endFrame - this.ring.length / 2);
        this.pump();
      };
      this.worker.onerror = e => { e.preventDefault?.(); this.fallback(); this.pump(); };
    } catch { this.worker = null; }
    this.configure(options);
  }
  configure(options) {
    this.options = { ...options, sampleRate: this.sampleRate };
    this.revision++;
    this.ring = new Float32Array(options.windowSize);
    this.scratch = null;
    this.fill = this.write = 0;
    this.sentFrame = -Infinity;
    this.detector = null;
  }
  fresh(endFrame) { return !this.nowFrame || this.nowFrame() - endFrame < this.sampleRate * .15; }
  fallback() {
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
  }
  push(frame, samples) {
    if (this.closed) return;
    const size = this.ring.length;
    if (this.fill && frame !== this.endFrame) this.fill = this.write = 0;
    this.endFrame = frame + samples.length;
    if (samples.length >= size) {
      this.ring.set(samples.subarray(samples.length - size));
      this.write = 0; this.fill = size;
    } else {
      const first = Math.min(samples.length, size - this.write);
      this.ring.set(samples.subarray(0, first), this.write);
      if (first < samples.length) this.ring.set(samples.subarray(first), 0);
      this.write = (this.write + samples.length) % size;
      this.fill = Math.min(size, this.fill + samples.length);
    }
    this.pump();
  }
  pump() {
    // 47–50 Hz is plenty for the voice display. The fallback is capped at 25 Hz.
    const hop = this.sampleRate / (this.worker ? 50 : 25);
    if (this.closed || this.busy || this.fill < this.ring.length || this.endFrame - this.sentFrame < hop || !this.fresh(this.endFrame)) return;
    const samples = this.scratch || new Float32Array(this.ring.length);
    const tail = this.ring.length - this.write;
    samples.set(this.ring.subarray(this.write), 0);
    if (this.write) samples.set(this.ring.subarray(0, this.write), tail);
    this.sentFrame = this.endFrame;
    if (this.worker) {
      this.busy = true; this.scratch = null;
      this.worker.postMessage({ samples, options: this.options, revision: this.revision, endFrame: this.endFrame }, [samples.buffer]);
    } else {
      this.detector ||= createDetector(this.options);
      this.onResult(this.detector.detect(samples), this.endFrame - this.ring.length / 2);
      this.scratch = samples;
    }
  }
  close() {
    this.closed = true;
    this.worker?.terminate();
    this.worker = this.detector = this.scratch = null;
  }
}
