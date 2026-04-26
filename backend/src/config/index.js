const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5001";
const FRAUD_THRESHOLD = Number.parseFloat(process.env.FRAUD_THRESHOLD || "0.8");
const REVIEW_THRESHOLD = Number.parseFloat(process.env.REVIEW_THRESHOLD || "0.55");
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || "auto";
const LOCAL_STORE_PATH =
  process.env.LOCAL_STORE_PATH || path.join(__dirname, "..", "..", "data", "runtime-store.json");

module.exports = {
  PORT,
  ML_SERVICE_URL,
  FRAUD_THRESHOLD,
  REVIEW_THRESHOLD,
  STORAGE_DRIVER,
  LOCAL_STORE_PATH,
};
