// WebKit compatibility with a deterministic singing tone; not a physical-iPhone test.
import { webkit } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
const browser=await webkit.launch();
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
await context.addInitScript(()=>{
  localStorage.setItem('ht.settings.v1',JSON.stringify({onboarded:true,micOk:true}));
  navigator.mediaDevices.getUserMedia=async constraints=>{
    try {
    window.__micConstraints=constraints;
    const c=(await import('/audio/engine.mjs')).audioContext(),dest=c.createMediaStreamDestination();
    const s=c.createOscillator(),g=c.createGain();s.frequency.value=220;g.gain.value=.2;s.connect(g).connect(dest);s.start();await c.resume();
    window.__testInputs??=[];window.__testInputs.push(s);
    return dest.stream;
    }catch(e){window.__testMicError=String(e);throw e;}
  };
});
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')console.log('WebKit console:',m.text());});
const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail));};
try {
  // WebKit blocks port 4190 (Sieve); use an unrestricted local test port.
  await page.goto('http://127.0.0.1:4173/#/',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Live',exact:true}).click();
  const micButton=page.getByRole('button',{name:'Turn on microphone',exact:true});
  if(await micButton.isVisible())await micButton.click();
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
} catch(error) {
  mkdirSync('artifacts/webkit',{recursive:true});
  await page.screenshot({path:'artifacts/webkit/failure.png'}).catch(()=>{});
  const state=await page.evaluate(async()=>{const E=await import('/audio/engine.mjs');let micError;try{await E.startMic();}catch(e){micError=String(e);}return {text:document.body.innerText,audio:typeof AudioContext,worklet:typeof AudioWorkletNode,live:window.__htSV?.live.length,state:E.audioContext()?.state,micError,testMicError:window.__testMicError,constraints:window.__micConstraints,testInputs:window.__testInputs?.length};}).catch(()=>null);
  writeFileSync('artifacts/webkit/failure.json',JSON.stringify({error:String(error),errors,state},null,2));
  throw error;
} finally {await browser.close();}
