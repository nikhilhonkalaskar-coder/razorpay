const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

// RAW body required for Razorpay signature verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    }
  })
);

// Google Sheets Auth (ENV-based for Render)
const client = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth: client });

const SPREADSHEET_ID = "1sw01ACVf1XhrVa3FggDdwteGlzpH1qIUAhigHBTHvgE";
const WEBHOOK_SECRET = "Tbipl@123";


// ========= Helper : Timestamp =========
function now() {
  return new Date().toLocaleTimeString("en-IN", { hour12: false });
}

// ========= Signature Verify =========
function verifySignature(req) {
  const signature = req.headers["x-razorpay-signature"];
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  return expected === signature;
}

// ========= Extract Payment =========
function extractPaymentEntity(body) {
  return body?.payload?.payment?.entity || null;
}

// Allowed Razorpay payment lifecycle events
const ALLOWED_PAYMENT_EVENTS = [
  "payment.created",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment.refunded"
];


// ========= MAIN WEBHOOK ROUTE =========
app.post("/razorpay-webhook", async (req, res) => {
  const time = now();
  console.log(`\n[${time}] 📩 Webhook received`);

  const isValid = verifySignature(req);
  console.log(`[${time}] 🔐 Signature: ${isValid ? "✔ OK" : "❌ INVALID"}`);

  if (!isValid) {
    return res.status(400).send("Invalid signature");
  }

  res.status(200).send("OK"); // Immediate response
  setTimeout(() => processWebhook(req.body, time), 5);
});


// ========= PROCESSING LOGIC =========
async function processWebhook(body, time) {
  try {
    const event = body.event;
    console.log(`[${time}] 📡 Event: ${event}`);

    if (!ALLOWED_PAYMENT_EVENTS.includes(event)) {
      console.log(`[${time}] ⏭ Skipping unrelated event: ${event}`);
      return;
    }

    const payment = extractPaymentEntity(body);
    if (!payment) {
      console.log(`[${time}] ⚠️ Payment entity missing`);
      return;
    }

    console.log(`[${time}] 💰 Payment ID: ${payment.id}`);
    console.log(`[${time}] 💳 Status: ${payment.status}`);
    console.log(`[${time}] 👤 Email: ${payment.email}`);
    console.log(`[${time}] 📞 Contact: ${payment.contact}`);
    console.log(`[${time}] 🧑 Name: ${payment.notes?.name || "N/A"}`);

    const row = [
      payment.id || "",
      payment.order_id || "",
      payment.email || "",
      payment.contact || "",
      payment.amount ? payment.amount / 100 : "",
      payment.currency || "",
      event,
      payment.status || "",
      payment.method || "",
      payment.error_code || "",
      payment.error_description || "",
      payment.notes?.name || "",
      payment.notes?.phone || "",
      payment.notes?.email || "",
      payment.notes?.customfield1 || "",
      payment.notes?.customfield2 || "",
      new Date((payment.created_at || Math.floor(Date.now() / 1000)) * 1000)
        .toLocaleString("en-IN")
    ];

    await appendToSheet(row);
    console.log(`[${time}] ✅ Stored to Google Sheet`);

  } catch (err) {
    console.error(`[${time}] ❌ Webhook processing error:`, err);
  }
}


// ========= WRITE TO GOOGLE SHEETS =========
async function appendToSheet(row) {
  for (let i = 1; i <= 3; i++) {
    try {
      console.log(`📄 Writing to Google Sheet (Attempt ${i})...`);

      await client.authorize();

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "Sheet1!A:Q",
        valueInputOption: "RAW",
        requestBody: { values: [row] }
      });

      console.log("✅ Google Sheet write success");
      return;

    } catch (err) {
      console.error(`❌ Google Sheets error (Attempt ${i}):`, err.message);

      if (i === 3) {
        console.error("🚨 Failed after 3 attempts. Giving up.");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}


// ========= TEST ROUTE =========
app.get("/razorpay-webhook", (req, res) => {
  res.status(200).send("✔ Razorpay Webhook Active (POST only)");
});


// ========= START SERVER =========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
