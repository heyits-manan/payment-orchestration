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

function applyTheme() {
  const gatewayKey = window.location.pathname.split("/").pop();
  const theme = providerThemes[gatewayKey] || providerThemes.gateway_alpha;

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

document.querySelector(".pay-btn").addEventListener("click", () => {
  alert("Demo only: this page simulates the hosted payment UI of the selected gateway.");
});

applyTheme();
