const express = require("express");
const { ML_SERVICE_URL, FRAUD_THRESHOLD, REVIEW_THRESHOLD } = require("../config");
const { gatewayProfiles } = require("../services/gatewayService");
const { getStorageStatus } = require("../storage");

const router = express.Router();

router.get("/", (_req, res) => {
  const storage = getStorageStatus();
  const degraded = storage.strict_supabase && (storage.load_error || storage.runtime_error);

  res.json({
    status: degraded ? "degraded" : "healthy",
    ml_service_url: ML_SERVICE_URL,
    fraud_threshold: FRAUD_THRESHOLD,
    review_threshold: REVIEW_THRESHOLD,
    gateway_profiles: Object.keys(gatewayProfiles),
    storage,
  });
});

module.exports = router;
