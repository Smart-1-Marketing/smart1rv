/**
 * Write-ahead record of every lead this app takes.
 *
 * The webhook POST was the only record that a lead ever existed. The route's
 * own comment said the failure path "log[s] the failure (and keep[s] the
 * payload) rather than 500" -- it logged, and it kept nothing, because there
 * was nowhere to keep it. There is no database in this app.
 *
 * Three ways a lead went, all behind an `ok: true` already on its way back:
 *   - `fetch(process.env.SMART1_SUITE_WEBHOOK_URL)` with the variable unset,
 *     which throws on an undefined URL and lands in the same catch as an
 *     outage, so a misconfigured deploy looked exactly like a bad afternoon;
 *   - a Smart 1 Suite outage, caught and logged, lead gone;
 *   - nothing to replay from afterwards in either case.
 *
 * So the lead is written down BEFORE the webhook fires and updated after it.
 * Two places, because neither on its own is enough:
 *   - `leads.jsonl` on local disk, written synchronously so the record is on
 *     disk before the POST is attempted. This service has no Render disk, so
 *     it is the working copy, not the durable one.
 *   - Cloudinary, one small raw object per lead, overwritten in place -- the
 *     copy that survives a redeploy. The app already holds a Cloudinary client
 *     for the proposal PDFs, so this costs no new dependency.
 *
 * Append-only, one line per event; `rows()` reduces by taking the last event
 * per lead. Rewriting the file would race the other worker, and an update that
 * loses a concurrent lead is the failure this module exists to end.
 *
 * Nothing in here may throw. A lead store that can break the tool it protects
 * is worse than no lead store, so every export catches its own errors and a
 * failure to record costs the record and never the visitor's report.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const SOURCE_SLUG = 'rv';

// Per-value cap. The generated report is deliberately not recorded: it is
// regenerable, it is already on Cloudinary as a PDF, and it is what would make
// a log line large enough for two workers to interleave halves of it.
export const MAX_VALUE = 1500;

const SENT = 'sent';
// The Hub answers more than one way, and only some of them mean this app still
// owes the lead to anybody.
//
//   ACCEPTED      the Hub stored it and took over the retry itself. Replaying
//                 one of these from here writes a second lead row for a single
//                 visitor, which is the duplicate a single write path exists to
//                 prevent. Done as far as this app is concerned -- and still
//                 not a contact, which is why the two are counted apart.
//   UNDELIVERABLE nobody to contact: an abandoned form that never reached the
//                 contact step. No retry will ever make one deliverable, so
//                 left as a failure it would sit in the owed count for ever and
//                 be re-posted on every replay run.
const ACCEPTED = 'accepted';
const UNDELIVERABLE = 'undeliverable';
const DONE = [SENT, ACCEPTED, UNDELIVERABLE];

function dataDir() {
  for (const candidate of [(process.env.LEADS_DIR || '').trim(), '/var/data']) {
    try {
      if (candidate && fs.statSync(candidate).isDirectory()) return candidate;
    } catch { /* not there; try the next one */ }
  }
  const dir = path.join(os.tmpdir(), `s1-${SOURCE_SLUG}-leads`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return os.tmpdir();
  }
}

export function leadsPath() {
  return (process.env.LEADS_FILE || '').trim() || path.join(dataDir(), 'leads.jsonl');
}

function append(row) {
  try {
    fs.appendFileSync(leadsPath(), JSON.stringify(row) + '\n', 'utf8');
  } catch (err) {
    console.error('Could not append to the lead log at', leadsPath(), err.message);
  }
}

/**
 * Overwrite this lead's object in Cloudinary. Resolves either way, never rejects.
 *
 * One object per lead rather than a copy of the whole log: the log grows
 * without bound and two workers uploading it would race, where a per-lead
 * object is bounded, idempotent and safe to overwrite from either worker.
 */
async function mirror(row) {
  if (!(process.env.CLOUDINARY_URL || '').trim()) return;
  try {
    const { v2: cloudinary } = await import('cloudinary');
    await new Promise((resolve) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: `leads/${SOURCE_SLUG}/${row.lead_id}`,
          resource_type: 'raw',
          overwrite: true,
          use_filename: false,
          unique_filename: false,
          timeout: 10000
        },
        (err) => {
          if (err) console.error('Could not mirror lead', row.lead_id, err.message);
          resolve();                       // resolve either way: never block a lead
        }
      );
      stream.end(Buffer.from(JSON.stringify(row), 'utf8'));
    });
  } catch (err) {
    console.error('Could not mirror lead', row.lead_id, err.message);
  }
}

function trim(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = typeof v === 'string' ? v.slice(0, MAX_VALUE) : String(v).slice(0, MAX_VALUE);
  }
  return out;
}

/**
 * Write the lead down before anything is attempted with it.
 *
 * The local append is synchronous on purpose: it must be on disk before the
 * POST goes out, or "write-ahead" is only a name. The Cloudinary mirror is
 * awaited by the caller so a process that dies mid-request has still put the
 * durable copy somewhere.
 */
export async function record(fields, kind = 'lead', extra = {}) {
  const row = {
    lead_id: String(extra.lead_id || crypto.randomUUID().replace(/-/g, '')),
    source: SOURCE_SLUG,
    kind,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    status: 'pending',
    fields: trim(fields)
  };
  for (const [k, v] of Object.entries(extra)) {
    if (k !== 'lead_id' && v !== undefined && v !== null && v !== '') row[k] = v;
  }
  append(row);
  await mirror(row);
  return row;
}

/**
 * Record what happened to a lead. `status` is 'sent' or `failed: <why>`.
 *
 * Anything that is not exactly 'sent' is logged at error level with the lead's
 * own fields, because that is the message somebody needs in order to know a
 * lead is owed -- the whole failure this module exists to end.
 */
export async function mark(row, status, extra = {}) {
  if (!row || typeof row !== 'object') return {};
  const next = { ...row, status, updated: new Date().toISOString() };
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && v !== '') next[k] = v;
  }
  append(next);
  await mirror(next);
  const st = String(status || '');
  if (st.startsWith(UNDELIVERABLE)) {
    // Not an error. The visitor abandoned the form before there was anybody to
    // write down; what they did fill in is here, which is the point.
    console.log(
      `Lead has nobody to contact, so no contact was created (${SOURCE_SLUG}) id=${next.lead_id}`
    );
  } else if (st.startsWith(ACCEPTED)) {
    // Not an error either: the lead is stored at the Hub and being retried
    // there. Said out loud anyway, because "stored somewhere else" and "in the
    // CRM" are different answers and only the second is finished.
    console.warn(
      `Lead accepted by the Hub, not yet in Smart 1 Suite (${SOURCE_SLUG}) ` +
      `id=${next.lead_id} detail=${next.detail || ''}`
    );
  } else if (st !== SENT) {
    console.error(
      `LEAD NOT DELIVERED (${SOURCE_SLUG}) id=${next.lead_id} status=${status} fields=` +
      JSON.stringify(next.fields || {})
    );
  }
  return next;
}

/**
 * The log reduced to one entry per lead, latest event winning.
 *
 * A line that will not parse is skipped and counted rather than taking the
 * whole read down: a half-written line at the tail is exactly what a crash
 * mid-append leaves, and it must not hide the leads above it.
 */
export function rows() {
  const latest = new Map();
  let bad = 0;
  const file = leadsPath();
  try {
    if (!fs.existsSync(file)) return [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const row = JSON.parse(t);
        if (row && row.lead_id) latest.set(row.lead_id, row);
      } catch {
        bad += 1;
      }
    }
  } catch (err) {
    console.error('Could not read the lead log at', file, err.message);
  }
  if (bad) console.warn(`Skipped ${bad} unreadable line(s) in ${file}`);
  return [...latest.values()].sort((a, b) => String(a.created).localeCompare(String(b.created)));
}

/**
 * Leads still owed by this app -- what replayFailed.js re-posts.
 *
 * A lead the Hub accepted is not in here, and neither is one with nobody to
 * contact: re-offering either would be wrong in opposite ways. accepted() and
 * undeliverable() count them on their own, because "stored at the Hub" and
 * "in the CRM" and "there was nobody to write down" are three different claims.
 */
export function unsent() {
  return rows().filter(r => !DONE.some(d => String(r.status || '').startsWith(d)));
}

/** Leads the Hub has, that are not confirmed in Smart 1 Suite yet. */
export function accepted() {
  return rows().filter(r => String(r.status || '').startsWith(ACCEPTED));
}

/** Leads with nobody to contact on them. Kept, never replayed. */
export function undeliverable() {
  return rows().filter(r => String(r.status || '').startsWith(UNDELIVERABLE));
}
