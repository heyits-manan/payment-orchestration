const providerThemes = {
  gateway_alpha: {
    tag: "Gateway Alpha",
    title: "Gateway Alpha Hosted Checkout",
    copy: "Optimized for domestic card payments with balanced authorization speed and cost.",
    badge: "DOMESTIC FLOW",
    intent: "Domestic approval optimization",
    accent: "#78e0b2",
    accentStrong: "#1f8f6d",
  },
  gateway_orbit: {
    tag: "Gateway Orbit",
    title: "Gateway Orbit Secure Payment Page",
    copy: "Designed for international transaction coverage and stronger cross-border handling.",
    badge: "INTERNATIONAL FLOW",
    intent: "Cross-border authorization handling",
    accent: "#82b6ff",
    accentStrong: "#3769d6",
  },
  gateway_flux: {
    tag: "Gateway Flux",
    title: "Gateway Flux Premium Checkout",
    copy: "Focused on high-value card payments and stronger authorization reliability for larger tickets.",
    badge: "HIGH-VALUE FLOW",
    intent: "High-value authorization reliability",
    accent: "#ffbe7a",
    accentStrong: "#cf7b2c",
  },
};

let attemptId = null;
let autoCompletionStarted = false;

function getGatewayKey() {
  return window.location.pathname.split("/").pop();
}

function applyTheme() {
  const theme = providerThemes[getGatewayKey()] || providerThemes.gateway_alpha;

  document.title = theme.title;
  document.getElementById("providerTag").textContent = theme.tag;
  document.getElementById("providerTitle").textContent = theme.title;
  document.getElementById("providerCopy").textContent = theme.copy;
  document.getElementById("providerBadge").textContent = theme.badge;
  document.getElementById("summaryTitle").textContent = theme.tag;
  document.getElementById("intentLabel").textContent = theme.intent;
  document.documentElement.style.setProperty("--accent", theme.accent);
  document.documentElement.style.setProperty("--accent-strong", theme.accentStrong);
}

function renderAttempt(details) {
  document.getElementById("attemptLabel").textContent = details.attempt.id;
  document.getElementById("statusLabel").textContent = details.attempt.status.replaceAll("_", " ");
  document.getElementById("attemptSummary").innerHTML = `
    <strong>${details.attempt.customer_name}</strong> is paying
    <strong>${Number(details.attempt.amount).toLocaleString("en-IN", {
      style: "currency",
      currency: details.attempt.currency || "INR",
    })}</strong>
    for order <strong>${details.attempt.order_reference}</strong>.
    Current routed gateway: <strong>${details.attempt.selected_gateway || "none"}</strong>.
  `;

  document.getElementById("cardholderField").value = details.attempt.customer_name || "";
  document.getElementById("emailField").value = details.attempt.customer_email || "";
  document.getElementById("cardNumberField").value = details.attempt.masked_card || "••••";
}

function showResult(message, variant) {
  const box = document.getElementById("gatewayResult");
  box.classList.remove("hidden", "success", "warning", "danger");
  box.classList.add(variant);
  box.textContent = message;
}

async function loadAttempt() {
  attemptId = new URLSearchParams(window.location.search).get("attempt_id");
  if (!attemptId) {
    showResult("Missing attempt_id in the gateway URL.", "danger");
    return;
  }

  try {
    const response = await fetch(`/api/payments/${attemptId}`);
    if (!response.ok) {
      throw new Error("Payment attempt not found");
    }
    const details = await response.json();
    renderAttempt(details);
    if (details.attempt.status === "routed" && !autoCompletionStarted) {
      autoCompletionStarted = true;
      showResult("Secure payment page loaded. Confirming payment automatically...", "warning");
      setTimeout(() => {
        completeAttempt("success");
      }, 900);
      return;
    }
    if (details.attempt.status === "success") {
      showResult("Payment completed successfully.", "success");
    }
  } catch (error) {
    showResult(error.message, "danger");
  }
}

async function completeAttempt(outcome) {
  if (!attemptId) {
    showResult("No payment attempt is loaded.", "danger");
    return;
  }

  try {
    const response = await fetch(`/api/payments/${attemptId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ outcome }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not complete payment");
    }

    if (data.status === "rerouted") {
      showResult(data.message, "warning");
      setTimeout(() => {
        window.location.href = data.redirect_url;
      }, 1800);
      return;
    }

    showResult(data.message, data.status === "success" ? "success" : "danger");
    document.getElementById("statusLabel").textContent = data.status.replaceAll("_", " ");
  } catch (error) {
    showResult(error.message, "danger");
  }
}

document.querySelectorAll("[data-outcome]").forEach((button) => {
  button.addEventListener("click", () => completeAttempt(button.dataset.outcome));
});

applyTheme();
loadAttempt();
