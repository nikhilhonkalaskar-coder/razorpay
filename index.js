const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

// ========= CONFIG =========
const SPREADSHEET_ID = "1sw01ACVf1XhrVa3FggDdwteGlzpH1qIUAhigHBTHvgE";
const WEBHOOK_SECRET = "Tbipl@123";

// Allowed Razorpay events
const ALLOWED_PAYMENT_EVENTS = [
  "payment.created",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment.refunded"
];

// ========= MIDDLEWARE =========
// RAW body needed for signature verification
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString(); }
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

// ========= WEBHOOK ROUTE =========
app.post("/razorpay-webhook", async (req, res) => {
  const time = now();
  console.log(`\n[${time}] 📩 Webhook received`);

  if (!verifySignature(req)) {
    console.log(`[${time}] ❌ Invalid signature`);
    return res.status(400).send("Invalid signature");
  }

  console.log(`[${time}] 🔐 Signature OK`);
  res.status(200).send("OK"); // Respond immediately

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

    // Map status for simplicity
    let status = "authorized";
    if (event === "payment.captured") status = "success";
    if (event === "payment.failed") status = "failed";

    // Use payment.created_at timestamp or current time
    const paymentTime = new Date((payment.created_at || Math.floor(Date.now() / 1000)) * 1000);
    const dateStr = paymentTime.toLocaleDateString("en-IN");   // DD/MM/YYYY
    const timeStr = paymentTime.toLocaleTimeString("en-IN", { hour12: false }); // HH:MM:SS

    // Prepare simplified row
    const row = [
      payment.id || "",                     // Payment ID
      payment.order_id || "",               // Order
      payment.email || "",                  // Email
      payment.contact || "",                // Phone
      payment.amount ? payment.amount / 100 : 0, // Amount
      event,                                // Event
      status,                               // Status
      payment.method || "",                 // Method
      payment.notes?.name || "",            // Name
      payment.notes?.city || "",            // City
      `${dateStr} ${timeStr}`               // Date + Time
    ];

    await appendToSheet(row);

    // Log details
    console.log(`[${time}] 💰 Payment ID: ${payment.id}`);
    console.log(`[${time}] 💳 Status: ${payment.status}`);
    console.log(`[${time}] 👤 Email: ${payment.email}`);
    console.log(`[${time}] 📞 Contact: ${payment.contact}`);
    console.log(`[${time}] 🧑 Name: ${payment.notes?.name || "N/A"}`);
    console.log(`[${time}] 🌆 City: ${payment.notes?.city || "N/A"}`);
    console.log(`[${time}] 💵 Amount Paid: ₹${payment.amount ? payment.amount / 100 : 0}`);

  } catch (err) {
    console.error(`[${time}] ❌ Webhook processing error:`, err);
  }
}

// ========= APPEND TO GOOGLE SHEET =========
async function appendToSheet(row) {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.error("🚨 Google credentials missing. Cannot write to sheet.");
    return;
  }

  try {
    await client.authorize();

    // Make Payment ID & Email clickable
    const paymentLink = `https://dashboard.razorpay.com/app/payments/${row[0]}`;
    const formattedRow = [
      `=HYPERLINK("${paymentLink}", "${row[0]}")`,  // Payment ID clickable
      row[1],                                       // Order
      `=HYPERLINK("mailto:${row[2]}", "${row[2]}")`, // Email clickable
      row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10]
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:K",
      valueInputOption: "USER_ENTERED", // Needed for HYPERLINK formulas
      requestBody: { values: [formattedRow] }
    });

    console.log("✅ Google Sheet write success (clickable links)");

  } catch (err) {
    console.error("❌ Google Sheets error:", err.message);
  }
}

// ========= TEST ROUTE =========
app.get("/razorpay-webhook", (req, res) => {
  res.status(200).send("✔ Razorpay Webhook Active (POST only)");
});

// ========= START SERVER =========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
