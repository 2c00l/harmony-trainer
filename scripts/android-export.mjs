// On the emulator/phone (debug build): seeds a long song and exports it as video, watching that the app
// process survives the whole encode. SERIAL=emulator-5584 SECS=180 node scripts/android-export.mjs
import { execFileSync } from 'node:child_process';
const adb = process.env.LOCALAPPDATA + '/Android/Sdk/platform-tools/adb.exe';
const dev = process.env.SERIAL || 'emulator-5584';
const SECS = Number(process.env.SECS || 180);
const PKG = 'com.studymusictheory.pitchline';
const sh = (...a) => execFileSync(adb, ['-s', dev, ...a], { encoding: 'utf8' }).trim();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let t = null, pid = null;
for (let i = 0; i < 40 && !t; i++) {
  try {
    pid = sh('shell', 'pidof', PKG);
    sh('forward', 'tcp:9334', 'localabstract:webview_devtools_remote_' + pid);
    t = (await (await fetch('http://localhost:9334/json')).json()).find((x) => x.type === 'page');
  } catch { await pause(1000); }
}
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const v = JSON.parse(e.data); if (v.id) { pend.get(v.id)?.(v); pend.delete(v.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (js) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
await ev("const s=JSON.parse(localStorage.getItem('ht.settings.v1')||'{}'); s.onboarded=true; localStorage.setItem('ht.settings.v1', JSON.stringify(s)); return 1");
const pid0 = pid;
console.log('webcodecs', await ev('return [typeof VideoEncoder, typeof AudioEncoder]'));
// seed a long song and start the export without waiting (the share sheet at the end never resolves here)
console.log('seed', await ev(`
  const { newProject, saveNow, packFrames } = await import('./core/project.mjs');
  const { db, uid } = await import('./core/db.mjs');
  const sr = 44100, dur = ${SECS}, x = new Float32Array(sr * dur);
  const notes = []; for (let i = 0; i < dur - 1; i++) notes.push([0.3 + i, 1.1 + i, 60 + (i % 7)]);
  for (const [a, b, m] of notes) { const f = 440 * 2 ** ((m - 69) / 12); for (let i = Math.round(a * sr); i < b * sr; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * f * i / sr); }
  const key = uid(); await db.putAudio(key, x);
  const p = newProject('Export check');
  const ns = notes.map(([a, b, m]) => ({ id: uid(), start: a, end: b, midi: m, raw: m }));
  const frames = []; for (let t = 0; t < dur; t += 0.01) { const n = notes.find(([a, b]) => t >= a && t < b); frames.push({ t, midi: n ? n[2] : null }); }
  p.layers = [{ id: uid(), name: 'Vocal', audioKey: key, frames: packFrames(frames), notes: ns, duration: dur }];
  p.baseLayerId = p.layers[0].id; p.notes = ns; p.key = { root: 0, mode: 'major' }; p.duration = dur;
  await saveNow(p); location.hash = '#/project/' + p.id; return p.id;`));
await pause(4000);
console.log("export btn", await ev("const b = document.querySelector('[aria-label=\"Export audio or video\"]'); b?.click(); return [location.hash, !!b]"));
await pause(1200);
console.log('sheet', await ev("return [...document.querySelectorAll('.sheet button.row')].map(b=>b.textContent.slice(0,12)).join('|')"));
await ev("[...document.querySelectorAll('.sheet button.row')].find(b=>b.textContent.startsWith('Video')).click(); return 1");
const t0 = Date.now();
let last = '';
for (;;) {
  await pause(3000);
  let now = '';
  try { now = sh('shell', 'pidof', PKG); } catch { now = ''; }
  if (now !== pid0) { console.log(`APP DIED after ${Math.round((Date.now() - t0) / 1000)} s at "${last}"`); process.exit(1); }
  const txt = await Promise.race([ev("return document.querySelector('.sheet [aria-live]')?.textContent || document.querySelector('.sheet h2')?.textContent || 'no sheet'"), pause(4000).then(() => 'timeout')]);
  if (txt !== last) console.log(Math.round((Date.now() - t0) / 1000) + 's', txt);
  last = txt;
  if (!/Drawing|Mixing|Recording|Making/.test(txt) && txt !== 'timeout') break;
  if (Date.now() - t0 > 20 * 60e3) { console.log('too slow'); break; }
}
const mem = sh('shell', 'dumpsys', 'meminfo', PKG).split('\n').find((l) => l.includes('TOTAL PSS'));
console.log('survived; finished with', last, '|', mem?.trim());
ws.close();
