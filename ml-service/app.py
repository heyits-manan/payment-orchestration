"""
app.py
======
Flask API that serves the online-payment fraud detection model.

Endpoints:
    POST /predict
        Input: PaySim-style transaction feature object
        Output: {"prediction": 0|1, "fraud_probability": float}

    GET /health
        Returns service health status.
"""

import logging
import os

import joblib
import numpy as np
import pandas as pd
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
DEFAULT_TYPE_MAP = {
    "CASH_IN": 0,
    "CASH_OUT": 1,
    "DEBIT": 2,
    "PAYMENT": 3,
    "TRANSFER": 4,
}
DEFAULT_FEATURE_COLUMNS = [
    "step",
    "type_code",
    "amount",
    "oldbalanceOrg",
    "newbalanceOrig",
    "oldbalanceDest",
    "newbalanceDest",
    "origin_balance_delta",
    "dest_balance_delta",
    "origin_balance_error",
    "dest_balance_error",
    "amount_to_oldbalance_org",
    "amount_to_oldbalance_dest",
    "orig_is_customer",
    "dest_is_customer",
    "isFlaggedFraud",
]

model = None
feature_columns = DEFAULT_FEATURE_COLUMNS
type_map = DEFAULT_TYPE_MAP
model_dataset = None

if not os.path.exists(MODEL_PATH):
    logger.error("Model file not found. Run python train_model.py first.")
else:
    artifact = joblib.load(MODEL_PATH)
    if isinstance(artifact, dict) and "model" in artifact:
        model = artifact["model"]
        feature_columns = artifact.get("feature_columns", DEFAULT_FEATURE_COLUMNS)
        type_map = artifact.get("type_map", DEFAULT_TYPE_MAP)
        model_dataset = artifact.get("dataset")
    else:
        model = artifact
        model_dataset = "legacy"
    logger.info("Model loaded from %s", MODEL_PATH)


def to_float(value, default=0.0):
    try:
        if value is None:
            return default
        number = float(value)
        if np.isfinite(number):
            return number
    except (TypeError, ValueError):
        pass
    return default


def prepare_feature_frame(payload):
    tx_type = str(payload.get("type", "PAYMENT")).upper()
    type_code = type_map.get(tx_type, type_map.get("PAYMENT", 3))
    amount = to_float(payload.get("amount"))
    oldbalance_org = to_float(payload.get("oldbalanceOrg"))
    newbalance_orig = to_float(payload.get("newbalanceOrig"))
    oldbalance_dest = to_float(payload.get("oldbalanceDest"))
    newbalance_dest = to_float(payload.get("newbalanceDest"))
    origin_delta = oldbalance_org - newbalance_orig
    dest_delta = newbalance_dest - oldbalance_dest

    values = {
        "step": to_float(payload.get("step"), 1.0),
        "type_code": type_code,
        "amount": amount,
        "oldbalanceOrg": oldbalance_org,
        "newbalanceOrig": newbalance_orig,
        "oldbalanceDest": oldbalance_dest,
        "newbalanceDest": newbalance_dest,
        "origin_balance_delta": origin_delta,
        "dest_balance_delta": dest_delta,
        "origin_balance_error": abs(origin_delta - amount),
        "dest_balance_error": abs(dest_delta - amount),
        "amount_to_oldbalance_org": amount / oldbalance_org if oldbalance_org else 0,
        "amount_to_oldbalance_dest": amount / oldbalance_dest if oldbalance_dest else 0,
        "orig_is_customer": 1 if str(payload.get("nameOrig", "C")).startswith("C") else 0,
        "dest_is_customer": 1 if str(payload.get("nameDest", "M")).startswith("C") else 0,
        "isFlaggedFraud": to_float(payload.get("isFlaggedFraud")),
    }
    return pd.DataFrame([[values.get(column, 0) for column in feature_columns]], columns=feature_columns)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
        "dataset": model_dataset,
        "feature_count": len(feature_columns),
        "feature_schema": feature_columns,
    })


@app.route("/predict", methods=["POST"])
def predict():
    if model is None:
        logger.error("Prediction requested but model is not loaded.")
        return jsonify({"error": "Model not loaded. Train the model first."}), 503

    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid request. Send a JSON transaction object."}), 400

    try:
        X = prepare_feature_frame(data)
        prediction = int(model.predict(X)[0])
        probabilities = model.predict_proba(X)[0]
        fraud_prob = float(probabilities[1])

        logger.info(
            "Prediction: %s | Fraud probability: %.4f | Type: %s | Amount: %.2f",
            "FRAUD" if prediction == 1 else "LEGIT",
            fraud_prob,
            str(data.get("type", "PAYMENT")).upper(),
            to_float(data.get("amount")),
        )

        return jsonify({
            "prediction": prediction,
            "fraud_probability": round(fraud_prob, 4),
        })
    except Exception as exc:
        logger.exception("Prediction failed")
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    logger.info("Starting ML Fraud Detection Service on port 5001 ...")
    app.run(host="0.0.0.0", port=5001, debug=True)
