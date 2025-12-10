const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

// ========= CONFIG =========
const SPREADSHEET_ID = "1sw01ACVf1XhrVa3FggDdwteGlzpH1qIUAhigHBTHvgE";
const WEBHOOK_SECRET = "Tbipl@123";
const PAYMENT_PAGE_ID_99 = "pl_RgmfHZBjsTtr1q";
const AMOUNT_99 = 9900; // in paise

// Allowed Razorpay events
const ALLOWED_PAYMENT_EVENTS = [
  "payment.created",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment.refunded"
];

// ========= MIDDLEWARE =========
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// ========= GOOGLE SHEETS AUTH =========
const client = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth: client });

// ========= HELPERS =========
function now() {
  return new Date().toLocaleTimeString("en-IN", { hour12: false });
}

function verifySignature(req) {
  const signature = req.headers["x-razorpay-signature"];
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  return expected === signature;
}

function extractPayment(body) {
  return body?.payload?.payment?.entity || null;
}

function istDateTimeFromUnix(unixSeconds) {
  const dt = new Date(unixSeconds * 1000);
  const dateStr = dt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const timeStr = dt.toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  return `${dateStr} ${timeStr}`;
}

// ========= WEBHOOK ROUTE =========
app.post("/razorpay-webhook", async (req, res) => {
  const time = now();
  console.log(`\n[${time}] 📩 Webhook received`);

  if (!verifySignature(req)) {
    console.log(`[${time}] ❌ Invalid signature`);
    return res.status(400).send("Invalid signature");
  }

  console.log(`[${time}] 🔐 Signature OK`);
  res.status(200).send("OK"); // respond immediately

  // process async
  setTimeout(() => processWebhook(req.body, time), 5);
});

// ========= PROCESS WEBHOOK =========
async function processWebhook(body, time) {
  try {
    const event = body.event;
    if (!ALLOWED_PAYMENT_EVENTS.includes(event)) {
      console.log(`[${time}] ⏭ Skipping unrelated event: ${event}`);
      return;
    }

    const payment = extractPayment(body);
    if (!payment) {
      console.log(`[${time}] ⚠️ Payment entity missing`);
      return;
    }

    // Determine simple status
    let simpleStatus = "authorized";
    if (event === "payment.captured") simpleStatus = "success";
    if (event === "payment.failed") simpleStatus = "failed";

    // IST timestamp
    const createdAt = payment.created_at ? payment.created_at : Math.floor(Date.now() / 1000);
    const istDateTime = istDateTimeFromUnix(createdAt);

    // Extract fields
    const paymentId = payment.id || "";
    const orderId = payment.order_id || "";
    const email = payment.email || "";
    const contact = payment.contact || "";
    const amountINR = payment.amount ? payment.amount / 100 : 0;
    const currency = payment.currency || "";
    const method = payment.method || "";
    const notesName = payment.notes?.name || "";
    const notesCity = payment.notes?.city || "";
    const pageId = payment.notes?.razorpay_payment_page_id || "";

    // Logging
    console.log(`[${time}] 💰 Payment ID: ${paymentId}`);
    console.log(`[${time}] 💳 Status: ${payment.status} (${event})`);
    console.log(`[${time}] 👤 Email: ${email || "N/A"}`);
    console.log(`[${time}] 📞 Contact: ${contact || "N/A"}`);
    console.log(`[${time}] 🧑 Name: ${notesName || "N/A"}`);
    console.log(`[${time}] 🌆 City: ${notesCity || "N/A"}`);
    console.log(`[${time}] 💵 Amount Paid: ₹${amountINR}`);

    // Hyperlink Payment ID (Razorpay dashboard)
    const paymentLinkPrefix = "https://dashboard.razorpay.com/app/payments/";
    const paymentIdCell = paymentId ? `=HYPERLINK("${paymentLinkPrefix + paymentId}", "${paymentId}")` : "";
    const emailCell = email ? `=HYPERLINK("mailto:${email}","${email}")` : "";

    const formattedRow = [
      paymentIdCell,
      orderId,
      emailCell,
      contact,
      amountINR,
      event,
      simpleStatus,
      method,
      notesName,
      notesCity,
      istDateTime
    ];

    // Write to Sheet1 (All payments)
    await appendToSheetMain(formattedRow);
    console.log(`[${time}] ✅ Written to Sheet1`);

    // Write to Sheet2 for ALL ₹99 payments from your payment page
    if (payment.amount === AMOUNT_99 && pageId === PAYMENT_PAGE_ID_99) {
      await appendToSheet99(formattedRow);
      console.log(`[${time}] 🎯 ₹99 payment written to Sheet2 (any status)`);
    } else {
      console.log(`[${time}] ⏭ Not a ₹99 payment for Sheet2`);
    }

  } catch (err) {
    console.error(`[${time}] ❌ Webhook processing error:`, err);
  }
}

// ========= APPEND TO SHEETS =========
async function appendToSheetMain(formattedRow) {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.error("🚨 Google credentials missing. Cannot write to Sheet1.");
    return;
  }
  try {
    await client.authorize();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:K",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [formattedRow] }
    });
  } catch (err) {
    console.error("❌ Google Sheets error (Sheet1):", err.message || err);
  }
}

async function appendToSheet99(formattedRow) {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.error("🚨 Google credentials missing. Cannot write to Sheet2.");
    return;
  }
  try {
    await client.authorize();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet2!A:K",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [formattedRow] }
    });
  } catch (err) {
    console.error("❌ Google Sheets error (Sheet2):", err.message || err);
  }
}

// ========= TEST ROUTE =========
app.get("/razorpay-webhook", (req, res) => {
  res.status(200).send("✔ Razorpay Webhook Active (POST only)");
});

// ========= START SERVER =========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
