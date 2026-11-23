/* Resubmit the iOS review submission that has unresolved issues (after replying to App Review).
 *   node scripts/store/asc-resubmit.mjs        # show submissions
 *   node scripts/store/asc-resubmit.mjs --go   # resubmit the one with unresolved issues
 */
import { asc } from './asc-client.mjs';
const app = (await asc('GET', '/v1/apps?filter[bundleId]=com.studymusictheory.pitchline')).data[0];
const subs = (await asc('GET', `/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&limit=10`)).data;
for (const s of subs) console.log(s.id, s.attributes.state, s.attributes.submittedDate);
const open = subs.find((s) => s.attributes.state === 'UNRESOLVED_ISSUES');
if (!open) { console.log('nothing to resubmit'); process.exit(0); }
if (process.argv.includes('--go')) {
  // a REJECTED item blocks resubmission ("Version is not ready to be submitted") until it is marked resolved
  for (const it of (await asc('GET', `/v1/reviewSubmissions/${open.id}/items`)).data) {
    if (it.attributes.state === 'REJECTED') await asc('PATCH', `/v1/reviewSubmissionItems/${it.id}`, { data: { type: 'reviewSubmissionItems', id: it.id, attributes: { resolved: true } } });
  }
  const r = await asc('PATCH', `/v1/reviewSubmissions/${open.id}`, { data: { type: 'reviewSubmissions', id: open.id, attributes: { submitted: true } } });
  console.log('now', r.data.attributes.state);
}
