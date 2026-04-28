"""
train_model.py
==============
Trains a fraud model from the online_payment.csv / PaySim dataset only.

Expected dataset columns:
    step,type,amount,nameOrig,oldbalanceOrg,newbalanceOrig,
    nameDest,oldbalanceDest,newbalanceDest,isFraud,isFlaggedFraud

Outputs:
    - fraud_model.pkl
"""

import os

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
from sklearn.model_selection import train_test_split

RAW_COLUMNS = [
    "step",
    "type",
    "amount",
    "nameOrig",
    "oldbalanceOrg",
    "newbalanceOrig",
    "nameDest",
    "oldbalanceDest",
    "newbalanceDest",
    "isFraud",
    "isFlaggedFraud",
]
FEATURE_COLUMNS = [
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
TYPE_MAP = {
    "CASH_IN": 0,
    "CASH_OUT": 1,
    "DEBIT": 2,
    "PAYMENT": 3,
    "TRANSFER": 4,
}
TARGET_COLUMN = "isFraud"
DEFAULT_DATASET_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "online_payment.csv")
)


def load_dataset(dataset_path):
    if not os.path.exists(dataset_path):
        raise FileNotFoundError(
            f"Dataset not found at {dataset_path}. "
            "Set DATASET_PATH or place online_payment.csv in the project root."
        )

    df = pd.read_csv(dataset_path, usecols=RAW_COLUMNS)
    missing_columns = [column for column in RAW_COLUMNS if column not in df.columns]
    if missing_columns:
        raise ValueError("Dataset is missing required columns: " + ", ".join(missing_columns))
    return df


def prepare_features(df):
    prepared = pd.DataFrame(index=df.index)
    prepared["step"] = pd.to_numeric(df["step"], errors="coerce").fillna(0)
    prepared["type_code"] = (
        df["type"].astype(str).str.upper().map(TYPE_MAP).fillna(TYPE_MAP["PAYMENT"])
    )
    prepared["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
    prepared["oldbalanceOrg"] = pd.to_numeric(df["oldbalanceOrg"], errors="coerce").fillna(0)
    prepared["newbalanceOrig"] = pd.to_numeric(df["newbalanceOrig"], errors="coerce").fillna(0)
    prepared["oldbalanceDest"] = pd.to_numeric(df["oldbalanceDest"], errors="coerce").fillna(0)
    prepared["newbalanceDest"] = pd.to_numeric(df["newbalanceDest"], errors="coerce").fillna(0)
    prepared["origin_balance_delta"] = prepared["oldbalanceOrg"] - prepared["newbalanceOrig"]
    prepared["dest_balance_delta"] = prepared["newbalanceDest"] - prepared["oldbalanceDest"]
    prepared["origin_balance_error"] = (
        prepared["oldbalanceOrg"] - prepared["newbalanceOrig"] - prepared["amount"]
    ).abs()
    prepared["dest_balance_error"] = (
        prepared["newbalanceDest"] - prepared["oldbalanceDest"] - prepared["amount"]
    ).abs()
    prepared["amount_to_oldbalance_org"] = prepared["amount"] / (
        prepared["oldbalanceOrg"].replace(0, np.nan)
    )
    prepared["amount_to_oldbalance_dest"] = prepared["amount"] / (
        prepared["oldbalanceDest"].replace(0, np.nan)
    )
    prepared["orig_is_customer"] = df["nameOrig"].astype(str).str.startswith("C").astype(int)
    prepared["dest_is_customer"] = df["nameDest"].astype(str).str.startswith("C").astype(int)
    prepared["isFlaggedFraud"] = pd.to_numeric(df["isFlaggedFraud"], errors="coerce").fillna(0)
    prepared = prepared.replace([np.inf, -np.inf], 0).fillna(0)
    return prepared[FEATURE_COLUMNS].astype(np.float32)


def train_and_save_model():
    print("=" * 70)
    print("  Online Payment Fraud Detection - Model Training")
    print("=" * 70)

    dataset_path = os.getenv("DATASET_PATH", DEFAULT_DATASET_PATH)
    print("\n[1/5] Loading dataset ...")
    print(f"      Dataset path  : {dataset_path}")
    df = load_dataset(dataset_path)
    y = pd.to_numeric(df[TARGET_COLUMN], errors="coerce").fillna(0).astype(int)
    print(f"      Total samples : {len(df)}")
    print(f"      Fraud samples : {int(y.sum())} ({y.mean() * 100:.4f}%)")

    print("\n[2/5] Engineering PaySim-style features ...")
    X = prepare_features(df)
    print(f"      Feature count : {len(FEATURE_COLUMNS)}")

    print("\n[3/5] Splitting into train / test (80-20) ...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"      Train size    : {len(X_train)}")
    print(f"      Test size     : {len(X_test)}")

    print("\n[4/5] Training RandomForestClassifier ...")
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=12,
        random_state=42,
        n_jobs=-1,
        class_weight="balanced_subsample",
    )
    model.fit(X_train, y_train)

    print("\n[5/5] Evaluation")
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]
    print(f"      ROC AUC       : {roc_auc_score(y_test, y_prob):.4f}")
    print("\n      Confusion Matrix:")
    print(confusion_matrix(y_test, y_pred))
    print("\n      Classification Report:")
    print(classification_report(y_test, y_pred, target_names=["Legit", "Fraud"], digits=4))

    artifact = {
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
        "type_map": TYPE_MAP,
        "dataset": "online_payment.csv",
        "target_column": TARGET_COLUMN,
    }
    model_path = os.path.join(os.path.dirname(__file__), "fraud_model.pkl")
    joblib.dump(artifact, model_path)
    print(f"\nModel saved to: {model_path}")
    print("=" * 70)


if __name__ == "__main__":
    train_and_save_model()
