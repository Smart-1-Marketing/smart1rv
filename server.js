const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for smart1marketing.com and all subdomains/embeds
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment Variables
const GHL_WEBHOOK_URL = process.env.SMART1_WEBHOOK_URL || process.env.GHL_WEBHOOK_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });
}

function sanitizeString(str) {
  if (!str) return '';
  return str.replace(/[^\w\s-]/gi, '').trim().replace(/[-\s]+/g, '_');
}

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
        content: `Generate a 3-paragraph RV dealership marketing audit for '${data.company || data.dealership || 'RV Dealership'}'. Contact: ${data.name || 'Valued Client'}. ZIP: ${data.zip || 'N/A'}.`
      }],
      max_tokens: 350
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI Error:', err.message);
    return `RV Marketing Audit Strategy Report. (AI Note: ${err.message})`;
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

    const aiAnalysis = await generateAiAnalysis(data);

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

    if (GHL_WEBHOOK_URL) {
      const ghlPayload = {
        opportunity_name: `${data.company || data.dealership || data.name || 'Client'} - RV Lead`,
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
        await axios.post(GHL_WEBHOOK_URL, ghlPayload, { timeout: 10000 });
      } catch (wErr) {
        console.error('GHL Webhook Error:', wErr.message);
      }
    }

    // Return ALL expected JSON keys to ensure frontend script succeeds
    return res.status(200).json({
      success: true,
      status: 'success',
      client_pdf_url: finalReportUrl,
      pdf_url: finalReportUrl,
      download_url: finalReportUrl,
      estimate: {
        summary: aiAnalysis,
        pdf_url: finalReportUrl
      },
      message: 'Lead processed successfully'
    });

  } catch (err) {
    console.error('Submission Error:', err);
    return res.status(200).json({ 
      success: false, 
      status: 'error', 
      message: err.message 
    });
  }
}

app.get('/', (req, res) => {
  res.status(200).send('Smart1 RV Demand API Server Active');
});

app.post('/api/rv-demand/estimate-and-submit', handleLeadSubmission);
app.post('/api/submit-lead', handleLeadSubmission);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
