/**
 * ChatWidget.jsx — Floating Guest AI Concierge Widget
 * Embedded in public guest pages. Powered by RAG with vector search.
 */
import { useState, useEffect, useRef } from "react";
import {
  MessageSquare, X, Send, Sparkles, Phone,
  RotateCcw, ChevronDown, CheckCircle2, AlertCircle, BookOpen
} from "lucide-react";

export default function ChatWidget() {
  const [isOpen, setIsOpen]                 = useState(false);
  const [messages, setMessages]             = useState([
    {
      role: "assistant",
      content: "Hello! I am your Sunshine Concierge. Ask me anything about room amenities, check-in policies, breakfast, or local Pondicherry recommendations.",
      sources: [],
      handoff: false,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
  ]);
  const [input, setInput]                   = useState("");
  const [loading, setLoading]               = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const messagesEndRef                      = useRef(null);
  const inputRef                            = useRef(null);

  // Auto-scroll when messages update
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, loading]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Detect tenant slug from hostname
  const getTenantSlug = () => {
    try {
      const host = window.location.hostname;
      const parts = host.split(".");
      return parts.length > 2 && parts[0] !== "www" ? parts[0] : "sunshine-original";
    } catch {
      return "sunshine-original";
    }
  };

  const handleSend = async (textToSend) => {
    const q = (textToSend || input).trim();
    if (!q || loading) return;

    const userMsg = {
      role: "guest",
      content: q,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const tenantSlug = getTenantSlug();
      const res = await fetch("/api/concierge/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Slug": tenantSlug,
        },
        body: JSON.stringify({
          question: q,
          conversation_id: conversationId,
          channel: "web",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }

      const assistantMsg = {
        role: "assistant",
        content: data.answer || "Thank you for asking. Our staff will follow up shortly.",
        sources: Array.isArray(data.sources) ? data.sources : [],
        confidence: data.confidence,
        handoff: Boolean(data.handoff),
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg = {
        role: "assistant",
        content: "I'm having a little trouble connecting with the concierge system right now. Please feel free to visit our reception desk or give us a call!",
        sources: [],
        handoff: true,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setConversationId(null);
    setMessages([
      {
        role: "assistant",
        content: "Conversation restarted. How can I assist with your stay today?",
        sources: [],
        handoff: false,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }
    ]);
  };

  const QUICK_QUESTIONS = [
    "Check-in & out timings?",
    "Is breakfast included?",
    "Swimming pool hours?",
    "WiFi password & details"
  ];

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* ── COLLAPSED BUTTON ── */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
            color: "#ffffff",
            border: "none",
            borderRadius: 50,
            padding: "13px 22px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 10px 28px rgba(124, 58, 237, 0.45), 0 2px 6px rgba(0,0,0,0.1)",
            transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            animation: "pulse-subtle 3s infinite",
          }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px) scale(1.03)"}
          onMouseLeave={e => e.currentTarget.style.transform = "translateY(0) scale(1)"}
        >
          <div style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <Sparkles size={14} color="#ffffff" />
          </div>
          <span>Ask Concierge</span>
        </button>
      )}

      {/* ── EXPANDED CHAT WINDOW ── */}
      {isOpen && (
        <div style={{
          width: 340,
          height: 480,
          background: "#ffffff",
          borderRadius: 18,
          boxShadow: "0 22px 60px rgba(15, 23, 42, 0.28), 0 0 1px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid rgba(226, 232, 240, 0.8)",
          animation: "slide-up 0.24s cubic-bezier(0.16, 1, 0.3, 1)",
        }}>
          {/* Header */}
          <div style={{
            background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
            color: "#ffffff",
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #6366f1, #a855f7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 12px rgba(168, 85, 247, 0.5)",
              }}>
                <Sparkles size={16} color="#fff" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>
                  Sunshine Concierge
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#94a3b8" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                  AI Assistant · Online
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                onClick={handleReset}
                title="Reset conversation"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: 6,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                }}
                onMouseEnter={e => e.currentTarget.style.color = "#ffffff"}
                onMouseLeave={e => e.currentTarget.style.color = "#94a3b8"}
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                title="Minimize chat"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: 6,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                }}
                onMouseEnter={e => e.currentTarget.style.color = "#ffffff"}
                onMouseLeave={e => e.currentTarget.style.color = "#94a3b8"}
              >
                <ChevronDown size={17} />
              </button>
            </div>
          </div>

          {/* Messages scroll area */}
          <div style={{
            flex: 1,
            padding: "16px 14px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            background: "#f8fafc",
          }}>
            {messages.map((m, idx) => {
              const isAssistant = m.role === "assistant";
              const sources = Array.isArray(m.sources) ? m.sources : [];

              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: isAssistant ? "flex-start" : "flex-end",
                    maxWidth: "90%",
                    alignSelf: isAssistant ? "flex-start" : "flex-end",
                  }}
                >
                  <div style={{
                    background: isAssistant
                      ? "#ffffff"
                      : "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
                    color: isAssistant ? "#1e293b" : "#ffffff",
                    padding: "10px 14px",
                    borderRadius: isAssistant ? "14px 14px 14px 3px" : "14px 14px 3px 14px",
                    fontSize: 13,
                    lineHeight: 1.5,
                    boxShadow: isAssistant
                      ? "0 2px 8px rgba(0,0,0,0.04), 0 0 1px rgba(0,0,0,0.1)"
                      : "0 4px 12px rgba(124, 58, 237, 0.25)",
                    border: isAssistant ? "1px solid #e2e8f0" : "none",
                    whiteSpace: "pre-wrap",
                  }}>
                    {m.content}
                  </div>

                  {/* Sources chips */}
                  {isAssistant && sources.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                      {sources.map((s, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10,
                            padding: "2px 7px",
                            background: "#ede9fe",
                            color: "#6d28d9",
                            borderRadius: 4,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          <BookOpen size={9} />
                          {typeof s === "object" ? (s.title || s.source || "Resort Guide") : String(s)}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Handoff card */}
                  {isAssistant && m.handoff && (
                    <div style={{
                      marginTop: 8,
                      width: "100%",
                      background: "linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.16))",
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      borderRadius: 10,
                      padding: "8px 10px",
                      fontSize: 11.5,
                      color: "#92400e",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                    }}>
                      <Phone size={14} style={{ flexShrink: 0, marginTop: 2, color: "#d97706" }} />
                      <div>
                        <b>Front Desk Direct Line:</b>
                        <div>Call reception at <b>+91 98765 43210</b> or dial <b>0</b> from your room phone.</div>
                      </div>
                    </div>
                  )}

                  <span style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 3, marginInline: 4 }}>
                    {m.timestamp}
                  </span>
                </div>
              );
            })}

            {/* Typing Indicator */}
            {loading && (
              <div style={{
                alignSelf: "flex-start",
                background: "#ffffff",
                padding: "10px 14px",
                borderRadius: "14px 14px 14px 3px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                border: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}>
                <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", animation: "bounce 1.2s infinite 0.1s" }} />
                <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", animation: "bounce 1.2s infinite 0.25s" }} />
                <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", animation: "bounce 1.2s infinite 0.4s" }} />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick suggestions if few messages */}
          {messages.length <= 2 && (
            <div style={{
              padding: "6px 12px 8px",
              background: "#f8fafc",
              borderTop: "1px solid #f1f5f9",
              display: "flex",
              gap: 5,
              overflowX: "auto",
              whiteSpace: "nowrap",
            }}>
              {QUICK_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(q)}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: "4px 9px",
                    fontSize: 11,
                    color: "#475569",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#818cf8"; e.currentTarget.style.color = "#4f46e5"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.color = "#475569"; }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input Box */}
          <form
            onSubmit={e => { e.preventDefault(); handleSend(); }}
            style={{
              padding: "10px 12px",
              background: "#ffffff",
              borderTop: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask anything about the resort…"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading}
              style={{
                flex: 1,
                border: "1px solid #cbd5e1",
                borderRadius: 20,
                padding: "9px 14px",
                fontSize: 13,
                outline: "none",
                transition: "border-color 0.2s",
                background: "#f8fafc",
              }}
              onFocus={e => e.target.style.borderColor = "#6366f1"}
              onBlur={e => e.target.style.borderColor = "#cbd5e1"}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: input.trim() && !loading
                  ? "linear-gradient(135deg, #4f46e5, #7c3aed)"
                  : "#e2e8f0",
                color: "#ffffff",
                border: "none",
                cursor: input.trim() && !loading ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
                flexShrink: 0,
              }}
            >
              <Send size={15} style={{ marginLeft: 1 }} />
            </button>
          </form>
        </div>
      )}

      {/* Embedded inline styles for keyframes */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-5px); }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes pulse-subtle {
          0%, 100% { box-shadow: 0 10px 28px rgba(124, 58, 237, 0.45); }
          50% { box-shadow: 0 10px 36px rgba(124, 58, 237, 0.65); }
        }
      `}</style>
    </div>
  );
}
