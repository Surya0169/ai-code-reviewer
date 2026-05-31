import { useState, useRef } from "react";

function App() {
  const [repoUrl, setRepoUrl]           = useState("");
  const [review, setReview]             = useState("");
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  const [scores, setScores]             = useState(null);
  const [fixOutput, setFixOutput]       = useState("");
  const [fixLoading, setFixLoading]     = useState(false);
  const [fixIssue, setFixIssue]         = useState("");
  const [showFixPanel, setShowFixPanel] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput]       = useState("");
  const [chatLoading, setChatLoading]   = useState(false);
  const [activeTab, setActiveTab]       = useState("review");
  const [mlScanResult, setMlScanResult] = useState(null);
  const [mlScanLoading, setMlScanLoading] = useState(false);
  const [scanMode, setScanMode] = useState("llm");
  const [scanTime, setScanTime] = useState(null);
  const [metrics, setMetrics]   = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const reviewRef  = useRef("");
  const fixRef     = useRef("");
  const chatRef    = useRef("");
  const repoUrlRef = useRef("");

  const calculateScores = (text) => ({
    critical: (text.match(/\[CRITICAL\]/g) || []).length,
    high:     (text.match(/\[HIGH\]/g)     || []).length,
    medium:   (text.match(/\[MEDIUM\]/g)   || []).length,
    low:      (text.match(/\[LOW\]/g)      || []).length,
  });

  const getHealthLabel = (s) => {
    if (s.critical > 0) return { label: "🔴 Critical Risk",     color: "#ff4444" };
    if (s.high > 2)     return { label: "🟠 Needs Major Work",  color: "#ff8800" };
    if (s.medium > 3)   return { label: "🟡 Needs Improvement", color: "#facc15" };
    return                     { label: "🟢 Good Quality",      color: "#4ade80" };
  };

  // ─────────────────────────────────────────
  // FETCH MODEL METRICS
  // ─────────────────────────────────────────
  const fetchMetrics = async () => {
    setMetricsLoading(true);
    setActiveTab("dashboard");
    try {
      const res  = await fetch("http://127.0.0.1:8000/model-metrics");
      const data = await res.json();
      if (data && data.train_losses) {
        setMetrics(data);
      } else {
        alert("Model not trained yet. Run: python3 train_deep_model.py");
      }
    } catch (err) {
      alert("Backend not running! Start it with: uvicorn main:app --reload");
    } finally {
      setMetricsLoading(false);
    }
  };

  // ─────────────────────────────────────────
  // UNIFIED SCAN — routes to LLM or ML
  // ─────────────────────────────────────────
  const handleScan = () => {
    setScanTime(null);
    if (scanMode === "ml") {
      runMlScan();
    } else {
      reviewRepo();
    }
  };


  const reviewRepo = async () => {
    if (!repoUrl) { alert("Enter a GitHub URL"); return; }
    const startTime = Date.now();
    setLoading(true);
    setReview("");
    setError("");
    setScores(null);
    setFixOutput("");
    setShowFixPanel(false);
    setChatMessages([]);
    reviewRef.current  = "";
    repoUrlRef.current = repoUrl;
    setActiveTab("review");

    try {
      const response = await fetch("http://127.0.0.1:8000/review-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl }),
      });

      const reader  = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.replace("data: ", "").trim();
            if (data === "[DONE]") {
              setScores(calculateScores(reviewRef.current));
              setScanTime(((Date.now() - startTime) / 1000).toFixed(1));
              setLoading(false);
              break;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.token) {
                reviewRef.current += parsed.token;
                setReview(reviewRef.current);
              }
            } catch {
              reviewRef.current += data;
              setReview(reviewRef.current);
            }
          }
        }
      }
    } catch (err) {
      setError("Connection failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────
  // ML SCAN
  // ─────────────────────────────────────────
  const runMlScan = async () => {
    if (!repoUrl) { alert("Enter a GitHub URL"); return; }
    const startTime = Date.now();
    setMlScanLoading(true);
    setMlScanResult(null);
    setActiveTab("mlscan");
    try {
      const res = await fetch("http://127.0.0.1:8000/ml-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl })
      });
      const data = await res.json();
      setScanTime(((Date.now() - startTime) / 1000).toFixed(1));
      setMlScanResult(data);
    } catch (err) {
      alert("ML Scan failed: " + err.message);
    } finally {
      setMlScanLoading(false);
    }
  };

  // ─────────────────────────────────────────
  // AUTO FIX
  // ─────────────────────────────────────────
  const generateFix = async (issueText) => {
    setFixIssue(issueText);
    setFixOutput("");
    setFixLoading(true);
    setShowFixPanel(true);
    setActiveTab("fix");
    fixRef.current = "";

    try {
      const response = await fetch("http://127.0.0.1:8000/generate-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue: issueText,
          code: reviewRef.current.slice(0, 3000)
        }),
      });

      const reader  = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.replace("data: ", "").trim();
            if (data === "[DONE]") { setFixLoading(false); break; }
            try {
              const parsed = JSON.parse(data);
              if (parsed.token) {
                fixRef.current += parsed.token;
                setFixOutput(fixRef.current);
              }
            } catch {
              fixRef.current += data;
              setFixOutput(fixRef.current);
            }
          }
        }
      }
    } catch (err) {
      setFixOutput("Fix failed: " + err.message);
    } finally {
      setFixLoading(false);
    }
  };

  // ─────────────────────────────────────────
  // CHAT
  // ─────────────────────────────────────────
  const sendChat = async () => {
    if (!chatInput.trim()) return;
    if (!repoUrl) { alert("Please review a repository first!"); return; }

    const userMessage    = { role: "user", content: chatInput };
    const updatedHistory = [...chatMessages, userMessage];
    setChatMessages(updatedHistory);
    setChatInput("");
    setChatLoading(true);
    chatRef.current = "";

    try {
      const response = await fetch("http://127.0.0.1:8000/chat-with-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:     chatInput,
          repo_url:     repoUrl,
          chat_history: updatedHistory
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        setChatMessages([...updatedHistory, { role: "assistant", content: "Error: " + errText }]);
        return;
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      setChatMessages([...updatedHistory, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.replace("data: ", "").trim();
            if (data === "[DONE]") {
              setChatLoading(false);
              setChatMessages([...updatedHistory, { role: "assistant", content: chatRef.current }]);
              break;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.token) {
                chatRef.current += parsed.token;
                setChatMessages([...updatedHistory, { role: "assistant", content: chatRef.current }]);
              }
            } catch {
              chatRef.current += data;
              setChatMessages([...updatedHistory, { role: "assistant", content: chatRef.current }]);
            }
          }
        }
      }
    } catch (err) {
      setChatMessages([...updatedHistory, { role: "assistant", content: "Chat failed: " + err.message }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ─────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────
  const renderReview = (text) => {
    return text.split("\n").map((line, index) => {
      let color = "#e2e8f0";
      const isIssue = line.match(/\[(CRITICAL|HIGH|MEDIUM|LOW)\]/);
      if (line.includes("[CRITICAL]"))    color = "#ff4444";
      else if (line.includes("[HIGH]"))   color = "#ff8800";
      else if (line.includes("[MEDIUM]")) color = "#facc15";
      else if (line.includes("[LOW]"))    color = "#4ade80";
      else if (line.startsWith("##"))     color = "#60a5fa";
      else if (line.includes("Bad:"))     color = "#f87171";
      else if (line.includes("Good:"))    color = "#4ade80";
      else if (line.includes("Fix:"))     color = "#a78bfa";

      return (
        <div key={index} style={{
          display: "flex", alignItems: "flex-start", gap: "8px",
          marginBottom: line.startsWith("##") ? "12px" : "2px",
          marginTop:    line.startsWith("##") ? "20px" : "0px",
        }}>
          <div style={{
            color, flex: 1,
            fontWeight: line.startsWith("##") ? "bold"  : "normal",
            fontSize:   line.startsWith("##") ? "16px"  : "14px",
          }}>
            {line}
          </div>
          {isIssue && !loading && (
            <button
              onClick={() => generateFix(line)}
              style={{
                background: "#1e3a5f", border: "1px solid #3b82f6",
                color: "#60a5fa", padding: "2px 10px",
                borderRadius: "6px", cursor: "pointer",
                fontSize: "11px", whiteSpace: "nowrap", flexShrink: 0
              }}
            >
              🔧 Fix
            </button>
          )}
        </div>
      );
    });
  };

  const renderFix = (text) => {
    return text.split("\n").map((line, index) => {
      let color = "#e2e8f0";
      if (line.startsWith("##"))                                   color = "#60a5fa";
      else if (line.includes("Before") || line.includes("Bad"))   color = "#f87171";
      else if (line.includes("After")  || line.includes("Fixed")) color = "#4ade80";
      else if (line.includes("Changed"))                           color = "#a78bfa";
      else if (line.startsWith("-"))                               color = "#94a3b8";
      return (
        <div key={index} style={{
          color,
          fontWeight:   line.startsWith("##") ? "bold" : "normal",
          fontSize:     line.startsWith("##") ? "15px" : "13px",
          marginBottom: line.startsWith("##") ? "10px" : "2px",
          marginTop:    line.startsWith("##") ? "16px" : "0",
        }}>
          {line}
        </div>
      );
    });
  };

  const tabStyle = (tab) => ({
    padding: "10px 20px",
    background: activeTab === tab ? "#3b82f6" : "#1e293b",
    color:      activeTab === tab ? "white"   : "#94a3b8",
    border: "none", borderRadius: "8px",
    cursor: "pointer", fontSize: "14px",
    fontWeight: activeTab === tab ? "bold" : "normal"
  });

  return (
    <div style={{
      minHeight: "100vh", background: "#0f172a",
      color: "#e2e8f0", fontFamily: "monospace",
      padding: "40px", maxWidth: "1000px", margin: "0 auto"
    }}>

      {/* Header */}
      <h1 style={{ color: "#60a5fa", marginBottom: "8px", fontSize: "28px" }}>
        🤖 AI Code Reviewer
      </h1>
      <p style={{ color: "#64748b", marginBottom: "30px" }}>
        Powered by Qwen2.5-Coder • Streaming • Auto Fix • RAG Chat • Deep Learning
      </p>

      {/* Mode Selector */}
      <div style={{
        display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap"
      }}>
        <p style={{ color: "#94a3b8", margin: "0", alignSelf: "center", fontSize: "14px" }}>
          Select Scan Mode:
        </p>
        {[
          { value: "llm", label: "🔍 LLM Review", desc: "Deep analysis • 30-60s", color: "#3b82f6" },
          { value: "ml",  label: "⚡ ML Scan",    desc: "Neural network • 3-5s",  color: "#7c3aed" },
        ].map((mode) => (
          <div
            key={mode.value}
            onClick={() => setScanMode(mode.value)}
            style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "12px 20px", borderRadius: "10px", cursor: "pointer",
              background: scanMode === mode.value ? "#1e293b" : "#0f172a",
              border: `2px solid ${scanMode === mode.value ? mode.color : "#334155"}`,
              transition: "all 0.2s"
            }}
          >
            <div style={{
              width: "18px", height: "18px", borderRadius: "50%",
              border: `2px solid ${mode.color}`,
              background: scanMode === mode.value ? mode.color : "transparent",
              flexShrink: 0
            }} />
            <div>
              <div style={{ color: "#e2e8f0", fontWeight: "bold", fontSize: "14px" }}>
                {mode.label}
              </div>
              <div style={{ color: "#64748b", fontSize: "11px" }}>{mode.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Input + Scan Button */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Enter GitHub repo URL..."
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleScan()}
          style={{
            flex: 1, padding: "12px 16px", borderRadius: "8px",
            border: "1px solid #334155", background: "#1e293b",
            color: "#e2e8f0", fontSize: "15px", outline: "none"
          }}
        />
        <button
          onClick={handleScan}
          disabled={loading || mlScanLoading}
          style={{
            padding: "12px 28px",
            background: loading || mlScanLoading ? "#334155"
              : scanMode === "ml" ? "#7c3aed" : "#3b82f6",
            color: "white", border: "none", borderRadius: "8px",
            cursor: loading || mlScanLoading ? "not-allowed" : "pointer",
            fontSize: "15px", fontWeight: "bold"
          }}
        >
          {loading || mlScanLoading
            ? "⏳ Scanning..."
            : scanMode === "ml" ? "⚡ ML Scan" : "🔍 LLM Review"}
        </button>
      </div>

      {/* Scan Time Badge */}
      {scanTime && (
        <div style={{
          display: "inline-block", marginBottom: "16px",
          background: scanMode === "ml" ? "#1a0a2e" : "#0f172a",
          border: `1px solid ${scanMode === "ml" ? "#7c3aed" : "#3b82f6"}`,
          borderRadius: "20px", padding: "6px 16px",
          color: scanMode === "ml" ? "#a78bfa" : "#60a5fa",
          fontSize: "13px"
        }}>
          {scanMode === "ml" ? "⚡ ML Scan" : "🔍 LLM Review"} completed in {scanTime}s
        </div>
      )}

      {/* Feature Tags */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px", flexWrap: "wrap" }}>
        {[
          "✅ Real-time Streaming",
          "✅ Auto Fix Generator",
          "✅ RAG Vector Search",
          "✅ ChromaDB Embeddings",
          "✅ Severity Detection",
          "✅ PyTorch Neural Network",
          "✅ AI Agent Pipeline",
        ].map((tag) => (
          <span key={tag} style={{
            background: "#1e293b", border: "1px solid #334155",
            padding: "4px 12px", borderRadius: "20px",
            fontSize: "12px", color: "#94a3b8"
          }}>
            {tag}
          </span>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{
          background: "#1e293b", padding: "12px 20px",
          borderRadius: "8px", marginBottom: "20px", color: "#60a5fa"
        }}>
          ⚡ Cloning repo, storing embeddings, streaming review...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: "#450a0a", padding: "15px", borderRadius: "8px",
          color: "#fca5a5", marginBottom: "20px"
        }}>
          ❌ {error}
        </div>
      )}

      {/* Score Dashboard */}
      {scores && (
        <div style={{
          background: "#1e293b", border: "1px solid #334155",
          borderRadius: "12px", padding: "24px", marginBottom: "20px"
        }}>
          <h2 style={{ color: "#60a5fa", marginTop: 0, marginBottom: "20px" }}>
            📊 Code Health Dashboard
          </h2>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
            {[
              { label: "CRITICAL", count: scores.critical, color: "#ff4444", bg: "#2d0a0a" },
              { label: "HIGH",     count: scores.high,     color: "#ff8800", bg: "#2d1a0a" },
              { label: "MEDIUM",   count: scores.medium,   color: "#facc15", bg: "#2d2a0a" },
              { label: "LOW",      count: scores.low,      color: "#4ade80", bg: "#0a2d0f" },
            ].map(({ label, count, color, bg }) => (
              <div key={label} style={{
                background: bg, border: `1px solid ${color}40`,
                borderRadius: "10px", padding: "16px 24px",
                textAlign: "center", flex: 1, minWidth: "80px"
              }}>
                <div style={{ fontSize: "32px", fontWeight: "bold", color }}>{count}</div>
                <div style={{ fontSize: "12px", color, marginTop: "4px", fontWeight: "bold" }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{
              background: "#0f172a", borderRadius: "8px",
              padding: "12px 20px", flex: 1, textAlign: "center"
            }}>
              <div style={{ color: "#94a3b8", fontSize: "13px" }}>Total Issues</div>
              <div style={{ color: "#e2e8f0", fontSize: "22px", fontWeight: "bold" }}>
                {scores.critical + scores.high + scores.medium + scores.low}
              </div>
            </div>
            <div style={{
              background: "#0f172a", borderRadius: "8px",
              padding: "12px 20px", flex: 2, textAlign: "center"
            }}>
              <div style={{ color: "#94a3b8", fontSize: "13px" }}>Overall Health</div>
              <div style={{
                fontSize: "18px", fontWeight: "bold", marginTop: "4px",
                color: getHealthLabel(scores).color
              }}>
                {getHealthLabel(scores).label}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TABS */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
        {(review && !loading) && (
          <>
            <button onClick={() => setActiveTab("review")} style={tabStyle("review")}>📋 Review</button>
            <button onClick={() => setActiveTab("fix")}    style={tabStyle("fix")}>🔧 Auto Fix</button>
            <button onClick={() => setActiveTab("chat")}   style={tabStyle("chat")}>💬 RAG Chat</button>
            <button onClick={() => setActiveTab("mlscan")} style={tabStyle("mlscan")}>⚡ ML Scan</button>
          </>
        )}
        <button onClick={fetchMetrics} style={tabStyle("dashboard")}>📊 ML Dashboard</button>
      </div>

      {/* TAB: REVIEW */}
      {(activeTab === "review" || loading) && review && (
        <div style={{
          background: "#1e293b", padding: "24px", borderRadius: "8px",
          lineHeight: "1.8", overflowX: "auto",
          border: "1px solid #334155", marginBottom: "20px"
        }}>
          <h2 style={{ color: "#60a5fa", marginBottom: "20px", marginTop: 0 }}>
            📋 Review Results
            {loading && (
              <span style={{ color: "#64748b", fontSize: "13px", marginLeft: "12px" }}>
                ● streaming...
              </span>
            )}
          </h2>
          {!loading && (
            <p style={{ color: "#64748b", fontSize: "12px", marginBottom: "16px" }}>
              💡 Click <strong style={{ color: "#60a5fa" }}>🔧 Fix</strong> next to any issue to auto-generate a fix
            </p>
          )}
          {renderReview(review)}
        </div>
      )}

      {/* TAB: FIX */}
      {activeTab === "fix" && (
        <div style={{
          background: "#0f2a1a", border: "1px solid #4ade80",
          borderRadius: "12px", padding: "24px", marginBottom: "20px"
        }}>
          <h2 style={{ color: "#4ade80", marginTop: 0, marginBottom: "16px" }}>
            🔧 Auto Fix Generator
          </h2>
          {!showFixPanel && (
            <p style={{ color: "#64748b" }}>
              Go to Review tab and click <strong style={{ color: "#60a5fa" }}>🔧 Fix</strong> next to any issue.
            </p>
          )}
          {fixIssue && (
            <div style={{
              background: "#1e293b", padding: "12px 16px",
              borderRadius: "8px", marginBottom: "16px",
              color: "#ff8800", fontSize: "13px"
            }}>
              <strong>Issue:</strong> {fixIssue}
            </div>
          )}
          {fixLoading && (
            <div style={{ color: "#4ade80", marginBottom: "12px" }}>
              ⚡ Generating fix in real-time...
            </div>
          )}
          {fixOutput && (
            <div style={{
              background: "#0a1f10", padding: "20px",
              borderRadius: "8px", lineHeight: "1.8"
            }}>
              {renderFix(fixOutput)}
            </div>
          )}
        </div>
      )}

      {/* TAB: RAG CHAT */}
      {activeTab === "chat" && (
        <div style={{
          background: "#1e293b", border: "1px solid #334155",
          borderRadius: "12px", padding: "24px", marginBottom: "20px"
        }}>
          <h2 style={{ color: "#60a5fa", marginTop: 0, marginBottom: "4px" }}>
            💬 RAG Chat with Code
          </h2>
          <p style={{ color: "#64748b", fontSize: "12px", marginBottom: "20px" }}>
            Uses ChromaDB vector search to find relevant code chunks before answering.
          </p>
          {chatMessages.length === 0 && (
            <div style={{ marginBottom: "20px" }}>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginBottom: "10px" }}>💡 Try asking:</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {[
                  "What is the most critical security issue?",
                  "How do I fix the SQL injection?",
                  "What are the main performance problems?",
                  "Summarize all code quality issues",
                  "Which file has the most bugs?",
                  "What should I fix first?",
                ].map((q) => (
                  <button key={q} onClick={() => setChatInput(q)} style={{
                    background: "#0f172a", border: "1px solid #334155",
                    color: "#94a3b8", padding: "6px 12px",
                    borderRadius: "20px", cursor: "pointer", fontSize: "12px"
                  }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ minHeight: "200px", maxHeight: "400px", overflowY: "auto", marginBottom: "16px" }}>
            {chatMessages.map((msg, index) => (
              <div key={index} style={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                marginBottom: "12px"
              }}>
                <div style={{
                  maxWidth: "80%",
                  background: msg.role === "user" ? "#1e3a5f" : "#0f172a",
                  border: msg.role === "user" ? "1px solid #3b82f6" : "1px solid #334155",
                  padding: "12px 16px", borderRadius: "12px",
                  fontSize: "13px", lineHeight: "1.6",
                  color: msg.role === "user" ? "#93c5fd" : "#e2e8f0",
                  whiteSpace: "pre-wrap"
                }}>
                  {msg.content || (chatLoading && msg.role === "assistant" ? "⚡ searching vector DB..." : "")}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              placeholder="Ask about the code... (uses RAG vector search)"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              style={{
                flex: 1, padding: "12px 16px", borderRadius: "8px",
                border: "1px solid #334155", background: "#0f172a",
                color: "#e2e8f0", fontSize: "14px", outline: "none"
              }}
            />
            <button onClick={sendChat} disabled={chatLoading} style={{
              padding: "12px 20px",
              background: chatLoading ? "#334155" : "#3b82f6",
              color: "white", border: "none", borderRadius: "8px",
              cursor: chatLoading ? "not-allowed" : "pointer",
              fontSize: "14px", fontWeight: "bold"
            }}>
              {chatLoading ? "⏳" : "Send →"}
            </button>
          </div>
        </div>
      )}

      {/* TAB: ML SCAN */}
      {activeTab === "mlscan" && (
        <div style={{
          background: "#1a0a2e", border: "1px solid #7c3aed",
          borderRadius: "12px", padding: "24px", marginBottom: "20px"
        }}>
          <h2 style={{ color: "#a78bfa", marginTop: 0 }}>⚡ Fast ML Scan Results</h2>
          <p style={{ color: "#64748b", fontSize: "12px", marginBottom: "20px" }}>
            Powered by PyTorch Neural Network — no LLM, instant results
          </p>

          {mlScanLoading && (
            <div style={{ color: "#a78bfa" }}>⚡ Neural network scanning...</div>
          )}

          {mlScanResult && (
            <>
              <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
                {["CRITICAL","HIGH","MEDIUM","LOW"].map((level) => (
                  <div key={level} style={{
                    background: "#0f172a", borderRadius: "10px",
                    padding: "16px 24px", textAlign: "center", flex: 1,
                    border: `1px solid ${level === "CRITICAL" ? "#ff4444" : level === "HIGH" ? "#ff8800" : level === "MEDIUM" ? "#facc15" : "#4ade80"}40`
                  }}>
                    <div style={{
                      fontSize: "28px", fontWeight: "bold",
                      color: level === "CRITICAL" ? "#ff4444" : level === "HIGH" ? "#ff8800" : level === "MEDIUM" ? "#facc15" : "#4ade80"
                    }}>
                      {mlScanResult.summary?.[level] || 0}
                    </div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>{level}</div>
                  </div>
                ))}
              </div>

              <div style={{ color: "#64748b", fontSize: "12px", marginBottom: "16px" }}>
                📁 {mlScanResult.files_scanned} files scanned •
                🔍 {mlScanResult.total_issues} issues found •
                🤖 {mlScanResult.model}
              </div>

              {mlScanResult.results?.map((r, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center", padding: "10px 14px",
                  background: "#0f172a", borderRadius: "8px",
                  marginBottom: "6px", fontSize: "13px"
                }}>
                  <span style={{ color: "#e2e8f0", flex: 1 }}>{r.line}</span>
                  <span style={{ color: "#64748b", margin: "0 12px", fontSize: "11px" }}>📄 {r.file}</span>
                  <span style={{
                    padding: "2px 10px", borderRadius: "12px", fontSize: "11px",
                    fontWeight: "bold", whiteSpace: "nowrap",
                    background: r.severity === "CRITICAL" ? "#ff444420" : r.severity === "HIGH" ? "#ff880020" : r.severity === "MEDIUM" ? "#facc1520" : "#4ade8020",
                    color: r.severity === "CRITICAL" ? "#ff4444" : r.severity === "HIGH" ? "#ff8800" : r.severity === "MEDIUM" ? "#facc15" : "#4ade80"
                  }}>
                    {r.severity} {r.confidence}%
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* TAB: ML DASHBOARD */}
      {activeTab === "dashboard" && (
        <div style={{ marginBottom: "20px" }}>
          <h2 style={{ color: "#60a5fa", marginBottom: "4px" }}>📊 ML Model Dashboard</h2>
          <p style={{ color: "#64748b", fontSize: "12px", marginBottom: "20px" }}>
            PyTorch Neural Network — Training Metrics & Performance
          </p>

          {metricsLoading && <div style={{ color: "#60a5fa" }}>⏳ Loading metrics...</div>}

          {metrics && metrics.train_losses && (
            <>
              {/* Model Stats */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
                {[
                  { label: "Final Test Accuracy", value: metrics.final_test_acc + "%",  color: "#4ade80" },
                  { label: "Train Accuracy",       value: metrics.final_train_acc + "%", color: "#60a5fa" },
                  { label: "Total Parameters",     value: (metrics.total_params/1e6).toFixed(2) + "M", color: "#a78bfa" },
                  { label: "Inference Speed",      value: metrics.inference_ms + "ms",   color: "#facc15" },
                  { label: "Epochs Trained",       value: metrics.epochs,                color: "#f87171" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    background: "#1e293b", border: `1px solid ${color}40`,
                    borderRadius: "10px", padding: "16px 20px",
                    textAlign: "center", flex: 1, minWidth: "120px"
                  }}>
                    <div style={{ fontSize: "24px", fontWeight: "bold", color }}>{value}</div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Loss Curves */}
              <div style={{
                background: "#1e293b", borderRadius: "12px",
                padding: "20px", marginBottom: "16px",
                border: "1px solid #334155"
              }}>
                <h3 style={{ color: "#60a5fa", marginTop: 0, marginBottom: "16px" }}>
                  📈 Training Loss Curve
                </h3>
                <svg viewBox="0 0 600 200" style={{ width: "100%", height: "200px" }}>
                  {(() => {
                    const maxLoss = Math.max(...metrics.train_losses, ...metrics.test_losses);
                    const minLoss = Math.min(...metrics.train_losses, ...metrics.test_losses);
                    const w = 560, h = 160, padX = 20, padY = 20;
                    const toX = (i) => padX + (i / (metrics.epochs - 1)) * w;
                    const toY = (v) => padY + h - ((v - minLoss) / (maxLoss - minLoss)) * h;
                    const trainPath = metrics.train_losses.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(v)}`).join(" ");
                    const testPath  = metrics.test_losses.map((v, i)  => `${i === 0 ? "M" : "L"}${toX(i)},${toY(v)}`).join(" ");
                    return (
                      <>
                        <path d={trainPath} fill="none" stroke="#60a5fa" strokeWidth="2" />
                        <path d={testPath}  fill="none" stroke="#f87171" strokeWidth="2" />
                        <text x="20"  y="195" fill="#60a5fa" fontSize="11">— Train Loss</text>
                        <text x="120" y="195" fill="#f87171" fontSize="11">— Test Loss</text>
                      </>
                    );
                  })()}
                </svg>
              </div>

              {/* Accuracy Curves */}
              <div style={{
                background: "#1e293b", borderRadius: "12px",
                padding: "20px", marginBottom: "16px",
                border: "1px solid #334155"
              }}>
                <h3 style={{ color: "#4ade80", marginTop: 0, marginBottom: "16px" }}>
                  🎯 Accuracy Over Epochs
                </h3>
                <svg viewBox="0 0 600 200" style={{ width: "100%", height: "200px" }}>
                  {(() => {
                    const w = 560, h = 160, padX = 20, padY = 20;
                    const toX = (i) => padX + (i / (metrics.epochs - 1)) * w;
                    const toY = (v) => padY + h - (v / 100) * h;
                    const trainPath = metrics.train_accs.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(v)}`).join(" ");
                    const testPath  = metrics.test_accs.map((v, i)  => `${i === 0 ? "M" : "L"}${toX(i)},${toY(v)}`).join(" ");
                    return (
                      <>
                        <path d={trainPath} fill="none" stroke="#4ade80" strokeWidth="2" />
                        <path d={testPath}  fill="none" stroke="#facc15" strokeWidth="2" />
                        <text x="20"  y="195" fill="#4ade80" fontSize="11">— Train Accuracy</text>
                        <text x="140" y="195" fill="#facc15" fontSize="11">— Test Accuracy</text>
                      </>
                    );
                  })()}
                </svg>
              </div>

              {/* Confusion Matrix */}
              <div style={{
                background: "#1e293b", borderRadius: "12px",
                padding: "20px", marginBottom: "16px",
                border: "1px solid #334155"
              }}>
                <h3 style={{ color: "#a78bfa", marginTop: 0, marginBottom: "16px" }}>
                  🔢 Confusion Matrix
                </h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ padding: "8px", color: "#64748b", fontSize: "12px" }}>Actual \ Predicted</th>
                        {metrics.class_names.map(c => (
                          <th key={c} style={{ padding: "8px", color: "#a78bfa", fontSize: "12px" }}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.confusion_matrix.map((row, i) => (
                        <tr key={i}>
                          <td style={{ padding: "8px", color: "#60a5fa", fontSize: "12px", fontWeight: "bold" }}>
                            {metrics.class_names[i]}
                          </td>
                          {row.map((val, j) => (
                            <td key={j} style={{
                              padding: "12px 16px", textAlign: "center",
                              fontSize: "16px", fontWeight: "bold",
                              background: i === j ? "#1a3a1a" : "#1e293b",
                              color: i === j ? "#4ade80" : val > 0 ? "#f87171" : "#334155",
                              border: "1px solid #334155"
                            }}>
                              {val}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ color: "#64748b", fontSize: "11px", marginTop: "8px" }}>
                  ✅ Green diagonal = correct predictions | 🔴 Red = misclassifications
                </p>
              </div>

              {/* Per Class Metrics */}
              <div style={{
                background: "#1e293b", borderRadius: "12px",
                padding: "20px", marginBottom: "16px",
                border: "1px solid #334155"
              }}>
                <h3 style={{ color: "#facc15", marginTop: 0, marginBottom: "16px" }}>
                  📋 Per-Class Performance
                </h3>
                {metrics.class_names.map((cls) => {
                  const r = metrics.classification_report[cls];
                  return (
                    <div key={cls} style={{ marginBottom: "16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{ color: "#e2e8f0", fontWeight: "bold", fontSize: "13px" }}>{cls}</span>
                        <span style={{ color: "#64748b", fontSize: "12px" }}>
                          P: {(r.precision * 100).toFixed(0)}% |
                          R: {(r.recall * 100).toFixed(0)}% |
                          F1: {(r["f1-score"] * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div style={{ background: "#0f172a", borderRadius: "4px", height: "8px" }}>
                        <div style={{
                          background: "#4ade80", height: "8px",
                          borderRadius: "4px", width: `${r["f1-score"] * 100}%`
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Architecture */}
              <div style={{
                background: "#1e293b", borderRadius: "12px",
                padding: "20px", border: "1px solid #334155"
              }}>
                <h3 style={{ color: "#60a5fa", marginTop: 0, marginBottom: "16px" }}>
                  🏗️ Model Architecture
                </h3>
                {metrics.architecture.map((layer, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                    <div style={{
                      background: "#3b82f6", color: "white",
                      borderRadius: "50%", width: "24px", height: "24px",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "11px", fontWeight: "bold", flexShrink: 0
                    }}>
                      {i + 1}
                    </div>
                    <div style={{
                      background: "#0f172a", padding: "8px 16px",
                      borderRadius: "8px", color: "#a78bfa",
                      fontSize: "12px", flex: 1, fontFamily: "monospace"
                    }}>
                      {layer}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}

export default App;
