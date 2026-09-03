#!/usr/bin/env node
/**
 * Re-post the leads that never reached Smart 1 Suite.
 *
 * leadStore writes every lead down before the webhook is attempted and marks
 * what happened to it. Anything whose last event is not 'sent' is a lead
 * somebody is owed, and this is what sends it.
 *
 * Two sources, and the second is the one that matters after an incident:
 *   - the local leads.jsonl -- instant, and correct while the instance that
 *     took the lead is still up.
 *   - --from-cloudinary -- the durable copy. This service has no Render disk,
 *     so a redeploy takes the local log with it; without this flag the mirror
 *     would be a store nothing ever reads, which is the same as not having one.
 *
 *   node replayFailed.js --dry-run           list what is owed
 *   node replayFailed.js                     re-post from the local log
 *   node replayFailed.js --from-cloudinary   re-post from the mirror
 *   node replayFailed.js --lead-id abc123    just this one
 *
 * Safe to run twice: a lead that posts is marked 'sent' and drops out of the
 * set on the next run. A lead that fails again keeps its place.
 */
import 'dotenv/config';
import * as leadStore from './lib/leadStore.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : '';
};

/**
 * Every mirrored lead for this app, newest state, paged.
 *
 * Returns what it managed to read and says what it could not, rather than
 * throwing: an unreadable mirror must not look like a clean sweep.
 */
async function fromCloudinary() {
  if (!(process.env.CLOUDINARY_URL || '').trim()) {
    console.error('CLOUDINARY_URL is not set, so there is no mirror to read.');
    return [];
  }
  const { v2: cloudinary } = await import('cloudinary');
  const out = [];
  let cursor;
  const prefix = `leads/${leadStore.SOURCE_SLUG}/`;
  for (;;) {
    let page;
    try {
      page = await cloudinary.api.resources({
        resource_type: 'raw', type: 'upload', prefix, max_results: 500, next_cursor: cursor
      });
    } catch (err) {
      console.error(`Could not list ${prefix} in Cloudinary: ${err.message}`);
      return out;
    }
    for (const res of page.resources || []) {
      const url = res.secure_url || res.url;
      if (!url) continue;
      try {
        const r = await fetch(url);
        if (!r.ok) { console.error(`  ! ${res.public_id}: HTTP ${r.status}`); continue; }
        out.push(await r.json());
      } catch (err) {
        console.error(`  ! ${res.public_id}: ${err.message}`);
      }
    }
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return out;
}

async function main() {
  let owed;
  if (has('--from-cloudinary')) {
    owed = (await fromCloudinary()).filter(r => r.status !== 'sent');
    console.log(`Read the Cloudinary mirror: ${owed.length} lead(s) not marked sent.`);
  } else {
    owed = leadStore.unsent();
    console.log(`Read ${leadStore.leadsPath()}: ${owed.length} lead(s) not marked sent.`);
  }

  const only = valueOf('--lead-id');
  if (only) owed = owed.filter(r => r.lead_id === only);

  if (!owed.length) {
    if (has('--from-cloudinary')) {
      console.log('Nothing owed: the durable copy holds no unsent leads.');
      return 0;
    }
    // An empty local log is NOT evidence that nothing is owed. This service has
    // no Render disk, so leads.jsonl lives inside the container and dies with
    // it -- on every deploy, and on every free-tier idle spin-down, which lands
    // about fifteen minutes after the last request. Printing a flat "nothing
    // owed" off that would be the confident all-clear this whole tool exists to
    // prevent, handed over at the one moment somebody is hunting for lost leads.
    console.log('Nothing owed *in the local log* -- which is not the same answer.');
    if ((process.env.CLOUDINARY_URL || '').trim()) {
      console.log('\nThat log lives in the container and is destroyed on every restart\n' +
                  'and every idle spin-down, so it is routinely empty. Ask the durable\n' +
                  'copy before concluding anything:\n\n' +
                  '    node replayFailed.js --from-cloudinary --dry-run\n');
    } else {
      console.log('\nAnd CLOUDINARY_URL is not set, so there is no durable copy to check\n' +
                  'either -- any lead recorded before the last restart is unrecoverable.\n');
    }
    return 0;
  }

  for (const r of owed) {
    const f = r.fields || {};
    const who = f.contact_email || f.contact_phone || f.dealership_name || '(no contact)';
    console.log(`  ${r.lead_id}  ${String(r.created).slice(0, 19)}  ${r.status}  ${who}`);
  }

  if (has('--dry-run')) { console.log('\n--dry-run: nothing was posted.'); return 0; }

  const url = (process.env.SMART1_SUITE_WEBHOOK_URL || '').trim();
  if (!url) {
    // Refused rather than reported as a clean run: replaying into nowhere would
    // mark every one of these 'sent' and lose them a second time.
    console.error('\nRefusing to replay: SMART1_SUITE_WEBHOOK_URL is not set.');
    return 2;
  }

  let sent = 0, failed = 0;
  for (const r of owed) {
    const body = { ...(r.fields || {}) };
    if (!Object.keys(body).length) {
      console.log(`  ${r.lead_id}: no fields recorded, skipping`);
      failed += 1;
      continue;
    }
    body.replayed = 'true';          // so the CRM side can tell a replay apart
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (err) {
      console.log(`  ${r.lead_id}: ${err.name || 'FetchError'}`);
      await leadStore.mark(r, `failed: ${err.name || 'FetchError'}`);
      failed += 1;
      continue;
    }
    if (!resp.ok) {
      console.log(`  ${r.lead_id}: HTTP ${resp.status}`);
      await leadStore.mark(r, `failed: HTTP ${resp.status}`);
      failed += 1;
      continue;
    }
    await leadStore.mark(r, 'sent', { http_status: resp.status, replayed: true });
    sent += 1;
  }

  console.log(`\nSent ${sent}, still owed ${failed}.`);
  return failed === 0 ? 0 : 1;
}

main().then(c => process.exit(c)).catch(err => {
  console.error(err);
  process.exit(1);
});
