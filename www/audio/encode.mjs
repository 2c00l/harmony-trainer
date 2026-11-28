// Bound native codec buffers and close each AudioData even if encoding fails.
export async function encodePcm(encoder,L,R,sr,isCancelled = () => false,checkError = () => {}) {
  const block = 4096;
  for (let i = 0; i < L.length; i += block) {
    if (isCancelled()) return false;
    checkError();
    const n = Math.min(block,L.length-i), data = new Float32Array(n*2);
    data.set(L.subarray(i,i+n)); data.set(R.subarray(i,i+n),n);
    const frame = new AudioData({ format:'f32-planar',sampleRate:sr,numberOfFrames:n,numberOfChannels:2,timestamp:Math.round(i/sr*1e6),data });
    try { encoder.encode(frame); } finally { frame.close(); }
    // Flush a small batch instead of enqueuing an entire six-minute song.
    if (encoder.encodeQueueSize >= 4 || (i/block)%16 === 15) {
      await encoder.flush();
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  await encoder.flush(); checkError();
  return !isCancelled();
}
