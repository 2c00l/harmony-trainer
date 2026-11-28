export const PRACTICE_RATES = [.5,.75,.9,1];
export function songMix(project, get) {
  const lead = project.imported ? 'vocalVolume' : 'melodyVolume';
  return Object.fromEntries([lead,'musicVolume','takeVolume'].map(k=>[k,Number.isFinite(project.mix?.[k])?project.mix[k]:get(k)]));
}
export function practiceSettings(value, duration) {
  const end = Math.max(.1,Number.isFinite(duration)?duration:.1), gap=Math.min(.5,end);
  const a=Math.max(0,Math.min(end-gap,Number(value?.a)||0));
  const b=Math.max(a+gap,Math.min(end,Number(value?.b)||Math.min(end,a+10)));
  return {rate:PRACTICE_RATES.includes(value?.rate)?value.rate:1,repeat:!!value?.repeat,a,b};
}

// Crop/pad each layer to the same musical section, including takes that start
// part way through it. A short edge fade prevents clicks at the repeat boundary.
export function loopSamples(samples,sampleRate,at,loop,rate) {
  const out=new Float32Array(Math.max(1,Math.round((loop.b-loop.a)/rate*sampleRate)));
  const offset=Math.round((loop.a-at)/rate*sampleRate),src=Math.max(0,offset),dst=Math.max(0,-offset);
  const count=Math.max(0,Math.min(samples.length-src,out.length-dst));
  if(count)out.set(samples.subarray(src,src+count),dst);
  const fade=Math.min(Math.round(sampleRate*.005),Math.floor(out.length/2));
  for(let i=0;i<fade;i++){const gain=i/fade;out[i]*=gain;out[out.length-1-i]*=gain;}
  return out;
}
