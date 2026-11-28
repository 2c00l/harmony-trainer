// Reproducible constrained-CPU comparison, including a seek near the end of a long song.
// CPU throttling is a stress test, not a substitute for testing a physical Galaxy A13.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const cpu = Number(process.env.CPU || 6), label = process.env.LABEL || 'current';
const seconds = Number(process.env.SECONDS || 8);
mkdirSync('artifacts/performance', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve('artifacts/fake-voice.wav')}`, '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, permissions: ['microphone'] });
await context.addInitScript(() => { if (!localStorage.getItem('ht.settings.v1')) localStorage.setItem('ht.settings.v1', JSON.stringify({ onboarded: true, micOk: true })); });
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
await page.goto('http://localhost:4190/#/');
await page.waitForFunction(() => window.__htSV?.live.length > 20);

async function measure(name) {
  await page.evaluate(async () => {
    const E = await import('/audio/engine.mjs');
    const sv = window.__htSV, render = sv.roll.render.bind(sv.roll);
    const state = window.__perf = { renders: [], gaps: [], pitch: [], longTasks: [], started: performance.now() };
    let last = performance.now();
    sv.roll.render = (...args) => { const start = performance.now(); state.gaps.push(start - last); last = start; render(...args); state.renders.push(performance.now() - start); };
    state.unsub = E.onPitch(f => state.pitch.push({ arrival: performance.now(), time: f.t, lag: E.now() - f.t, midi: f.midi }));
    state.observer = new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(e => e.duration)));
    state.observer.observe({ type: 'longtask' });
    state.restore = () => { sv.roll.render = render; state.unsub(); state.observer.disconnect(); };
  });
  const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  await page.waitForTimeout(seconds * 1000);
  const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const data = await page.evaluate(() => {
    const p = window.__perf; p.restore();
    const percentile = (values, q) => { const a = values.slice().sort((a,b) => a-b); return a.length ? a[Math.floor((a.length-1)*q)] : 0; };
    const elapsed = (performance.now() - p.started) / 1000;
    return { elapsed, fps: p.renders.length / elapsed, pitchHz: p.pitch.length / elapsed, voiced: p.pitch.filter(f => f.midi != null).length,
      renderMsP95: percentile(p.renders, .95), frameGapMsP95: percentile(p.gaps, .95), frameGapMsMax: Math.max(...p.gaps),
      pitchLagMsP95: 1000 * percentile(p.pitch.map(f => f.lag), .95), longTasks: p.longTasks.length, longTaskMs: p.longTasks.reduce((a,b) => a+b,0),
      canvasPixels: window.__htSV.canvas.width * window.__htSV.canvas.height, economy:window.__htSV.slowDisplay, renderCost:window.__htSV.renderCost };
  });
  const result = { name, cpuSlowdown: cpu, ...data, mainThreadBusyPercent: 100 * (after.TaskDuration - before.TaskDuration) / data.elapsed };
  results.push(result); console.log(JSON.stringify(result));
}

try {
  await measure('live');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const id = await page.evaluate(async () => {
    const { newProject, saveNow, packFrames } = await import('/core/project.mjs');
    const { db, uid } = await import('/core/db.mjs');
    const E = await import('/audio/engine.mjs'); E.stopMic();
    const sr = E.sampleRate(), dur = 300, audio = new Float32Array(sr * dur);
    for (let i = 0; i < audio.length; i++) audio[i] = .12 * Math.sin(2 * Math.PI * 220 * i / sr);
    const key = uid(); await db.putAudio(key, audio);
    const p = newProject('Five-minute performance check'), notes = [], frames = [];
    for (let t = 0; t < dur; t += .4) notes.push({ id: uid(), start: t, end: t+.35, midi: 60+(Math.floor(t)%12), raw: 60+(Math.floor(t)%12) });
    for (let t = 0; t < dur; t += .01) frames.push({ t, midi: 60+(Math.floor(t)%12)+.1*Math.sin(t*20) });
    p.layers = [{ id: uid(), audioKey: key, duration: dur, notes, frames: packFrames(frames) }];
    p.baseLayerId = p.layers[0].id; p.notes = notes; p.duration = dur; p.key = { root: 0, mode: 'major' };
    await saveNow(p); return p.id;
  });
  await page.goto(`http://localhost:4190/#/project/${id}`);
  await page.locator('.dock input.pos').evaluate(el => { el.value = '270'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await measure('long-song-near-end');
  await page.screenshot({ path: `artifacts/performance/${label}-song.png` });
  const output = { label, checkedAt: new Date().toISOString(), results, errors };
  writeFileSync(`artifacts/performance/${label}.json`, JSON.stringify(output,null,2)+'\n');
  if (errors.length || results.some(r => r.voiced < 5)) throw new Error(JSON.stringify(output));
} finally { await browser.close(); }
