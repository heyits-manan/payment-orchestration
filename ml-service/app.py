"""
app.py
======
Flask API that serves the trained fraud detection model.

Endpoints:
    POST /predict
        Input:  {"features": [array of 30 floats]}
        Output: {"prediction": 0|1, "fraud_probability": float}

    GET /health
        Returns service health status.
"""

import logging
import os

import joblib
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "fraud_model.pkl")

if not os.path.exists(MODEL_PATH):
    logger.error("❌  Model file not found! Run  python train_model.py  first.")
    model = None
else:
    model = joblib.load(MODEL_PATH)
    logger.info("✅  Model loaded from %s", MODEL_PATH)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
        "feature_count": 30,
    })


@app.route("/predict", methods=["POST"])
def predict():
    if model is None:
        logger.error("Prediction requested but model is not loaded.")
        return jsonify({"error": "Model not loaded. Train the model first."}), 503

    data = request.get_json(silent=True)
    if data is None or "features" not in data:
        return jsonify({"error": "Invalid request. Send JSON with a 'features' array."}), 400

    features = data["features"]
    if not isinstance(features, list) or len(features) != 30:
        return jsonify({
            "error": f"Expected 30 features, got {len(features) if isinstance(features, list) else 'non-list'}."
        }), 400

    try:
        X = np.array(features, dtype=float).reshape(1, -1)
        prediction = int(model.predict(X)[0])
        probabilities = model.predict_proba(X)[0]
        fraud_prob = float(probabilities[1])

        logger.info(
            "🔍  Prediction: %s | Fraud probability: %.4f",
            "FRAUD" if prediction == 1 else "LEGIT",
            fraud_prob,
        )

        return jsonify({
            "prediction": prediction,
            "fraud_probability": round(fraud_prob, 4),
        })
    except Exception as exc:
        logger.exception("Prediction failed")
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    logger.info("🚀  Starting ML Fraud Detection Service on port 5001 ...")
    app.run(host="0.0.0.0", port=5001, debug=True)
