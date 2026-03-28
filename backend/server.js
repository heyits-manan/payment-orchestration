/**
 * server.js
 * =========
 * Express backend for the AI-Driven Payment Orchestration Platform.
 *
 * Endpoints:
 *   POST /process-payment  — Accept payment details, call ML service, route approved payments
 *   GET  /health           — Health check
 *
 * Environment variables:
 *   PORT              — Express port (default: 3000)
 *   ML_SERVICE_URL    — Base URL of the Python ML service (default: http://localhost:5001)
 *   FRAUD_THRESHOLD   — Probability threshold to block (default: 0.7)
 */

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5001";
const FRAUD_THRESHOLD = parseFloat(process.env.FRAUD_THRESHOLD) || 0.7;

const app = express();
app.use(cors());
app.use(express.json());

const gatewayProfiles = {
  gateway_fast: { score: 0.92, fee_bps: 180, strengths: ["low_risk", "domestic"] },
  gateway_shield: { score: 0.96, fee_bps: 240, strengths: ["international", "risky"] },
  gateway_prime: { score: 0.95, fee_bps: 220, strengths: ["high_value", "credit_card"] },
};

function buildFeatureVector(amount, userId, paymentMethod) {
  let hash = 0;
  for (const ch of String(userId)) {
    hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  }

  const pseudoRandom = (i) => {
    const x = Math.sin(hash + i) * 10000;
    return x - Math.floor(x);
  };

  const methodMap = {
    credit_card: 1,
    debit_card: 2,
    upi: 3,
    net_banking: 4,
    wallet: 5,
  };
  const methodCode = methodMap[paymentMethod] || 0;

  const features = new Array(30).fill(0);
  features[0] = Date.now() % 172800;
  features[29] = Number(amount);

  for (let i = 1; i <= 28; i++) {
    features[i] =
      (pseudoRandom(i) - 0.5) * 4 +
      (amount > 500 ? (i % 3 === 0 ? -1.5 : 0.5) : 0) +
      (methodCode * 0.1 * (i % 5 === 0 ? 1 : 0));
  }

  return features;
}

function chooseGateway(payment, fraudScore) {
  const isInternational =
    String(payment.billing_country || "IN").toUpperCase() !==
    String(payment.ip_country || payment.billing_country || "IN").toUpperCase();

  const candidates = Object.entries(gatewayProfiles).map(([name, profile]) => {
    let routeScore = profile.score;

    if (fraudScore < 0.2 && profile.strengths.includes("low_risk")) {
      routeScore += 0.08;
    }
    if (isInternational && profile.strengths.includes("international")) {
      routeScore += 0.1;
    }
    if (Number(payment.amount) >= 2000 && profile.strengths.includes("high_value")) {
      routeScore += 0.08;
    }
    if (payment.payment_method === "credit_card" && profile.strengths.includes("credit_card")) {
      routeScore += 0.05;
    }
    routeScore -= profile.fee_bps / 10000;

    return { name, routeScore };
  });

  candidates.sort((a, b) => b.routeScore - a.routeScore);
  const winner = candidates[0];

  let reason = "Balanced cost and success-rate route.";
  if (fraudScore >= 0.45) {
    reason = "Routed to the strongest fraud-tolerant gateway.";
  } else if (isInternational) {
    reason = "Routed for international transaction handling.";
  } else if (Number(payment.amount) >= 2000) {
    reason = "Routed for higher-value authorization reliability.";
  }

  return {
    gateway: winner.name,
    routing_reason: reason,
    gateway_score: Number(winner.routeScore.toFixed(4)),
  };
}

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    ml_service_url: ML_SERVICE_URL,
    fraud_threshold: FRAUD_THRESHOLD,
    gateway_profiles: Object.keys(gatewayProfiles),
  });
});

app.post("/process-payment", async (req, res) => {
  const { amount, user_id, payment_method } = req.body;

  if (!amount || !user_id || !payment_method) {
    return res.status(400).json({
      error: "Missing required fields: amount, user_id, payment_method",
    });
  }

  console.log("\n────────────────────────────────────────");
  console.log("💳  New Payment Request");
  console.log(`    User      : ${user_id}`);
  console.log(`    Amount    : $${amount}`);
  console.log(`    Method    : ${payment_method}`);
  console.log("────────────────────────────────────────");

  const features = buildFeatureVector(Number(amount), user_id, payment_method);

  try {
    const mlResponse = await axios.post(`${ML_SERVICE_URL}/predict`, { features });
    const { prediction, fraud_probability } = mlResponse.data;

    console.log(`🔍  Fraud Score : ${fraud_probability}`);
    console.log(`📊  Prediction  : ${prediction === 1 ? "FRAUD" : "LEGIT"}`);

    const blocked = fraud_probability > FRAUD_THRESHOLD;
    const status = blocked ? "blocked" : "approved";
    const gatewayDecision = blocked ? null : chooseGateway(req.body, fraud_probability);
    const message = blocked
      ? "Transaction Blocked — High fraud risk detected."
      : `Transaction Approved — Routed to ${gatewayDecision.gateway}.`;

    console.log(`✅  Decision    : ${message}`);
    if (gatewayDecision) {
      console.log(`➡️   Gateway     : ${gatewayDecision.gateway}`);
    }
    console.log("────────────────────────────────────────\n");

    return res.json({
      status,
      fraud_score: fraud_probability,
      prediction,
      gateway: gatewayDecision ? gatewayDecision.gateway : null,
      routing_reason: gatewayDecision ? gatewayDecision.routing_reason : null,
      gateway_score: gatewayDecision ? gatewayDecision.gateway_score : null,
      message,
      transaction: { amount, user_id, payment_method },
    });
  } catch (err) {
    console.error("❌  ML Service error:", err.message);
    return res.status(503).json({
      error: "ML service is unavailable. Make sure the Python Flask API is running on " + ML_SERVICE_URL,
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀  Payment Orchestration API running on http://localhost:${PORT}`);
    console.log(`🤖  ML Service expected at ${ML_SERVICE_URL}`);
    console.log(`🛡️   Fraud threshold: ${FRAUD_THRESHOLD}\n`);
  });
}

module.exports = {
  app,
  buildFeatureVector,
  chooseGateway,
  gatewayProfiles,
};
