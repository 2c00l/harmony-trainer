// Recording flows: record a melody, record it again, start a fresh song, sing along past the end.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const out = resolve('artifacts/flow5');
mkdirSync(out, { recursive: true });
const wav = resolve('artifacts/fake-voice.wav');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1.5, permissions: ['microphone'] });
await ctx.addInitScript(() => { if (!localStorage.getItem('ht.settings.v1')) localStorage.setItem('ht.settings.v1', JSON.stringify({ onboarded: true, micOk: true })); });
const page = await ctx.newPage();
const errs = [];
const log = (...a) => console.log(...a);
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const proj = () => page.evaluate(async () => { const { db } = await import('/core/db.mjs'); const id = location.hash.split('/').pop(); const p = await db.getProject(id); return p ? { id, notes: p.notes.length, dur: Math.round(p.duration * 10) / 10, audio: p.layers[0]?.audioKey, takes: p.takes?.length || 0 } : { id }; });
const record = async (sec) => { await page.click('[aria-label=Record]'); await page.waitForTimeout(sec * 1000); await page.click('[aria-label="Stop recording"]'); await page.waitForTimeout(2500); };

await page.goto('http://localhost:4190/#/');
await page.waitForTimeout(1200);
await page.click('text=Record my voice');
await page.waitForTimeout(1000);
await record(6);
log('toast', await page.locator('.toast').innerText().catch(() => ''));
const a = await proj();
log('first recording', JSON.stringify(a));

// record the melody again
await page.click('text=Record the melody again');
await page.waitForTimeout(400);
await page.click('.sheet button:has-text("Record again")');
await page.waitForTimeout(1000);
log('in record mode', await page.locator('[aria-label=Record]').count(), 'cancel offered', await page.locator('text=Cancel, keep the old recording').count());
await page.screenshot({ path: `${out}/1-redo.png` });
await record(4);
const b = await proj();
log('after redo', JSON.stringify(b), 'same song', a.id === b.id, 'new audio', a.audio !== b.audio);
const oldGone = await page.evaluate(async (k) => { const { db } = await import('/core/db.mjs'); return !(await db.getAudio(k)); }, a.audio);
log('old audio deleted', oldGone);

// a brand-new song from Live starts empty
await page.click('[aria-label=Back]');
await page.waitForTimeout(800);
await page.click('text=Record my voice');
await page.waitForTimeout(1000);
log('fresh recorder', page.url(), 'record button', await page.locator('[aria-label=Record]').count(), 'notes drawn', await page.evaluate(() => window.__htSV.roll.s.targets.length));
await page.screenshot({ path: `${out}/2-fresh.png` });
await record(5);
log('second song', JSON.stringify(await proj()));

// sing along past the end, with the setting on
await page.evaluate(() => import('/core/settings.mjs').then((m) => m.settings.set('recordPastEnd', true)));
await page.click('[aria-label="Sing along and record"]');
await page.waitForTimeout(9000);
log('still recording past the end', await page.locator('.recdot').count());
await page.screenshot({ path: `${out}/3-past-end.png` });
await page.click('[aria-label="Stop and save the take"]');
await page.waitForTimeout(1500);
const takes = await page.evaluate(async () => { const { db } = await import('/core/db.mjs'); const p = await db.getProject(location.hash.split('/').pop()); return { dur: p.duration, take: p.takes.map((t) => ({ at: t.at, d: Math.round(t.duration * 10) / 10 })) }; });
log('take', JSON.stringify(takes));
log('slider max now covers the take', await page.locator('input.pos').getAttribute('max'));
// with the setting off it stops at the end
await page.evaluate(() => import('/core/settings.mjs').then((m) => m.settings.set('recordPastEnd', false)));
await page.click('[aria-label="Sing along and record"]');
await page.waitForTimeout(9000);
log('setting off, stopped by itself', await page.locator('.recdot').count() === 0);
log(errs.length ? errs.join('\n') : 'no errors');
await browser.close();
