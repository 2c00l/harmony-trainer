// node scripts/render-svg.mjs in.svg out.png size [transparent]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [inp, out, size, transparent] = process.argv.slice(2);
const svg = readFileSync(inp, 'utf8');
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: Number(size), height: Number(size) }, deviceScaleFactor: 1 });
await p.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : '#000'}">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
await p.screenshot({ path: out, omitBackground: !!transparent });
await b.close();
