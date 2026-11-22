/* Play Console browser bot — automates the bits the Android Publisher API has no
 * endpoints for: creating the app record and the App content declarations
 * (content rating, data safety, target audience, ads, app access, category...).
 *
 * Drives a REAL Chrome/Edge over CDP, attached to a persistent logged-in profile.
 *
 * One-time start (leave the window open; log into Google in it the first time):
 *   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\Users\c_sen\chrome-automation-profile https://play.google.com/console
 *   (Edge works too: msedge.exe with the same flags. Chrome 136+ requires the
 *    separate --user-data-dir; the default profile refuses debugging.)
 *
 * Macros (the recorded flows):
 *   node scripts/play-console-bot.mjs create-app
 *   node scripts/play-console-bot.mjs privacy | app-access | ads | content-rating |
 *        target-audience | data-safety | financial | government | health | category
 *   node scripts/play-console-bot.mjs declarations        # all of the above in order
 *
 * Primitives (for steering when Google moves the furniture — every macro failure
 * prints the step + screenshot so the flow can be finished with these):
 *   node scripts/play-console-bot.mjs goto <url>
 *   node scripts/play-console-bot.mjs texts               # list visible clickable texts
 *   node scripts/play-console-bot.mjs click "Some text"   # real mouse click by visible text
 *   node scripts/play-console-bot.mjs type "Field label" "value"
 *   node scripts/play-console-bot.mjs shot [name]
 *   node scripts/play-console-bot.mjs url
 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'artifacts', 'console');
mkdirSync(OUT, { recursive: true });
const PORT = process.env.CDP_PORT || 9222;
const DEV_ID = '8836463295332013599';
const APP_ID = process.env.PLAY_APP_ID || ''; // com.studymusictheory.harmonytrainer
const APP = `https://play.google.com/console/u/0/developers/${DEV_ID}/app/${APP_ID}`;

const ANSWERS = {
  appName: 'Harmony Trainer',
  language: 'English (United Kingdom)',
  privacyUrl: 'https://studymusictheory.com/harmony-trainer/privacy',
  ratingEmail: 'charliesendrowski@googlemail.com',
  category: 'Music & Audio',
};

// ── CDP plumbing ──
let targets;
try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); }
catch {
  console.error(`No browser on CDP port ${PORT}. Start it first (see header of this file).`);
  process.exit(1);
}
let page = targets.find((t) => t.type === 'page' && /play\.google\.com\/console/.test(t.url))
  || targets.find((t) => t.type === 'page' && !/^devtools/.test(t.url));
if (!page) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?url=https://play.google.com/console`, { method: 'PUT' });
  page = await r.json();
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));
let msgId = 0; const pending = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('page JS error: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable'); await send('Page.enable');

const shot = async (name = 'state') => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(OUT, `${Date.now()}-${name.replace(/[^\w-]+/g, '_').slice(0, 40)}.png`);
  writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  return f;
};

// ── page-side element finder: visible, text-matched, clickable-ish elements ──
// Injected as a string so it runs in the page. Returns center coords of best match.
const FINDER = `(function(query, kinds, doClick){
  const norm = s => (s||'').replace(/\\s+/g,' ').trim().toLowerCase();
  const q = norm(query);
  const sel = kinds === 'input'
    ? 'input:not([type=radio]):not([type=checkbox]), textarea, [contenteditable=true]'
    : 'button, a, [role=button], [role=radio], [role=checkbox], [role=menuitem], [role=option], [role=tab], [role=link], input[type=radio], input[type=checkbox], label, [debug-id]';
  const els = [...document.querySelectorAll(sel)];
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // gather ALL candidate strings for an element and score against each (don't let debug-id shadow visible text)
  const candsOf = el => {
    const c = [el.getAttribute('aria-label'), el.getAttribute('debug-id'), el.placeholder];
    if (kinds === 'input') { if (el.labels && el.labels[0]) c.push(el.labels[0].textContent); }
    else c.push(el.textContent);
    return c.map(norm).filter(Boolean);
  };
  const textOf = el => { const c = candsOf(el); return c[0] || ''; };
  // for inputs also match a nearby label/formfield heading
  const fieldText = el => {
    if (kinds !== 'input') return '';
    let n = el; for (let i = 0; i < 6 && n; i++) { n = n.parentElement; if (!n) break;
      const lbl = n.querySelector('label, [class*=label], h3, h4'); if (lbl) { const t = norm(lbl.textContent); if (t) return t; } }
    return '';
  };
  let best = null, bestScore = -1, bestLen = 1e9;
  for (const el of els) {
    if (!vis(el)) continue;
    const cands = [...candsOf(el), fieldText(el)].filter(Boolean);
    let score = -1, matchLen = 1e9;
    for (const s of cands) {
      let sc = -1;
      if (s === q) sc = 3;
      else if (s.startsWith(q)) sc = 2;
      else if (s.includes(q)) sc = 1;
      if (sc > score) { score = sc; matchLen = s.length; }
    }
    // prefer higher score; tie-break to the tightest (shortest) matching text
    if (score > bestScore || (score === bestScore && matchLen < bestLen)) { bestScore = score; best = el; bestLen = matchLen; }
  }
  if (bestScore < 1) return null;
  best.scrollIntoView({ block: 'center', inline: 'center' });
  const r = best.getBoundingClientRect();
  const info = { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (best.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80), tag: best.tagName };
  // click in the SAME evaluate (a real DOM click; fires SPA router handlers coord clicks miss).
  // splitting find and click across calls loses the element to Angular re-render.
  if (doClick) {
    const t = best.matches('button,a,input,[role=radio],[role=checkbox],[role=button]') ? best
      : (best.querySelector('button,a,input,[role=radio],[role=checkbox],[role=button]') || best);
    t.click();
    info.clicked = true;
  }
  return info;
})`;

async function mouseClick(x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}

async function find(query, kinds = 'click', timeoutMs = 8000, doClick = false) {
  const t0 = Date.now();
  for (;;) {
    const hit = await evaluate(`${FINDER}(${JSON.stringify(query)}, ${JSON.stringify(kinds)}, ${doClick})`);
    if (hit) return hit;
    if (Date.now() - t0 > timeoutMs) return null;
    await wait(300);
  }
}

async function click(query, { optional = false } = {}) {
  const hit = await find(query, 'click', optional ? 3000 : 8000, true); // find + DOM-click atomically
  if (!hit) {
    if (optional) { console.log(`  (skip: "${query}" not on page)`); return false; }
    throw new Error(`click target not found: "${query}"`);
  }
  console.log(`  clicked "${query}" -> <${hit.tag}> ${hit.text}`);
  await wait(700);
  return true;
}

async function type(label, value) {
  const hit = await find(label, 'input');
  if (!hit) throw new Error(`input not found: "${label}"`);
  await mouseClick(hit.x, hit.y);
  await wait(200);
  await evaluate(`(function(){ const el = document.activeElement; if (el && (el.tagName==='INPUT'||el.tagName==='TEXTAREA')) { el.select && el.select(); } })()`);
  await send('Input.insertText', { text: value });
  // fire input/change so Angular sees it
  await evaluate(`(function(){ const el = document.activeElement; if (el) { el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } })()`);
  console.log(`  typed into "${label}": ${value}`);
  await wait(300);
}

async function goto(url) {
  await send('Page.navigate', { url });
  await wait(3500);
  console.log(`  at ${await evaluate('location.href')}`);
}

async function texts() {
  return evaluate(`[...document.querySelectorAll('button, a, [role=button], [role=radio], [role=checkbox], [role=tab], [role=menuitem], label, h2, h3')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; })
    .map(el => (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g,' ').trim())
    .filter(t => t && t.length < 120)
    .filter((t, i, a) => a.indexOf(t) === i)`);
}

// current app's App content hub — relies on being somewhere inside the app already,
// or navigates via the console home + app card
async function gotoAppContentTask(taskText) {
  await goto(`${APP}/app-content/overview`);
  // each task card has a Start / Manage button next to its title; click the title's row button
  const started = await click(taskText);
  await wait(1500);
  return started;
}

async function saveish() {
  for (const t of ['Save', 'Submit', 'Next']) if (await click(t, { optional: true })) return t;
  return null;
}

// ── macros ──
const MACROS = {
  async 'create-app'() {
    await goto(`https://play.google.com/console/u/0/developers/${DEV_ID}/app-list`);
    await wait(2500);
    await click('Create app');
    await wait(2000);
    await type('App name', ANSWERS.appName);
    await click('Default language'); await wait(400);
    await type('Search', ANSWERS.language).catch(() => {});
    await click(ANSWERS.language);
    await click('App');
    await click('Free');
    await click('Developer Program Policies');
    await click('US export laws');
    await shot('create-app-filled');
    await click('Create app');
    await wait(4000);
    console.log('app url now: ' + await evaluate('location.href'));
  },
  async privacy() {
    await gotoAppContentTask('Privacy policy');
    await type('Privacy policy', ANSWERS.privacyUrl);
    await click('Save');
  },
  async 'app-access'() {
    await gotoAppContentTask('App access');
    await click('All functionality is available without special access');
    await click('Save');
  },
  async ads() {
    await gotoAppContentTask('Ads');
    await click('No, my app does not contain ads');
    await click('Save');
  },
  async 'content-rating'() {
    await gotoAppContentTask('Content rating');
    await click('Start questionnaire', { optional: true });
    await type('Email address', ANSWERS.ratingEmail);
    await type('Confirm email', ANSWERS.ratingEmail).catch(() => {});
    await click('All Other App Types');
    await click('Next');
    await wait(1500);
    // answer every visible radio question: "Yes" only for purchasing digital goods
    for (let round = 0; round < 30; round++) {
      const q = await evaluate(`(function(){
        const rads = [...document.querySelectorAll('[role=radio], input[type=radio]')].filter(el => { const r = el.getBoundingClientRect(); return r.width>2; });
        const groups = new Map();
        for (const r of rads) { const g = r.closest('[role=radiogroup]') || r.closest('div[class]')?.parentElement; if (!g) continue;
          if (![...groups.keys()].includes(g)) groups.set(g, []); groups.get(g).push(r); }
        for (const [g, opts] of groups) {
          if (opts.some(o => o.getAttribute('aria-checked') === 'true' || o.checked)) continue;
          const qText = (g.closest('div')?.parentElement?.textContent || '').replace(/\\s+/g,' ').slice(0, 200);
          const wantYes = false; // no purchases, no user content, no sharing: every answer is No
          const pick = opts.find(o => new RegExp(wantYes ? '^yes' : '^no', 'i').test((o.getAttribute('aria-label') || o.parentElement.textContent || '').trim()));
          if (pick) { pick.scrollIntoView({block:'center'}); const r = pick.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, q: qText.slice(0,80), yes: wantYes }; }
        }
        return null;
      })()`);
      if (!q) break;
      await mouseClick(q.x, q.y);
      console.log(`  answered ${q.yes ? 'YES' : 'no'}: ${q.q}`);
      await wait(400);
    }
    await shot('content-rating-answered');
    await click('Save', { optional: true });
    await click('Next', { optional: true });
    await wait(1500);
    await click('Submit', { optional: true });
  },
  async 'target-audience'() {
    await gotoAppContentTask('Target audience');
    await click('18 and over');
    await click('Next');
    await click('No', { optional: true }); // "could the store listing appeal to children"
    await saveish();
    await click('Save', { optional: true });
  },
  async 'data-safety'() {
    await gotoAppContentTask('Data safety');
    await click('Get started', { optional: true }) || await click('Start', { optional: true });
    await click('Next', { optional: true });
    await click('No', { optional: true }); // does your app collect or share required data types?
    for (let i = 0; i < 4; i++) if (!await click('Next', { optional: true })) break;
    await shot('data-safety-review');
    await click('Submit', { optional: true });
    await click('Save', { optional: true });
  },
  async financial() {
    await gotoAppContentTask('Financial features');
    await click("My app doesn't provide any financial features");
    await saveish(); await click('Save', { optional: true });
  },
  async government() {
    await gotoAppContentTask('Government apps');
    await click('No');
    await click('Save');
  },
  async health() {
    await gotoAppContentTask('Health');
    await click('My app does not have any health features', { optional: true });
    await saveish();
  },
  async category() {
    const href = await evaluate('location.href');
    const m = href.match(/developers\/(\d+)\/app\/([\w-]+)\//);
    if (!m) throw new Error('open the app first (run any other task)');
    await goto(`https://play.google.com/console/u/0/developers/${m[1]}/app/${m[2]}/store-settings`);
    await click('Edit', { optional: true });
    await click('App category', { optional: true });
    await click(ANSWERS.category);
    await click('Save');
  },
  async declarations() {
    for (const t of ['privacy', 'app-access', 'ads', 'content-rating', 'target-audience', 'data-safety', 'financial', 'government', 'health', 'category']) {
      console.log(`\n== ${t} ==`);
      try { await MACROS[t](); console.log(`== ${t} DONE ==`); }
      catch (e) { const f = await shot(`FAIL-${t}`); console.log(`== ${t} FAILED: ${e.message}\n   screenshot: ${f}\n   (finish with primitives: texts/click/type, then continue) ==`); }
      await wait(1000);
    }
  },
};

// ── CLI ──
const cmd = process.argv[2];
try {
  if (MACROS[cmd]) { await MACROS[cmd](); await shot(cmd + '-end'); }
  else if (cmd === 'goto') await goto(process.argv[3]);
  else if (cmd === 'click') await click(process.argv[3]);
  else if (cmd === 'type') await type(process.argv[3], process.argv[4]);
  else if (cmd === 'clickxy') { await mouseClick(Number(process.argv[3]), Number(process.argv[4])); await wait(300); if (process.argv[5]) { await send('Input.insertText', { text: process.argv[5] }); } }
  else if (cmd === 'eval') console.log(JSON.stringify(await evaluate(process.argv[3])));
  else if (cmd === 'texts') console.log((await texts()).join('\n'));
  else if (cmd === 'shot') console.log(await shot(process.argv[3] || 'manual'));
  else if (cmd === 'url') console.log(await evaluate('location.href'));
  else console.log('macros: create-app | declarations | ' + Object.keys(MACROS).filter((k) => !['create-app', 'declarations'].includes(k)).join(' | ') + '\nprimitives: goto <url> | texts | click "<text>" | type "<label>" "<value>" | shot [name] | url');
} catch (e) {
  const f = await shot('ERROR');
  console.error(`FAILED: ${e.message}\nscreenshot: ${f}\nInspect with: node scripts/play-console-bot.mjs texts`);
  process.exitCode = 1;
}
try { ws.close(); } catch {}
process.exit(process.exitCode || 0); // force exit; the CDP WebSocket otherwise keeps node alive
