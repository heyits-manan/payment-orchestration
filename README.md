# AI-Driven Payment Orchestration Platform

A college-project MVP for merchant-side payment orchestration:
- fraud scoring using a Python ML service
- history-based risk adjustments using Supabase
- dynamic gateway comparison using mock provider APIs
- redirect to a hosted checkout page for the selected gateway

```text
User Checkout UI
   -> Express Backend
   -> Flask ML Fraud Service
   -> Supabase Transaction History
   -> Gateway Comparison Engine
   -> Selected Hosted Gateway Page
```

## Project Structure

```text
Major Project/
├── backend/
│   ├── server.js
│   ├── supabase.js
│   ├── supabase-schema.sql
│   ├── .env.example
│   ├── package.json
│   └── public/
│       ├── index.html
│       ├── app.js
│       ├── styles.css
│       ├── provider.html
│       ├── provider.css
│       ├── provider.js
│       └── provider-not-found.html
├── ml-service/
│   ├── train_model.py
│   ├── app.py
│   ├── requirements.txt
│   └── fraud_model.pkl
├── creditcard.csv
└── README.md
```

## Current Features

- Payment demo UI served from Express
- Fraud prediction using a Random Forest model in Flask
- Final fraud score combines:
  - ML model score
  - merchant-side risk rules
  - user transaction history from Supabase
- Dynamic mock gateway APIs:
  - `gateway_alpha`
  - `gateway_orbit`
  - `gateway_flux`
- Gateway comparison and best-provider selection
- Redirect to a simulated hosted gateway payment page
- Transaction and gateway snapshot persistence in Supabase

## Tech Stack

| Component | Technology |
|---|---|
| Frontend Demo | HTML, CSS, Vanilla JS |
| Backend API | Node.js, Express |
| ML API | Python, Flask |
| ML Model | scikit-learn Random Forest |
| Database | Supabase |
| HTTP Client | Axios |

## Setup

### Prerequisites

- Python 3.8+
- Node.js 16+
- Supabase project (optional but recommended)

### 1. Train the ML model

```bash
cd ml-service
pip install -r requirements.txt
python train_model.py
```

By default, training reads `creditcard.csv` from the project root and generates `fraud_model.pkl`.

If your dataset is elsewhere:

```bash
DATASET_PATH=/absolute/path/to/creditcard.csv python train_model.py
```

### 2. Start the ML service

```bash
cd ml-service
python app.py
```

Runs on `http://localhost:5001`.

### 3. Set up the backend

```bash
cd backend
npm install
```

Create `backend/.env` from `backend/.env.example`.

Example:

```bash
PORT=3000
ML_SERVICE_URL=http://localhost:5001
FRAUD_THRESHOLD=0.8
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_TRANSACTIONS_TABLE=transactions
SUPABASE_GATEWAY_TABLE=gateway_snapshots
```

### 4. Optional Supabase setup

Authentication is not required for the current MVP. Supabase is used as a backend database for:
- transaction history
- history-based fraud signals
- gateway evaluation snapshots

Run the SQL in [`supabase-schema.sql`](/Users/itsmanan/College/Major%20Project/backend/supabase-schema.sql) in the Supabase SQL Editor.

This creates:
- `transactions`
- `gateway_snapshots`

### 5. Start the backend

```bash
cd backend
node server.js
```

Runs on `http://localhost:3000`.

The main demo UI is also served from `http://localhost:3000`.

## API Endpoints

### `POST /process-payment`

Accepts a payment request, scores fraud risk, compares gateway options, and either blocks or routes the transaction.

Example:

```bash
curl -X POST http://localhost:3000/process-payment \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 2500,
    "user_id": "user_123",
    "payment_method": "credit_card",
    "billing_country": "IN",
    "ip_country": "IN"
  }'
```

Sample response:

```json
{
  "status": "approved",
  "fraud_score": 0.31,
  "model_fraud_score": 0.04,
  "prediction": 0,
  "gateway": "gateway_alpha",
  "gateway_name": "Gateway Alpha",
  "redirect_url": "/providers/gateway_alpha",
  "routing_reason": "Balanced cost and success-rate route.",
  "gateway_score": 1.0421,
  "risk_adjustment_reasons": ["amount above user average"],
  "message": "Transaction Approved — Routed to gateway_alpha."
}
```

### `GET /health`

Backend health, gateway config, and Supabase status:

```bash
curl http://localhost:3000/health
```

### `POST /mock-gateways/:gatewayKey`

Returns dynamic simulated metrics for a provider.

Example:

```bash
curl -X POST http://localhost:3000/mock-gateways/gateway_alpha \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 2500,
    "user_id": "user_123",
    "payment_method": "credit_card",
    "billing_country": "IN",
    "ip_country": "IN"
  }'
```

Available providers:
- `gateway_alpha`
- `gateway_orbit`
- `gateway_flux`

### `POST /predict`

Direct Flask fraud-model endpoint:

```bash
curl -X POST http://localhost:5001/predict \
  -H "Content-Type: application/json" \
  -d '{"features":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}'
```

## Web Demo

Open [http://localhost:3000](http://localhost:3000).

Current demo flow:
1. User enters payment details on the merchant checkout UI.
2. Express sends the transaction to the Flask ML service.
3. The backend computes the final fraud score using:
   - model fraud score
   - business-rule adjustments
   - previous user transaction history from Supabase
4. If the transaction is risky, it is blocked.
5. If approved, the backend evaluates all mock gateway providers.
6. The UI shows compared gateway metrics.
7. The user is redirected to the hosted checkout page of the selected gateway.

## Fraud Decision Logic

The backend does not rely only on the ML prediction.

Final decision combines:
- `model_fraud_score` from the Random Forest model
- merchant-side risk adjustments
- history-based signals from Supabase

Examples of history-based signals:
- high transaction velocity in the last 24 hours
- repeated blocked transactions
- amount much higher than the user’s average
- new billing country
- new IP country

The backend blocks a transaction if:
- the ML model predicts fraud, or
- the final effective fraud score exceeds `FRAUD_THRESHOLD`

Current default threshold: `0.8`

## Gateway Routing Logic

Each mock provider returns dynamic metrics such as:
- success rate
- average latency
- fee
- health score
- uptime
- international support

The router compares providers using:
- fraud score
- transaction amount
- domestic vs international context
- provider metrics
- provider strengths

This makes the selected gateway vary over time while still looking consistent and explainable.

## Notes

- The fraud model is trained on the public `creditcard.csv` benchmark dataset.
- That dataset uses anonymized PCA features (`V1` to `V28`), so runtime feature generation is simulated for the MVP.
- The main practical contribution of the project is adaptive gateway routing supported by fraud scoring and transaction history.

## Important Security Note

- Never expose the Supabase `service_role` key in frontend code.
- Keep `backend/.env` out of git.
- If a real service-role key was exposed, rotate it in Supabase before pushing the project.
