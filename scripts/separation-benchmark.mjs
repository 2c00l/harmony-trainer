// Same model, same inference settings and inputs: compare the old full-song path
// with bounded chunks. Run alone for meaningful timings (two alternating runs).
import assert from 'node:assert/strict';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { SPLEETER as S,stft,istft,spleeterInput,applySpleeterMask,separateInChunks } from '../www/dsp/separate.mjs';
ort.env.wasm.numThreads=1;
const session=await ort.InferenceSession.create(readFileSync('www/models/vocals.fp16.onnx'),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
// 3 chunks, with the final frame aligned: model inputs must be exactly unchanged.
const length=(1100-1)*S.hop+S.nfft,L=new Float32Array(length),R=new Float32Array(length);
for(let i=0;i<length;i++){
  const t=i/S.sr,f=220*2**([0,3,5,7,3,0,-2,0][Math.floor(t/.8)%8]/12),v=.18*Math.sin(2*Math.PI*f*t+.06*Math.sin(2*Math.PI*5*t));
  L[i]=v+.08*Math.sin(2*Math.PI*130.81*t)+.025*Math.sin(2*Math.PI*1700*t);
  R[i]=v+.09*Math.sin(2*Math.PI*164.81*t)+.02*Math.sin(2*Math.PI*3100*t);
}
async function run(x){const input=new ort.Tensor('float32',x,[2,1,S.split,S.bins]);let outputs;try{outputs=await session.run({x:input});return outputs.y.data.slice();}finally{input.dispose();for(const o of Object.values(outputs||{}))o.dispose();}}
async function legacy(){
  const SL=stft(L,{nfft:S.nfft,hop:S.hop}),SR=stft(R,{nfft:S.nfft,hop:S.hop});
  const out=[SL,SR].map(s=>({re:new Float32Array(s.re.length),im:new Float32Array(s.im.length)}));
  const inputs=[];
  for(let s=0;s<Math.ceil(SL.frames/S.split);s++){const x=spleeterInput(SL,SR,s);inputs.push(x);applySpleeterMask(SL,SR,s,x,await run(x),out);}
  const vl=istft({...SL,...out[0]},length),vr=istft({...SR,...out[1]},length),vocals=vl.map((v,i)=>(v+vr[i])*.5);
  return {vocals,inputs};
}
const times=[],comparisons=[];
try{
  // Warm up the runtime, excluding model compilation from either method.
  await run(new Float32Array(2*S.split*S.bins));
  let reference;
  for(let round=0;round<2;round++){
    const methods=round===0?['legacy','chunked']:['chunked','legacy'];
    for(const method of methods){
      const inputs=[];const started=performance.now();
      const output=method==='legacy'?await legacy():await separateInChunks(L,R,S.sr,async x=>{
        inputs.push(x);
        return run(x);
      });
      const ms=performance.now()-started;times.push({round,method,ms});console.log(method,round,Math.round(ms),'ms');
      if(method==='legacy'){reference=output;continue;}
      inputs.forEach((x,i)=>assert.deepEqual(x,reference.inputs[i],'model input must not change'));
      let power=0,error=0,worst=0;
      for(let i=0;i<length;i++){const d=output.vocals[i]-reference.vocals[i];power+=reference.vocals[i]**2;error+=d*d;worst=Math.max(worst,Math.abs(d));}
      const snr=10*Math.log10(power/error);comparisons.push({snrDb:snr,maxSampleDifference:worst});
      console.log('same-model output comparison',JSON.stringify(comparisons.at(-1)));
      assert.ok(snr>120&&worst<.0001,'roundoff only; no audible quality loss');
    }
  }
  const avg=name=>times.filter(t=>t.method===name).reduce((a,t)=>a+t.ms,0)/2;
  const result={seconds:length/S.sr,times,comparisons,speedupPercent:100*(1-avg('chunked')/avg('legacy')),model:'unchanged Spleeter fp16; wasm single thread; same input tensors'};
  mkdirSync('artifacts/separation',{recursive:true});writeFileSync('artifacts/separation/benchmark.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await session.release();}
