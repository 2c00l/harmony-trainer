/* Google Play: listing text, contact details, every image type and the signed bundle, in one edit.
 * Auth: service account at C:/Users/c_sen/Keystores/play-service-account.json.
 * The app record itself is created once in Play Console (the API cannot).
 *
 *   node scripts/store/play-publish.mjs [track] [status]
 *     track:  internal (default) | alpha | beta | production
 *     status: completed (default) | draft
 *   node scripts/store/play-publish.mjs --listing-only
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PKG = 'com.studymusictheory.pitchline';
const SA = JSON.parse(fs.readFileSync('C:/Users/c_sen/Keystores/play-service-account.json', 'utf8'));
const AAB = 'android/app/build/outputs/bundle/release/app-release.aab';
const args = process.argv.slice(2);
const LISTING_ONLY = args.includes('--listing-only');
const RELEASE_ONLY = args.includes('--release-only');
const PREPARE_ONLY = args.includes('--prepare-only');
const TRACK = args.find((a) => !a.startsWith('--')) || 'internal';
const STATUS = args.filter((a) => !a.startsWith('--'))[1] || 'completed';

const md = fs.readFileSync('store/listing.md', 'utf8');
const full = md.split('## Full description (both stores)')[1].trim();
const LISTING = {
  title: 'PitchSense: Sing in Tune',
  shortDescription: 'See your pitch live, sing harmonies and sing along with the songs you love.',
  fullDescription: full,
};
const LANGS = ['en-US', 'en-GB'];

const b64u = (s) => Buffer.from(s).toString('base64url');
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: SA.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claim}`), SA.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${claim}.${sig.toString('base64url')}` });
  const j = await r.json();
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j));
  return j.access_token;
}
const tok = await accessToken();
async function api(method, p, body, { upload = false, type = 'application/json' } = {}) {
  const base = upload ? 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/' : 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';
  const r = await fetch(base + PKG + p + (upload ? (p.includes('?') ? '&' : '?') + 'uploadType=media' : ''), {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': upload ? type : 'application/json' },
    body: upload ? body : body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}\n${JSON.stringify(j, null, 2)}`);
  return j;
}

const edit = await api('POST', '/edits', {});
const E = `/edits/${edit.id}`;
console.log('edit', edit.id);

if (!RELEASE_ONLY) await api('PUT', `${E}/details`, { defaultLanguage: 'en-US', contactEmail: 'charliesendrowski@googlemail.com', contactWebsite: 'https://studymusictheory.com/pitchsense/' });
for (const lang of RELEASE_ONLY ? [] : LANGS) {
  const current = await api('GET', `${E}/listings/${lang}`).catch(() => ({}));
  const video = fs.existsSync('store/promo-video.txt') ? fs.readFileSync('store/promo-video.txt', 'utf8').trim() : current.video;
  await api('PUT', `${E}/listings/${lang}`, { language: lang, ...LISTING, ...(video ? { video } : {}) });
  // images: replace whatever is there
  const sets = [
    ['icon', ['artifacts/store/graphics/icon-512.png']],
    ['featureGraphic', ['artifacts/store/graphics/feature-graphic-1024x500.png']],
    ['phoneScreenshots', dir('artifacts/store/play-phone')],
    ['sevenInchScreenshots', dir('artifacts/store/play-tablet-7')],
    ['tenInchScreenshots', dir('artifacts/store/play-tablet-10')],
  ];
  for (const [type, files] of sets) {
    await api('DELETE', `${E}/listings/${lang}/${type}`).catch(() => {});
    for (const f of files) await api('POST', `${E}/listings/${lang}/${type}`, fs.readFileSync(f), { upload: true, type: 'image/png' });
    console.log(lang, type, files.length);
  }
}

if (!LISTING_ONLY) {
  // reuse a bundle Play already has for this version code; otherwise upload it
  const have = (await api('GET', `${E}/bundles`)).bundles || [];
  const vc = Number((fs.readFileSync('android/app/build.gradle', 'utf8').match(/versionCode (\d+)/) || [])[1]);
  const bundle = have.find((b) => b.versionCode === vc) || await api('POST', `${E}/bundles`, fs.readFileSync(AAB), { upload: true, type: 'application/octet-stream' });
  console.log('bundle versionCode', bundle.versionCode);
  // release notes: store/whats-new.txt (Play limit 500 characters)
  const versionName = (fs.readFileSync('android/app/build.gradle', 'utf8').match(/versionName "([^"]+)"/) || [])[1] || '1.0.0';
  const notes = fs.readFileSync('store/whats-new.txt', 'utf8').trim().slice(0, 500);
  await api('PUT', `${E}/tracks/${TRACK}`, {
    track: TRACK,
    releases: [{ name: `${versionName} (${bundle.versionCode})`, versionCodes: [String(bundle.versionCode)], status: STATUS, releaseNotes: ['en-US', 'en-GB'].map((language) => ({ language, text: notes })) }],
  });
  console.log('track', TRACK, STATUS);
}
await api('POST', `${E}:validate`, null);
if (PREPARE_ONLY) {
  fs.writeFileSync('artifacts/play-prepared-edit.json', JSON.stringify({ packageName: PKG, editId: edit.id, expiryTimeSeconds: edit.expiryTimeSeconds, track: TRACK, title: LISTING.title }, null, 2) + '\n');
  console.log('validated and prepared; not committed', edit.id);
  process.exit(0);
}
const done = await api('POST', `${E}:commit`, null).catch(async (e) => {
  // a new app's first edits may need changesNotSentForReview
  if (String(e.message).includes('changesNotSentForReview')) return api('POST', `${E}:commit?changesNotSentForReview=true`, null);
  throw e;
});
console.log('committed', done.id);

function dir(d) { return fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(d, f)); }
