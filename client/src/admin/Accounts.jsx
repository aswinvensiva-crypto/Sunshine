import { useState, useEffect } from "react";
import { Scale, CheckCircle, AlertCircle, DollarSign, Receipt, TrendingDown, Plus, TrendingUp } from "lucide-react";
import { useApi, adminDashboard, adminExpenses, adminBookings, addExpense, getUser, rupee, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, StatCard, TableWrap, ProgressBar, SideDrawer } from "./ui.jsx";
import FfSubmitButton from "../components/FfSubmitButton.jsx";
import DonutChart from "../components/accounts/DonutChart.jsx";
import BarChart from "../components/accounts/BarChart.jsx";
import SuppressedYieldPanel from "../components/accounts/SuppressedYieldPanel.jsx";

const EXPENSE_CATEGORIES = ["Pool", "Salaries", "Utilities", "Supplies", "Marketing", "Maintenance", "Food & Beverage", "Other"];
const BLANK_FORM = { category: "Supplies", description: "", amount: "", spent_on: new Date().toISOString().slice(0, 10) };

const CATEGORY_COLORS = {
  "Pool": "#06b6d4", "Salaries": "#8b5cf6", "Utilities": "#f59e0b",
  "Supplies": "#3b82f6", "Marketing": "#ec4899", "Maintenance": "#f97316",
  "Food & Beverage": "#10b981", "Other": "#6b7280",
};

function shortRupee(n) {
  const abs = Math.abs(n);
  if (abs >= 100000) return `₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000)   return `₹${(abs / 1000).toFixed(1)}K`;
  return `₹${abs}`;
}

export default function Accounts({ onNavigate }) {
  const kpi      = useApi(adminDashboard);
  const expenses = useApi(adminExpenses);
  const bookings = useApi(() => adminBookings(""));

  const currentUser = getUser();
  const isOwner = currentUser?.role === "owner";

  const [posEntries] = useState([
    { id: 1, date: new Date().toISOString().slice(0,10), description: "Room charge — AZ ref",  posAmount: 12500, upiAmount: 12500, pmsAmount: 12500, diff: 0 },
    { id: 2, date: new Date().toISOString().slice(0,10), description: "Advance deposit",        posAmount: 5000,  upiAmount: 4900,  pmsAmount: 5000,  diff: 100 },
    { id: 3, date: new Date().toISOString().slice(0,10), description: "Restaurant add-on",     posAmount: 1800,  upiAmount: 1800,  pmsAmount: 0,     diff: 1800 },
  ]);

  const [showModal, setShowModal] = useState(false);
  const [form,      setForm]      = useState(BLANK_FORM);
  const [saving,    setSaving]    = useState(false);

  async function handleAddExpense(e) {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) { notify("Enter a valid amount", "error"); return; }
    setSaving(true);
    try {
      await addExpense({ category: form.category, description: form.description || null, amount: Number(form.amount), spent_on: form.spent_on || null });
      notify("Expense added", "success");
      setShowModal(false); setForm(BLANK_FORM);
      expenses.reload(); kpi.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setSaving(false); }
  }

  if (kpi.loading || expenses.loading || bookings.loading) return <Spinner />;
  if (kpi.error) return <ApiError msg={kpi.error} />;

  const d = kpi.data || {};
  const expenseList = expenses.data || [];
  const bookingList = bookings.data || [];

  const above7500 = bookingList.filter(b => Number(b.total_amount) / Math.max(1, b.nights || 1) > 7500);
  const below7500 = bookingList.filter(b => Number(b.total_amount) / Math.max(1, b.nights || 1) <= 7500);
  const revAbove  = above7500.reduce((s, b) => s + Number(b.total_amount), 0);
  const revBelow  = below7500.reduce((s, b) => s + Number(b.total_amount), 0);
  const totalRev  = revAbove + revBelow;
  const itcReversal = revBelow > 0 && totalRev > 0
    ? (revBelow / totalRev) * expenseList.reduce((s, e) => s + Number(e.amount), 0) * 0.05
    : 0;

  const totalPOS  = posEntries.reduce((s, r) => s + r.posAmount, 0);
  const totalUPI  = posEntries.reduce((s, r) => s + r.upiAmount, 0);
  const totalPMS  = posEntries.reduce((s, r) => s + r.pmsAmount, 0);
  const shortfall = totalPOS - totalUPI;

  const expenseByCategory = EXPENSE_CATEGORIES.reduce((acc, cat) => {
    const total = expenseList.filter(e => e.category === cat).reduce((s, e) => s + Number(e.amount), 0);
    if (total > 0) acc.push({ label: cat, value: total, color: CATEGORY_COLORS[cat] || "#6b7280" });
    return acc;
  }, []);

  const revenueBar = [
    { label: "Revenue",    value: d.monthRevenue  || 0, color: "#3b82f6", short: shortRupee(d.monthRevenue  || 0) },
    { label: "Expenses",   value: d.monthExpenses || 0, color: "#f59e0b", short: shortRupee(d.monthExpenses || 0) },
    { label: "Net Profit", value: d.monthProfit   || 0, color: "#10b981", short: shortRupee(d.monthProfit   || 0) },
  ];

  const gstSegments = [
    { label: "Above ₹7,500 (18%)", value: revAbove, color: "#3b82f6" },
    { label: "At/below ₹7,500 (5%)", value: revBelow, color: "#f59e0b" },
  ];

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Finance"
        title="Accounts & Reconciliation"
        action={isOwner && (
          <button className="ff-btn ff-btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Add Expense
          </button>
        )}
      />

      <div className="ff-metrics-grid">
        <StatCard label="Month Revenue"  value={rupee(d.monthRevenue)}  icon={DollarSign}   iconBg="ff-icon-bg-accent" />
        <StatCard label="Month Expenses" value={rupee(d.monthExpenses)} icon={Receipt}      iconBg="ff-icon-bg-warning" />
        <StatCard label="Net Profit"     value={rupee(d.monthProfit)}   icon={TrendingDown} iconBg={d.monthProfit >= 0 ? "ff-icon-bg-success" : "ff-icon-bg-danger"} valueColor={d.monthProfit >= 0 ? "ff-text-success" : "ff-text-danger"} />
        <StatCard label="UPI Shortfall"  value={rupee(shortfall)}       icon={Scale}        iconBg={shortfall > 0 ? "ff-icon-bg-danger" : "ff-icon-bg-success"} valueColor={shortfall > 0 ? "ff-text-danger" : "ff-text-success"} />
      </div>

      {/* ── Business Charts ───────────────────────────────────── */}
      <div className="ff-form-grid" style={{ marginTop: 20 }}>

        {/* Expense Breakdown Donut */}
        <Card title="Expense Breakdown by Category">
          {expenseByCategory.length === 0 ? (
            <p style={{ color: "var(--ff-muted)", textAlign: "center", padding: "28px 0", fontSize: 13 }}>No expenses recorded this month</p>
          ) : (
            <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
              <DonutChart segments={expenseByCategory} size={140} thickness={28} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                {expenseByCategory.map(seg => (
                  <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: "var(--ff-muted)" }}>{seg.label}</span>
                    <span style={{ fontWeight: 600 }}>{rupee(seg.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Revenue vs Expenses Bar Chart */}
        <Card title="Revenue vs Expenses — This Month">
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
            <BarChart bars={revenueBar} height={120} />
          </div>
        </Card>

      </div>

      {/* GST Split + ITC */}
      <div className="ff-form-grid" style={{ marginTop: 20 }}>
        <Card title="GST Revenue Split by Tariff Slab">
          <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 12 }}>
            <DonutChart segments={gstSegments} size={100} thickness={22} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              {gstSegments.map(seg => (
                <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, color: "var(--ff-muted)" }}>{seg.label}</span>
                  <b>{rupee(seg.value)}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="ff-billing">
            <div className="ff-billing-row"><span>Bookings above ₹7,500 (18% GST)</span><b>{above7500.length} bookings</b></div>
            <div className="ff-billing-row"><span>Bookings at/below ₹7,500 (5% GST)</span><b>{below7500.length} bookings</b></div>
            <div style={{ margin: "12px 0 8px" }}>
              <p className="ff-hint">Revenue share at 5% slab</p>
              <ProgressBar pct={totalRev > 0 ? (revBelow / totalRev) * 100 : 0} color="#f59e0b" />
              <p className="ff-hint" style={{ marginTop: 4 }}>{totalRev > 0 ? ((revBelow / totalRev) * 100).toFixed(1) : 0}% of revenue in low-GST bracket</p>
            </div>
          </div>
        </Card>

        <Card title="Rule 42 — Estimated ITC Reversal Obligation">
          <div className="ff-billing">
            <div className="ff-billing-row"><span>Total input expenses (month)</span><b>{rupee(expenseList.reduce((s, e) => s + Number(e.amount), 0))}</b></div>
            <div className="ff-billing-row"><span>Non-ITC-eligible portion (5% slab %)</span><b>{totalRev > 0 ? ((revBelow / totalRev) * 100).toFixed(1) : 0}%</b></div>
            <div className="ff-billing-row ff-billing-total"><span>Estimated ITC reversal (5% of non-eligible)</span><b style={{ color: "var(--ff-danger)" }}>{rupee(itcReversal)}</b></div>
          </div>
          <div className="ff-alert ff-alert-info" style={{ marginTop: 14 }}>
            <Receipt size={15}/>
            <span style={{ fontSize: 12 }}>This estimate is for GSTR-1 preparation. Consult your CA to finalize.</span>
          </div>
        </Card>
      </div>

      <Card title="3-Way Reconciliation Matrix — POS vs UPI vs PMS" noPad style={{ marginTop: 20 }}>
        <div className="ff-card-body" style={{ padding: "16px 0 0" }}>
          <div style={{ padding: "0 20px 12px", display: "flex", gap: 20, fontSize: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: "var(--ff-success)" }}/> Matched</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: "var(--ff-danger)" }}/> Shortfall</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: "var(--ff-warning)" }}/> PMS missing</div>
          </div>
          <TableWrap sticky>
            <thead>
              <tr>
                <th>Date</th><th>Description</th>
                <th style={{ textAlign:"right" }}>POS Terminal</th>
                <th style={{ textAlign:"right" }}>UPI Gateway</th>
                <th style={{ textAlign:"right" }}>PMS Report</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {posEntries.map(r => {
                const flag = r.diff > 0;
                const pmsMissing = r.pmsAmount === 0 && r.posAmount > 0;
                return (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.description}</td>
                    <td className="ff-mono" style={{ textAlign:"right" }}>{rupee(r.posAmount)}</td>
                    <td className="ff-mono" style={{ textAlign:"right", color: r.upiAmount !== r.posAmount ? "var(--ff-danger)" : "" }}>{rupee(r.upiAmount)}</td>
                    <td className="ff-mono" style={{ textAlign:"right", color: pmsMissing ? "var(--ff-warning)" : "" }}>{pmsMissing ? "Not posted" : rupee(r.pmsAmount)}</td>
                    <td>
                      {flag || pmsMissing
                        ? <span className="ff-badge ff-badge-red"><AlertCircle size={11} style={{ verticalAlign:"-1px", marginRight:4 }}/>₹{r.diff.toLocaleString("en-IN")}</span>
                        : <span className="ff-badge ff-badge-green"><CheckCircle size={11} style={{ verticalAlign:"-1px", marginRight:4 }}/>Matched</span>}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ fontWeight: 700, borderTop: "2px solid var(--ff-border)" }}>
                <td colSpan={2}>Totals</td>
                <td className="ff-mono" style={{ textAlign:"right" }}>{rupee(totalPOS)}</td>
                <td className="ff-mono" style={{ textAlign:"right" }}>{rupee(totalUPI)}</td>
                <td className="ff-mono" style={{ textAlign:"right" }}>{rupee(totalPMS)}</td>
                <td><span className={`ff-badge ${shortfall > 0 ? "ff-badge-red" : "ff-badge-green"}`}>{shortfall > 0 ? `−${rupee(shortfall)}` : "Balanced"}</span></td>
              </tr>
            </tbody>
          </TableWrap>
          <p className="ff-footnote" style={{ padding: "10px 20px" }}>
            Connect your Razorpay/payment gateway webhook to POST /api/payments to populate this table automatically.
          </p>
        </div>
      </Card>

      {/* Suppressed Yield Analytics */}
      {isOwner && (
        <Card title="Suppressed Yield Analytics — GST Cap Impact" style={{ marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <TrendingUp size={16} color="#f59e0b" />
            <span style={{ fontSize: 13, color: "#6b7280" }}>Revenue lost due to ₹7,499 GST-cap this month</span>
          </div>
          <SuppressedYieldPanel />
        </Card>
      )}

      {showModal && (
        <SideDrawer title="Add Expense" onClose={() => setShowModal(false)}>
          <form onSubmit={handleAddExpense} className="ff-fields">
            <div className="ff-field">
              <label>Category</label>
              <select className="ff-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="ff-field">
              <label>Description</label>
              <input type="text" placeholder="Optional note" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="ff-field">
              <label>Amount (₹)</label>
              <input type="number" min="1" step="0.01" required placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="ff-field">
              <label>Date</label>
              <input type="date" required value={form.spent_on} onChange={e => setForm(f => ({ ...f, spent_on: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button type="button" className="ff-btn ff-btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <FfSubmitButton className="ff-btn-primary" onClick={handleAddExpense} spinnerLabel="Saving…">Add Expense</FfSubmitButton>
            </div>
          </form>
        </SideDrawer>
      )}

    </div>
  );
}
