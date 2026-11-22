import { execFileSync } from 'node:child_process';
const adb = process.env.LOCALAPPDATA + '/Android/Sdk/platform-tools/adb.exe';
const pid = execFileSync(adb, ['-s',(process.env.SERIAL||'emulator-5584'),'shell','pidof','com.studymusictheory.pitchline'],{encoding:'utf8'}).trim();
execFileSync(adb, ['-s',(process.env.SERIAL||'emulator-5584'),'forward','tcp:9333','localabstract:webview_devtools_remote_'+pid]);
const t = (await (await fetch('http://localhost:9333/json')).json()).find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const v = JSON.parse(e.data); if (v.id === 1) { console.log(JSON.stringify(v.result.result?.value ?? v.result.exceptionDetails?.exception?.description)); process.exit(0); } };
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async()=>{${process.argv[2]}})()`, awaitPromise: true, returnByValue: true } }));
setTimeout(() => { console.log('timeout'); process.exit(1); }, 15000);
