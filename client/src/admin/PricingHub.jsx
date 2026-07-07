/**
 * PricingHub.jsx
 * Dynamic Surge Pricing Engine from f2.docx:
 * calculateSurgeRate() + GST safeguard + occupancy tier table.
 * Lets the owner configure season base price and override parameters.
 */
import { useState, useMemo, useEffect } from "react";
import { Zap, TrendingUp, AlertTriangle, DollarSign, Calculator, CalendarDays, Sun, BarChart2 } from "lucide-react";
import { useApi, adminRooms, apiFetch, rupee, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, Field, Grid2, StatCard, ProgressBar } from "./ui.jsx";

// f2.docx exact surge algorithm
function calculateSurgeRate(baseSeasonPrice, roomsSold, daysToArrival) {
  const totalRooms = 15;
  let multiplier = 1.0;

  if      (roomsSold <= 3)  multiplier = 1.00;
  else if (roomsSold <= 6)  multiplier = 1.10;
  else if (roomsSold <= 9)  multiplier = 1.25;
  else if (roomsSold <= 12) multiplier = 1.45;
  else if (roomsSold <= 14) multiplier = 1.70;
  else                      multiplier = 2.00;

  // Booking pace modifiers
  if (daysToArrival > 14 && roomsSold >= 7) multiplier += 0.20;
  else if (daysToArrival <= 3 && roomsSold < 4) multiplier -= 0.15;

  let calculatedPrice = baseSeasonPrice * multiplier;

  // GST danger zone cap (f2.docx safeguard)
  if (calculatedPrice > 7500 && calculatedPrice < 8200) {
    calculatedPrice = 7499;
  }

  return {
    finalBaseRate: parseFloat(calculatedPrice.toFixed(2)),
    gstSlab:       calculatedPrice > 7500 ? 18.0 : 5.0,
    multiplier,
  };
}

// f2.docx GST allocator
function allocateGstAndCredits(invoiceAmount, roomTariffAtTime) {
  if (roomTariffAtTime > 7500) {
    return {
      isInputTaxCreditEligible: true,
      cgstAmount: invoiceAmount * 0.09,
      sgstAmount: invoiceAmount * 0.09,
      totalGst:   invoiceAmount * 0.18,
    };
  }
  return {
    isInputTaxCreditEligible: false,
    cgstAmount: invoiceAmount * 0.025,
    sgstAmount: invoiceAmount * 0.025,
    totalGst:   invoiceAmount * 0.05,
  };
}

const TIER_ROWS = [
  { rooms: "0 – 3",  pct: "0–20%",  mult: "×1.00", label: "Base rate" },
  { rooms: "4 – 6",  pct: "21–40%", mult: "×1.10", label: "+10% occupancy surge" },
  { rooms: "7 – 9",  pct: "41–60%", mult: "×1.25", label: "+25% mid-surge" },
  { rooms: "10 – 12",pct: "61–80%", mult: "×1.45", label: "+45% high-demand" },
  { rooms: "13 – 14",pct: "81–93%", mult: "×1.70", label: "+70% near-full premium" },
  { rooms: "15",     pct: "100%",   mult: "×2.00", label: "Last room — double rate" },
];

const WEEKDAYS = [
  { label: "Sun", value: 0 }, { label: "Mon", value: 1 }, { label: "Tue", value: 2 },
  { label: "Wed", value: 3 }, { label: "Thu", value: 4 }, { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

// Indian national & major public holidays (fixed + floating through 2026)
const NATIONAL_HOLIDAYS = {
  "2025-01-14": "Makar Sankranti",
  "2025-01-26": "Republic Day",
  "2025-03-14": "Holi",
  "2025-04-14": "Dr. Ambedkar Jayanti",
  "2025-04-18": "Good Friday",
  "2025-08-15": "Independence Day",
  "2025-10-02": "Gandhi Jayanti",
  "2025-10-20": "Diwali",
  "2025-11-05": "Guru Nanak Jayanti",
  "2025-12-25": "Christmas",
  "2026-01-14": "Makar Sankranti",
  "2026-01-26": "Republic Day",
  "2026-03-02": "Holi",
  "2026-04-03": "Good Friday",
  "2026-04-14": "Dr. Ambedkar Jayanti",
  "2026-08-15": "Independence Day",
  "2026-10-02": "Gandhi Jayanti",
  "2026-10-08": "Diwali",
  "2026-11-24": "Guru Nanak Jayanti",
  "2026-12-25": "Christmas",
};

function getDateRangeNotices(from, to) {
  if (!from || !to || from > to) return null;
  const start = new Date(from + "T00:00:00");
  const end   = new Date(to   + "T00:00:00");
  const weekends = [];
  const holidays = [];
  const cur = new Date(start);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    const dow = cur.getDay();
    if (dow === 0 || dow === 6) weekends.push(iso);
    if (NATIONAL_HOLIDAYS[iso]) holidays.push({ date: iso, name: NATIONAL_HOLIDAYS[iso] });
    cur.setDate(cur.getDate() + 1);
  }
  if (!weekends.length && !holidays.length) return null;
  return { weekends, holidays };
}

function DateRangeNotices({ from, to }) {
  const notices = useMemo(() => getDateRangeNotices(from, to), [from, to]);
  if (!notices) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      {notices.weekends.length > 0 && (
        <div className="ff-alert ff-alert-warn" style={{ alignItems: "flex-start", gap: 8 }}>
          <CalendarDays size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b>Weekends in this range ({notices.weekends.length} day{notices.weekends.length > 1 ? "s" : ""}):</b>
            <span style={{ marginLeft: 6, fontSize: 12 }}>
              {notices.weekends.slice(0, 6).join(", ")}{notices.weekends.length > 6 ? ` … +${notices.weekends.length - 6} more` : ""}
            </span>
            <div style={{ fontSize: 11, marginTop: 3, opacity: 0.8 }}>Consider applying a weekend premium rate.</div>
          </div>
        </div>
      )}
      {notices.holidays.length > 0 && (
        <div className="ff-alert ff-alert-info" style={{ alignItems: "flex-start", gap: 8 }}>
          <Sun size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b>National holidays in this range ({notices.holidays.length}):</b>
            <ul style={{ margin: "4px 0 0 0", padding: 0, listStyle: "none", fontSize: 12, display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
              {notices.holidays.map(h => (
                <li key={h.date}><span style={{ opacity: 0.7 }}>{h.date}</span> — {h.name}</li>
              ))}
            </ul>
            <div style={{ fontSize: 11, marginTop: 3, opacity: 0.8 }}>Holiday demand may justify a surge rate.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function toIso(d) { return d.toISOString().slice(0, 10); }

function scopeToDates(scope) {
  const today = new Date();
  const from = toIso(today);
  if (scope === "month")    return { from, to: toIso(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
  if (scope === "year")     return { from, to: `${today.getFullYear()}-12-31` };
  if (scope === "12months") {
    const end = new Date(today); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
    return { from, to: toIso(end) };
  }
  return { from: "", to: "" };
}

/* ── Market Pulse card ── */
function MarketPulse({ yourRate }) {
  const [rates, setRates]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [multiplier, setMultiplier]     = useState(1.00);
  const [fetchedAt, setFetchedAt]       = useState(null);

  useEffect(() => {
    apiFetch("/api/admin/competitor-rates/latest")
      .then(rows => {
        setRates(Array.isArray(rows) ? rows : []);
        if (rows?.length) setFetchedAt(rows[0].fetched_at);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const adjustedRate = Math.round(Number(yourRate || 0) * multiplier);
  const median = rates.length
    ? Math.round(rates.reduce((s, r) => s + Number(r.rate), 0) / rates.length)
    : null;

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1.5px solid #e5e7eb", padding: "18px 20px", marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <BarChart2 size={16} color="#7c3aed" />
        <span style={{ fontWeight: 800, fontSize: 14, color: "#111827" }}>Market Pulse</span>
        {fetchedAt && (
          <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>
            Last updated: {new Date(fetchedAt).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: "#9ca3af" }}>Loading competitor rates…</p>
      ) : rates.length === 0 ? (
        <p style={{ fontSize: 12, color: "#9ca3af" }}>No competitor data yet. Rate shop runs at 08:00 & 20:00.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 14 }}>
          <thead>
            <tr style={{ color: "#6b7280", fontSize: 11 }}>
              <th style={{ textAlign: "left", paddingBottom: 6, fontWeight: 600 }}>Competitor</th>
              <th style={{ textAlign: "right", paddingBottom: 6, fontWeight: 600 }}>Room</th>
              <th style={{ textAlign: "right", paddingBottom: 6, fontWeight: 600 }}>Rate</th>
              <th style={{ textAlign: "right", paddingBottom: 6, fontWeight: 600 }}>vs. You</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r, i) => {
              const delta = Number(r.rate) - (yourRate || 0);
              return (
                <tr key={i} style={{ borderTop: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "6px 0", color: "#374151" }}>{r.resort_name}</td>
                  <td style={{ textAlign: "right", color: "#6b7280" }}>{r.room_type}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{rupee(r.rate)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: delta > 0 ? "#16a34a" : "#dc2626" }}>
                    {delta > 0 ? "+" : ""}{rupee(delta)}
                  </td>
                </tr>
              );
            })}
            {median && (
              <tr style={{ borderTop: "2px solid #e5e7eb" }}>
                <td style={{ padding: "6px 0", fontWeight: 700, color: "#111" }} colSpan={2}>Competitor Median</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{rupee(median)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, color: median > (yourRate || 0) ? "#16a34a" : "#dc2626" }}>
                  {median > (yourRate || 0) ? "+" : ""}{rupee(median - (yourRate || 0))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 8 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
          Competitor multiplier: <b style={{ color: "#7c3aed" }}>{multiplier.toFixed(2)}×</b>
          {yourRate ? <> → Preview rate: <b>{rupee(adjustedRate)}</b></> : null}
        </p>
        <input
          type="range" min={0.95} max={1.15} step={0.01} value={multiplier}
          onChange={e => setMultiplier(parseFloat(e.target.value))}
          style={{ width: "100%", accentColor: "#7c3aed" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af" }}>
          <span>0.95× (undercut)</span><span>1.00× (match)</span><span>1.15× (premium)</span>
        </div>
      </div>
    </div>
  );
}

export default function PricingHub() {
  const rooms = useApi(adminRooms);

  const [base,        setBase]        = useState("8500");
  const [roomsSold,   setRoomsSold]   = useState("7");
  const [daysToArr,   setDaysToArr]   = useState("5");
  const [rateForm, setRateForm] = useState({ room_type_id: "", from: "", to: "", rate: "" });
  const [rateMsg, setRateMsg] = useState("");
  const [rateBusy, setRateBusy] = useState(false);
  const [rateMode, setRateMode] = useState("flat");
  const [patternSlots, setPatternSlots] = useState([{ days: [], rate: "" }, { days: [], rate: "" }]);
  const [patternScope, setPatternScope] = useState("custom");

  const result  = base && roomsSold && daysToArr
    ? calculateSurgeRate(Number(base), Number(roomsSold), Number(daysToArr))
    : null;

  // Log suppressed yield whenever the GST-cap fires (best-effort, non-blocking)
  const unconstrained = result
    ? Number(base) * (result.multiplier > 1 ? result.multiplier : 1)
    : null;
  const isCapped = result && result.finalBaseRate === 7499 && unconstrained && unconstrained > 7500;
  useEffect(() => {
    if (!isCapped || !unconstrained) return;
    const delta = unconstrained - 7499;
    apiFetch("/api/admin/suppressed-yield", {
      method: "POST",
      body: JSON.stringify({ unconstrained_price: unconstrained, applied_price: 7499, delta }),
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCapped, unconstrained]);
  const gst     = result ? allocateGstAndCredits(result.finalBaseRate, result.finalBaseRate) : null;
  const types   = rooms.data?.types || [];

  const handleScopeChange = (scope) => {
    setPatternScope(scope);
    if (scope !== "custom") {
      const { from, to } = scopeToDates(scope);
      setRateForm(p => ({ ...p, from, to }));
    }
  };

  const toggleSlotDay = (idx, dayVal) =>
    setPatternSlots(prev => prev.map((s, i) => i !== idx ? s : {
      ...s, days: s.days.includes(dayVal) ? s.days.filter(d => d !== dayVal) : [...s.days, dayVal],
    }));

  const updateSlotRate = (idx, val) =>
    setPatternSlots(prev => prev.map((s, i) => i === idx ? { ...s, rate: val } : s));

  const addSlot = () => { if (patternSlots.length < 3) setPatternSlots(p => [...p, { days: [], rate: "" }]); };
  const removeSlot = (idx) => { if (patternSlots.length > 1) setPatternSlots(p => p.filter((_, i) => i !== idx)); };

  const applyRates = async () => {
    if (!rateForm.room_type_id) return setRateMsg("Select a room type.");
    setRateBusy(true); setRateMsg("");
    try {
      if (rateMode === "flat") {
        if (!rateForm.rate) { setRateMsg("Enter a rate."); setRateBusy(false); return; }
        const r = await apiFetch("/api/admin/rooms/rate", {
          method: "PATCH",
          body: JSON.stringify({ ...rateForm, rate: Number(rateForm.rate) }),
        });
        setRateMsg(`✓ Updated ${r.updated} nights.`);
        notify("Rates updated!", "success");
      } else {
        if (!rateForm.from || !rateForm.to) { setRateMsg("Set a date range."); setRateBusy(false); return; }
        const filled = patternSlots.filter(s => s.days.length > 0 && s.rate !== "");
        if (!filled.length) { setRateMsg("Select days and enter a rate for at least one slot."); setRateBusy(false); return; }
        const r = await apiFetch("/api/admin/rooms/rate/pattern", {
          method: "POST",
          body: JSON.stringify({
            room_type_id: rateForm.room_type_id,
            from: rateForm.from,
            to: rateForm.to,
            slots: filled.map(s => ({ days: s.days, rate: Number(s.rate) })),
          }),
        });
        setRateMsg(`✓ Updated ${r.updated} nights across ${filled.length} slot${filled.length > 1 ? "s" : ""}.`);
        notify("Weekly pattern applied!", "success");
      }
    } catch (e) { setRateMsg(e.message); }
    finally { setRateBusy(false); }
  };

  if (rooms.loading) return <Spinner />;
  if (rooms.error)   return <ApiError msg={rooms.error} />;

  return (
    <div className="ff-page">
      <SectionHeader eyebrow="Revenue Engine" title="Pricing Hub" />

      {/* Occupancy tier table */}
      <Card title="Surge Tier Schedule (15-Room Model)">
        <div className="ff-table-wrap">
          <table className="ff-table">
            <thead>
              <tr><th>Rooms sold</th><th>Occupancy %</th><th>Multiplier</th><th>Strategy</th><th>GST slab</th></tr>
            </thead>
            <tbody>
              {TIER_ROWS.map(t => (
                <tr key={t.rooms}>
                  <td className="ff-mono">{t.rooms}</td>
                  <td>{t.pct}</td>
                  <td><span style={{ fontFamily: "var(--serif)", fontSize: 17, color: "var(--ff-primary)" }}>{t.mult}</span></td>
                  <td>{t.label}</td>
                  <td>
                    <span className={`ff-badge ${Number(t.rooms.replace(/\D.*/, "")) > 9 ? "ff-badge-red" : "ff-badge-green"}`}>
                      {Number(t.rooms.replace(/\D.*/, "")) > 9 ? "18% GST" : "5% GST"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ff-alert ff-alert-warn" style={{ marginTop: 14 }}>
          <AlertTriangle size={16} />
          <span style={{ fontSize: 13 }}>
            <b>GST Danger Zone:</b> If surge pushes the tariff between ₹7,500–₹8,200, the engine hard-caps at <b>₹7,499</b> to keep the guest in the 5% GST bracket. This protects revenue by avoiding the disproportionate 18% jump.
          </span>
        </div>
      </Card>

      {/* Live calculator */}
      <div className="ff-form-grid" style={{ marginTop: 20 }}>
        <Card title="Surge Rate Calculator">
          <div className="ff-fields">
            <Field label="Base season price (₹)">
              <input type="number" min="500" value={base} onChange={e => setBase(e.target.value)} placeholder="8500"/>
            </Field>
            <Field label="Rooms already sold today">
              <input type="number" min="0" max="15" value={roomsSold} onChange={e => setRoomsSold(e.target.value)}/>
              {roomsSold && <ProgressBar pct={(Number(roomsSold) / 15) * 100} />}
              <span className="ff-hint">{Math.round((Number(roomsSold) / 15) * 100)}% occupancy</span>
            </Field>
            <Field label="Days until guest arrival">
              <input type="number" min="0" value={daysToArr} onChange={e => setDaysToArr(e.target.value)}/>
              <span className="ff-hint">
                {Number(daysToArr) <= 3 ? "Near-arrival: distressed inventory modifier applied (−15% if < 4 rooms sold)" :
                 Number(daysToArr) > 14 ? "Advance booking: demand surge applied (+20% if ≥ 7 rooms sold)" :
                 "Mid-range: standard tier applies"}
              </span>
            </Field>
          </div>
        </Card>

        <Card title="Calculated Output">
          {result ? (
            <div className="ff-fields">
              <div className="ff-billing">
                <div className="ff-billing-row"><span>Multiplier applied</span><b style={{ color: "var(--ff-primary)", fontFamily: "var(--serif)", fontSize: 22 }}>×{result.multiplier.toFixed(2)}</b></div>
                <div className="ff-billing-row"><span>Final base rate</span><b style={{ fontFamily: "var(--serif)", fontSize: 20 }}>{rupee(result.finalBaseRate)}</b></div>
                <div className="ff-billing-row"><span>GST slab</span>
                  <b className={result.gstSlab === 18 ? "ff-text-danger" : "ff-text-success"}>{result.gstSlab}%</b>
                </div>
                <div className="ff-billing-row ff-billing-total">
                  <span>Total incl. GST</span>
                  <b>{rupee(result.finalBaseRate * (1 + result.gstSlab / 100))}</b>
                </div>
              </div>
              {result.finalBaseRate === 7499 && (
                <div className="ff-alert ff-alert-warn">
                  <AlertTriangle size={15}/> Engine capped at ₹7,499 — GST danger zone protection active.
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <p className="ff-eyebrow">GST Rule 42 Breakdown</p>
                <div className="ff-billing" style={{ marginTop: 8 }}>
                  <div className="ff-billing-row"><span>ITC eligible</span><b style={{ color: gst.isInputTaxCreditEligible ? "var(--ff-success)" : "var(--ff-danger)" }}>{gst.isInputTaxCreditEligible ? "Yes" : "No (Rule 42 default)"}</b></div>
                  <div className="ff-billing-row"><span>CGST ({result.gstSlab / 2}%)</span><b>{rupee(gst.cgstAmount)}</b></div>
                  <div className="ff-billing-row"><span>SGST ({result.gstSlab / 2}%)</span><b>{rupee(gst.sgstAmount)}</b></div>
                  <div className="ff-billing-row ff-billing-total"><span>Total GST</span><b>{rupee(gst.totalGst)}</b></div>
                </div>
              </div>
            </div>
          ) : (
            <p className="ff-empty">Fill in the inputs to calculate</p>
          )}
        </Card>
      </div>

      {/* Apply rates to inventory */}
      <Card title="Apply Rate to Date Range" style={{ marginTop: 20 }}>
        <div className="ff-fields">

          {/* Mode toggle */}
          <div style={{ display: "flex", gap: 8 }}>
            <button className={`ff-btn ${rateMode === "flat" ? "ff-btn-primary" : "ff-btn-ghost"}`} onClick={() => setRateMode("flat")}>
              Flat Rate
            </button>
            <button className={`ff-btn ${rateMode === "pattern" ? "ff-btn-primary" : "ff-btn-ghost"}`} onClick={() => setRateMode("pattern")}>
              Weekly Pattern
            </button>
          </div>

          {rateMode === "flat" ? (
            <>
              <Grid2>
                <Field label="Room type">
                  <select value={rateForm.room_type_id} onChange={e => setRateForm(p => ({ ...p, room_type_id: e.target.value }))}>
                    <option value="">Select…</option>
                    {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
                <Field label="New rate (₹)">
                  <input type="number" min="0" value={rateForm.rate} onChange={e => setRateForm(p => ({ ...p, rate: e.target.value }))} placeholder="e.g. 9500"/>
                </Field>
                <Field label="From"><input type="date" value={rateForm.from} onChange={e => setRateForm(p => ({ ...p, from: e.target.value }))}/></Field>
                <Field label="To"><input type="date" value={rateForm.to} onChange={e => setRateForm(p => ({ ...p, to: e.target.value }))}/></Field>
              </Grid2>
              <DateRangeNotices from={rateForm.from} to={rateForm.to} />
            </>
          ) : (
            <>
              <Grid2>
                <Field label="Room type">
                  <select value={rateForm.room_type_id} onChange={e => setRateForm(p => ({ ...p, room_type_id: e.target.value }))}>
                    <option value="">Select…</option>
                    {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
                <Field label="Repeat scope">
                  <select value={patternScope} onChange={e => handleScopeChange(e.target.value)}>
                    <option value="custom">Custom range</option>
                    <option value="month">Rest of this month</option>
                    <option value="year">Rest of this year</option>
                    <option value="12months">Full next 12 months</option>
                  </select>
                </Field>
                <Field label="From">
                  <input type="date" value={rateForm.from} onChange={e => { setPatternScope("custom"); setRateForm(p => ({ ...p, from: e.target.value })); }}/>
                </Field>
                <Field label="To">
                  <input type="date" value={rateForm.to} onChange={e => { setPatternScope("custom"); setRateForm(p => ({ ...p, to: e.target.value })); }}/>
                </Field>
              </Grid2>
              <DateRangeNotices from={rateForm.from} to={rateForm.to} />

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {patternSlots.map((slot, idx) => (
                  <div key={idx} style={{ border: "1px solid var(--ff-border, #e5e5e5)", borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span className="ff-eyebrow" style={{ fontSize: 12 }}>Rate slot {idx + 1}</span>
                      {patternSlots.length > 1 && (
                        <button className="ff-btn ff-btn-ghost" style={{ padding: "2px 8px", fontSize: 13 }} onClick={() => removeSlot(idx)}>&#x2715;</button>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {WEEKDAYS.map(day => (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => toggleSlotDay(idx, day.value)}
                          style={{
                            padding: "4px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                            border: "1.5px solid",
                            borderColor: slot.days.includes(day.value) ? "var(--ff-primary)" : "var(--ff-border, #ddd)",
                            background: slot.days.includes(day.value) ? "var(--ff-primary)" : "transparent",
                            color: slot.days.includes(day.value) ? "#fff" : "inherit",
                            transition: "all 0.15s",
                          }}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                    <Field label="Rate for these days (₹)">
                      <input type="number" min="0" value={slot.rate} onChange={e => updateSlotRate(idx, e.target.value)} placeholder="e.g. 1800"/>
                    </Field>
                  </div>
                ))}
                {patternSlots.length < 3 && (
                  <button className="ff-btn ff-btn-ghost" style={{ alignSelf: "flex-start" }} onClick={addSlot}>
                    + Add another rate
                  </button>
                )}
              </div>
            </>
          )}

          <button className="ff-btn ff-btn-primary" onClick={applyRates} disabled={rateBusy} style={{ alignSelf: "flex-start" }}>
            <Zap size={15} /> {rateBusy ? "Applying…" : "Apply Rates"}
          </button>
          {rateMsg && <p style={{ fontSize: 13, color: "var(--ff-accent)" }}>{rateMsg}</p>}
        </div>
      </Card>

      <MarketPulse yourRate={result?.finalBaseRate} />
    </div>
  );
}
