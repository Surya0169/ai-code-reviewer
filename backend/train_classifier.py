import json
import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report

# Load dataset
with open('severity_dataset.json') as f:
    data = json.load(f)

X = [item['code'] for item in data]
y = [item['label'] for item in data]

# Split
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# Build pipeline
pipeline = Pipeline([
    ('tfidf', TfidfVectorizer(
        analyzer='char_wb',
        ngram_range=(2, 4),
        max_features=5000,
        sublinear_tf=True
    )),
    ('clf', RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        random_state=42,
        class_weight='balanced'
    ))
])

# Train
pipeline.fit(X_train, y_train)

# Evaluate
y_pred = pipeline.predict(X_test)
print("\n=== Classification Report ===")
print(classification_report(y_test, y_pred))

# Cross validation
scores = cross_val_score(pipeline, X, y, cv=5, scoring='accuracy')
print(f"Cross-val accuracy: {scores.mean():.2f} (+/- {scores.std():.2f})")

# Save model
joblib.dump(pipeline, 'severity_model.pkl')
print("\nModel saved to severity_model.pkl")

# Test predictions
test_cases = [
    "eval(user_input)",
    "except: pass",
    "# TODO fix later",
    "unused_var = True"
]
print("\n=== Sample Predictions ===")
for code in test_cases:
    pred = pipeline.predict([code])[0]
    proba = pipeline.predict_proba([code])[0]
    confidence = max(proba) * 100
    print(f"Code: {code[:40]}")
    print(f"Prediction: {pred} ({confidence:.1f}% confidence)\n")
