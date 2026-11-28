import { createDetector } from '../dsp/pitch.mjs';
let detector, revision;
self.onmessage = ({ data }) => {
  const { samples, options, endFrame } = data;
  try {
    if (!detector || revision !== data.revision) { detector = createDetector(options); revision = data.revision; }
    const result = detector.detect(samples);
    self.postMessage({ result, samples, revision, endFrame }, [samples.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error), samples }, [samples.buffer]);
  }
};
