const express = require("express");
const { ML_SERVICE_URL, FRAUD_THRESHOLD, REVIEW_THRESHOLD } = require("../config");
const { gatewayProfiles } = require("../services/gatewayService");
const { getStorageStatus } = require("../storage");

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({
    status: "healthy",
    ml_service_url: ML_SERVICE_URL,
    fraud_threshold: FRAUD_THRESHOLD,
    review_threshold: REVIEW_THRESHOLD,
    gateway_profiles: Object.keys(gatewayProfiles),
    storage: getStorageStatus(),
  });
});

module.exports = router;
