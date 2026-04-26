const express = require("express");
const {
  createPaymentAttempt,
  getPaymentAttemptDetails,
  completePaymentAttempt,
} = require("../services/paymentService");
const { validateCheckoutPayload } = require("../utils/validation");

const router = express.Router();

router.post("/checkout", async (req, res) => {
  const validation = validateCheckoutPayload(req.body);
  if (!validation.valid) {
    return res.status(400).json({
      error: "Invalid payment request",
      details: validation.errors,
    });
  }

  const result = await createPaymentAttempt(validation.normalized);
  return res.status(result.duplicate ? 200 : 201).json({
    duplicate: result.duplicate,
    ...result.response,
  });
});

router.get("/:attemptId", async (req, res) => {
  const details = await getPaymentAttemptDetails(req.params.attemptId);
  if (!details) {
    return res.status(404).json({ error: "Payment attempt not found" });
  }
  return res.json(details);
});

router.post("/:attemptId/complete", async (req, res) => {
  const result = await completePaymentAttempt(req.params.attemptId, req.body.outcome);
  if (!result) {
    return res.status(404).json({ error: "Payment attempt not found" });
  }
  return res.json(result);
});

module.exports = router;
