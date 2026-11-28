// AudioWorklet: forwards mono mic blocks with their context frame stamp.
// Batches 8 render quanta (1024 samples) per message; no DSP on the audio thread.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1024;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.startFrame = 0;
    this.port.onmessage = (e) => { if (e.data === 'flush') this.flush(); };
  }
  flush() {
    if (!this.n) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ frame: this.startFrame, data: out }, [out.buffer]);
    this.n = 0;
  }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const ch0 = inp[0];
    const ch1 = inp.length > 1 ? inp[1] : null;
    if (this.n === 0) this.startFrame = currentFrame;
    for (let i = 0; i < ch0.length; i++) {
      this.buf[this.n++] = ch1 ? 0.5 * (ch0[i] + ch1[i]) : ch0[i];
      if (this.n === this.size) {
        const out = this.buf;
        this.port.postMessage({ frame: this.startFrame, data: out }, [out.buffer]);
        this.buf = new Float32Array(this.size);
        this.n = 0;
        this.startFrame = currentFrame + i + 1;
      }
    }
    return true;
  }
}
registerProcessor('ht-capture', CaptureProcessor);
