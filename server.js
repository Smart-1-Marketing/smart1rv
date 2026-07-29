const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) 
  : '*';

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure Environment Variables
const GHL_WEBHOOK_URL = process.env.SMART1_WEBHOOK_URL || process.env.GHL_WEBHOOK_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Configure Cloudinary from CLOUDINARY_URL
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloudinary_url: process.env.CLOUDINARY_URL
  });
}

// Helper to sanitize filenames
function sanitizeString(str) {
  if (!str) return '';
  return str.replace(/[^\w\s-]/gi, '').trim().replace(/[-\s]+/g, '_');
}

// AI Strategy Generation
async function generateAiAnalysis(data) {
  if (!OPENAI_API_KEY) {
    return "Custom RV dealership promotional marketing audit detailing seasonal demand strategies, local search optimization, and lead acquisition pipelines.";
  }

  try {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Generate a 3-paragraph RV dealership marketing audit for '${data.company || 'RV Dealership'}'. Contact: ${data.name || 'Valued Client'}. Cover seasonal lead generation, PPC search targeting, and trade-in campaigns.`
      }],
      max_tokens: 350
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI Error:', err.message);
    return `RV Marketing Audit: Tailored digital acquisition blueprint. (AI Note: ${err.message})`;
  }
}

// Core Lead Handler
async function handleLeadSubmission(req, res) {
  try {
    const data = req.body || {};
    const clientEmail = (data.email || 'client').trim();
    const clientName = sanitizeString(data.name || 'lead');
    const companyName = sanitizeString(data.company || data.company_name || '');

    const fileIdentifier = companyName 
      ? `smart1rv_${companyName}_${clientName}_${clientEmail}`
      : `smart1rv_${clientName}_${clientEmail}`;

    // 1. Generate AI Summary
    const aiAnalysis = await generateAiAnalysis(data);

    // 2. Upload Report Summary / Data to Cloudinary
    let pdfUrl = null;
    try {
      if (process.env.CLOUDINARY_URL) {
        // Upload textual report payload / buffer to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(
          `data:text/plain;base64,${Buffer.from(aiAnalysis).toString('base64')}`, 
          {
            resource_type: 'raw',
            public_id: `reports/smart1rv/${fileIdentifier}.txt`,
            overwrite: true
          }
        );
        pdfUrl = uploadResult.secure_url;
      }
    } catch (cErr) {
      console.error('Cloudinary Upload Error:', cErr.message);
    }

    // Fallback URL if Cloudinary is unconfigured
    const publicBase = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const finalReportUrl = pdfUrl || `${publicBase}/api/download-report?email=${encodeURIComponent(clientEmail)}`;

    // 3. Trigger GoHighLevel Inbound Webhook
    let ghlStatus = null;
    if (GHL_WEBHOOK_URL) {
      const ghlPayload = {
        opportunity_name: `${data.company || data.name || 'Client'} - Smart1 RV Lead`,
        client_name: data.name || '',
        client_email: clientEmail,
        client_phone: data.phone || '',
        company_name: data.company || '',
        client_pdf_url: finalReportUrl,
        source: 'Smart1 RV Landing Page',
        ai_summary: aiAnalysis,
        campaign_data: data
      };

      try {
        const ghlRes = await axios.post(GHL_WEBHOOK_URL, ghlPayload, { timeout: 10000 });
        ghlStatus = ghlRes.status;
      } catch (wErr) {
        console.error('GHL Webhook Error:', wErr.message);
      }
    }

    return res.status(200).json({
      status: 'success',
      client_pdf_url: finalReportUrl,
      cloudinary_upload: Boolean(pdfUrl),
      ghl_status_code: ghlStatus
    });

  } catch (err) {
    console.error('Error in handleLeadSubmission:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

// Routes
app.post('/api/rv-demand/estimate-and-submit', handleLeadSubmission);
app.post('/api/submit-lead', handleLeadSubmission);

app.get('/api/download-report', (req, res) => {
  const email = req.query.email || 'client';
  res.setHeader('Content-disposition', `attachment; filename=Smart1RV_Report_${email}.txt`);
  res.setHeader('Content-type', 'text/plain');
  res.send(`Smart1 RV Marketing Audit\nRequested by: ${email}\n\nYour automated marketing strategy has been successfully processed and delivered.`);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
