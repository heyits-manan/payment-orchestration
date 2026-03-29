const form = document.getElementById("paymentForm");
const resultPanel = document.getElementById("resultPanel");
const timeline = document.getElementById("timeline");
const healthBadge = document.getElementById("healthBadge");
const submitButton = document.getElementById("submitButton");
const gatewayComparison = document.getElementById("gatewayComparison");
const gatewayCards = document.getElementById("gatewayCards");

const scenarios = {
  safe: {
    customer_name: "Aarav Sharma",
    user_id: "user_123",
    amount: "1499",
    payment_method: "credit_card",
    card_number: "4111 1111 1111 1111",
    expiry: "12/28",
    cvv: "123",
    billing_country: "IN",
    ip_country: "IN",
  },
  risk: {
    customer_name: "Riya Kapoor",
    user_id: "user_999",
    amount: "9999",
    payment_method: "credit_card",
    card_number: "4000 0000 0000 1000",
    expiry: "08/27",
    cvv: "987",
    billing_country: "IN",
    ip_country: "AE",
  },
  international: {
    customer_name: "Kabir Mehta",
    user_id: "user_intl",
    amount: "3200",
    payment_method: "credit_card",
    card_number: "5555 5555 5555 4444",
    expiry: "10/29",
    cvv: "456",
    billing_country: "IN",
    ip_country: "AE",
  },
};

function maskCard(cardNumber) {
  const digits = String(cardNumber).replace(/\D/g, "");
  return digits.length >= 4 ? `•••• •••• •••• ${digits.slice(-4)}` : "••••";
}

function setTimeline(steps) {
  timeline.innerHTML = steps
    .map(
      (step) => `
        <div class="timeline-step ${step.state}">
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

function renderEmpty() {
  resultPanel.className = "result-panel empty";
  resultPanel.innerHTML = `
    <p class="empty-title">No payment processed yet</p>
    <p class="empty-copy">
      This panel will show fraud score, model prediction, gateway chosen,
      and the final orchestration response.
    </p>
  `;
  gatewayComparison.classList.add("hidden");
  gatewayCards.innerHTML = "";
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
          <h4>${gateway.gateway_name}</h4>
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

function renderResult(response, payment) {
  const statusClass = response.status === "approved" ? "status-approved" : "status-blocked";
  const gatewayText = response.gateway || "Not routed";
  const transactionAmount = Number(response.transaction?.amount ?? payment.amount);
  const riskReasons = Array.isArray(response.risk_adjustment_reasons) && response.risk_adjustment_reasons.length
    ? response.risk_adjustment_reasons.join(", ")
    : "None";

  resultPanel.className = "result-panel";
  resultPanel.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card ${statusClass}">
        <span>Final Status</span>
        <strong>${response.status.toUpperCase()}</strong>
      </div>
      <div class="metric-card">
        <span>Fraud Score</span>
        <strong>${Number(response.fraud_score).toFixed(4)}</strong>
      </div>
      <div class="metric-card">
        <span>Model Score</span>
        <strong>${Number(response.model_fraud_score ?? response.fraud_score).toFixed(4)}</strong>
      </div>
      <div class="metric-card">
        <span>Model Prediction</span>
        <strong>${response.prediction === 1 ? "FRAUD" : "LEGIT"}</strong>
      </div>
      <div class="metric-card">
        <span>Gateway</span>
        <strong>${gatewayText}</strong>
      </div>
    </div>

    <div class="result-meta">
      <div class="meta-row">
        <span>Customer</span>
        <strong>${payment.customer_name}</strong>
      </div>
      <div class="meta-row">
        <span>Card</span>
        <strong>${maskCard(payment.card_number)}</strong>
      </div>
      <div class="meta-row">
        <span>Transaction</span>
        <strong>₹${transactionAmount.toLocaleString("en-IN")}</strong>
      </div>
      <div class="meta-row">
        <span>Routing Reason</span>
        <strong>${response.routing_reason || "Blocked before routing"}</strong>
      </div>
      <div class="meta-row">
        <span>Risk Adjustments</span>
        <strong>${riskReasons}</strong>
      </div>
      <div class="meta-row">
        <span>System Message</span>
        <strong>${response.message}</strong>
      </div>
    </div>
    ${
      response.redirect_url
        ? `
          <div class="redirect-wrap">
            <a href="${response.redirect_url}" class="redirect-link">
              Open ${response.gateway_name || response.gateway} hosted checkout
            </a>
            <p class="redirect-copy">Demo redirect to the selected gateway page.</p>
          </div>
        `
        : ""
    }
  `;

  renderGatewayComparison(response.evaluated_gateways);
}

function setFormValues(values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) {
      field.value = value;
    }
  });
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
    const status = data.status === "healthy" ? "healthy" : "unhealthy";
    healthBadge.textContent = status === "healthy" ? "Backend healthy" : "Backend unhealthy";
    healthBadge.className = `health-pill ${status}`;
  } catch (_error) {
    healthBadge.textContent = "Backend offline";
    healthBadge.className = "health-pill unhealthy";
  }
}

document.querySelectorAll(".scenario-btn").forEach((button) => {
  button.addEventListener("click", () => {
    setFormValues(scenarios[button.dataset.scenario]);
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payment = Object.fromEntries(formData.entries());
  const payload = {
    amount: Number(payment.amount),
    user_id: payment.user_id,
    payment_method: payment.payment_method,
    billing_country: payment.billing_country,
    ip_country: payment.ip_country,
  };

  submitButton.disabled = true;
  submitButton.textContent = "Processing...";
  setTimeline([
    {
      title: "Request received by merchant backend",
      copy: "Express validates the payment request and prepares orchestration inputs.",
      state: "success",
    },
    {
      title: "Fraud model is analyzing the transaction",
      copy: "The request is being sent to the Flask ML service for scoring.",
      state: "active",
    },
    {
      title: "Gateway routing decision pending",
      copy: "The final route will be selected after the fraud score returns.",
      state: "",
    },
  ]);

  try {
    const response = await fetch("/process-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Payment processing failed");
    }

    setTimeline([
      {
        title: "Payment request captured",
        copy: `User ${payment.user_id} initiated a ${payment.payment_method.replace("_", " ")} transaction.`,
        state: "success",
      },
      {
        title: "Fraud scoring complete",
        copy: `Random Forest returned ${Number(data.model_fraud_score ?? data.fraud_score).toFixed(4)} and orchestration raised effective risk to ${Number(data.fraud_score).toFixed(4)}.`,
        state: data.status === "blocked" ? "blocked" : "success",
      },
      {
        title: data.status === "approved" ? "Gateway selected" : "Payment blocked",
        copy:
          data.status === "approved"
            ? `${data.gateway} chosen because ${data.routing_reason.toLowerCase()}`
            : "Transaction did not proceed to gateway routing because fraud risk exceeded the threshold.",
        state: data.status === "approved" ? "success" : "blocked",
      },
    ]);

    renderResult(data, payment);

    if (data.status === "approved" && data.redirect_url) {
      setTimeout(() => {
        window.location.href = data.redirect_url;
      }, 2200);
    }
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
        <strong>Backend or ML service unavailable</strong>
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
    submitButton.textContent = "Analyze and Route Payment";
  }
});

renderEmpty();
setFormValues(scenarios.safe);
refreshHealth();
