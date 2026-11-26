// Player while playing: the slim dock has stop + timeline + time; dragging the timeline seeks and keeps
// playing; octave blips in the pitch line don't draw vertical strokes. Screens → artifacts/qa/playing-*.png
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts/qa', { recursive: true });
const wav = resolve('artifacts/fake-voice.wav');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
let bad = 0;
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) bad++; };
for (const [name, w, hgt] of [['portrait', 390, 844], ['landscape', 844, 390]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, permissions: ['microphone'] });
  await ctx.addInitScript(() => { const s = JSON.parse(localStorage.getItem('ht.settings.v1') || '{}'); s.onboarded = true; localStorage.setItem('ht.settings.v1', JSON.stringify(s)); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4190/#/'); await page.waitForTimeout(600);
  const id = await page.evaluate(async () => {
    const { newProject, saveNow, packFrames } = await import('/core/project.mjs');
    const { db, uid } = await import('/core/db.mjs');
    const sr = 48000, dur = 20, x = new Float32Array(sr * dur);
    const notes = []; for (let i = 0; i < 18; i++) notes.push([0.5 + i, 1.4 + i, 60 + (i % 5) * 2]);
    for (const [a, b, m] of notes) { const f = 440 * 2 ** ((m - 69) / 12); for (let i = Math.round(a * sr); i < b * sr; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * f * i / sr); }
    const key = uid();
    await db.putAudio(key, x);
    const p = newProject('Playing check');
    const ns = notes.map(([a, b, m]) => ({ id: uid(), start: a, end: b, midi: m, raw: m }));
    // 5 ms frames with octave-error blips (one frame up an octave, a 40 ms excursion down an octave)
    const frames = []; let k = 0;
    for (let t = 0; t < dur; t += 0.005, k++) { const n = notes.find(([a, b]) => t >= a && t < b); let m = n ? n[2] : null; if (m != null && k % 37 === 0) m += 12; if (m != null && k % 150 >= 140) m -= 12; frames.push({ t, midi: m }); }
    p.layers = [{ id: uid(), name: 'Vocal', audioKey: key, frames: packFrames(frames), notes: ns, duration: dur }];
    p.baseLayerId = p.layers[0].id; p.notes = ns; p.key = { root: 0, mode: 'major' }; p.duration = dur;
    await saveNow(p);
    return p.id;
  });
  await page.goto(`http://localhost:4190/#/project/${id}`);
  await page.waitForTimeout(1500);
  await page.click('.dock button[aria-label="Play"]');
  await page.waitForTimeout(1200);
  const slider = page.locator('.dock.compact input.pos');
  check(await slider.isVisible(), `${name}: timeline visible while playing`);
  check(await page.locator('.dock.compact button[aria-label="Stop"]').isVisible(), `${name}: stop visible`);
  const box = await slider.boundingBox();
  check(box && box.width > 120, `${name}: timeline is usable width (${Math.round(box?.width)} px)`);
  await page.screenshot({ path: `artifacts/qa/playing-${name}.png` });
  // drag to ~70%
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.querySelector('.dock .mono')?.textContent);
  const stillPlaying = await page.locator('.dock.compact button[aria-label="Stop"]').isVisible();
  check(stillPlaying, `${name}: still playing after seeking`);
  const sec = Number((after || '').split('/')[0].trim().split(':').reduce((a, b) => a * 60 + Number(b), 0));
  check(sec >= 11, `${name}: seeked to ${after}`);
  await page.screenshot({ path: `artifacts/qa/playing-${name}-seek.png` });
  check(!errs.length, `${name}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} failed` : 'all ok');
process.exit(bad ? 1 : 0);
