"""
train_model.py
==============
Trains a Random Forest classifier for credit card fraud detection.

Uses the public credit card fraud CSV dataset with 30 features:
Time + V1-V28 + Amount, and a Class label.

Outputs:
    - fraud_model.pkl  (trained Random Forest model)
    - Training accuracy and classification report
"""

import os

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split

FEATURE_COLUMNS = ["Time"] + [f"V{i}" for i in range(1, 29)] + ["Amount"]
TARGET_COLUMN = "Class"
DEFAULT_DATASET_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "creditcard.csv")
)


def load_dataset(dataset_path):
    """Load and validate the credit card fraud CSV dataset."""
    if not os.path.exists(dataset_path):
        raise FileNotFoundError(
            f"Dataset not found at {dataset_path}. "
            "Set DATASET_PATH or place creditcard.csv in the project root."
        )

    df = pd.read_csv(dataset_path)
    expected_columns = FEATURE_COLUMNS + [TARGET_COLUMN]
    missing_columns = [column for column in expected_columns if column not in df.columns]
    if missing_columns:
        raise ValueError(
            "Dataset is missing required columns: " + ", ".join(missing_columns)
        )

    return df[expected_columns].copy()


def train_and_save_model():
    print("=" * 60)
    print("  Credit Card Fraud Detection — Model Training")
    print("=" * 60)

    dataset_path = os.getenv("DATASET_PATH", DEFAULT_DATASET_PATH)

    print("\n[1/4] Loading dataset ...")
    print(f"      Dataset path  : {dataset_path}")
    df = load_dataset(dataset_path)
    print(f"      Total samples : {len(df)}")
    print(f"      Fraud samples : {df[TARGET_COLUMN].sum():.0f}  "
          f"({df[TARGET_COLUMN].mean()*100:.3f}%)")

    print("\n[2/4] Splitting into train / test (80-20) ...")
    X = df[FEATURE_COLUMNS].values
    y = df[TARGET_COLUMN].values
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"      Train size: {len(X_train)}  |  Test size: {len(X_test)}")

    print("\n[3/4] Training Random Forest (100 trees) ...")
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        random_state=42,
        n_jobs=-1,
        class_weight="balanced_subsample",
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"\n[4/4] Evaluation")
    print(f"      Accuracy: {accuracy:.4f}")
    print("\n      Classification Report:")
    print(classification_report(y_test, y_pred, target_names=["Legit", "Fraud"]))

    model_path = os.path.join(os.path.dirname(__file__), "fraud_model.pkl")
    joblib.dump(model, model_path)
    print(f"✅  Model saved to: {model_path}")
    print("=" * 60)


if __name__ == "__main__":
    train_and_save_model()
