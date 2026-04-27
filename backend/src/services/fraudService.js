const axios = require("axios");
const { ML_SERVICE_URL, FRAUD_THRESHOLD, REVIEW_THRESHOLD } = require("../config");
const { fetchUserTransactionSummary } = require("../storage");
const { buildFeatureVector } = require("../utils/payment");

function calculateRiskAdjustments(payment, history = {}) {
  const amount = Number(payment.amount) || 0;
  const billingCountry = String(payment.billing_country || "IN").toUpperCase();
  const ipCountry = String(payment.ip_country || billingCountry).toUpperCase();
  const baselineAmount = Number(
    history.baselineAmount || history.medianAmount || history.successfulAvgAmount || history.avgAmount || 0
  );
  const baselineCount = Number(history.baselineTransactionCount || 0);
  const countryMismatch = billingCountry !== ipCountry;
  const newPaymentMethod =
    history.paymentMethods &&
    history.paymentMethods.length > 0 &&
    !history.paymentMethods.includes(payment.payment_method);
  const newDevice =
    payment.device_id &&
    history.devices &&
    history.devices.length > 0 &&
    !history.devices.includes(payment.device_id);
  const hasBehaviorBaseline = baselineCount >= 3 && baselineAmount > 0;
  const elevatedAmount = hasBehaviorBaseline && amount >= baselineAmount * 2;
  const unusualAmount = hasBehaviorBaseline && amount >= baselineAmount * 3;
  const extremeAmount = hasBehaviorBaseline && amount >= baselineAmount * 5;
  const rapidVelocity = Number(history.transactions1h || 0) >= 3;
  const shortWindowVelocity = Number(history.transactions3h || 0) >= 4;
  const dailyVelocity = Number(history.transactions24h || 0) >= 6;
  const deviceChurn3h = Number(history.uniqueDevices3h || 0) >= 2;
  const severeDeviceChurn3h = Number(history.uniqueDevices3h || 0) >= 3;
  const ipCountryChurn3h = Number(history.uniqueIpCountries3h || 0) >= 2;
  const repeatedCountryMismatch3h = Number(history.countryMismatch3h || 0) >= 2;
  const highValueBurst3h = Number(history.highValueTransactions3h || 0) >= 2;
  const highValueBurst = Number(history.highValueTransactions24h || 0) >= 2;

  let adjustment = 0;
  const reasons = [];
  const hardBlockSignals = [];
  const reviewSignals = [];

  if (extremeAmount) {
    adjustment += 0.28;
    reasons.push("transaction amount is far above the user's normal pattern");
    reviewSignals.push("amount far above user baseline");
  } else if (unusualAmount) {
    adjustment += 0.22;
    reasons.push("transaction amount is much higher than the user's average");
    reviewSignals.push("amount well above user baseline");
  } else if (elevatedAmount) {
    adjustment += 0.12;
    reasons.push("transaction amount is above the user's average");
  }

  if (countryMismatch) {
    adjustment += 0.3;
    reasons.push("billing and IP country mismatch");
    reviewSignals.push("country mismatch");
  }

  if (String(payment.payment_method) === "credit_card") {
    adjustment += 0.03;
  }

  if (rapidVelocity) {
    adjustment += 0.18;
    reasons.push("rapid transaction velocity in the last hour");
    reviewSignals.push("rapid transaction velocity");
  } else if (shortWindowVelocity) {
    adjustment += 0.16;
    reasons.push("sudden transaction increase in the last 3 hours");
    reviewSignals.push("3-hour transaction velocity");
  } else if (dailyVelocity) {
    adjustment += 0.14;
    reasons.push("high transaction velocity in the last 24 hours");
    reviewSignals.push("daily transaction velocity");
  }

  if (history.blocked24h >= 2) {
    adjustment += 0.24;
    reasons.push("multiple blocked attempts in the last 24 hours");
    hardBlockSignals.push("repeat blocked history");
  }

  if (history.failed24h >= 3) {
    adjustment += 0.12;
    reasons.push("multiple failed attempts in the last 24 hours");
  }

  if (newPaymentMethod) {
    adjustment += 0.1;
    reasons.push("new payment method for the user");
    reviewSignals.push("new payment method");
  }

  if (newDevice) {
    adjustment += 0.1;
    reasons.push("new device identifier for the user");
    reviewSignals.push("new device");
  }

  if (deviceChurn3h) {
    adjustment += 0.14;
    reasons.push("multiple devices used in the last 3 hours");
    reviewSignals.push("recent device changes");
  }

  if (ipCountryChurn3h) {
    adjustment += 0.12;
    reasons.push("multiple IP countries seen in the last 3 hours");
    reviewSignals.push("recent IP country changes");
  }

  if (highValueBurst3h) {
    adjustment += 0.22;
    reasons.push("multiple unusually large transactions in the last 3 hours");
    reviewSignals.push("3-hour high-value transaction burst");
  } else if (highValueBurst) {
    adjustment += 0.2;
    reasons.push("multiple unusually large transactions in the last 24 hours");
    reviewSignals.push("high-value transaction burst");
  }

  if (
    history.billingCountries &&
    history.billingCountries.length > 0 &&
    !history.billingCountries.includes(billingCountry)
  ) {
    adjustment += 0.1;
    reasons.push("new billing country for user");
    reviewSignals.push("new billing country");
  }

  if (
    history.ipCountries &&
    history.ipCountries.length > 0 &&
    !history.ipCountries.includes(ipCountry)
  ) {
    adjustment += 0.1;
    reasons.push("new IP country for user");
    reviewSignals.push("new IP country");
  }

  if (unusualAmount && highValueBurst) {
    hardBlockSignals.push("sudden burst of unusually large transactions");
  }

  if (extremeAmount && (rapidVelocity || shortWindowVelocity)) {
    hardBlockSignals.push("rapid high-value transaction spike");
  }

  if (countryMismatch && unusualAmount && (rapidVelocity || shortWindowVelocity || highValueBurst3h || highValueBurst)) {
    hardBlockSignals.push("unusual high-value cross-border pattern");
  }

  if (countryMismatch && newDevice && unusualAmount && shortWindowVelocity) {
    hardBlockSignals.push("new device cross-border high-value velocity pattern");
  }

  if (repeatedCountryMismatch3h && highValueBurst3h) {
    hardBlockSignals.push("repeated country mismatches with high-value burst");
  }

  if (severeDeviceChurn3h && shortWindowVelocity) {
    hardBlockSignals.push("rapid transactions across multiple devices");
  }

  if (countryMismatch && newDevice) {
    reviewSignals.push("mismatch from new device");
  }

  return {
    rule_score: Number(Math.min(0.95, adjustment).toFixed(4)),
    reasons,
    hard_block_signals: [...new Set(hardBlockSignals)],
    review_signals: [...new Set(reviewSignals)],
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

function deriveDecision(finalRiskScore, modelPrediction, modelAvailable, rules) {
  if (modelPrediction === 1 || finalRiskScore >= FRAUD_THRESHOLD || rules.hard_block_signals.length > 0) {
    return {
      status: "blocked",
      action: "block",
      reason:
        rules.hard_block_signals.length > 0
          ? `Blocked by fraud rules: ${rules.hard_block_signals.join(", ")}.`
          : "Fraud risk exceeded the hard threshold.",
    };
  }

  if (
    finalRiskScore >= REVIEW_THRESHOLD ||
    rules.review_signals.length >= 2 ||
    (!modelAvailable && finalRiskScore >= 0.45)
  ) {
    return {
      status: "review_required",
      action: "manual_review",
      reason:
        rules.review_signals.length >= 2
          ? `Held for manual review: ${rules.review_signals.join(", ")}.`
          : "Fraud risk fell into the manual review band.",
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
  const decision = deriveDecision(finalRiskScore, model.prediction, model.available, rules);

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
