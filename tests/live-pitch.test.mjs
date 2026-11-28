import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePitch } from '../www/audio/live-pitch.mjs';
import { TimelineIndex, lowerBound } from '../www/ui/timeline.mjs';
import { storedSampleRate } from '../www/audio/sample-rate.mjs';

function fixture() {
  const messages = [], results = [];
  let now = 0;
  const worker = { postMessage: message => messages.push(message), terminate() { this.terminated = true; } };
  const options = { windowSize: 2048, minHz: 55, maxHz: 2100, rmsGate: .001 };
  const analysis = new LivePitch({ sampleRate: 48000, options, nowFrame: () => now, onResult: (...r) => results.push(r), createWorker: () => worker });
  return { analysis, messages, worker, results, options, advance: frame => { now = frame; }, reply() { const message = messages.shift(); worker.onmessage({ data: { ...message, result: { hz: 220, clarity: 1, rms: .1 } } }); } };
}

test('slow analysis queues only one job and follows the newest audio, not a backlog', () => {
  const f = fixture();
  for (let block = 0; block < 100; block++) {
    f.advance((block+1)*1024);
    f.analysis.push(block*1024, new Float32Array(1024).fill(block));
    assert.ok(f.messages.length <= 1);
  }
  f.reply();
  assert.equal(f.results.length, 0, 'obsolete worker result was discarded');
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].endFrame, 102400);
  assert.equal(f.messages[0].samples[0], 98);
  assert.equal(f.messages[0].samples[2047], 99);
  f.reply();
  assert.equal(f.results.length, 1);
  assert.equal(f.results[0][1], 102400-1024);
  f.analysis.close();
});

test('capture backlog is drained without analysing stale blocks; no stale result after settings or stop', () => {
  const f = fixture(); f.advance(48000);
  for (let i = 0; i < 30; i++) f.analysis.push(i*1024, new Float32Array(1024));
  assert.equal(f.messages.length, 0);
  f.analysis.push(47000, new Float32Array(2048));
  assert.equal(f.messages.length, 1);
  f.analysis.configure(f.options); f.reply();
  assert.equal(f.results.length, 0);
  f.analysis.push(49048, new Float32Array(2048));
  f.analysis.close(); f.reply();
  assert.equal(f.results.length, 0);
  assert.equal(f.worker.terminated, true);
});

test('live fallback keeps correct low and high pitch at different device sample rates', () => {
  for (const sr of [16000, 22050, 44100, 48000, 96000]) for (const hz of [65.41, 220, 1046.5]) {
    let frame = 0;
    const results = [];
    const pitch = new LivePitch({ sampleRate: sr, options: { windowSize: 2 ** Math.ceil(Math.log2(sr*.04)), minHz: 62, maxHz: 2100 }, nowFrame: () => frame, onResult: r => results.push(r), createWorker: () => { throw new Error('worker unavailable'); } });
    const block = new Float32Array(1024);
    for (; frame < sr; frame += block.length) {
      for (let i = 0; i < block.length; i++) block[i] = .2*Math.sin(2*Math.PI*hz*(frame+i)/sr);
      pitch.push(frame, block);
    }
    assert.ok(results.length <= 26, `${sr}: fallback is rate limited`);
    assert.ok(results.length >= 8);
    for (const r of results) assert.ok(Math.abs(1200*Math.log2(r.hz/hz)) < 10, `${sr}/${hz}: ${r.hz}`);
    pitch.close();
  }
});

test('visible timeline handles overlapping notes and reverse seeks without scanning the song history', () => {
  const notes = [{ start: 0, end: 100, id: 'held' }, { start: 50, end: 51, id: 'short' }, { start: 102, end: 104, id: 'later' }];
  const idx = new TimelineIndex(notes.slice().reverse());
  assert.deepEqual([...idx.between(50,51)].map(n=>n.id), ['held','short']);
  assert.deepEqual([...idx.between(103,104)].map(n=>n.id), ['later']);
  assert.deepEqual([...idx.between(1,2)].map(n=>n.id), ['held']);
  const frames = Array.from({length:36000},(_,i)=>({t:i/100}));
  assert.equal(lowerBound(frames, 270),27000);
  assert.equal(lowerBound(frames, 0),0);
  assert.equal(lowerBound(frames, 999),frames.length);
});

test('old and new recordings keep their duration and pitch after a device sample-rate change', () => {
  assert.equal(storedSampleRate({duration:3},44100*3,48000),44100);
  assert.equal(storedSampleRate({duration:3},48000*3,44100),48000);
  assert.equal(storedSampleRate({sampleRate:22050,duration:3},22050*3,48000),22050);
  assert.equal(storedSampleRate(null,100,48000),48000);
});
