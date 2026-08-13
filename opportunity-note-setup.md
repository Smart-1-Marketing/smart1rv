# Smart RV Demand — Opportunity Note Setup (Smart 1 Suite / GoHighLevel)

The server now builds the entire lead summary into a single webhook field so you don't have to
assemble it token-by-token inside GHL. Just map that one field into an **Add Note** action.

## The easy way (recommended): one field

The webhook payload now includes:

```
opportunity_note
```

This is a fully formatted, multi-line summary (dealer info, market estimate, recommendation,
budget, channels, triggers, month-by-month plan, and the proposal PDF link).

**In your Smart 1 Suite workflow:**

1. Open the workflow triggered by the **Inbound Webhook** (the Smart RV Demand form).
2. After the **Create/Update Opportunity** step, add an **Add Note** action
   (Note can attach to the Contact or the Opportunity).
3. In the Note body, insert the custom value:

   ```
   {{inboundWebhookRequest.opportunity_note}}
   ```

   (If your builder shows a slightly different token style, use the field picker and choose
   `opportunity_note` from the inbound webhook sample data.)

4. Save. Every new lead now drops a complete summary note onto the opportunity automatically.

> Tip: Run the form once so GHL captures a fresh webhook sample, then the field picker will
> list `opportunity_note` (and every other field below) for easy selection.

## The manual way: build the note from individual fields

If you'd rather compose the note yourself in GHL, here are the individual webhook fields you can
pull in. Paste this into the Note body and the picker will fill each token:

```
=== SMART RV DEMAND — LEAD SUMMARY ===
Dealership: {{inboundWebhookRequest.dealership_name}}
Contact: {{inboundWebhookRequest.contact_name}} · {{inboundWebhookRequest.email}} · {{inboundWebhookRequest.phone}}
Location: {{inboundWebhookRequest.city}}, {{inboundWebhookRequest.state}} {{inboundWebhookRequest.zip}}
Website: {{inboundWebhookRequest.website_url}}
Sales Radius: {{inboundWebhookRequest.sales_radius_miles}} mi | Service Radius: {{inboundWebhookRequest.service_radius_miles}} mi | Multiple Locations: {{inboundWebhookRequest.multiple_locations}}

Lead Stage: {{inboundWebhookRequest.lead_stage}}
Email Provided: {{inboundWebhookRequest.email_provided}}
Lead ID: {{inboundWebhookRequest.lead_id}}
Submitted: {{inboundWebhookRequest.submitted_at}}

--- MARKET ESTIMATE ---
Market/Climate Region: {{inboundWebhookRequest.market_climate_region}}
Campgrounds & RV Parks: {{inboundWebhookRequest.campground_estimate_range}}
Estimated RV/Camping Sites: {{inboundWebhookRequest.estimated_site_range}}
Estimated Peak-Season Reach: {{inboundWebhookRequest.estimated_peak_season_reach_range}}

--- RECOMMENDATION ---
Recommended Package: {{inboundWebhookRequest.recommended_package}}
Why: {{inboundWebhookRequest.recommended_package_reason}}
Suggested Budget: {{inboundWebhookRequest.suggested_monthly_budget_text}} (plan total {{inboundWebhookRequest.suggested_budget_total_text}})
Budget Note: {{inboundWebhookRequest.budget_note}}
Recommended Channels: {{inboundWebhookRequest.recommended_channels_text}}
Best Weather Triggers: {{inboundWebhookRequest.best_weather_triggers_text}}
Audience & Data Targeting: {{inboundWebhookRequest.audience_targeting_text}}

--- DEALER SUMMARY ---
{{inboundWebhookRequest.dealer_summary}}

--- MONTH-BY-MONTH PLAN ---
{{inboundWebhookRequest.month_by_month_plan_text}}

Proposal PDF: {{inboundWebhookRequest.proposal_pdf_url}}

{{inboundWebhookRequest.estimate_disclaimer}}
```

## Full list of note-relevant webhook fields

Lead / contact:
`dealership_name`, `contact_name`, `email`, `phone`, `zip`, `city`, `state`, `website_url`,
`sales_radius_miles`, `service_radius_miles`, `multiple_locations`

Lead tracking:
`lead_stage`, `lead_id`, `email_provided`, `placeholder_email_used`, `submitted_at`,
`source`, `lead_type`, `lead_status`

Market estimate:
`market_climate_region`, `market_region_reason`,
`campground_estimate_range`, `estimated_site_range`, `estimated_peak_season_reach_range`,
`campground_count_low/high`, `estimated_site_count_low/high`, `estimated_peak_season_reach_low/high`

Recommendation & plan:
`recommended_package`, `recommended_package_reason`,
`recommended_channels_text`, `best_weather_triggers_text`, `audience_targeting_text`,
`suggested_monthly_budget_text`, `suggested_budget_total_text`, `average_monthly_budget_text`,
`budget_note`, `dealer_summary`, `month_by_month_plan_text`, `estimate_disclaimer`

Assets:
`proposal_pdf_url`, `proposal_pdf_filename`, `proposal_summary_text`

Pre-composed:
`opportunity_note`  ← the all-in-one note field

---

**Deploy note:** push the updated `server.js` to GitHub so Render redeploys. Verify at
`https://smart1rv.onrender.com/health` — the `build` value should read `2026-08-10-consistency-pass`.
