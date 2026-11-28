// Transposes audio off the main thread: WSOLA time-stretch then resample (tempo unchanged).
import { pitchShift } from '../dsp/stretch.mjs';

self.onmessage = (e) => {
  const { samples, sr, semis, rate=1 } = e.data;
  try {
    const out = Float32Array.from(pitchShift(samples, sr, semis, rate));
    self.postMessage({ out }, [out.buffer]);
  } catch (err) { self.postMessage({ error: String(err?.message || err) }); }
};
