# Render Instructions for smart1rv

## 1. Push project to GitHub

Create a GitHub repository named:

```txt
smart1rv
```

Upload or push all files in this project folder.

## 2. Create Render Web Service

1. Log in to Render.
2. Click **New +**.
3. Choose **Web Service**.
4. Connect your GitHub repository.
5. Select `smart1rv`.

Use these settings:

```txt
Name: smart1rv
Runtime: Node
Branch: main
Root Directory: leave blank
Build Command: npm install
Start Command: npm start
Plan: Starter or higher
```

## 3. Add environment variables

In Render, open the service and go to **Environment**.

Add these variables:

```txt
OPENAI_API_KEY=your-openai-api-key
SMART1_SUITE_WEBHOOK_URL=your-smart-1-suite-webhook-url
OPENAI_MODEL=gpt-4o-mini
NODE_ENV=production
ALLOWED_ORIGINS=https://your-smart1-site-domain.com,https://www.your-smart1-site-domain.com
```

### Notes

`OPENAI_API_KEY` should be your real OpenAI API key.

`SMART1_SUITE_WEBHOOK_URL` should be the inbound webhook URL from Smart 1 Suite / GoHighLevel.

`ALLOWED_ORIGINS` should be the domain where the form is embedded. During testing, you can leave this blank to allow all origins. After launch, restrict it.

## 4. Deploy

Click **Create Web Service**.

Render will run:

```bash
npm install
npm start
```

## 5. Test the health endpoint

Open:

```txt
https://smart1rv.onrender.com/health
```

Expected response:

```json
{
  "ok": true,
  "service": "smart1rv",
  "build": "2026-08-10-consistency-pass",
  "timestamp": "..."
}
```

## 6. Test the form

Open:

```txt
https://smart1rv.onrender.com
```

Complete the form and confirm the lead arrives in Smart 1 Suite.

## 7. Embed on Smart 1 Sites

### Easiest embed

Use an iframe:

```html
<iframe
  src="https://smart1rv.onrender.com"
  style="width:100%; min-height:1050px; border:0;"
  loading="lazy">
</iframe>
```

### Direct embed option

If you paste the form directly into a Smart 1 Sites custom code block, add this before loading `script.js`:

```html
<script>
  window.SMART1RV_API_BASE = "https://smart1rv.onrender.com";
</script>
<script src="https://smart1rv.onrender.com/script.js"></script>
```

Then set `ALLOWED_ORIGINS` in Render to your Smart 1 Sites domain.

## 8. Smart 1 Suite automation

The Render app sends the full lead and AI estimate to your webhook. In Suite, create a workflow that:

1. Creates or updates the contact.
2. Creates a new opportunity.
3. Saves estimate values into custom fields.
4. Generates the proposal document using those custom values.
5. Emails the document to the proposal recipient.
6. Notifies the assigned salesperson.
