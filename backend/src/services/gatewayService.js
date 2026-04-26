const { createId } = require("../utils/ids");

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
  const seed = `${gatewayKey}:${payment.user_id || "guest"}:${payment.order_reference}:${amount}`;

  const successRate = Number(
    Math.max(
      88,
      Math.min(
        99.4,
        profile.success_base +
          seededJitter(`${seed}:success`, -1.8, 1.7) +
          (isInternational && profile.supports_international ? 0.4 : 0) -
          (isInternational && !profile.supports_international ? 1.6 : 0)
      )
    ).toFixed(2)
  );
  const avgLatencyMs = Math.round(
    Math.max(120, profile.latency_base + seededJitter(`${seed}:latency`, -45, 65))
  );
  const feeBps = Number(
    Math.max(150, profile.fee_base_bps + seededJitter(`${seed}:fee`, -18, 20)).toFixed(0)
  );
  const healthScore = Number(
    Math.max(85, Math.min(99.5, profile.health_base + seededJitter(`${seed}:health`, -2.4, 2.2))).toFixed(2)
  );

  return {
    gateway_key: gatewayKey,
    gateway_name: profile.display_name,
    available: true,
    success_rate: successRate,
    avg_latency_ms: avgLatencyMs,
    fee_bps: feeBps,
    health_score: healthScore,
    supports_international: profile.supports_international,
    recommended_for: profile.strengths,
    gateway_reference: createId(gatewayKey),
  };
}

function scoreGatewayOption(gateway, payment, finalRiskScore) {
  const isInternational =
    String(payment.billing_country || "IN").toUpperCase() !==
    String(payment.ip_country || payment.billing_country || "IN").toUpperCase();
  let routeScore =
    gateway.success_rate / 100 +
    gateway.health_score / 200 -
    gateway.fee_bps / 10000 -
    gateway.avg_latency_ms / 5000;

  if (finalRiskScore < 0.25 && gateway.recommended_for.includes("low_risk")) {
    routeScore += 0.08;
  }
  if (finalRiskScore >= 0.45 && gateway.recommended_for.includes("risky")) {
    routeScore += 0.12;
  }
  if (isInternational && gateway.supports_international) {
    routeScore += 0.12;
  }
  if (Number(payment.amount) >= 4000 && gateway.recommended_for.includes("high_value")) {
    routeScore += 0.08;
  }
  if (payment.payment_method === "credit_card" && gateway.recommended_for.includes("credit_card")) {
    routeScore += 0.05;
  }

  let reason = "Balanced cost and success-rate route.";
  if (finalRiskScore >= 0.45 && gateway.recommended_for.includes("risky")) {
    reason = "Routed to a gateway better suited for elevated fraud risk.";
  } else if (isInternational && gateway.supports_international) {
    reason = "Routed for cross-border handling.";
  } else if (Number(payment.amount) >= 4000 && gateway.recommended_for.includes("high_value")) {
    reason = "Routed for higher-value authorization reliability.";
  }

  return {
    ...gateway,
    route_score: Number(routeScore.toFixed(4)),
    routing_reason: reason,
  };
}

function rankGatewayOptions(payment, finalRiskScore) {
  return Object.keys(gatewayProfiles)
    .map((gatewayKey) => buildGatewayResponse(gatewayKey, payment))
    .map((gateway) => scoreGatewayOption(gateway, payment, finalRiskScore))
    .sort((left, right) => right.route_score - left.route_score);
}

module.exports = {
  gatewayProfiles,
  rankGatewayOptions,
};
