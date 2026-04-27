const { FRAUD_THRESHOLD, REVIEW_THRESHOLD } = require("../config");
const {
  insertRecord,
  updateRecord,
  getRecordById,
  listRecords,
  logAudit,
  getOrCreateUserProfile,
} = require("../storage");
const { evaluateFraudRisk } = require("./fraudService");
const { rankGatewayOptions } = require("./gatewayService");
const { createId } = require("../utils/ids");
const { detectCardNetwork, maskCard } = require("../utils/payment");

function buildLegacyResponse(attempt, fraudDecision, selectedGateway, gatewayEvaluations, historySummary) {
  return {
    status: attempt.status === "review_required" ? "review_required" : attempt.status,
    fraud_score: attempt.final_risk_score,
    model_fraud_score: fraudDecision.model_score,
    rule_score: fraudDecision.rule_score,
    prediction: fraudDecision.model_prediction,
    gateway: selectedGateway ? selectedGateway.gateway_key : null,
    gateway_name: selectedGateway ? selectedGateway.gateway_name : null,
    redirect_url:
      selectedGateway && attempt.status === "routed"
        ? `/providers/${selectedGateway.gateway_key}?attempt_id=${attempt.id}`
        : null,
    routing_reason: selectedGateway ? selectedGateway.routing_reason : fraudDecision.decision_reason,
    gateway_score: selectedGateway ? selectedGateway.route_score : null,
    risk_adjustment_reasons: fraudDecision.rule_reasons,
    history_summary: historySummary,
    evaluated_gateways: gatewayEvaluations,
    message: attempt.decision_summary,
    transaction: {
      id: attempt.id,
      amount: attempt.amount,
      user_id: attempt.user_id,
      customer_email: attempt.customer_email,
      customer_name: attempt.customer_name,
      payment_method: attempt.payment_method,
      order_reference: attempt.order_reference,
    },
  };
}

async function createPaymentAttempt(payment) {
  const userProfile = await getOrCreateUserProfile(payment.customer_name, payment.customer_email);
  const resolvedPayment = {
    ...payment,
    user_id: userProfile.id,
    customer_email: String(userProfile.customer_email || payment.customer_email).trim().toLowerCase(),
    customer_name: userProfile.customer_name || payment.customer_name,
    order_reference: createId("ord").toUpperCase(),
  };
  const attemptId = createId("pay");
  const baseAttempt = {
    id: attemptId,
    order_reference: resolvedPayment.order_reference,
    user_id: resolvedPayment.user_id,
    customer_name: resolvedPayment.customer_name,
    customer_email: resolvedPayment.customer_email,
    amount: resolvedPayment.amount,
    currency: resolvedPayment.currency,
    payment_method: resolvedPayment.payment_method,
    billing_country: resolvedPayment.billing_country,
    ip_country: resolvedPayment.ip_country,
    device_id: resolvedPayment.device_id,
    card_network: detectCardNetwork(resolvedPayment.card_number),
    card_last4: String(resolvedPayment.card_number).replace(/\D/g, "").slice(-4),
    masked_card: maskCard(resolvedPayment.card_number),
    status: "risk_pending",
  };

  await insertRecord("payment_attempts", baseAttempt);
  await logAudit({
    payment_attempt_id: attemptId,
    event_type: "payment_attempt_created",
    event_message: "Payment attempt was created and queued for fraud evaluation.",
  });

  const risk = await evaluateFraudRisk(resolvedPayment);
  const rankedGateways = rankGatewayOptions(resolvedPayment, risk.finalRiskScore);
  const selectedGateway = risk.decision.action === "approve_and_route" ? rankedGateways[0] : null;
  const fallbackGateways = selectedGateway ? rankedGateways.slice(1).map((item) => item.gateway_key) : [];

  const fraudDecisionRecord = {
    payment_attempt_id: attemptId,
    model_score: risk.model.model_score,
    rule_score: risk.rules.rule_score,
    final_risk_score: risk.finalRiskScore,
    model_prediction: risk.model.prediction,
    model_service_status: risk.model.service_status,
    decision_action: risk.decision.action,
    decision_reason: risk.decision.reason,
    rule_reasons: risk.rules.reasons,
    history_summary: risk.history,
    hard_threshold: FRAUD_THRESHOLD,
    review_threshold: REVIEW_THRESHOLD,
  };

  const fraudDecisionInsert = await insertRecord("fraud_decisions", fraudDecisionRecord);
  const fraudDecision = fraudDecisionInsert.record;

  const attemptStatus =
    risk.decision.action === "approve_and_route"
      ? "routed"
      : risk.decision.action === "manual_review"
        ? "review_required"
        : "blocked";

  const updatedAttempt = (
    await updateRecord("payment_attempts", attemptId, {
      status: attemptStatus,
      final_risk_score: risk.finalRiskScore,
      ml_risk_score: risk.model.model_score,
      rule_risk_score: risk.rules.rule_score,
      fraud_decision_id: fraudDecision.id,
      selected_gateway: selectedGateway ? selectedGateway.gateway_key : null,
      fallback_gateways: fallbackGateways,
      decision_summary:
        risk.decision.action === "approve_and_route"
          ? `Payment approved and routed to ${selectedGateway.gateway_name}.`
          : risk.decision.action === "manual_review"
            ? "Payment held for manual review."
            : "Payment blocked due to elevated fraud risk.",
      current_gateway_index: selectedGateway ? 0 : null,
    })
  ).record;

  await Promise.all(
    rankedGateways.map((gateway, index) =>
      insertRecord("gateway_evaluations", {
        payment_attempt_id: attemptId,
        gateway_key: gateway.gateway_key,
        gateway_name: gateway.gateway_name,
        success_rate: gateway.success_rate,
        avg_latency_ms: gateway.avg_latency_ms,
        fee_bps: gateway.fee_bps,
        health_score: gateway.health_score,
        route_score: gateway.route_score,
        supports_international: gateway.supports_international,
        selected: index === 0 && Boolean(selectedGateway),
        fallback_rank: index,
        routing_reason: gateway.routing_reason,
      })
    )
  );

  let gatewayTransaction = null;
  if (selectedGateway) {
    gatewayTransaction = (
      await insertRecord("gateway_transactions", {
        payment_attempt_id: attemptId,
        gateway_key: selectedGateway.gateway_key,
        gateway_name: selectedGateway.gateway_name,
        gateway_reference: selectedGateway.gateway_reference,
        status: "processing",
        fallback_rank: 0,
      })
    ).record;
  }

  await logAudit({
    payment_attempt_id: attemptId,
    event_type: "fraud_decision_completed",
    event_message: updatedAttempt.decision_summary,
  });

  return {
    duplicate: false,
    attempt: updatedAttempt,
    fraudDecision,
    selectedGateway,
    gatewayTransaction,
    gatewayEvaluations: rankedGateways,
    response: buildLegacyResponse(
      updatedAttempt,
      fraudDecision,
      selectedGateway,
      rankedGateways,
      risk.history
    ),
  };
}

async function listGatewayEvaluations(attemptId) {
  const { records } = await listRecords("gateway_evaluations");
  return records
    .filter((record) => record.payment_attempt_id === attemptId)
    .sort((left, right) => left.fallback_rank - right.fallback_rank);
}

async function getPaymentAttemptDetails(attemptId) {
  const attemptResult = await getRecordById("payment_attempts", attemptId);
  if (!attemptResult.record) {
    return null;
  }

  const [fraudDecisionResult, gatewayEvaluationsResult, gatewayTransactionsResult] = await Promise.all([
    getRecordById("fraud_decisions", attemptResult.record.fraud_decision_id),
    listRecords("gateway_evaluations"),
    listRecords("gateway_transactions"),
  ]);

  const gatewayEvaluations = (gatewayEvaluationsResult.records || [])
    .filter((record) => record.payment_attempt_id === attemptId)
    .sort((left, right) => left.fallback_rank - right.fallback_rank);
  const gatewayTransactions = (gatewayTransactionsResult.records || [])
    .filter((record) => record.payment_attempt_id === attemptId)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

  return {
    attempt: attemptResult.record,
    fraud_decision: fraudDecisionResult.record,
    gateway_evaluations: gatewayEvaluations,
    gateway_transactions: gatewayTransactions,
  };
}

async function completePaymentAttempt(attemptId, outcome) {
  const details = await getPaymentAttemptDetails(attemptId);
  if (!details) {
    return null;
  }

  const normalizedOutcome = ["success", "failed", "cancelled"].includes(outcome) ? outcome : "success";
  const currentGatewayIndex = Number(details.attempt.current_gateway_index || 0);
  const fallbackGateways = details.attempt.fallback_gateways || [];
  const currentGateway = details.gateway_evaluations[currentGatewayIndex] || null;

  if (currentGateway) {
    const activeGatewayTxn = details.gateway_transactions.find(
      (item) => item.gateway_key === currentGateway.gateway_key && item.status === "processing"
    );
    if (activeGatewayTxn) {
      await updateRecord("gateway_transactions", activeGatewayTxn.id, {
        status: normalizedOutcome,
      });
    }
  }

  if (normalizedOutcome === "failed" && fallbackGateways.length > currentGatewayIndex) {
    const nextIndex = currentGatewayIndex + 1;
    const nextGateway = details.gateway_evaluations[nextIndex];
    if (nextGateway) {
      await updateRecord("payment_attempts", attemptId, {
        status: "routed",
        selected_gateway: nextGateway.gateway_key,
        current_gateway_index: nextIndex,
        decision_summary: `Primary gateway failed. Payment rerouted to ${nextGateway.gateway_name}.`,
      });
      await insertRecord("gateway_transactions", {
        payment_attempt_id: attemptId,
        gateway_key: nextGateway.gateway_key,
        gateway_name: nextGateway.gateway_name,
        gateway_reference: createId(nextGateway.gateway_key),
        status: "processing",
        fallback_rank: nextIndex,
      });
      await logAudit({
        payment_attempt_id: attemptId,
        event_type: "gateway_fallback_triggered",
        event_message: `Payment rerouted to ${nextGateway.gateway_name} after failure on ${currentGateway.gateway_name}.`,
      });

      return {
        status: "rerouted",
        next_gateway: nextGateway,
        redirect_url: `/providers/${nextGateway.gateway_key}?attempt_id=${attemptId}`,
        message: `Primary gateway failed. Rerouted to ${nextGateway.gateway_name}.`,
      };
    }
  }

  const finalStatus =
    normalizedOutcome === "success"
      ? "success"
      : normalizedOutcome === "cancelled"
        ? "cancelled"
        : "failed";

  const updatedAttempt = (
    await updateRecord("payment_attempts", attemptId, {
      status: finalStatus,
      decision_summary:
        finalStatus === "success"
          ? "Payment completed successfully."
          : finalStatus === "cancelled"
            ? "Payment was cancelled by the user."
            : "Payment failed at the gateway layer.",
    })
  ).record;

  await logAudit({
    payment_attempt_id: attemptId,
    event_type: "payment_completed",
    event_message: updatedAttempt.decision_summary,
  });

  return {
    status: finalStatus,
    attempt: updatedAttempt,
    message: updatedAttempt.decision_summary,
  };
}

module.exports = {
  createPaymentAttempt,
  getPaymentAttemptDetails,
  completePaymentAttempt,
};
