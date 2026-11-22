// Raw store screenshots from the real app (Chrome, seeded demo song, simulated singer).
// Usage: node scripts/store/shots.mjs <w> <h> <dpr> <outdir> [theme]
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { buildDemo } from './seed-demo.mjs';

const [W = 430, H = 932, DPR = 3, OUT = 'artifacts/shots/phone', THEME = 'dark'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const demo = buildDemo();
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve('artifacts/silence.wav')}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: +DPR, permissions: ['microphone'], colorScheme: THEME });
await ctx.addInitScript((theme) => {
  const s = JSON.parse(localStorage.getItem('ht.settings.v1') || '{}');
  Object.assign(s, { onboarded: true, micOk: true, importExplained: false, theme, audioMode: 'headphones', _v: 2, zoom: 16, scrollSpeed: 0.6 });
  localStorage.setItem('ht.settings.v1', JSON.stringify(s));
}, THEME);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4190/#/');
await page.waitForTimeout(800);
await page.evaluate(async (d) => {
  const { db } = await import('/core/db.mjs');
  await db.clearAll();
  for (const [k, b] of Object.entries(d.audio)) {
    const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await db.putAudio(k, new Float32Array(u.buffer));
  }
  await db.putProject(d.project);
  for (const o of d.others) await db.putProject(o);
}, demo);
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
const go = async (hash, ms = 1500) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(ms); };

// simulated singer: on a song it sings the harmony bars (a good, not perfect, singer);
// on Live it sings a little phrase
const startSinger = (mode) => page.evaluate(async (mode) => {
  const E = await import('/audio/engine.mjs');
  clearInterval(window.__inj);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const phrase = [67, 71, 74, 72, 71, 69];
  window.__inj = setInterval(() => {
    const sv = window.__htSV; if (!sv) return;
    if (mode === 'live') {
      if (E.micActive()) E.stopMic(); // the test mic's silence would cut the simulated line
      const t = E.now(); const k = (t * 0.7) % phrase.length; const i = Math.floor(k); const into = (k - i) / 0.7;
      const midi = phrase[i] + (into < 0.08 ? -0.5 * (1 - into / 0.08) : 0) + Math.sin(t * 2 * Math.PI * 5.4) * 0.06 * Math.min(1, Math.max(0, (into - 0.4) / 0.4)) + (rnd() - 0.5) * 0.02;
      E.injectPitch({ t: t - 0.02, midi: into > 1.3 ? null : midi, held: midi, hz: 0, clarity: 0.95, rms: 0.1 });
      return;
    }
    if (!sv.transport) return;
    const m = sv.transport.heard();
    const tg = sv.targets.find((x) => x.kind === 'target' && m >= x.start - 0.01 && m <= x.end - 0.04);
    const t = E.now() - E.outputLatency() + E.roundTripLatency();
    if (!tg) { E.injectPitch({ t, midi: null, held: null, hz: 0, clarity: 0.2, rms: 0.001 }); return; }
    const into = m - tg.start;
    if (into < 0.05) { E.injectPitch({ t, midi: null, held: null, hz: 0, clarity: 0.2, rms: 0.001 }); return; }
    const midi = tg.midi + (into < 0.12 ? -0.12 * (1 - into / 0.12) : 0) + Math.sin(m * 2 * Math.PI * 5.3) * 0.1 * Math.min(1, Math.max(0, (into - 0.35) / 0.3)) + 0.04 + (rnd() - 0.5) * 0.04;
    E.injectPitch({ t, midi, held: midi, hz: 0, clarity: 0.95, rms: 0.1 });
  }, 10);
}, mode);
const stopSinger = () => page.evaluate(() => clearInterval(window.__inj));
const closeSheet = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(500); };

// 1. Live, with a key shown on the keyboard
await go('#/', 1200);
await page.click('header >> text=Key'); await page.waitForTimeout(400);
await page.click('.sheet >> text="G major"'); await page.waitForTimeout(400);
await startSinger('live');
await page.waitForTimeout(4200);
await shot('01-live');
await stopSinger();

// 2. Singing the harmony over the song (full screen while playing)
await go('#/project/demo-lantern', 1800);
await page.evaluate(() => import('/core/settings.mjs').then((m) => { m.settings.set('playMusic', true); }));
await go('#/', 600); await go('#/project/demo-lantern', 1800);
await startSinger('song');
await page.click('[aria-label="Sing along and record"]');
await page.waitForTimeout(8200);
await shot('02-sing-harmony');
await page.click('[aria-label="Stop and save the take"]');
await stopSinger();
await page.waitForTimeout(1800);

// 3. The song with all its controls (takes, transpose, harmony)
await go('#/', 1500);
await page.evaluate(async () => { const { db } = await import('/core/db.mjs'); const p = await db.getProject('demo-lantern'); p.takes = p.takes.slice(0, 1); p.takeId = 'T1'; p.playTake = true; await db.putProject(p); }); await go('#/project/demo-lantern', 1800);
await page.locator('input.pos').evaluate((el) => { el.value = '9'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(1500);
await shot('03-song');

// 4. Harmony choices
await page.click('text=Harmony:'); await page.waitForTimeout(700);
await shot('04-harmony');
await closeSheet();

// 5. Transpose: move the whole song to suit your voice
await page.click('[aria-label="Transpose down a semitone"]');
await page.click('[aria-label="Transpose down a semitone"]');
await page.waitForTimeout(1500);
await shot('05-transpose');
await page.click('.trans .chip.on'); await page.waitForTimeout(500);

// 6. Import a song: the vocal is taken out on the phone
await go('#/songs', 1200);
await page.click('text=Import a song'); await page.waitForTimeout(700);
await shot('06-import');
await closeSheet();

// 7. Export
await go('#/project/demo-lantern', 1600);
await page.click('[aria-label="Export audio or video"]'); await page.waitForTimeout(700);
await shot('07-export');
await closeSheet();

// 8. Accessibility and settings
await go('#/settings', 1200);
await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.includes('Accessibility')); h?.scrollIntoView({ block: 'start' }); });
await page.waitForTimeout(600);
await shot('08-accessibility');

console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await browser.close();
