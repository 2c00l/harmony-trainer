// Store images: captioned screenshots for every size Google Play and the App Store take, plus the
// Play feature graphic and 512 px icon. Raw captures come from scripts/store/shots.mjs.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SHOTS = [
  ['02-sing-harmony', 'Sing the harmony', 'Your voice lights up on the notes as you sing'],
  ['01-live', 'See your pitch, live', 'Every note you sing, in real time'],
  ['06-import', 'Take the vocal out of any song', 'Done on your phone. Nothing is uploaded.'],
  ['04-harmony', '11 harmony parts', '3rds, 6ths, octaves, always in key'],
  ['05-transpose', 'Transpose to suit your voice', 'The whole song moves. The speed stays.'],
  ['03-song', 'Record yourself singing along', 'Hear your take with the song'],
  ['07-export', 'Share audio and video', 'Made on your phone, ready to post'],
  ['08-accessibility', 'Made for every singer', 'Large text, high contrast, colour-blind safe'],
];
// name, canvas w×h, raw folder, layout
const TARGETS = [
  ['play-phone', 1080, 1920, 'phone', 'portrait'],
  ['play-tablet-7', 1200, 1920, 'tablet', 'portrait'],
  ['play-tablet-10', 1600, 2560, 'tablet', 'portrait'],
  ['play-chromebook', 1920, 1080, 'landscape', 'landscape'],
  ['ios-6.9', 1320, 2868, 'phone', 'portrait'],
  ['ipad-13', 2064, 2752, 'tablet', 'portrait'],
];
const only = process.argv[2];
const img = (p) => `data:image/png;base64,${readFileSync(resolve(p)).toString('base64')}`;

const page_ = (w, h, layout, raw, title, sub) => `<!doctype html><html><head><style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  body{font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;color:#F2F5FF;
    background:radial-gradient(120% 70% at 15% 0%,#173a3a 0%,transparent 55%),radial-gradient(90% 60% at 100% 100%,#2b2457 0%,transparent 60%),#0B0F1A;
    display:flex;${layout === 'landscape' ? 'flex-direction:row;align-items:center;gap:3%;padding:0 3.5%;box-sizing:border-box' : 'flex-direction:column;align-items:center'}}
  .cap{${layout === 'landscape' ? 'flex:0 0 27%' : `padding:${h * 0.055}px ${w * 0.08}px ${h * 0.03}px;text-align:center`}}
  h1{margin:0;font-weight:800;letter-spacing:-.02em;line-height:1.05;font-size:${layout === 'landscape' ? w * 0.042 : w * 0.074}px}
  h1 b{color:#3EE6C4;font-weight:800}
  p{margin:${w * 0.012}px 0 0;color:#AEB7D0;font-weight:600;font-size:${layout === 'landscape' ? w * 0.02 : w * 0.036}px;line-height:1.3}
  .dev{position:relative;${layout === 'landscape' ? `flex:1;` : `height:${h * 0.76}px;`}border-radius:${w * 0.045}px;padding:${w * 0.012}px;background:linear-gradient(160deg,#2a3247,#141a28);
    box-shadow:0 ${w * 0.03}px ${w * 0.08}px rgba(0,0,0,.55),0 0 0 2px rgba(255,255,255,.06) inset}
  .dev img{display:block;${layout === 'landscape' ? 'width:100%' : 'height:100%'};border-radius:${w * 0.034}px}
</style></head><body><div class="cap"><h1>${title}</h1><p>${sub}</p></div><div class="dev"><img src="${raw}"></div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, w, h, folder, layout] of TARGETS) {
  if (only && !name.startsWith(only)) continue;
  const out = `artifacts/store/${name}`;
  mkdirSync(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  for (let i = 0; i < SHOTS.length; i++) {
    const [file, title, sub] = SHOTS[i];
    // highlight the key word of each caption
    const t = title.replace(/^(\S+)/, '<b>$1</b>');
    await page.setContent(page_(w, h, layout, img(`artifacts/shots/${folder}/${file}.png`), t, sub));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${String(i + 1).padStart(2, '0')}-${file}.png` });
  }
  await page.close();
  console.log('done', name);
}

// Play feature graphic 1024×500 and 512 icon
if (!only || only === 'graphics') {
  mkdirSync('artifacts/store/graphics', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;width:1024px;height:500px;overflow:hidden}
    body{font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;color:#F2F5FF;background:radial-gradient(80% 90% at 10% 10%,#173a3a 0%,transparent 60%),radial-gradient(70% 80% at 100% 100%,#2b2457 0%,transparent 60%),#0B0F1A;position:relative}
    .t{position:absolute;left:64px;top:120px;width:520px}
    .logo{display:flex;align-items:center;gap:18px}
    .logo img{width:84px;height:84px;border-radius:20px}
    h1{margin:0;font-size:76px;font-weight:800;letter-spacing:-.03em}
    p{margin:22px 0 0;font-size:31px;font-weight:600;color:#AEB7D0;line-height:1.25}
    p b{color:#3EE6C4}
    .ph{position:absolute;right:70px;top:46px;width:300px;height:540px;border-radius:34px;padding:9px;background:linear-gradient(160deg,#2a3247,#141a28);box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
    .ph img{width:100%;border-radius:26px;display:block}
  </style></head><body><div class="t"><div class="logo"><img src="data:image/svg+xml;base64,${Buffer.from(readFileSync('www/assets/icon.svg')).toString('base64')}"><h1>PitchSense</h1></div>
  <p><b>See your voice.</b> Sing in tune, sing the harmony, sing along with your songs.</p></div>
  <div class="ph"><img src="${img('artifacts/shots/phone/02-sing-harmony.png')}"></div></body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'artifacts/store/graphics/feature-graphic-1024x500.png' });
  await page.close();
  const ic = await browser.newPage({ viewport: { width: 512, height: 512 } });
  const svg = Buffer.from(readFileSync('www/assets/icon.svg')).toString('base64');
  await ic.setContent(`<html><body style="margin:0"><img src="data:image/svg+xml;base64,${svg}" style="width:512px;height:512px;display:block"></body></html>`);
  await ic.waitForTimeout(200);
  await ic.screenshot({ path: 'artifacts/store/graphics/icon-512.png' });
  await ic.close();
  console.log('done graphics');
}
await browser.close();
