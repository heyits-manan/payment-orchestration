const axios = require("axios");
const { ML_SERVICE_URL, FRAUD_THRESHOLD, REVIEW_THRESHOLD } = require("../config");
const { fetchUserTransactionSummary } = require("../storage");
const { buildFeatureVector } = require("../utils/payment");

function calculateRiskAdjustments(payment, history = {}) {
  const amount = Number(payment.amount) || 0;
  const billingCountry = String(payment.billing_country || "IN").toUpperCase();
  const ipCountry = String(payment.ip_country || billingCountry).toUpperCase();
  const avgAmount = Number(history.avgAmount || history.successfulAvgAmount || 0);

  let adjustment = 0;
  const reasons = [];

  if (amount >= 10000) {
    adjustment += 0.28;
    reasons.push("very high transaction amount");
  } else if (amount >= 5000) {
    adjustment += 0.15;
    reasons.push("above-normal transaction amount");
  }

  if (billingCountry !== ipCountry) {
    adjustment += 0.22;
    reasons.push("billing and IP country mismatch");
  }

  if (String(payment.payment_method) === "credit_card") {
    adjustment += 0.03;
  }

  if (history.transactions24h >= 5) {
    adjustment += 0.12;
    reasons.push("high transaction velocity in the last 24 hours");
  }

  if (history.blocked24h >= 2) {
    adjustment += 0.18;
    reasons.push("multiple blocked attempts in the last 24 hours");
  }

  if (history.failed24h >= 3) {
    adjustment += 0.08;
    reasons.push("multiple failed attempts in the last 24 hours");
  }

  if (
    history.paymentMethods &&
    history.paymentMethods.length > 0 &&
    !history.paymentMethods.includes(payment.payment_method)
  ) {
    adjustment += 0.08;
    reasons.push("new payment method for the user");
  }

  if (
    payment.device_id &&
    history.devices &&
    history.devices.length > 0 &&
    !history.devices.includes(payment.device_id)
  ) {
    adjustment += 0.06;
    reasons.push("new device identifier for the user");
  }

  if (avgAmount > 0 && amount >= avgAmount * 5) {
    adjustment += 0.18;
    reasons.push("amount much higher than user average");
  } else if (avgAmount > 0 && amount >= avgAmount * 2) {
    adjustment += 0.1;
    reasons.push("amount above user average");
  }

  if (
    history.billingCountries &&
    history.billingCountries.length > 0 &&
    !history.billingCountries.includes(billingCountry)
  ) {
    adjustment += 0.08;
    reasons.push("new billing country for user");
  }

  if (
    history.ipCountries &&
    history.ipCountries.length > 0 &&
    !history.ipCountries.includes(ipCountry)
  ) {
    adjustment += 0.08;
    reasons.push("new IP country for user");
  }

  return {
    rule_score: Number(Math.min(0.95, adjustment).toFixed(4)),
    reasons,
  };
}

async function fetchModelScore(features) {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/predict`,
      { features },
      { timeout: 4000 }
    );
    return {
      available: true,
      prediction: Number(response.data.prediction || 0),
      model_score: Number(response.data.fraud_probability || 0),
      service_status: "online",
    };
  } catch (_error) {
    return {
      available: false,
      prediction: 0,
      model_score: 0,
      service_status: "offline_rules_only",
    };
  }
}

function deriveDecision(finalRiskScore, modelPrediction) {
  if (modelPrediction === 1 || finalRiskScore >= FRAUD_THRESHOLD) {
    return {
      status: "blocked",
      action: "block",
      reason: "Fraud risk exceeded the hard threshold.",
    };
  }

  if (finalRiskScore >= REVIEW_THRESHOLD) {
    return {
      status: "review_required",
      action: "manual_review",
      reason: "Fraud risk fell into the manual review band.",
    };
  }

  return {
    status: "approved",
    action: "approve_and_route",
    reason: "Fraud risk is within the auto-approval band.",
  };
}

async function evaluateFraudRisk(payment) {
  const history = await fetchUserTransactionSummary(payment.user_id);
  const features = buildFeatureVector(
    payment.amount,
    payment.user_id,
    payment.payment_method,
    payment.billing_country,
    payment.ip_country
  );
  const model = await fetchModelScore(features);
  const rules = calculateRiskAdjustments(payment, history);
  const finalRiskScore = Number(Math.min(0.99, model.model_score + rules.rule_score).toFixed(4));
  const decision = deriveDecision(finalRiskScore, model.prediction);

  return {
    history,
    features,
    model,
    rules,
    finalRiskScore,
    decision,
  };
}

module.exports = {
  evaluateFraudRisk,
};
