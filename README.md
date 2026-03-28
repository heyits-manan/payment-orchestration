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

By default, training reads [`creditcard.csv`](/Users/itsmanan/College/Major%20Project/creditcard.csv) from the project root, generates `fraud_model.pkl`, and prints accuracy metrics.

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
  "fraud_score": 0.03,
  "prediction": 0,
  "gateway": "gateway_fast",
  "routing_reason": "Balanced cost and success-rate route.",
  "gateway_score": 0.982,
  "message": "Transaction Approved — Routed to gateway_fast.",
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

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Express server port |
| `ML_SERVICE_URL` | `http://localhost:5001` | Python ML service URL |
| `FRAUD_THRESHOLD` | `0.7` | Block transactions above this score |

---

## 🏗️ How It Works

1. Client sends a card-payment request to Express (`/process-payment`)
2. Express derives a compatible 30-element feature vector for the fraud model demo
3. Express calls the Python ML service (`/predict`)
4. The Random Forest model returns a fraud probability
5. If probability > 0.7 → **Transaction Blocked**
6. If probability ≤ 0.7 → **Transaction Approved**
7. Approved payments are routed to the best-fit gateway based on risk, amount, and gateway profile

Note: the fraud model is trained on the public `creditcard.csv` benchmark dataset, whose anonymized PCA features (`V1` to `V28`) are not directly available in a live payment system. For the MVP demo, Express generates a compatible feature vector and uses the fraud score as an input to adaptive gateway routing.

---

## 📝 Tech Stack

| Component | Technology |
|---|---|
| ML Model | scikit-learn Random Forest |
| ML API | Python Flask |
| Backend API | Node.js Express |
| HTTP Client | Axios |
