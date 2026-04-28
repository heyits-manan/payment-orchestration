# Backend and ML Explanation

This document explains how the backend and ML fraud service work in the current project. It is written for project review, viva, and demo explanation.

## 1. System Overview

The project is an AI-driven payment orchestration platform with two backend parts:

1. **Node.js Express backend** in `backend/`
   - Accepts checkout requests.
   - Validates payment data.
   - Stores payment attempts, fraud decisions, gateway evaluations, and audit logs.
   - Builds ML input features from the live payment.
   - Calls the Python ML service.
   - Adds rule-based fraud checks using user history.
   - Routes approved payments to the best gateway.

2. **Python Flask ML service** in `ml-service/`
   - Loads `fraud_model.pkl`.
   - Accepts a PaySim-style transaction object.
   - Converts it into the trained feature schema.
   - Returns fraud prediction and fraud probability.

The checkout flow is:

```text
Checkout request
  -> Express validates and normalizes the payload
  -> Express creates a payment attempt
  -> Express builds PaySim-style ML input fields
  -> Flask ML service returns prediction and fraud probability
  -> Express adds rule-based risk score from user history
  -> Express calculates final risk score
  -> Decision: approved/routed, review_required, or blocked
  -> Approved payments are ranked and sent to a gateway
```

## 2. Dataset and Model Training

The ML model is trained from `online_payment.csv`, which follows the PaySim-style online payment fraud dataset.

Expected dataset columns:

```text
step,type,amount,nameOrig,oldbalanceOrg,newbalanceOrig,
nameDest,oldbalanceDest,newbalanceDest,isFraud,isFlaggedFraud
```

Target column:

```text
isFraud
```

Meaning:

```text
0 = legitimate transaction
1 = fraudulent transaction
```

Training happens in:

```text
ml-service/train_model.py
```

The training script:

1. Loads `online_payment.csv`.
2. Validates the required dataset columns.
3. Engineers 16 numeric model features.
4. Splits data into 80% train and 20% test using stratified splitting.
5. Uses class balancing so fraud rows receive more importance.
6. Trains a `RandomForestClassifier`.
7. Evaluates with ROC AUC, confusion matrix, and classification report.
8. Saves the model artifact to `ml-service/fraud_model.pkl`.

The model used is:

```text
RandomForestClassifier
```

Important training settings:

```text
n_estimators = 100
max_depth = 12
random_state = 42
n_jobs = -1
class_weight = balanced_subsample
```

Random Forest is an ensemble model. It trains many decision trees and combines their votes, which makes it more stable than a single decision tree and suitable for fraud classification on tabular data.

## 3. ML Features

The trained model uses 16 engineered features:

```text
step
type_code
amount
oldbalanceOrg
newbalanceOrig
oldbalanceDest
newbalanceDest
origin_balance_delta
dest_balance_delta
origin_balance_error
dest_balance_error
amount_to_oldbalance_org
amount_to_oldbalance_dest
orig_is_customer
dest_is_customer
isFlaggedFraud
```

The `type` field is mapped into a number:

```text
CASH_IN  = 0
CASH_OUT = 1
DEBIT    = 2
PAYMENT  = 3
TRANSFER = 4
```

The important engineered features are:

- `origin_balance_delta`: old origin balance minus new origin balance.
- `dest_balance_delta`: new destination balance minus old destination balance.
- `origin_balance_error`: difference between origin balance movement and amount.
- `dest_balance_error`: difference between destination balance movement and amount.
- `amount_to_oldbalance_org`: amount compared with origin account balance.
- `amount_to_oldbalance_dest`: amount compared with destination account balance.
- `orig_is_customer` and `dest_is_customer`: whether IDs start with `C`.

These features help the model detect suspicious money movement patterns, not just high amount values.

## 4. Flask ML Service

The Flask service is implemented in:

```text
ml-service/app.py
```

When it starts, it loads:

```text
ml-service/fraud_model.pkl
```

The service exposes:

```text
GET /health
POST /predict
```

### GET /health

Returns model/service status and the feature schema.

Example response:

```json
{
  "status": "healthy",
  "model_loaded": true,
  "dataset": "online_payment.csv",
  "feature_count": 16,
  "feature_schema": ["step", "type_code", "amount"]
}
```

### POST /predict

The endpoint accepts a PaySim-style transaction object, not a raw feature array.

Example request:

```json
{
  "step": 10,
  "type": "TRANSFER",
  "amount": 200000,
  "nameOrig": "C123",
  "oldbalanceOrg": 300000,
  "newbalanceOrig": 100000,
  "nameDest": "C456",
  "oldbalanceDest": 50000,
  "newbalanceDest": 250000,
  "isFlaggedFraud": 1
}
```

The Flask service converts this object into the 16 trained features, then calls:

```text
model.predict(X)
model.predict_proba(X)
```

Example response:

```json
{
  "prediction": 0,
  "fraud_probability": 0.031
}
```

Meaning:

- `prediction = 0`: model predicts legitimate.
- `prediction = 1`: model predicts fraud.
- `fraud_probability`: model fraud probability used by the Node backend as `model_score`.

## 5. Backend Feature Generation

The live checkout form does not directly contain all PaySim dataset columns. The Node backend creates a PaySim-style transaction object in:

```text
backend/src/utils/payment.js
```

Function:

```text
buildOnlinePaymentFeatures(amount, userId, paymentMethod, billingCountry, ipCountry)
```

It creates fields such as:

- `step`
- `type`
- `amount`
- `nameOrig`
- `oldbalanceOrg`
- `newbalanceOrig`
- `nameDest`
- `oldbalanceDest`
- `newbalanceDest`
- `isFlaggedFraud`

The generated values are deterministic for the user and transaction details. For example:

- `amount >= 100000` is treated as a `TRANSFER`.
- `isFlaggedFraud` becomes `1` when amount is at least `200000`.
- User ID is hashed to create stable customer-like IDs and balances.

Important viva point:

The ML model is trained on PaySim-style data, while the checkout app has normal payment fields. The backend bridges this by converting checkout data into the same style of transaction object that the ML service expects.

## 6. Rule-Based Fraud Layer

ML is only one part of the decision. The backend also applies explainable fraud rules in:

```text
backend/src/services/fraudService.js
```

Function:

```text
calculateRiskAdjustments(payment, history)
```

This function produces:

```json
{
  "rule_score": 0.28,
  "reasons": ["transaction amount is above the platform manual-review limit"],
  "hard_block_signals": [],
  "review_signals": ["high absolute transaction amount"]
}
```

Main rule signals include:

- High absolute amount.
- Very large first transaction.
- Amount much higher than the user's normal pattern.
- Billing/IP country mismatch if present in backend data.
- Rapid transaction velocity.
- Recent blocked, failed, or review decisions.
- New payment method, device, or card.
- Repeated high-risk card/device history.
- High-risk bursts in short time windows.

Current important amount thresholds:

```text
General high-value review signal       = 1000000  (10 lakhs)
First-transaction review signal        = 2000000  (20 lakhs)
Hard block amount                      = 5100000  (51 lakhs)
First-transaction hard block amount    = 5100000  (51 lakhs)
```

The current clean UI does not expose billing country and IP country fields. Those fields are also not part of the trained dataset. If they appear in backend data, they are rule/routing context, not ML-trained features.

## 7. User History

User history is calculated in:

```text
backend/src/storage/index.js
```

Function:

```text
fetchUserTransactionSummary(userId)
```

The backend uses previous payment attempts for the same user to calculate:

- Previous transactions in 1 hour, 3 hours, and 24 hours.
- Historical successful/review/blocked/failed attempts.
- Average, median, and baseline amount.
- Recent high-value bursts.
- Device, card, payment method, and country history.
- Repeated risky decisions.
- Risky decision rate.

This makes the fraud layer personalized. A transaction is judged against both platform thresholds and the user's own behavior.

## 8. Final Fraud Decision

Fraud evaluation happens in:

```text
backend/src/services/fraudService.js
```

Function:

```text
evaluateFraudRisk(payment)
```

Steps:

1. Fetch user history.
2. Build PaySim-style ML input.
3. Call Flask `/predict`.
4. Calculate rule score.
5. Combine ML and rule scores.
6. Derive final decision.

Final score:

```text
final_risk_score = model_score + rule_score
```

The score is capped at:

```text
0.99
```

Default decision thresholds:

```text
REVIEW_THRESHOLD = 0.55
FRAUD_THRESHOLD  = 0.80
```

### Approved / Routed

Approved when:

- Final score is below `0.55`.
- No hard block signal exists.
- ML did not predict fraud.

Status:

```text
routed
```

### Manual Review

Review when:

- Final score is at least `0.55`, or
- Two or more review signals are present, or
- ML is offline and rule-only risk is elevated.

Status:

```text
review_required
```

### Blocked

Blocked when:

- ML prediction is fraud, or
- ML score is at least `0.80`, or
- A hard rule matches, or
- Extreme combined risk is reached from many review signals and previous transactions.

Status:

```text
blocked
```

## 9. ML Service Fallback

The Node backend calls the ML service with a 4-second timeout.

If the ML service is down or returns an error, the backend uses this fallback:

```json
{
  "available": false,
  "prediction": 0,
  "model_score": 0,
  "service_status": "offline_rules_only"
}
```

This means the payment system can still work with rule-based fraud protection even when ML is unavailable.

## 10. Gateway Routing

Gateway routing runs only for approved payments. It is handled in:

```text
backend/src/services/gatewayService.js
```

The mock gateways are:

- **Gateway Alpha**: domestic and low-risk strength.
- **Gateway Orbit**: international and risky-payment strength.
- **Gateway Flux**: high-value and credit-card strength.

Each gateway has fixed base properties:

- Base success rate.
- Base latency.
- Base fee.
- Base health score.
- International support.
- Strength tags.

For each transaction, the backend creates per-transaction gateway metrics using deterministic jitter. The base profile stays the same, but displayed success rate, latency, fee, and health can vary slightly per transaction.

The route score uses:

```text
success_rate / 100
+ health_score / 200
- fee_bps / 10000
- avg_latency_ms / 5000
```

Adds transaction-based bonuses:

- low-risk payment → favors gateway_alpha
- high-value amount >= 4000 → favors gateway_flux
- credit card → favors gateway_flux
- elevated risk → favors gateway_orbit
- international → favors gateway_orbit / gateway_flux

That is why low-value transactions may route to Gateway Alpha, while higher-value credit-card transactions often route to Gateway Flux.

## 13. Important Files

```text
backend/src/routes/payments.js
```

Receives checkout API requests.

```text
backend/src/services/paymentService.js
```

Creates payment attempts, stores decisions, and triggers gateway routing.

```text
backend/src/services/fraudService.js
```

Calls the ML service, applies rules, calculates final risk, and decides approval/review/block.

```text
backend/src/utils/payment.js
```

Builds PaySim-style transaction fields from checkout data.

```text
backend/src/services/gatewayService.js
```

Ranks gateways for approved payments.

```text
backend/src/storage/index.js
```

Stores records and calculates user transaction history.

```text
ml-service/train_model.py
```

Trains and saves the ML fraud model.

```text
ml-service/app.py
```

Serves the ML model through Flask.
