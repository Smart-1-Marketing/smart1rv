// Server-side proposal PDF generation + upload to Smart 1 Suite (HighLevel) media library.
// Uses pdfkit so no headless browser is required (reliable on Render Starter).
// Styled to match the Smart 1 "Marketing Efficiency Audit" look: navy header band,
// teal accent rule, spec strip, stat cards, benchmark bars, a navy "opportunity" box
// with gold savings numbers, colored callouts, and page footers.
import PDFDocument from 'pdfkit';

// ---- Palette -------------------------------------------------------------
const HEADER = '#16294D';   // deep navy header band
const NAVY   = '#1A2E58';   // headings / brand navy
const BLUE   = '#28477F';
const TEAL   = '#19C6B0';    // accent rule + positive values
const CYAN   = '#3EC6F0';    // logo accent + channel bar
const GOLD   = '#F5B301';    // money / opportunity numbers
const RED    = '#E0503B';    // warning
const TEXT   = '#20303F';
const MUTED  = '#687386';
const LABEL  = '#6B7A90';    // section labels
const BORDER = '#E4E9F1';
const LIGHTBG = '#F6F9FE';

const PAGE_W = 612;          // LETTER
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

const CONSULT_URL = 'https://smart1marketing.com/rvmarketingconsult';

// Good / Better / Best pricing tiers (matched to market size by recommended package).
const PACKAGE_TIERS = [
  { key: 'Good', name: 'Starter', amount: 3500, tagline: 'Smaller or single-location markets testing weather-triggered demand.',
    includes: ['Core CTV, Streaming Radio & Display', 'Primary weather triggers for your region', 'Campground & state-park geotargeting'] },
  { key: 'Better', name: 'Growth', amount: 5000, tagline: 'Most popular — the full weather-triggered stack with peak-season weight.',
    includes: ['Everything in Starter', 'Podcasts + Location Look-Back Retargeting', 'Higher share of voice in peak weeks'] },
  { key: 'Best', name: 'Premium', amount: 7500, tagline: 'Larger or multi-location dealers in competitive markets.',
    includes: ['Everything in Growth', 'Digital Out-of-Home (DOOH) coverage', 'Maximum trigger & peak-season weight'] }
];

// ---- helpers -------------------------------------------------------------
function num(v) { return Number(v || 0).toLocaleString('en-US'); }
function usd(v) { return '$' + Number(v || 0).toLocaleString('en-US'); }
function round(v, step) { return Math.round(v / step) * step; }

export function safeFileName(name) {
  return String(name || 'RV Dealer').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
}
export function proposalFileName(formData) {
  return `${safeFileName(formData.dealership_name || 'RV Dealer')} Weather Marketing Proposal.pdf`;
}

function parseBudgetBase(pkg) {
  const m = String(pkg || '').replace(/,/g, '').match(/\$?\s*(\d{3,6})/);
  const v = m ? Number(m[1]) : 5000;
  return Number.isFinite(v) && v > 0 ? v : 5000;
}

// Directional savings/opportunity model built from the recommended plan.
function buildSavings(estimate) {
  const B = Number(estimate.base_monthly_budget) > 0
    ? Number(estimate.base_monthly_budget)
    : parseBudgetBase(estimate.recommended_package);
  const plan = Array.isArray(estimate.month_by_month_plan) ? estimate.month_by_month_plan : [];
  const months = Number(estimate.suggested_budget_months) || plan.length || 12;
  const planTotal = Number(estimate.suggested_budget_total) > 0
    ? Number(estimate.suggested_budget_total)
    : Math.round(B * months * 0.8);

  const flatAnnual = B * 12;                                   // always-on flat at peak rate
  const budgetSaved = Math.max(0, flatAnnual - planTotal);     // off-season step-down not spent
  const concentration = round(planTotal * 0.30, 50);           // media moved to high-intent days
  const recaptured = budgetSaved + concentration;
  const rangeLow = round(budgetSaved + planTotal * 0.20, 100);
  const rangeHigh = round(budgetSaved + planTotal * 0.40, 100);
  const activeMonths = plan.filter(r => r.season === 'Peak' || r.season === 'Shoulder').length || Math.round(months * 0.6);
  const activePct = Math.round((activeMonths / (months || 12)) * 100);

  // Traditional-advertising comparison (directional).
  const reachMid = ((Number(estimate.estimated_peak_season_reach_low) || 0) + (Number(estimate.estimated_peak_season_reach_high) || 0)) / 2 || 50000;
  const households = round(reachMid / 2.4, 100);              // ~2.4 people per household
  const directMailOne = round(households * 0.6, 100);          // one untargeted postcard drop @ ~$0.60
  const tradAnnualLow = round(planTotal * 1.5, 100);           // matching season-long traditional presence
  const tradAnnualHigh = round(planTotal * 2.0, 100);

  return { B, planTotal, flatAnnual, budgetSaved, concentration, recaptured, rangeLow, rangeHigh,
    activeMonths, months, activePct, households, directMailOne, tradAnnualLow, tradAnnualHigh };
}

// Build the proposal PDF as a Buffer.
export function buildProposalPdf(formData, estimate, dateStr) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN, bufferPages: true });
      const chunks = [];
      doc.on('data', d => chunks.push(d));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const dealership = (formData.dealership_name || 'RV Dealer').trim();
      const s = buildSavings(estimate);

      // ---------- reusable drawing primitives ----------
      const wordmark = (x, y, scale = 1) => {
        // logo chip
        const chip = 18 * scale;
        doc.roundedRect(x, y, chip, chip, 4 * scale).fill(CYAN);
        doc.circle(x + chip / 2, y + chip / 2, 3.4 * scale).fill('#fff');
        // wordmark text
        const tx = x + chip + 7 * scale;
        const ty = y + chip / 2 - 8 * scale;
        doc.fontSize(15 * scale);
        doc.font('Helvetica-Bold').fillColor('#fff').text('SMART', tx, ty, { continued: true, lineBreak: false });
        doc.fillColor(CYAN).text('1', { continued: true, lineBreak: false });
        doc.font('Helvetica').fillColor('#eaf1fb').text('MARKETING', { lineBreak: false });
      };

      const headerTall = () => {
        doc.rect(0, 0, PAGE_W, 108).fill(HEADER);
        doc.rect(0, 108, PAGE_W, 4).fill(TEAL);
        wordmark(MARGIN, 24, 1);
        doc.font('Helvetica-Bold').fontSize(19).fillColor('#fff').text('Smart RV Demand Report', MARGIN, 56);
        doc.font('Helvetica').fontSize(10.5).fillColor('#aebfdd').text('Weather-triggered advertising opportunity — directional assessment', MARGIN, 82);
      };

      const headerCompact = () => {
        doc.rect(0, 0, PAGE_W, 60).fill(HEADER);
        doc.rect(0, 60, PAGE_W, 4).fill(TEAL);
        wordmark(MARGIN, 18, 0.92);
        doc.font('Helvetica').fontSize(10).fillColor('#aebfdd')
          .text(dealership, PAGE_W - MARGIN - 260, 26, { width: 260, align: 'right' });
      };

      let firstPage = true;
      doc.on('pageAdded', () => { headerCompact(); doc.x = MARGIN; doc.y = 84; });

      const ensure = (h) => { if (doc.y + h > PAGE_H - 66) doc.addPage(); };

      // ensure enough room for the label AND the first block under it (no orphaned headings)
      const sectionLabel = (t, keepWith = 60) => {
        ensure(30 + keepWith);
        const y = doc.y + 8;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(LABEL)
          .text(t.toUpperCase(), MARGIN, y, { characterSpacing: 1.5 });
        const ry = doc.y + 5;
        doc.moveTo(MARGIN, ry).lineTo(PAGE_W - MARGIN, ry).lineWidth(1).strokeColor(BORDER).stroke();
        doc.y = ry + 12;
        doc.x = MARGIN;
      };

      const para = (t, opts = {}) => {
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10.5)
          .fillColor(opts.color || TEXT)
          .text(t, MARGIN, doc.y, { width: CONTENT_W, align: opts.align || 'left', lineGap: opts.lineGap ?? 1.5 });
      };

      // spec strip: array of {label, value}
      const specStrip = (pairs) => {
        const cols = 3;
        const rows = Math.ceil(pairs.length / cols);
        const pad = 16;
        const h = pad * 2 + rows * 34 - 8;
        ensure(h + 6);
        const y0 = doc.y;
        doc.roundedRect(MARGIN, y0, CONTENT_W, h, 10).lineWidth(1).strokeColor(BORDER).fillAndStroke('#fff', BORDER);
        const colW = (CONTENT_W - pad * 2) / cols;
        pairs.forEach((p, i) => {
          const r = Math.floor(i / cols), c = i % cols;
          const x = MARGIN + pad + c * colW;
          const y = y0 + pad + r * 34;
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(LABEL).text(String(p.label).toUpperCase(), x, y, { width: colW - 8, characterSpacing: 0.8 });
          doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(p.value, x, y + 11, { width: colW - 8 });
        });
        doc.y = y0 + h + 14;
      };

      // stat cards: array of {value, label, sub, color}
      const statCards = (cards) => {
        const gap = 12;
        const cardW = (CONTENT_W - gap * 2) / 3;
        const cardH = 74;
        ensure(cardH + 8);
        const y0 = doc.y;
        cards.forEach((c, i) => {
          const x = MARGIN + i * (cardW + gap);
          doc.roundedRect(x, y0, cardW, cardH, 10).lineWidth(1).strokeColor(BORDER).fillAndStroke('#fff', BORDER);
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(LABEL).text(String(c.label).toUpperCase(), x + 14, y0 + 13, { width: cardW - 24, characterSpacing: 0.7 });
          doc.font('Helvetica-Bold').fontSize(17).fillColor(c.color || NAVY).text(c.value, x + 14, y0 + 26, { width: cardW - 24 });
          if (c.sub) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(c.sub, x + 14, y0 + 52, { width: cardW - 24 });
        });
        doc.y = y0 + cardH + 14;
      };

      // comparison bar: full-width track with a filled portion
      const compareBar = (label, leftText, rightText, frac, fillColor) => {
        ensure(50);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(label, MARGIN, doc.y);
        const y = doc.y + 4;
        const barH = 18;
        doc.roundedRect(MARGIN, y, CONTENT_W, barH, 5).fill('#EEF2F8');
        doc.roundedRect(MARGIN, y, Math.max(30, CONTENT_W * frac), barH, 5).fill(fillColor);
        doc.y = y + barH + 4;
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(leftText, MARGIN, doc.y, { width: CONTENT_W / 2, align: 'left' });
        doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(rightText, MARGIN + CONTENT_W / 2, doc.y - doc.currentLineHeight(), { width: CONTENT_W / 2, align: 'right' });
        doc.y += 10;
      };

      // colored left-border callout
      const callout = (color, title, body) => {
        doc.font('Helvetica-Bold').fontSize(10.5);
        const titleH = doc.heightOfString(title, { width: CONTENT_W - 16 });
        doc.font('Helvetica').fontSize(9.5);
        const bodyH = doc.heightOfString(body, { width: CONTENT_W - 16 });
        const h = titleH + bodyH + 12;
        ensure(h + 6);
        const y0 = doc.y;
        doc.rect(MARGIN, y0, 3.5, h).fill(color);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(title, MARGIN + 12, y0 + 2, { width: CONTENT_W - 16 });
        doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(body, MARGIN + 12, doc.y + 2, { width: CONTENT_W - 16, lineGap: 1.5 });
        doc.y = y0 + h + 8;
      };

      const chipRow = (items) => {
        const h = 20, padX = 10, gap = 7;
        ensure(h + 14);
        let x = MARGIN, y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9);
        items.forEach(it => {
          const w = doc.widthOfString(it) + padX * 2;
          if (x + w > PAGE_W - MARGIN) { x = MARGIN; y += h + gap; }
          if (y + h > PAGE_H - 66) { doc.addPage(); y = 84; x = MARGIN; }   // wrap to next page, never into the footer
          doc.roundedRect(x, y, w, h, 10).lineWidth(1).fillAndStroke(LIGHTBG, BORDER);
          doc.fillColor(BLUE).text(it, x + padX, y + 6, { lineBreak: false });
          x += w + gap;
        });
        doc.y = y + h + 12;
        doc.x = MARGIN;
      };

      // two side-by-side comparison cards {title, color, note, bullets[]}
      const compareTwoCards = (left, right) => {
        const gap = 14;
        const cardW = (CONTENT_W - gap) / 2;
        const innerW = cardW - 28;
        doc.font('Helvetica').fontSize(9);
        const heightOf = (c) => {
          let hh = 46; // header + note
          c.bullets.forEach(b => { hh += doc.heightOfString(b, { width: innerW - 12 }) + 6; });
          return hh + 16;
        };
        const h = Math.max(heightOf(left), heightOf(right));
        ensure(h + 8);
        const y0 = doc.y;
        [left, right].forEach((c, i) => {
          const x = MARGIN + i * (cardW + gap);
          doc.roundedRect(x, y0, cardW, h, 10).lineWidth(1).fillAndStroke('#fff', BORDER);
          doc.rect(x, y0, 4, h).fill(c.color);
          doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(c.title, x + 16, y0 + 14, { width: innerW });
          if (c.note) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(c.note, x + 16, y0 + 30, { width: innerW });
          let yy = y0 + (c.note ? 46 : 34);
          c.bullets.forEach(b => {
            doc.circle(x + 18, yy + 5, 1.8).fill(c.color);
            doc.font('Helvetica').fontSize(9).fillColor(TEXT).text(b, x + 26, yy, { width: innerW - 12, lineGap: 1 });
            yy = doc.y + 6;
          });
        });
        doc.y = y0 + h + 12;
      };

      // Good/Better/Best tier cards; highlight the tier whose amount matches recAmount
      const tierCards = (recAmount) => {
        const gap = 12;
        const cardW = (CONTENT_W - gap * 2) / 3;
        const innerW = cardW - 24;
        const h = 156;
        ensure(h + 8);
        const y0 = doc.y;
        PACKAGE_TIERS.forEach((t, i) => {
          const x = MARGIN + i * (cardW + gap);
          const rec = t.amount === recAmount;
          if (rec) {
            doc.roundedRect(x, y0, cardW, h, 10).fill('#F1FBF9');
            doc.roundedRect(x, y0, cardW, h, 10).lineWidth(2).strokeColor(TEAL).stroke();
          } else {
            doc.roundedRect(x, y0, cardW, h, 10).lineWidth(1).fillAndStroke('#fff', BORDER);
          }
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(rec ? TEAL : LABEL).text(t.key.toUpperCase(), x + 14, y0 + 12, { characterSpacing: 1 });
          doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(t.name, x + 14, y0 + 22);
          doc.font('Helvetica-Bold').fontSize(20).fillColor(NAVY).text(usd(t.amount), x + 14, y0 + 36, { continued: true })
            .font('Helvetica').fontSize(9).fillColor(MUTED).text(' /mo');
          doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(t.tagline, x + 14, y0 + 62, { width: innerW, lineGap: 0.5 });
          let yy = y0 + 96;
          t.includes.forEach(inc => {
            doc.circle(x + 16, yy + 4.5, 1.6).fill(rec ? TEAL : BLUE);
            doc.font('Helvetica').fontSize(7.8).fillColor(TEXT).text(inc, x + 23, yy, { width: innerW - 8, lineGap: 0.5 });
            yy = doc.y + 4;
          });
          if (rec) {
            doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff');
            const badge = 'RECOMMENDED';
            const bw = doc.widthOfString(badge) + 14;
            doc.roundedRect(x + cardW - bw - 10, y0 + 10, bw, 14, 7).fill(TEAL);
            doc.fillColor('#fff').text(badge, x + cardW - bw - 3, y0 + 14, { lineBreak: false });
          }
        });
        doc.y = y0 + h + 12;
      };

      // ---------- PAGE 1 ----------
      headerTall();
      doc.x = MARGIN; doc.y = 132;

      doc.font('Helvetica-Bold').fontSize(24).fillColor(NAVY).text(dealership, MARGIN, doc.y);
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`Prepared by Smart 1 Marketing  ·  ${dateStr || ''}`, MARGIN, doc.y + 2);
      doc.y += 14;

      specStrip([
        { label: 'Market', value: `${formData.city ? formData.city + ', ' : ''}${formData.state || ''} ${formData.zip || ''}`.trim() || (formData.zip || '—') },
        { label: 'Sales Radius', value: `${formData.sales_radius_miles || '—'} mi` },
        { label: 'Service Radius', value: `${formData.service_radius_miles || '—'} mi` },
        { label: 'Locations', value: formData.multiple_locations === 'Yes' ? 'Multiple' : 'Single' },
        { label: 'Recommended Plan', value: estimate.base_monthly_budget_text ? `${estimate.base_monthly_budget_text}/mo` : (estimate.recommended_package || '—') },
        { label: 'Annual Plan Total', value: estimate.suggested_budget_total_text || '—' }
      ]);

      sectionLabel('Your market at a glance');
      // region badge
      if (estimate.market_climate_region) {
        const bt = estimate.market_climate_region;
        doc.font('Helvetica-Bold').fontSize(9);
        const bw = doc.widthOfString(bt) + 24;
        doc.roundedRect(MARGIN, doc.y, bw, 22, 11).fill(NAVY);
        doc.fillColor('#fff').text(bt, MARGIN + 12, doc.y + 6, { lineBreak: false });
        doc.y += 32;
        doc.x = MARGIN;
      }
      statCards([
        { value: `${num(estimate.campground_count_low)}–${num(estimate.campground_count_high)}`, label: 'Campgrounds & RV Parks', sub: 'in your sales radius' },
        { value: `${num(estimate.estimated_site_count_low)}–${num(estimate.estimated_site_count_high)}`, label: 'Est. Camping Sites', sub: 'planning estimate' },
        { value: `${num(estimate.estimated_peak_season_reach_low)}–${num(estimate.estimated_peak_season_reach_high)}`, label: 'Peak-Season Camper Reach', sub: 'estimated' }
      ]);
      if (estimate.dealer_summary) para(estimate.dealer_summary, { color: MUTED, size: 10 });
      doc.y += 6;

      // ---------- WHAT THIS COULD BE WORTH (the money box) ----------
      sectionLabel('What this could be worth');

      const boxH = 150;
      ensure(boxH + 4);
      const by = doc.y;
      doc.roundedRect(MARGIN, by, CONTENT_W, boxH, 12).fill(HEADER);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#9fb0d0').text('WEATHER-TRIGGERED OPPORTUNITY', MARGIN + 20, by + 16, { characterSpacing: 1.2 });

      // three tiles
      const tW = (CONTENT_W - 40 - 24) / 3;
      const tiles = [
        { big: `${usd(s.budgetSaved)}/yr`, lbl: 'Slow-season spend avoided', sub: `flat ${usd(s.flatAnnual)} vs plan ${usd(s.planTotal)}` },
        { big: `${usd(s.concentration)}/yr`, lbl: 'Media moved to buying days', sub: '~30% of plan concentrated on high-demand days' },
        { big: '+17–34%', lbl: 'Published performance lift', sub: 'sales & traffic from weather-timed ads' }
      ];
      tiles.forEach((t, i) => {
        const x = MARGIN + 20 + i * (tW + 12);
        const yy = by + 40;
        doc.roundedRect(x, yy, tW, 74, 8).fill('#20386A');
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#9fb0d0').text(t.lbl.toUpperCase(), x + 10, yy + 10, { width: tW - 16, characterSpacing: 0.5 });
        doc.font('Helvetica-Bold').fontSize(16).fillColor(GOLD).text(t.big, x + 10, yy + 24, { width: tW - 16 });
        doc.font('Helvetica').fontSize(7.5).fillColor('#c4d2ec').text(t.sub, x + 10, yy + 48, { width: tW - 16, lineGap: 0.5 });
      });

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#fff')
        .text(`Weather timing can recapture roughly ${usd(round(s.recaptured, 100))} a year in spend that flat schedules waste — before a single new sale is counted.`,
          MARGIN + 20, by + 124, { width: CONTENT_W - 40 });
      doc.y = by + boxH + 10;

      doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
        .text(`Directional estimate. Compares an always-on flat schedule at your peak rate (${usd(s.B)}/mo) to the recommended weather-triggered plan. Lift percentages are from published weather-targeted case studies; individual results vary. Working range: ${usd(s.rangeLow)} – ${usd(s.rangeHigh)} per year.`,
          MARGIN, doc.y, { width: CONTENT_W, lineGap: 1 });
      doc.y += 8;

      // ---------- PAGE 2: budget efficiency ----------
      sectionLabel('How your budget works harder');
      compareBar('Annual media spend: flat schedule vs. weather-triggered',
        `Always-on flat at peak: ${usd(s.flatAnnual)}/yr`,
        `Weather-triggered plan: ${usd(s.planTotal)}/yr`,
        s.planTotal / s.flatAnnual, TEAL);
      const pctLess = Math.round((s.budgetSaved / s.flatAnnual) * 100);
      para(`That's ${pctLess}% less budget for the same peak-season presence — spend steps down automatically when demand is low, instead of running flat all year.`, { color: MUTED, size: 10 });
      doc.y += 4;

      callout(TEAL, 'SmartForecast rollover protection',
        'Unused media from slow-weather or off-season months is not lost — it rolls forward as credit, so every dollar eventually works on a high-demand day.');
      callout(GOLD, 'Spend concentrated where buyers are',
        'Flat schedules spend evenly across days with no buying intent. Weather-triggering shifts delivery to the warm weekends, storms, and freezes that actually move RV shoppers — the same media, far more of it in front of ready buyers.');
      callout(CYAN, 'One accountable plan',
        'Sales, trade-ins, financing, and the full service calendar run on one weather-triggered plan with a single view of spend and results — no fragmented vendors each reporting their own slice.');

      // ---------- SMARTER THAN TRADITIONAL ----------
      sectionLabel('Smarter than traditional advertising', 170);
      compareTwoCards(
        { title: 'Traditional advertising', color: RED, note: 'Radio · print · direct mail · billboards',
          bullets: [
            'Pays the same whether or not anyone is in-market',
            'Runs regardless of weather — spends on dead-demand days',
            'No targeting to RV buyers; no way to measure what worked',
            `One untargeted mail drop to ~${num(s.households)} area households — about ${usd(s.directMailOne)} for a single touch`
          ] },
        { title: 'Smart RV Demand', color: TEAL, note: 'Weather-triggered digital',
          bullets: [
            'Spends only when weather drives RV demand',
            'Targets in-market RV buyers + campground data',
            'Fully measurable; unused budget rolls forward',
            'Same budget works across the entire peak season'
          ] }
      );
      para(`Matching this plan's season-long, targeted presence with traditional media would typically run an estimated ${usd(s.tradAnnualLow)}–${usd(s.tradAnnualHigh)} per year — for untargeted reach you can't weather-time or measure. Weather-triggered digital delivers the same season for ${usd(s.planTotal)}.`,
        { color: MUTED, size: 9.5 });
      doc.y += 4;

      // ---------- RECOMMENDED PLAN ----------
      sectionLabel('Recommended plan', 120);
      doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text(estimate.recommended_package || '', MARGIN, doc.y);
      if (estimate.recommended_package_reason) para(estimate.recommended_package_reason, { color: MUTED, size: 10 });
      doc.y += 6;

      const subLabel = (t) => {
        ensure(40);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(LABEL).text(t, MARGIN, doc.y, { characterSpacing: 0.8 });
        doc.y += 4;
      };
      const channels = Array.isArray(estimate.recommended_channels) ? estimate.recommended_channels : [];
      if (channels.length) { subLabel('RECOMMENDED MEDIA CHANNELS'); chipRow(channels); }
      const triggers = Array.isArray(estimate.best_weather_triggers) ? estimate.best_weather_triggers : [];
      if (triggers.length) { subLabel('BEST WEATHER TRIGGERS FOR YOUR MARKET'); chipRow(triggers); }

      // ---------- GOOD / BETTER / BEST ----------
      sectionLabel('Good · better · best', 175);
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
        .text(`Based on your market size — an estimated peak-season reach of ${num(estimate.estimated_peak_season_reach_low)}–${num(estimate.estimated_peak_season_reach_high)} campers — we recommend the highlighted plan. You can move up or down after a strategy review.`,
          MARGIN, doc.y, { width: CONTENT_W, lineGap: 1.5 });
      doc.y += 10;
      tierCards(s.B);

      sectionLabel('Suggested media budget');
      statCards([
        { value: `${estimate.base_monthly_budget_text || '—'}`, label: 'At Peak Demand', sub: 'per month', color: NAVY },
        { value: `${estimate.average_monthly_budget_text || '—'}`, label: 'Blended Average', sub: 'per month', color: NAVY },
        { value: `${estimate.suggested_budget_total_text || '—'}`, label: `Plan Total`, sub: `over ${estimate.suggested_budget_months || s.months} months`, color: TEAL }
      ]);
      if (estimate.budget_note) para(estimate.budget_note, { color: MUTED, size: 9.5 });
      doc.y += 4;
      callout(GOLD, 'This is a suggested budget',
        'These figures are a directional starting point based on your market. On a quick consult we’ll tailor a plan and budget that fit your dealership’s goals, seasonality, and cash flow.');

      // ---------- MONTH-BY-MONTH ----------
      sectionLabel('Month-by-month campaign plan & budget');
      const plan = Array.isArray(estimate.month_by_month_plan) ? estimate.month_by_month_plan : [];
      // table header
      const drawPlanHeader = () => {
        ensure(24);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(LABEL);
        doc.text('MONTH', MARGIN, y, { width: 90, characterSpacing: 0.5 });
        doc.text('FOCUS & MESSAGE', MARGIN + 96, y, { width: CONTENT_W - 96 - 80, characterSpacing: 0.5 });
        doc.text('BUDGET', MARGIN + CONTENT_W - 80, y, { width: 80, align: 'right', characterSpacing: 0.5 });
        doc.moveTo(MARGIN, y + 13).lineTo(PAGE_W - MARGIN, y + 13).lineWidth(1.4).strokeColor(NAVY).stroke();
        doc.y = y + 20;
      };
      drawPlanHeader();
      plan.forEach(row => {
        const focus = String(row.campaign_focus || '');
        const msg = String(row.recommended_message || '');
        const trg = Array.isArray(row.weather_triggers) ? row.weather_triggers.join(', ') : '';
        doc.font('Helvetica').fontSize(9);
        const bodyH = doc.heightOfString(focus, { width: CONTENT_W - 96 - 80 })
          + doc.heightOfString(msg, { width: CONTENT_W - 96 - 80 })
          + (trg ? doc.heightOfString('Triggers: ' + trg, { width: CONTENT_W - 96 - 80 }) : 0) + 12;
        if (doc.y + bodyH > PAGE_H - 66) { doc.addPage(); drawPlanHeader(); }
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(row.month || '', MARGIN, y, { width: 90 });
        const seasonColor = row.season === 'Peak' ? TEAL : (row.season === 'Off-Season' ? MUTED : BLUE);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(seasonColor).text(String(row.season || '').toUpperCase(), MARGIN, y + 12, { width: 90, characterSpacing: 0.5 });
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT).text(focus, MARGIN + 96, y, { width: CONTENT_W - 96 - 80 });
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(msg, MARGIN + 96, doc.y, { width: CONTENT_W - 96 - 80 });
        if (trg) doc.font('Helvetica').fontSize(8).fillColor(BLUE).text('Triggers: ' + trg, MARGIN + 96, doc.y, { width: CONTENT_W - 96 - 80 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(row.suggested_budget_text || '', MARGIN + CONTENT_W - 80, y, { width: 80, align: 'right' });
        const rowBottom = Math.max(doc.y, y + 18) + 6;
        doc.moveTo(MARGIN, rowBottom).lineTo(PAGE_W - MARGIN, rowBottom).lineWidth(0.6).strokeColor(BORDER).stroke();
        doc.y = rowBottom + 6;
      });

      // ---------- FINAL CTA ----------
      ensure(96);
      doc.y += 6;
      const cy = doc.y;
      doc.roundedRect(MARGIN, cy, CONTENT_W, 84, 12).fill(HEADER);
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#fff').text('Ready to turn weather into traffic?', MARGIN + 20, cy + 16);
      doc.font('Helvetica').fontSize(10).fillColor('#c4d2ec')
        .text('A 15–30 minute strategy review shows exactly how these numbers apply to your market — and the plan to capture them.', MARGIN + 20, cy + 38, { width: CONTENT_W - 200 });
      // gold button (clickable link to the RV consult page)
      const bx = MARGIN + CONTENT_W - 168, bw = 148, bh = 34, byy = cy + 26;
      doc.roundedRect(bx, byy, bw, bh, 8).fill(GOLD);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#20160a').text('Schedule a review', bx, byy + 11, { width: bw, align: 'center' });
      doc.link(bx, byy, bw, bh, CONSULT_URL);
      // make the whole CTA box clickable too, and show the URL
      doc.link(MARGIN, cy, CONTENT_W, 84, CONSULT_URL);
      doc.font('Helvetica').fontSize(8.5).fillColor('#8fa3c9').text(CONSULT_URL, MARGIN + 20, cy + 62, { width: CONTENT_W - 200, link: CONSULT_URL, underline: false });
      doc.y = cy + 84 + 10;

      doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
        .text(estimate.estimate_disclaimer || 'This is a marketing planning estimate based on geography, market density, and standard campground capacity assumptions. It is not an audited count. Individual results will vary.',
          MARGIN, doc.y, { width: CONTENT_W });

      // ---------- footers on every page ----------
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0; // allow writing in the footer zone without triggering a page break
        const fy = PAGE_H - 46;
        doc.moveTo(MARGIN, fy - 6).lineTo(PAGE_W - MARGIN, fy - 6).lineWidth(0.8).strokeColor(BORDER).stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
          .text('Smart 1 Marketing · Directional assessment based on the information supplied. Benchmarks vary by market, competition, and geography.',
            MARGIN, fy, { width: CONTENT_W - 60 });
        doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
          .text(`${i + 1} / ${range.count}`, PAGE_W - MARGIN - 60, fy, { width: 60, align: 'right' });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Upload the PDF to the Smart 1 Suite / HighLevel media library and return its public URL.
// Returns null if credentials are missing; throws on an API error (caller decides whether to swallow).
export async function uploadPdfToGhlMedia(buffer, filename) {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!token) return null;

  const url = process.env.GHL_MEDIA_UPLOAD_URL || 'https://services.leadconnectorhq.com/medias/upload-file';
  const version = process.env.GHL_MEDIA_API_VERSION || '2021-07-28';

  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
  fd.append('name', filename);
  if (process.env.GHL_LOCATION_ID) fd.append('locationId', process.env.GHL_LOCATION_ID);
  if (process.env.GHL_MEDIA_HOSTED) fd.append('hosted', process.env.GHL_MEDIA_HOSTED);

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Version: version },
    body: fd
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GHL media upload failed: ${response.status} ${text}`);
  }

  let data = {};
  try { data = JSON.parse(text); } catch { data = {}; }
  return (
    data.url ||
    data.fileUrl ||
    data.link ||
    (data.data && (data.data.url || data.data.fileUrl || data.data.link)) ||
    null
  );
}
