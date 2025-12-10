const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

// ========= CONFIG =========
const SPREADSHEET_ID = "1sw01ACVf1XhrVa3FggDdwteGlzpH1qIUAhigHBTHvgE";
const WEBHOOK_SECRET = "Tbipl@123";

// Only these Razorpay events allowed
const ALLOWED_PAYMENT_EVENTS = [
  "payment.authorized",
  "payment.captured",
  "payment.failed"
];

// RAW body needed for signature validation
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));

// ========= GOOGLE AUTH =========
const client = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth: client });

// Helpers
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

// ========= WEBHOOK ROUTE =========
app.post("/razorpay-webhook", async (req, res) => {
  const time = now();
  console.log(`\n[${time}] 📩 Webhook received`);

  if (!verifySignature(req)) {
    console.log(`[${time}] ❌ Invalid signature`);
    return res.status(400).send("Invalid signature");
  }

  console.log(`[${time}] 🔐 Signature OK`);
  res.status(200).send("OK");

  setTimeout(() => processWebhook(req.body, time), 5);
});

// ========= PROCESS WEBHOOK =========
async function processWebhook(body, time) {
  try {
    const event = body.event;

    if (!ALLOWED_PAYMENT_EVENTS.includes(event)) {
      console.log(`[${time}] ⏭ Skipping event: ${event}`);
      return;
    }

    const payment = extractPayment(body);
    if (!payment) {
      console.log(`[${time}] ⚠️ Payment missing`);
      return;
    }

    // Determine FINAL STATUS
    let final_status = "authorized";
    if (event === "payment.captured") final_status = "captured";
    if (event === "payment.failed") final_status = "failed";

    const row = [
      payment.id || "",
      payment.order_id || "",
      payment.email || "",
      payment.contact || "",
      payment.amount ? payment.amount / 100 : "",
      payment.currency || "",
      event,                     // raw event
      final_status,              // FINAL status (important)
      payment.method || "",
      payment.error_code || "",
      payment.error_description || "",
      payment.notes?.name || "",
      payment.notes?.phone || "",
      payment.notes?.email || "",
      payment.notes?.customfield1 || "",
      payment.notes?.customfield2 || "",
      payment.notes?.city || "",
      new Date(payment.created_at * 1000).toLocaleString("en-IN")
    ];

    await appendToSheet(row);

  } catch (err) {
    console.error(`[${time}] ❌ Error:`, err);
  }
}

// ========= WRITE TO GOOGLE SHEET =========
async function appendToSheet(row) {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.error("🚨 Google credentials missing");
    return;
  }

  try {
    await client.authorize();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:R",
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });
    console.log("✅ Row Added to Google Sheet");
  } catch (err) {
    console.error("❌ Google Sheets Error:", err);
  }
}

// ========= TEST ROUTE =========
app.get("/razorpay-webhook", (req, res) => {
  res.status(200).send("✔ Razorpay Webhook Running");
});

// ========= START =========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server live on port ${PORT}`));
