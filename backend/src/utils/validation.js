const { normalizeCountry, sanitizeAmount } = require("./payment");

function validateCheckoutPayload(payload = {}) {
  const errors = [];
  const amount = sanitizeAmount(payload.amount);

  if (!payload.customer_name || String(payload.customer_name).trim().length < 2) {
    errors.push("customer_name is required");
  }

  if (!payload.user_id || String(payload.user_id).trim().length < 3) {
    errors.push("user_id is required");
  }

  if (!payload.order_reference || String(payload.order_reference).trim().length < 3) {
    errors.push("order_reference is required");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push("amount must be greater than zero");
  }

  if (!payload.payment_method) {
    errors.push("payment_method is required");
  }

  if (!payload.card_number || String(payload.card_number).replace(/\D/g, "").length < 12) {
    errors.push("card_number looks invalid");
  }

  if (!payload.expiry) {
    errors.push("expiry is required");
  }

  if (!payload.cvv || String(payload.cvv).trim().length < 3) {
    errors.push("cvv looks invalid");
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      customer_name: String(payload.customer_name || "").trim(),
      customer_email: String(payload.customer_email || "").trim(),
      user_id: String(payload.user_id || "").trim(),
      order_reference: String(payload.order_reference || "").trim(),
      amount,
      currency: String(payload.currency || "INR").trim().toUpperCase(),
      payment_method: String(payload.payment_method || "").trim(),
      billing_country: normalizeCountry(payload.billing_country),
      ip_country: normalizeCountry(payload.ip_country, payload.billing_country),
      card_number: String(payload.card_number || "").trim(),
      expiry: String(payload.expiry || "").trim(),
      cvv: String(payload.cvv || "").trim(),
      device_id: String(payload.device_id || "").trim(),
    },
  };
}

module.exports = {
  validateCheckoutPayload,
};
