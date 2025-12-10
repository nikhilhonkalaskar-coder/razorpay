const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

// ========= CONFIG =========
const SPREADSHEET_ID = "1sw01ACVf1XhrVa3FggDdwteGlzpH1qIUAhigHBTHvgE";
const WEBHOOK_SECRET = "Tbipl@123";

// Store all ₹99 payments in Sheet2
const AMOUNT_99 = 9900;

// ========= RAZORPAY EVENTS ALLOWED =========
const ALLOWED_PAYMENT_EVENTS = [
  "payment.created",
  "payment.authorized",
  "payment.captured",
  "payment.failed"
];

// RAW BODY for Razorpay signature validation
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
    if (!payment) return;

    // Logging
    console.log(`[${time}] 💰 Payment ID: ${payment.id}`);
    console.log(`[${time}] 💳 Status: ${payment.status} (${event})`);
    console.log(`[${time}] 👤 Email: ${payment.email}`);
    console.log(`[${time}] 📞 Contact: ${payment.contact}`);
    console.log(`[${time}] 🧑 Name: ${payment.notes?.name || "N/A"}`);
    console.log(`[${time}] 🌆 City: ${payment.notes?.city || "N/A"}`);
    console.log(`[${time}] 💵 Amount Paid: ₹${payment.amount / 100}`);

    const formattedRow = [
      payment.id || "",
      payment.order_id || "",
      payment.email || "",
      payment.contact || "",
      payment.amount ? payment.amount / 100 : "",
      payment.currency || "",
      event,
      payment.status || "",
      payment.method || "",
      payment.notes?.name || "",
      payment.notes?.city || "",
      new Date(payment.created_at * 1000).toLocaleString("en-IN")
    ];

    // Always write to Sheet1
    await appendToSheet("Sheet1!A:L", formattedRow);
    console.log(`[${time}] ✅ Written to Sheet1`);

    // ===== SHEET2 LOGIC (Option A) =====
    if (payment.amount === AMOUNT_99) {
      await appendToSheet("Sheet2!A:L", formattedRow);
      console.log(`[${time}] 🎯 Written to Sheet2 (₹99 payment)`);
    } else {
      console.log(`[${time}] ⏭ Not a ₹99 payment for Sheet2`);
    }

  } catch (err) {
    console.error(`[${time}] ❌ Webhook processing error:`, err);
  }
}

// ========= WRITE TO SHEET =========
async function appendToSheet(range, row) {
  try {
    await client.authorize();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });
  } catch (err) {
    console.error("❌ Google Sheets error:", err.message);
  }
}

// ========= TEST ROUTE =========
app.get("/razorpay-webhook", (req, res) => {
  res.status(200).send("✔ Razorpay Webhook Active");
});

// ========= START SERVER =========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
