from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import tempfile
import subprocess
import os
import requests
import json
from ml_classifier import classify_severity, classify_code_chunk
from rag import store_repo_embeddings, query_similar_chunks
import shutil

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────
# REQUEST MODELS
# ─────────────────────────────────────────
class RepoRequest(BaseModel):
    repo_url: str

class FixRequest(BaseModel):
    issue: str
    code: str

class ChatRequest(BaseModel):
    question: str
    repo_url: str
    chat_history: list = []

# ─────────────────────────────────────────
# HOME
# ─────────────────────────────────────────
@app.get("/")
def home():
    return {"message": "AI Code Reviewer Backend Running"}

# ─────────────────────────────────────────
# REVIEW ENDPOINT
# ─────────────────────────────────────────
@app.post("/review-github")
def review_github(data: RepoRequest):
    try:
        temp_dir = tempfile.mkdtemp()

        clone = subprocess.run(
            ["git", "clone", data.repo_url, temp_dir],
            capture_output=True,
            text=True
        )

        if clone.returncode != 0:
            def error_stream():
                yield f"data: Git clone failed: {clone.stderr}\n\n"
            return StreamingResponse(
                error_stream(),
                media_type="text/event-stream"
            )

        supported_extensions = (
            ".py", ".js", ".jsx", ".ts", ".tsx",
            ".java", ".cpp", ".c", ".html", ".css",
            ".go", ".rb", ".php", ".swift", ".kt"
        )

        skip_folders = {
            ".git", "node_modules", "__pycache__",
            "venv", "dist", "build", ".next"
        }

        code = ""
        file_count = 0
        MAX_FILES = 15

        for root, dirs, files in os.walk(temp_dir):
            dirs[:] = [d for d in dirs if d not in skip_folders]
            for file in files:
                if file_count >= MAX_FILES:
                    break
                if file.endswith(supported_extensions):
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                        filename = os.path.basename(file_path)
                        print(f"READING: {filename}")
                        code += f"\n\n===== FILE: {filename} =====\n"
                        code += content[:2000]
                        file_count += 1
                    except Exception as e:
                        print(f"READ ERROR: {e}")

        print(f"TOTAL FILES READ: {file_count}")

        if code.strip() == "":
            def no_files_stream():
                yield "data: No supported code files found.\n\n"
            return StreamingResponse(
                no_files_stream(),
                media_type="text/event-stream"
            )

        code = code[:12000]

        prompt = (
            "You are an expert Senior Software Engineer and Security Reviewer.\n"
            "Analyze this code professionally and strictly.\n\n"
            "STRICT RULES:\n"
            "- Only report REAL issues you can see in the code\n"
            "- Do NOT hallucinate or invent problems\n"
            "- Every issue must have a severity tag: [CRITICAL], [HIGH], [MEDIUM], or [LOW]\n"
            "- Every issue must have a short fix suggestion\n\n"
            "OUTPUT FORMAT:\n\n"
            "## BUGS\n"
            "- [HIGH] Description\n"
            "  Fix: how to fix\n"
            "  Bad: bad_code_example\n"
            "  Good: fixed_code_example\n\n"
            "## SECURITY ISSUES\n"
            "- [CRITICAL] Description\n"
            "  Fix: short fix\n\n"
            "## PERFORMANCE ISSUES\n"
            "- [MEDIUM] Description\n"
            "  Fix: short fix\n\n"
            "## SCALABILITY ISSUES\n"
            "- [LOW] Description\n"
            "  Fix: short fix\n\n"
            "## CODE QUALITY\n"
            "- [LOW] Description\n"
            "  Fix: short fix\n\n"
            "## BEST PRACTICES\n"
            "- bullet points only\n\n"
            "## SUMMARY\n"
            "Critical Issues: X\n"
            "High Issues: X\n"
            "Medium Issues: X\n"
            "Low Issues: X\n"
            "Overall Health: Good / Needs Improvement / Critical\n\n"
            "CODE:\n"
            + code
        )

        def stream_review():
            try:
                response = requests.post(
                    "http://127.0.0.1:11434/api/generate",
                    json={
                        "model": "qwen2.5-coder:7b",
                        "prompt": prompt,
                        "stream": True,
                        "options": {"temperature": 0.2}
                    },
                    stream=True,
                    timeout=120
                )
                for line in response.iter_lines():
                    if line:
                        try:
                            chunk = json.loads(line.decode("utf-8"))
                            token = chunk.get("response", "")
                            if token:
                                yield f"data: {json.dumps({'token': token})}\n\n"
                            if chunk.get("done"):
                                yield "data: [DONE]\n\n"
                                break
                        except Exception as e:
                            print(f"CHUNK ERROR: {e}")
            except Exception as e:
                yield f"data: {json.dumps({'token': f'Error: {str(e)}'})}\n\n"
                yield "data: [DONE]\n\n"
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)

        return StreamingResponse(
            stream_review(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    except Exception as e:
        import traceback
        print("EXCEPTION:", traceback.format_exc())
        def error_stream():
            yield f"data: {json.dumps({'token': str(e)})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")


# ─────────────────────────────────────────
# AUTO FIX ENDPOINT
# ─────────────────────────────────────────
@app.post("/generate-fix")
def generate_fix(data: FixRequest):
    try:
        prompt = (
            "You are an expert software engineer.\n"
            "A code reviewer found this issue:\n\n"
            "ISSUE:\n"
            + data.issue +
            "\n\nORIGINAL CODE:\n"
            + data.code +
            "\n\nYour job:\n"
            "1. Show the FIXED version of the code\n"
            "2. Explain what you changed in 2-3 lines\n"
            "3. Show before and after clearly\n\n"
            "OUTPUT FORMAT:\n\n"
            "## What Was Wrong\n"
            "short explanation here\n\n"
            "## Before (Bad Code)\n"
            "show the bad code here as plain text\n\n"
            "## After (Fixed Code)\n"
            "show the fixed code here as plain text\n\n"
            "## What Changed\n"
            "- bullet point 1\n"
            "- bullet point 2\n"
        )

        def stream_fix():
            try:
                response = requests.post(
                    "http://127.0.0.1:11434/api/generate",
                    json={
                        "model": "qwen2.5-coder:7b",
                        "prompt": prompt,
                        "stream": True,
                        "options": {"temperature": 0.2}
                    },
                    stream=True
                )
                for line in response.iter_lines():
                    if line:
                        try:
                            chunk = json.loads(line.decode("utf-8"))
                            token = chunk.get("response", "")
                            if token:
                                yield f"data: {json.dumps({'token': token})}\n\n"
                            if chunk.get("done"):
                                yield "data: [DONE]\n\n"
                                break
                        except Exception as e:
                            print(f"CHUNK ERROR: {e}")
            except Exception as e:
                yield f"data: {json.dumps({'token': f'Fix Error: {str(e)}'})}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            stream_fix(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    except Exception as e:
        import traceback
        print("EXCEPTION:", traceback.format_exc())
        def error_stream():
            yield f"data: {json.dumps({'token': str(e)})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")


# ─────────────────────────────────────────
# CHAT WITH CODE ENDPOINT (RAG)
# ─────────────────────────────────────────
@app.post("/chat-with-code")
def chat_with_code(data: ChatRequest):
    print("CHAT REQUEST RECEIVED")
    print("Question:", data.question)
    print("Repo URL:", data.repo_url)
    try:
        if not data.repo_url:
            def error_stream():
                yield f"data: {json.dumps({'token': 'Error: No repo URL provided. Please review a repository first.'})}\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(
                error_stream(),
                media_type="text/event-stream"
            )
        history_text = ""
        for msg in data.chat_history[-6:]:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "user":
                history_text += f"User: {content}\n"
            elif role == "assistant":
                history_text += f"Assistant: {content}\n"

        prompt = (
            "You are an expert AI coding assistant.\n"
            "You have been given a codebase to analyze.\n"
            "Answer the user question about this code.\n\n"
            "RULES:\n"
            "- Be specific and reference actual code from the context\n"
            "- Keep answers concise and practical\n"
            "- If you see a bug or issue mention it clearly\n"
            "- Use [CRITICAL], [HIGH], [MEDIUM], [LOW] tags when relevant\n\n"
            "CODE CONTEXT:\n"
            + query_similar_chunks(data.repo_url, data.question) +
            "\n\nCHAT HISTORY:\n"
            + history_text +
            "\nUser Question: "
            + data.question +
            "\n\nAnswer:"
        )

        def stream_chat():
            try:
                response = requests.post(
                    "http://127.0.0.1:11434/api/generate",
                    json={
                        "model": "qwen2.5-coder:7b",
                        "prompt": prompt,
                        "stream": True,
                        "options": {"temperature": 0.2}
                    },
                    stream=True,
                    timeout=120
                )
                for line in response.iter_lines():
                    if line:
                        try:
                            chunk = json.loads(line.decode("utf-8"))
                            token = chunk.get("response", "")
                            if token:
                                yield f"data: {json.dumps({'token': token})}\n\n"
                            if chunk.get("done"):
                                yield "data: [DONE]\n\n"
                                break
                        except Exception as e:
                            print(f"CHUNK ERROR: {e}")
            except Exception as e:
                yield f"data: {json.dumps({'token': f'Chat Error: {str(e)}'})}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            stream_chat(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    except Exception as e:
        import traceback
        print("EXCEPTION:", traceback.format_exc())
        def error_stream():
            yield f"data: {json.dumps({'token': str(e)})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")
@app.post("/classify-severity")
def classify_severity_endpoint(data: dict):
    code = data.get("code", "")
    if not code:
        return {"error": "No code provided"}
    results = classify_code_chunk(code)
    return {
        "results": results,
        "ml_powered": True,
        "model": "RandomForest + TF-IDF (char n-grams)"
    }

@app.post("/ml-scan")
async def ml_scan(data: dict):
    import tempfile, subprocess, os
    repo_url = data.get("repo_url", "")
    if not repo_url:
        return {"error": "No repo URL"}
    temp_dir = tempfile.mkdtemp()
    subprocess.run(["git", "clone", "--depth", "1", repo_url, temp_dir],
                   capture_output=True, timeout=30)
    all_results = []
    files_scanned = 0
    extensions = (".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".cpp", ".go", ".c", ".h", ".cs", ".rb", ".php")
    for root, dirs, files in os.walk(temp_dir):
        dirs[:] = [d for d in dirs if d not in [".git", "node_modules", "__pycache__"]]
        for file in files:
            if file.endswith(extensions):
                try:
                    with open(os.path.join(root, file), "r", errors="ignore") as fh:
                        code = fh.read()
                    results = classify_code_chunk(code)
                    top = [r for r in results if r["confidence"] > 70][:10]
                    for r in top:
                        r["file"] = file
                        all_results.append(r)
                    files_scanned += 1
                except Exception as e:
                    print("File error:", e)
    all_results.sort(key=lambda x: ["CRITICAL","HIGH","MEDIUM","LOW"].index(x["severity"]))
    summary = {
        "CRITICAL": len([r for r in all_results if r["severity"] == "CRITICAL"]),
        "HIGH":     len([r for r in all_results if r["severity"] == "HIGH"]),
        "MEDIUM":   len([r for r in all_results if r["severity"] == "MEDIUM"]),
        "LOW":      len([r for r in all_results if r["severity"] == "LOW"]),
    }
    return {
        "results":       all_results[:50],
        "summary":       summary,
        "files_scanned": files_scanned,
        "total_issues":  len(all_results),
        "ml_powered":    True,
        "model":         "PyTorch Neural Network (4-layer deep learning)"
    }

@app.get("/model-metrics")
def get_model_metrics():
    import json, os
    path = os.path.join(os.path.dirname(__file__), 'training_metrics.json')
    if not os.path.exists(path):
        return {"error": "No metrics found. Train the model first."}
    with open(path) as f:
        return json.load(f)

@app.post("/ml-score")
async def ml_score(data: dict):
    import tempfile, subprocess, os
    repo_url = data.get("repo_url", "")
    if not repo_url:
        return {"error": "No repo URL"}
    
    temp_dir = tempfile.mkdtemp()
    subprocess.run(["git", "clone", "--depth", "1", repo_url, temp_dir],
                   capture_output=True, timeout=30)
    
    extensions = (".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".cpp", ".go", ".c", ".h", ".cs", ".rb", ".php")
    file_scores = []
    total_issues = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    
    for root, dirs, files in os.walk(temp_dir):
        dirs[:] = [d for d in dirs if d not in [".git", "node_modules", "__pycache__"]]
        for file in files:
            if file.endswith(extensions):
                try:
                    with open(os.path.join(root, file), "r", errors="ignore") as fh:
                        code = fh.read()
                    lines = [l.strip() for l in code.splitlines() if len(l.strip()) > 10]
                    if not lines:
                        continue
                    
                    results = classify_code_chunk(code)
                    
                    c = len([r for r in results if r["severity"] == "CRITICAL"])
                    h = len([r for r in results if r["severity"] == "HIGH"])
                    m = len([r for r in results if r["severity"] == "MEDIUM"])
                    l = len([r for r in results if r["severity"] == "LOW"])
                    
                    total_issues["CRITICAL"] += c
                    total_issues["HIGH"]     += h
                    total_issues["MEDIUM"]   += m
                    total_issues["LOW"]      += l
                    
                    total_lines = len(lines)
                    penalty = (c * 20 + h * 10 + m * 5 + l * 1)
                    score = max(0, min(100, 100 - (penalty / total_lines * 10)))
                    
                    if score >= 90:   grade = "A"
                    elif score >= 80: grade = "B"
                    elif score >= 70: grade = "C"
                    elif score >= 60: grade = "D"
                    else:             grade = "F"
                    
                    file_scores.append({
                        "file":     file,
                        "score":    round(score, 1),
                        "grade":    grade,
                        "critical": c,
                        "high":     h,
                        "medium":   m,
                        "low":      l,
                    })
                except Exception as e:
                    print("Error:", e)
    
    if not file_scores:
        return {"error": "No files scanned"}
    
    file_scores.sort(key=lambda x: x["score"])
    avg_score = round(sum(f["score"] for f in file_scores) / len(file_scores), 1)
    
    if avg_score >= 90:   overall_grade = "A"
    elif avg_score >= 80: overall_grade = "B"
    elif avg_score >= 70: overall_grade = "C"
    elif avg_score >= 60: overall_grade = "D"
    else:                 overall_grade = "F"
    
    fix_hours = round((total_issues["CRITICAL"] * 2 + total_issues["HIGH"] * 1 + total_issues["MEDIUM"] * 0.5) / 8, 1)
    
    return {
        "overall_score":  avg_score,
        "overall_grade":  overall_grade,
        "fix_hours":      fix_hours,
        "files_scanned":  len(file_scores),
        "total_issues":   total_issues,
        "file_scores":    file_scores[:20],
        "ml_powered":     True
    }
