# 🤖 AI Code Reviewer

An ML-powered code review system combining Deep Learning and LLM.

## Features
- ⚡ Fast ML Scan — PyTorch Neural Network (1.7M params)
- 🔍 LLM Review — Qwen2.5-Coder streaming review
- 📊 ML Dashboard — Loss curves, confusion matrix, F1 scores
- 💬 RAG Chat — ChromaDB vector search
- 🔧 Auto Fix — AI-generated fixes
- 🎯 ML Quality Scorer — A/B/C/D/F grades

## ML Stack
- PyTorch Neural Network (4 layers)
- TF-IDF char n-gram features
- ChromaDB embeddings
- Sentence Transformers

## Tech Stack
- Backend: FastAPI, Python
- Frontend: React, Vite
- ML: PyTorch, scikit-learn
- LLM: Qwen2.5-Coder

## Run
```bash
cd backend && uvicorn main:app --reload
cd frontend && npm run dev
```
