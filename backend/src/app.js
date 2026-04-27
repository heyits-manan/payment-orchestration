require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const healthRoutes = require("./routes/health");
const paymentRoutes = require("./routes/payments");
const dashboardRoutes = require("./routes/dashboard");
const { createPaymentAttempt } = require("./services/paymentService");
const { gatewayProfiles } = require("./services/gatewayService");
const { validateCheckoutPayload } = require("./utils/validation");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/health", healthRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.post("/process-payment", async (req, res) => {
  const legacyPayload = {
    customer_name: req.body.customer_name || "Demo Customer",
    customer_email: req.body.customer_email || "demo.customer@example.com",
    card_number: req.body.card_number || "4111 1111 1111 1111",
    expiry: req.body.expiry || "12/28",
    cvv: req.body.cvv || "123",
    currency: req.body.currency || "INR",
    device_id: req.body.device_id || "legacy_demo_device",
    ...req.body,
  };
  const validation = validateCheckoutPayload(legacyPayload);
  if (!validation.valid) {
    return res.status(400).json({
      error: "Invalid payment request",
      details: validation.errors,
    });
  }

  const result = await createPaymentAttempt(validation.normalized);
  return res.status(result.duplicate ? 200 : 201).json({
    duplicate: result.duplicate,
    ...result.response,
  });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/providers/:gatewayKey", (_req, res) => {
  if (!gatewayProfiles[_req.params.gatewayKey]) {
    return res
      .status(404)
      .sendFile(path.join(__dirname, "..", "public", "provider-not-found.html"));
  }
  res.sendFile(path.join(__dirname, "..", "public", "provider.html"));
});

module.exports = app;
