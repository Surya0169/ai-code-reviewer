import json
import torch
import torch.nn as nn
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import confusion_matrix, classification_report
import joblib
import time

print("Loading dataset...")
with open('severity_dataset.json') as f:
    data = json.load(f)

X = [item['code'] for item in data]
y = [item['label'] for item in data]

le = LabelEncoder()
y_encoded = le.fit_transform(y)

vectorizer = TfidfVectorizer(
    analyzer='char_wb',
    ngram_range=(2, 4),
    max_features=3000,
    sublinear_tf=True
)
X_features = vectorizer.fit_transform(X).toarray()

X_train, X_test, y_train, y_test = train_test_split(
    X_features, y_encoded,
    test_size=0.2, random_state=42, stratify=y_encoded
)

X_train_t = torch.FloatTensor(X_train)
X_test_t  = torch.FloatTensor(X_test)
y_train_t = torch.LongTensor(y_train)
y_test_t  = torch.LongTensor(y_test)

class CodeSeverityNet(nn.Module):
    def __init__(self, input_dim, num_classes):
        super(CodeSeverityNet, self).__init__()
        self.network = nn.Sequential(
            nn.Linear(input_dim, 512),
            nn.BatchNorm1d(512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, num_classes)
        )
    def forward(self, x):
        return self.network(x)

input_dim   = X_train.shape[1]
num_classes = len(le.classes_)
model       = CodeSeverityNet(input_dim, num_classes)

criterion = nn.CrossEntropyLoss()
optimizer = torch.optim.Adam(model.parameters(), lr=0.0005, weight_decay=1e-4)
scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=50, gamma=0.5)

EPOCHS = 200
train_losses, test_losses = [], []
train_accs,   test_accs   = [], []

print("Training...")
for epoch in range(EPOCHS):
    model.train()
    optimizer.zero_grad()
    outputs = model(X_train_t)
    loss    = criterion(outputs, y_train_t)
    loss.backward()
    optimizer.step()
    scheduler.step()

    model.eval()
    with torch.no_grad():
        train_preds = model(X_train_t).argmax(dim=1)
        test_preds  = model(X_test_t).argmax(dim=1)
        test_loss   = criterion(model(X_test_t), y_test_t)
        train_acc   = (train_preds == y_train_t).float().mean().item()
        test_acc    = (test_preds  == y_test_t ).float().mean().item()

    train_losses.append(round(loss.item(), 4))
    test_losses.append(round(test_loss.item(), 4))
    train_accs.append(round(train_acc * 100, 2))
    test_accs.append(round(test_acc  * 100, 2))

    if (epoch+1) % 20 == 0:
        print(f"Epoch {epoch+1}/{EPOCHS} | Train Acc: {train_acc*100:.1f}% | Test Acc: {test_acc*100:.1f}%")

# Confusion matrix
model.eval()
with torch.no_grad():
    final_preds = model(X_test_t).argmax(dim=1).numpy()

cm = confusion_matrix(y_test, final_preds).tolist()
report = classification_report(y_test, final_preds,
    target_names=le.classes_, output_dict=True)

# Inference speed test
start = time.time()
for _ in range(100):
    with torch.no_grad():
        model(torch.FloatTensor(X_test_t[:1]))
inference_ms = round((time.time() - start) / 100 * 1000, 2)

# Count parameters
total_params = sum(p.numel() for p in model.parameters())

# Save everything
metrics = {
    "train_losses":   train_losses,
    "test_losses":    test_losses,
    "train_accs":     train_accs,
    "test_accs":      test_accs,
    "confusion_matrix": cm,
    "class_names":    le.classes_.tolist(),
    "classification_report": report,
    "final_train_acc": train_accs[-1],
    "final_test_acc":  test_accs[-1],
    "total_params":    total_params,
    "inference_ms":    inference_ms,
    "epochs":          EPOCHS,
    "architecture": [
        "Linear(input→512) + BatchNorm + ReLU + Dropout(0.3)",
        "Linear(512→256) + BatchNorm + ReLU + Dropout(0.3)",
        "Linear(256→128) + BatchNorm + ReLU + Dropout(0.2)",
        "Linear(128→64) + ReLU",
        "Linear(64→4) Output"
    ]
}

with open('training_metrics.json', 'w') as f:
    json.dump(metrics, f, indent=2)

torch.save(model.state_dict(), 'severity_nn_model.pth')
joblib.dump(vectorizer, 'vectorizer.pkl')
joblib.dump(le,         'label_encoder.pkl')
joblib.dump({'input_dim': input_dim, 'num_classes': num_classes}, 'model_config.pkl')

print(f"\nFinal Test Accuracy: {test_accs[-1]}%")
print(f"Inference Speed: {inference_ms}ms per sample")
print(f"Total Parameters: {total_params:,}")
print("All metrics saved to training_metrics.json")
