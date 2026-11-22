// Visits every screen at several sizes/themes, collecting console errors and screenshots → artifacts/qa/
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts/qa', { recursive: true });
const sizes = (process.env.SIZES || 'small:360x640,large:430x932,tablet:820x1180').split(',').map((s) => { const [n, d] = s.split(':'); const [w, h] = d.split('x').map(Number); return { n, w, h }; });
const themes = (process.env.THEMES || 'dark,light').split(',');
const routes = (process.env.ROUTES || '/,/songs,/settings,/project/new,/song,/welcome').split(',');
const text = process.env.TEXT || 'normal';
// '/song' opens a seeded song (music, a take, transposed) so the full player dock is checked
async function seedSong(page) {
  return page.evaluate(async () => {
    const { newProject, saveNow, packFrames } = await import('/core/project.mjs');
    const { db, uid } = await import('/core/db.mjs');
    const sr = 48000, dur = 8, x = new Float32Array(sr * dur);
    const notes = [[0.5, 1.5, 62], [1.6, 2.6, 64], [2.7, 3.7, 66], [3.8, 5.2, 67], [5.4, 7, 69]];
    for (const [a, b, m] of notes) { const f = 440 * 2 ** ((m - 69) / 12); for (let i = Math.round(a * sr); i < b * sr; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * f * i / sr); }
    const key = uid(), bk = uid(), tk = uid();
    await db.putAudio(key, x); await db.putAudio(bk, x); await db.putAudio(tk, x.slice(0, sr * 3));
    const p = newProject('A song with quite a long name for testing');
    const ns = notes.map(([a, b, m]) => ({ id: uid(), start: a, end: b, midi: m, raw: m }));
    const frames = []; for (let t = 0; t < dur; t += 0.01) { const n = notes.find(([a, b]) => t >= a && t < b); frames.push({ t, midi: n ? n[2] : null }); }
    p.layers = [{ id: uid(), name: 'Vocal', audioKey: key, frames: packFrames(frames), notes: ns, duration: dur }];
    p.baseLayerId = p.layers[0].id; p.notes = ns; p.key = { root: 2, mode: 'major' }; p.duration = dur;
    p.imported = true; p.backingKey = bk; p.transpose = 2;
    p.takes = [{ id: uid(), name: 'Take 1', audioKey: tk, at: 0, duration: 3, frames: [], transpose: 0 }]; p.playTake = true;
    await saveNow(p);
    return p.id;
  });
}
const wav = resolve('artifacts/fake-voice.wav');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
let total = 0;
for (const sz of sizes) for (const th of themes) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 2, permissions: ['microphone'] });
  await ctx.addInitScript(([th, TEXT]) => { const s = JSON.parse(localStorage.getItem('ht.settings.v1') || '{}'); if (!location.hash.includes('welcome')) s.onboarded = true; s.theme = th; s.textSize = TEXT; localStorage.setItem('ht.settings.v1', JSON.stringify(s)); }, [th, text]);
  for (const r of routes) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('icon.svg')) errs.push(m.text()); });
    if (r === '/song') { await page.goto('http://localhost:4190/#/'); await page.waitForTimeout(600); const id = await seedSong(page); await page.goto(`http://localhost:4190/#/project/${id}`); }
    else await page.goto(`http://localhost:4190/#${r}`);
    await page.waitForTimeout(Number(process.env.WAIT || 2200));
    // horizontal overflow check
    const ov = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.chips,.ticks,.tools,canvas,[style*="-20000"]'); }).slice(0, 3).map((e) => e.className || e.tagName));
    if (ov.length) errs.push('overflow: ' + ov.join(', '));
    // the notes must keep most of the screen
    const stage = await page.evaluate(() => { const st = document.querySelector('.screen .stage'); return st ? Math.round(st.getBoundingClientRect().height / innerHeight * 100) : null; });
    if (stage != null && stage < 40) errs.push(`notes only get ${stage}% of the height`);
    const name = `${sz.n}-${th}-${text}-${r.replace(/\//g, '_') || 'home'}`;
    await page.screenshot({ path: `artifacts/qa/${name}.png` });
    if (errs.length) { total += errs.length; console.log(name, '\n  ' + errs.join('\n  ')); }
    await page.close();
  }
  await ctx.close();
}
console.log(total ? `${total} issues` : 'all clean');
await browser.close();
