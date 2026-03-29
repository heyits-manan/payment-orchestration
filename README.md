# AI-Driven Payment Orchestration Platform

A college-project MVP demonstrating fraud scoring plus adaptive gateway routing in a card-payment flow:

```
Client  →  Express API (Node.js)  →  ML Service (Python/Flask)  →  Response
```

## 📁 Project Structure

```
Major Project/
├── backend/                # Node.js Express API
│   ├── server.js           # Main server (port 3000)
│   └── package.json
├── ml-service/             # Python ML service
│   ├── train_model.py      # Model training script
│   ├── app.py              # Flask API (port 5001)
│   ├── fraud_model.pkl     # Trained model (generated)
│   └── requirements.txt
└── README.md
```

## 🚀 Getting Started

### Prerequisites
- **Python 3.8+**
- **Node.js 16+**

### Step 1 — Train the ML Model

```bash
cd ml-service
pip install -r requirements.txt
python train_model.py
```
You can download the Credit Card Fraud Detection from https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud?resource=download. Better store it in the project root.
Training reads [`creditcard.csv`](/Users/itsmanan/College/Major%20Project/creditcard.csv) from the project root, generates `fraud_model.pkl`, and prints accuracy metrics.

If your dataset lives elsewhere, set `DATASET_PATH` before running training:

```bash
DATASET_PATH=/absolute/path/to/creditcard.csv python train_model.py
```

### Step 2 — Start the ML Service

```bash
cd ml-service
python app.py
```

Flask API starts on **http://localhost:5001**.

### Step 3 — Start the Express Backend

Open a **new terminal**:

```bash
cd backend
npm install
node server.js
```

Express API starts on **http://localhost:3000**.
The demo frontend is also served from **http://localhost:3000**.

### Optional — Connect Supabase for Transaction History

Authentication is not required for the MVP demo. Supabase is used here as a
backend database for storing transaction history and generating user-behavior
risk signals.

1. Create a Supabase project.
2. Run the SQL in [`supabase-schema.sql`](/Users/itsmanan/College/Major%20Project/backend/supabase-schema.sql).
3. Copy [`backend/.env.example`](/Users/itsmanan/College/Major%20Project/backend/.env.example) to `.env`.
4. Add:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `SUPABASE_TRANSACTIONS_TABLE` / `SUPABASE_GATEWAY_TABLE`.
5. Restart the backend.

When Supabase is configured, the backend:
- stores every processed transaction
- fetches recent user history
- adds history-based fraud signals such as high velocity, repeated blocked attempts, and unusual amount spikes
- stores gateway-evaluation snapshots used by the routing engine

---

## 📬 API Usage

### Process a Payment

```bash
curl -X POST http://localhost:3000/process-payment \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 150,
    "user_id": "user_123",
    "payment_method": "credit_card",
    "billing_country": "IN",
    "ip_country": "IN"
  }'
```

**Example Response (Approved + Routed):**
```json
{
  "status": "approved",
  "fraud_score": 0.23,
  "model_fraud_score": 0.03,
  "prediction": 0,
  "gateway": "gateway_alpha",
  "routing_reason": "Balanced cost and success-rate route.",
  "gateway_score": 1.0214,
  "message": "Transaction Approved — Routed to gateway_alpha.",
  "transaction": {
    "amount": 150,
    "user_id": "user_123",
    "payment_method": "credit_card"
  }
}
```

### Test the ML Service directly

```bash
curl -X POST http://localhost:5001/predict \
  -H "Content-Type: application/json" \
  -d '{"features": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}'
```

### Health Checks

```bash
curl http://localhost:3000/health
curl http://localhost:5001/health
```

### Mock Gateway Provider APIs

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

Available mock providers:
- `gateway_alpha`
- `gateway_orbit`
- `gateway_flux`

### Web Demo

Open [http://localhost:3000](http://localhost:3000) in the browser to use the
checkout-style demo UI. It submits a payment request to Express, shows the
fraud-analysis stage, compares dynamic mock gateway metrics, and displays the
final gateway-routing decision before redirecting to a mock hosted provider page.

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Express server port |
| `ML_SERVICE_URL` | `http://localhost:5001` | Python ML service URL |
| `FRAUD_THRESHOLD` | `0.8` | Block transactions above this score |

---

## 🏗️ How It Works

1. Client sends a card-payment request to Express (`/process-payment`)
2. Express derives a compatible 30-element feature vector for the fraud model demo
3. Express calls the Python ML service (`/predict`)
4. The Random Forest model returns a fraud probability
5. If probability > 0.8 → **Transaction Blocked**
6. If probability ≤ 0.8 → **Transaction Approved**
7. Approved payments are routed to the best-fit gateway based on risk, amount, and live mock provider metrics
8. The user is redirected to a simulated hosted checkout page for the selected gateway

Note: the fraud model is trained on the public `creditcard.csv` benchmark dataset, whose anonymized PCA features (`V1` to `V28`) are not directly available in a live payment system. For the MVP demo, Express generates a compatible feature vector and uses the fraud score as an input to adaptive gateway routing.

---

## 📝 Tech Stack

| Component | Technology |
|---|---|
| ML Model | scikit-learn Random Forest |
| ML API | Python Flask |
| Backend API | Node.js Express |
| HTTP Client | Axios |
