# AI-Driven Payment Orchestration Platform

A college major-project implementation of a merchant-side payment orchestration system with:

- fraud scoring through a Python ML service
- rule-based risk adjustment using transaction history
- payment lifecycle tracking from creation to success or failure
- dynamic gateway ranking with fallback routing
- merchant analytics and transaction monitoring
- local JSON persistence by default, with Supabase support via the same schema

## Architecture

```text
Merchant Checkout UI
  -> Express Backend
      -> Fraud Engine
          -> Flask ML Service
          -> History / Rule Engine
      -> Gateway Ranking Engine
      -> Payment Lifecycle Store
      -> Analytics APIs
  -> Hosted Gateway Simulation
      -> Completion / Failure / Fallback
```

## Project Structure

```text
Major Project/
├── backend/
│   ├── server.js
│   ├── supabase-schema.sql
│   ├── public/
│   │   ├── index.html
│   │   ├── app.js
│   │   ├── styles.css
│   │   ├── provider.html
│   │   ├── provider.css
│   │   └── provider.js
│   ├── src/
│   │   ├── app.js
│   │   ├── config/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── storage/
│   │   └── utils/
│   └── data/
│       └── runtime-store.json
├── ml-service/
│   ├── app.py
│   ├── train_model.py
│   ├── requirements.txt
│   └── fraud_model.pkl
└── README.md
```

## Main Features

- Payment attempt creation with validation and idempotent order handling
- Fraud evaluation using:
  - ML model score
  - amount anomaly checks
  - country mismatch checks
  - velocity checks
  - device and payment method novelty checks
- Three risk outcomes:
  - `blocked`
  - `review_required`
  - `routed`
- Gateway comparison across three mock providers
- Gateway fallback when the first provider fails
- Hosted checkout simulation with completion callbacks
- Merchant dashboard with:
  - approval rate
  - success rate
  - review queue
  - blocked transactions
  - total payment volume
  - top fraud reasons
  - gateway performance
  - recent payment attempts

## Tech Stack

| Component | Technology |
| --- | --- |
| Frontend | HTML, CSS, Vanilla JS |
| Backend API | Node.js, Express |
| ML API | Python, Flask |
| ML Model | scikit-learn gradient boosting model trained on `online_payment.csv` |
| Storage | Local JSON or Supabase |

## Setup

### 1. Train the ML model

```bash
cd ml-service
pip install -r requirements.txt
python train_model.py
```

If the dataset is stored elsewhere:

```bash
DATASET_PATH=/absolute/path/to/online_payment.csv python train_model.py
```

### 2. Start the ML service

```bash
cd ml-service
python app.py
```

Default URL: `http://localhost:5001`

### 3. Start the backend

```bash
cd backend
npm install
node server.js
```

Default URL: `http://localhost:3000`

## Environment Variables

Create `backend/.env` from `backend/.env.example`.

Example:

```bash
PORT=3000
ML_SERVICE_URL=http://localhost:5001
FRAUD_THRESHOLD=0.80
REVIEW_THRESHOLD=0.55
STORAGE_DRIVER=auto
LOCAL_STORE_PATH=./data/runtime-store.json
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Storage Modes

### Local mode

The backend works without Supabase. It stores runtime data in:

```text
backend/data/runtime-store.json
```

This is the fastest way to run the project for demos and reviews.

### Supabase mode

Run the SQL in [`backend/supabase-schema.sql`](/Users/itsmanan/College/Major%20Project/backend/supabase-schema.sql) and provide the Supabase environment variables.

Tables created:

- `payment_attempts`
- `fraud_decisions`
- `gateway_evaluations`
- `gateway_transactions`
- `audit_logs`

## Core API Endpoints

### `GET /health`

Returns backend health, thresholds, gateway profile list, and active storage mode.

### `POST /api/payments/checkout`

Creates a payment attempt, evaluates fraud, and returns either:

- `blocked`
- `review_required`
- `routed`

Example:

```bash
curl -X POST http://localhost:3000/api/payments/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Aarav Sharma",
    "customer_email": "aarav@example.com",
    "user_id": "user_123",
    "order_reference": "ORD-1001",
    "amount": 1499,
    "currency": "INR",
    "payment_method": "credit_card",
    "card_number": "4111 1111 1111 1111",
    "expiry": "12/28",
    "cvv": "123",
    "billing_country": "IN",
    "ip_country": "IN",
    "device_id": "device_india_01"
  }'
```

### `GET /api/payments/:attemptId`

Returns payment attempt details, fraud decision metadata, ranked gateways, and gateway transaction history.

### `POST /api/payments/:attemptId/complete`

Completes the hosted gateway step.

Request body:

```json
{ "outcome": "success" }
```

Supported outcomes:

- `success`
- `failed`
- `cancelled`

If a gateway fails and a fallback exists, the API returns a reroute response.

### `GET /api/dashboard/summary`

Returns analytics for the merchant dashboard:

- transaction counts
- approval rate
- success rate
- payment volume
- recent attempts
- top fraud reasons
- gateway performance

## Legacy Compatibility

The earlier demo endpoint still works:

### `POST /process-payment`

It now maps to the newer payment attempt flow and fills missing legacy fields with safe demo defaults.

## Demo Flow

1. Open `http://localhost:3000`
2. Submit a payment from the checkout view
3. Review fraud score and gateway selection
4. Open the hosted gateway page
5. Simulate `success`, `failed`, or `cancelled`
6. Watch the dashboard metrics update

## Project Review Talking Points

- Separation of concerns across routes, services, storage, config, and utilities
- Hybrid fraud engine: ML model plus business rules
- End-to-end payment lifecycle instead of single-response demo logic
- Gateway failover support
- Explainable fraud reasons and analytics visibility
- Cloud-ready schema while still runnable locally
