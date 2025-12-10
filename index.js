const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// ========= CONFIG =========
const SPREADSHEET_ID = "1sw01ACVf1XhrVa3FggDdwteGlzpH1qIUAhigHBTHvgE";
const WEBHOOK_SECRET = "Tbipl@123";

// Google Auth
async function getGoogleSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: "v4", auth: client });
  return googleSheets;
}

// ========== WEBHOOK ROUTE ==========
app.post("/razorpay-webhook", async (req, res) => {
  console.log(`[${new Date().toLocaleTimeString()}] 📩 Webhook received`);

  // Signature validation
  const receivedSignature = req.headers["x-razorpay-signature"];
  const expectedSignature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (receivedSignature !== expectedSignature) {
    console.log("❌ Signature Mismatch");
    return res.status(400).send("Invalid signature");
  }

  console.log("🔐 Signature OK");

  const event = req.body.event;
  const payload = req.body.payload.payment.entity;

  const payment_id = payload.id || "";
  const order_id = payload.order_id || "";
  const email = payload.email || "";
  const contact = payload.contact || "";
  const amount = (payload.amount / 100).toString() || "";
  const status = payload.status || "";
  const method = payload.method || "";
  const name = payload.notes?.name || "";
  const city = payload.notes?.city || "";

  // ⭐ REAL PAYMENT TIME FROM RAZORPAY (converted to IST)
  const razorpayTimestamp = payload.created_at * 1000;
  const date = new Date(razorpayTimestamp).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });

  console.log(`💰 Payment ID: ${payment_id}`);
  console.log(`💳 Status: ${status} (${event})`);
  console.log(`👤 Email: ${email}`);
  console.log(`📞 Contact: ${contact}`);
  console.log(`🧑 Name: ${name}`);
  console.log(`🌆 City: ${city}`);
  console.log(`💵 Amount Paid: ₹${amount}`);
  console.log(`⏱ Payment Time (IST): ${date}`);

  try {
    const googleSheets = await getGoogleSheets();

    // ----------------------------
    //  CLICKABLE LINKS
    // ----------------------------
    const paymentLinkPrefix = "https://dashboard.razorpay.com/app/payments/";

    const paymentIdCell = payment_id
      ? `=HYPERLINK("${paymentLinkPrefix + payment_id}", "${payment_id}")`
      : "";

    const emailCell = email
      ? `=HYPERLINK("mailto:${email}", "${email}")`
      : "";

    // ----------------------------
    //  ROW DATA FOR GOOGLE SHEET
    // ----------------------------
    const rowData = [
      paymentIdCell,
      order_id,
      emailCell,
      contact,
      amount,
      event,
      status,
      method,
      name,
      city,
      date,
    ];

    // --------- SHEET1 (ALL PAYMENTS) ----------
    await googleSheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A:K",
      insertDataOption: "INSERT_ROWS",
      valueInputOption: "USER_ENTERED",
      resource: { values: [rowData] },
    });

    console.log("✅ Written to Sheet1");

    // --------- SHEET2 (ONLY ₹99 PAYMENTS) ----------
    if (amount === "99") {
      await googleSheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "Sheet2!A:K",
        insertDataOption: "INSERT_ROWS",
        valueInputOption: "USER_ENTERED",
        resource: { values: [rowData] },
      });

      console.log("📌 Also written to Sheet2 (₹99 payment)");
    } else {
      console.log("⏭ Not a ₹99 payment for Sheet2");
    }

    return res.status(200).send("Webhook processed");
  } catch (err) {
    console.error("❌ Google Sheet Error:", err);
    return res.status(500).send("Error writing to sheet");
  }
});

// START SERVER
app.listen(3000, () => console.log("🚀 Server running on port 3000"));
