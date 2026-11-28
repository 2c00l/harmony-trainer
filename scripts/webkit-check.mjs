// WebKit compatibility with a deterministic singing tone; not a physical-iPhone test.
import { webkit } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve,extname } from 'node:path';
const browser=await webkit.launch();
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
// Windows WebKit's network process may not reach loopback on this host. Serve the
// identical app files through Playwright so the browser compatibility test is independent of it.
if(process.platform==='win32')await context.route('http://127.0.0.1:4190/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  const path=resolve('www','.'+(pathname==='/'?'/index.html':pathname));
  const contentType={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.wasm':'application/wasm'}[extname(path)]||'application/octet-stream';
  try{await route.fulfill({path,contentType});}catch{await route.abort();}
});
await context.addInitScript(()=>{
  localStorage.setItem('ht.settings.v1',JSON.stringify({onboarded:true,micOk:true}));
  navigator.mediaDevices.getUserMedia=async constraints=>{
    window.__micConstraints=constraints;
    const C=window.AudioContext||window.webkitAudioContext,c=new C(),dest=c.createMediaStreamDestination();
    const s=c.createOscillator(),g=c.createGain();s.frequency.value=220;g.gain.value=.2;s.connect(g).connect(dest);s.start();await c.resume();
    window.__testInputs??=[];window.__testInputs.push(c);
    return dest.stream;
  };
});
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail));};
try {
  await page.goto('http://127.0.0.1:4190/#/',{waitUntil:'domcontentloaded'});
  await page.locator('canvas.roll').click({position:{x:100,y:100}});
  await page.waitForFunction(()=>window.__htSV?.live.filter(f=>f.midi!=null).length>20,{},{timeout:30000});
  const mic=await page.evaluate(()=>({frames:window.__htSV.live.length,last:window.__htSV.live.at(-1).midi,constraints:window.__micConstraints}));
  check('WebKit AudioWorklet and live pitch worker track a singing tone',Math.abs(mic.last-57)<.1,mic);
  await page.getByRole('button',{name:'Record my voice',exact:true}).click();
  await page.getByRole('button',{name:'Record',exact:true}).click();
  await page.waitForTimeout(2400);
  await page.getByRole('button',{name:'Stop recording',exact:true}).click();
  await page.getByRole('button',{name:'Play',exact:true}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.getByRole('button',{name:'Stop',exact:true}).waitFor();
  await page.getByRole('button',{name:'Volume',exact:true}).click();
  check('WebKit records, finds notes, plays and opens mix controls',await page.getByRole('slider',{name:'Vocal volume',exact:true}).isVisible());
  const bounds=await page.evaluate(()=>({view:innerWidth,width:document.documentElement.scrollWidth}));
  check('390px layout has no horizontal overflow',bounds.width<=bounds.view,bounds);
  mkdirSync('artifacts/webkit',{recursive:true});await page.screenshot({path:'artifacts/webkit/mix.png'});
  check('no WebKit exceptions',errors.length===0,errors);
  writeFileSync('artifacts/webkit/results.json',JSON.stringify({checks,errors},null,2)+'\n');
  if(checks.some(c=>!c.pass))process.exitCode=1;
} finally {await browser.close();}
