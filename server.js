import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { buildProposalPdf, uploadPdfToGhlMedia, uploadPdfToCloudinary, proposalFileName } from './proposal.js';
import * as leadStore from './lib/leadStore.js';
import * as suiteLead from './lib/suiteLead.js';

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const allowAllOrigins = allowedOrigins.length === 0 || allowedOrigins.includes('*');
if (allowAllOrigins) {
  console.warn('ALLOWED_ORIGINS is not set (or contains "*") — CORS is open to all origins. Set ALLOWED_ORIGINS in production.');
}

app.use(cors({
  origin(origin, callback) {
    // Allow non-browser requests (no Origin header), a blank ALLOWED_ORIGINS,
    // an explicit "*" wildcard, or an exact origin match.
    if (!origin || allowAllOrigins || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Do NOT throw here — throwing skips CORS headers and the browser reports a
    // generic "Failed to fetch". Instead, deny the CORS headers gracefully so the
    // request still returns a normal (blocked) response we can diagnose.
    return callback(null, false);
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// SMART1_SUITE_WEBHOOK_URL is deliberately not in here any more. It was, and
// it was never set on this service, so this warned on every boot and the
// warning was right: every lead the app took was being discarded. Leaving it
// required now would warn for ever about a variable nothing reads -- and a
// warning that is always there is one nobody reads either, which is how the
// real one went unnoticed. Where the leads go is on /health instead, with the
// endpoint printed.
const requiredEnv = ['OPENAI_API_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(`Missing environment variable: ${key}`);
  }
}
if (!suiteLead.configured()) {
  console.warn(`Lead delivery is not configured: ${suiteLead.whyNot()}`);
}

const currentMonthIndex = new Date().getMonth();
const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const nextMonthName = monthNames[(currentMonthIndex + 1) % 12];

function normalizeFormPayload(body) {
  const triggers = Array.isArray(body.weather_triggers)
    ? body.weather_triggers
    : String(body.weather_triggers || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

  return {
    dealership_name: body.dealership_name || '',
    contact_name: body.contact_name || '',
    email: body.email || '',
    phone: body.phone || '',
    proposal_recipient_email: body.proposal_recipient_email || body.alternate_email || body.email || '',
    address: body.address || '',
    city: body.city || '',
    state: body.state || '',
    zip: body.zip || '',
    website_url: body.website_url || '',
    sales_radius_miles: body.sales_radius_miles || '',
    service_radius_miles: body.service_radius_miles || '',
    multiple_locations: body.multiple_locations || '',
    primary_goal: body.primary_goal || 'All sales, trade-ins, financing, service appointments, and seasonal maintenance',
    main_service_opportunity: body.main_service_opportunity || 'Full RV demand package: service appointments, A/C service, roof/seal inspections, generator checks, de-winterization, winterization, and seasonal maintenance',
    package_level: body.package_level || '',
    preferred_start: body.preferred_start || '',
    weather_triggers: triggers,
    review_request: body.review_request || '',
    notes: body.notes || '',
    estimate_type: 'AI-generated planning estimate'
  };
}

function buildPrompt(payload) {
  return `
You are helping Smart 1 Marketing estimate campground and RV park market opportunity for an RV dealer advertising proposal.

This is not an exact database lookup. Create a reasonable marketing planning estimate based on the dealer's city, state, ZIP code, sales radius, service radius, regional density, tourism/camping patterns, and typical campground/RV park distribution.

Dealer inputs:
Dealership Name: ${payload.dealership_name}
ZIP: ${payload.zip}
Website: ${payload.website_url}
Sales Radius: ${payload.sales_radius_miles} miles
Service Radius: ${payload.service_radius_miles} miles
Assumed Campaign Objectives (assume ALL of these): ${payload.primary_goal}
Assumed Service Opportunities (assume ALL of these): ${payload.main_service_opportunity}
Available Weather Triggers (assume the dealer wants ALL relevant triggers on the table): ${payload.weather_triggers.join(', ')}
Campaign start assumption: Start next month, ${nextMonthName}.

The dealer only provided a ZIP code (no city/state). Derive the state, city area, and region from the ZIP code ${payload.zip} and base all geography, campground density, and seasonality on that.

All Smart 1 campaigns are powered by data-driven audience targeting, which ALWAYS includes: in-market RV buyer data (households actively shopping for RVs), campground & state-park geotargeting, and location look-back retargeting (recent campground/RV-park visitors). Reference this data-driven targeting where natural in the dealer_summary.

The dealer has NOT chosen a monthly package. YOU must recommend the best fit from these three levels based on market size and estimated opportunity: "$3,500/month SmartForecast" (Starter), "$5,000/month SmartForecast" (Growth), or "$7,500/month SmartForecast" (Premium). Put your choice in recommended_package and explain it in recommended_package_reason.

Return conservative-to-strong marketing ranges. Do not claim exact counts. Use ranges. Assume the dealer wants the full RV demand package covering all sales and all service goals; do not ask the dealer to narrow the campaign to only one sales or service objective.

First, classify the dealer into ONE climate/market region based on state and ZIP, using this framework:
- "Southern / Coastal Year-Round RV Market" (FL, AL, TX, LA, GA, NC, SC, MS): heat, rain, storms, hurricane prep, snowbirds, year-round sales.
- "Northern / Seasonal RV Market" (OH, MI, IN, IL, PA, NY, WI, MN): spring opening, summer camping, fall service, winterization.
- "Desert / Southwest RV Market" (AZ, NM, NV, west TX, southern CA): extreme heat, mild winter camping, dust/wind, monsoon storms.
- "Mountain / Four-Season RV Market" (CO, UT, ID, MT, WY): spring thaw, summer camping, fall trips, snow/freeze prep.
- "Pacific Northwest / Rain-Influenced RV Market" (WA, OR, northern CA): rain breaks, sunny weekends, roof/seal inspections, moisture protection.
If the state does not clearly fit, choose the closest region and briefly explain why in the region reason.

For recommended_channels, you MUST choose only from Smart 1 Marketing's actual media and targeting menu below. Return a tailored subset (in priority order) that fits this dealer's market:
- "Connected TV (CTV)"
- "Streaming Radio"
- "Podcasts"
- "Data-Driven Targeted Display"
- "Geotargeting Campgrounds & State Parks"
- "Location Look-Back Retargeting" (reach people whose devices were seen at local campgrounds/RV parks and then returned home)
- "Digital Out-of-Home (DOOH)" at local bars, restaurants, gas stations, and shopping areas
HARD RULE: Never recommend local newspapers, print, direct mail, terrestrial/broadcast radio, linear/broadcast TV, static billboards, or any channel not on the list above. Only the channels above are valid.

For the month-by-month plan, label each month's "season" as exactly one of: "Peak", "Shoulder", or "Off-Season", based on the dealer's region and RV demand cycle. Peak = the dealer's strongest RV demand months; Shoulder = ramp-up/ramp-down months; Off-Season = the slowest demand months. Southern/coastal and desert markets are year-round, so they should have MORE Peak/Shoulder months and FEWER Off-Season months than northern markets. (The dollar budget for each month is calculated automatically from the recommended package and these season labels — spend is highest in Peak months and steps down in the Off-Season — so you only need to label the season correctly.)

Then estimate:
1. Approximate number of campgrounds/RV parks in the sales radius.
2. Approximate total camping/RV sites in the sales radius.
3. Approximate peak-season camper reach.
4. Suggested seasonal campaign plan starting next month, with a season label on every month.
5. Recommended Smart RV Demand package.
6. Best weather triggers for this dealer, tuned to the region above.
7. Recommended media channels, chosen ONLY from the Smart 1 menu above.
8. A short sales summary written for the dealer.

Use these assumptions unless local context strongly suggests otherwise:
- Average campground/RV park site count: 75–125 sites.
- Seasonal camper share: 35%–45%.
- Transient/daily-weekly camper share: 55%–65%.
- Average people per occupied campsite: 2.4.
- Peak-season transient turnover: 8–12 stays per site.
- Peak season generally runs spring through fall, adjusted by the dealer’s geography (year-round for southern/coastal and desert markets).
- The estimate should be useful for marketing planning, not presented as an audited count.
`;
}

const estimateSchema = {
  name: 'smart_rv_demand_estimate',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      estimate_disclaimer: { type: 'string' },
      market_climate_region: { type: 'string' },
      market_region_reason: { type: 'string' },
      campground_count_low: { type: 'number' },
      campground_count_high: { type: 'number' },
      estimated_site_count_low: { type: 'number' },
      estimated_site_count_high: { type: 'number' },
      estimated_peak_season_reach_low: { type: 'number' },
      estimated_peak_season_reach_high: { type: 'number' },
      seasonal_share_assumption: { type: 'string' },
      transient_share_assumption: { type: 'string' },
      peak_season_assumption: { type: 'string' },
      recommended_package: { type: 'string' },
      recommended_package_reason: { type: 'string' },
      recommended_channels: { type: 'array', items: { type: 'string' } },
      best_weather_triggers: { type: 'array', items: { type: 'string' } },
      dealer_summary: { type: 'string' },
      month_by_month_plan: {
        type: 'array',
        minItems: 6,
        maxItems: 12,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            month: { type: 'string' },
            season: { type: 'string', enum: ['Peak', 'Shoulder', 'Off-Season'] },
            campaign_focus: { type: 'string' },
            recommended_message: { type: 'string' },
            weather_triggers: { type: 'array', items: { type: 'string' } }
          },
          required: ['month', 'season', 'campaign_focus', 'recommended_message', 'weather_triggers']
        }
      }
    },
    required: [
      'estimate_disclaimer',
      'market_climate_region',
      'market_region_reason',
      'campground_count_low',
      'campground_count_high',
      'estimated_site_count_low',
      'estimated_site_count_high',
      'estimated_peak_season_reach_low',
      'estimated_peak_season_reach_high',
      'seasonal_share_assumption',
      'transient_share_assumption',
      'peak_season_assumption',
      'recommended_package',
      'recommended_package_reason',
      'recommended_channels',
      'best_weather_triggers',
      'dealer_summary',
      'month_by_month_plan'
    ]
  },
  strict: true
};

// Smart 1 Marketing's actual media + targeting menu. recommended_channels is forced to this set.
const APPROVED_CHANNELS = [
  'Connected TV (CTV)',
  'Streaming Radio',
  'Podcasts',
  'Data-Driven Targeted Display',
  'Geotargeting Campgrounds & State Parks',
  'Location Look-Back Retargeting',
  'Digital Out-of-Home (DOOH)'
];

// Map whatever the model returns to the approved menu and drop anything off-menu
// (e.g. local newspapers, print, broadcast). Falls back to the full menu if nothing maps.
function normalizeChannels(list) {
  const out = [];
  const push = value => { if (!out.includes(value)) out.push(value); };

  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw || '').toLowerCase();
    if (s.includes('ctv') || s.includes('connected tv')) push('Connected TV (CTV)');
    else if (s.includes('podcast')) push('Podcasts');
    else if (s.includes('dooh') || s.includes('out-of-home') || s.includes('out of home') || s.includes('ooh')) push('Digital Out-of-Home (DOOH)');
    else if (s.includes('look-back') || s.includes('lookback') || s.includes('look back') || s.includes('retarget') || s.includes('re-target')) push('Location Look-Back Retargeting');
    else if (s.includes('geotarget') || s.includes('geo-target') || s.includes('geofenc') || s.includes('geo-fenc') || s.includes('campground') || s.includes('state park')) push('Geotargeting Campgrounds & State Parks');
    else if (s.includes('display') || s.includes('programmatic') || s.includes('banner')) push('Data-Driven Targeted Display');
    else if (s.includes('streaming radio') || s.includes('digital audio') || s.includes('streaming audio') || s.includes('audio') || s.includes('radio')) push('Streaming Radio');
    // Anything else (newspaper, print, direct mail, broadcast, billboard, etc.) is intentionally dropped.
  }

  return out.length ? out : APPROVED_CHANNELS.slice();
}

// Parse the base monthly dollar amount from a recommended package string like
// "$5,000/month SmartForecast (Growth)". Defaults to 5000 if not parseable.
function parseBudgetBase(recommendedPackage) {
  const match = String(recommendedPackage || '').replace(/,/g, '').match(/\$?\s*(\d{3,6})/);
  const value = match ? Number(match[1]) : 5000;
  return Number.isFinite(value) && value > 0 ? value : 5000;
}

function roundToNearest(value, step) {
  return Math.round(value / step) * step;
}

function formatUSD(value) {
  return '$' + Number(value || 0).toLocaleString('en-US');
}

// Peak months run at the full package amount; spend steps down in the off season.
const SEASON_BUDGET_MULTIPLIER = { 'Peak': 1, 'Shoulder': 0.7, 'Off-Season': 0.5 };

// Compute a suggested monthly media budget per plan month (lower in the off season)
// and attach totals to the estimate. Budget is derived from the recommended package,
// so the dollar math is deterministic rather than model-generated.
function applyBudgets(estimate) {
  const base = parseBudgetBase(estimate.recommended_package);
  const plan = Array.isArray(estimate.month_by_month_plan) ? estimate.month_by_month_plan : [];

  let total = 0;
  for (const row of plan) {
    const multiplier = SEASON_BUDGET_MULTIPLIER[row.season] ?? 1;
    // Round to the nearest $250, with a sensible off-season floor.
    const budget = Math.max(roundToNearest(base * multiplier, 250), 1000);
    row.suggested_budget = budget;
    row.suggested_budget_text = formatUSD(budget);
    total += budget;
  }

  const monthsCount = plan.length || 1;
  estimate.base_monthly_budget = base;
  estimate.base_monthly_budget_text = formatUSD(base);
  estimate.suggested_budget_total = total;
  estimate.suggested_budget_total_text = formatUSD(total);
  estimate.suggested_budget_months = plan.length;
  estimate.average_monthly_budget = roundToNearest(total / monthsCount, 50);
  estimate.average_monthly_budget_text = formatUSD(roundToNearest(total / monthsCount, 50));
  estimate.budget_note =
    `Suggested media budget starts at ${formatUSD(base)}/month during peak demand and steps down in the off season. ` +
    `Across the ${plan.length}-month plan the suggested total is ${formatUSD(total)}. ` +
    `Unused budget from slow-weather or off-season months rolls forward as SmartForecast credit.`;
  return estimate;
}

function buildProposalSummaryText(payload, estimate) {
  const triggers = (estimate.best_weather_triggers || []).join(', ');
  const channels = (estimate.recommended_channels || []).join(', ');
  const location = [[payload.city, payload.state].filter(Boolean).join(', '), payload.zip]
    .filter(Boolean).join(' ');
  return [
    `Smart RV Demand Package for ${payload.dealership_name}`,
    `Location: ${location}`,
    `Market Type: ${estimate.market_climate_region}`,
    `Sales Radius: ${payload.sales_radius_miles} miles | Service Radius: ${payload.service_radius_miles} miles`,
    `Estimated Campgrounds/RV Parks: ${estimate.campground_count_low}–${estimate.campground_count_high}`,
    `Estimated RV/Camping Sites: ${estimate.estimated_site_count_low}–${estimate.estimated_site_count_high}`,
    `Estimated Peak-Season Camper Reach: ${estimate.estimated_peak_season_reach_low}–${estimate.estimated_peak_season_reach_high}`,
    `Recommended Package: ${estimate.recommended_package}`,
    `Suggested Budget: ${estimate.base_monthly_budget_text}/month at peak, stepping down in the off season (plan total ${estimate.suggested_budget_total_text})`,
    `Recommended Channels: ${channels}`,
    `Audience & Data Targeting: In-market RV buyer data, campground & state-park geotargeting, and location look-back retargeting`,
    `Best Weather Triggers: ${triggers}`,
    '',
    estimate.dealer_summary,
    '',
    estimate.estimate_disclaimer
  ].join('\n');
}

function buildMonthByMonthText(estimate) {
  return (estimate.month_by_month_plan || [])
    .map(row => `${row.month} (${row.season || 'Peak'} · ${row.suggested_budget_text || ''}): ${row.campaign_focus} — ${row.recommended_message} [Triggers: ${(row.weather_triggers || []).join(', ')}]`)
    .join('\n');
}

// Compose a single, drop-in Opportunity Note for Smart 1 Suite (GHL).
// The whole summary is pre-built here so the workflow only needs ONE field
// ({{inboundWebhookRequest.opportunity_note}}) inside the "Add Note" action.
function buildOpportunityNote(payload, estimate, extra = {}) {
  const triggers = (estimate.best_weather_triggers || []).join(', ') || '—';
  const channels = (estimate.recommended_channels || []).join(', ') || '—';
  const location = [payload.city, payload.state].filter(Boolean).join(', ');
  const contactLine = [payload.contact_name, payload.email, payload.phone].filter(Boolean).join(' · ') || '—';
  const emailFlag = extra.email_provided ? 'Yes' : `No (placeholder used: ${extra.placeholder_email || ''})`;
  const submitted = extra.submitted_at
    ? new Date(extra.submitted_at).toLocaleString('en-US')
    : new Date().toLocaleString('en-US');

  const lines = [
    '=== SMART RV DEMAND — LEAD SUMMARY ===',
    `Dealership: ${payload.dealership_name || '—'}`,
    `Contact: ${contactLine}`,
    `Location: ${location ? location + ' ' : ''}${payload.zip || ''}`.trim(),
    `Website: ${payload.website_url || '—'}`,
    `Sales Radius: ${payload.sales_radius_miles || '—'} mi | Service Radius: ${payload.service_radius_miles || '—'} mi | Multiple Locations: ${payload.multiple_locations || '—'}`,
    '',
    `Lead Stage: ${extra.lead_stage || '—'}`,
    `Email Provided: ${emailFlag}`,
    `Lead ID: ${extra.lead_id || '—'}`,
    `Submitted: ${submitted}`,
    '',
    '--- MARKET ESTIMATE ---',
    `Market/Climate Region: ${estimate.market_climate_region || '—'}`,
    `Campgrounds & RV Parks: ${estimate.campground_count_low}–${estimate.campground_count_high}`,
    `Estimated RV/Camping Sites: ${estimate.estimated_site_count_low}–${estimate.estimated_site_count_high}`,
    `Estimated Peak-Season Camper Reach: ${estimate.estimated_peak_season_reach_low}–${estimate.estimated_peak_season_reach_high}`,
    '',
    '--- RECOMMENDATION ---',
    `Recommended Package: ${estimate.recommended_package || '—'}`,
    `Why: ${estimate.recommended_package_reason || '—'}`,
    `Suggested Budget: ${estimate.base_monthly_budget_text || '—'}/month at peak, stepping down in the off season (plan total ${estimate.suggested_budget_total_text || '—'} over ${estimate.suggested_budget_months || '—'} months)`,
    `Recommended Channels: ${channels}`,
    `Best Weather Triggers: ${triggers}`,
    `Audience & Data Targeting: In-market RV buyer data, campground & state-park geotargeting, location look-back retargeting`,
    '',
    '--- DEALER SUMMARY ---',
    estimate.dealer_summary || '—',
    '',
    '--- MONTH-BY-MONTH PLAN ---',
    buildMonthByMonthText(estimate) || '—',
    '',
    `Proposal PDF: ${extra.proposal_pdf_url || '(not generated)'}`,
    '',
    estimate.estimate_disclaimer || ''
  ];
  return lines.join('\n');
}

const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 22000);
const OPENAI_MAX_ATTEMPTS = Number(process.env.OPENAI_MAX_ATTEMPTS || 2);

async function callOpenAIOnce(payload) {
  // AbortController caps how long we wait so a slow/hung API call can't stall the lead.
  const completion = await openai.chat.completions.create(
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a marketing strategy estimator. Return only the requested JSON.' },
        { role: 'user', content: buildPrompt(payload) }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: estimateSchema
      }
    },
    { timeout: OPENAI_TIMEOUT_MS }
  );

  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');
  return JSON.parse(content);
}

// Try OpenAI up to N times (fast transient failures/timeouts are common on cold starts).
// Throws only after the last attempt fails — the caller then uses the fallback estimate.
async function createOpenAIEstimate(payload) {
  let lastErr;
  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callOpenAIOnce(payload);
    } catch (err) {
      lastErr = err;
      console.warn(`OpenAI estimate attempt ${attempt}/${OPENAI_MAX_ATTEMPTS} failed: ${err.message}`);
    }
  }
  throw lastErr;
}

// Region framework keyed by US state, mirroring the AI prompt's classification.
const STATE_REGION = {
  FL: 'Southern / Coastal Year-Round RV Market', AL: 'Southern / Coastal Year-Round RV Market',
  TX: 'Southern / Coastal Year-Round RV Market', LA: 'Southern / Coastal Year-Round RV Market',
  GA: 'Southern / Coastal Year-Round RV Market', NC: 'Southern / Coastal Year-Round RV Market',
  SC: 'Southern / Coastal Year-Round RV Market', MS: 'Southern / Coastal Year-Round RV Market',
  OH: 'Northern / Seasonal RV Market', MI: 'Northern / Seasonal RV Market',
  IN: 'Northern / Seasonal RV Market', IL: 'Northern / Seasonal RV Market',
  PA: 'Northern / Seasonal RV Market', NY: 'Northern / Seasonal RV Market',
  WI: 'Northern / Seasonal RV Market', MN: 'Northern / Seasonal RV Market',
  IA: 'Northern / Seasonal RV Market', MO: 'Northern / Seasonal RV Market',
  AZ: 'Desert / Southwest RV Market', NM: 'Desert / Southwest RV Market',
  NV: 'Desert / Southwest RV Market',
  CO: 'Mountain / Four-Season RV Market', UT: 'Mountain / Four-Season RV Market',
  ID: 'Mountain / Four-Season RV Market', MT: 'Mountain / Four-Season RV Market',
  WY: 'Mountain / Four-Season RV Market',
  WA: 'Pacific Northwest / Rain-Influenced RV Market', OR: 'Pacific Northwest / Rain-Influenced RV Market'
};

// Rough state lookup from the first digit(s) of a US ZIP, so the fallback can still
// pick a sensible region and seasonality when we only have a ZIP.
function stateFromZip(zip) {
  const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
  const p3 = Number(z.slice(0, 3));
  if (!Number.isFinite(p3)) return '';
  const ranges = [
    [0, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 54, 'VT'],
    [55, 69, 'MA'], [70, 89, 'NJ'], [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'],
    [200, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'],
    [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'],
    [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'],
    [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'],
    [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'],
    [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'], [750, 799, 'TX'],
    [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'],
    [870, 884, 'NM'], [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'],
    [980, 994, 'WA'], [995, 999, 'AK']
  ];
  for (const [lo, hi, st] of ranges) { if (p3 >= lo && p3 <= hi) return st; }
  return '';
}

// Deterministic fallback estimate used ONLY when OpenAI fails or times out, so a lead is
// NEVER lost and the visitor still gets a complete, sensible report. Shape matches the schema.
function buildFallbackEstimate(payload) {
  const state = (payload.state || stateFromZip(payload.zip) || '').toUpperCase();
  const region = STATE_REGION[state] || 'Northern / Seasonal RV Market';
  const yearRound = /Southern|Desert/.test(region);

  const radius = Number(payload.sales_radius_miles) || 75;
  const scale = Math.max(0.6, Math.min(2.2, radius / 75));
  const cgLow = Math.round(28 * scale);
  const cgHigh = Math.round(46 * scale);
  const siteLow = cgLow * 75;
  const siteHigh = cgHigh * 120;
  const reachLow = Math.round(siteLow * 2.4 * 6);
  const reachHigh = Math.round(siteHigh * 2.4 * 9);

  const startIdx = (currentMonthIndex + 1) % 12;
  const monthsCount = 12;
  const peakMonths = yearRound ? [2, 3, 4, 5, 6, 7, 8, 9] : [4, 5, 6, 7, 8];      // Mar–Oct vs May–Sep
  const offMonths = yearRound ? [0, 1] : [10, 11, 0, 1, 2];                        // fewer off months down south
  const warmTriggers = ['70°+ weekend', 'Heavy rain', 'Sunny weekend'];
  const coldTriggers = ['First frost', 'Frost warning', 'Freeze warning', 'Ice storm'];
  // Headline triggers shown on the report, tuned to the region.
  const triggers = yearRound
    ? ['70°+ weekend', 'Heavy rain', 'Storm/hurricane prep', 'Freeze warning']
    : ['70°+ weekend', 'First frost', 'Frost warning', 'Freeze warning', 'Ice storm'];

  const plan = [];
  for (let i = 0; i < monthsCount; i += 1) {
    const m = (startIdx + i) % 12;
    const season = peakMonths.includes(m) ? 'Peak' : (offMonths.includes(m) ? 'Off-Season' : 'Shoulder');
    const monthTriggers = season === 'Peak'
      ? warmTriggers
      : season === 'Off-Season'
        ? coldTriggers.slice(0, 3)
        : ['70°+ weekend', 'First frost', 'Frost warning'];
    plan.push({
      month: monthNames[m],
      season,
      campaign_focus: season === 'Peak'
        ? 'Peak RV sales + service demand'
        : season === 'Off-Season'
          ? 'Winterization, service & lead nurture'
          : 'Ramp-up sales & seasonal service',
      recommended_message: season === 'Peak'
        ? 'Weather’s right — come find your RV this weekend.'
        : season === 'Off-Season'
          ? 'Protect your RV: winterize, service & save.'
          : 'Get road-ready for the season ahead.',
      weather_triggers: monthTriggers
    });
  }

  // Package by market size (reach): Starter / Growth / Premium.
  // Thresholds tuned to the fallback's own reach range so the recommendation actually varies.
  const recommended_package = reachHigh > 130000
    ? '$7,500/month SmartForecast'
    : reachHigh > 85000
      ? '$5,000/month SmartForecast'
      : '$3,500/month SmartForecast';

  return {
    estimate_disclaimer: 'This is a marketing planning estimate generated from regional and ZIP-based assumptions, not an audited count. Individual results will vary.',
    market_climate_region: region,
    market_region_reason: `Classified from ZIP ${payload.zip || ''}${state ? ` (${state})` : ''} into the ${region}.`,
    campground_count_low: cgLow,
    campground_count_high: cgHigh,
    estimated_site_count_low: siteLow,
    estimated_site_count_high: siteHigh,
    estimated_peak_season_reach_low: reachLow,
    estimated_peak_season_reach_high: reachHigh,
    seasonal_share_assumption: '35%–45% seasonal campers',
    transient_share_assumption: '55%–65% transient/daily-weekly campers',
    peak_season_assumption: yearRound
      ? 'Year-round demand with spring–fall peak'
      : 'Spring-through-fall peak season',
    recommended_package,
    recommended_package_reason: 'Recommended from estimated market size and camper reach for your radius; adjustable after a strategy review.',
    recommended_channels: APPROVED_CHANNELS.slice(),
    best_weather_triggers: triggers,
    dealer_summary: `${payload.dealership_name || 'Your dealership'} sits in the ${region}. Smart 1 activates weather-triggered advertising across premium channels — powered by in-market RV buyer data, campground & state-park geotargeting, and location look-back retargeting — so your budget concentrates on the days demand is highest and steps down when it isn’t.`,
    month_by_month_plan: plan
  };
}

/**
 * Write the lead down, then hand it to the Hub. Returns what happened.
 *
 * The record comes first and unconditionally, so an unreachable Hub, a Suite
 * outage and a refused POST all leave a replayable lead instead of nothing.
 * This never throws: the caller used to catch a throw and log it, which is how
 * an unset SMART1_SUITE_WEBHOOK_URL came to look exactly like a bad afternoon
 * at GoHighLevel -- and that variable was in fact never set, so every lead this
 * app ever took was discarded.
 *
 * There is no webhook any more. The Hub writes the contact over the
 * GoHighLevel Contacts API and returns the contact id, which is proof a
 * contact exists rather than proof somebody accepted a request. See
 * lib/suiteLead.js, including why there is deliberately no fallback to the
 * old URL.
 */
async function sendToSmart1Suite(payload, kind = 'lead') {
  // The generated report is left out of the record: large, regenerable, already
  // on Cloudinary as a PDF, and the one field that would make a log line big
  // enough for two workers to interleave halves of it.
  const { proposal_summary_text, month_by_month_plan_text, opportunity_note, ...keep } = payload || {};
  const row = await leadStore.record(keep, kind);

  const res = await suiteLead.deliver({
    source: leadStore.SOURCE_SLUG,
    page: leadPage(),
    fields: suiteLead.leadFields(payload || {}),
    pdfUrl: String((payload || {}).report_pdf_url || ''),
    meta: suiteLead.leadMeta(payload || {}, [`report:${kind}`])
  });

  if (res.status === suiteLead.STATUS_DELIVERED) {
    await leadStore.mark(row, 'sent', {
      contact_id: res.contact_id, hub_lead_id: res.hub_lead_id,
      http_status: res.http_status
    });
  } else if (res.status === suiteLead.STATUS_ACCEPTED) {
    await leadStore.mark(row, 'accepted', {
      hub_lead_id: res.hub_lead_id, http_status: res.http_status, detail: res.detail
    });
  } else if (res.status === suiteLead.STATUS_UNDELIVERABLE) {
    await leadStore.mark(row, `undeliverable: ${res.detail.slice(0, 200)}`);
  } else {
    console.error('Lead not delivered to the Hub:', res.detail);
    await leadStore.mark(row, `failed: ${res.detail.slice(0, 200)}`,
                         { http_status: res.http_status });
  }

  return {
    // Only a contact id is a delivery. The Hub having stored the lead is its
    // own answer rather than being folded into this one, or "delivered" goes
    // back to meaning "somebody answered 200".
    ok: res.status === suiteLead.STATUS_DELIVERED,
    accepted: res.status === suiteLead.STATUS_ACCEPTED,
    undeliverable: res.status === suiteLead.STATUS_UNDELIVERABLE,
    recorded: true, lead_id: row.lead_id, contact_id: res.contact_id,
    status: res.http_status || null, detail: res.detail
  };
}

/**
 * Which placement this lead came from, as the Hub's `page` tag.
 *
 * The hostname, not the app's display name. This tool also runs inside the Hub
 * itself, so "which of the two produced this lead" is a real question and the
 * host is the only thing that answers it -- and it is short enough to read as a
 * tag in Smart 1 Suite, which a sentence is not.
 */
function leadPage() {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
  const host = base.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return host || `smart1${leadStore.SOURCE_SLUG}`;
}

// Bump this whenever you deploy so /health confirms the running build.
const BUILD = '2026-08-10-consistency-pass';

app.get('/health', (req, res) => {
  // `ok` stays true for the platform probe -- the app really is serving. Whether
  // it can DELIVER a lead is a different question, and it used to be unanswerable
  // from here: with no webhook URL set, every lead this app takes is undeliverable
  // and /health said nothing at all about it.
  const deliveryConfigured = suiteLead.configured();
  // Read for one reason: to say that a value is still sitting there. This app
  // no longer posts to it -- the Hub writes the contact over the Contacts API
  // -- so anything still firing on that URL is outside this codebase and would
  // write a second contact for one visitor.
  const retiredWebhookStillSet = Boolean((process.env.SMART1_SUITE_WEBHOOK_URL || '').trim());
  res.json({
    ok: true,
    status: deliveryConfigured ? 'ok' : 'degraded',
    service: 'smart1rv',
    build: BUILD,
    lead_delivery: {
      delivery: 'Smart 1 Hub -> GoHighLevel Contacts API',
      hub_endpoint: suiteLead.endpoint(),
      // Not a gate: an untrusted caller is rate-limited, not refused. Reported
      // because every lead this app sends arrives at the Hub from one address,
      // so without it the fourth visitor of a busy hour is turned away.
      rate_limit_token_set: Boolean(suiteLead.token()),
      retired_webhook_still_set: retiredWebhookStillSet,
      mirror_configured: Boolean((process.env.CLOUDINARY_URL || '').trim()),
      log: leadStore.leadsPath(),
      // Named for what it actually counts. The container's log does not survive
      // a restart or an idle spin-down, so a bare "owed: 0" would read as "no
      // leads outstanding" when it means "nothing outstanding since this
      // container started" -- a different and much weaker claim.
      owed_local: leadStore.unsent().length,
      // Counted apart from owed, never merged with it. A lead the Hub has
      // accepted is stored and is being retried there, so this app owes it to
      // nobody -- and it is still not a contact, which is a different claim
      // from "delivered" and has to read as one. An abandoned form with nobody
      // to contact is a third thing again, and a real visitor either way.
      accepted_by_hub: leadStore.accepted().length,
      undeliverable_no_contact: leadStore.undeliverable().length,
      owed_note: "counted from this container's own log, which does not survive a " +
        'restart or an idle spin-down; run replayFailed.js --from-cloudinary for ' +
        'the durable count'
    },
    detail: suiteLead.whyNot(),
    features: {
      progressive_capture: true,
      placeholder_email: PLACEHOLDER_EMAIL,
      requires_email_to_build: false,
      openai_retry_attempts: OPENAI_MAX_ATTEMPTS,
      openai_timeout_ms: OPENAI_TIMEOUT_MS,
      fallback_estimate: true,
      delivery_failure_nonfatal: true,
      estimate_cache: { enabled: true, size: estimateCache.size, ttl_ms: ESTIMATE_CACHE_TTL_MS }
    },
    timestamp: new Date().toISOString()
  });
});

const PLACEHOLDER_EMAIL = process.env.PLACEHOLDER_LEAD_EMAIL || 'rvdealer@smart1marketing.com';

// ---- Estimate cache -------------------------------------------------------
// The AI estimate is essentially a function of ZIP + sales radius + service radius,
// so we cache the finished (channel-normalized, budgeted) estimate and reuse it for
// repeat submissions. This makes common ZIPs return instantly and cuts OpenAI cost.
const ESTIMATE_CACHE_TTL_MS = Number(process.env.ESTIMATE_CACHE_TTL_MS || 24 * 60 * 60 * 1000); // 24h
const ESTIMATE_CACHE_MAX = Number(process.env.ESTIMATE_CACHE_MAX || 500);
const estimateCache = new Map(); // key -> { estimate, expires }

function estimateCacheKey(formData) {
  const zip = String(formData.zip || '').replace(/\D/g, '').slice(0, 5);
  // The cached estimate's dealer_summary names the dealership, so the key MUST
  // include the dealership too — otherwise Dealer B would get Dealer A's summary.
  const dealerSlug = String(formData.dealership_name || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${zip}|${formData.sales_radius_miles || ''}|${formData.service_radius_miles || ''}|${dealerSlug}`;
}

function getCachedEstimate(key) {
  const hit = estimateCache.get(key);
  if (!hit) return null;
  if (hit.expires < DateNow()) { estimateCache.delete(key); return null; }
  // structuredClone so a cached object is never mutated by later per-lead processing.
  return structuredClone(hit.estimate);
}

function setCachedEstimate(key, estimate) {
  if (estimateCache.size >= ESTIMATE_CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = estimateCache.keys().next().value;
    if (oldest !== undefined) estimateCache.delete(oldest);
  }
  estimateCache.set(key, { estimate: structuredClone(estimate), expires: DateNow() + ESTIMATE_CACHE_TTL_MS });
}

// Small indirection so tests can run without a real clock dependency.
function DateNow() { return Date.now(); }

// ---- Simple in-memory rate limit (per IP) for the expensive AI endpoint ----
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 10);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000); // 15 min
const rateBuckets = new Map(); // ip -> { count, resetAt }

function rateLimited(ip) {
  const now = DateNow();
  let bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  // Opportunistic cleanup so the map can't grow without bound.
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) { if (v.resetAt <= now) rateBuckets.delete(k); }
  }
  return bucket.count > RATE_LIMIT_MAX;
}

// Minimal shape check for a client-supplied reuse_estimate. Accept it only when it
// carries the expected top-level keys of a real estimate; otherwise recompute.
const REUSE_ESTIMATE_REQUIRED_KEYS = [
  'campground_count_low', 'campground_count_high',
  'estimated_site_count_low', 'estimated_site_count_high',
  'estimated_peak_season_reach_low', 'estimated_peak_season_reach_high',
  'recommended_package', 'dealer_summary', 'month_by_month_plan'
];

function isValidReuseEstimate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  if (!Array.isArray(candidate.month_by_month_plan)) return false;
  return REUSE_ESTIMATE_REQUIRED_KEYS.every(key => key in candidate);
}

app.post('/api/rv-demand/estimate-and-submit', async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Please try again in a few minutes.' });
    }

    const formData = normalizeFormPayload(req.body);
    // Backfill state from ZIP so location renders and region logic never sees a blank state.
    if (!formData.state) formData.state = stateFromZip(formData.zip);

    // Only dealership + ZIP are required. Email is captured later (to unlock the full report);
    // if it's missing we still save the lead using a placeholder inbox so nothing is lost.
    if (!formData.dealership_name || !formData.zip) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: dealership_name and zip are required.'
      });
    }

    // Progressive-capture metadata.
    const emailProvided = Boolean(formData.email);
    if (!formData.email) formData.email = PLACEHOLDER_EMAIL;
    if (!formData.proposal_recipient_email) formData.proposal_recipient_email = formData.email;
    const lead_id = String(req.body.lead_id || '').slice(0, 64);
    const lead_stage = String(req.body.lead_stage || (emailProvided ? 'Full Report Unlocked' : 'Preview — email not yet provided')).slice(0, 80);

    // Attribution (additive): pass through any UTM/click-id/referrer info the client sent.
    const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'referrer_url', 'landing_page_url'];
    const attribution = {};
    for (const key of ATTRIBUTION_KEYS) {
      const value = req.body[key];
      if (typeof value === 'string' && value) attribution[key] = value.slice(0, 300);
    }

    // Reuse the estimate/PDF from the preview call so the "unlock" call is cheap and consistent
    // (no second OpenAI call, no duplicate PDF), and the displayed numbers never drift.
    let estimate;
    let estimate_source = 'ai';
    if (isValidReuseEstimate(req.body.reuse_estimate)) {
      estimate = req.body.reuse_estimate;
      // Never trust client-supplied budget math: recompute from the recommended
      // package + season labels so tampered numbers can't reach the webhook/PDF.
      applyBudgets(estimate);
      estimate_source = 'reused';
    } else {
      const cacheKey = estimateCacheKey(formData);
      const cached = getCachedEstimate(cacheKey);
      if (cached) {
        // Instant + free: a matching ZIP/radius estimate was computed recently.
        estimate = cached;
        estimate_source = 'cache';
      } else {
        try {
          estimate = await createOpenAIEstimate(formData);
          estimate.recommended_channels = normalizeChannels(estimate.recommended_channels);
        } catch (aiErr) {
          // Never lose the lead: fall back to a deterministic, region-aware estimate.
          console.error('OpenAI estimate failed after retries; using fallback estimate:', aiErr.message);
          estimate = buildFallbackEstimate(formData);
          estimate.recommended_channels = normalizeChannels(estimate.recommended_channels);
          estimate_source = 'fallback';
        }
        // Compute suggested monthly budgets (peak-season baseline, stepping down in the off season).
        applyBudgets(estimate);
        // Cache only real, complete estimates (AI or fallback) for reuse by later leads.
        setCachedEstimate(cacheKey, estimate);
      }
    }
    estimate.estimate_source = estimate_source;

    // Generate the proposal PDF only on the unlock call (a real email was provided) —
    // the anonymous preview skips it so previews stay fast and cheap.
    // Cloudinary is PRIMARY storage; GHL media upload is kept as secondary so the
    // Suite workflow can still attach the file when configured.
    // Wrapped so a PDF or upload failure NEVER blocks the lead from reaching Smart 1 Suite.
    const proposal_pdf_filename = proposalFileName(formData);
    let proposal_pdf_url = String(req.body.reuse_pdf_url || '');
    if (!proposal_pdf_url && emailProvided && String(process.env.PROPOSAL_PDF_ENABLED || 'true').toLowerCase() !== 'false') {
      try {
        const pdfBuffer = await buildProposalPdf(formData, estimate, new Date().toLocaleDateString('en-US'));
        let cloudinaryUrl = '';
        try {
          cloudinaryUrl = (await uploadPdfToCloudinary(pdfBuffer, proposal_pdf_filename)) || '';
        } catch (cloudErr) {
          console.error('Cloudinary PDF upload failed (falling back to GHL media):', cloudErr.message);
        }
        let ghlUrl = '';
        try {
          ghlUrl = (await uploadPdfToGhlMedia(pdfBuffer, proposal_pdf_filename)) || '';
        } catch (ghlErr) {
          console.error('GHL media PDF upload failed:', ghlErr.message);
        }
        proposal_pdf_url = cloudinaryUrl || ghlUrl || '';
        if (!proposal_pdf_url) {
          console.warn('Proposal PDF generated but not uploaded (Cloudinary/GHL media not configured).');
        }
      } catch (pdfErr) {
        console.error('Proposal PDF generation/upload failed (continuing without it):', pdfErr.message);
      }
    }

    const suitePayload = {
      source: 'Smart RV Demand Estimate Form',
      lead_type: 'Smart RV Demand Package',
      lead_status: 'New RV Demand Lead',
      lead_stage,
      lead_id,
      email_provided: emailProvided,
      placeholder_email_used: !emailProvided,
      submitted_at: new Date().toISOString(),
      ...attribution,
      ...formData,
      selected_weather_triggers: formData.weather_triggers,
      selected_weather_triggers_text: formData.weather_triggers.join(', '),
      ...estimate,
      // Text-friendly ranges for easy Smart 1 Suite document merge fields
      campground_estimate_range: `${estimate.campground_count_low}–${estimate.campground_count_high} campgrounds and RV parks`,
      estimated_site_range: `${estimate.estimated_site_count_low}–${estimate.estimated_site_count_high} estimated RV/camping sites`,
      estimated_peak_season_reach_range: `${estimate.estimated_peak_season_reach_low}–${estimate.estimated_peak_season_reach_high} estimated peak-season camper reach`,
      recommended_channels_text: (estimate.recommended_channels || []).join(', '),
      audience_targeting_text: 'In-market RV buyer data, campground & state-park geotargeting, location look-back retargeting',
      best_weather_triggers_text: (estimate.best_weather_triggers || []).join(', '),
      suggested_monthly_budget_text: `${estimate.base_monthly_budget_text}/month at peak`,
      suggested_budget_total_text: estimate.suggested_budget_total_text,
      average_monthly_budget_text: estimate.average_monthly_budget_text,
      budget_note: estimate.budget_note,
      month_by_month_plan_text: buildMonthByMonthText(estimate),
      proposal_summary_text: buildProposalSummaryText(formData, estimate),
      // Single drop-in Opportunity Note for Smart 1 Suite: map {{inboundWebhookRequest.opportunity_note}}
      // straight into the workflow's "Add Note" action on the opportunity/contact.
      opportunity_note: buildOpportunityNote(formData, estimate, {
        lead_stage,
        lead_id,
        email_provided: emailProvided,
        placeholder_email: emailProvided ? '' : PLACEHOLDER_EMAIL,
        submitted_at: new Date().toISOString(),
        proposal_pdf_url
      }),
      proposal_pdf_url,
      proposal_pdf_filename
    };

    // The webhook post is best-effort: if Smart 1 Suite is briefly unreachable, the
    // visitor should STILL see their report. This comment used to say we "keep the
    // payload" and we kept nothing -- there was nowhere to keep it. Now the lead is
    // written down before the POST is attempted, so it is replayable either way.
    let suite_webhook_status = null;
    let suite_webhook_ok = false;
    let lead_recorded = false;
    let suite_webhook_detail = '';
    try {
      const suiteResult = await sendToSmart1Suite(suitePayload);
      suite_webhook_status = suiteResult.status;
      suite_webhook_ok = suiteResult.ok;
      lead_recorded = suiteResult.recorded;
      suite_webhook_detail = suiteResult.detail || '';
    } catch (hookErr) {
      // sendToSmart1Suite handles its own failures, so reaching here means
      // something unforeseen -- worth a distinct message rather than one that
      // blames the webhook for it.
      console.error('Unexpected failure recording or sending the lead:', hookErr.message);
      suite_webhook_detail = hookErr.message;
    }

    return res.json({
      ok: true,
      proposal_pdf_url,
      estimate,
      estimate_source,
      suite_webhook_ok,
      suite_webhook_status,
      // `ok` is about the report, which really was built. These say what
      // happened to the lead, so nothing on this response implies the CRM has
      // it when it does not -- and `lead_recorded` says it is replayable.
      lead_recorded,
      suite_webhook_detail
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      ok: false,
      error: 'Estimate or webhook submission failed.',
      detail: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`smart1rv running on port ${PORT}`);
});
