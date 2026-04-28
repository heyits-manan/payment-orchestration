const axios = require("axios");
const { ML_SERVICE_URL, FRAUD_THRESHOLD, REVIEW_THRESHOLD } = require("../config");
const { fetchUserTransactionSummary } = require("../storage");
const { buildOnlinePaymentFeatures } = require("../utils/payment");

const REVIEW_AMOUNT_THRESHOLD = 1000000;
const HARD_BLOCK_AMOUNT_THRESHOLD = 5100000;
const FIRST_TRANSACTION_REVIEW_AMOUNT_THRESHOLD = 2000000;
const FIRST_TRANSACTION_BLOCK_AMOUNT_THRESHOLD = 5100000;

function emptyHistoryStats() {
  return {
    transactions: 0,
    blocked: 0,
    review: 0,
    failed: 0,
    success: 0,
    high_risk: 0,
  };
}

function getHistoryStats(stats, key) {
  const normalizedKey = String(key || "").trim().toUpperCase();
  if (!stats || !normalizedKey || !stats[normalizedKey]) {
    return emptyHistoryStats();
  }
  return {
    ...emptyHistoryStats(),
    ...stats[normalizedKey],
  };
}

function getPaymentCardLast4(payment = {}) {
  return String(payment.card_number || payment.card_last4 || "").replace(/\D/g, "").slice(-4);
}

function calculateRiskAdjustments(payment, history = {}) {
  const amount = Number(payment.amount) || 0;
  const billingCountry = String(payment.billing_country || "IN").toUpperCase();
  const ipCountry = String(payment.ip_country || billingCountry).toUpperCase();
  const paymentMethod = String(payment.payment_method || "");
  const deviceId = String(payment.device_id || "");
  const cardLast4 = getPaymentCardLast4(payment);
  const baselineAmount = Number(
    history.baselineAmount || history.medianAmount || history.successfulAvgAmount || history.avgAmount || 0
  );
  const baselineCount = Number(history.baselineTransactionCount || 0);
  const historicalTransactions = Number(history.historicalTransactions || 0);
  const blocked24h = Number(history.blocked24h || 0);
  const review24h = Number(history.review24h || 0);
  const failed24h = Number(history.failed24h || 0);
  const blocked3h = Number(history.blocked3h || 0);
  const review3h = Number(history.review3h || 0);
  const riskyDecisions24h = Number(history.riskyDecisions24h || 0);
  const riskyDecisions3h = Number(history.riskyDecisions3h || 0);
  const riskyDecisionRate = Number(history.riskyDecisionRate || 0);
  const isFirstCompletedTransaction = historicalTransactions === 0;
  const isLargeFirstTransaction = isFirstCompletedTransaction && amount >= FIRST_TRANSACTION_REVIEW_AMOUNT_THRESHOLD;
  const isVeryLargeFirstTransaction = isFirstCompletedTransaction && amount >= FIRST_TRANSACTION_BLOCK_AMOUNT_THRESHOLD;
  const isPlatformHighValue = amount >= REVIEW_AMOUNT_THRESHOLD;
  const isPlatformExtremeValue = amount >= HARD_BLOCK_AMOUNT_THRESHOLD;
  const countryMismatch = billingCountry !== ipCountry;
  const newPaymentMethod =
    history.paymentMethods &&
    history.paymentMethods.length > 0 &&
    !history.paymentMethods.includes(paymentMethod);
  const newDevice =
    deviceId &&
    history.devices &&
    history.devices.length > 0 &&
    !history.devices.includes(deviceId);
  const newCard =
    cardLast4 &&
    history.cardLast4s &&
    history.cardLast4s.length > 0 &&
    !history.cardLast4s.includes(cardLast4);
  const hasBehaviorBaseline = baselineCount >= 3 && baselineAmount > 0;
  const elevatedAmount = hasBehaviorBaseline && amount >= baselineAmount * 2;
  const unusualAmount = hasBehaviorBaseline && amount >= baselineAmount * 3;
  const extremeAmount = hasBehaviorBaseline && amount >= baselineAmount * 5;
  const rapidVelocity = Number(history.previousTransactions1h || 0) >= 5;
  const shortWindowVelocity = Number(history.previousTransactions3h || 0) >= 5;
  const dailyVelocity = Number(history.previousTransactions24h || 0) >= 5;
  const deviceChurn3h = Number(history.uniqueDevices3h || 0) >= 2;
  const severeDeviceChurn3h = Number(history.uniqueDevices3h || 0) >= 3;
  const ipCountryChurn3h = Number(history.uniqueIpCountries3h || 0) >= 2;
  const repeatedCountryMismatch3h = Number(history.countryMismatch3h || 0) >= 2;
  const highValueBurst3h = Number(history.highValueTransactions3h || 0) >= 2;
  const highValueBurst = Number(history.highValueTransactions24h || 0) >= 2;
  const cardHistory24h = getHistoryStats(history.cardLast4Stats24h, cardLast4);
  const deviceHistory24h = getHistoryStats(history.deviceStats24h, deviceId);
  const paymentMethodHistory24h = getHistoryStats(history.paymentMethodStats24h, paymentMethod);
  const billingCountryHistory24h = getHistoryStats(history.billingCountryStats24h, billingCountry);
  const ipCountryHistory24h = getHistoryStats(history.ipCountryStats24h, ipCountry);

  let adjustment = 0;
  const reasons = [];
  const hardBlockSignals = [];
  const reviewSignals = [];

  if (isPlatformExtremeValue) {
    adjustment += 0.45;
    reasons.push("transaction amount is above the platform hard-risk limit");
    hardBlockSignals.push("extreme transaction amount");
  } else if (isPlatformHighValue) {
    adjustment += 0.28;
    reasons.push("transaction amount is above the platform manual-review limit");
    reviewSignals.push("high absolute transaction amount");
  }

  if (isVeryLargeFirstTransaction) {
    adjustment += 0.25;
    reasons.push("first completed transaction is very large");
    hardBlockSignals.push("very large first transaction");
  } else if (isLargeFirstTransaction) {
    adjustment += 0.16;
    reasons.push("first completed transaction is high value");
    reviewSignals.push("high-value first transaction");
  }

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

  if (paymentMethod === "credit_card") {
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

  if (blocked24h >= 5) {
    adjustment += 0.24;
    reasons.push("multiple blocked attempts in the last 24 hours");
    hardBlockSignals.push("repeat blocked history");
  } else if (blocked24h === 1) {
    adjustment += 0.14;
    reasons.push("a blocked attempt already exists in the last 24 hours");
    reviewSignals.push("recent blocked history");
  } else if (blocked24h >= 2) {
    adjustment += 0.18;
    reasons.push("multiple blocked attempts in the last 24 hours");
    reviewSignals.push("repeat blocked history");
  }

  if (review24h >= 3) {
    adjustment += 0.16;
    reasons.push("multiple manual-review decisions in the last 24 hours");
    reviewSignals.push("repeat manual review history");
  }

  if (riskyDecisions24h >= 5) {
    adjustment += 0.2;
    reasons.push("several high-risk decisions were recorded for this user in the last 24 hours");
    reviewSignals.push("repeated high-risk history");
  }

  if (failed24h >= 3) {
    adjustment += 0.12;
    reasons.push("multiple failed attempts in the last 24 hours");
    reviewSignals.push("repeated failed attempts");
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

  if (newCard) {
    adjustment += 0.08;
    reasons.push("new card fingerprint for the user");
    reviewSignals.push("new card");
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

  if (cardHistory24h.transactions >= 3) {
    adjustment += 0.1;
    reasons.push("same card fingerprint was used several times in the last 24 hours");
    reviewSignals.push("same-card transaction burst");
  }

  if (cardHistory24h.high_risk >= 5) {
    adjustment += 0.22;
    reasons.push("same card fingerprint has repeated high-risk decisions");
    hardBlockSignals.push("same card repeatedly held or blocked");
  } else if (cardHistory24h.high_risk >= 1) {
    adjustment += 0.12;
    reasons.push("same card fingerprint had a recent high-risk decision");
    reviewSignals.push("same-card high-risk history");
  }

  if (deviceHistory24h.high_risk >= 5) {
    adjustment += 0.2;
    reasons.push("same device has repeated high-risk decisions");
    hardBlockSignals.push("same device repeatedly held or blocked");
  } else if (deviceHistory24h.high_risk >= 1) {
    adjustment += 0.1;
    reasons.push("same device had a recent high-risk decision");
    reviewSignals.push("same-device high-risk history");
  }

  if (deviceHistory24h.failed >= 3 || cardHistory24h.failed >= 3) {
    adjustment += 0.12;
    reasons.push("same card or device has repeated failed attempts");
    reviewSignals.push("same instrument failure pattern");
  }

  if (paymentMethodHistory24h.high_risk >= 5) {
    adjustment += 0.08;
    reasons.push("this payment method has recent high-risk history for the user");
    reviewSignals.push("payment method high-risk history");
  }

  if (billingCountryHistory24h.high_risk >= 5 || ipCountryHistory24h.high_risk >= 5) {
    adjustment += 0.1;
    reasons.push("this country pattern has recent high-risk history for the user");
    reviewSignals.push("country high-risk history");
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

  if (riskyDecisions3h >= 5 && (rapidVelocity || shortWindowVelocity)) {
    hardBlockSignals.push("repeated high-risk velocity pattern");
  }

  if (blocked3h >= 3 && review3h >= 3 && (countryMismatch || newDevice || unusualAmount)) {
    hardBlockSignals.push("mixed blocked and review history with new risk signal");
  }

  if (
    historicalTransactions >= 6 &&
    riskyDecisionRate >= 0.7 &&
    (countryMismatch || newDevice || unusualAmount || rapidVelocity)
  ) {
    hardBlockSignals.push("high historical fraud decision rate");
  }

  if (cardHistory24h.high_risk >= 5 && countryMismatch && (newDevice || unusualAmount || rapidVelocity)) {
    hardBlockSignals.push("same-card high-risk cross-border pattern");
  }

  if (deviceHistory24h.high_risk >= 5 && unusualAmount && (countryMismatch || newPaymentMethod)) {
    hardBlockSignals.push("same-device high-risk high-value pattern");
  }

  if (countryMismatch && newDevice) {
    reviewSignals.push("mismatch from new device");
  }

  return {
    rule_score: Number(Math.min(0.95, adjustment).toFixed(4)),
    reasons,
    hard_block_signals: [...new Set(hardBlockSignals)],
    review_signals: [...new Set(reviewSignals)],
    previous_transactions_24h: Number(history.previousTransactions24h || 0),
  };
}

async function fetchModelScore(features) {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/predict`,
      features,
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

function deriveDecision(finalRiskScore, modelPrediction, modelAvailable, rules, modelScore = 0) {
  const blockReasons = [];
  if (modelPrediction === 1) {
    blockReasons.push(`ML model predicted fraud with score ${Number(modelScore || 0).toFixed(4)}`);
  }
  if (Number(modelScore || 0) >= FRAUD_THRESHOLD) {
    blockReasons.push("ML score exceeded the hard threshold");
  }
  if (rules.hard_block_signals.length > 0) {
    blockReasons.push(`hard rules matched: ${rules.hard_block_signals.join(", ")}`);
  }
  if (
    finalRiskScore >= 0.92 &&
    rules.review_signals.length >= 4 &&
    Number(rules.previous_transactions_24h || 0) >= 5 &&
    (modelAvailable || rules.review_signals.length >= 6)
  ) {
    blockReasons.push("extreme combined risk from multiple independent review signals");
  }

  if (blockReasons.length > 0) {
    return {
      status: "blocked",
      action: "block",
      reason: `Blocked because ${blockReasons.join("; ")}.`,
    };
  }

  const reviewReasons = [];
  if (finalRiskScore >= REVIEW_THRESHOLD) {
    reviewReasons.push("fraud risk fell into the manual review band");
  }
  if (finalRiskScore >= FRAUD_THRESHOLD) {
    reviewReasons.push("combined risk crossed the hard threshold without a hard-block signal");
  }
  if (rules.review_signals.length >= 2) {
    reviewReasons.push(`review rules matched: ${rules.review_signals.join(", ")}`);
  }
  if (!modelAvailable && finalRiskScore >= 0.45) {
    reviewReasons.push("ML service was unavailable and rules-only risk is elevated");
  }

  if (reviewReasons.length > 0) {
    return {
      status: "review_required",
      action: "manual_review",
      reason: `Held for manual review because ${reviewReasons.join("; ")}.`,
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
  const features = buildOnlinePaymentFeatures(
    payment.amount,
    payment.user_id,
    payment.payment_method,
    payment.billing_country,
    payment.ip_country
  );
  const model = await fetchModelScore(features);
  const rules = calculateRiskAdjustments(payment, history);
  const finalRiskScore = Number(Math.min(0.99, model.model_score + rules.rule_score).toFixed(4));
  const decision = deriveDecision(finalRiskScore, model.prediction, model.available, rules, model.model_score);

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
