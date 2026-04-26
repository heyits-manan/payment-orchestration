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

function buildFeatureVector(amount, userId, paymentMethod, billingCountry = "IN", ipCountry = "IN") {
  let hash = 0;
  for (const ch of String(userId)) {
    hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  }

  const pseudoRandom = (index) => {
    const x = Math.sin(hash + index) * 10000;
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

  for (let i = 1; i <= 28; i += 1) {
    features[i] =
      (pseudoRandom(i) - 0.5) * 4 +
      amountRiskBoost * (i % 3 === 0 ? -1.25 : 0.85) +
      methodCode * 0.1 * (i % 5 === 0 ? 1 : 0) +
      (isInternational ? (i % 4 === 0 ? -2.2 : 1.1) : 0);
  }

  return features;
}

module.exports = {
  sanitizeAmount,
  normalizeCountry,
  detectCardNetwork,
  maskCard,
  buildFeatureVector,
};
