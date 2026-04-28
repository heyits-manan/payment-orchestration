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

function formatCurrency(amount, currency = "INR") {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function shortId(value = "") {
  const text = String(value || "");
  return text.length > 14 ? `${text.slice(0, 10)}...` : text || "-";
}

function setTimeline(steps) {
  timeline.innerHTML = steps
    .map(
      (step) => `
        <div class="timeline-step ${step.state || ""}">
          <span class="step-dot"></span>
          <div>
            <strong>${step.title}</strong>
            ${step.copy ? `<p>${step.copy}</p>` : ""}
          </div>
        </div>
      `
    )
    .join("");
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
          <dl>
            <dt>Score</dt>
            <dd>${Number(gateway.route_score).toFixed(4)}</dd>
            <dt>Success</dt>
            <dd>${gateway.success_rate}%</dd>
            <dt>Latency</dt>
            <dd>${gateway.avg_latency_ms} ms</dd>
            <dt>Fee</dt>
            <dd>${gateway.fee_bps} bps</dd>
          </dl>
        </article>
      `
    )
    .join("");
}

function renderEmpty() {
  resultPanel.className = "result-panel empty";
  resultPanel.innerHTML = `
    <p class="empty-title">No payment yet</p>
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
      ? response.risk_adjustment_reasons.slice(0, 2).join(", ")
      : "None";
  const decisionReason = response.routing_reason || response.message || "No routing performed.";

  resultPanel.className = "result-panel";
  resultPanel.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card ${statusClass}">
        <span>Lifecycle Status</span>
        <strong>${String(response.status).replaceAll("_", " ").toUpperCase()}</strong>
      </div>
      <div class="metric-card">
        <span>Risk</span>
        <strong>${Number(response.fraud_score || 0).toFixed(4)}</strong>
      </div>
      <div class="metric-card">
        <span>Model</span>
        <strong>${Number(response.model_fraud_score || 0).toFixed(4)}</strong>
      </div>
      <div class="metric-card">
        <span>Rules</span>
        <strong>${Number(response.rule_score || 0).toFixed(4)}</strong>
      </div>
      <div class="metric-card">
        <span>Gateway</span>
        <strong>${gatewayText}</strong>
      </div>
      <div class="metric-card">
        <span>Amount</span>
        <strong>${formatCurrency(payment.amount, payment.currency)}</strong>
      </div>
    </div>

    <div class="result-meta">
      <div class="meta-row">
        <span>Customer</span>
        <strong>${payment.customer_name}</strong>
      </div>
      <div class="meta-row">
        <span>Attempt</span>
        <strong>${shortId(response.transaction?.id)}</strong>
      </div>
      <div class="meta-row">
        <span>Decision</span>
        <strong>${decisionReason}</strong>
      </div>
      <div class="meta-row">
        <span>Signals</span>
        <strong>${riskReasons}</strong>
      </div>
    </div>
  `;

  gatewayComparison.classList.add("hidden");
  gatewayCards.innerHTML = "";
}

function renderDashboard(snapshot) {
  const summary = snapshot.summary || {};
  const cards = [
    ["Transactions", summary.total_transactions || 0],
    ["Approved", `${Number((summary.approval_rate || 0) * 100).toFixed(1)}%`],
    ["Success", `${Number((summary.success_rate || 0) * 100).toFixed(1)}%`],
    ["Review", summary.review_transactions || 0],
    ["Blocked", summary.blocked_transactions || 0],
    ["Volume", formatCurrency(summary.total_volume || 0, "INR")],
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
                <span class="gateway-rank">${gateway.selected_count} selected</span>
              </div>
              <dl>
                <dt>Evaluations</dt>
                <dd>${gateway.evaluated_count}</dd>
                <dt>Latency</dt>
                <dd>${gateway.avg_latency_ms} ms</dd>
                <dt>Success</dt>
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
              <td>
                <div title="${attempt.id}">${shortId(attempt.id)}</div>
              </td>
              <td>
                <div>${attempt.customer_name || "-"}</div>
                <div class="muted-inline">${attempt.customer_email || "-"}</div>
              </td>
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
  healthBadge.textContent = "Checking";
  healthBadge.className = "health-pill pending";

  try {
    const response = await fetch("/health");
    if (!response.ok) {
      throw new Error("Backend unavailable");
    }

    const data = await response.json();
    healthBadge.textContent = "Online";
    healthBadge.className = "health-pill healthy";
    document.getElementById("healthMl").textContent = data.ml_service_url ? "Connected" : "Unknown";
    document.getElementById("healthStorage").textContent = data.storage?.active_driver || "Unknown";
  } catch (_error) {
    healthBadge.textContent = "Offline";
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
  submitButton.textContent = "Evaluating...";

  setTimeline([
    {
      title: "Creating payment",
      state: "active",
    },
    {
      title: "Scoring risk",
      state: "",
    },
    {
      title: "Routing",
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
        ? data.gateway_name || data.gateway
        : data.status === "review_required"
          ? "Manual review"
          : "Blocked";

    setTimeline([
      {
        title: "Payment created",
        copy: shortId(data.transaction?.id),
        state: "success",
      },
      {
        title: `Risk ${Number(data.fraud_score || 0).toFixed(4)}`,
        copy: `Model ${Number(data.model_fraud_score || 0).toFixed(4)} | Rules ${Number(
          data.rule_score || 0
        ).toFixed(4)}`,
        state: decisionState === "blocked" ? "blocked" : decisionState === "review" ? "review" : "success",
      },
      {
        title:
          data.status === "routed"
            ? "Redirecting to gateway"
            : data.status === "review_required"
              ? "Manual review required"
              : "Payment blocked",
        copy: stepThreeCopy,
        state: decisionState,
      },
    ]);

    if (data.redirect_url) {
      window.location.href = data.redirect_url;
      return;
    }

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
        <strong>Unavailable</strong>
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
    submitButton.textContent = "Evaluate Payment";
  }
});

renderEmpty();
refreshHealth();
refreshDashboard();
