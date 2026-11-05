/**
 * IQ.jsx — Sunshine IQ AI Control Panel
 * Unified dashboard for Forecasts, Dynamic Pricing, Risk Analysis & AI Concierge.
 */
import { useState, useEffect, useMemo } from "react";
import {
  Brain, Sparkles, TrendingUp, DollarSign, ShieldAlert, MessageSquare,
  RefreshCw, Check, X, Edit3, Star, FileText, AlertTriangle,
  ArrowUpRight, ChevronRight, Info, Zap, BarChart2,
  Calendar, CheckCircle, ShieldCheck, Clock, User, Phone, UploadCloud
} from "lucide-react";
import { apiFetch, rupee, fmtDate, fmtTime, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, StatCard, TableWrap, StatusBadge, Modal, Field, Grid2 } from "./ui.jsx";

// ── Tab Navigation List ──
const TABS = [
  { key: "forecast",  label: "Forecast",   icon: TrendingUp,   sub: "Chronos Occupancy Models" },
  { key: "pricing",   label: "Pricing",    icon: DollarSign,   sub: "Dynamic Rate Suggestions" },
  { key: "risk",      label: "Risk",       icon: ShieldAlert,  sub: "No-Show & Cancel Risk" },
  { key: "concierge", label: "Concierge",  icon: MessageSquare, sub: "RAG Knowledge & Conversations" },
];

export default function IQ() {
  const [activeTab, setActiveTab] = useState("forecast");

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Intelligence Engine"
        title="Sunshine IQ"
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="ff-badge ff-badge-purple" style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 12 }}>
              <Sparkles size={13} />
              AI Core Active
            </span>
          </div>
        }
      />

      {/* Tabs navigation */}
      <div style={{
        display: "flex",
        gap: 10,
        marginBottom: 24,
        borderBottom: "1px solid var(--ff-border)",
        paddingBottom: 14,
        flexWrap: "wrap"
      }}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`ff-btn ${isActive ? "ff-btn-primary" : "ff-btn-ghost"}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 16px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                transition: "all 0.18s ease"
              }}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      {activeTab === "forecast"  && <ForecastTab />}
      {activeTab === "pricing"   && <PricingTab />}
      {activeTab === "risk"      && <RiskTab />}
      {activeTab === "concierge" && <ConciergeTab />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   1. FORECAST TAB
   ══════════════════════════════════════════════════════════════════════════ */
function ForecastTab() {
  const [forecasts, setForecasts]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [running, setRunning]       = useState(false);
  const [error, setError]           = useState("");
  const [selectedRoom, setSelectedRoom] = useState("all");

  const loadForecasts = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/api/admin/ai/forecast");
      setForecasts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load forecasts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadForecasts();
  }, []);

  const handleRunForecast = async () => {
    setRunning(true);
    try {
      await apiFetch("/api/admin/ai/forecast", { method: "POST" });
      notify("Forecast run complete! Updated projections loaded.", "success");
      await loadForecasts();
    } catch (err) {
      notify(`Forecast failed: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  };

  // Group forecasts by room type
  const roomTypes = useMemo(() => {
    const map = new Map();
    forecasts.forEach(f => {
      const id = f.room_type_id;
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: f.room_type_name || `Room Type #${id}`,
          code: f.room_type_code || "ROOM",
          modelVersion: f.model_version || "chronos-t5-small-v1",
          dataSource: f.data_source || "synthetic",
          rows: [],
        });
      }
      map.get(id).rows.push(f);
    });
    return Array.from(map.values());
  }, [forecasts]);

  // Format percentage helper
  const fmtPct = (val) => {
    if (val == null) return "—";
    const num = Number(val);
    const pct = num <= 1 ? num * 100 : num;
    return `${Math.round(pct)}%`;
  };

  if (loading) return <Spinner />;
  if (error) return <ApiError msg={error} />;

  // Check for insufficient data
  const isInsufficient = forecasts.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header action bar */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        background: "var(--ff-card)",
        padding: "16px 20px",
        borderRadius: "var(--ff-radius)",
        border: "1px solid var(--ff-border)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "rgba(124,58,237,0.12)",
            color: "var(--ff-purple)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <TrendingUp size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>14-Day Occupancy Projections</h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ff-muted)" }}>
              Chronos probabilistic zero-shot time series model predicting P10, P50, and P90 confidence bounds
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {roomTypes.length > 1 && (
            <select
              className="ff-select-sm"
              value={selectedRoom}
              onChange={e => setSelectedRoom(e.target.value)}
              style={{ minWidth: 150 }}
            >
              <option value="all">All Room Types</option>
              {roomTypes.map(rt => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </select>
          )}

          <button
            className="ff-btn ff-btn-primary ff-btn-sm"
            onClick={handleRunForecast}
            disabled={running}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <RefreshCw size={14} className={running ? "ff-spin" : ""} />
            {running ? "Running Model…" : "Run Forecast"}
          </button>
        </div>
      </div>

      {isInsufficient ? (
        <Card>
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(217, 119, 6, 0.12)",
              color: "var(--ff-warning)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px"
            }}>
              <AlertTriangle size={28} />
            </div>
            <h4 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 600 }}>
              Status: Insufficient Data
            </h4>
            <p style={{ margin: "0 auto 20px", maxWidth: 440, fontSize: 13, color: "var(--ff-muted)", lineHeight: 1.6 }}>
              No forecast records found for the upcoming 14 days. This happens when the AI forecasting pipeline has not yet executed or historical occupancy records are sparse.
            </p>
            <button
              className="ff-btn ff-btn-primary"
              onClick={handleRunForecast}
              disabled={running}
            >
              <Zap size={15} />
              {running ? "Generating Projections…" : "Trigger Forecast Run Now"}
            </button>
          </div>
        </Card>
      ) : (
        roomTypes
          .filter(rt => selectedRoom === "all" || String(rt.id) === String(selectedRoom))
          .map(rt => {
            // Take the next 14 days of forecasts
            const next14 = rt.rows.slice(0, 14);

            return (
              <Card
                key={rt.id}
                title={
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span>{rt.name}</span>
                    <span className="ff-badge ff-badge-blue">{rt.code}</span>
                    <span style={{ fontSize: 11, color: "var(--ff-muted)", fontWeight: 400, marginLeft: "auto" }}>
                      Model: <b style={{ color: "var(--ff-purple)" }}>{rt.modelVersion}</b> | Data: <b>{rt.dataSource}</b>
                    </span>
                  </div>
                }
              >
                {/* Visual Occupancy Curve / Sparkline Chart */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ff-muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>
                      14-Day Trajectory (P50 Expected Demand)
                    </span>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--ff-muted)" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 10, height: 10, background: "rgba(29, 78, 216, 0.2)", borderRadius: 2 }} /> P10 Conservative
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 10, height: 10, background: "var(--ff-primary)", borderRadius: 2 }} /> P50 Expected
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 10, height: 10, background: "rgba(124, 58, 237, 0.8)", borderRadius: 2 }} /> P90 Optimistic
                      </span>
                    </div>
                  </div>

                  {/* Visual Bar Graph */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${next14.length}, 1fr)`,
                    gap: 6,
                    height: 120,
                    alignItems: "flex-end",
                    background: "rgba(29, 78, 216, 0.03)",
                    padding: "16px 12px 6px",
                    borderRadius: 10,
                    border: "1px solid var(--ff-border)"
                  }}>
                    {next14.map((row, idx) => {
                      const p50Val = Number(row.p50 || 0);
                      const p50Pct = Math.min(100, Math.max(0, p50Val <= 1 ? p50Val * 100 : p50Val));
                      const dateObj = new Date(row.forecast_date);
                      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                      const dayStr = dateObj.toLocaleDateString("en-IN", { weekday: "short" });
                      const dNum = dateObj.getDate();

                      return (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            height: "100%",
                            justifyContent: "flex-end",
                            position: "relative"
                          }}
                          title={`${fmtDate(row.forecast_date)}: P10=${fmtPct(row.p10)}, P50=${fmtPct(row.p50)}, P90=${fmtPct(row.p90)}`}
                        >
                          <div style={{
                            width: "100%",
                            maxWidth: 28,
                            height: `${Math.max(8, p50Pct)}%`,
                            background: isWeekend
                              ? "linear-gradient(180deg, #7c3aed, #4f46e5)"
                              : "linear-gradient(180deg, #3b82f6, #1d4ed8)",
                            borderRadius: "4px 4px 1px 1px",
                            transition: "height 0.3s ease",
                            position: "relative"
                          }}>
                            {p50Pct >= 40 && (
                              <span style={{
                                position: "absolute",
                                top: 2,
                                left: 0,
                                right: 0,
                                textAlign: "center",
                                fontSize: 9,
                                color: "#fff",
                                fontWeight: 700
                              }}>
                                {Math.round(p50Pct)}
                              </span>
                            )}
                          </div>
                          <span style={{
                            fontSize: 10,
                            color: isWeekend ? "var(--ff-primary)" : "var(--ff-muted)",
                            fontWeight: isWeekend ? 700 : 500,
                            marginTop: 6
                          }}>
                            {dayStr.slice(0, 2)} {dNum}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Forecast Table */}
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Day</th>
                      <th>Booked / Total</th>
                      <th>Current Rate</th>
                      <th style={{ textAlign: "right" }}>P10 (Low Demand)</th>
                      <th style={{ textAlign: "right" }}>P50 (Median Expectation)</th>
                      <th style={{ textAlign: "right" }}>P90 (Peak Demand)</th>
                      <th>Demand Tier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {next14.map((row, idx) => {
                      const d = new Date(row.forecast_date);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const p50Val = Number(row.p50 || 0);
                      const p50Pct = p50Val <= 1 ? p50Val * 100 : p50Val;

                      let tierBadge = "ff-badge-muted";
                      let tierLabel = "Standard";
                      if (p50Pct >= 80) {
                        tierBadge = "ff-badge-red";
                        tierLabel = "High Surge";
                      } else if (p50Pct >= 50) {
                        tierBadge = "ff-badge-yellow";
                        tierLabel = "Moderate Demand";
                      } else {
                        tierBadge = "ff-badge-green";
                        tierLabel = "Base Pace";
                      }

                      return (
                        <tr key={idx} style={{ background: isWeekend ? "rgba(29, 78, 216, 0.02)" : "transparent" }}>
                          <td className="ff-mono" style={{ fontWeight: 600 }}>{fmtDate(row.forecast_date)}</td>
                          <td style={{ color: isWeekend ? "var(--ff-primary)" : "inherit", fontWeight: isWeekend ? 600 : 400 }}>
                            {d.toLocaleDateString("en-IN", { weekday: "long" })}
                            {isWeekend && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>(Weekend)</span>}
                          </td>
                          <td className="ff-mono">
                            {row.booked_units ?? 0} / {row.total_units ?? "—"}
                          </td>
                          <td className="ff-mono" style={{ fontWeight: 600 }}>
                            {rupee(row.current_rate)}
                          </td>
                          <td className="ff-mono" style={{ textAlign: "right", color: "var(--ff-muted)" }}>
                            {fmtPct(row.p10)}
                          </td>
                          <td className="ff-mono" style={{ textAlign: "right", color: "var(--ff-primary)", fontWeight: 700 }}>
                            {fmtPct(row.p50)}
                          </td>
                          <td className="ff-mono" style={{ textAlign: "right", color: "var(--ff-purple)", fontWeight: 600 }}>
                            {fmtPct(row.p90)}
                          </td>
                          <td>
                            <span className={`ff-badge ${tierBadge}`}>
                              {tierLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
              </Card>
            );
          })
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2. PRICING TAB
   ══════════════════════════════════════════════════════════════════════════ */
function PricingTab() {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [generating, setGenerating]   = useState(false);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [editingId, setEditingId]     = useState(null);
  const [editRate, setEditRate]       = useState("");
  const [decidingId, setDecidingId]   = useState(null);

  const loadSuggestions = async () => {
    setLoading(true);
    try {
      const q = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const data = await apiFetch(`/api/admin/ai/pricing/suggestions${q}`);
      setSuggestions(Array.isArray(data) ? data : []);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuggestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleGetSuggestions = async () => {
    setGenerating(true);
    try {
      await apiFetch("/api/admin/ai/pricing/suggest", { method: "POST" });
      notify("Generated new pricing suggestions based on current pace & forecasts!", "success");
      await loadSuggestions();
    } catch (err) {
      notify(`Pricing suggestion failed: ${err.message}`, "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleDecision = async (id, decision, customRate = null) => {
    setDecidingId(id);
    try {
      const payload = { decision };
      if (decision === "edited" && customRate != null) {
        payload.decided_rate = Number(customRate);
      }
      await apiFetch(`/api/admin/ai/pricing/suggestions/${id}/decide`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      notify(
        decision === "accepted" ? "Suggestion accepted and applied to inventory!" :
        decision === "rejected" ? "Suggestion rejected." : "Custom rate applied to inventory!",
        "success"
      );
      setEditingId(null);
      await loadSuggestions();
    } catch (err) {
      notify(`Decision failed: ${err.message}`, "error");
    } finally {
      setDecidingId(null);
    }
  };

  const openInlineEdit = (s) => {
    setEditingId(s.id);
    setEditRate(String(s.suggested_rate || ""));
  };

  // Render factors chips
  const renderFactors = (factors) => {
    if (!factors) return <span style={{ color: "var(--ff-muted)" }}>None</span>;
    let list = [];
    if (Array.isArray(factors)) {
      list = factors;
    } else if (typeof factors === "object") {
      list = Object.entries(factors).map(([k, v]) => `${k}: ${v}`);
    } else {
      list = [String(factors)];
    }

    if (list.length === 0) return <span style={{ color: "var(--ff-muted)" }}>None</span>;

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {list.map((f, i) => {
          const str = typeof f === "object" ? JSON.stringify(f) : String(f);
          return (
            <span
              key={i}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                background: "rgba(124, 58, 237, 0.08)",
                color: "#6b21a8",
                border: "1px solid rgba(124, 58, 237, 0.2)",
                borderRadius: 4,
                whiteSpace: "nowrap"
              }}
            >
              {str}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Control Strip */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        background: "var(--ff-card)",
        padding: "16px 20px",
        borderRadius: "var(--ff-radius)",
        border: "1px solid var(--ff-border)"
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ff-muted)" }}>
            View:
          </span>
          {[
            ["pending", "Pending Review"],
            ["all", "All Suggestions"],
            ["accepted", "Accepted"],
            ["rejected", "Rejected"],
            ["edited", "Custom Edited"]
          ].map(([val, label]) => (
            <button
              key={val}
              className={`ff-btn ${statusFilter === val ? "ff-btn-primary" : "ff-btn-ghost"} ff-btn-sm`}
              onClick={() => setStatusFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          className="ff-btn ff-btn-primary ff-btn-sm"
          onClick={handleGetSuggestions}
          disabled={generating}
        >
          <Sparkles size={14} className={generating ? "ff-spin" : ""} />
          {generating ? "Evaluating Yield…" : "Get Suggestions"}
        </button>
      </div>

      <Card title={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Rate Recommendations</span>
          <span style={{ fontSize: 12, color: "var(--ff-muted)", fontWeight: 400 }}>
            {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}
          </span>
        </div>
      }>
        {loading ? (
          <Spinner />
        ) : suggestions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ff-muted)" }}>
            <DollarSign size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 14 }}>
              {statusFilter === "pending"
                ? "No pending rate suggestions right now. Click 'Get Suggestions' to recalculate demand."
                : "No rate suggestions match the selected filter."}
            </p>
          </div>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>Date</th>
                <th>Room Type</th>
                <th style={{ textAlign: "right" }}>Current Rate</th>
                <th style={{ textAlign: "right" }}>Suggested Rate</th>
                <th style={{ textAlign: "right" }}>Delta</th>
                <th style={{ minWidth: 220 }}>Factors & Signals</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map(s => {
                const cur = Number(s.current_rate || 0);
                const sug = Number(s.suggested_rate || 0);
                const delta = cur > 0 ? sug - cur : 0;
                const deltaPct = cur > 0 ? Math.round((delta / cur) * 100) : 0;
                const isEditing = editingId === s.id;
                const isDeciding = decidingId === s.id;

                return (
                  <tr key={s.id}>
                    <td className="ff-mono" style={{ fontWeight: 600 }}>
                      {fmtDate(s.suggestion_date)}
                    </td>
                    <td>
                      <div><b>{s.room_type_name}</b></div>
                      <div className="ff-sub-text">{s.room_type_code}</div>
                    </td>
                    <td className="ff-mono" style={{ textAlign: "right" }}>
                      {rupee(cur)}
                    </td>
                    <td className="ff-mono" style={{ textAlign: "right", fontWeight: 700 }}>
                      {isEditing ? (
                        <input
                          type="number"
                          value={editRate}
                          onChange={e => setEditRate(e.target.value)}
                          style={{
                            width: 100,
                            padding: "4px 8px",
                            fontSize: 13,
                            borderRadius: 6,
                            border: "1.5px solid var(--ff-primary)"
                          }}
                          autoFocus
                        />
                      ) : (
                        <span style={{ color: "var(--ff-primary)", fontSize: 15 }}>
                          {rupee(sug)}
                        </span>
                      )}
                    </td>
                    <td className="ff-mono" style={{ textAlign: "right", fontWeight: 600 }}>
                      {delta !== 0 ? (
                        <span style={{ color: delta > 0 ? "var(--ff-success)" : "var(--ff-danger)" }}>
                          {delta > 0 ? "+" : ""}{rupee(delta)} ({deltaPct > 0 ? "+" : ""}{deltaPct}%)
                        </span>
                      ) : (
                        <span style={{ color: "var(--ff-muted)" }}>0%</span>
                      )}
                    </td>
                    <td>{renderFactors(s.factors)}</td>
                    <td>
                      <span className={`ff-badge ${
                        s.status === "accepted" ? "ff-badge-green" :
                        s.status === "rejected" ? "ff-badge-red" :
                        s.status === "edited"   ? "ff-badge-blue" : "ff-badge-yellow"
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            className="ff-btn ff-btn-primary ff-btn-sm"
                            onClick={() => handleDecision(s.id, "edited", editRate)}
                            disabled={isDeciding || !editRate}
                            title="Save custom rate"
                          >
                            <Check size={13} /> Save
                          </button>
                          <button
                            className="ff-btn ff-btn-ghost ff-btn-sm"
                            onClick={() => setEditingId(null)}
                            disabled={isDeciding}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : s.status === "pending" ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            className="ff-btn ff-btn-primary ff-btn-sm"
                            onClick={() => handleDecision(s.id, "accepted")}
                            disabled={isDeciding}
                            style={{ background: "#16a34a", borderColor: "#16a34a" }}
                            title="Accept rate and apply to inventory"
                          >
                            <Check size={13} /> Accept
                          </button>
                          <button
                            className="ff-btn ff-btn-ghost ff-btn-sm"
                            onClick={() => openInlineEdit(s)}
                            disabled={isDeciding}
                            title="Edit custom rate"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            className="ff-btn ff-btn-danger ff-btn-sm"
                            onClick={() => handleDecision(s.id, "rejected")}
                            disabled={isDeciding}
                            title="Reject suggestion"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--ff-muted)" }}>
                          {s.decided_by_name ? `By ${s.decided_by_name}` : "Decided"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   3. RISK TAB
   ══════════════════════════════════════════════════════════════════════════ */
function RiskTab() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const loadRiskSummary = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/api/admin/ai/risk-summary");
      setSummary(data);
    } catch (err) {
      setError(err.message || "Failed to load risk summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRiskSummary();
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ApiError msg={error} />;

  const dist = summary?.distribution || { high: 0, medium: 0, low: 0, unscored: 0, total: 0 };
  const highRiskBookings = summary?.recent_high_risk || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Concept Explanation Card */}
      <div style={{
        background: "linear-gradient(135deg, rgba(29, 78, 216, 0.06), rgba(124, 58, 237, 0.08))",
        border: "1px solid rgba(124, 58, 237, 0.22)",
        borderRadius: "var(--ff-radius)",
        padding: "20px 24px"
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "rgba(124, 58, 237, 0.15)",
            color: "var(--ff-purple)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0
          }}>
            <ShieldAlert size={24} />
          </div>
          <div>
            <h3 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 600, color: "var(--ff-text)" }}>
              Predictive Cancellation & No-Show Shield
            </h3>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--ff-sub)", lineHeight: 1.6 }}>
              Sunshine's risk engine analyzes reservation parameters at creation: booking lead-time, stay length, booking channel (OTA vs. Direct), guest profile verification (KYC complete vs. missing), and deposit ratio. Each booking is categorized into a risk band to recommend proactive intervention before revenue is lost.
            </p>
          </div>
        </div>
      </div>

      {/* Distribution of Risk Bands */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 16
      }}>
        <StatCard
          label="High Risk"
          value={dist.high || 0}
          sub="Immediate advance collection advised"
          icon={ShieldAlert}
          iconBg="ff-icon-bg-danger"
          valueColor="ff-text-danger"
        />
        <StatCard
          label="Medium Risk"
          value={dist.medium || 0}
          sub="Monitor & recommend 50% deposit"
          icon={AlertTriangle}
          iconBg="ff-icon-bg-warning"
          valueColor="ff-text-warning"
        />
        <StatCard
          label="Low Risk"
          value={dist.low || 0}
          sub="Verified guests & strong deposits"
          icon={ShieldCheck}
          iconBg="ff-icon-bg-success"
          valueColor="ff-text-success"
        />
        <StatCard
          label="Unscored"
          value={dist.unscored || 0}
          sub="Pending model scoring"
          icon={Clock}
          iconBg="ff-icon-bg-primary"
        />
      </div>

      {/* Recent High-Risk Bookings */}
      <Card title={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>High-Risk Reservations Requiring Attention</span>
          <span className="ff-badge ff-badge-red">{highRiskBookings.length} flagged</span>
        </div>
      }>
        {highRiskBookings.length === 0 ? (
          <div style={{ textAlign: "center", padding: "36px 20px", color: "var(--ff-muted)" }}>
            <ShieldCheck size={36} color="var(--ff-success)" style={{ marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 14 }}>
              No high-risk reservations flagged. All active bookings are within normal probability thresholds.
            </p>
          </div>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>Booking Ref</th>
                <th>Guest</th>
                <th>Stay Dates</th>
                <th style={{ textAlign: "right" }}>Total Amount</th>
                <th style={{ textAlign: "right" }}>Cancel Prob</th>
                <th style={{ textAlign: "right" }}>No-Show Prob</th>
                <th style={{ textAlign: "right" }}>Recommended Advance</th>
                <th>Risk Factors</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {highRiskBookings.map(b => {
                const cancelPct = Math.round(Number(b.cancel_prob || 0) * 100);
                const noshowPct = Math.round(Number(b.noshow_prob || 0) * 100);
                const factors = Array.isArray(b.factors) ? b.factors : [];

                return (
                  <tr key={b.id}>
                    <td className="ff-mono" style={{ fontWeight: 600 }}>{b.reference}</td>
                    <td>
                      <div><b>{b.guest_name}</b></div>
                      {b.guest_phone && (
                        <div className="ff-sub-text">
                          <Phone size={10} /> {b.guest_phone}
                        </div>
                      )}
                    </td>
                    <td>
                      <div>{fmtDate(b.check_in)}</div>
                      <div className="ff-sub-text">→ {fmtDate(b.check_out)}</div>
                    </td>
                    <td className="ff-mono" style={{ textAlign: "right", fontWeight: 600 }}>
                      {rupee(b.total_amount)}
                    </td>
                    <td className="ff-mono" style={{ textAlign: "right", color: "var(--ff-danger)", fontWeight: 700 }}>
                      {cancelPct}%
                    </td>
                    <td className="ff-mono" style={{ textAlign: "right", color: "var(--ff-warning)", fontWeight: 600 }}>
                      {noshowPct}%
                    </td>
                    <td className="ff-mono" style={{ textAlign: "right", color: "var(--ff-primary)", fontWeight: 700 }}>
                      {b.recommended_advance ? rupee(b.recommended_advance) : "Full Advance"}
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {factors.map((f, i) => (
                          <span
                            key={i}
                            style={{
                              fontSize: 10.5,
                              padding: "2px 6px",
                              background: "rgba(220, 38, 38, 0.08)",
                              color: "#b91c1c",
                              border: "1px solid rgba(220, 38, 38, 0.2)",
                              borderRadius: 4
                            }}
                          >
                            {typeof f === "object" ? (f.factor || f.name || JSON.stringify(f)) : String(f)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="ff-badge ff-badge-red">High Risk</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   4. CONCIERGE TAB
   ══════════════════════════════════════════════════════════════════════════ */
function ConciergeTab() {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [ingestModal, setIngestModal]     = useState(false);
  const [ingestForm, setIngestForm]       = useState({ content_type: "policy", content_text: "", title: "" });
  const [ingesting, setIngesting]         = useState(false);
  const [selectedConv, setSelectedConv]   = useState(null);
  const [messages, setMessages]           = useState([]);
  const [msgsLoading, setMsgsLoading]     = useState(false);

  const loadConversations = async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/admin/concierge/conversations");
      setConversations(Array.isArray(data) ? data : []);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  const openThread = async (conv) => {
    setSelectedConv(conv);
    setMsgsLoading(true);
    try {
      const msgs = await apiFetch(`/api/admin/concierge/conversations/${conv.id}/messages`);
      setMessages(Array.isArray(msgs) ? msgs : []);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setMsgsLoading(false);
    }
  };

  const handleRateMessage = async (convId, messageId, rating) => {
    try {
      await apiFetch(`/api/admin/concierge/conversations/${convId}/rate`, {
        method: "POST",
        body: JSON.stringify({ message_id: messageId, rating }),
      });
      notify(`Rated message ${rating} star${rating > 1 ? "s" : ""}!`, "success");
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, staff_rating: rating } : m));
    } catch (err) {
      notify(`Rating failed: ${err.message}`, "error");
    }
  };

  const handleHandoff = async (convId) => {
    try {
      await apiFetch(`/api/admin/concierge/conversations/${convId}/handoff`, {
        method: "POST",
      });
      notify("Conversation closed / handed off to staff.", "success");
      loadConversations();
      if (selectedConv?.id === convId) {
        setSelectedConv(prev => ({ ...prev, status: "closed" }));
      }
    } catch (err) {
      notify(`Handoff error: ${err.message}`, "error");
    }
  };

  const handleIngest = async (e) => {
    e.preventDefault();
    if (!ingestForm.content_text.trim()) {
      notify("Please provide document or policy content", "error");
      return;
    }
    setIngesting(true);
    try {
      await apiFetch("/api/admin/concierge/ingest", {
        method: "POST",
        body: JSON.stringify({
          content_type: ingestForm.content_type,
          content_text: ingestForm.content_text,
          text: ingestForm.content_text,
          title: ingestForm.title || "Policy Document",
        }),
      });
      notify("Document ingested into vector embeddings index successfully!", "success");
      setIngestModal(false);
      setIngestForm({ content_type: "policy", content_text: "", title: "" });
    } catch (err) {
      notify(`Ingestion failed: ${err.message}`, "error");
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Control Strip */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        background: "var(--ff-card)",
        padding: "16px 20px",
        borderRadius: "var(--ff-radius)",
        border: "1px solid var(--ff-border)"
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>AI Concierge Ingestion & Oversight</h3>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ff-muted)" }}>
            RAG vector search powered by local embeddings and verified resort knowledge
          </p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="ff-btn ff-btn-outline ff-btn-sm"
            onClick={loadConversations}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "ff-spin" : ""} /> Refresh
          </button>
          <button
            className="ff-btn ff-btn-primary ff-btn-sm"
            onClick={() => setIngestModal(true)}
          >
            <UploadCloud size={15} /> Ingest Documents
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selectedConv ? "1fr 1fr" : "1fr", gap: 20 }}>
        {/* Conversations List */}
        <Card title="Recent Guest Conversations">
          {loading ? (
            <Spinner />
          ) : conversations.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ff-muted)" }}>
              <MessageSquare size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: 14 }}>No guest concierge conversations logged yet.</p>
            </div>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Messages</th>
                  <th>Latest Message</th>
                  <th>Updated</th>
                  <th style={{ textAlign: "right" }}>Thread</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map(c => {
                  const isSelected = selectedConv?.id === c.id;
                  return (
                    <tr
                      key={c.id}
                      style={{
                        background: isSelected ? "rgba(124, 58, 237, 0.05)" : "transparent",
                        cursor: "pointer"
                      }}
                      onClick={() => openThread(c)}
                    >
                      <td>
                        <span className={`ff-badge ${c.channel === "whatsapp" ? "ff-badge-green" : "ff-badge-blue"}`}>
                          {c.channel || "web"}
                        </span>
                      </td>
                      <td>
                        <span className={`ff-badge ${
                          c.status === "open"    ? "ff-badge-green" :
                          c.status === "handoff" ? "ff-badge-yellow" : "ff-badge-muted"
                        }`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="ff-mono">{c.message_count || 1}</td>
                      <td style={{ maxWidth: 260 }}>
                        <div style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 12.5
                        }}>
                          {c.latest_message_content || "—"}
                        </div>
                        {c.latest_message_handoff && (
                          <span style={{ fontSize: 10, color: "var(--ff-warning)", fontWeight: 600 }}>
                            ⚠ Handoff requested
                          </span>
                        )}
                      </td>
                      <td className="ff-mono" style={{ fontSize: 11, color: "var(--ff-muted)" }}>
                        {fmtTime(c.updated_at || c.created_at)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="ff-btn ff-btn-ghost ff-btn-sm"
                          onClick={(e) => { e.stopPropagation(); openThread(c); }}
                        >
                          View <ChevronRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>

        {/* Selected Conversation Message Thread */}
        {selectedConv && (
          <Card
            title={
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span>Conversation #{selectedConv.id}</span>
                  <span className="ff-badge ff-badge-blue" style={{ marginLeft: 8 }}>{selectedConv.channel}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {selectedConv.status !== "closed" && (
                    <button
                      className="ff-btn ff-btn-outline ff-btn-sm"
                      onClick={() => handleHandoff(selectedConv.id)}
                      title="Mark as closed or handed off"
                    >
                      Close / Handoff
                    </button>
                  )}
                  <button
                    className="ff-btn ff-btn-ghost ff-btn-sm"
                    onClick={() => setSelectedConv(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            }
          >
            {msgsLoading ? (
              <Spinner />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: 540, overflowY: "auto", paddingRight: 4 }}>
                {messages.map(m => {
                  const isAssistant = m.role === "assistant";
                  const sources = Array.isArray(m.sources) ? m.sources : [];

                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isAssistant ? "flex-start" : "flex-end",
                        maxWidth: "85%",
                        background: isAssistant ? "#ffffff" : "var(--ff-primary)",
                        color: isAssistant ? "var(--ff-text)" : "#ffffff",
                        border: isAssistant ? "1px solid var(--ff-border)" : "none",
                        borderRadius: 12,
                        padding: "12px 16px",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", opacity: 0.8 }}>
                          {isAssistant ? "Sunshine AI" : "Guest"}
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.7 }}>
                          {fmtTime(m.created_at)}
                        </span>
                      </div>

                      <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                        {m.content}
                      </div>

                      {/* Assistant metadata & sources */}
                      {isAssistant && (
                        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                          {sources.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                              <span style={{ fontSize: 10, color: "var(--ff-muted)", fontWeight: 600 }}>Sources:</span>
                              {sources.map((src, i) => (
                                <span
                                  key={i}
                                  style={{
                                    fontSize: 10,
                                    padding: "1px 6px",
                                    background: "rgba(37,99,235,0.08)",
                                    color: "#2563eb",
                                    borderRadius: 4
                                  }}
                                >
                                  {typeof src === "object" ? (src.title || src.source || JSON.stringify(src)) : String(src)}
                                </span>
                              ))}
                            </div>
                          )}

                          {m.handoff && (
                            <div style={{
                              fontSize: 11,
                              color: "var(--ff-warning)",
                              fontWeight: 600,
                              background: "rgba(217, 119, 6, 0.08)",
                              padding: "4px 8px",
                              borderRadius: 6,
                              marginBottom: 8
                            }}>
                              ⚠ Front-Desk Handoff Triggered
                            </div>
                          )}

                          {/* Staff Star Rating */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 10.5, color: "var(--ff-muted)" }}>Staff Rating:</span>
                            <div style={{ display: "flex", gap: 2 }}>
                              {[1, 2, 3, 4, 5].map(star => {
                                const currentRating = m.staff_rating || 0;
                                const isFilled = star <= currentRating;
                                return (
                                  <button
                                    key={star}
                                    type="button"
                                    onClick={() => handleRateMessage(selectedConv.id, m.id, star)}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      padding: 2,
                                      cursor: "pointer",
                                      color: isFilled ? "#f59e0b" : "#d1d5db",
                                      transition: "transform 0.1s"
                                    }}
                                    title={`Rate ${star} star${star > 1 ? "s" : ""}`}
                                  >
                                    <Star size={14} fill={isFilled ? "#f59e0b" : "none"} />
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Ingest Documents Modal */}
      {ingestModal && (
        <Modal
          title="Ingest Resort Policy or FAQ"
          onClose={() => setIngestModal(false)}
          maxWidth={540}
        >
          <form onSubmit={handleIngest} className="ff-fields">
            <Field label="Content Classification">
              <select
                value={ingestForm.content_type}
                onChange={e => setIngestForm(p => ({ ...p, content_type: e.target.value }))}
                required
              >
                <option value="policy">Resort Policy (Check-in, Pool, Cancellation)</option>
                <option value="faq">Frequently Asked Questions (FAQ)</option>
                <option value="review">Guest Review & Feedback Knowledge</option>
              </select>
            </Field>

            <Field label="Document Title / Section">
              <input
                type="text"
                placeholder="e.g. Swimming Pool & Breakfast Timings"
                value={ingestForm.title}
                onChange={e => setIngestForm(p => ({ ...p, title: e.target.value }))}
              />
            </Field>

            <Field label="Text Content (Markdown or Plain Text)">
              <textarea
                rows={8}
                placeholder="Paste the resort policy, house rules, or amenity information here. This will be vectorized into the concierge RAG store..."
                value={ingestForm.content_text}
                onChange={e => setIngestForm(p => ({ ...p, content_text: e.target.value }))}
                required
              />
            </Field>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <button
                type="button"
                className="ff-btn ff-btn-ghost"
                onClick={() => setIngestModal(false)}
                disabled={ingesting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="ff-btn ff-btn-primary"
                disabled={ingesting}
              >
                <UploadCloud size={15} />
                {ingesting ? "Ingesting & Vectorizing…" : "Ingest Document"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
