// Usage: node scripts/shot.mjs <route> <out.png> [width height] [--light] [--wait ms] [--eval "js"]
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
const routeArg = args[0] || '/', out = args[1] || 'artifacts/shot.png';
const w = Number(args[2]) || 390, hgt = Number(args[3]) || 844;
const light = args.includes('--light');
const wi = args.indexOf('--wait'); const wait = wi >= 0 ? Number(args[wi + 1]) : 1500;
const ei = args.indexOf('--eval'); const evalJs = ei >= 0 ? args[ei + 1] : null;
const onb = args.includes('--fresh') ? null : true;
const wav = resolve('artifacts/fake-voice.wav');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, permissions: ['microphone'], colorScheme: light ? 'light' : 'dark' });
await ctx.addInitScript(([onb, light]) => { try { const s = JSON.parse(localStorage.getItem('ht.settings.v1') || '{}'); if (onb) s.onboarded = true; if (light) s.theme = 'light'; localStorage.setItem('ht.settings.v1', JSON.stringify(s)); } catch (e) {} }, [onb, light]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => errs.push('reqfail ' + r.url())); page.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
await page.goto(`http://localhost:4190/#${routeArg}`);
await page.waitForTimeout(wait);
if (evalJs) { console.log('eval:', JSON.stringify(await page.evaluate(evalJs))); await page.waitForTimeout(800); }
await page.screenshot({ path: out });
console.log(errs.length ? errs.join('\n') : 'no errors');
await browser.close();
