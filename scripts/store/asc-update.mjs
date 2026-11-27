/* Ship an update to the live iOS app: creates (or reuses) the new App Store version, sets What's New
 * (store/whats-new.txt), carries over App Review contact + notes (store/review-notes.txt), attaches the
 * newest VALID build of that version and submits it for review.
 *   node scripts/store/asc-update.mjs 1.0.1            # dry run: shows what it would do
 *   node scripts/store/asc-update.mjs 1.0.1 --prepare  # attach build and copy, without submitting
 *   node scripts/store/asc-update.mjs 1.0.1 --submit
 */
import fs from 'node:fs';
import { asc } from './asc-client.mjs';

const VERSION = process.argv[2];
const SUBMIT = process.argv.includes('--submit');
const APPLY = SUBMIT || process.argv.includes('--prepare');
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) throw new Error('usage: asc-update.mjs <x.y.z> [--submit]');
const whatsNew = fs.readFileSync('store/whats-new.txt', 'utf8').trim();
const notes = fs.readFileSync('store/review-notes.txt', 'utf8').trim();
const app = (await asc('GET', '/v1/apps?filter[bundleId]=com.studymusictheory.pitchline')).data[0];

// the build: newest VALID one uploaded for this marketing version
const builds = (await asc('GET', `/v1/builds?filter[app]=${app.id}&filter[preReleaseVersion.version]=${VERSION}&sort=-uploadedDate&limit=5`)).data;
const build = builds.find((b) => b.attributes.processingState === 'VALID');
console.log('builds', builds.map((b) => `${b.attributes.version}:${b.attributes.processingState}`).join(', ') || 'none');
if (!build && (!APPLY || SUBMIT)) { console.log('NOT READY: no VALID build for', VERSION); process.exit(2); }

const versions = (await asc('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data;
const live = versions.find((v) => v.attributes.appStoreState === 'READY_FOR_SALE');
let version = versions.find((v) => v.attributes.versionString === VERSION);
if (!APPLY) { console.log('dry run: would use build', build.attributes.version, 'version', version ? version.attributes.appStoreState : 'new'); process.exit(0); }
if (!version) {
  version = (await asc('POST', '/v1/appStoreVersions', { data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: VERSION, releaseType: 'AFTER_APPROVAL', copyright: live?.attributes.copyright }, relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
  console.log('created version', VERSION);
} else console.log('version', VERSION, version.attributes.appStoreState);

// What's New in every localization (they are copied from the live version on create)
const locs = (await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data;
for (const l of locs) {
  await asc('PATCH', `/v1/appStoreVersionLocalizations/${l.id}`, { data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew } } });
  console.log('whatsNew', l.attributes.locale);
}

// App Review information: copy the live version's contact, set the notes
const det = (await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => ({ data: null }))).data;
const prev = live ? (await asc('GET', `/v1/appStoreVersions/${live.id}/appStoreReviewDetail`).catch(() => ({ data: null }))).data : null;
const pick = (a = {}) => Object.fromEntries(['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail', 'demoAccountRequired'].map((k) => [k, a[k]]).filter(([, v]) => v != null));
if (det) await asc('PATCH', `/v1/appStoreReviewDetails/${det.id}`, { data: { type: 'appStoreReviewDetails', id: det.id, attributes: { ...pick(prev?.attributes), ...pick(det.attributes), notes } } });
else await asc('POST', '/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes: { ...pick(prev?.attributes), notes }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } });
console.log('review details set');

// build
if (!build) { console.log('Metadata prepared; waiting for a VALID build for', VERSION); process.exit(2); }
if (build.attributes.usesNonExemptEncryption !== false) await asc('PATCH', `/v1/builds/${build.id}`, { data: { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } } });
await asc('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: build.id } });
console.log('attached build', build.attributes.version);
if (!SUBMIT) { console.log('Prepared for review; not submitted.'); process.exit(0); }

// submit (reuse a draft submission if one exists)
let sub = (await asc('GET', `/v1/reviewSubmissions?filter[app]=${app.id}&filter[state]=READY_FOR_REVIEW&limit=5`)).data[0];
if (!sub) sub = (await asc('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
const items = (await asc('GET', `/v1/reviewSubmissions/${sub.id}/items`)).data;
if (!items.length) await asc('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } });
await asc('PATCH', `/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
const after = (await asc('GET', `/v1/appStoreVersions/${version.id}`)).data.attributes.appStoreState;
console.log('SUBMITTED', VERSION, 'build', build.attributes.version, '→', after);
