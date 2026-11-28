// Native WebView regression: actual Android routing with microphone + media playback.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const serial = process.env.SERIAL || 'emulator-5584', pkg = 'com.studymusictheory.pitchline';
const sh = (...args) => execFileSync(adb,['-s',serial,...args],{encoding:'utf8'}).trim();
const pause = ms => new Promise(r=>setTimeout(r,ms));
sh('shell','pm','grant',pkg,'android.permission.RECORD_AUDIO');
sh('shell','am','start','-n',`${pkg}/.MainActivity`);
let target;
for (let i=0;i<20 && !target;i++) {
  try { const pid=sh('shell','pidof',pkg); sh('forward','tcp:9333',`localabstract:webview_devtools_remote_${pid}`); target=(await (await fetch('http://localhost:9333/json')).json()).find(t=>t.type==='page'); }
  catch { await pause(500); }
}
if (!target) throw new Error('Debug WebView unavailable');
const ws=new WebSocket(target.webSocketDebuggerUrl), pending=new Map(), errors=[];
await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
const send=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression:`(async()=>{${expression}})()`,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
await send('Runtime.enable');
const reports=[];
try {
  console.log('WebView',await ev('return navigator.userAgent'));
  await ev("const {settings}=await import('./core/settings.mjs'); settings.meta('onboarded',true); settings.meta('micOk',true); location.hash='#/settings';");
  await pause(1200);
  const defaults=await ev("const {settings}=await import('./core/settings.mjs'); const E=await import('./audio/engine.mjs');E.stopMic();window.__pitchFrames=0;E.onPitch(()=>window.__pitchFrames++);const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{window.__captureConstraints=c;const s=await get(c);window.__captureSettings=s.getAudioTracks()[0].getSettings();return s;};return {aec:settings.get('aec'),vocal:settings.get('vocalVolume')};");
  console.log('migrated defaults',JSON.stringify(defaults));
  for (const aec of [true,false]) {
    await ev(`const {settings}=await import('./core/settings.mjs'); const E=await import('./audio/engine.mjs'); E.stopMic(); settings.set('aec',${aec}); await E.startMic(); await E.ensureContext(); const c=E.audioContext(); window.__volumeTone?.stop(); const s=c.createOscillator(),g=c.createGain(); s.frequency.value=220;g.gain.value=.01;s.connect(g).connect(c.destination);s.start();window.__volumeTone=s; return {rate:c.sampleRate,mic:E.micActive()};`);
    await pause(1200);
    const before=sh('shell','dumpsys','audio');
    sh('shell','input','keyevent','24');
    await pause(500);
    const after=sh('shell','dumpsys','audio');
    const mode=after.split('\n').filter(l=>/Audio mode:|mAudioModeOwner:|requested mode|actual mode|mMode=/.test(l));
    const previousEvents=new Set(before.split('\n'));
    const volumeEvents=after.split('\n').filter(l=>!previousEvents.has(l)&&/adjust.*(MUSIC|VOICE_CALL)|set.*(MUSIC|VOICE_CALL)/i.test(l));
    const capture=await ev('return {constraints:window.__captureConstraints,settings:window.__captureSettings,pitchFrames:window.__pitchFrames}');
    const report={aec,mode,volumeEvents,capture};
    if(!aec&&(!volumeEvents.some(l=>l.includes('STREAM_MUSIC'))||volumeEvents.some(l=>l.includes('STREAM_VOICE_CALL'))||!mode.some(l=>l.includes('MODE_NORMAL'))||capture.constraints.audio.echoCancellation!==false||capture.pitchFrames<10))throw new Error('Android media/audio regression: '+JSON.stringify(report));
    reports.push(report);console.log(JSON.stringify(report,null,2));
    mkdirSync('artifacts/android',{recursive:true});
    writeFileSync(`artifacts/android/audio-${process.env.LABEL || 'current'}-aec-${aec}.txt`,after);
    sh('shell','input','keyevent','25');
  }
  await ev("window.__volumeTone?.stop(); (await import('./audio/engine.mjs')).stopMic();(await import('./core/settings.mjs')).settings.set('aec',false);");
  writeFileSync(`artifacts/android/audio-${process.env.LABEL || 'current'}.json`,JSON.stringify({defaults,reports,errors},null,2)+'\n');
  if(errors.length)throw new Error(errors.join(';'));
} finally {ws.close();}
