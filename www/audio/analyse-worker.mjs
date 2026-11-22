// Finds the notes in a vocal off the main thread, so the app never locks up while it works.
import { analyseSamples } from '../dsp/analyse.mjs';

self.onmessage = (e) => {
  const { samples, sr, opts } = e.data;
  try { self.postMessage({ res: analyseSamples(samples, sr, opts) }); }
  catch (err) { self.postMessage({ error: String(err?.message || err) }); }
};
