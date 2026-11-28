// Vocal separation stays off the UI thread and processes one model-sized window at a time.
import { separateInChunks, SPLEETER } from '../dsp/separate.mjs';
self.onmessage = async ({ data: { L,R,sr,model } }) => {
  let session;
  try {
    const ort = await import('../vendor/ort/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = new URL('../vendor/ort/',import.meta.url).href;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    self.postMessage({ progress:.02 });
    session = await ort.InferenceSession.create(model,{ executionProviders:['wasm'],graphOptimizationLevel:'all' });
    const result = await separateInChunks(L,R,sr,async x => {
      const input = new ort.Tensor('float32',x,[2,1,SPLEETER.split,SPLEETER.bins]);
      let outputs;
      try {
        outputs = await session.run({ x:input });
        return outputs.y.data.slice();
      } finally {
        input.dispose();
        for (const tensor of Object.values(outputs || {})) tensor.dispose();
      }
    },k => self.postMessage({ progress:.05+k*.94 }));
    self.postMessage(result,[result.vocals.buffer,result.backing.buffer]);
  } catch (error) { self.postMessage({ error:String(error?.message || error) }); }
  finally { await session?.release(); }
};
