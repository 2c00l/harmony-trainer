// Drives the debug app on the emulator through the WebView DevTools protocol; screenshots via adb.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const adb = process.env.LOCALAPPDATA + '/Android/Sdk/platform-tools/adb.exe';
const dev = process.env.SERIAL || 'emulator-5592';
const PKG = 'com.studymusictheory.harmonytrainer';
const sh = (...a) => execFileSync(adb, ['-s', dev, ...a], { encoding: 'utf8' }).trim();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('artifacts/android', { recursive: true });
let t = null;
for (let i = 0; i < 30 && !t; i++) {
  try {
    const pid = sh('shell', 'pidof', PKG);
    sh('forward', 'tcp:9333', 'localabstract:webview_devtools_remote_' + pid);
    const targets = await (await fetch('http://localhost:9333/json')).json();
    t = targets.find((x) => x.type === 'page');
  } catch { await pause(1000); }
}
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => { const v = JSON.parse(e.data); if (v.id) { pend.get(v.id)?.(v); pend.delete(v.id); } else if (v.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(v.params.exceptionDetails.exception?.description || v.params.exceptionDetails.text)); else if (v.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(v.params.type)) logs.push(v.params.type + ' ' + v.params.args.map((a) => a.value ?? a.description).join(' ')); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
const ev = async (js) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const shot = (n) => { const png = execFileSync(adb, ['-s', dev, 'exec-out', 'screencap', '-p']); writeFileSync(`artifacts/android/${n}.png`, png); };
const steps = (process.argv[2] || 'all');
console.log('ua', await ev('return navigator.userAgent'));
console.log('native', await ev('return [Capacitor.isNativePlatform(), Capacitor.getPlatform()]'));
console.log('route', await ev("return JSON.stringify(await Capacitor.registerPlugin('AudioRoute').getRoute())"));
console.log('worklet', await ev("return typeof AudioWorkletNode"));
await ev("localStorage.setItem('ht.settings.v1', JSON.stringify({onboarded:false})); location.hash='#/welcome'; location.reload(); return 1");
await pause(2500); shot('01-welcome');
await ev("document.querySelector('.btn.primary').click(); return 1"); await pause(800); shot('02-mic');
await ev("document.querySelector('.btn.primary').click(); return 1"); await pause(2500); shot('03-headphones');
console.log('mic after allow', await ev("return document.querySelector('h1')?.textContent"));
await ev("document.querySelector('.btn.primary').click(); return 1"); await pause(3000); shot('04-sing');
await ev("document.querySelector('.btn.ghost')?.click(); return 1"); await pause(1500); shot('05-home');
for (const r of ['/train', '/learn', '/progress', '/settings', '/monitor', '/t/drone', '/lesson/thirds', '/import', '/calibrate']) {
  await ev(`location.hash='#${r}'; return 1`); await pause(1800); shot('r' + r.replace(/\//g, '_'));
}
// latency / audio context facts
console.log('audio', await ev("const m = await import('./audio/engine.mjs'); await m.ensureContext(); const c=m.audioContext(); return JSON.stringify({sr:c.sampleRate, base:c.baseLatency, out:c.outputLatency, state:c.state})"));
console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close();
