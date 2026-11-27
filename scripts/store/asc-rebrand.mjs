// Update only branding, release copy and screenshots; preserve pricing and availability.
// Usage: node scripts/store/asc-rebrand.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { asc } from './asc-client.mjs';

const apply = process.argv.includes('--apply');
const versionString = JSON.parse(fs.readFileSync('package.json')).version;
const name = 'PitchSense: Sing in Tune';
const listing = fs.readFileSync('store/listing.md', 'utf8');
const description = listing.split('## Full description (both stores)')[1].trim();
const promotionalText = listing.match(/Promotional text \(170\): (.+)/)[1];
const whatsNew = fs.readFileSync('store/whats-new.txt', 'utf8').trim();
const screenshotTargets = [
  ['APP_IPHONE_67', 'artifacts/store/ios-6.9'],
  ['APP_IPAD_PRO_3GEN_129', 'artifacts/store/ipad-13'],
];
if (name.length > 30 || promotionalText.length > 170 || /pitchline/i.test(description)) throw Error('Invalid branding copy');
for (const [, directory] of screenshotTargets) {
  if (fs.readdirSync(directory).filter(f => f.endsWith('.png')).length !== 8) throw Error('Expected eight screenshots: ' + directory);
}
const app = (await asc('GET', '/v1/apps?filter[bundleId]=com.studymusictheory.pitchline')).data[0];
const versions = (await asc('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data;
let version = versions.find(v => v.attributes.versionString === versionString);
console.log(JSON.stringify({app: app.id, name, versionString, state: version?.attributes.appStoreState, apply}));
if (!apply) process.exit(0);
if (!version) version = (await asc('POST', '/v1/appStoreVersions', {data: {
  type: 'appStoreVersions', attributes: {platform: 'IOS', versionString, releaseType: 'AFTER_APPROVAL', copyright: '2026 Study Music Theory'},
  relationships: {app: {data: {type: 'apps', id: app.id}}},
}})).data;
const editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'];
if (!editable.includes(version.attributes.appStoreState)) throw Error('Version is not editable');
const infos = (await asc('GET', `/v1/apps/${app.id}/appInfos`)).data;
const info = infos.find(i => editable.includes(i.attributes.appStoreState));
if (!info) throw Error('No editable app info');
const infoLocs = (await asc('GET', `/v1/appInfos/${info.id}/appInfoLocalizations`)).data;
for (const loc of infoLocs) {
  await asc('PATCH', `/v1/appInfoLocalizations/${loc.id}`, {data: {type: 'appInfoLocalizations', id: loc.id, attributes: {
    name, privacyPolicyUrl: 'https://studymusictheory.com/pitchsense/privacy/',
  }}});
  console.log('name and privacy URL:', loc.attributes.locale);
}
const locs = (await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data;
for (const loc of locs) {
  await asc('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {data: {type: 'appStoreVersionLocalizations', id: loc.id, attributes: {
    description, promotionalText, whatsNew, marketingUrl: 'https://studymusictheory.com/pitchsense/',
  }}});
  const sets = (await asc('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)).data;
  for (const [displayType, directory] of screenshotTargets) {
    const files = fs.readdirSync(directory).filter(f => f.endsWith('.png')).sort();
    let set = sets.find(s => s.attributes.screenshotDisplayType === displayType);
    if (!set) set = (await asc('POST', '/v1/appScreenshotSets', {data: {type: 'appScreenshotSets', attributes: {screenshotDisplayType: displayType}, relationships: {appStoreVersionLocalization: {data: {type: 'appStoreVersionLocalizations', id: loc.id}}}}})).data;
    const existing = (await asc('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)).data;
    const checksum = f => crypto.createHash('md5').update(fs.readFileSync(path.join(directory, f))).digest('hex');
    if (existing.length === files.length && existing.every((s, i) => s.attributes.fileName === files[i] && s.attributes.sourceFileChecksum === checksum(files[i]) && s.attributes.assetDeliveryState?.state === 'COMPLETE')) {
      console.log(loc.attributes.locale, displayType, 'already current'); continue;
    }
    // Existing files remain in the live version. Replace only this new version's copies.
    for (const screenshot of existing) await asc('DELETE', `/v1/appScreenshots/${screenshot.id}`);
    const ids = [];
    for (const fileName of files) {
      const buffer = fs.readFileSync(path.join(directory, fileName));
      const screenshot = (await asc('POST', '/v1/appScreenshots', {data: {type: 'appScreenshots', attributes: {fileName, fileSize: buffer.length}, relationships: {appScreenshotSet: {data: {type: 'appScreenshotSets', id: set.id}}}}})).data;
      for (const operation of screenshot.attributes.uploadOperations) {
        const response = await fetch(operation.url, {method: operation.method, headers: Object.fromEntries(operation.requestHeaders.map(h => [h.name, h.value])), body: buffer.subarray(operation.offset, operation.offset + operation.length)});
        if (!response.ok) throw Error('Screenshot upload failed: ' + response.status);
      }
      await asc('PATCH', `/v1/appScreenshots/${screenshot.id}`, {data: {type: 'appScreenshots', id: screenshot.id, attributes: {uploaded: true, sourceFileChecksum: checksum(fileName)}}});
      ids.push(screenshot.id);
    }
    await asc('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {data: ids.map(id => ({type: 'appScreenshots', id}))});
    console.log(loc.attributes.locale, displayType, 'uploaded', ids.length);
  }
}
console.log('Branding ready for release', versionString, version.id);
