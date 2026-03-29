require("dotenv").config();

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
 *   FRAUD_THRESHOLD   — Probability threshold to block (default: 0.8)
 */

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const {
  fetchUserTransactionSummary,
  getSupabaseStatus,
  insertGatewaySnapshot,
  insertTransaction,
} = require("./supabase");

const PORT = process.env.PORT || 3000;
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5001";
const FRAUD_THRESHOLD = parseFloat(process.env.FRAUD_THRESHOLD) || 0.8;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const gatewayProfiles = {
  gateway_alpha: {
    display_name: "Gateway Alpha",
    strengths: ["domestic", "low_risk"],
    success_base: 96.3,
    latency_base: 220,
    fee_base_bps: 205,
    health_base: 94.2,
    supports_international: false,
  },
  gateway_orbit: {
    display_name: "Gateway Orbit",
    strengths: ["international", "risky"],
    success_base: 94.8,
    latency_base: 270,
    fee_base_bps: 225,
    health_base: 96.1,
    supports_international: true,
  },
  gateway_flux: {
    display_name: "Gateway Flux",
    strengths: ["high_value", "credit_card"],
    success_base: 95.6,
    latency_base: 235,
    fee_base_bps: 198,
    health_base: 93.8,
    supports_international: true,
  },
};

function buildFeatureVector(amount, userId, paymentMethod, billingCountry = "IN", ipCountry = "IN") {
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
  const isInternational =
    String(billingCountry).toUpperCase() !== String(ipCountry).toUpperCase();
  const amountRiskBoost =
    amount >= 8000 ? 2.8 : amount >= 4000 ? 1.6 : amount >= 1500 ? 0.7 : 0;

  const features = new Array(30).fill(0);
  features[0] = Date.now() % 172800;
  features[29] = Number(amount);

  for (let i = 1; i <= 28; i++) {
    features[i] =
      (pseudoRandom(i) - 0.5) * 4 +
      amountRiskBoost * (i % 3 === 0 ? -1.25 : 0.85) +
      (methodCode * 0.1 * (i % 5 === 0 ? 1 : 0)) +
      (isInternational ? (i % 4 === 0 ? -2.2 : 1.1) : 0);
  }

  return features;
}

function seededJitter(seedInput, min, max) {
  let hash = 0;
  for (const ch of String(seedInput)) {
    hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  }
  const normalized = (Math.sin(hash) + 1) / 2;
  return min + normalized * (max - min);
}

function buildGatewayResponse(gatewayKey, payment) {
  const profile = gatewayProfiles[gatewayKey];
  const amount = Number(payment.amount) || 0;
  const isInternational =
    String(payment.billing_country || "IN").toUpperCase() !==
    String(payment.ip_country || payment.billing_country || "IN").toUpperCase();
  const seed = `${gatewayKey}:${payment.user_id || "guest"}:${amount}:${Date.now()}`;

  const successRate = Number(
    Math.max(
      88,
      Math.min(
        99.4,
        profile.success_base +
          seededJitter(seed + ":success", -1.8, 1.7) +
          (isInternational && profile.supports_international ? 0.4 : 0) -
          (isInternational && !profile.supports_international ? 1.6 : 0)
      )
    ).toFixed(2)
  );
  const avgLatencyMs = Math.round(
    Math.max(120, profile.latency_base + seededJitter(seed + ":latency", -45, 65))
  );
  const feeBps = Number(
    Math.max(150, profile.fee_base_bps + seededJitter(seed + ":fee", -18, 20)).toFixed(0)
  );
  const healthScore = Number(
    Math.max(85, Math.min(99.5, profile.health_base + seededJitter(seed + ":health", -2.4, 2.2))).toFixed(2)
  );
  const uptime24h = Number(
    Math.max(98.5, Math.min(99.99, 99.2 + seededJitter(seed + ":uptime", -0.3, 0.5))).toFixed(2)
  );

  return {
    gateway_key: gatewayKey,
    gateway_name: profile.display_name,
    available: true,
    success_rate: successRate,
    avg_latency_ms: avgLatencyMs,
    fee_bps: feeBps,
    health_score: healthScore,
    uptime_24h: uptime24h,
    supports_international: profile.supports_international,
    recommended_for: profile.strengths,
    settlement_speed: avgLatencyMs < 230 ? "fast" : "standard",
  };
}

async function fetchGatewayOptions(payment, origin) {
  const gatewayKeys = Object.keys(gatewayProfiles);
  const requests = gatewayKeys.map((gatewayKey) =>
    axios.post(`${origin}/mock-gateways/${gatewayKey}`, payment, { timeout: 4000 })
  );
  const responses = await Promise.all(requests);
  return responses.map((response) => response.data);
}

function scoreGatewayOption(gateway, payment, fraudScore) {
  const isInternational =
    String(payment.billing_country || "IN").toUpperCase() !==
    String(payment.ip_country || payment.billing_country || "IN").toUpperCase();
  let routeScore =
    gateway.success_rate / 100 +
    gateway.health_score / 200 -
    gateway.fee_bps / 10000 -
    gateway.avg_latency_ms / 5000;

  if (fraudScore < 0.25 && gateway.recommended_for.includes("low_risk")) {
    routeScore += 0.08;
  }
  if (fraudScore >= 0.45 && gateway.recommended_for.includes("risky")) {
    routeScore += 0.12;
  }
  if (isInternational && gateway.supports_international) {
    routeScore += 0.12;
  }
  if (Number(payment.amount) >= 2000 && gateway.recommended_for.includes("high_value")) {
    routeScore += 0.08;
  }
  if (payment.payment_method === "credit_card" && gateway.recommended_for.includes("credit_card")) {
    routeScore += 0.05;
  }

  let reason = "Balanced cost and success-rate route.";
  if (fraudScore >= 0.45 && gateway.recommended_for.includes("risky")) {
    reason = "Routed to the strongest fraud-tolerant gateway.";
  } else if (isInternational && gateway.supports_international) {
    reason = "Routed for international transaction handling.";
  } else if (Number(payment.amount) >= 2000 && gateway.recommended_for.includes("high_value")) {
    reason = "Routed for higher-value authorization reliability.";
  }

  return {
    ...gateway,
    route_score: Number(routeScore.toFixed(4)),
    routing_reason: reason,
  };
}

function calculateRiskAdjustments(payment, history = {}) {
  const amount = Number(payment.amount) || 0;
  const billingCountry = String(payment.billing_country || "IN").toUpperCase();
  const ipCountry = String(payment.ip_country || billingCountry).toUpperCase();
  const avgAmount = Number(history.avgAmount || 0);

  let adjustment = 0;
  const reasons = [];

  if (amount >= 8000) {
    adjustment += 0.46;
    reasons.push("high transaction amount");
  } else if (amount >= 4000) {
    adjustment += 0.22;
    reasons.push("above-normal transaction amount");
  }

  if (billingCountry !== ipCountry) {
    adjustment += 0.34;
    reasons.push("billing and IP country mismatch");
  }

  if (String(payment.payment_method) === "credit_card") {
    adjustment += 0.04;
  }

  if (history.transactions24h >= 5) {
    adjustment += 0.16;
    reasons.push("high transaction velocity in last 24h");
  }

  if (history.blocked24h >= 2) {
    adjustment += 0.18;
    reasons.push("multiple blocked transactions in last 24h");
  }

  if (avgAmount > 0 && amount >= avgAmount * 5) {
    adjustment += 0.28;
    reasons.push("amount much higher than user average");
  } else if (avgAmount > 0 && amount >= avgAmount * 2) {
    adjustment += 0.14;
    reasons.push("amount above user average");
  }

  if (
    history.billingCountries &&
    history.billingCountries.length > 0 &&
    !history.billingCountries.includes(billingCountry)
  ) {
    adjustment += 0.12;
    reasons.push("new billing country for user");
  }

  if (
    history.ipCountries &&
    history.ipCountries.length > 0 &&
    !history.ipCountries.includes(ipCountry)
  ) {
    adjustment += 0.12;
    reasons.push("new IP country for user");
  }

  return {
    adjustedFraudScore: Number(Math.min(0.99, adjustment).toFixed(4)),
    reasons,
  };
}

app.get("/health", (_req, res) => {
  const supabase = getSupabaseStatus();
  res.json({
    status: "healthy",
    ml_service_url: ML_SERVICE_URL,
    fraud_threshold: FRAUD_THRESHOLD,
    gateway_profiles: Object.keys(gatewayProfiles),
    supabase,
  });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/providers/:gatewayKey", (req, res) => {
  const { gatewayKey } = req.params;
  if (!gatewayProfiles[gatewayKey]) {
    return res.status(404).sendFile(path.join(__dirname, "public", "provider-not-found.html"));
  }

  return res.sendFile(path.join(__dirname, "public", "provider.html"));
});

app.post("/mock-gateways/:gatewayKey", (req, res) => {
  const { gatewayKey } = req.params;
  if (!gatewayProfiles[gatewayKey]) {
    return res.status(404).json({ error: "Gateway provider not found." });
  }

  return res.json(buildGatewayResponse(gatewayKey, req.body || {}));
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

  const features = buildFeatureVector(
    Number(amount),
    user_id,
    payment_method,
    req.body.billing_country,
    req.body.ip_country
  );

  try {
    const history = await fetchUserTransactionSummary(user_id);
    const mlResponse = await axios.post(`${ML_SERVICE_URL}/predict`, { features });
    const { prediction, fraud_probability } = mlResponse.data;
    const riskAdjustment = calculateRiskAdjustments(req.body, history);
    const effectiveFraudScore = Number(
      Math.min(0.99, fraud_probability + riskAdjustment.adjustedFraudScore).toFixed(4)
    );
    const origin = `${req.protocol}://${req.get("host")}`;
    const gatewayOptions = await fetchGatewayOptions(req.body, origin);
    const rankedGateways = gatewayOptions
      .map((gateway) => scoreGatewayOption(gateway, req.body, effectiveFraudScore))
      .sort((a, b) => b.route_score - a.route_score);

    console.log(`🔍  Model Score : ${fraud_probability}`);
    console.log(`🧮  Effective   : ${effectiveFraudScore}`);
    console.log(`🗂️   History     : ${history.transactions24h} txns / 24h`);
    console.log(`📊  Prediction  : ${prediction === 1 ? "FRAUD" : "LEGIT"}`);

    const blocked = prediction === 1 || effectiveFraudScore > FRAUD_THRESHOLD;
    const status = blocked ? "blocked" : "approved";
    const gatewayDecision = blocked ? null : rankedGateways[0];
    const message = blocked
      ? "Transaction Blocked — High fraud risk detected."
      : `Transaction Approved — Routed to ${gatewayDecision.gateway_key}.`;

    console.log(`✅  Decision    : ${message}`);
    if (gatewayDecision) {
      console.log(`➡️   Gateway     : ${gatewayDecision.gateway_key}`);
    }
    console.log("────────────────────────────────────────\n");

    let persistence = { persisted: false, source: "disabled" };
    try {
      persistence = await insertTransaction({
        user_id,
        amount: Number(amount),
        payment_method,
        billing_country: req.body.billing_country || "IN",
        ip_country: req.body.ip_country || req.body.billing_country || "IN",
        model_prediction: prediction,
        model_fraud_score: fraud_probability,
        fraud_score: effectiveFraudScore,
        status,
        gateway: gatewayDecision ? gatewayDecision.gateway_key : null,
        routing_reason: gatewayDecision ? gatewayDecision.routing_reason : null,
        risk_adjustment_reasons: riskAdjustment.reasons,
      });
    } catch (dbError) {
      console.error("⚠️   Transaction persistence failed:", dbError.message);
    }

    let gatewayPersistence = { persisted: false, source: "disabled" };
    try {
      gatewayPersistence = await insertGatewaySnapshot(
        rankedGateways.map((gateway) => ({
          user_id,
          gateway_key: gateway.gateway_key,
          gateway_name: gateway.gateway_name,
          amount: Number(amount),
          success_rate: gateway.success_rate,
          avg_latency_ms: gateway.avg_latency_ms,
          fee_bps: gateway.fee_bps,
          health_score: gateway.health_score,
          uptime_24h: gateway.uptime_24h,
          supports_international: gateway.supports_international,
          route_score: gateway.route_score,
          selected: gatewayDecision ? gateway.gateway_key === gatewayDecision.gateway_key : false,
        }))
      );
    } catch (dbError) {
      console.error("⚠️   Gateway snapshot persistence failed:", dbError.message);
    }

    return res.json({
      status,
      fraud_score: effectiveFraudScore,
      model_fraud_score: fraud_probability,
      prediction,
      gateway: gatewayDecision ? gatewayDecision.gateway_key : null,
      gateway_name: gatewayDecision ? gatewayDecision.gateway_name : null,
      redirect_url: gatewayDecision ? `/providers/${gatewayDecision.gateway_key}` : null,
      routing_reason: gatewayDecision ? gatewayDecision.routing_reason : null,
      gateway_score: gatewayDecision ? gatewayDecision.route_score : null,
      risk_adjustment_reasons: riskAdjustment.reasons,
      history_summary: history,
      persistence,
      gateway_persistence: gatewayPersistence,
      evaluated_gateways: rankedGateways,
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
  buildGatewayResponse,
  scoreGatewayOption,
  gatewayProfiles,
};
