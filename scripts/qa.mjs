// Visits every screen at several sizes/themes, collecting console errors and screenshots → artifacts/qa/
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts/qa', { recursive: true });
const sizes = (process.env.SIZES || 'small:360x640,large:430x932,tablet:820x1180').split(',').map((s) => { const [n, d] = s.split(':'); const [w, h] = d.split('x').map(Number); return { n, w, h }; });
const themes = (process.env.THEMES || 'dark,light').split(',');
const routes = (process.env.ROUTES || '/,/train,/learn,/progress,/settings,/monitor,/t/range,/t/warmups,/t/match,/t/intervals,/t/sustain,/t/vibrato,/t/drone,/lesson/thirds,/calibrate,/import,/welcome').split(',');
const wav = resolve('artifacts/fake-voice.wav');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
let total = 0;
for (const sz of sizes) for (const th of themes) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 2, permissions: ['microphone'] });
  await ctx.addInitScript((th) => { const s = JSON.parse(localStorage.getItem('ht.settings.v1') || '{}'); if (!location.hash.includes('welcome')) s.onboarded = true; s.theme = th; localStorage.setItem('ht.settings.v1', JSON.stringify(s)); }, th);
  for (const r of routes) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('icon.svg')) errs.push(m.text()); });
    await page.goto(`http://localhost:4190/#${r}`);
    await page.waitForTimeout(Number(process.env.WAIT || 2200));
    // horizontal overflow check
    const ov = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.chips,.tools,canvas,[style*="-20000"]'); }).slice(0, 3).map((e) => e.className || e.tagName));
    if (ov.length) errs.push('overflow: ' + ov.join(', '));
    const name = `${sz.n}-${th}-${r.replace(/\//g, '_') || 'home'}`;
    await page.screenshot({ path: `artifacts/qa/${name}.png` });
    if (errs.length) { total += errs.length; console.log(name, '\n  ' + errs.join('\n  ')); }
    await page.close();
  }
  await ctx.close();
}
console.log(total ? `${total} issues` : 'all clean');
await browser.close();
