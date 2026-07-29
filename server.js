const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 5000;

// Explicit CORS setup for smart1marketing.com embed
const defaultOrigins = [
  'https://smart1marketing.com',
  'https://www.smart1marketing.com',
  'https://smart1rv.onrender.com'
];

const envOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) 
  : [];

const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

app.use(cors({
  origin: function (origin, callback) {
    // Allow non-browser requests (Postman, cURL, server-to-server) or matched origins
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Fallback: permit request to prevent CORS blockage on embeds
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Environment Variables
const GHL_WEBHOOK_URL = process.env.SMART1_WEBHOOK_URL || process.env.GHL_WEBHOOK_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Configure Cloudinary SDK
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloudinary_url: process.env.CLOUDINARY_URL
  });
}

function sanitizeString(str) {
  if (!str) return '';
  return str.replace(/[^\w\s-]/gi, '').trim().replace(/[-\s]+/g, '_');
}

async function generateAiAnalysis(data) {
  if (!OPENAI_API_KEY) {
    return (
      "Smart1 RV Dealership Market & Demand Strategy:\n\n" +
      "1. Weather-Triggered Activation: Automatically activate search and CTV ads during 70°+ warm weekends, freeze warnings, and weather shifts.\n" +
      "2. Local Campground Geo-Fencing: Target active campers and RV owners within a 50-mile radius using mobile device look-backs.\n" +
      "3. Full-Funnel Service & Trade-Ins: Capture urgent maintenance, winterization, and upgrade demand as weather conditions change."
    );
  }

  try {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const prompt = 
      `Generate a 3-paragraph RV dealership marketing audit for '${data.company || data.dealership || 'RV Dealership'}'. ` +
      `Contact Name: ${data.name || 'Valued Client'}. ZIP Code: ${data.zip || data.zipcode || 'N/A'}. ` +
      `Detail strategies for weather-triggered advertising, campground geotargeting, and seasonal trade-in/service campaigns.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 350
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI Generation Error:', err.message);
    return `RV Marketing Demand Blueprint: Tailored weather-triggered growth strategy. (AI Note: ${err.message})`;
  }
}

async function handleLeadSubmission(req, res) {
  try {
    const data = req.body || {};
    const clientEmail = (data.email || 'client').trim();
    const clientName = sanitizeString(data.name || 'lead');
    const companyName = sanitizeString(data.company || data.dealership || data.company_name || '');

    const fileIdentifier = companyName 
      ? `smart1rv_${companyName}_${clientName}_${clientEmail}`
      : `smart1rv_${clientName}_${clientEmail}`;

    // 1. Generate AI Market Strategy Analysis
    const aiAnalysis = await generateAiAnalysis(data);

    // 2. Upload Report to Cloudinary
    let pdfUrl = null;
    try {
      if (process.env.CLOUDINARY_URL) {
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

    const publicBase = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const finalReportUrl = pdfUrl || `${publicBase}/api/download-report?email=${encodeURIComponent(clientEmail)}`;

    // 3. Post Data to GoHighLevel Webhook
    let ghlStatus = null;
    if (GHL_WEBHOOK_URL) {
      const ghlPayload = {
        opportunity_name: `${data.company || data.dealership || data.name || 'Client'} - RV Demand Lead`,
        client_name: data.name || '',
        client_email: clientEmail,
        client_phone: data.phone || '',
        company_name: data.company || data.dealership || '',
        zip_code: data.zip || data.zipcode || '',
        client_pdf_url: finalReportUrl,
        source: 'smart1marketing.com/rv-dealer-marketing-gameplan',
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
    console.error('Fatal Error in handleLeadSubmission:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

// Health check / landing page route
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'Smart1 RV Demand API Backend Engine',
    embedded_page: 'https://smart1marketing.com/rv-dealer-marketing-gameplan'
  });
});

// Form submission API routes
app.post('/api/rv-demand/estimate-and-submit', handleLeadSubmission);
app.post('/api/submit-lead', handleLeadSubmission);

// Backup direct download endpoint
app.get('/api/download-report', (req, res) => {
  const email = req.query.email || 'client';
  res.setHeader('Content-disposition', `attachment; filename=Smart1RV_Report_${email}.txt`);
  res.setHeader('Content-type', 'text/plain');
  res.send(`Smart1 RV Marketing & Demand Report\nRequested by: ${email}\n\nYour market strategy report has been processed successfully.`);
});

app.listen(PORT, () => {
  console.log(`Smart1 RV Node Server running on port ${PORT}`);
});
