const express = require("express");
const { getDashboardSnapshot, listPaymentAttempts } = require("../storage");

const router = express.Router();

router.get("/summary", async (_req, res) => {
  const snapshot = await getDashboardSnapshot();
  return res.json(snapshot);
});

router.get("/transactions", async (req, res) => {
  const limit = Number(req.query.limit || 50);
  const result = await listPaymentAttempts(limit);
  return res.json(result);
});

module.exports = router;
