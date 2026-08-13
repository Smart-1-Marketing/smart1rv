# smart1rv

Smart RV Demand Package estimator for Smart 1 Marketing.

This project creates a multi-step embedded form for RV dealers. The form collects dealer information, creates an AI-generated campground market estimate, and sends the full lead payload into Smart 1 Suite through a webhook.

## What this version does

- **Progressive lead capture** — minimal business info first (dealership, contact name, ZIP, website, radii); email/phone are only requested at the final gate that unlocks the full report + PDF.
- **Partial lead capture** — the anonymous preview POST doubles as a partial lead (`lead_stage: "Preview — email not yet provided"`, placeholder email). If a visitor fills step 1 but never clicks Build, a `sendBeacon` on pagehide/visibility-hidden fires the same preview POST so the lead is never lost. UTM/gclid/fbclid/referrer attribution is merged into every payload.
- Uses OpenAI (with retry + deterministic regional fallback and a per-ZIP/radius/dealer cache) to estimate:
  - Campgrounds/RV parks in the market
  - Estimated RV/camping sites
  - Estimated peak-season camper reach
  - Recommended package + month-by-month plan (budgets computed server-side)
- **Server-side branded PDF** (pdfkit) generated on the unlock call only, uploaded to **Cloudinary (primary, folder `rv-reports`)** with the GHL media library as secondary; `proposal_pdf_url` goes to both the webhook and the browser, where the "Download Proposal (PDF)" button opens it (html2pdf stays as a client-side fallback when no URL exists).
- Sends all form data and AI-estimated fields to Smart 1 Suite via webhook (non-fatal on failure), including a pre-formatted `opportunity_note`.
- Rate-limits the estimate endpoint (default 10 requests / 15 min / IP) and validates any client-supplied `reuse_estimate` before use (budgets are always recomputed server-side).

## Important estimate disclaimer

This version does not use Google Maps, Google Places, OpenStreetMap, or paid ZIP-radius APIs. The campground count and camper reach are AI-generated planning estimates based on the dealership location, ZIP code, state, radius, and standard market assumptions. They should not be presented as audited counts.

---

## Project structure

```txt
smart1rv/
  server.js              # Express backend (estimate + webhook + rate limit)
  proposal.js            # pdfkit proposal PDF + Cloudinary/GHL media uploads
  package.json           # Node dependencies and scripts
  render.yaml            # Render Blueprint config (declares all env vars)
  .env.example           # Environment variable template (all env vars)
  scripts/
    createSuiteFields.js # Optional GHL custom-field creation utility
  fields/
    smart1rv-custom-fields.json  # True custom fields (bare snake_case webhook keys)
  public/
    index.html           # Full working form page (page-load overlay + campfire loader)
    styles.css           # Form styling (brand tokens: navy #0A2240, blue #009ED2)
    script.js            # Form behavior, partial capture, API calls
  smart1suiteembed.html  # Current single-file Suite embed
  rv-landing-page.html   # Current landing page
```

---

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

3. Add your environment variables (see `.env.example` for the complete annotated list):

```env
# Required
OPENAI_API_KEY=sk-your-openai-key
SMART1_SUITE_WEBHOOK_URL=https://your-smart-1-suite-webhook-url

# Common
OPENAI_MODEL=gpt-4o-mini
ALLOWED_ORIGINS=http://localhost:3000
NODE_ENV=development
PORT=3000

# Proposal PDF (Cloudinary primary, GHL media secondary)
PROPOSAL_PDF_ENABLED=true
CLOUDINARY_URL=cloudinary://key:secret@cloud-name
CONSULT_URL=https://smart1marketing.com/rvmarketingconsult
GHL_PRIVATE_INTEGRATION_TOKEN=...
GHL_LOCATION_ID=...
GHL_MEDIA_UPLOAD_URL=https://services.leadconnectorhq.com/medias/upload-file
GHL_MEDIA_API_VERSION=2021-07-28
GHL_MEDIA_HOSTED=

# Field-creation script
GHL_BASE_URL=https://services.leadconnectorhq.com
GHL_API_VERSION=2021-07-28
SUITE_FIELDS_FILE=fields/smart1rv-custom-fields.json
SUITE_FIELD_DRY_RUN=true
SUITE_SKIP_EXISTING=true
INCLUDE_FIELD_KEY=true

# Tuning
OPENAI_TIMEOUT_MS=22000
OPENAI_MAX_ATTEMPTS=2
PLACEHOLDER_LEAD_EMAIL=rvdealer@smart1marketing.com
ESTIMATE_CACHE_TTL_MS=86400000
ESTIMATE_CACHE_MAX=500
```

If `CLOUDINARY_URL` is unset, the PDF falls back to the GHL media URL; if neither is configured the on-screen Download button falls back to client-side html2pdf.

4. Start the server:

```bash
npm start
```

5. Open the local form:

```txt
http://localhost:3000
```

6. Test the health endpoint:

```txt
http://localhost:3000/health
```

---

# Render deployment instructions

## Option A: Deploy from GitHub manually

### 1. Create GitHub repository

Create a new GitHub repository named:

```txt
smart1rv
```

Push these project files to that repository.

### 2. Create a new Render Web Service

In Render:

1. Click **New +**
2. Choose **Web Service**
3. Connect your GitHub account if needed
4. Select the `smart1rv` repository
5. Use these settings:

```txt
Name: smart1rv
Runtime: Node
Branch: main
Root Directory: leave blank
Build Command: npm install
Start Command: npm start
Instance Type: Starter or higher
```

### 3. Add environment variables in Render

Go to the Render service → **Environment** and add:

```txt
OPENAI_API_KEY=your OpenAI API key
SMART1_SUITE_WEBHOOK_URL=your Smart 1 Suite webhook URL
OPENAI_MODEL=gpt-4o-mini
NODE_ENV=production
ALLOWED_ORIGINS=https://your-smart1-site-domain.com,https://www.your-smart1-site-domain.com
CLOUDINARY_URL=cloudinary://key:secret@cloud-name
CONSULT_URL=https://smart1marketing.com/rvmarketingconsult
GHL_PRIVATE_INTEGRATION_TOKEN=your private integration token
GHL_LOCATION_ID=your location id
GHL_MEDIA_API_VERSION=2021-07-28
GHL_API_VERSION=2021-07-28
```

For initial testing, you can temporarily leave `ALLOWED_ORIGINS` blank. Blank allows requests from any origin. After testing, lock it down to the Smart 1 Sites domain where the form is embedded.

### 4. Deploy

Click **Create Web Service**. Render will install dependencies and start the app.

### 5. Confirm deployment

After deploy, open:

```txt
https://smart1rv.onrender.com/health
```

You should see:

```json
{
  "ok": true,
  "service": "smart1rv",
  "build": "2026-08-10-consistency-pass",
  "timestamp": "..."
}
```

### 6. Test the hosted form

Open:

```txt
https://smart1rv.onrender.com
```

Fill out the form and confirm the lead arrives in Smart 1 Suite.

---

## Option B: Deploy with render.yaml Blueprint

This repo includes `render.yaml`.

In Render:

1. Click **New +**
2. Choose **Blueprint**
3. Connect the `smart1rv` repository
4. Render will read `render.yaml`
5. Add the required secret values when prompted:
   - `OPENAI_API_KEY`
   - `SMART1_SUITE_WEBHOOK_URL`
   - `ALLOWED_ORIGINS`
6. Deploy

---

# Embedding in Smart 1 Sites

You have two options.

## Option 1: Embed with iframe

This is the easiest version.

```html
<iframe
  src="https://smart1rv.onrender.com"
  style="width:100%; min-height:1050px; border:0;"
  loading="lazy">
</iframe>
```

Pros:

- Fastest setup
- No CORS issues
- Keeps all form assets hosted on Render

Cons:

- Styling is inside iframe
- Height may need adjustment

## Option 2: Embed directly in a Smart 1 Sites code block

Use the HTML from `public/index.html`, CSS from `public/styles.css`, and JS from `public/script.js`.

Before the script, set your Render API base:

```html
<script>
  window.SMART1RV_API_BASE = "https://smart1rv.onrender.com";
</script>
<script src="https://smart1rv.onrender.com/script.js"></script>
```

Make sure `ALLOWED_ORIGINS` in Render includes the Smart 1 Sites domain.

---

# Smart 1 Suite webhook payload

The webhook receives a JSON payload similar to this:

```json
{
  "source": "Smart RV Demand Estimate Form",
  "lead_type": "Smart RV Demand Package",
  "lead_status": "New RV Demand Lead",
  "submitted_at": "2026-07-08T00:00:00.000Z",
  "dealership_name": "Example RV Dealer",
  "contact_name": "Jane Smith",
  "email": "jane@example.com",
  "phone": "555-555-5555",
  "proposal_recipient_email": "jane@example.com",
  "address": "123 Main St",
  "city": "Columbus",
  "state": "OH",
  "zip": "43215",
  "website_url": "https://exampledealer.com",
  "sales_radius_miles": "75",
  "service_radius_miles": "40",
  "multiple_locations": "No",
  "primary_goal": "All of the above",
  "main_service_opportunity": "Winterization",
  "package_level": "$5,000/month SmartForecast",
  "preferred_start": "Next month",
  "weather_triggers": ["70+ weekend", "Heavy rain", "Freeze warning"],
  "selected_weather_triggers": ["70+ weekend", "Heavy rain", "Freeze warning"],
  "estimate_type": "AI-generated planning estimate",
  "campground_count_low": 35,
  "campground_count_high": 50,
  "estimated_site_count_low": 2800,
  "estimated_site_count_high": 4250,
  "estimated_peak_season_reach_low": 52000,
  "estimated_peak_season_reach_high": 79000,
  "recommended_package": "$5,000/month SmartForecast",
  "recommended_channels": ["Connected TV", "Digital Audio", "Programmatic Display"],
  "best_weather_triggers": ["60°+ forecast", "70°+ weekend", "Heavy rain"],
  "dealer_summary": "...",
  "month_by_month_plan": []
}
```

---

# Recommended Smart 1 Suite workflow

When the webhook fires:

1. Create or update contact by email
2. Create opportunity in the RV Demand pipeline
3. Store estimate fields as custom fields
4. Generate proposal document using custom values
5. Email proposal to `proposal_recipient_email`
6. Notify the assigned Smart 1 salesperson
7. Start follow-up automation if no appointment is booked

---

# Recommended Suite custom fields

Create custom fields for:

```txt
Dealership Name
Dealer Website URL
Dealer Address
Sales Radius Miles
Service Radius Miles
Primary Goal
Main Service Opportunity
Preferred Package Level
Selected Weather Triggers
Estimate Type
Campground Count Low
Campground Count High
Estimated Site Count Low
Estimated Site Count High
Estimated Peak Season Reach Low
Estimated Peak Season Reach High
Seasonal Share Assumption
Transient Share Assumption
Recommended Package
Recommended Channels
Best Weather Triggers
Dealer Summary
Month By Month Plan
Proposal Recipient Email
Review Request
Notes
```

For `month_by_month_plan`, store the full JSON or convert it to a long text field.

---

# Notes for production

- Keep the OpenAI API key only in Render environment variables.
- Never put API keys in Smart 1 Sites code blocks.
- Keep the Smart 1 Suite webhook URL only in Render environment variables.
- Use `ALLOWED_ORIGINS` after testing to reduce unwanted external submissions.
- Add captcha or honeypot protection if spam becomes an issue.
- Add server-side rate limiting if the page is publicly promoted.

## Bulk create Smart 1 Suite custom fields

This repo now includes an optional one-time field creation utility for Smart 1 Suite / HighLevel.

Files:

```text
scripts/createSuiteFields.js
fields/smart1rv-custom-fields.json
SUITE_FIELD_SETUP_RENDER.md
```

Dry run:

```bash
npm run suite:fields:dry
```

Create fields:

```bash
npm run suite:fields:create
```

Read `SUITE_FIELD_SETUP_RENDER.md` before running this in Render.
