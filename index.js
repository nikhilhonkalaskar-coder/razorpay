const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

// Your Google Sheets Web App URL
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbz0o3QJtJdlgY5Jfz-n8wC9djcpYZewv1pQX_J3xxXfIrV8tAR53HME_T1955n8N4zB/exec";

// Razorpay webhook secret (must match dashboard)
const RAZORPAY_SECRET = "Tbipl@123";  // change to your real secret

app.post("/razorpay-webhook", async (req, res) => {
    const body = JSON.stringify(req.body);

    // Signature Verification
    const expectedSignature = crypto
        .createHmac("sha256", RAZORPAY_SECRET)
        .update(body)
        .digest("hex");

    const receivedSignature = req.headers["x-razorpay-signature"];

    if (expectedSignature !== receivedSignature) {
        return res.status(400).send("Invalid Signature");
    }

    const payment = req.body.payload.payment.entity;

    // Data to store in Google Sheet
    const data = {
        name: payment.notes?.name || "",
        email: payment.email || "",
        phone: payment.contact || "",
        amount: payment.amount / 100,
        paymentId: payment.id,
        status: payment.status
    };

    try {
        await axios.post(GOOGLE_SHEET_URL, data);
    } catch (err) {
        console.error("Google Sheet Error → ", err.message);
    }

    res.json({ success: true });
});

app.listen(3000, () => console.log("Webhook running on port 3000"));
