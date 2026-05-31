from sklearn.feature_extraction.text import CountVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
import joblib

texts = [
    "This code has security issue",
    "This loop is slow",
    "Variable names are unclear",
]

labels = [
    "security",
    "optimization",
    "readability",
]

model = Pipeline([
    ("vectorizer", CountVectorizer()),
    ("classifier", MultinomialNB())
])

model.fit(texts, labels)

joblib.dump(model, "review_model.pkl")

print("Model trained successfully")