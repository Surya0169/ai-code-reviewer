import torch
import torch.nn as nn
import joblib
import os

BASE = os.path.dirname(__file__)

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

_model      = None
_vectorizer = None
_le         = None

def load_model():
    global _model, _vectorizer, _le
    if _model is None:
        try:
            config      = joblib.load(os.path.join(BASE, 'model_config.pkl'))
            _vectorizer = joblib.load(os.path.join(BASE, 'vectorizer.pkl'))
            _le         = joblib.load(os.path.join(BASE, 'label_encoder.pkl'))
            _model      = CodeSeverityNet(config['input_dim'], config['num_classes'])
            _model.load_state_dict(torch.load(
                os.path.join(BASE, 'severity_nn_model.pth'),
                map_location='cpu'
            ))
            _model.eval()
            print("Deep Learning model loaded!")
        except Exception as e:
            print(f"Model load error: {e}")
    return _model, _vectorizer, _le

def classify_severity(code_line: str) -> dict:
    model, vectorizer, le = load_model()
    if model is None:
        return {"label": "MEDIUM", "confidence": 0.0, "ml_powered": False}
    feat   = vectorizer.transform([code_line]).toarray()
    tensor = torch.FloatTensor(feat)
    with torch.no_grad():
        out   = model(tensor)
        probs = torch.softmax(out, dim=1)
        pred  = probs.argmax(dim=1).item()
        conf  = probs.max().item() * 100
    return {
        "label":      str(le.classes_[pred]),  # fix np.str_
        "confidence": round(float(conf), 1),
        "ml_powered": True
    }

def classify_code_chunk(code: str) -> list:
    results = []
    for line in code.split('\n'):
        line = line.strip()
        if len(line) > 10:
            result = classify_severity(line)
            if result['confidence'] > 50:  # lowered from 60 to 30
                results.append({
                    "line":       line,
                    "severity":   result['label'],
                    "confidence": result['confidence']
                })
    return sorted(results, key=lambda x:
        ['CRITICAL','HIGH','MEDIUM','LOW'].index(x['severity']))
