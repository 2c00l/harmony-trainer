// Every "I changed my mind" path: the app must give control back straight away.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const wav = resolve('artifacts/fake-voice.wav');
const song = resolve('artifacts/test-song.wav');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ['microphone'] });
await ctx.addInitScript(() => { if (!localStorage.getItem('ht.settings.v1')) localStorage.setItem('ht.settings.v1', JSON.stringify({ onboarded: true, micOk: true, importExplained: true })); });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CORS') && !m.text().includes('ERR_FAILED')) errs.push(m.text()); });
const ok = (name, pass, info = '') => console.log(pass ? 'PASS' : 'FAIL', name, info);
// how long the main thread is blocked: the longest gap between animation frames
const startJank = () => page.evaluate(() => { window.__jank = 0; let last = performance.now(); const f = (t) => { window.__jank = Math.max(window.__jank, t - last); last = t; if (window.__jankOn) requestAnimationFrame(f); }; window.__jankOn = true; requestAnimationFrame(f); });
const stopJank = () => page.evaluate(() => { window.__jankOn = false; return Math.round(window.__jank); });

await page.goto('http://localhost:4190/#/');
await page.waitForTimeout(1000);
// a long-ish recorded song
await page.click('text=Record my voice');
await page.waitForTimeout(900);
await page.click('[aria-label=Record]');
await page.waitForTimeout(20000);
await startJank();
await page.click('[aria-label="Stop recording"]');
await page.waitForSelector('[aria-label=Play]', { timeout: 30000 });
ok('finding notes did not freeze the screen', (await stopJank()) < 400, `longest frame gap ${await page.evaluate(() => Math.round(window.__jank))} ms`);
const songUrl = page.url();

// floating back while playing
await page.click('[aria-label=Play]');
await page.waitForTimeout(800);
ok('back button visible while playing', await page.locator('.screen.immersive .topbar [aria-label=Back]').isVisible());
await page.click('.screen.immersive .topbar [aria-label=Back]');
await page.waitForTimeout(800);
ok('back while playing leaves the song', !page.url().includes('/project/'), page.url());
await page.goto(songUrl); await page.waitForTimeout(900);

// cancel while transposing
await page.click('[aria-label="Transpose up a semitone"]');
await page.click('[aria-label=Play]');
const busy = await page.locator('.dock button:has-text("Cancel")').count();
if (busy) {
  await page.click('.dock button:has-text("Cancel")');
  await page.waitForTimeout(300);
  ok('cancel transposing gives the controls back', await page.locator('[aria-label=Play]').isVisible());
  await page.waitForTimeout(1500);
  ok('cancelled play does not start later', !(await page.locator('[aria-label=Stop]').count()));
} else ok('transposing was instant (no cancel needed)', await page.locator('[aria-label=Stop]').count() > 0);
await page.click('[aria-label=Stop]').catch(() => {});

// Escape (= Android back) while transposing
await page.click('[aria-label="Transpose up a semitone"]');
await page.click('[aria-label=Play]');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok('back while transposing cancels, stays on the song', page.url().includes('/project/') && await page.locator('[aria-label=Play]').isVisible());

// find the notes again → cancel
await page.click('[aria-label^="More"]'); await page.waitForTimeout(300);
await page.click('.sheet >> text=Find the notes again');
await page.waitForTimeout(100);
const c2 = await page.locator('.dock button:has-text("Cancel")').count();
if (c2) { await page.click('.dock button:has-text("Cancel")'); await page.waitForTimeout(300); }
ok('find notes again is cancellable / quick', await page.locator('[aria-label=Play]').isVisible());

// import → cancel
await page.goto('http://localhost:4190/#/'); await page.waitForTimeout(900);
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.addbox >> text=Import a song')]);
await chooser.setFiles(song);
await page.waitForTimeout(1500);
await page.click('.importbar button:has-text("Cancel")');
await page.waitForTimeout(3000);
ok('import cancelled, bar gone', await page.locator('.importbar').count() === 0);
const n = await page.evaluate(async () => (await (await import('/core/db.mjs')).db.listProjects()).length);
ok('cancelled import made no song', n === 1, `${n} songs`);
console.log(errs.length ? errs.join('\n') : 'no errors');
await browser.close();
