const form = document.getElementById("paymentForm");
const resultPanel = document.getElementById("resultPanel");
const timeline = document.getElementById("timeline");
const healthBadge = document.getElementById("healthBadge");
const submitButton = document.getElementById("submitButton");
const gatewayComparison = document.getElementById("gatewayComparison");
const gatewayCards = document.getElementById("gatewayCards");
const summaryCards = document.getElementById("summaryCards");
const fraudReasons = document.getElementById("fraudReasons");
const transactionRows = document.getElementById("transactionRows");
const gatewayPerformance = document.getElementById("gatewayPerformance");
const refreshDashboardButton = document.getElementById("refreshDashboardButton");

const scenarios = {
  safe: {
    customer_name: "Aarav Sharma",
    customer_email: "aarav@example.com",
    user_id: "user_123",
    order_reference: "ORD-1001",
    amount: "1499",
    currency: "INR",
    payment_method: "credit_card",
    device_id: "device_india_01",
    card_number: "4111 1111 1111 1111",
    expiry: "12/28",
    cvv: "123",
    billing_country: "IN",
    ip_country: "IN",
  },
  review: {
    customer_name: "Neha Verma",
    customer_email: "neha@example.com",
    user_id: "user_review",
    order_reference: "ORD-2001",
    amount: "5200",
    currency: "INR",
    payment_method: "credit_card",
    device_id: "device_review_09",
    card_number: "5555 5555 5555 4444",
    expiry: "09/27",
    cvv: "572",
    billing_country: "IN",
    ip_country: "AE",
  },
  risk: {
    customer_name: "Riya Kapoor",
    customer_email: "riya@example.com",
    user_id: "user_999",
    order_reference: "ORD-9001",
    amount: "12999",
    currency: "INR",
    payment_method: "credit_card",
    device_id: "device_risk_03",
    card_number: "4000 0000 0000 1000",
    expiry: "08/27",
    cvv: "987",
    billing_country: "IN",
    ip_country: "AE",
  },
  international: {
    customer_name: "Kabir Mehta",
    customer_email: "kabir@example.com",
    user_id: "user_intl",
    order_reference: "ORD-3301",
    amount: "3200",
    currency: "INR",
    payment_method: "credit_card",
    device_id: "device_crossborder_12",
    card_number: "5555 5555 5555 4444",
    expiry: "10/29",
    cvv: "456",
    billing_country: "IN",
    ip_country: "AE",
  },
};

function formatCurrency(amount, currency = "INR") {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function setTimeline(steps) {
  timeline.innerHTML = steps
    .map(
      (step) => `
        <div class="timeline-step ${step.state || ""}">
          <span class="step-dot"></span>
          <div>
            <strong>${step.title}</strong>
            <p>${step.copy}</p>
          </div>
        </div>
      `
    )
    .join("");
}

function setFormValues(values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) {
      field.value = value;
    }
  });
}

function renderGatewayComparison(gateways) {
  if (!Array.isArray(gateways) || gateways.length === 0) {
    gatewayComparison.classList.add("hidden");
    gatewayCards.innerHTML = "";
    return;
  }

  gatewayComparison.classList.remove("hidden");
  gatewayCards.innerHTML = gateways
    .map(
      (gateway) => `
        <article class="gateway-card ${gateway.selected ? "selected" : ""}">
          <div class="card-topline">
            <h4>${gateway.gateway_name}</h4>
            <span class="gateway-rank">#${Number(gateway.fallback_rank ?? 0) + 1}</span>
          </div>
          <p class="gateway-copy">${gateway.routing_reason || "Ranked for routing."}</p>
          <dl>
            <dt>Route score</dt>
            <dd>${Number(gateway.route_score).toFixed(4)}</dd>
            <dt>Success rate</dt>
            <dd>${gateway.success_rate}%</dd>
            <dt>Latency</dt>
            <dd>${gateway.avg_latency_ms} ms</dd>
            <dt>Fee</dt>
            <dd>${gateway.fee_bps} bps</dd>
            <dt>Health</dt>
            <dd>${gateway.health_score}</dd>
            <dt>Intl support</dt>
            <dd>${gateway.supports_international ? "Yes" : "No"}</dd>
          </dl>
        </article>
      `
    )
    .join("");
}

function renderEmpty() {
  resultPanel.className = "result-panel empty";
  resultPanel.innerHTML = `
    <p class="empty-title">No payment processed yet</p>
    <p class="empty-copy">
      This panel will show the model score, rule score, final decision, and routing outcome.
    </p>
  `;
  gatewayComparison.classList.add("hidden");
  gatewayCards.innerHTML = "";
}

function renderResult(response, payment) {
  const statusClass =
    response.status === "success" || response.status === "approved" || response.status === "routed"
      ? "status-approved"
      : response.status === "review_required"
        ? "status-review"
        : "status-blocked";
  const gatewayText = response.gateway_name || response.gateway || "Not routed";
  const riskReasons =
    Array.isArray(response.risk_adjustment_reasons) && response.risk_adjustment_reasons.length
      ? response.risk_adjustment_reasons.join(", ")
      : "None";

  resultPanel.className = "result-panel";
  resultPanel.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card ${statusClass}">
        <span>Lifecycle Status</span>
        <strong>${String(response.status).replaceAll("_", " ").toUpperCase()}</strong>
      </div>
      <div class="metric-card">
        <span>Final Risk Score</span>
        <strong>${Number(response.fraud_score || 0).toFixed(4)}</strong>
      </div>
      <div class="metric-card">
        <span>Model Score</span>
        <strong>${Number(response.model_fraud_score || 0).toFixed(4)}</strong>
      </div>
      <div class="metric-card">
        <span>Rule Score</span>
        <strong>${Number(response.rule_score || 0).toFixed(4)}</strong>
      </div>
      <div class="metric-card">
        <span>Gateway</span>
        <strong>${gatewayText}</strong>
      </div>
      <div class="metric-card">
        <span>Order</span>
        <strong>${response.transaction?.order_reference || payment.order_reference}</strong>
      </div>
    </div>

    <div class="result-meta">
      <div class="meta-row">
        <span>Customer</span>
        <strong>${payment.customer_name}</strong>
      </div>
      <div class="meta-row">
        <span>Amount</span>
        <strong>${formatCurrency(payment.amount, payment.currency)}</strong>
      </div>
      <div class="meta-row">
        <span>Routing / Decision Reason</span>
        <strong>${response.routing_reason || response.message || "No gateway routing was performed."}</strong>
      </div>
      <div class="meta-row">
        <span>Risk Adjustments</span>
        <strong>${riskReasons}</strong>
      </div>
      <div class="meta-row">
        <span>Recent User History</span>
        <strong>${response.history_summary?.transactions24h || 0} transactions in the last 24h</strong>
      </div>
      <div class="meta-row">
        <span>Message</span>
        <strong>${response.message}</strong>
      </div>
    </div>
    ${
      response.redirect_url
        ? `
          <div class="redirect-wrap">
            <a href="${response.redirect_url}" class="redirect-link">
              Open ${gatewayText} hosted checkout
            </a>
            <p class="redirect-copy">Continue the flow on the simulated gateway page to complete, fail, or reroute the payment.</p>
          </div>
        `
        : ""
    }
  `;

  renderGatewayComparison(response.evaluated_gateways);
}

function renderDashboard(snapshot) {
  const summary = snapshot.summary || {};
  const cards = [
    ["Total Transactions", summary.total_transactions || 0],
    ["Approval Rate", `${Number((summary.approval_rate || 0) * 100).toFixed(1)}%`],
    ["Success Rate", `${Number((summary.success_rate || 0) * 100).toFixed(1)}%`],
    ["Review Queue", summary.review_transactions || 0],
    ["Blocked", summary.blocked_transactions || 0],
    ["Total Volume", formatCurrency(summary.total_volume || 0, "INR")],
  ];

  summaryCards.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="metric-card">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `
    )
    .join("");

  const reasons = snapshot.top_fraud_reasons || [];
  fraudReasons.innerHTML = reasons.length
    ? reasons
        .map(
          (item) => `
            <div class="reason-item">
              <span>${item.reason}</span>
              <strong>${item.count}</strong>
            </div>
          `
        )
        .join("")
    : `<p class="empty-copy">No risk reasons logged yet.</p>`;

  const gatewayCardsMarkup = snapshot.gateway_performance || [];
  gatewayPerformance.innerHTML = gatewayCardsMarkup.length
    ? gatewayCardsMarkup
        .map(
          (gateway) => `
            <article class="gateway-card">
              <div class="card-topline">
                <h4>${gateway.gateway_name}</h4>
                <span class="gateway-rank">${gateway.selected_count} selections</span>
              </div>
              <dl>
                <dt>Evaluations</dt>
                <dd>${gateway.evaluated_count}</dd>
                <dt>Average latency</dt>
                <dd>${gateway.avg_latency_ms} ms</dd>
                <dt>Average success rate</dt>
                <dd>${gateway.avg_success_rate}%</dd>
              </dl>
            </article>
          `
        )
        .join("")
    : `<p class="empty-copy">No gateway evaluations available yet.</p>`;

  const attempts = snapshot.recent_attempts || [];
  transactionRows.innerHTML = attempts.length
    ? attempts
        .map(
          (attempt) => `
            <tr>
              <td>${attempt.order_reference}</td>
              <td>${attempt.user_id}</td>
              <td><span class="table-status ${attempt.status}">${String(attempt.status).replaceAll("_", " ")}</span></td>
              <td>${attempt.selected_gateway || "-"}</td>
              <td>${Number(attempt.final_risk_score || 0).toFixed(4)}</td>
              <td>${formatCurrency(attempt.amount, attempt.currency || "INR")}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6">No transactions yet.</td></tr>`;
}

async function refreshHealth() {
  healthBadge.textContent = "Checking backend...";
  healthBadge.className = "health-pill pending";

  try {
    const response = await fetch("/health");
    if (!response.ok) {
      throw new Error("Backend unavailable");
    }

    const data = await response.json();
    healthBadge.textContent = "Backend healthy";
    healthBadge.className = "health-pill healthy";
    document.getElementById("healthMl").textContent = data.ml_service_url || "Unknown";
    document.getElementById("healthStorage").textContent = data.storage?.active_driver || "Unknown";
    document.getElementById("healthThreshold").textContent = data.fraud_threshold;
    document.getElementById("healthReview").textContent = data.review_threshold;
  } catch (_error) {
    healthBadge.textContent = "Backend offline";
    healthBadge.className = "health-pill unhealthy";
    document.getElementById("healthMl").textContent = "Unavailable";
    document.getElementById("healthStorage").textContent = "Unavailable";
  }
}

async function refreshDashboard() {
  refreshDashboardButton.disabled = true;
  try {
    const response = await fetch("/api/dashboard/summary");
    if (!response.ok) {
      throw new Error("Dashboard unavailable");
    }
    const data = await response.json();
    renderDashboard(data);
  } catch (_error) {
    summaryCards.innerHTML = `<p class="empty-copy">Dashboard metrics could not be loaded.</p>`;
  } finally {
    refreshDashboardButton.disabled = false;
  }
}

document.querySelectorAll(".scenario-btn").forEach((button) => {
  button.addEventListener("click", () => {
    setFormValues(scenarios[button.dataset.scenario]);
  });
});

document.querySelectorAll(".tab-btn").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view-pane").forEach((pane) => pane.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(`view-${button.dataset.view}`).classList.add("active");
  });
});

refreshDashboardButton.addEventListener("click", refreshDashboard);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payment = Object.fromEntries(formData.entries());
  const payload = {
    ...payment,
    amount: Number(payment.amount),
  };

  submitButton.disabled = true;
  submitButton.textContent = "Creating payment...";

  setTimeline([
    {
      title: "Payment attempt created",
      copy: "The merchant backend is validating the order and creating a payment attempt.",
      state: "active",
    },
    {
      title: "Fraud scoring in progress",
      copy: "ML scoring and rule evaluation are being combined into a final risk decision.",
      state: "",
    },
    {
      title: "Routing or review decision pending",
      copy: "Approved payments will be routed. Medium risk will move to review. High risk will be blocked.",
      state: "",
    },
  ]);

  try {
    const response = await fetch("/api/payments/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.details ? data.details.join(", ") : data.error || "Payment processing failed");
    }

    const decisionState =
      data.status === "blocked" ? "blocked" : data.status === "review_required" ? "review" : "success";
    const stepThreeCopy =
      data.status === "routed"
        ? `${data.gateway_name || data.gateway} was selected as the best gateway.`
        : data.status === "review_required"
          ? "The payment was moved to a manual review state before gateway processing."
          : "The payment was blocked before gateway routing.";

    setTimeline([
      {
        title: "Payment attempt created",
        copy: `Order ${data.transaction?.order_reference} is now tracked as a backend payment attempt.`,
        state: "success",
      },
      {
        title: "Fraud scoring complete",
        copy: `Model score ${Number(data.model_fraud_score || 0).toFixed(4)}, rule score ${Number(
          data.rule_score || 0
        ).toFixed(4)}, final risk ${Number(data.fraud_score || 0).toFixed(4)}.`,
        state: decisionState === "blocked" ? "blocked" : decisionState === "review" ? "review" : "success",
      },
      {
        title:
          data.status === "routed"
            ? "Gateway selected"
            : data.status === "review_required"
              ? "Manual review required"
              : "Payment blocked",
        copy: stepThreeCopy,
        state: decisionState,
      },
    ]);

    renderResult(data, payment);
    refreshDashboard();
  } catch (error) {
    setTimeline([
      {
        title: "Processing error",
        copy: error.message,
        state: "error",
      },
    ]);

    resultPanel.className = "result-panel";
    resultPanel.innerHTML = `
      <div class="metric-card status-blocked">
        <span>Request Failed</span>
        <strong>Backend or dependency unavailable</strong>
      </div>
      <div class="result-meta" style="margin-top:16px">
        <div class="meta-row">
          <span>Error</span>
          <strong>${error.message}</strong>
        </div>
      </div>
    `;
    gatewayComparison.classList.add("hidden");
    gatewayCards.innerHTML = "";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Evaluate, Route, and Create Payment";
  }
});

renderEmpty();
setFormValues(scenarios.safe);
refreshHealth();
refreshDashboard();
