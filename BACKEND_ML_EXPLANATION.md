# Backend and ML Backend Explanation

This document explains how the backend works, with extra detail on the ML fraud detection backend so it can be explained clearly in a project review or demo.

## 1. High-Level System Overview

The project is an AI-driven payment orchestration platform. It has two backend parts:

1. **Node.js Express backend** in `backend/`
   - Handles payment API requests.
   - Validates checkout data.
   - Stores payment attempts and fraud decisions.
   - Calls the ML fraud service.
   - Applies extra rule-based fraud checks.
   - Selects the best payment gateway if the payment is safe.

2. **Python Flask ML service** in `ml-service/`
   - Loads a trained fraud detection model.
   - Accepts a 30-value feature vector.
   - Returns whether the transaction looks fraudulent.
   - Returns the fraud probability score from the model.

The flow is:

```text
Customer checkout request
  -> Express backend validates payment data
  -> Backend creates a payment attempt
  -> Backend builds a 30-feature ML input vector
  -> Backend calls Flask ML service at /predict
  -> ML service returns model fraud probability
  -> Backend adds rule-based risk score using user history
  -> Backend calculates final risk score
  -> Backend decides: blocked, manual review, or routed
  -> If routed, backend ranks gateways and sends user to best gateway
```

## 2. Main Backend Request Flow

The main checkout endpoint is:

```text
POST /api/payments/checkout
```

It is defined in:

```text
backend/src/routes/payments.js
```

When a checkout request comes in, the backend does the following:

1. **Validates input**
   - Uses `validateCheckoutPayload()` from `backend/src/utils/validation.js`.
   - Checks fields like customer name, email, amount, payment method, card number, expiry, and CVV.
   - Normalizes fields such as amount, currency, billing country, and IP country.

2. **Creates or finds the user**
   - Uses `getOrCreateUserProfile()` from `backend/src/storage/index.js`.
   - The customer email is used to identify the user.
   - If the user already exists, the same user profile is reused.

3. **Creates a payment attempt**
   - Done inside `createPaymentAttempt()` in `backend/src/services/paymentService.js`.
   - A payment ID and order reference are created.
   - Card network and masked card details are saved.
   - Initial status is set to `risk_pending`.

4. **Runs fraud evaluation**
   - Calls `evaluateFraudRisk()` from `backend/src/services/fraudService.js`.
   - This is where the ML model score and rule-based fraud score are combined.

5. **Routes or blocks the payment**
   - If the fraud decision is safe, the backend ranks payment gateways.
   - If risk is high, the payment is either blocked or sent for manual review.

6. **Stores the decision**
   - Saves records in:
     - `payment_attempts`
     - `fraud_decisions`
     - `gateway_evaluations`
     - `gateway_transactions`
     - `audit_logs`

Storage can be local JSON or Supabase. By default, local storage is used at:

```text
backend/data/runtime-store.json
```

## 3. ML Backend Architecture

The ML backend is a separate Python Flask service.

Important files:

```text
ml-service/train_model.py
ml-service/app.py
ml-service/fraud_model.pkl
```

### Role of `train_model.py`

`train_model.py` is used to train the fraud detection model.

It expects the credit card fraud dataset with these columns:

```text
Time, V1, V2, ..., V28, Amount, Class
```

The features are:

```text
Time + V1 to V28 + Amount
```

That gives exactly 30 input features.

The target column is:

```text
Class
```

Where:

```text
0 = legitimate transaction
1 = fraudulent transaction
```

The training process is:

1. Load the CSV dataset.
2. Validate that all required columns exist.
3. Split the data into 80% training and 20% testing.
4. Train a Random Forest classifier.
5. Evaluate the model using accuracy and a classification report.
6. Save the trained model as `fraud_model.pkl`.

The model used is:

```text
RandomForestClassifier
```

Important settings:

```text
n_estimators = 100
max_depth = 10
random_state = 42
n_jobs = -1
class_weight = balanced_subsample
```

### Why Random Forest is Used

Random Forest is suitable here because:

- It works well for classification problems.
- It can learn non-linear patterns.
- It handles many input features.
- It is more stable than a single decision tree.
- It can work with imbalanced datasets when class weighting is used.

Fraud datasets are usually highly imbalanced, meaning legitimate transactions are much more common than fraud transactions. The setting `class_weight="balanced_subsample"` helps the model pay more attention to the minority fraud class during training.

## 4. Flask ML Service

The Flask service is implemented in:

```text
ml-service/app.py
```

When the service starts, it loads:

```text
ml-service/fraud_model.pkl
```

using `joblib`.

If the model file is missing, the service still starts, but prediction requests fail with:

```text
503 Model not loaded
```

The ML service has two endpoints:

```text
GET /health
POST /predict
```

### `GET /health`

This endpoint returns whether the service is healthy and whether the model is loaded.

Example response:

```json
{
  "status": "healthy",
  "model_loaded": true,
  "feature_count": 30
}
```

### `POST /predict`

This endpoint receives the transaction features from the Node backend.

Expected request:

```json
{
  "features": [30 numeric values]
}
```

The service validates that:

- JSON was sent.
- A `features` field exists.
- `features` is a list.
- The list has exactly 30 values.

Then it converts the input into a NumPy array:

```text
shape = (1, 30)
```

The model then performs:

```text
model.predict(X)
model.predict_proba(X)
```

The response is:

```json
{
  "prediction": 0,
  "fraud_probability": 0.1234
}
```

Meaning:

- `prediction = 0` means the model predicts legitimate.
- `prediction = 1` means the model predicts fraud.
- `fraud_probability` is the model's probability for the fraud class.

## 5. How the Node Backend Sends Data to the ML Service

The Node backend calls the ML service from:

```text
backend/src/services/fraudService.js
```

The function is:

```text
fetchModelScore(features)
```

It sends a POST request to:

```text
ML_SERVICE_URL/predict
```

By default:

```text
http://localhost:5001/predict
```

The timeout is 4 seconds. If the ML service is down, slow, or returns an error, the backend does not crash. Instead, it returns:

```json
{
  "available": false,
  "prediction": 0,
  "model_score": 0,
  "service_status": "offline_rules_only"
}
```

This means the system can still work using rule-based fraud checks even when the ML service is unavailable.

## 6. Feature Vector Generation

The trained model expects 30 features:

```text
Time, V1 to V28, Amount
```

The real dataset contains PCA-transformed columns `V1` to `V28`. In this project, live checkout data does not naturally contain those exact PCA fields. So the backend creates a compatible 30-feature vector in:

```text
backend/src/utils/payment.js
```

The function is:

```text
buildFeatureVector(amount, userId, paymentMethod, billingCountry, ipCountry)
```

It creates:

```text
features[0]  = time-like value
features[1] to features[28] = generated behavioral/risk-style values
features[29] = transaction amount
```

The generated middle features are influenced by:

- User ID hash
- Transaction amount
- Payment method
- Billing country
- IP country
- Whether billing country and IP country are different

For example:

- A high amount increases risk-related feature values.
- A country mismatch changes several feature values.
- Different payment methods slightly modify the feature vector.
- The user ID hash makes the generated features consistent for the same user pattern.

Important explanation point:

The ML model was trained on the public credit card fraud dataset format. Since the demo checkout form does not provide the original PCA features, the backend creates a compatible 30-value input vector so the trained model can still be used in the payment flow.

## 7. Rule-Based Fraud Layer

The ML score is not the only fraud signal. The backend also uses a rule-based layer in:

```text
backend/src/services/fraudService.js
```

The function is:

```text
calculateRiskAdjustments(payment, history)
```

This function looks at the current payment and the user's past transaction history.

It checks signals such as:

- Transaction amount compared to user's normal amount.
- Billing country and IP country mismatch.
- Rapid transactions in the last 1 hour, 3 hours, or 24 hours.
- Multiple failed or blocked attempts.
- New payment method.
- New device.
- Multiple devices used recently.
- Multiple IP countries used recently.
- Repeated high-value transactions.
- New billing country or new IP country.

Each suspicious signal adds to the `rule_score`.

Examples:

- If the amount is far above the user's normal pattern, risk increases.
- If billing country and IP country are different, risk increases.
- If the user suddenly makes many transactions in a short time, risk increases.
- If the user uses a new device and a new country at the same time, risk increases.

The rule layer returns:

```json
{
  "rule_score": 0.42,
  "reasons": ["billing and IP country mismatch"],
  "hard_block_signals": [],
  "review_signals": ["country mismatch"]
}
```

## 8. User History Used by the Rule Engine

User history is calculated in:

```text
fetchUserTransactionSummary()
```

inside:

```text
backend/src/storage/index.js
```

It looks at the user's previous payment attempts and calculates:

- Lifetime transaction count.
- Transactions in the last 1 hour.
- Transactions in the last 3 hours.
- Transactions in the last 24 hours.
- Average amount.
- Median amount.
- Baseline amount.
- Number of blocked attempts in the last 24 hours.
- Number of failed attempts in the last 24 hours.
- Previously used billing countries.
- Previously used IP countries.
- Previously used payment methods.
- Previously used devices.
- High-value transaction bursts.

This makes the fraud decision more personalized. A payment is not judged only by its amount. It is judged against that user's normal behavior.

## 9. Final Fraud Score Calculation

The main fraud function is:

```text
evaluateFraudRisk(payment)
```

It performs these steps:

1. Fetch user transaction history.
2. Build the 30-feature ML vector.
3. Send features to the ML service.
4. Calculate rule-based risk.
5. Combine the scores.
6. Derive the final decision.

The final risk score is:

```text
finalRiskScore = model_score + rule_score
```

It is capped at:

```text
0.99
```

So the final score stays in a probability-like range.

Example:

```text
ML model score  = 0.32
Rule score      = 0.30
Final risk      = 0.62
```

This final score is then compared with thresholds.

## 10. Fraud Decision Thresholds

Thresholds are configured in:

```text
backend/src/config/index.js
```

Default values:

```text
FRAUD_THRESHOLD = 0.80
REVIEW_THRESHOLD = 0.55
```

Decision logic:

### Blocked

The payment is blocked if:

- The ML model predicts fraud, or
- Final risk score is at least `0.80`, or
- Rule engine finds hard block signals.

Status:

```text
blocked
```

### Manual Review

The payment goes to manual review if:

- Final risk score is at least `0.55`, or
- There are two or more review signals, or
- ML service is offline and rule score is still moderately high.

Status:

```text
review_required
```

### Approved and Routed

The payment is approved if:

- It does not cross the review threshold.
- It does not cross the fraud threshold.
- There are no strong fraud signals.

Status:

```text
routed
```

Then the gateway routing engine selects the best payment gateway.

## 11. Gateway Routing After Fraud Check

Gateway routing is handled in:

```text
backend/src/services/gatewayService.js
```

The system compares mock gateways:

- Gateway Alpha
- Gateway Orbit
- Gateway Flux

Each gateway is scored using:

- Success rate
- Health score
- Fees
- Latency
- International support
- Suitability for risk level
- Suitability for high-value payments
- Suitability for credit card payments

Only payments that pass fraud checks are routed. Blocked and manual review payments do not get sent to a gateway.

## 12. What Happens if the ML Service Fails

The backend is designed with fallback behavior.

If the Flask ML service is unavailable:

- The backend marks model status as `offline_rules_only`.
- ML score becomes `0`.
- Fraud decisions continue using rule-based checks.
- A moderately risky transaction can still be sent to manual review.

This is important because payment systems should not fully depend on one external service. If ML is down, the backend still protects the system using rules.

## 13. Example Explanation for Presentation

You can explain the ML backend like this:

> The fraud detection backend is split into two parts. The Node.js backend handles the payment flow, while a separate Python Flask service serves the trained machine learning model. During checkout, the Node backend validates the payment and creates a transaction record. It then builds a 30-feature vector matching the format used by the credit card fraud dataset: Time, V1 to V28, and Amount. This feature vector is sent to the Flask `/predict` endpoint.
>
> The Flask service loads a Random Forest model from `fraud_model.pkl`. The model predicts whether the transaction is legitimate or fraudulent and also returns a fraud probability. The Node backend does not rely only on this ML score. It also checks rule-based signals like unusual amount, country mismatch, transaction velocity, new device, new payment method, and previous blocked attempts. The final risk score is the ML fraud probability plus the rule-based score.
>
> If the final score is above the fraud threshold, the payment is blocked. If it is in the medium-risk range, it is sent for manual review. If it is safe, the payment is approved and routed to the best payment gateway. This hybrid approach is useful because ML catches statistical fraud patterns, while rules catch clear business-risk conditions and make the decision easier to explain.

## 14. Short Viva Answer

If asked, "How is ML used in your backend?", answer:

The backend uses ML as a fraud scoring service. A Python Flask API loads a trained Random Forest model. When a payment is created, the Node backend converts the payment details into a 30-feature vector and sends it to the Flask `/predict` endpoint. The ML service returns a fraud prediction and fraud probability. Then the Node backend combines that probability with rule-based checks from the user's transaction history. Based on the final risk score, the transaction is blocked, sent for manual review, or approved and routed to a payment gateway.

## 15. Important Files to Mention

```text
backend/src/routes/payments.js
```

Receives checkout API requests.

```text
backend/src/services/paymentService.js
```

Creates payment attempts, saves fraud decisions, and triggers gateway routing.

```text
backend/src/services/fraudService.js
```

Calls the ML service, applies rule-based fraud scoring, and makes the final fraud decision.

```text
backend/src/utils/payment.js
```

Builds the 30-feature vector for the ML model.

```text
backend/src/storage/index.js
```

Stores records and calculates user transaction history.

```text
ml-service/train_model.py
```

Trains the Random Forest fraud model.

```text
ml-service/app.py
```

Serves the trained model through Flask.

```text
ml-service/fraud_model.pkl
```

Saved trained ML model.

