# Smart RV Demand → Create an Opportunity in Smart 1 Suite (GoHighLevel)

The clean, three-step build. Each Smart RV Demand form submission becomes a
**Contact + Opportunity + summary Note** — no custom fields required. The whole report comes
across pre-formatted in one webhook field (`opportunity_note`), so you don't map dozens of fields.

The webhook fires **twice** per lead (progressive capture):
1. **Preview** — when the report is built (a placeholder email is used if none given yet).
2. **Full Report Unlocked** — when the visitor enters their email.

Both carry the same `lead_id`, so the workflow *updates* the same contact/opportunity instead of
creating duplicates (handled in Step 3).

---

## One-time prep

1. **Create a Pipeline** (e.g. *Smart RV Demand*) with stages such as:
   `New Lead → Report Previewed → Full Report Unlocked → Consult Booked → Proposal Sent → Won/Lost`.
2. **Deploy the current server** so the `opportunity_note` field exists in the webhook. Confirm at
   `https://smart1rv.onrender.com/health` → `build` should read `2026-08-10-consistency-pass`.
3. **Capture a webhook sample.** After deploy, submit the live form once so GHL has real sample data
   (including `opportunity_note`) to map from.

> No custom fields needed for the basic build. The fields in
> `fields/smart1rv-custom-fields.json` (bare snake_case keys matching the webhook payload) are
> optional and only worth adding if you want to *filter or automate* on specific values (package,
> region, radius, proposal PDF URL). For "open the opportunity and read the summary," skip them.
>
> **Native field mappings cover the rest:** `dealership_name` → native Business/Company Name,
> `contact_name` → native First/Last Name, `city`/`state`/`zip`/`address` → native City, State,
> Postal Code, Street Address, and `website_url` → native Website. Do NOT create custom fields
> for those — map them in Step 1 below.

---

## Trigger — Inbound Webhook

1. **Automation → Workflows → + Create Workflow → Start from Scratch.**
2. Add trigger **Inbound Webhook**. Copy the webhook URL GHL generates.
3. Set that URL as `SMART1_SUITE_WEBHOOK_URL` in Render (Environment) and redeploy.
4. Submit the form once, then click **Fetch Sample Request / Auto-map** so every field becomes
   selectable as `{{inboundWebhookRequest.<field>}}`.

*(Recommended)* Add an **If/Else** right after the trigger so blank rows don't create opportunities:
condition `{{inboundWebhookRequest.dealership_name}}` **Is not empty**. Put the steps below on the
**Yes** branch.

---

## Step 1 — Create/Update Contact

Add action **Contacts → Create/Update Contact** (creates new, updates existing). Map just these:

| Contact field | Webhook value |
|---|---|
| Email | `{{inboundWebhookRequest.email}}` |
| Phone | `{{inboundWebhookRequest.phone}}` |
| First Name | `{{inboundWebhookRequest.contact_name}}` |
| Company Name | `{{inboundWebhookRequest.dealership_name}}` |
| City | `{{inboundWebhookRequest.city}}` |
| State | `{{inboundWebhookRequest.state}}` |
| Postal Code | `{{inboundWebhookRequest.zip}}` |
| Source | `{{inboundWebhookRequest.source}}` |

That's enough to create a clean, findable contact. Nothing else is required.

---

## Step 2 — Create/Update Opportunity

Add action **Opportunities → Create/Update Opportunity.** This links to the contact from Step 1
automatically.

| Setting | Value |
|---|---|
| Pipeline | *Smart RV Demand* |
| Stage | Branch on `{{inboundWebhookRequest.lead_stage}}`: contains "Unlocked" → **Full Report Unlocked**, else **Report Previewed** (or just set **New Lead** and move it manually) |
| Opportunity Name | `{{inboundWebhookRequest.dealership_name}} – Smart RV Demand` |
| Status | **Open** |
| Lead Value | `{{inboundWebhookRequest.base_monthly_budget}}` (numeric) — or type a fixed number |
| Source | `{{inboundWebhookRequest.source}}` |

> **Prevent duplicate cards:** set **"Allow Duplicate Opportunity" = No** (or "update existing open
> opportunity for this contact"). Since Preview and Unlock share the same contact, GHL then advances
> the one card through stages instead of making a second.

---

## Step 3 — Add Note (the summary)

Add action **Contacts → Add Note.** Note body:

```
{{inboundWebhookRequest.opportunity_note}}
```

This single field is the full, pre-formatted summary — dealer info, market estimate, recommended
package, budget, channels, weather triggers, month-by-month plan, and the proposal PDF link. It
lands on the opportunity's activity timeline, ready to read.

*(Optional)* Want the note only when they unlock? Put this action on a branch where
`{{inboundWebhookRequest.lead_stage}}` **contains** "Unlocked".

*(Optional)* Want the PDF right there too? It's already in the note as a link, but you can also add a
**Send Email** action and link `{{inboundWebhookRequest.proposal_pdf_url}}`
(filename `{{inboundWebhookRequest.proposal_pdf_filename}}`).

---

## The whole flow

```
Inbound Webhook (form)
      │
   If dealership_name not empty  → Yes
      ├─ Create/Update Contact       (email, phone, name, company, city/state/zip, source)
      ├─ Create/Update Opportunity   (Pipeline: Smart RV Demand, stage by lead_stage, no duplicates)
      └─ Add Note  →  {{inboundWebhookRequest.opportunity_note}}
```

Three actions. The opportunity opens with the full report on its timeline — ready to go.

---

## Handy tokens (only if you want them)

Value for the opportunity: `base_monthly_budget` (numeric), `recommended_package` (text).
Assets: `proposal_pdf_url`, `proposal_pdf_filename`, `proposal_summary_text`.
Tracking: `lead_id`, `lead_stage`, `email_provided`, `submitted_at`.
Everything else (market estimate, channels, triggers, plan) is already inside `opportunity_note`.
