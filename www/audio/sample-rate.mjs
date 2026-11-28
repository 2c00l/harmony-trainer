// Old projects did not store a rate. Their exact PCM length and duration let us
// recover it instead of replaying 44.1 kHz audio at a later 48 kHz device rate.
export function storedSampleRate(meta, length, fallback) {
  if (Number.isFinite(meta?.sampleRate) && meta.sampleRate >= 8000 && meta.sampleRate <= 192000) return meta.sampleRate;
  if (meta?.duration > 0) {
    const estimate = length/meta.duration;
    const rates = [8000,11025,12000,16000,22050,24000,32000,44100,48000,88200,96000,176400,192000];
    const closest = rates.reduce((a,b) => Math.abs(b-estimate) < Math.abs(a-estimate) ? b : a);
    if (Math.abs(closest-estimate)/closest < .01) return closest;
  }
  return fallback;
}
