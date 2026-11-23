/* Push store/review-notes.txt into the App Review Information notes of the current iOS version. */
import fs from 'node:fs';
import { asc } from './asc-client.mjs';
const notes = fs.readFileSync('store/review-notes.txt', 'utf8').trim();
const app = (await asc('GET', '/v1/apps?filter[bundleId]=com.studymusictheory.pitchline')).data[0];
const versions = (await asc('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=5`)).data;
const v = versions[0];
console.log('version', v.attributes.versionString, v.attributes.appStoreState);
const det = (await asc('GET', `/v1/appStoreVersions/${v.id}/appStoreReviewDetail`)).data;
await asc('PATCH', `/v1/appStoreReviewDetails/${det.id}`, { data: { type: 'appStoreReviewDetails', id: det.id, attributes: { notes } } });
const check = (await asc('GET', `/v1/appStoreReviewDetails/${det.id}`)).data.attributes.notes;
console.log(check === notes ? `OK notes saved (${notes.length} chars)` : 'MISMATCH');
