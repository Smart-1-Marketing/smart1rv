/**
 * Delivery of one lead into Smart 1 Suite, down the Hub's single write path.
 *
 * ## Why this replaces the webhook
 *
 * This app used to POST the lead at a GoHighLevel *inbound webhook*. The only
 * thing a webhook can tell you is that GoHighLevel accepted an HTTP request --
 * never that a contact exists. And on this service it told us nothing at all:
 * SMART1_SUITE_WEBHOOK_URL was never set, so every lead this app has ever
 * taken was discarded, behind an `ok: true` already on its way to the visitor.
 *
 * The Hub writes the contact over the GoHighLevel **Contacts API** and returns
 * the contact id. That id is the proof, and it is what makes "delivered" mean
 * something on this app's health probe as well as on the Hub's leads panel.
 *
 * ## Why through the Hub and not straight at GoHighLevel
 *
 * hub/leads.py exists to be the one place every lead in this company is
 * written: one token, one sub-account id, one contact write path, one panel
 * that can answer "how many leads did we get last week, and from which
 * pages?" Calling the Contacts API from here as well would put the Suite
 * token on five more Render services -- five more places to rotate it and
 * five more to leak it -- and would leave this app's leads invisible to that
 * panel, which is where anybody actually looks for them.
 *
 * What comes back says which of four things happened, and they are four
 * because they need four different responses:
 *
 *   - **delivered**     a contact id came back. The lead is in Smart 1 Suite.
 *   - **accepted**      the Hub stored the lead and could not reach Suite yet.
 *                       It owns the retry. This app must NOT replay it: doing
 *                       so writes a second lead row for one visitor.
 *   - **undeliverable** the lead has neither an email nor a phone, so there is
 *                       nobody to create a contact for. No retry will change
 *                       that, so it is not owed -- left as a failure it would
 *                       sit in the owed count for ever and be re-posted on
 *                       every replay run.
 *   - **failed**        the Hub never got it. Owed, and replayFailed.js
 *                       re-posts it.
 *
 * ## What is deliberately absent
 *
 * **There is no fallback to the webhook.** It is tempting -- if the Hub is
 * unreachable, fire the old URL instead -- and it is wrong: the failure that
 * matters most is a timeout, which is precisely the case where we cannot tell
 * whether the write landed. Falling back there is how one visitor becomes two
 * contacts, with nothing to reconcile them against afterwards. One lead goes
 * down one path; the safety net is the write-ahead record in leadStore.
 *
 * **Nothing here throws.** A delivery fault must never cost the visitor their
 * plan, and the caller has already written the lead down before calling.
 */

// The Hub's public capture endpoint. Defaulted rather than required: it is a
// fixed address that has not changed, and an app that has to be told where the
// Hub is in order to keep a lead is an app that loses leads on the day nobody
// sets the variable -- which is exactly what happened here.
export const DEFAULT_ENDPOINT = 'https://smart1.agency/api/leads/capture';

// Sent as a header so the Hub's per-IP rate limit does not apply. That limit is
// three an hour and is written for a browser; every lead this app takes arrives
// at the Hub from one Render egress address, so without the token the fourth
// visitor of a busy hour is refused. Unset means the lead is still stored and
// still attempted -- it is a throttle, not a gate.
export const TOKEN_ENV = 'LEADS_SOURCE_TOKEN';
export const TOKEN_HEADER = 'X-S1-Lead-Token';

export const STATUS_DELIVERED = 'delivered';
export const STATUS_ACCEPTED = 'accepted';
export const STATUS_UNDELIVERABLE = 'undeliverable';
export const STATUS_FAILED = 'failed';

const TIMEOUT_MS = Number(process.env.HUB_LEAD_TIMEOUT_MS || 12000);

// Which of this app's own field names land in a *named* place on the contact.
// Everything else still travels and is still stored by the Hub -- this is
// about which fields the Contacts API has a real home for, not about what
// survives. Kept deliberately in step with FIELD_ALIASES in the four Python
// landing apps' suite_lead.py, so the five behave alike.
const FIELD_ALIASES = {
  name:    ['contact_name', 'c_name', 'full_name', 'name'],
  email:   ['contact_email', 'c_email', 'email', 'proposal_recipient_email'],
  phone:   ['contact_phone', 'c_phone', 'phone'],
  company: ['dealership_name', 'dealer_name', 'firm_name', 'resort_name',
            'company_name', 'business_name', 'company', 'business'],
  website: ['website_url', 'website', 'url', 'domain'],
  zip:     ['dealer_zip', 'company_zip', 'zip_code', 'zip', 'postal_code'],
  city:    ['city'],
  state:   ['state']
};

// Kept out of the payload entirely rather than passed and ignored. The report
// text is large and regenerable; the two link fields are passed by name.
const SKIP_FIELDS = new Set([
  'proposal_summary_text', 'month_by_month_plan_text', 'opportunity_note',
  'report_json', 'report_url', 'report_pdf_url'
]);

export function endpoint() {
  // Quotes are stripped because Render stores them literally, which has
  // silently broken URL matching in this codebase before.
  const v = String(process.env.HUB_LEAD_ENDPOINT || '').trim().replace(/^["']|["']$/g, '');
  return v || DEFAULT_ENDPOINT;
}

export function token() {
  return String(process.env[TOKEN_ENV] || '').trim().replace(/^["']|["']$/g, '');
}

export function configured() {
  return Boolean(endpoint());
}

export function whyNot() {
  if (!endpoint()) {
    return 'HUB_LEAD_ENDPOINT is set to an empty value, so there is nowhere to ' +
      `deliver leads to. Unset it to use the default (${DEFAULT_ENDPOINT}), or ` +
      'point it at the Hub.';
  }
  return '';
}

/** This app's lead body with the Hub's own field names resolved onto it. */
export function leadFields(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!SKIP_FIELDS.has(k) && v !== null && v !== undefined && v !== '') out[k] = v;
  }
  for (const [hubKey, names] of Object.entries(FIELD_ALIASES)) {
    for (const n of names) {
      const v = (body || {})[n];
      if (v !== null && v !== undefined && v !== '') { out[hubKey] = v; break; }
    }
  }
  return out;
}

/**
 * What travels beside the fields: the report link a Suite workflow would
 * email, and any free segmentation tags.
 *
 * The tags are what the webhook used to achieve with GoHighLevel "Add Tag"
 * workflow actions. Over the API a tag is just a field on the contact, so
 * they are sent as tags and there is no workflow in the middle to go missing.
 */
export function leadMeta(body, extraTags = []) {
  const b = body || {};
  const meta = {};
  const link = String(b.report_url || '').trim();
  if (link) meta.report_url = link;
  const tags = [...extraTags, b.market_tag, b.package_tag]
    .map(t => String(t == null ? '' : t).trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tags.length) meta.tags = tags;
  return meta;
}

/**
 * Post one lead to the Hub. Resolves with what happened; never rejects.
 */
export async function deliver({ source, page, fields, pdfUrl = '', meta = null }) {
  const out = {
    status: STATUS_FAILED, ok: false, contact_id: '', hub_lead_id: '',
    http_status: 0, detail: '', retryable: true
  };

  const url = endpoint();
  if (!url) {
    return { ...out, detail: whyNot(), retryable: false };
  }

  const clean = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v !== null && v !== undefined && v !== '') clean[k] = v;
  }
  // The Hub refuses a lead with neither, and so should this -- a contactless
  // lead reads as a live prospect on every count that follows it. Its own
  // state rather than a failure: no retry will ever make one deliverable.
  if (!clean.email && !clean.phone) {
    return {
      ...out, status: STATUS_UNDELIVERABLE, retryable: false,
      detail: 'The lead has neither an email nor a phone, so there is nobody ' +
        "to create a contact for. Whatever the visitor did fill in is kept in " +
        "this app's lead log."
    };
  }

  const body = { source, page, fields: clean };
  if (pdfUrl) body.pdf_url = pdfUrl;
  if (meta && Object.keys(meta).length) body.meta = meta;

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const tok = token();
  if (tok) headers[TOKEN_HEADER] = tok;

  let response;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    response = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal
    });
  } catch (err) {
    // Includes the timeout, which is the one case where we genuinely do not
    // know whether the Hub wrote the lead. Retryable -- but the retry goes
    // back down this same path, never down a second one.
    return { ...out, detail: `Couldn't reach the Hub (${err.name || 'FetchError'}). Will retry.` };
  } finally {
    clearTimeout(timer);
  }

  out.http_status = response.status;
  const text = await response.text().catch(() => '');
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!data || typeof data !== 'object') data = {};

  if (response.status === 429) {
    // Named, because the caller reading this is a server and "wait" is not the
    // fix -- the token is.
    out.detail = 'The Hub rate-limited this lead (HTTP 429). Every lead this app ' +
      `sends arrives from one address, so set ${TOKEN_ENV} here and on the Hub to ` +
      'lift the per-IP limit. The lead is stored and replayable.';
    return out;
  }

  if (!response.ok) {
    out.detail = `The Hub refused the lead: HTTP ${response.status} ` +
      String(data.error || text).slice(0, 200);
    // A 400 is a payload the Hub will refuse identically every time, and a
    // 401/403 is configuration. Retrying either on a timer burns the log and
    // hides the cause -- but both stay owed, because fixing them is what makes
    // a replay worth running.
    if ([400, 401, 403, 422].includes(response.status)) out.retryable = false;
    return out;
  }

  out.hub_lead_id = String(data.lead_id || '');
  const cid = String(data.contact_id || '');
  if (data.delivered && cid) {
    return { ...out, status: STATUS_DELIVERED, ok: true, contact_id: cid,
             retryable: false, detail: 'Created in Smart 1 Suite.' };
  }

  if (data.ok) {
    // The Hub has the lead and owns the retry.
    //
    // A `delivered: true` with no contact id lands here too, and is the one
    // answer worth naming rather than normalising. It is the shape the retired
    // webhook always had -- somebody said yes and there is no id to check it
    // against -- so it is treated as stored-not-delivered, which is the safe
    // reading, and the contradiction is said out loud instead of being quietly
    // rounded down to a state that looks routine.
    const note = String(data.note || '').trim();
    const detail = data.delivered
      ? ('The Hub reported this lead as delivered but returned no contact id, so ' +
         'there is nothing to confirm it against. Treating it as stored at the Hub ' +
         'and not yet in Smart 1 Suite, which is the safe reading of the two. ' + note).trim()
      : ('The Hub stored the lead and will deliver it to Smart 1 Suite. ' + note).trim();
    return { ...out, status: STATUS_ACCEPTED, ok: true, retryable: false, detail };
  }

  out.detail = `The Hub answered HTTP ${response.status} without confirming the ` +
    `lead. Body: ${(text || '').slice(0, 200)}`;
  return out;
}
