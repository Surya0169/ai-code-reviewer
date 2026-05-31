import joblib

model = joblib.load("review_model.pkl")

def classify_review(text):

    prediction = model.predict([text])

    return prediction[0]