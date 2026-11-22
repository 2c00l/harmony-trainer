/* Replace the build on the iOS version that is waiting for review, then resubmit.
 *   node scripts/store/asc-swap-build.mjs <buildNumber>
 * Cancels the active review submission, waits until the version is editable again, attaches the
 * given (VALID) build and submits a new review submission.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = '6838078108';
const BUILD = process.argv[2];
const K = path.join(os.homedir(), '.appstoreconnect'), KEY_ID = '59TLDRYTXN';
const iss = JSON.parse(fs.readFileSync(path.join(K, 'config.json'), 'utf8')).issuerId;
const key = fs.readFileSync(path.join(K, 'private_keys', `AuthKey_${KEY_ID}.p8`), 'utf8');
const tok = () => { const b = (s) => Buffer.from(s).toString('base64url'); const now = Math.floor(Date.now() / 1000);
  const h = b(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })), p = b(JSON.stringify({ iss, iat: now - 60, exp: now + 1000, aud: 'appstoreconnect-v1' }));
  return `${h}.${p}.${crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`; };
const api = async (m, u, body) => { const r = await fetch('https://api.appstoreconnect.apple.com' + u, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${u} -> ${r.status} ${t.slice(0, 500)}`); return t ? JSON.parse(t) : {}; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const build = (await api('GET', `/v1/builds?filter[app]=${APP}&filter[version]=${BUILD}`)).data[0];
if (!build || build.attributes.processingState !== 'VALID') throw new Error(`build ${BUILD} not VALID yet`);

// 1. pull the version out of review
const subs = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=20`)).data;
for (const s of subs.filter((x) => ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'READY_FOR_REVIEW', 'UNRESOLVED_ISSUES'].includes(x.attributes.state))) {
  await api('PATCH', `/v1/reviewSubmissions/${s.id}`, { data: { type: 'reviewSubmissions', id: s.id, attributes: { canceled: true } } });
  console.log('cancelled submission', s.id, s.attributes.state);
}
// 2. wait for the version to be editable
let version;
for (let i = 0; i < 40; i++) {
  version = (await api('GET', `/v1/apps/${APP}/appStoreVersions?filter[platform]=IOS&limit=5`)).data[0];
  if (['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'].includes(version.attributes.appStoreState)) break;
  await sleep(15000);
}
console.log('version', version.attributes.versionString, version.attributes.appStoreState);
// 3. attach the new build
if (build.attributes.usesNonExemptEncryption !== false) await api('PATCH', `/v1/builds/${build.id}`, { data: { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } } });
await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: build.id } });
console.log('attached build', BUILD);
// 4. resubmit (reuse a draft submission if one exists)
let sub = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&filter[state]=READY_FOR_REVIEW&limit=5`)).data[0];
if (!sub) sub = (await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP } } } } })).data;
const items = (await api('GET', `/v1/reviewSubmissions/${sub.id}/items`)).data;
if (!items.length) await api('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } });
await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
console.log('resubmitted', sub.id);
