/**
 * Razorpay Webhook → MySQL CRM ONLY
 * Hardcoded PORT & WEBHOOK SECRET
 */

const express = require("express");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const app = express();

/* ================== HARD CODED CONFIG ================== */

// 👉 CHANGE THESE VALUES
const PORT = 3000; // your server port
const WEBHOOK_SECRET = "Tbipl@123";

/* ================== MYSQL ================== */

const db = mysql.createPool({
  host: "localhost",
  user: "CRM_DB_USER",
  password: "CRM_DB_PASSWORD",
  database: "CRM_DB_NAME",
  waitForConnections: true,
  connectionLimit: 10
});

/* ================== RAW BODY (VERY IMPORTANT) ================== */

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    }
  })
);

/* ================== HELPERS ================== */

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

function buildCRMPayload(payment, event) {
  return {
    payment_id: payment.id,
    order_id: payment.order_id,
    email: payment.email || "",
    phone: payment.contact || "",
    customer_name: payment.notes?.name || "",
    city: payment.notes?.city || "",
    amount: payment.amount / 100,
    currency: payment.currency,
    status: payment.status,
    event,
    method: payment.method,
    paid_at: new Date(payment.created_at * 1000)
  };
}

/* ================== CRM INSERT ================== */

async function pushToCRM(data) {
  try {
    // Store only successful payments
    if (data.status !== "captured") {
      console.log("⏭ CRM skipped (not captured)");
      return;
    }

    await db.execute(
      `INSERT INTO crm_payments
      (payment_id, order_id, email, phone, customer_name, city,
       amount, currency, status, event, method, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE payment_id = payment_id`,
      [
        data.payment_id,
        data.order_id,
        data.email,
        data.phone,
        data.customer_name,
        data.city,
        data.amount,
        data.currency,
        data.status,
        data.event,
        data.method,
        data.paid_at
      ]
    );

    console.log("✅ Stored in CRM:", data.payment_id);
  } catch (err) {
    console.error("❌ CRM DB Error:", err.message);
  }
}

/* ================== WEBHOOK ================== */

app.post("/razorpay-webhook", (req, res) => {
  console.log("\n📩 Webhook received");

  if (!verifySignature(req)) {
    console.log("❌ Invalid signature");
    return res.status(400).send("Invalid signature");
  }

  res.status(200).send("OK");

  // async processing
  setImmediate(async () => {
    try {
      const event = req.body.event;
      const payment = extractPayment(req.body);
      if (!payment) return;

     const time = istTime(payment.created_at);

// Log payment info
console.log(`[${time}] 💰 Payment ID: ${payment.id}`);
console.log(`[${time}] 💳 Status: ${payment.status}`);
console.log(`[${time}] 👤 Email: ${payment.email || "N/A"}`);
console.log(`[${time}] 📞 Contact: ${payment.contact || "N/A"}`);
console.log(`[${time}] 🧑 Name: ${payment.notes?.name || "N/A"}`);
console.log(`[${time}] 🌆 City: ${payment.notes?.city || "N/A"}`);
console.log(
  `[${time}] 💵 Amount Paid: ₹${payment.amount ? payment.amount / 100 : 0}`
);

      const crmPayload = buildCRMPayload(payment, event);
      await pushToCRM(crmPayload);
    } catch (err) {
      console.error("❌ Webhook error:", err);
    }
  });
});

/* ================== TEST ROUTE ================== */

app.get("/razorpay-webhook", (req, res) => {
  res.send("✅ Razorpay Webhook Active (CRM ONLY)");
});

/* ================== START SERVER ================== */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

