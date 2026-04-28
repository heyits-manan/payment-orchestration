function sanitizeAmount(amount) {
  return Number(Number(amount || 0).toFixed(2));
}

function normalizeCountry(value, fallback = "IN") {
  return String(value || fallback).trim().toUpperCase();
}

function detectCardNetwork(cardNumber = "") {
  const digits = String(cardNumber).replace(/\D/g, "");
  if (digits.startsWith("4")) {
    return "visa";
  }
  if (/^5[1-5]/.test(digits) || /^2(2[2-9]|[3-6]|7[01]|720)/.test(digits)) {
    return "mastercard";
  }
  if (/^3[47]/.test(digits)) {
    return "amex";
  }
  if (/^6(?:011|5)/.test(digits)) {
    return "discover";
  }
  return "unknown";
}

function maskCard(cardNumber = "") {
  const digits = String(cardNumber).replace(/\D/g, "");
  if (!digits) {
    return "••••";
  }
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

function buildOnlinePaymentFeatures(amount, userId, paymentMethod, billingCountry = "IN", ipCountry = "IN") {
  const numericAmount = Number(amount) || 0;
  let hash = 0;
  for (const ch of String(userId)) {
    hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  }

  const pseudoRandom = (index) => {
    const x = Math.sin(hash + index) * 10000;
    return x - Math.floor(x);
  };

  const isInternational =
    String(billingCountry).toUpperCase() !== String(ipCountry).toUpperCase();
  const normalizedMethod = String(paymentMethod || "").toLowerCase();
  const type =
    normalizedMethod === "net_banking" || isInternational || numericAmount >= 100000
      ? "TRANSFER"
      : "PAYMENT";
  const balanceMultiplier = 1.05 + pseudoRandom(2) * 2.5;
  const oldbalanceOrg = Math.max(numericAmount, numericAmount * balanceMultiplier);
  const newbalanceOrig =
    type === "TRANSFER" && (isInternational || numericAmount >= 100000)
      ? 0
      : Math.max(0, oldbalanceOrg - numericAmount);
  const oldbalanceDest =
    type === "TRANSFER"
      ? Math.round(numericAmount * (0.25 + pseudoRandom(3) * 1.5) * 100) / 100
      : 0;
  const newbalanceDest =
    type === "TRANSFER" ? Math.max(0, oldbalanceDest + numericAmount) : oldbalanceDest;

  return {
    step: Math.max(1, Math.floor((Date.now() / (60 * 60 * 1000)) % 744)),
    type,
    amount: numericAmount,
    nameOrig: `C${Math.abs(hash)}`,
    oldbalanceOrg: Number(oldbalanceOrg.toFixed(2)),
    newbalanceOrig: Number(newbalanceOrig.toFixed(2)),
    nameDest: type === "TRANSFER" ? `C${Math.abs(hash + 17)}` : `M${Math.abs(hash + 17)}`,
    oldbalanceDest: Number(oldbalanceDest.toFixed(2)),
    newbalanceDest: Number(newbalanceDest.toFixed(2)),
    isFlaggedFraud: numericAmount >= 200000 ? 1 : 0,
  };
}

module.exports = {
  sanitizeAmount,
  normalizeCountry,
  detectCardNetwork,
  maskCard,
  buildOnlinePaymentFeatures,
};
