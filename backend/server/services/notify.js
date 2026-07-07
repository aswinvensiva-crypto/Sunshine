/**
 * notify.js — sends booking confirmation via Email (Nodemailer/Gmail)
 * and WhatsApp (Twilio). Every attempt is logged to notification_logs.
 *
 * Standard check-in time: 11:00 AM
 * Early check-in surcharge: ₹150 per hour before 11:00 AM
 */
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { pool }   = require('../config/db');
const { sendWhatsApp, sendWhatsAppDocument } = require('./whatsapp');

const OWNER_PHONE = process.env.OWNER_PHONE || '9514771332';

/* ── helpers ─────────────────────────────────────────────────────── */
const rupee  = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

/* ── mailer (created lazily so missing credentials don't crash boot) */
let _transporter = null;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });
  }
  return _transporter;
}

/* ── log to DB ─────────────────────────────────────────────────────*/
async function log({ booking_ref, guest_name, email, phone, type, status, message, error }) {
  try {
    await pool.query(
      `INSERT INTO notification_logs
         (booking_ref, guest_name, email, phone, type, status, message, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [booking_ref, guest_name, email || null, phone || null,
       type, status, message || null, error || null]
    );
  } catch (dbErr) {
    console.error('[notify] DB log failed:', dbErr.message);
  }
}

/* ── email content ─────────────────────────────────────────────────*/
function buildEmailHtml({ guestName, reference, roomName, checkIn, checkOut, nights, total }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body{font-family:Georgia,serif;background:#f5f0eb;margin:0;padding:0;}
    .wrap{max-width:580px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);}
    .head{background:#1a3a4a;padding:36px 40px;text-align:center;}
    .head h1{color:#c9a96e;margin:0;font-size:26px;letter-spacing:.06em;}
    .head p{color:rgba(255,255,255,.7);font-size:12px;margin:6px 0 0;letter-spacing:.2em;text-transform:uppercase;}
    .body{padding:36px 40px;}
    .greeting{font-size:18px;color:#1a3a4a;margin-bottom:18px;}
    .ref{background:#f5f0eb;border-radius:6px;padding:14px 18px;font-size:13px;color:#666;margin-bottom:24px;}
    .ref b{color:#1a3a4a;font-size:16px;display:block;margin-bottom:4px;}
    .section{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e;font-weight:700;margin:24px 0 10px;}
    .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0ebe4;font-size:14px;color:#333;}
    .row:last-child{border-bottom:none;}
    .row b{color:#1a3a4a;}
    .total{background:#1a3a4a;border-radius:6px;padding:14px 18px;display:flex;justify-content:space-between;margin-top:18px;}
    .total span{color:rgba(255,255,255,.7);font-size:14px;}
    .total b{color:#c9a96e;font-size:18px;}
    .checkin-box{background:#fff8ed;border:1px solid #c9a96e;border-radius:6px;padding:16px 18px;margin-top:24px;}
    .checkin-box h3{margin:0 0 8px;font-size:14px;color:#1a3a4a;}
    .checkin-box p{margin:0;font-size:13px;color:#555;line-height:1.6;}
    .checkin-box .early{margin-top:10px;font-size:12px;color:#b4452f;font-style:italic;}
    .foot{text-align:center;padding:24px 40px;background:#f5f0eb;font-size:12px;color:#999;}
  </style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <h1>Sunshine</h1>
    <p>Pondicherry · Booking Confirmation</p>
  </div>
  <div class="body">
    <div class="greeting">Dear ${guestName},</div>
    <p style="color:#555;font-size:14px;line-height:1.7;">
      Your reservation at Sunshine is confirmed. We look forward to welcoming you to our coastal retreat.
    </p>

    <div class="ref">
      <b>${reference}</b>
      Booking Reference — keep this for check-in
    </div>

    <div class="section">Your Stay</div>
    <div class="row"><span>Room</span><b>${roomName}</b></div>
    <div class="row"><span>Check-in</span><b>${fmtDate(checkIn)}</b></div>
    <div class="row"><span>Check-out</span><b>${fmtDate(checkOut)}</b></div>
    <div class="row"><span>Nights</span><b>${nights}</b></div>

    <div class="total">
      <span>Total Amount</span>
      <b>${rupee(total)}</b>
    </div>

    <div class="checkin-box">
      <h3>⏰ Check-in Information</h3>
      <p>Standard check-in time is <strong>11:00 AM</strong>. Your room will be ready and waiting for you.</p>
      <p class="early">Early check-in (before 11:00 AM) is subject to availability and charged at <strong>₹150 per hour</strong>. Please contact us in advance to arrange early check-in.</p>
    </div>

    <p style="font-size:13px;color:#777;margin-top:24px;">
      For any queries or special requests, reply to this email or call us directly. We're here to make your stay perfect.
    </p>
  </div>
  <div class="foot">
    Sunshine · Pondicherry, Tamil Nadu · India<br/>
    This is an automated confirmation — no reply needed.
  </div>
</div>
</body>
</html>`;
}

/* ── PDF invoice builder ───────────────────────────────────────────*/
function buildInvoicePdf({ guestName, reference, roomName, checkIn, checkOut, nights, baseAmount, taxAmount, total, advancePaid, pendingAmount, paymentMethod, invoiceDate, type }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PAGE_W = 595;
      const PAGE_H = 842;
      const MARGIN = 40;
      const CONTENT_W = PAGE_W - MARGIN * 2;

      const TEAL     = '#4a7c7e';
      const DARK     = '#1a1a2e';
      const MUTED    = '#666666';
      const LIGHT_BG = '#f8f8f8';
      const BORDER   = '#dddddd';

      const isAdvance = type === 'advance';
      const methodLabel = (paymentMethod || 'cash').charAt(0).toUpperCase() + (paymentMethod || 'cash').slice(1);
      const isPaid = Number(pendingAmount) <= 0;
      const invoiceDateStr = invoiceDate || fmtDate(new Date());
      const dueDate = fmtDate(new Date(Date.now() + 30 * 86400000));

      // ── Top teal accent bar ─────────────────────────────────────────
      doc.rect(0, 0, PAGE_W, 6).fill(TEAL);

      // ── "Invoicing" title top-right ─────────────────────────────────
      doc.fillColor(DARK).fontSize(22).font('Helvetica-Bold')
         .text('Invoicing', MARGIN, 24, { width: CONTENT_W, align: 'right' });

      // ── Logo / company block top-left ───────────────────────────────
      let y = 50;
      doc.rect(MARGIN, y, 90, 32).fill(LIGHT_BG);
      doc.fillColor(TEAL).fontSize(13).font('Helvetica-Bold')
         .text('SUNSHINE', MARGIN + 4, y + 9, { width: 82, align: 'center' });

      y += 44;
      doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold')
         .text('Sunshine Pondicherry', MARGIN, y);
      y += 14;
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text('No. 12, Beach Road', MARGIN, y);
      y += 12;
      doc.text('Pondicherry, Tamil Nadu 605001', MARGIN, y);

      // ── Contact info right-aligned ──────────────────────────────────
      const contactY = 94;
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text('Phone #  +91 95147 71332', MARGIN, contactY, { width: CONTENT_W, align: 'right' });
      doc.text('Email  sunshine@pondicherry.in', MARGIN, contactY + 14, { width: CONTENT_W, align: 'right' });
      doc.text('Website  www.sunshinepondicherry.in', MARGIN, contactY + 28, { width: CONTENT_W, align: 'right' });

      // ── Divider ──────────────────────────────────────────────────────
      y = 160;
      doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 16;

      // ── Bill to / Details columns ────────────────────────────────────
      const col1x = MARGIN;
      const col2x = MARGIN + 160;
      const col3x = MARGIN + 320;

      doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold')
         .text('Bill to', col1x, y)
         .text('Ship to', col2x, y)
         .text('Details', col3x, y);
      y += 14;

      doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text(guestName, col1x, y);
      doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text(guestName, col2x, y);
      y += 13;
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text(roomName || '—', col1x, y)
         .text(roomName || '—', col2x, y);
      y += 12;
      doc.text('Pondicherry, Tamil Nadu', col1x, y).text('Pondicherry, Tamil Nadu', col2x, y);

      // Details column
      const detY = y - 25;
      doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold')
         .text(`Invoice # ${reference}`, col3x, detY);
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text(`Invoice date  ${invoiceDateStr}`, col3x, detY + 14);
      doc.text('Terms  Net 30', col3x, detY + 26);
      doc.text(`Due date  ${dueDate}`, col3x, detY + 38);

      // ── Line items table ─────────────────────────────────────────────
      y += 36;
      doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 8;

      // Table header
      doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold');
      doc.text('Product/ service', col1x, y);
      doc.text('Description', MARGIN + 130, y);
      doc.text('Quantity/ hrs', MARGIN + 300, y);
      doc.text('Rate', MARGIN + 380, y);
      doc.text('Amount', MARGIN + 440, y);
      y += 10;
      doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 10;

      const tableRow = (product, description, qty, rate, amount) => {
        doc.fillColor(DARK).fontSize(9).font('Helvetica')
           .text(product, col1x, y, { width: 120 })
           .text(description, MARGIN + 130, y, { width: 160 })
           .text(String(qty), MARGIN + 300, y, { width: 70, align: 'center' })
           .text(rate, MARGIN + 370, y, { width: 60, align: 'right' })
           .text(amount, MARGIN + 430, y, { width: 65, align: 'right' });
        y += 22;
        doc.moveTo(MARGIN, y - 4).lineTo(PAGE_W - MARGIN, y - 4).strokeColor('#eeeeee').lineWidth(0.3).stroke();
      };

      // Accommodation row
      tableRow(
        'Accommodation',
        `${roomName} · ${nights} night${nights !== 1 ? 's' : ''}`,
        nights,
        rupee(Math.round(baseAmount / nights)),
        rupee(baseAmount)
      );

      // GST / Tax row
      if (Number(taxAmount) > 0) {
        tableRow('GST / Tax', `Check-in: ${fmtDate(checkIn)}`, '', '', rupee(taxAmount));
      }

      // Advance rows
      if (isAdvance) {
        tableRow('Advance Paid', `Payment method: ${methodLabel}`, '', '', `- ${rupee(advancePaid)}`);
      } else {
        tableRow('Amount Paid', `Payment method: ${methodLabel}`, '', '', `- ${rupee(advancePaid)}`);
      }

      // Fill remaining blank rows to 5 total
      const rowsFilled = Number(taxAmount) > 0 ? 3 : 2;
      for (let i = rowsFilled; i < 5; i++) {
        tableRow('', '', 0, '$0.00', '$0.00');
      }

      y += 8;
      doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 16;

      // ── Customer message + totals ────────────────────────────────────
      const msgX = MARGIN;
      const totX = MARGIN + 310;
      const totW = CONTENT_W - 310;

      doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('Customer message', msgX, y);
      y += 12;
      doc.fillColor(DARK).fontSize(9).font('Helvetica')
         .text('Hello!', msgX, y);
      y += 12;
      doc.fillColor(MUTED).fontSize(8)
         .text('Thank you for your stay at Sunshine Pondicherry.\nPlease return this invoice with payment.', msgX, y, { width: 240 });
      y += 30;
      doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('Thanks!', msgX, y);

      // Totals on the right
      const totStartY = y - 54;
      const totRow = (label, value, bold) => {
        doc.fillColor(MUTED).fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, totX, totStartY + totRow._i * 18, { width: totW - 80 });
        doc.fillColor(bold ? DARK : MUTED).font(bold ? 'Helvetica-Bold' : 'Helvetica').text(value, totX, totStartY + totRow._i * 18, { width: totW, align: 'right' });
        totRow._i++;
      };
      totRow._i = 0;
      totRow('Subtotal', rupee(baseAmount));
      totRow('Sales tax', rupee(taxAmount));
      totRow('Shipping', rupee(0));

      // Total divider line
      const totalLineY = totStartY + totRow._i * 18 + 2;
      doc.moveTo(totX, totalLineY).lineTo(PAGE_W - MARGIN, totalLineY).strokeColor(DARK).lineWidth(0.8).stroke();

      const totalY = totalLineY + 8;
      doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
         .text('Total', totX, totalY)
         .text(rupee(total), totX, totalY, { width: totW, align: 'right' });

      // Payment status badge
      if (!isAdvance) {
        const badgeY = totalY + 28;
        const badgeFill = isPaid ? '#16a34a' : '#d97706';
        const badgeText = isPaid ? 'FULLY PAID' : `BALANCE DUE: ${rupee(pendingAmount)}`;
        doc.rect(totX, badgeY, totW, 20).fill(badgeFill);
        doc.fillColor('white').fontSize(8).font('Helvetica-Bold')
           .text(badgeText, totX, badgeY + 5, { width: totW, align: 'center' });
      } else {
        const badgeY = totalY + 28;
        doc.rect(totX, badgeY, totW, 20).fill('#0369a1');
        doc.fillColor('white').fontSize(8).font('Helvetica-Bold')
           .text(`ADVANCE PAID: ${rupee(advancePaid)}  |  BALANCE DUE: ${rupee(pendingAmount)}`, totX, badgeY + 5, { width: totW, align: 'center' });
      }

      // ── Bottom footer ────────────────────────────────────────────────
      const footY = PAGE_H - 40;
      doc.moveTo(MARGIN, footY).lineTo(PAGE_W - MARGIN, footY).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.fillColor(MUTED).fontSize(8).font('Helvetica')
         .text('Sunshine · Pondicherry, Tamil Nadu, India · This is a computer-generated document.', MARGIN, footY + 8, { width: CONTENT_W, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/* ── invoice email content ─────────────────────────────────────────*/
function buildInvoiceHtml({ guestName, reference, roomName, checkIn, checkOut, nights, baseAmount, taxAmount, total, advancePaid, pendingAmount, paymentMethod }) {
  const isPaid = pendingAmount <= 0;
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body{font-family:Georgia,serif;background:#f5f0eb;margin:0;padding:0;}
    .wrap{max-width:580px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);}
    .head{background:#1a3a4a;padding:36px 40px;text-align:center;}
    .head h1{color:#c9a96e;margin:0;font-size:26px;letter-spacing:.06em;}
    .head p{color:rgba(255,255,255,.7);font-size:12px;margin:6px 0 0;letter-spacing:.2em;text-transform:uppercase;}
    .body{padding:36px 40px;}
    .greeting{font-size:18px;color:#1a3a4a;margin-bottom:18px;}
    .ref{background:#f5f0eb;border-radius:6px;padding:14px 18px;font-size:13px;color:#666;margin-bottom:24px;}
    .ref b{color:#1a3a4a;font-size:16px;display:block;margin-bottom:4px;}
    .section{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e;font-weight:700;margin:24px 0 10px;}
    .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0ebe4;font-size:14px;color:#333;}
    .row:last-child{border-bottom:none;}
    .row b{color:#1a3a4a;}
    .total{background:#1a3a4a;border-radius:6px;padding:14px 18px;display:flex;justify-content:space-between;margin-top:18px;}
    .total span{color:rgba(255,255,255,.7);font-size:14px;}
    .total b{color:#c9a96e;font-size:18px;}
    .status-paid{background:#dcfce7;border:1px solid #16a34a;color:#15803d;border-radius:6px;padding:12px 18px;text-align:center;font-weight:700;font-size:14px;margin-top:18px;}
    .status-due{background:#fef9c3;border:1px solid #ca8a04;color:#92400e;border-radius:6px;padding:12px 18px;text-align:center;font-weight:700;font-size:14px;margin-top:18px;}
    .foot{text-align:center;padding:24px 40px;background:#f5f0eb;font-size:12px;color:#999;}
  </style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <h1>Sunshine</h1>
    <p>Pondicherry · Invoice</p>
  </div>
  <div class="body">
    <div class="greeting">Dear ${guestName},</div>
    <p style="color:#555;font-size:14px;line-height:1.7;">
      Please find your invoice for your stay at Sunshine Pondicherry. Thank you for choosing us.
    </p>

    <div class="ref">
      <b>${reference}</b>
      Invoice Reference
    </div>

    <div class="section">Stay Details</div>
    <div class="row"><span>Room</span><b>${roomName}</b></div>
    <div class="row"><span>Check-in</span><b>${fmtDate(checkIn)}</b></div>
    <div class="row"><span>Check-out</span><b>${fmtDate(checkOut)}</b></div>
    <div class="row"><span>Nights</span><b>${nights}</b></div>

    <div class="section">Charges</div>
    <div class="row"><span>Room Charges</span><b>${rupee(baseAmount)}</b></div>
    <div class="row"><span>GST / Tax</span><b>${rupee(taxAmount)}</b></div>
    <div class="row"><span>Advance Paid</span><b>− ${rupee(advancePaid)}</b></div>
    <div class="row"><span>Payment Method</span><b style="text-transform:capitalize">${paymentMethod}</b></div>

    <div class="total">
      <span>Total Amount</span>
      <b>${rupee(total)}</b>
    </div>

    ${isPaid
      ? `<div class="status-paid">✓ Payment Received — Fully Paid</div>`
      : `<div class="status-due">Balance Due: ${rupee(pendingAmount)}</div>`
    }
  </div>
  <div class="foot">
    Sunshine · Pondicherry, Tamil Nadu · India<br/>
    This invoice was issued by the property owner.
  </div>
</div>
</body>
</html>`;
}

/* ── send invoice email + WhatsApp PDF ─────────────────────────────*/
async function sendInvoiceEmail(booking) {
  const {
    reference, guest: guestName, email, phone,
    room: roomName, check_in, check_out, total_amount, nights,
    base_amount, tax_amount, advance_paid, pending_amount, payment_method,
  } = booking;

  const nightCount = nights || Math.round((new Date(check_out) - new Date(check_in)) / 86400000);
  const pdfData = {
    guestName, reference, roomName,
    checkIn: check_in, checkOut: check_out, nights: nightCount,
    baseAmount: base_amount, taxAmount: tax_amount, total: total_amount,
    advancePaid: advance_paid, pendingAmount: pending_amount,
    paymentMethod: payment_method || 'cash',
  };

  // Always generate PDF first so both channels can use it
  const pdfBuffer = await buildInvoicePdf(pdfData);
  const filename  = `Invoice-${reference}.pdf`;
  const waCaption = `*Sunshine* 🧾 Invoice — Ref: #${reference}\nRoom: ${roomName} | ${nightCount} nights\nTotal: ${rupee(total_amount)}\nAdvance paid: ${rupee(advance_paid)}${Number(pending_amount) > 0 ? `\nBalance due: ${rupee(pending_amount)}` : '\n✅ Fully Paid'}`;

  let emailOk = false;

  // Send email (with PDF attachment) if credentials are configured
  if (email && process.env.GMAIL_USER && process.env.GMAIL_PASS &&
      !process.env.GMAIL_USER.includes('your_gmail')) {
    const html = buildInvoiceHtml(pdfData);
    try {
      await getTransporter().sendMail({
        from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `Invoice: ${reference} — Sunshine Pondicherry`,
        html,
        attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
      });
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'invoice', status: 'sent', message: `Invoice sent to ${email}` });
      console.log(`[notify] Invoice sent → ${email}`);
      emailOk = true;
    } catch (err) {
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'invoice', status: 'failed', error: err.message });
      console.error('[notify] Invoice email failed:', err.message);
    }
  } else if (email) {
    await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'invoice', status: 'skipped', error: 'GMAIL credentials not configured' });
  }

  // Always send PDF via WhatsApp if phone exists (independent of email)
  if (phone) {
    const wa = await sendWhatsAppDocument(phone, pdfBuffer, filename, waCaption);
    await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'whatsapp', status: wa.ok ? 'sent' : 'failed', message: wa.ok ? `WhatsApp invoice PDF sent to ${phone}` : null, error: wa.ok ? null : wa.reason });
  }

  if (!emailOk && !phone) {
    throw new Error('No email address or phone number on file for this guest');
  }
}

/* ── send advance receipt at check-in ─────────────────────────────*/
async function sendAdvanceReceiptEmail(booking, { skipWa = false } = {}) {
  const {
    reference, guest: guestName, email, phone,
    room: roomName, check_in, check_out, total_amount, nights,
    base_amount, tax_amount, advance_paid, pending_amount, payment_method,
  } = booking;

  const nightCount = nights || Math.round((new Date(check_out) - new Date(check_in)) / 86400000);
  const pdfData = {
    guestName, reference, roomName,
    checkIn: check_in, checkOut: check_out, nights: nightCount,
    baseAmount: base_amount, taxAmount: tax_amount, total: total_amount,
    advancePaid: advance_paid, pendingAmount: pending_amount,
    paymentMethod: payment_method || 'cash',
    type: 'advance',
  };

  // Always generate PDF first
  const pdfBuffer = await buildInvoicePdf(pdfData);
  const filename  = `AdvanceReceipt-${reference}.pdf`;
  const waCaption = `*Sunshine* 🏨 Welcome, ${guestName}!\nAdvance receipt — Ref: #${reference}\nRoom: ${roomName} | ${nightCount} nights\nAdvance paid: ${rupee(advance_paid)}${Number(pending_amount) > 0 ? `\nBalance due at checkout: ${rupee(pending_amount)}` : '\n✅ Fully Paid'}\nCheck-in: ${fmtDate(check_in)} → Check-out: ${fmtDate(check_out)}`;

  // Send email if configured
  if (email && process.env.GMAIL_USER && process.env.GMAIL_PASS &&
      !process.env.GMAIL_USER.includes('your_gmail')) {
    const isPaid = Number(pending_amount) <= 0;
    const advanceHtml = buildInvoiceHtml(pdfData)
      .replace('Please find your invoice for your stay', 'Please find your advance payment receipt for your upcoming stay')
      .replace('Invoice Reference', 'Advance Receipt Reference')
      .replace('Advance Paid', 'Advance Received')
      .replace(
        isPaid ? 'Payment Received — Fully Paid' : `Balance Due: ${rupee(pending_amount)}`,
        isPaid ? '✓ Fully Paid' : `Balance of ${rupee(pending_amount)} payable at checkout`
      );
    try {
      await getTransporter().sendMail({
        from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `Advance Payment Receipt: ${reference} — Sunshine Pondicherry`,
        html: advanceHtml,
        attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
      });
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'advance_receipt', status: 'sent', message: `Advance receipt sent to ${email}` });
      console.log(`[notify] Advance receipt sent → ${email}`);
    } catch (err) {
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'advance_receipt', status: 'failed', error: err.message });
      console.error('[notify] Advance receipt email failed:', err.message);
    }
  } else {
    await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'advance_receipt', status: 'skipped', error: email ? 'GMAIL not configured' : 'No guest email' });
  }

  // Send PDF via WhatsApp unless caller already sent it (e.g. sendBookingNotifications)
  if (phone && !skipWa) {
    const wa = await sendWhatsAppDocument(phone, pdfBuffer, filename, waCaption);
    await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'whatsapp', status: wa.ok ? 'sent' : 'failed', message: wa.ok ? `WhatsApp advance receipt PDF to ${phone}` : null, error: wa.ok ? null : wa.reason });
  }
}

/* ── resolve owner email ───────────────────────────────────────────*/
async function resolveOwnerEmail() {
  if (process.env.OWNER_EMAIL) return process.env.OWNER_EMAIL;
  try {
    const { rows } = await pool.query(`SELECT email FROM users WHERE role = 'owner' LIMIT 1`);
    return rows[0]?.email || null;
  } catch {
    return null;
  }
}

/* ── balance payment alert ─────────────────────────────────────────*/
async function sendBalancePaymentAlert({ bookingRef, guestName, amountCollected, paymentMethod, newPaymentStatus, pendingAmount, collectedBy, guestPhone }) {
  const ownerEmail = await resolveOwnerEmail();
  if (!ownerEmail || !process.env.GMAIL_USER || !process.env.GMAIL_PASS ||
      process.env.GMAIL_USER.includes('your_gmail')) {
    await log({ booking_ref: bookingRef, guest_name: guestName, email: ownerEmail, type: 'balance_payment', status: 'skipped', error: 'Owner email or GMAIL not configured' });
    return;
  }
  const statusLabel = newPaymentStatus === 'paid' ? '✅ Fully Paid' : `⚠️ Partial — ${rupee(pendingAmount)} still pending`;
  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{font-family:Georgia,serif;background:#f5f0eb;margin:0;padding:0;}
  .wrap{max-width:540px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);}
  .head{background:#1a3a4a;padding:28px 36px;text-align:center;}
  .head h1{color:#c9a96e;margin:0;font-size:22px;letter-spacing:.06em;}
  .head p{color:rgba(255,255,255,.7);font-size:11px;margin:4px 0 0;letter-spacing:.18em;text-transform:uppercase;}
  .body{padding:28px 36px;}
  .section{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e;font-weight:700;margin:20px 0 8px;}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ebe4;font-size:14px;color:#333;}
  .row:last-child{border-bottom:none;}
  .row b{color:#1a3a4a;}
  .amount-box{background:#dcfce7;border:1px solid #16a34a;color:#14532d;border-radius:6px;padding:14px 18px;text-align:center;font-size:22px;font-weight:700;margin:20px 0;}
  .foot{text-align:center;padding:18px 36px;background:#f5f0eb;font-size:11px;color:#999;}
</style></head><body>
<div class="wrap">
  <div class="head"><h1>💰 Balance Payment Received</h1><p>Sunshine · Pondicherry</p></div>
  <div class="body">
    <div class="amount-box">${rupee(amountCollected)} collected</div>
    <div class="section">Booking Details</div>
    <div class="row"><span>Booking Ref</span><b>${bookingRef}</b></div>
    <div class="row"><span>Guest</span><b>${guestName}</b></div>
    <div class="row"><span>Collected By</span><b>${collectedBy}</b></div>
    <div class="row"><span>Payment Method</span><b style="text-transform:capitalize">${paymentMethod || 'cash'}</b></div>
    <div class="section">Payment Status</div>
    <div class="row"><span>New Status</span><b>${statusLabel}</b></div>
    ${pendingAmount > 0 ? `<div class="row"><span>Remaining Balance</span><b style="color:#b45309">${rupee(pendingAmount)}</b></div>` : ''}
  </div>
  <div class="foot">Sunshine · Pondicherry, Tamil Nadu · India</div>
</div></body></html>`;
  try {
    await getTransporter().sendMail({
      from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
      to: ownerEmail,
      subject: `💰 Balance Payment Received – ${bookingRef}`,
      html,
    });
    await log({ booking_ref: bookingRef, guest_name: guestName, email: ownerEmail, type: 'balance_payment', status: 'sent', message: `Alert sent to ${ownerEmail}` });
    console.log(`[notify] Balance payment alert → ${ownerEmail}`);

    /* WhatsApp to owner */
    const waMsg = `💰 *Payment Received* — #${bookingRef}\nGuest: ${guestName}\nAmount: ${rupee(amountCollected)} (${paymentMethod || 'cash'})\nCollected by: ${collectedBy}\n${Number(pendingAmount) > 0 ? `Balance still due: ${rupee(pendingAmount)}` : '✅ Fully Paid'}`;
    const wa = await sendWhatsApp(OWNER_PHONE, waMsg);
    await log({ booking_ref: bookingRef, guest_name: guestName, phone: OWNER_PHONE, type: 'whatsapp', status: wa.ok ? 'sent' : 'failed', message: wa.ok ? `WhatsApp payment alert to owner` : null, error: wa.ok ? null : wa.reason });

    /* WhatsApp receipt to guest */
    if (guestPhone) {
      const guestMsg = `*Sunshine* 🏨 Payment Confirmed!\nBooking Ref: #${bookingRef}\nAmount Paid: ${rupee(amountCollected)} (${paymentMethod || 'cash'})\n✅ Your balance has been cleared. Thank you!`;
      const waGuest = await sendWhatsApp(guestPhone, guestMsg);
      await log({ booking_ref: bookingRef, guest_name: guestName, phone: guestPhone, type: 'whatsapp', status: waGuest.ok ? 'sent' : 'failed', message: waGuest.ok ? `WhatsApp balance receipt to guest` : null, error: waGuest.ok ? null : waGuest.reason });
    }
  } catch (err) {
    await log({ booking_ref: bookingRef, guest_name: guestName, email: ownerEmail, type: 'balance_payment', status: 'failed', error: err.message });
    console.error('[notify] Balance payment alert failed:', err.message);
  }
}

/* ── cancellation alert ────────────────────────────────────────────*/
async function sendCancellationAlert({ bookingRef, guestName, roomTypeName, checkIn, checkOut, nights, cancelledBy, cancelledAt }) {
  const ownerEmail = await resolveOwnerEmail();
  if (!ownerEmail || !process.env.GMAIL_USER || !process.env.GMAIL_PASS ||
      process.env.GMAIL_USER.includes('your_gmail')) {
    await log({ booking_ref: bookingRef, guest_name: guestName, email: ownerEmail, type: 'cancellation', status: 'skipped', error: 'Owner email or GMAIL not configured' });
    return;
  }
  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{font-family:Georgia,serif;background:#f5f0eb;margin:0;padding:0;}
  .wrap{max-width:540px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);}
  .head{background:#7f1d1d;padding:28px 36px;text-align:center;}
  .head h1{color:#fca5a5;margin:0;font-size:22px;letter-spacing:.06em;}
  .head p{color:rgba(255,255,255,.7);font-size:11px;margin:4px 0 0;letter-spacing:.18em;text-transform:uppercase;}
  .body{padding:28px 36px;}
  .section{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e;font-weight:700;margin:20px 0 8px;}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ebe4;font-size:14px;color:#333;}
  .row:last-child{border-bottom:none;}
  .row b{color:#1a3a4a;}
  .available-box{background:#dcfce7;border:1px solid #16a34a;color:#14532d;border-radius:6px;padding:14px 18px;text-align:center;font-weight:700;font-size:15px;margin:20px 0;}
  .foot{text-align:center;padding:18px 36px;background:#f5f0eb;font-size:11px;color:#999;}
</style></head><body>
<div class="wrap">
  <div class="head"><h1>🚨 Booking Cancelled</h1><p>Sunshine · Pondicherry</p></div>
  <div class="body">
    <div class="available-box">📅 ${fmtDate(checkIn)} → ${fmtDate(checkOut)} now available for re-listing</div>
    <div class="section">Cancelled Booking</div>
    <div class="row"><span>Booking Ref</span><b>${bookingRef}</b></div>
    <div class="row"><span>Guest</span><b>${guestName}</b></div>
    <div class="row"><span>Room Type</span><b>${roomTypeName}</b></div>
    <div class="row"><span>Check-in</span><b>${fmtDate(checkIn)}</b></div>
    <div class="row"><span>Check-out</span><b>${fmtDate(checkOut)}</b></div>
    <div class="row"><span>Nights Freed</span><b>${nights}</b></div>
    <div class="section">Cancellation</div>
    <div class="row"><span>Cancelled By</span><b>${cancelledBy}</b></div>
    <div class="row"><span>Cancelled At</span><b>${new Date(cancelledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</b></div>
  </div>
  <div class="foot">Sunshine · Pondicherry, Tamil Nadu · India</div>
</div></body></html>`;
  try {
    await getTransporter().sendMail({
      from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
      to: ownerEmail,
      subject: `🚨 Booking Cancelled – ${bookingRef} | ${fmtDate(checkIn)} → ${fmtDate(checkOut)} Now Available`,
      html,
    });
    await log({ booking_ref: bookingRef, guest_name: guestName, email: ownerEmail, type: 'cancellation', status: 'sent', message: `Cancellation alert sent to ${ownerEmail}` });
    console.log(`[notify] Cancellation alert → ${ownerEmail}`);

    /* WhatsApp to owner */
    const waMsg = `🚨 *Booking Cancelled* — #${bookingRef}\nGuest: ${guestName}\nRoom: ${roomTypeName}\n${fmtDate(checkIn)} → ${fmtDate(checkOut)} (${nights} nights)\nCancelled by: ${cancelledBy}`;
    const wa = await sendWhatsApp(OWNER_PHONE, waMsg);
    await log({ booking_ref: bookingRef, guest_name: guestName, phone: OWNER_PHONE, type: 'whatsapp', status: wa.ok ? 'sent' : 'failed', message: wa.ok ? `WhatsApp cancellation alert to owner` : null, error: wa.ok ? null : wa.reason });
  } catch (err) {
    await log({ booking_ref: bookingRef, guest_name: guestName, email: ownerEmail, type: 'cancellation', status: 'failed', error: err.message });
    console.error('[notify] Cancellation alert failed:', err.message);
  }
}

/* ── main exported function ────────────────────────────────────────*/
async function sendBookingNotifications(booking) {
  const {
    reference, guest: guestName, email, phone,
    room: roomName, check_in, check_out, total_amount, nights,
    base_amount, tax_amount, advance_paid, pending_amount, payment_method,
  } = booking;

  const nightCount = nights ||
    Math.round((new Date(check_out) - new Date(check_in)) / 86400000);

  /* ── 1. Email ─────────────────────────────────────────────────── */
  if (email && process.env.GMAIL_USER && process.env.GMAIL_PASS &&
      !process.env.GMAIL_USER.includes('your_gmail')) {
    const html = buildEmailHtml({
      guestName, reference, roomName,
      checkIn: check_in, checkOut: check_out,
      nights: nightCount, total: total_amount,
    });
    try {
      await getTransporter().sendMail({
        from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `Booking Confirmed: ${reference} — Sunshine Pondicherry`,
        html,
      });
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'email', status: 'sent', message: `Confirmation sent to ${email}` });
      console.log(`[notify] Email sent → ${email}`);
    } catch (err) {
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'email', status: 'failed', error: err.message });
      console.error('[notify] Email failed:', err.message);
    }
  } else {
    if (email) {
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'email', status: 'skipped', error: 'GMAIL credentials not configured in .env' });
    }
  }

  /* ── 2. Build invoice PDF (used for both guest and owner) ─────────── */
  let pdfBuffer = null;
  const pdfFilename = `AdvanceReceipt-${reference}.pdf`;
  const ownerMsg = `📋 *New Booking* — #${reference}\nGuest: ${guestName}\nRoom: ${roomName} | ${nightCount} nights\n${fmtDate(check_in)} → ${fmtDate(check_out)}\nTotal: ${rupee(total_amount)}${Number(advance_paid) > 0 ? `\nAdvance: ${rupee(advance_paid)}` : ''}${Number(pending_amount) > 0 ? `\nBalance due: ${rupee(pending_amount)}` : '\n✅ Fully Paid'}`;

  try {
    pdfBuffer = await buildInvoicePdf({
      guestName, reference, roomName,
      checkIn: check_in, checkOut: check_out, nights: nightCount,
      baseAmount: base_amount, taxAmount: tax_amount, total: total_amount,
      advancePaid: advance_paid, pendingAmount: pending_amount,
      paymentMethod: payment_method || 'cash',
      type: 'advance',
    });
  } catch (pdfErr) {
    console.error('[notify] Invoice PDF build failed:', pdfErr.message);
  }

  /* ── 3. WhatsApp — guest (confirmation text + invoice PDF) ─────── */
  const waMsg = `*Sunshine Resort* ✅\nBooking confirmed: #${reference}\nRoom: ${roomName} | ${nightCount} night${nightCount !== 1 ? 's' : ''}\nCheck-in: ${fmtDate(check_in)} → Check-out: ${fmtDate(check_out)}\nTotal: ${rupee(total_amount)}`;
  if (phone) {
    const waGuest = await sendWhatsApp(phone, waMsg);
    await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'whatsapp', status: waGuest.ok ? 'sent' : 'failed', message: waGuest.ok ? `WhatsApp confirmation sent to guest ${phone}` : null, error: waGuest.ok ? null : waGuest.reason });

    if (pdfBuffer) {
      const guestCaption = `*Sunshine* 🏨 Welcome, ${guestName}!\nAdvance receipt — Ref: #${reference}\nRoom: ${roomName} | ${nightCount} nights\nAdvance paid: ${rupee(advance_paid)}${Number(pending_amount) > 0 ? `\nBalance due at checkout: ${rupee(pending_amount)}` : '\n✅ Fully Paid'}\nCheck-in: ${fmtDate(check_in)} → Check-out: ${fmtDate(check_out)}`;
      const waPdf = await sendWhatsAppDocument(phone, pdfBuffer, pdfFilename, guestCaption);
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'whatsapp', status: waPdf.ok ? 'sent' : 'failed', message: waPdf.ok ? `WhatsApp invoice PDF sent to guest ${phone}` : null, error: waPdf.ok ? null : waPdf.reason });
    }
  }

  /* ── 4. WhatsApp — owner (alert text + invoice PDF) ────────────── */
  const waOwner = await sendWhatsApp(OWNER_PHONE, ownerMsg);
  await log({ booking_ref: reference, guest_name: guestName, phone: OWNER_PHONE, type: 'whatsapp', status: waOwner.ok ? 'sent' : 'failed', message: waOwner.ok ? `WhatsApp new booking alert sent to owner` : null, error: waOwner.ok ? null : waOwner.reason });

  if (pdfBuffer) {
    const ownerCaption = `📋 *Booking Receipt* — #${reference}\nGuest: ${guestName} | Room: ${roomName}\n${nightCount} nights · ${fmtDate(check_in)} → ${fmtDate(check_out)}\nTotal: ${rupee(total_amount)} | Advance: ${rupee(advance_paid)}${Number(pending_amount) > 0 ? `\nBalance due: ${rupee(pending_amount)}` : '\n✅ Fully Paid'}`;
    const waOwnerPdf = await sendWhatsAppDocument(OWNER_PHONE, pdfBuffer, pdfFilename, ownerCaption);
    await log({ booking_ref: reference, guest_name: guestName, phone: OWNER_PHONE, type: 'whatsapp', status: waOwnerPdf.ok ? 'sent' : 'failed', message: waOwnerPdf.ok ? `WhatsApp invoice PDF sent to owner` : null, error: waOwnerPdf.ok ? null : waOwnerPdf.reason });
  }
}

/* ── overbooking alert ─────────────────────────────────────────────*/
async function sendOverbookingAlert({ roomTypeId, checkIn, checkOut, triggeredBy }) {
  let roomTypeName = `Room Type #${roomTypeId}`;
  try {
    const r = await pool.query('SELECT name FROM room_types WHERE id=$1', [roomTypeId]);
    if (r.rows[0]) roomTypeName = r.rows[0].name;
  } catch (_) {}

  const msg = `Overbooking attempt: ${roomTypeName} ${fmtDate(checkIn)}→${fmtDate(checkOut)} by ${triggeredBy}`;

  const ownerEmail = await resolveOwnerEmail();
  if (!ownerEmail || !process.env.GMAIL_USER || !process.env.GMAIL_PASS ||
      process.env.GMAIL_USER.includes('your_gmail')) {
    await log({ booking_ref: null, guest_name: triggeredBy, email: ownerEmail, type: 'overbooking_attempt', status: 'skipped', message: msg, error: 'Owner email or GMAIL not configured' });
    return;
  }

  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{font-family:Georgia,serif;background:#f5f0eb;margin:0;padding:0;}
  .wrap{max-width:540px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);}
  .head{background:#78350f;padding:28px 36px;text-align:center;}
  .head h1{color:#fde68a;margin:0;font-size:22px;letter-spacing:.06em;}
  .head p{color:rgba(255,255,255,.7);font-size:11px;margin:4px 0 0;letter-spacing:.18em;text-transform:uppercase;}
  .body{padding:28px 36px;}
  .section{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e;font-weight:700;margin:20px 0 8px;}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ebe4;font-size:14px;color:#333;}
  .row:last-child{border-bottom:none;}
  .row b{color:#1a3a4a;}
  .warn-box{background:#fef3c7;border:1px solid #d97706;color:#92400e;border-radius:6px;padding:14px 18px;font-weight:700;font-size:15px;margin:16px 0;text-align:center;}
  .foot{text-align:center;padding:18px 36px;background:#f5f0eb;font-size:11px;color:#999;}
</style></head><body>
<div class="wrap">
  <div class="head"><h1>⚠️ Overbooking Attempt Blocked</h1><p>Sunshine · Pondicherry</p></div>
  <div class="body">
    <div class="warn-box">A booking was attempted for sold-out dates and was automatically blocked.</div>
    <div class="section">Attempt Details</div>
    <div class="row"><span>Room Type</span><b>${roomTypeName}</b></div>
    <div class="row"><span>Check-in</span><b>${fmtDate(checkIn)}</b></div>
    <div class="row"><span>Check-out</span><b>${fmtDate(checkOut)}</b></div>
    <div class="row"><span>Triggered By</span><b>${triggeredBy}</b></div>
    <div class="row"><span>Time</span><b>${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</b></div>
    <p style="font-size:13px;color:#777;margin-top:16px;">No booking was created. Please review inventory and notify the guest of alternative dates.</p>
  </div>
  <div class="foot">Sunshine · Pondicherry, Tamil Nadu · India</div>
</div></body></html>`;

  try {
    await getTransporter().sendMail({
      from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
      to: ownerEmail,
      subject: `⚠️ Overbooking Attempt Blocked – ${roomTypeName} | ${fmtDate(checkIn)}`,
      html,
    });
    await log({ booking_ref: null, guest_name: triggeredBy, email: ownerEmail, type: 'overbooking_attempt', status: 'sent', message: msg });
    console.log(`[notify] Overbooking alert → ${ownerEmail}`);
  } catch (err) {
    await log({ booking_ref: null, guest_name: triggeredBy, email: ownerEmail, type: 'overbooking_attempt', status: 'failed', message: msg, error: err.message });
    console.error('[notify] Overbooking alert failed:', err.message);
  }
}

/* ── special request status update to guest ────────────────────────*/
async function sendSpecialRequestUpdate({ guestEmail, guestName, guestPhone, bookingRef, requestType, requestedTime, status, totalFee }) {
  const typeLabel = requestType === 'early_checkin' ? 'Early Check-In' : 'Late Check-Out';
  const statusLabel = status === 'approved' ? '✅ Approved' : status === 'denied' ? '❌ Denied' : '✓ Waived';
  const logType = `special_request_${status}`;

  if (guestEmail && process.env.GMAIL_USER && process.env.GMAIL_PASS &&
      !process.env.GMAIL_USER.includes('your_gmail')) {
    const feeText = status === 'approved' && Number(totalFee) > 0 ? `<div class="row"><span>Fee Added</span><b style="color:#b45309">${rupee(totalFee)}</b></div>` : '';
    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{font-family:Georgia,serif;background:#f5f0eb;margin:0;padding:0;}
  .wrap{max-width:540px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);}
  .head{background:#1a3a4a;padding:28px 36px;text-align:center;}
  .head h1{color:#c9a96e;margin:0;font-size:22px;letter-spacing:.06em;}
  .head p{color:rgba(255,255,255,.7);font-size:11px;margin:4px 0 0;letter-spacing:.18em;text-transform:uppercase;}
  .body{padding:28px 36px;}
  .section{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#c9a96e;font-weight:700;margin:20px 0 8px;}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ebe4;font-size:14px;color:#333;}
  .row:last-child{border-bottom:none;}
  .row b{color:#1a3a4a;}
  .status-box{border-radius:6px;padding:14px 18px;text-align:center;font-weight:700;font-size:16px;margin:16px 0;}
  .approved{background:#dcfce7;border:1px solid #16a34a;color:#14532d;}
  .denied{background:#fee2e2;border:1px solid #dc2626;color:#7f1d1d;}
  .waived{background:#f3f4f6;border:1px solid #9ca3af;color:#374151;}
  .foot{text-align:center;padding:18px 36px;background:#f5f0eb;font-size:11px;color:#999;}
</style></head><body>
<div class="wrap">
  <div class="head"><h1>Special Request Update</h1><p>Sunshine · Pondicherry</p></div>
  <div class="body">
    <p style="color:#555;font-size:14px;line-height:1.7;">Dear ${guestName}, your special request has been reviewed.</p>
    <div class="status-box ${status}">${statusLabel} — ${typeLabel}</div>
    <div class="section">Request Details</div>
    <div class="row"><span>Booking Ref</span><b>${bookingRef}</b></div>
    <div class="row"><span>Request Type</span><b>${typeLabel}</b></div>
    <div class="row"><span>Requested Time</span><b>${requestedTime}</b></div>
    ${feeText}
    ${status === 'approved' && Number(totalFee) > 0 ? `<p style="font-size:13px;color:#92400e;margin-top:12px;">The applicable fee of ${rupee(totalFee)} has been added to your booking balance.</p>` : ''}
    ${status === 'denied' ? `<p style="font-size:13px;color:#777;margin-top:12px;">Unfortunately we are unable to accommodate this request. Please contact us if you have any questions.</p>` : ''}
  </div>
  <div class="foot">Sunshine · Pondicherry, Tamil Nadu · India</div>
</div></body></html>`;
    try {
      await getTransporter().sendMail({
        from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
        to: guestEmail,
        subject: `Special Request ${status === 'approved' ? 'Approved' : status === 'denied' ? 'Update' : 'Waived'} – ${bookingRef}`,
        html,
      });
      await log({ booking_ref: bookingRef, guest_name: guestName, email: guestEmail, phone: guestPhone, type: logType, status: 'sent', message: `${typeLabel} request ${status}` });

      /* WhatsApp to guest */
      if (guestPhone) {
        const emoji = status === 'approved' ? '✅' : status === 'denied' ? '❌' : '✓';
        const feeNote = status === 'approved' && Number(totalFee) > 0 ? `\nFee added: ${rupee(totalFee)}` : '';
        const waMsg = `${emoji} *${typeLabel} ${statusLabel}*\nRef: #${bookingRef}${feeNote}\nFor queries, contact Sunshine directly.`;
        const wa = await sendWhatsApp(guestPhone, waMsg);
        await log({ booking_ref: bookingRef, guest_name: guestName, phone: guestPhone, type: 'whatsapp', status: wa.ok ? 'sent' : 'failed', message: wa.ok ? `WhatsApp special request update to guest` : null, error: wa.ok ? null : wa.reason });
      }
    } catch (err) {
      await log({ booking_ref: bookingRef, guest_name: guestName, email: guestEmail, phone: guestPhone, type: logType, status: 'failed', error: err.message });
    }
  } else {
    await log({ booking_ref: bookingRef, guest_name: guestName, email: guestEmail, phone: guestPhone, type: logType, status: 'skipped', error: guestEmail ? 'GMAIL not configured' : 'No guest email' });

    /* WhatsApp to guest even if email not configured */
    if (guestPhone) {
      const emoji = status === 'approved' ? '✅' : status === 'denied' ? '❌' : '✓';
      const feeNote = status === 'approved' && Number(totalFee) > 0 ? `\nFee added: ${rupee(totalFee)}` : '';
      const waMsg = `${emoji} *${typeLabel} ${statusLabel}*\nRef: #${bookingRef}${feeNote}\nFor queries, contact Sunshine directly.`;
      const wa = await sendWhatsApp(guestPhone, waMsg);
      await log({ booking_ref: bookingRef, guest_name: guestName, phone: guestPhone, type: 'whatsapp', status: wa.ok ? 'sent' : 'failed', message: wa.ok ? `WhatsApp special request update to guest` : null, error: wa.ok ? null : wa.reason });
    }
  }
}

/* ── checkout receipt ──────────────────────────────────────────────*/
async function sendCheckoutReceipt(booking) {
  const {
    reference, guest: guestName, email, phone,
    room: roomName, check_in, check_out, total_amount, nights,
    base_amount, tax_amount, advance_paid, pending_amount, payment_method,
  } = booking;

  const nightCount = nights || Math.round((new Date(check_out) - new Date(check_in)) / 86400000);
  const checkedOutAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const pdfData = {
    guestName, reference, roomName,
    checkIn: check_in, checkOut: check_out, nights: nightCount,
    baseAmount: base_amount, taxAmount: tax_amount, total: total_amount,
    advancePaid: advance_paid, pendingAmount: pending_amount,
    paymentMethod: payment_method || 'cash',
  };

  // Always generate PDF first
  const pdfBuffer  = await buildInvoicePdf(pdfData);
  const filename   = `Receipt-${reference}.pdf`;
  const waCaption  = `*Sunshine* 🙏 Thank you, ${guestName}!\nCheckout complete — Ref: #${reference}\nRoom: ${roomName} | ${nightCount} nights\nTotal paid: ${rupee(total_amount)}\nHope to see you again!`;

  // Send email if configured
  if (email && process.env.GMAIL_USER && process.env.GMAIL_PASS &&
      !process.env.GMAIL_USER.includes('your_gmail')) {
    const html = buildInvoiceHtml(pdfData).replace(
      '<div class="greeting">',
      `<div style="background:#f0f9ff;border:1px solid #0ea5e9;border-radius:6px;padding:14px 18px;margin-bottom:20px;font-size:14px;color:#0c4a6e;">
         Thank you for staying with us at Sunshine! We hope you had a wonderful coastal retreat.<br/>
         <span style="font-size:12px;color:#64748b;">Checked out: ${checkedOutAt}</span>
       </div>
       <div class="greeting">`
    );
    try {
      await getTransporter().sendMail({
        from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `Receipt for your stay at Sunshine — Ref ${reference}`,
        html,
        attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
      });
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'checkout_receipt', status: 'sent', message: `Checkout receipt sent to ${email}` });
      console.log(`[notify] Checkout receipt → ${email}`);
    } catch (err) {
      await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'checkout_receipt', status: 'failed', error: err.message });
      console.error('[notify] Checkout receipt email failed:', err.message);
    }
  } else {
    await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'checkout_receipt', status: 'skipped', error: email ? 'GMAIL not configured' : 'No guest email' });
  }

  // Always send PDF via WhatsApp if phone exists
  if (phone) {
    const wa = await sendWhatsAppDocument(phone, pdfBuffer, filename, waCaption);
    await log({ booking_ref: reference, guest_name: guestName, email, phone, type: 'whatsapp', status: wa.ok ? 'sent' : 'failed', message: wa.ok ? `WhatsApp checkout receipt PDF to ${phone}` : null, error: wa.ok ? null : wa.reason });
  }
}

/* ── feedback email ────────────────────────────────────────────────*/
async function sendFeedbackEmail(guestEmail, guestName, feedbackUrl, guestPhone, bookingRef) {
  if (!guestEmail || !process.env.GMAIL_USER || !process.env.GMAIL_PASS ||
      process.env.GMAIL_USER.includes('your_gmail')) {
    await log({ booking_ref: bookingRef, guest_name: guestName, email: guestEmail, phone: guestPhone, type: 'feedback_request', status: 'skipped', error: guestEmail ? 'GMAIL not configured' : 'No guest email' });
    return;
  }

  const stars = (n) => Array.from({ length: 5 }, (_, i) =>
    `<a href="${feedbackUrl}?r=${n}" style="text-decoration:none;font-size:28px;">${i < n ? '★' : '☆'}</a>`
  ).join('');

  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{font-family:Georgia,serif;background:#f5f0eb;margin:0;padding:0;}
  .wrap{max-width:580px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);}
  .head{background:#1a3a4a;padding:36px 40px;text-align:center;}
  .head h1{color:#c9a96e;margin:0;font-size:26px;letter-spacing:.06em;}
  .head p{color:rgba(255,255,255,.7);font-size:12px;margin:6px 0 0;letter-spacing:.2em;text-transform:uppercase;}
  .body{padding:36px 40px;}
  .stars{text-align:center;margin:24px 0;color:#c9a96e;}
  .cta{display:block;background:#1a3a4a;color:#c9a96e;text-decoration:none;border-radius:6px;padding:14px 28px;text-align:center;font-size:15px;font-weight:700;margin:24px auto;width:fit-content;letter-spacing:.04em;}
  .foot{text-align:center;padding:24px 40px;background:#f5f0eb;font-size:12px;color:#999;}
</style></head><body>
<div class="wrap">
  <div class="head"><h1>Sunshine</h1><p>Pondicherry · Your Feedback</p></div>
  <div class="body">
    <p style="font-size:18px;color:#1a3a4a;margin-bottom:8px;">Dear ${guestName},</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      Thank you for your recent stay at Sunshine. We'd love to hear how we did — your feedback helps us make every stay better.
    </p>
    <div class="stars">${stars(5)}</div>
    <a class="cta" href="${feedbackUrl}">Share Your Experience</a>
    <p style="font-size:12px;color:#999;text-align:center;">Takes less than a minute. Your opinion truly matters.</p>
  </div>
  <div class="foot">Sunshine · Pondicherry, Tamil Nadu · India<br/>Ref: ${bookingRef}</div>
</div></body></html>`;

  try {
    await getTransporter().sendMail({
      from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
      to: guestEmail,
      subject: `How was your stay at Sunshine? — ${bookingRef}`,
      html,
    });
    await log({ booking_ref: bookingRef, guest_name: guestName, email: guestEmail, phone: guestPhone, type: 'feedback_request', status: 'sent', message: `Feedback request sent to ${guestEmail}` });
    console.log(`[notify] Feedback request → ${guestEmail}`);

    /* WhatsApp to guest */
    if (guestPhone) {
      const waMsg = `*Sunshine* ⭐ Hi ${guestName}, how was your stay?\nWe'd love your feedback (takes 1 min):\n${feedbackUrl}\nThank you! — Sunshine Pondicherry`;
      const wa = await sendWhatsApp(guestPhone, waMsg);
      await log({ booking_ref: bookingRef, guest_name: guestName, phone: guestPhone, type: 'whatsapp', status: wa.ok ? 'sent' : 'failed', message: wa.ok ? `WhatsApp feedback request to ${guestPhone}` : null, error: wa.ok ? null : wa.reason });
    }
  } catch (err) {
    await log({ booking_ref: bookingRef, guest_name: guestName, email: guestEmail, phone: guestPhone, type: 'feedback_request', status: 'failed', error: err.message });
    console.error('[notify] Feedback email failed:', err.message);
  }
}

/* ── check-in SMS ──────────────────────────────────────────────────*/
async function sendCheckInSMS(phone, guestName, checkInUrl, bookingRef) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone  = process.env.TWILIO_PHONE;

  if (!accountSid || !authToken || !fromPhone ||
      accountSid.includes('AC_your') || fromPhone.includes('XXXXXXXXXX')) {
    await log({ booking_ref: bookingRef, guest_name: guestName, phone, type: 'checkin_sms', status: 'skipped', error: 'Twilio not configured' });
    return;
  }

  const twilio = require('twilio')(accountSid, authToken);
  const body = `Hi ${guestName}, your check-in at Sunshine is in 48 hours! Pre-fill your details to skip the queue: ${checkInUrl}`;

  try {
    await twilio.messages.create({ body, from: fromPhone, to: phone });
    await log({ booking_ref: bookingRef, guest_name: guestName, phone, type: 'checkin_sms', status: 'sent', message: `SMS sent to ${phone}` });
    console.log(`[notify] Check-in SMS → ${phone}`);
  } catch (err) {
    await log({ booking_ref: bookingRef, guest_name: guestName, phone, type: 'checkin_sms', status: 'failed', error: err.message });
    console.error('[notify] Check-in SMS failed:', err.message);
  }
}

/* ── checkout reminder (sent on checkout day by owner) ─────────────*/
async function sendCheckoutReminder(booking) {
  const { reference, guest, phone, email, room, room_number, check_out } = booking;
  const dateStr = fmtDate(check_out);
  const roomLabel = `${room}${room_number ? ` · ${room_number}` : ''}`;

  const waMsg =
`Hi ${guest} 👋

Your stay at Sunshine ends today (*${dateStr}*).
Room: ${roomLabel}

Reply to let us know:
✅ *1* — I'll check out today
🏖 *2* — I'd like to extend my stay

Our team will assist you shortly.

— Sunshine Resort, Pondicherry`;

  let channel = 'none';

  if (phone) {
    const wa = await sendWhatsApp(phone, waMsg);
    await log({ booking_ref: reference, guest_name: guest, phone, type: 'whatsapp', status: wa.ok ? 'sent' : 'failed', message: wa.ok ? `Checkout reminder WhatsApp to ${phone}` : null, error: wa.ok ? null : wa.reason });
    if (wa.ok) channel = 'whatsapp';
  }

  if (email) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
      body{font-family:Arial,sans-serif;background:#f3f4f6;margin:0;padding:0}
      .wrap{max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
      .head{background:#1a3a4a;padding:28px 32px;text-align:center;color:#fff}
      .head h1{margin:0;font-size:22px;letter-spacing:.5px}
      .body{padding:28px 32px;color:#333;line-height:1.6;font-size:14px}
      .foot{background:#f9fafb;padding:16px 32px;font-size:11px;color:#999;text-align:center}
    </style></head><body>
    <div class="wrap">
      <div class="head"><h1>Sunshine</h1><p style="margin:4px 0 0;font-size:13px;opacity:.8">Checkout Reminder</p></div>
      <div class="body">
        <p>Dear <strong>${guest}</strong>,</p>
        <p>Your stay at <strong>Sunshine Resort, Pondicherry</strong> ends today (<strong>${dateStr}</strong>).</p>
        <p><strong>Room:</strong> ${roomLabel}<br/><strong>Ref:</strong> ${reference}</p>
        <p>Please let our front desk know if you'll be checking out today or if you'd like to extend your stay. We're happy to assist!</p>
        <p>— The Sunshine Team</p>
      </div>
      <div class="foot">Sunshine · Pondicherry, Tamil Nadu · India · Ref: ${reference}</div>
    </div></body></html>`;

    try {
      await getTransporter().sendMail({
        from: `"Sunshine Pondicherry" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `Checkout Reminder — ${reference} · ${dateStr}`,
        html,
      });
      await log({ booking_ref: reference, guest_name: guest, email, type: 'checkout_reminder', status: 'sent', message: `Checkout reminder email to ${email}` });
      if (channel === 'none') channel = 'email'; else channel = 'both';
    } catch (err) {
      await log({ booking_ref: reference, guest_name: guest, email, type: 'checkout_reminder', status: 'failed', error: err.message });
      console.error('[notify] Checkout reminder email failed:', err.message);
    }
  }

  return { channel };
}

module.exports = { sendBookingNotifications, sendInvoiceEmail, sendAdvanceReceiptEmail, sendBalancePaymentAlert, sendCancellationAlert, sendOverbookingAlert, sendSpecialRequestUpdate, sendCheckoutReceipt, sendFeedbackEmail, sendCheckInSMS, sendCheckoutReminder };
