import test from 'node:test';
import assert from 'node:assert/strict';
import {songMix,practiceSettings,loopSamples,PRACTICE_RATES} from '../www/core/practice.mjs';
import {pitchShift} from '../www/dsp/stretch.mjs';
import {createDetector} from '../www/dsp/pitch.mjs';
test('imported and recorded melodies use separate defaults and song mixes remain independent',()=>{
  const defaults={vocalVolume:.35,melodyVolume:1,musicVolume:.5,takeVolume:1.25},get=k=>defaults[k];
  const a={imported:true,mix:{vocalVolume:.2,musicVolume:0}},b={imported:false};
  assert.deepEqual(songMix(a,get),{vocalVolume:.2,musicVolume:0,takeVolume:1.25});
  assert.deepEqual(songMix(b,get),{melodyVolume:1,musicVolume:.5,takeVolume:1.25});
});
test('practice bounds always form a valid section',()=>{
  assert.deepEqual(practiceSettings({a:99,b:-2,rate:0,repeat:true},10),{a:9.5,b:10,rate:1,repeat:true});
  for(const duration of [.2,1,120]){const q=practiceSettings({},duration);assert.ok(q.a>=0&&q.b>q.a&&q.b<=duration);}
});
test('repeat sections align partial takes at every practice speed and fade their edges',()=>{
  for(const rate of PRACTICE_RATES){
    const sr=1000,samples=new Float32Array(4*sr/rate).fill(.5);
    const out=loopSamples(samples,sr,3,{a:2,b:6},rate);
    assert.equal(out.length,Math.round(4*sr/rate));
    assert.equal(out[Math.round(.5*sr/rate)],0);
    assert.equal(out[Math.round(1.5*sr/rate)],.5);
    assert.equal(out[0],0);assert.equal(out.at(-1),0);
    assert.ok(loopSamples(samples,sr,10,{a:2,b:6},rate).every(x=>x===0));
  }
});
test('slower playback preserves pitch, duration and the end of a phrase',()=>{
  for(const sr of [44100,48000])for(const rate of [.5,.75,.9])for(const semis of [0,3]){
    const x=Float32Array.from({length:sr*2},(_,i)=>.2*Math.sin(2*Math.PI*220*i/sr));
    const y=pitchShift(x,sr,semis,rate),want=220*2**(semis/12);
    assert.ok(Math.abs(y.length-x.length/rate)<4);
    const detector=createDetector({sampleRate:sr});
    const detected=detector.detect(y.subarray(sr,sr+2048)).hz;
    assert.ok(Math.abs(1200*Math.log2(detected/want))<8,`${sr}/${rate}/${semis}: ${detected}`);
    const tail=y.subarray(y.length-500);assert.ok(tail.some(v=>Math.abs(v)>.01),'the final window contains audio rather than a truncated silent tail');
  }
});
