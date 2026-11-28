import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePcm } from '../www/audio/encode.mjs';
test('audio export closes every frame and bounds the codec queue, including cancel and errors',async () => {
  let opened=0,closed=0,peak=0;
  globalThis.AudioData=class { constructor(){opened++;} close(){closed++;} };
  const encoder={encodeQueueSize:0,encode(){this.encodeQueueSize++;peak=Math.max(peak,this.encodeQueueSize);},async flush(){this.encodeQueueSize=0;}};
  const audio=new Float32Array(48000*3);
  assert.equal(await encodePcm(encoder,audio,audio,48000),true);
  assert.equal(opened,closed);assert.ok(peak<=4);
  opened=closed=0;
  assert.equal(await encodePcm(encoder,audio,audio,48000,()=>opened>=4),false);
  assert.equal(opened,closed);
  encoder.encode=()=>{throw new Error('codec failed');};
  await assert.rejects(encodePcm(encoder,audio,audio,48000),/codec failed/);
  assert.equal(opened,closed);
});
