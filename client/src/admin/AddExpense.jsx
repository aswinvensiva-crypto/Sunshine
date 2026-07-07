import { useState } from "react";
import { ArrowLeft, Trash2, X } from "lucide-react";
import { useApi, apiFetch, adminExpenses, addExpense, deleteExpense, getUser, rupee, fmtDate, notify } from "./adminContext.js";
import { SectionHeader, Card, Field, Grid2, TableWrap } from "./ui.jsx";
import FfSubmitButton from "../components/FfSubmitButton.jsx";

const EXPENSE_CATEGORIES = ["Pool", "Salaries", "Utilities", "Supplies", "Marketing", "Maintenance", "Food & Beverage", "Other"];

const BLANK = { category: "Supplies", description: "", amount: "", spent_on: new Date().toISOString().slice(0, 10) };

const CATEGORY_COLORS = {
  "Pool": "#06b6d4", "Salaries": "#8b5cf6", "Utilities": "#f59e0b",
  "Supplies": "#3b82f6", "Marketing": "#ec4899", "Maintenance": "#f97316",
  "Food & Beverage": "#10b981", "Other": "#6b7280",
};

export default function AddExpense({ onNavigate }) {
  const expenses = useApi(adminExpenses);

  const currentUser = getUser();
  const isOwner = currentUser?.role === "owner";

  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      notify("Enter a valid amount", "error"); return;
    }
    setSaving(true);
    try {
      await addExpense({
        category:    form.category,
        description: form.description || null,
        amount:      Number(form.amount),
        spent_on:    form.spent_on || null,
      });
      notify("Expense added", "success");
      setForm(BLANK);
      expenses.reload();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  async function handleDeleteExpense() {
    if (!confirmDel) return;
    setSaving(true);
    try {
      await deleteExpense(confirmDel);
      notify("Expense deleted", "success");
      setConfirmDel(null);
      expenses.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setSaving(false); }
  }

  async function handleClearAllExpenses() {
    setClearingAll(true);
    try {
      await apiFetch("/api/admin/expenses", { method: "DELETE" });
      notify("All expenses cleared", "success");
      setConfirmClearAll(false);
      expenses.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setClearingAll(false); }
  }

  const expenseList = expenses.data || [];

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Finance"
        title="Expense Ledger"
        action={
          <button className="ff-btn ff-btn-ghost" onClick={() => onNavigate("accounts")}>
            <ArrowLeft size={15} /> Back to Accounts
          </button>
        }
      />

      <Card title="Expense Details">
        <form onSubmit={handleSubmit} className="ff-fields">
          <Field label="Category">
            <select value={form.category} onChange={e => f("category", e.target.value)}>
              {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>

          <Field label="Description">
            <input
              type="text"
              placeholder="Optional note"
              value={form.description}
              onChange={e => f("description", e.target.value)}
            />
          </Field>

          <Grid2>
            <Field label="Amount (₹) *">
              <input
                type="number"
                min="1"
                step="0.01"
                required
                placeholder="0.00"
                value={form.amount}
                onChange={e => f("amount", e.target.value)}
              />
            </Field>
            <Field label="Date *">
              <input
                type="date"
                required
                value={form.spent_on}
                onChange={e => f("spent_on", e.target.value)}
              />
            </Field>
          </Grid2>

          <FfSubmitButton
            className="ff-btn-primary"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={handleSubmit}
            spinnerLabel="Saving…"
          >
            Add Expense
          </FfSubmitButton>
        </form>
      </Card>

      <Card
        title="Expense Ledger (Month)"
        noPad
        style={{ marginTop: 20 }}
        action={isOwner && (
          <button
            className="ff-btn ff-btn-danger"
            disabled={expenseList.length === 0}
            onClick={() => setConfirmClearAll(true)}
          >
            <Trash2 size={14} /> Clear All Expenses
          </button>
        )}
      >
        <TableWrap>
          <thead>
            <tr>
              <th>Date</th><th>Category</th><th>Description</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              {isOwner && <th style={{ width: 48 }} />}
            </tr>
          </thead>
          <tbody>
            {expenseList.length === 0 ? (
              <tr><td colSpan={isOwner ? 5 : 4} className="ff-empty" style={{ textAlign: "center" }}>No expenses this month</td></tr>
            ) : expenseList.map(e => (
              <tr key={e.id}>
                <td>{fmtDate(e.spent_on)}</td>
                <td style={{ textTransform: "capitalize" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_COLORS[e.category] || "#6b7280", display: "inline-block" }} />
                    {e.category}
                  </span>
                </td>
                <td>{e.description || <span style={{ color: "var(--ff-muted)" }}>—</span>}</td>
                <td className="ff-mono" style={{ textAlign: "right" }}>{rupee(e.amount)}</td>
                {isOwner && (
                  <td>
                    <button className="ff-icon-btn" title="Delete expense" style={{ color: "var(--ff-danger)" }} onClick={() => setConfirmDel(e.id)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {confirmClearAll && (
        <div className="ff-backdrop" onClick={() => setConfirmClearAll(false)}>
          <div className="ff-modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Clear All Expenses?</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setConfirmClearAll(false)}><X size={18} /></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ color: "var(--ff-muted)", marginBottom: 20 }}>This will permanently delete all expense records. This action cannot be undone.</p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmClearAll(false)}>Cancel</button>
                <FfSubmitButton
                  className="ff-btn-primary"
                  style={{ background: "var(--ff-danger)", borderColor: "var(--ff-danger)" }}
                  onClick={handleClearAllExpenses}
                  spinnerLabel="Clearing…"
                >
                  Yes, Clear All
                </FfSubmitButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="ff-backdrop" onClick={() => setConfirmDel(null)}>
          <div className="ff-modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Delete Expense?</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setConfirmDel(null)}><X size={18} /></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ color: "var(--ff-muted)", marginBottom: 20 }}>This will permanently remove the expense record.</p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                <FfSubmitButton
                  className="ff-btn-primary"
                  style={{ background: "var(--ff-danger)", borderColor: "var(--ff-danger)" }}
                  onClick={handleDeleteExpense}
                  spinnerLabel="Deleting…"
                >
                  Yes, Delete
                </FfSubmitButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
