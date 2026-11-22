// Captures store screenshots from the real app in Chrome with seeded demo content and
// simulated singing fed through the engine. Usage: node scripts/store/shots.mjs <w> <h> <dpr> <outdir> [theme]
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
  Object.assign(s, { onboarded: true, micOk: true, theme, range: { lo: 48, hi: 69, at: Date.now() }, lessons: { unison: { passed: true, best: 91 }, drone: { passed: true, best: 86 }, thirds: { passed: true, best: 88 } }, latency: { speaker: 0.06, unknown: 0.06, wired: 0.04 }, audioMode: 'headphones' });
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
  for (const [k, b64] of Object.entries(d.audio)) {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await db.putAudio(k, new Float32Array(u.buffer));
  }
  await db.putProject(d.project);
  for (const o of d.others) await db.putProject(o);
  for (const h of d.history) await db.addHistory(h);
}, demo);
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
const go = async (hash, ms = 1500) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(ms); };

// simulated singer: follows the current target bars like a good (not perfect) singer
const startSinger = (mode) => page.evaluate(async (mode) => {
  const E = await import('/audio/engine.mjs');
  clearInterval(window.__inj);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  window.__inj = setInterval(() => {
    const sv = window.__htSV; if (!sv) return;
    if (mode === 'monitor') {
      const t = E.now(); const k = t % 6;
      const base = k < 2 ? 69 : k < 4 ? 71 : 67;
      const into = k % 2;
      const midi = base + (into < 0.08 ? -0.7 * (1 - into / 0.08) : 0) + Math.sin(t * 2 * Math.PI * 5.4) * 0.28 * Math.min(1, into / 0.5) + (rnd() - 0.5) * 0.03;
      E.injectPitch({ t: t - 0.02, midi: into > 1.85 ? null : midi, held: midi, hz: 440 * 2 ** ((midi - 69) / 12), clarity: 0.95, rms: 0.1 });
      return;
    }
    if (!sv.transport) return;
    const m = sv.transport.heard();
    const tg = sv.targets.find((x) => x.kind === 'target' && m >= x.start - 0.01 && m <= x.end - 0.04);
    const t = E.now() - E.outputLatency() + E.roundTripLatency();
    if (!tg) { E.injectPitch({ t, midi: null, held: null, hz: 0, clarity: 0.2, rms: 0.001 }); return; }
    const into = m - tg.start;
    const midi = tg.midi + (into < 0.06 ? -0.5 * (1 - into / 0.06) : 0) + Math.sin(m * 2 * Math.PI * 5.3) * 0.1 * Math.min(1, Math.max(0, (into - 0.35) / 0.3)) + 0.04 + (rnd() - 0.5) * 0.04;
    E.injectPitch({ t, midi, held: midi, hz: 440 * 2 ** ((midi - 69) / 12), clarity: 0.95, rms: 0.1 });
  }, 10);
}, mode);
const stopSinger = () => page.evaluate(() => clearInterval(window.__inj));

await go('#/', 1500); await shot('05-home');
// --- project: sing ---
await go('#/project/demo-lantern', 2000);
await page.click('.seg button[data-v=sing]');
await page.waitForTimeout(600);
await startSinger('take');
await page.click('[aria-label="Record harmony take"]');
await page.waitForTimeout(Number(process.env.SING_MS || 12500));
await shot('01-sing');
await page.click('[aria-label="Stop"]');
await page.waitForTimeout(2200);
await stopSinger();
await shot('04-summary');
await page.mouse.click(10, 40); // dismiss sheet via scrim
await page.waitForTimeout(1500);
await page.click('.seg button[data-v=mix]');
await page.waitForTimeout(1200);
await shot('02-stack');
await page.click('.seg button[data-v=harmony]');
await page.waitForTimeout(1200);
await shot('03-harmony');
await page.click('.seg button[data-v=edit]');
await page.waitForTimeout(800);
const box = await page.locator('canvas.roll').boundingBox();
// tap the first visible bar to select it
const bar = await page.evaluate(() => { const r = window.__htSV.roll; const n = r.s.targets.find((x) => x.kind === 'base' && r.timeToX(x.start) > r.plotX0 + 40); return n ? { x: r.timeToX((n.start + n.end) / 2), y: r.midiToY(n.midi) } : null; });
if (bar) { await page.mouse.click(box.x + bar.x, box.y + bar.y); await page.waitForTimeout(700); }
await shot('06-edit');
// --- live monitor ---
await go('#/monitor', 1200);
await startSinger('monitor');
await page.waitForTimeout(4200);
await shot('07-monitor');
await stopSinger();
await go('#/learn', 1500); await shot('08-learn');
await go('#/progress', 1800); await shot('09-progress');
await go('#/train', 1500); await shot('10-train');
await go('#/lesson/thirds', 1500); await shot('11-lesson');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await browser.close();
