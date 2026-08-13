# Smart 1 Suite Bulk Custom Field Setup on Render

This project includes a one-time utility that can create the Smart RV Demand custom fields in Smart 1 Suite / HighLevel using the HighLevel Custom Fields API.

HighLevel's current Location Custom Fields endpoint uses:

```text
GET  https://services.leadconnectorhq.com/locations/:locationId/customFields
POST https://services.leadconnectorhq.com/locations/:locationId/customFields
```

The HighLevel docs list the Create Custom Field endpoint as `POST /locations/:locationId/customFields` and the Get Custom Fields endpoint as `GET /locations/:locationId/customFields`. The docs also require a `Version` header and a sub-account/private integration token with custom-field scopes.

## What this creates

The fields are defined here:

```text
fields/smart1rv-custom-fields.json
```

The field set is intentionally lean and document-friendly. Field keys match the bare
snake_case keys the webhook actually sends (no `smart1rv_` prefix), and fields that
duplicate native GHL contact fields (Business Name, First/Last Name, City, State,
Postal Code, Street, Website) are NOT created — map those to the native contact
fields in the workflow instead.

- Sales Radius Miles (`sales_radius_miles`)
- Service Radius Miles (`service_radius_miles`)
- Primary Campaign Goal (`primary_goal`)
- Main Service Opportunity (`main_service_opportunity`)
- Preferred Package Level (`package_level`)
- Selected Weather Triggers Text (`selected_weather_triggers_text`)
- Campground Estimate Range (`campground_estimate_range`)
- Estimated Site Range (`estimated_site_range`)
- Estimated Peak Season Reach Range (`estimated_peak_season_reach_range`)
- Estimate Disclaimer (`estimate_disclaimer`)
- Recommended Package (`recommended_package`)
- Dealer Summary (`dealer_summary`)
- Month By Month Plan Text (`month_by_month_plan_text`)
- Proposal Summary Text (`proposal_summary_text`)
- Proposal PDF URL (`proposal_pdf_url`)
- Lead Stage (`lead_stage`)
- Market Climate Region (`market_climate_region`)
- Suggested Monthly Budget Text (`suggested_monthly_budget_text`)

## Required HighLevel / Smart 1 Suite API items

You need:

1. A Smart 1 Suite / HighLevel **Location ID** for the sub-account where fields should be created.
2. A **Private Integration Token** or OAuth token that has access to that location.
3. The token needs custom field permissions. In HighLevel's docs, the write scope is listed as:

```text
locations/customFields.write
```

The read scope is useful because the script checks for existing fields first:

```text
locations/customFields.readonly
```

## Render environment variables

In Render, open your `smart1rv` service and go to **Environment**.

Add these variables:

```text
GHL_LOCATION_ID=your_location_id_here
GHL_PRIVATE_INTEGRATION_TOKEN=your_private_integration_token_here
GHL_API_VERSION=2021-07-28
SUITE_FIELD_DRY_RUN=true
SUITE_SKIP_EXISTING=true
```

Optional:

```text
GHL_BASE_URL=https://services.leadconnectorhq.com
SUITE_FIELDS_FILE=fields/smart1rv-custom-fields.json
INCLUDE_FIELD_KEY=true
```

If HighLevel rejects the `fieldKey` property with a 422 error, set:

```text
INCLUDE_FIELD_KEY=false
```

Then run the create command again.

## Safest Render run process

### Step 1: Deploy the updated repo

Push these files to GitHub:

```text
scripts/createSuiteFields.js
fields/smart1rv-custom-fields.json
SUITE_FIELD_SETUP_RENDER.md
package.json
.env.example
```

Render should redeploy automatically if auto-deploy is enabled.

### Step 2: Run a dry run first

In Render:

1. Open the `smart1rv` Web Service.
2. Go to **Shell**.
3. Run:

```bash
npm run suite:fields:dry
```

This should print the fields it would create without creating them.

### Step 3: Create the fields

After the dry run looks good, run:

```bash
npm run suite:fields:create
```

This sets `SUITE_FIELD_DRY_RUN=false` for that command and creates the fields.

### Step 4: Confirm fields in Smart 1 Suite

Go to Smart 1 Suite / HighLevel:

```text
Settings → Custom Fields
```

Confirm the Smart RV Demand fields were created.

### Step 5: Turn dry run back on

In Render environment variables, keep this as the default:

```text
SUITE_FIELD_DRY_RUN=true
```

That prevents accidental field creation if someone reruns the dry command later.

## Local run option

You can also run this locally before using Render.

Create a local `.env` file from `.env.example`, add the HighLevel values, then run:

```bash
npm install
npm run suite:fields:dry
npm run suite:fields:create
```

Do not commit `.env` to GitHub.

## Notes

- The script skips existing fields by name when `SUITE_SKIP_EXISTING=true`.
- It creates only the core proposal/document fields for version one.
- The webhook should send text-friendly values like `selected_weather_triggers_text`, `campground_estimate_range`, `month_by_month_plan_text`, and `proposal_summary_text` so your Smart 1 Suite document template is easy to build.
- If the API returns 401, check your token and scopes.
- If the API returns 422, check the requested field type or set `INCLUDE_FIELD_KEY=false` and rerun.
