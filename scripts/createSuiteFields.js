import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const TOKEN = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
const VERSION = process.env.GHL_API_VERSION || '2021-07-28';
const FIELDS_FILE = process.env.SUITE_FIELDS_FILE || 'fields/smart1rv-custom-fields.json';
const DRY_RUN = String(process.env.SUITE_FIELD_DRY_RUN || 'true').toLowerCase() !== 'false';
const SKIP_EXISTING = String(process.env.SUITE_SKIP_EXISTING || 'true').toLowerCase() !== 'false';

function requiredEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function makeCreateBody(field, position) {
  // HighLevel/LeadConnector custom-field payloads can vary slightly by API version.
  // These are the standard fields used by the Location Custom Fields endpoint.
  const body = {
    name: field.name,
    dataType: field.dataType || 'TEXT',
    placeholder: field.placeholder || field.name,
    position,
    showInForms: field.showInForms ?? true
  };

  // Keep the key in the payload for installs where the API accepts a unique key/field key.
  // If your account rejects this with a 422, set INCLUDE_FIELD_KEY=false in Render.
  if (process.env.INCLUDE_FIELD_KEY !== 'false' && field.key) {
    body.fieldKey = field.key;
  }

  if (Array.isArray(field.options) && field.options.length > 0) {
    body.options = field.options;
  }

  return body;
}

async function ghlFetch(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      Version: VERSION,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(`HighLevel API error ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function extractCustomFields(data) {
  if (!data) return [];
  if (Array.isArray(data.customFields)) return data.customFields;
  if (Array.isArray(data.fields)) return data.fields;
  if (Array.isArray(data)) return data;
  return [];
}

async function getExistingFields() {
  const data = await ghlFetch(`/locations/${LOCATION_ID}/customFields`, { method: 'GET' });
  return extractCustomFields(data);
}

async function createField(field, position) {
  const body = makeCreateBody(field, position);
  return ghlFetch(`/locations/${LOCATION_ID}/customFields`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

async function main() {
  requiredEnv('GHL_LOCATION_ID', LOCATION_ID);
  requiredEnv('GHL_PRIVATE_INTEGRATION_TOKEN', TOKEN);

  const absoluteFieldsPath = path.resolve(process.cwd(), FIELDS_FILE);
  const fields = JSON.parse(await fs.readFile(absoluteFieldsPath, 'utf8'));

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error(`No fields found in ${FIELDS_FILE}`);
  }

  console.log(`Smart 1 RV custom field setup`);
  console.log(`Location ID: ${LOCATION_ID}`);
  console.log(`Fields file: ${FIELDS_FILE}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Skip existing: ${SKIP_EXISTING}`);
  console.log(`API Version header: ${VERSION}`);

  const existing = SKIP_EXISTING ? await getExistingFields() : [];
  const existingNames = new Set(existing.map(item => normalizeName(item.name)));

  const results = [];

  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];

    if (!field.name) {
      results.push({ name: '(missing name)', status: 'skipped', reason: 'Missing name' });
      continue;
    }

    if (SKIP_EXISTING && existingNames.has(normalizeName(field.name))) {
      console.log(`SKIP existing: ${field.name}`);
      results.push({ name: field.name, status: 'skipped_existing' });
      continue;
    }

    const body = makeCreateBody(field, i + 1);

    if (DRY_RUN) {
      console.log(`DRY RUN create: ${field.name}`, JSON.stringify(body));
      results.push({ name: field.name, status: 'dry_run', body });
      continue;
    }

    try {
      const created = await createField(field, i + 1);
      console.log(`CREATED: ${field.name}`);
      results.push({ name: field.name, status: 'created', response: created });
    } catch (error) {
      console.error(`FAILED: ${field.name}`);
      console.error(error.message);
      results.push({ name: field.name, status: 'failed', error: error.message, apiResponse: error.data || null });
    }
  }

  const summary = {
    created: results.filter(r => r.status === 'created').length,
    skipped_existing: results.filter(r => r.status === 'skipped_existing').length,
    dry_run: results.filter(r => r.status === 'dry_run').length,
    failed: results.filter(r => r.status === 'failed').length
  };

  console.log('Summary:', JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
