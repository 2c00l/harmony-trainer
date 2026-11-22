// Checks every setting: its control in Settings saves the value, and the value has its effect.
// Run with the dev server up: node scripts/settings-check.mjs
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const URL = 'http://localhost:4190/';
const wav = resolve('artifacts/fake-voice.wav');
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const results = [];
const errs = [];
const ok = (name, pass, info = '') => results.push([pass ? 'PASS' : 'FAIL', name, info]);

async function fresh(settings = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ['microphone'] });
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('ht.settings.v1', JSON.stringify({ onboarded: true, micOk: true, ...s })); } }, settings);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${JSON.stringify(settings)} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`${JSON.stringify(settings)} ${m.text()}`); });
  await page.goto(URL + '#/');
  await page.waitForTimeout(900);
  return { ctx, page };
}
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ht.settings.v1') || '{}'));

// a song to test the player with: a short melody D-E-F#-G as notes + frames
async function makeSong(page) {
  return page.evaluate(async () => {
    const { newProject, saveNow, packFrames } = await import('/core/project.mjs');
    const { db, uid } = await import('/core/db.mjs');
    const sr = 48000, dur = 6, x = new Float32Array(sr * dur);
    const notes = [[0.5, 1.5, 62], [1.6, 2.6, 64], [2.7, 3.7, 66], [3.8, 5.2, 67]];
    for (const [a, b, m] of notes) { const f = 440 * 2 ** ((m - 69) / 12); for (let i = Math.round(a * sr); i < b * sr; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * f * i / sr); }
    const key = uid(); await db.putAudio(key, x);
    const p = newProject('Check song');
    const ns = notes.map(([a, b, m]) => ({ id: uid(), start: a, end: b, midi: m, raw: m }));
    const frames = []; for (let t = 0; t < dur; t += 0.01) { const n = notes.find(([a, b]) => t >= a && t < b); frames.push({ t, midi: n ? n[2] : null }); }
    p.layers = [{ id: uid(), name: 'Vocal', audioKey: key, frames: packFrames(frames), notes: ns, duration: dur }];
    p.baseLayerId = p.layers[0].id; p.notes = ns; p.key = { root: 2, mode: 'major' }; p.duration = dur;
    await saveNow(p);
    return p.id;
  });
}
const targets = (page) => page.evaluate(() => window.__htSV.roll.s.targets.filter((t) => t.kind === 'target').map((t) => t.midi));

// ---------- 1. every control in Settings changes its stored value ----------
{
  const { ctx, page } = await fresh();
  await page.goto(URL + '#/settings'); await page.waitForTimeout(800);
  const schema = await page.evaluate(async () => (await import('/core/settings.mjs')).SCHEMA.flatMap((g) => g.items.map((i) => ({ id: i.id, type: i.type, label: i.label, options: i.options?.map((o) => o[0]), min: i.min, max: i.max }))));
  for (const it of schema) {
    const row = page.locator('.row', { has: page.locator(`text="${it.label}"`) }).first();
    const before = (await stored(page))[it.id];
    try {
      if (it.type === 'bool') { await row.locator('input[type=checkbox]').click(); }
      else if (it.type === 'range') {
        await row.locator('input[type=range]').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, before === it.max ? it.min : it.max);
      } else if (it.type === 'choice') {
        const seg = row.locator('.seg button');
        if (await seg.count()) await seg.nth(1).click();
        else { await row.locator('button.chip').click(); await page.waitForTimeout(300); await page.locator('.sheet .row').nth(1).click(); await page.waitForTimeout(300); }
      } else { ok(`control: ${it.id}`, true, 'action (checked separately)'); continue; }
      await page.waitForTimeout(150);
      const after = (await stored(page))[it.id];
      ok(`control: ${it.id}`, after !== undefined && after !== before, `${before} → ${after}`);
    } catch (e) { ok(`control: ${it.id}`, false, e.message.split('\n')[0]); }
  }
  // reset restores defaults
  await page.locator('.row', { has: page.locator('text="Reset all settings"') }).locator('button').click();
  await page.waitForTimeout(300); await page.locator('.sheet button:has-text("Reset")').click(); await page.waitForTimeout(400);
  const s = await stored(page);
  ok('action: reset', s.theme === 'dark' && s.showHarmony === true && s.onboarded === true, `theme=${s.theme} onboarded=${s.onboarded}`);
  await page.goto(URL + '#/settings'); await page.waitForTimeout(500);
  await page.locator('.row', { has: page.locator('text="Gestures and keyboard shortcuts"') }).locator('button').click();
  await page.waitForTimeout(400);
  ok('action: shortcuts', await page.locator('.sheet:has-text("Gestures and shortcuts")').count() === 1);
  await ctx.close();
}

// ---------- 2. each value has its effect ----------
const html = (page) => page.evaluate(() => ({ theme: document.documentElement.dataset.theme, text: document.documentElement.dataset.text, contrast: document.documentElement.dataset.contrast, palette: document.documentElement.dataset.palette || '', lh: document.documentElement.classList.contains('left-handed'), rm: document.documentElement.classList.contains('reduce-motion'), fs: getComputedStyle(document.documentElement).fontSize }));
for (const [s, check] of [
  [{ theme: 'light' }, (h) => h.theme === 'light'],
  [{ textSize: 'xl' }, (h) => h.text === 'xl' && parseFloat(h.fs) > 17],
  [{ contrast: true }, (h) => h.contrast === 'high'],
  [{ palette: 'cb' }, (h) => h.palette === 'cb'],
  [{ leftHanded: true }, (h) => h.lh],
  [{ reduceMotion: 'on' }, (h) => h.rm],
]) {
  const { ctx, page } = await fresh(s);
  const h = await html(page);
  ok(`effect: ${Object.keys(s)[0]}`, check(h), JSON.stringify(h));
  await ctx.close();
}
{
  const { ctx, page } = await fresh({ infoButtons: false, hideAddBox: true, showCents: false });
  ok('effect: infoButtons off', await page.locator('.infobtn').count() === 0);
  ok('effect: hideAddBox', await page.locator('.addbox').count() === 0 && await page.locator('[aria-label="Add vocals"]').isVisible());
  ok('effect: showCents off', await page.locator('.hud .cents').count() === 0);
  await ctx.close();
}
{
  const { ctx, page } = await fresh({ zoom: 22, scrollSpeed: 2, labels: 'solfege', accidentals: 'flat', a4: 432 });
  const r = await page.evaluate(async () => {
    const E = await import('/audio/engine.mjs');
    E.stopMic();
    E.injectPitch({ t: E.now(), midi: 61, held: 61, hz: 0, clarity: 0.95, rms: 0.1 });
    const sv = window.__htSV;
    return { semis: sv.roll.s.semis, pps: sv.roll.s.pxPerSec, note: document.querySelector('.bignote').textContent, hz: document.querySelector('.hud .hz').textContent };
  });
  ok('effect: zoom', r.semis === 22, r.semis);
  ok('effect: scrollSpeed', r.pps === 220, r.pps);
  ok('effect: labels solfege + flats', r.note === 'Ra', r.note);
  ok('effect: a4 432', r.hz.startsWith('272.1'), r.hz);
  await ctx.close();
}
{
  // spoken feedback off: the screen-reader note text never updates
  const { ctx, page } = await fresh({ announce: false });
  const t = await page.evaluate(async () => { const E = await import('/audio/engine.mjs'); E.injectPitch({ t: E.now(), midi: 64, held: 64, hz: 0, clarity: 0.95, rms: 0.1 }); await new Promise((r) => setTimeout(r, 50)); return document.querySelector('.stage .sr').textContent; });
  ok('effect: announce off', t === '', JSON.stringify(t));
  await ctx.close();
}
{
  const { ctx, page } = await fresh({ haptics: false });
  const n = await page.evaluate(async () => { let n = 0; navigator.vibrate = () => { n++; return true; }; const { haptic } = await import('/ui/ui.mjs'); haptic('light'); return n; });
  ok('effect: haptics off', n === 0, n);
  await ctx.close();
}
// harmony settings
{
  const { ctx, page } = await fresh();
  const id = await makeSong(page);
  const open = async () => { await page.goto(URL + '#/'); await page.goto(URL + `#/project/${id}`); await page.waitForTimeout(700); };
  const set = (k, v) => page.evaluate(([k, v]) => import('/core/settings.mjs').then((m) => m.settings.set(k, v)), [k, v]);
  await open();
  const base = await targets(page);
  ok('effect: harmony 3rd above in D', JSON.stringify(base) === JSON.stringify([66, 67, 69, 71]), base);
  await set('harmonyType', 'third_below'); await page.waitForTimeout(200);
  const below = await targets(page);
  ok('effect: harmonyType 3rd below', JSON.stringify(below) === JSON.stringify([59, 61, 62, 64]), below);
  await set('harmonyType', 'third_above'); await set('harmonyOctave', 'down'); await page.waitForTimeout(200);
  const down = await targets(page);
  ok('effect: harmonyOctave down', JSON.stringify(down) === JSON.stringify([54, 55, 57, 59]), down);
  await set('harmonyOctave', 'same'); await set('diatonic', false); await page.waitForTimeout(200);
  const exact = await targets(page);
  ok('effect: stay in key off (exact major 3rds)', JSON.stringify(exact) === JSON.stringify([66, 68, 70, 71]), exact);
  await set('diatonic', true); await set('showHarmony', false); await page.waitForTimeout(200);
  ok('effect: showHarmony off', (await targets(page)).length === 0);
  await set('showHarmony', true);
  // playback: which layers play, and whether the mic runs
  const playCheck = async () => {
    await page.click('[aria-label=Play]'); await page.waitForTimeout(700);
    const r = await page.evaluate(async () => { const E = await import('/audio/engine.mjs'); return { mic: E.micActive(), layers: window.__htSV.transport?.layersPlaying }; });
    await page.click('[aria-label=Stop]'); await page.waitForTimeout(300);
    return r;
  };
  let r = await playCheck();
  ok('effect: vocal plays, mic on (singAlong)', r.layers === 1 && r.mic, JSON.stringify(r));
  await set('playVocal', false); await set('singAlong', false); await open();
  r = await playCheck();
  ok('effect: playVocal off + singAlong off', r.layers === 0 && !r.mic, JSON.stringify(r));
  await set('playVocal', true); await set('singAlong', true);
  await ctx.close();
}
// microphone settings rebuild the detector live without errors
{
  const { ctx, page } = await fresh();
  const r = await page.evaluate(async () => {
    const { settings } = await import('/core/settings.mjs');
    const E = await import('/audio/engine.mjs');
    await E.startMic();
    for (const [k, v] of [['clarity', 0.8], ['noiseGate', 0.02], ['octaveFix', false], ['voiceRange', 'low'], ['smoothing', 0.7], ['inputGain', 2], ['aec', false], ['audioMode', 'headphones'], ['playbackReject', false], ['confidentOnly', false]]) settings.set(k, v);
    await new Promise((r) => setTimeout(r, 1500));
    let n = 0; const un = E.onPitch(() => n++); await new Promise((r) => setTimeout(r, 800)); un();
    return { frames: n, mic: E.micActive() };
  });
  ok('effect: mic settings applied live, pitch still flowing', r.mic && r.frames > 20, JSON.stringify(r));
  await ctx.close();
}

for (const r of results) console.log(r.join('  '));
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} pass`);
console.log(errs.length ? errs.join('\n') : 'no console errors');
await browser.close();
