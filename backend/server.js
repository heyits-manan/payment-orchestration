require("dotenv").config();

const app = require("./src/app");
const { PORT, ML_SERVICE_URL, FRAUD_THRESHOLD, REVIEW_THRESHOLD } = require("./src/config");

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nPayment Orchestration API running on http://localhost:${PORT}`);
    console.log(`ML Service expected at ${ML_SERVICE_URL}`);
    console.log(`Fraud threshold: ${FRAUD_THRESHOLD}`);
    console.log(`Review threshold: ${REVIEW_THRESHOLD}\n`);
  });
}

module.exports = app;
