import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync, statSync } from 'node:fs';
const out = resolve('artifacts/flow4');
mkdirSync(out, { recursive: true });
const wav = resolve('artifacts/fake-voice.wav');
const song = resolve('artifacts/test-song.wav');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1.5, permissions: ['microphone'], acceptDownloads: true });
await ctx.addInitScript(() => { if (!localStorage.getItem('ht.settings.v1')) localStorage.setItem('ht.settings.v1', JSON.stringify({ onboarded: true, micOk: true })); });
const page = await ctx.newPage();
const errs = [];
const log = (...a) => console.log(...a);
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.type() + ': ' + m.text()); });

await page.goto('http://localhost:4190/#/');
await page.waitForTimeout(1200);
log('defaults', JSON.stringify(await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ht.settings.v1')); return { zoom: s.zoom, scroll: s.scrollSpeed, barLabels: s.barLabels, v: s._v }; })));
// first import shows the explainer
await page.click('.addbox >> text=Import a song');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/1-explainer.png` });
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.sheet >> text=Choose a song')]);
await chooser.setFiles(song);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/2-importing-live.png` });
log('bar', (await page.locator('.importbar').innerText()).replace(/\n/g, ' | '));
// keep using the app
await page.click('[aria-label=Settings]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/3-importing-settings.png` });
log('app bottom vs bar top', await page.evaluate(() => [Math.round(document.querySelector('#app').getBoundingClientRect().bottom), Math.round(document.querySelector('.importbar').getBoundingClientRect().top)]));
await page.goBack();
const t0 = Date.now();
await page.waitForSelector('.importbar >> text=Open', { timeout: 240000 }).catch(() => {});
log('import took s', Math.round((Date.now() - t0) / 1000), 'bar:', (await page.locator('.importbar').innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: `${out}/4-ready.png` });
await page.click('.importbar >> text=Open');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/5-player.png` });
log('url', page.url(), 'bar gone', await page.locator('.importbar').count() === 0);

// transpose: computed once, saved, reused after reload
await page.click('[aria-label="Transpose up a semitone"]');
await page.click('[aria-label="Transpose up a semitone"]');
await page.waitForTimeout(4000);
const keys1 = await page.evaluate(async () => { const { db } = await import('/core/db.mjs'); const p = await db.getProject(location.hash.split('/').pop()); return p.shiftKeys; });
log('saved shifted keys', JSON.stringify(keys1));
await page.reload();
await page.waitForTimeout(1500);
let t1 = Date.now();
await page.click('[aria-label=Play]');
await page.waitForSelector('[aria-label=Stop]');
log('play after reload ms', Date.now() - t1, 'busy shown', await page.locator('.dock .spinner').count());
await page.waitForTimeout(1200);
await page.click('[aria-label=Stop]');
await page.waitForTimeout(300);
t1 = Date.now();
await page.click('[aria-label=Play]');
await page.waitForSelector('[aria-label=Stop]');
log('second play ms', Date.now() - t1);
await page.waitForTimeout(800);
await page.click('[aria-label=Stop]');

// export
await page.click('[aria-label="Export audio or video"]');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/6-export.png` });
for (const [label, ext] of [['Audio (WAV)', 'wav'], ['Audio (M4A)', 'm4a'], ['Video', 'mp4']]) {
  if (!(await page.locator('.sheet h2:has-text("Export")').count())) { await page.click('[aria-label="Export audio or video"]'); await page.waitForTimeout(400); }
  const t = Date.now();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), page.click(`.sheet .row:has-text("${label}")`)]);
  const f = `${out}/export.${ext}`;
  await dl.saveAs(f);
  log(label, dl.suggestedFilename(), statSync(f).size, 'bytes', Math.round((Date.now() - t) / 1000), 's');
  await page.waitForTimeout(600);
}
log(errs.length ? errs.join('\n') : 'no errors');
await browser.close();
