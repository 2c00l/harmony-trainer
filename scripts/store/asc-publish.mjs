/* App Store Connect: Pitchline listing, categories, age rating, price, availability, review contact,
 * screenshots, and (with --submit) build attach + submission. Idempotent; each step logs OK/FAIL.
 *
 *   node scripts/store/asc-publish.mjs            # everything except submission
 *   node scripts/store/asc-publish.mjs --submit   # also attach the newest VALID build and submit
 * Based on the Lexayo scripts (asc-listing.mjs / asc-screenshots.mjs).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY_ID = '59TLDRYTXN';
const BUNDLE_ID = 'com.studymusictheory.pitchline';
const VERSION = '1.0.0';
const LOCALES = ['en-GB', 'en-US'];
const PRICE_USD = '4.99';
const KEYS_DIR = path.join(os.homedir(), '.appstoreconnect');
const SUBMIT = process.argv.includes('--submit');

const md = fs.readFileSync('store/listing.md', 'utf8');
const COPY = {
  name: 'Pitchline: Sing in Tune',
  subtitle: 'See your voice. Sing harmony.',
  promotionalText: 'Sing along with your own songs: Pitchline takes the vocal out on your phone, shows every note, and writes a harmony part for you to sing.',
  keywords: 'singing,pitch,tuner,vocal,harmony,karaoke,voice,choir,ear training,sing,intonation,practice',
  description: md.split('## Full description (both stores)')[1].trim(),
  supportUrl: 'https://studymusictheory.com/support.html',
  marketingUrl: 'https://studymusictheory.com/pitchline/',
  privacyPolicyUrl: 'https://studymusictheory.com/pitchline/privacy/',
  copyright: '2026 Study Music Theory',
};
const NOTES = fs.readFileSync('store/review-notes.txt', 'utf8').trim();

function issuerId() { return process.env.ASC_ISSUER_ID || JSON.parse(fs.readFileSync(path.join(KEYS_DIR, 'config.json'), 'utf8')).issuerId; }
function token() {
  const key = fs.readFileSync(path.join(KEYS_DIR, 'private_keys', `AuthKey_${KEY_ID}.p8`), 'utf8');
  const b64u = (s) => Buffer.from(s).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: issuerId(), iat: now - 60, exp: now + 1140, aud: 'appstoreconnect-v1' }));
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${sig.toString('base64url')}`;
}
async function api(method, apiPath, body) {
  const res = await fetch('https://api.appstoreconnect.apple.com' + apiPath, { method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const errs = (json.errors ?? []).map((e) => `${e.code}: ${e.detail ?? e.title}${e.source?.pointer ? ' @' + e.source.pointer : ''}`);
    throw new Error(`${method} ${apiPath} -> ${res.status} ${errs.join(' | ') || text.slice(0, 300)}`);
  }
  return json;
}
async function all(apiPath) {
  let out = [], url = apiPath;
  while (url) { const r = await api('GET', url); out = out.concat(r.data); url = r.links?.next ? r.links.next.replace('https://api.appstoreconnect.apple.com', '') : null; }
  return out;
}
const results = [];
async function step(name, fn) {
  try { const msg = await fn(); results.push(`OK   ${name}${msg ? ' - ' + msg : ''}`); }
  catch (e) { results.push(`FAIL ${name} - ${e.message}`); }
  console.log(results[results.length - 1]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = (await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
if (!app) throw new Error('no app record for ' + BUNDLE_ID);
console.log(`app ${app.id} "${app.attributes.name}" primary ${app.attributes.primaryLocale}`);
const editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];
let version = (await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data.find((v) => editable.includes(v.attributes.appStoreState));
if (!version) version = (await api('POST', '/v1/appStoreVersions', { data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: VERSION, releaseType: 'AFTER_APPROVAL' }, relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
console.log(`version ${version.id} ${version.attributes.versionString} ${version.attributes.appStoreState}`);

await step('version string + copyright', async () => {
  await api('PATCH', `/v1/appStoreVersions/${version.id}`, { data: { type: 'appStoreVersions', id: version.id, attributes: { versionString: VERSION, copyright: COPY.copyright } } });
});
let vlocs = (await api('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data;
for (const locale of LOCALES) {
  await step(`version localization ${locale}`, async () => {
    const attrs = { description: COPY.description, keywords: COPY.keywords, promotionalText: COPY.promotionalText, supportUrl: COPY.supportUrl, marketingUrl: COPY.marketingUrl };
    const v = vlocs.find((l) => l.attributes.locale === locale);
    if (v) { await api('PATCH', `/v1/appStoreVersionLocalizations/${v.id}`, { data: { type: 'appStoreVersionLocalizations', id: v.id, attributes: attrs } }); return 'updated'; }
    await api('POST', '/v1/appStoreVersionLocalizations', { data: { type: 'appStoreVersionLocalizations', attributes: { locale, ...attrs }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } });
    return 'created';
  });
}
vlocs = (await api('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data;

const infos = (await api('GET', `/v1/apps/${app.id}/appInfos`)).data;
const info = infos.find((i) => editable.includes(i.attributes.appStoreState ?? i.attributes.state)) ?? infos[0];
const ilocs = (await api('GET', `/v1/appInfos/${info.id}/appInfoLocalizations`)).data;
for (const locale of LOCALES) {
  await step(`app info localization ${locale}`, async () => {
    const attrs = { name: COPY.name, subtitle: COPY.subtitle, privacyPolicyUrl: COPY.privacyPolicyUrl };
    const i = ilocs.find((l) => l.attributes.locale === locale);
    if (i) { await api('PATCH', `/v1/appInfoLocalizations/${i.id}`, { data: { type: 'appInfoLocalizations', id: i.id, attributes: attrs } }); return 'updated'; }
    await api('POST', '/v1/appInfoLocalizations', { data: { type: 'appInfoLocalizations', attributes: { locale, ...attrs }, relationships: { appInfo: { data: { type: 'appInfos', id: info.id } } } } });
    return 'created';
  });
}
await step('categories', async () => {
  await api('PATCH', `/v1/appInfos/${info.id}`, { data: { type: 'appInfos', id: info.id, relationships: { primaryCategory: { data: { type: 'appCategories', id: 'MUSIC' } }, secondaryCategory: { data: { type: 'appCategories', id: 'EDUCATION' } } } } });
  return 'MUSIC / EDUCATION';
});
await step('age rating declaration', async () => {
  const decl = (await api('GET', `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data;
  const ENUMS = ['alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'gunsOrOtherWeapons', 'horrorOrFearThemes', 'matureOrSuggestiveThemes', 'medicalOrTreatmentInformation', 'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity', 'sexualContentOrNudity', 'violenceCartoonOrFantasy', 'violenceRealistic', 'violenceRealisticProlongedGraphicOrSadistic'];
  const SKIP = ['kidsAgeBand', 'ageRatingOverride', 'ageRatingOverrideV2', 'koreaAgeRatingOverride', 'gracRatingClassificationNumber', 'developerAgeRatingInfoUrl'];
  const attrs = {};
  for (const k of Object.keys(decl.attributes)) if (!SKIP.includes(k)) attrs[k] = ENUMS.includes(k) ? 'NONE' : false;
  const dropped = [];
  for (let tries = 0; tries < 14; tries++) {
    try {
      await api('PATCH', `/v1/ageRatingDeclarations/${decl.id}`, { data: { type: 'ageRatingDeclarations', id: decl.id, attributes: attrs } });
      const after = (await api('GET', `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data.attributes;
      const unset = Object.keys(after).filter((k) => after[k] === null && !SKIP.includes(k));
      return `${Object.keys(attrs).length} answers none/false` + (dropped.length ? `; adjusted: ${dropped.join(', ')}` : '') + (unset.length ? `; still empty: ${unset.join(', ')}` : '');
    } catch (e) {
      const m = e.message.match(/@\/data\/attributes\/(\w+)/) || e.message.match(/'(\w+)'/);
      const k = m && m[1];
      if (!k || !(k in attrs)) throw e;
      if (typeof attrs[k] === 'boolean' && !dropped.includes(k + '?')) { attrs[k] = 'NONE'; dropped.push(k + '?'); }
      else if (attrs[k] === 'NONE' && !ENUMS.includes(k)) { delete attrs[k]; dropped.push(k); }
      else if (attrs[k] === 'NONE') { attrs[k] = false; ENUMS.splice(ENUMS.indexOf(k), 1); }
      else { delete attrs[k]; dropped.push(k); }
    }
  }
  throw new Error('age rating: too many retries');
});
await step('content rights', async () => {
  await api('PATCH', `/v1/apps/${app.id}`, { data: { type: 'apps', id: app.id, attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } } });
});
await step(`price (USD ${PRICE_USD})`, async () => {
  const points = await all(`/v1/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`);
  const pt = points.find((p) => p.attributes.customerPrice === PRICE_USD || Number(p.attributes.customerPrice) === Number(PRICE_USD));
  if (!pt) throw new Error('no price point ' + PRICE_USD);
  await api('POST', '/v1/appPriceSchedules', { data: { type: 'appPriceSchedules', relationships: { app: { data: { type: 'apps', id: app.id } }, baseTerritory: { data: { type: 'territories', id: 'USA' } }, manualPrices: { data: [{ type: 'appPrices', id: '${p}' }] } } }, included: [{ type: 'appPrices', id: '${p}', attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: 'appPricePoints', id: pt.id } } } }] });
  return `base territory USA ${pt.attributes.customerPrice} (others follow Apple's equalised prices)`;
});
await step('availability (all territories)', async () => {
  try {
    const cur = await api('GET', `/v1/apps/${app.id}/appAvailabilityV2`);
    if (cur.data) {
      const ta = await all(`/v2/appAvailabilities/${cur.data.id}/territoryAvailabilities?include=territory&limit=200`);
      // China mainland needs a government security assessment + AIGC filing: left out on purpose
      const off = ta.filter((t) => !t.attributes.available && !String(t.id).includes('CHN') && t.relationships?.territory?.data?.id !== 'CHN');
      for (const t of off) await api('PATCH', `/v1/territoryAvailabilities/${t.id}`, { data: { type: 'territoryAvailabilities', id: t.id, attributes: { available: true } } });
      return `${ta.length} territories (${off.length} enabled now)`;
    }
  } catch (e) { if (!/404|NOT_FOUND/.test(e.message)) throw e; }
  const terr = await all('/v1/territories?limit=200');
  await api('POST', '/v2/appAvailabilities', { data: { type: 'appAvailabilities', attributes: { availableInNewTerritories: true }, relationships: { app: { data: { type: 'apps', id: app.id } }, territoryAvailabilities: { data: terr.filter((t) => t.id !== 'CHN').map((t) => ({ type: 'territoryAvailabilities', id: '${' + t.id + '}' })) } } }, included: terr.filter((t) => t.id !== 'CHN').map((t) => ({ type: 'territoryAvailabilities', id: '${' + t.id + '}', attributes: { available: true, releaseDate: null, preOrderEnabled: false }, relationships: { territory: { data: { type: 'territories', id: t.id } } } })) });
  return `${terr.length} territories + new ones automatically`;
});
await step('app review details', async () => {
  // reuse the contact (name, phone, email) from another of the account's apps
  let contact = null;
  for (const a of (await api('GET', '/v1/apps?limit=50')).data) {
    if (a.id === app.id) continue;
    const vs = (await api('GET', `/v1/apps/${a.id}/appStoreVersions?limit=3`)).data;
    for (const v of vs) {
      try { const d = (await api('GET', `/v1/appStoreVersions/${v.id}/appStoreReviewDetail`)).data; if (d?.attributes?.contactPhone) { contact = d.attributes; break; } } catch { /* none */ }
    }
    if (contact) break;
  }
  if (!contact) throw new Error('no existing review contact to reuse');
  const attrs = { contactFirstName: contact.contactFirstName, contactLastName: contact.contactLastName, contactPhone: contact.contactPhone, contactEmail: contact.contactEmail, demoAccountRequired: false, notes: NOTES };
  let det = null;
  try { det = (await api('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)).data; } catch (e) { if (!/404/.test(e.message)) throw e; }
  if (det) await api('PATCH', `/v1/appStoreReviewDetails/${det.id}`, { data: { type: 'appStoreReviewDetails', id: det.id, attributes: attrs } });
  else await api('POST', '/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes: attrs, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } });
  return `contact ${attrs.contactFirstName} ${attrs.contactLastName}`;
});

// screenshots
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const SETS = [['artifacts/store/ios-6.9', ['APP_IPHONE_69', 'APP_IPHONE_67']], ['artifacts/store/ipad-13', ['APP_IPAD_PRO_3GEN_129']]];
for (const locale of LOCALES) {
  const vloc = vlocs.find((l) => l.attributes.locale === locale);
  if (!vloc) continue;
  await step(`screenshots ${locale}`, async () => {
    const sets = (await api('GET', `/v1/appStoreVersionLocalizations/${vloc.id}/appScreenshotSets?limit=50`)).data;
    const log = [];
    for (const [dir, types] of SETS) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
      let set = sets.find((s) => types.includes(s.attributes.screenshotDisplayType));
      if (!set) {
        for (const t of types) {
          try { set = (await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: t }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: vloc.id } } } } })).data; break; }
          catch (e) { if (t === types[types.length - 1]) throw e; }
        }
      }
      const have = (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)).data;
      const same = have.length === files.length && have.every((s, i) => s.attributes.fileName === files[i] && s.attributes.sourceFileChecksum === md5(fs.readFileSync(path.join(dir, files[i]))) && s.attributes.assetDeliveryState?.state === 'COMPLETE');
      if (same) { log.push(`${set.attributes.screenshotDisplayType} already ${files.length}`); continue; }
      for (const s of have) await api('DELETE', `/v1/appScreenshots/${s.id}`);
      const ids = [];
      for (const fileName of files) {
        const buf = fs.readFileSync(path.join(dir, fileName));
        const r = (await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName, fileSize: buf.length }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } })).data;
        for (const op of r.attributes.uploadOperations) {
          const headers = {}; for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
          const up = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
          if (!up.ok) throw new Error(`upload ${fileName} -> ${up.status}`);
        }
        await api('PATCH', `/v1/appScreenshots/${r.id}`, { data: { type: 'appScreenshots', id: r.id, attributes: { uploaded: true, sourceFileChecksum: md5(buf) } } });
        ids.push(r.id);
      }
      await api('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: 'appScreenshots', id })) });
      log.push(`${set.attributes.screenshotDisplayType} uploaded ${ids.length}`);
    }
    return log.join('; ');
  });
}

if (SUBMIT) {
  await step('build attach', async () => {
    const builds = (await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5`)).data;
    const b = builds.find((x) => x.attributes.processingState === 'VALID');
    if (!b) throw new Error('no VALID build yet: ' + builds.map((x) => `${x.attributes.version}:${x.attributes.processingState}`).join(', '));
    if (b.attributes.usesNonExemptEncryption !== false) await api('PATCH', `/v1/builds/${b.id}`, { data: { type: 'builds', id: b.id, attributes: { usesNonExemptEncryption: false } } });
    await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: b.id } });
    return `build ${b.attributes.version}`;
  });
  await step('submit for review', async () => {
    const sub = (await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
    await api('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } });
    await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
    return `submission ${sub.id}`;
  });
}
console.log('\nSUMMARY\n' + results.join('\n'));
void sleep;
