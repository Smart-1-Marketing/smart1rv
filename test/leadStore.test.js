/**
 * The lead is written down before it is delivered, and every failure is loud.
 *
 *   node --test test/leadStore.test.js
 *
 * Drives the real module against a throwaway directory. CLOUDINARY_URL is unset
 * so the mirror is skipped -- which is itself asserted: an app with no
 * Cloudinary must still keep its local record rather than losing the lead twice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leadstore-test-'));
process.env.LEADS_DIR = tmp;
delete process.env.LEADS_FILE;
delete process.env.CLOUDINARY_URL;

const leadStore = await import('../lib/leadStore.js');

test('the record is written before anything is attempted', async () => {
  const row = await leadStore.record({ contact_email: 'a@b.com', dealership_name: 'Acme RV' });
  assert.ok(row.lead_id, 'a lead_id is assigned');
  assert.equal(row.status, 'pending', 'it starts pending');
  assert.ok(fs.existsSync(leadStore.leadsPath()), 'the log exists on disk');
  assert.ok(leadStore.unsent().some(r => r.lead_id === row.lead_id), 'and it is owed');
});

test('an unset webhook leaves a replayable record, not nothing', async () => {
  // The defect in one line: the old code threw here and the lead ceased to
  // exist. The record must survive the same branch.
  const row = await leadStore.record({ contact_email: 'c@d.com' });
  await leadStore.mark(row, 'failed: SMART1_SUITE_WEBHOOK_URL is not set');
  const owed = leadStore.unsent().find(r => r.lead_id === row.lead_id);
  assert.ok(owed, 'still owed after a failure');
  assert.match(owed.status, /WEBHOOK_URL/, 'the reason is kept');
  assert.equal(owed.fields.contact_email, 'c@d.com', 'the fields survive for replay');
});

test('a delivered lead drops out of the owed set but stays on file', async () => {
  const row = await leadStore.record({ contact_email: 'e@f.com' });
  await leadStore.mark(row, 'sent', { http_status: 200 });
  assert.ok(!leadStore.unsent().some(r => r.lead_id === row.lead_id), 'no longer owed');
  assert.ok(leadStore.rows().some(r => r.lead_id === row.lead_id), 'still on file');
});

test('the log is append-only and reduces to the latest state', async () => {
  const before = fs.readFileSync(leadStore.leadsPath(), 'utf8').split('\n').filter(Boolean).length;
  const row = await leadStore.record({ contact_email: 'g@h.com' });
  await leadStore.mark(row, 'failed: HTTP 500');
  await leadStore.mark(row, 'sent');
  const after = fs.readFileSync(leadStore.leadsPath(), 'utf8').split('\n').filter(Boolean).length;
  assert.equal(after - before, 3, 'three events appended, nothing overwritten');
  const reduced = leadStore.rows().filter(r => r.lead_id === row.lead_id);
  assert.equal(reduced.length, 1, 'rows() collapses them to one');
  assert.equal(reduced[0].status, 'sent', 'keeping the last status');
});

test('a torn line does not hide the leads above it', () => {
  const before = leadStore.rows().length;
  fs.appendFileSync(leadStore.leadsPath(), '{"lead_id": "half-writ');  // a crash mid-append
  assert.equal(leadStore.rows().length, before, 'the good rows still read');
});

test('nothing in it throws, whatever it is handed', async () => {
  await leadStore.mark(null, 'sent');                    // not a row
  await leadStore.record({ x: null, y: '' });            // empties dropped
  process.env.LEADS_FILE = '/proc/nonexistent/leads.jsonl';
  await leadStore.record({ a: 'b' });                    // unwritable path
  delete process.env.LEADS_FILE;
  assert.ok(true, 'survived bad input and an unwritable log');
});

test('long values are capped so a line stays small', async () => {
  const row = await leadStore.record({ note: 'x'.repeat(99999) });
  assert.equal(row.fields.note.length, leadStore.MAX_VALUE, 'capped at MAX_VALUE');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
