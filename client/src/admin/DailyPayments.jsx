import { useState } from "react";
import {
  CreditCard, CheckCircle, RefreshCw, ShieldCheck, Clock, AlertCircle, Wallet, RotateCcw,
} from "lucide-react";
import { useApi, apiFetch, fmtDate, rupee, getUser, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, TableWrap, EmptyState } from "./ui.jsx";

const todayISO = () => new Date().toISOString().slice(0, 10);

const PAY_STATUS = {
  paid:    { cls: "ff-badge-green",  label: "Paid"    },
  partial: { cls: "ff-badge-yellow", label: "Partial" },
  pending: { cls: "ff-badge-red",    label: "Pending" },
};

export default function DailyPayments() {
  const [date, setDate] = useState(todayISO());
  const isOwner = getUser()?.role === "owner";

  const bookings = useApi(() => apiFetch(`/api/admin/daily-payments?date=${date}`), [date]);
  const data = bookings.data || [];

  const [verifying, setVerifying] = useState({});

  const newBookings    = data.filter(b => b.payment_entry_type === 'new');
  const balanceEntries = data.filter(b => b.payment_entry_type === 'balance');
  const refundEntries  = data.filter(b => b.payment_entry_type === 'refund');
  const totalRevenue   = newBookings.reduce((s, b) => s + Number(b.total_amount), 0);
  const totalCollected = data.filter(b => b.payment_entry_type !== 'refund').reduce((s, b) => s + (b.payment_entry_type === 'balance' ? Number(b.total_amount) : Number(b.advance_paid)), 0);
  const totalPending   = data.filter(b => b.payment_entry_type !== 'refund').reduce((s, b) => s + Number(b.pending_amount), 0);
  const totalRefunds   = refundEntries.reduce((s, b) => s + Number(b.refund_amount || 0), 0);
  const verifiedCount  = data.filter(b => b.owner_payment_verified).length;

  async function handleVerify(booking) {
    if (!window.confirm(`Mark payment for ${booking.guest} (${booking.reference}) as verified?`)) return;
    setVerifying(v => ({ ...v, [booking.id]: true }));
    try {
      await apiFetch(`/api/admin/bookings/${booking.id}/verify-payment`, { method: "PATCH" });
      notify("Payment verified", "success");
      bookings.reload();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setVerifying(v => ({ ...v, [booking.id]: false }));
    }
  }

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Payments"
        title="Daily Payment Sheet"
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={e => setDate(e.target.value)}
              style={{
                background: "var(--ff-surface)", color: "var(--ff-text)",
                border: "1px solid var(--ff-border)", borderRadius: 6,
                padding: "6px 10px", fontSize: 13,
              }}
            />
            <button className="ff-btn ff-btn-ghost" onClick={bookings.reload}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        }
      />

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
        <SummaryCard label="New Bookings"     value={newBookings.length}   icon={CreditCard}  color="var(--ff-primary)" />
        <SummaryCard label="Balance Receipts" value={balanceEntries.length} icon={Wallet}      color="#8b5cf6" />
        <SummaryCard label="Total Revenue"    value={rupee(totalRevenue)}   icon={CreditCard}  color="#22c55e" />
        <SummaryCard label="Collected"        value={rupee(totalCollected)} icon={CheckCircle} color="#3b82f6" />
        <SummaryCard label="Pending"          value={rupee(totalPending)}   icon={AlertCircle} color="#f59e0b" />
        <SummaryCard label="Refunds Issued"   value={rupee(totalRefunds)}   icon={RotateCcw}   color="#ef4444" />
        <SummaryCard label="Owner Verified"   value={`${verifiedCount} / ${data.length}`} icon={ShieldCheck} color="#a855f7" />
      </div>

      {bookings.loading && <Spinner />}
      {bookings.error   && <ApiError msg={bookings.error} />}

      {!bookings.loading && !bookings.error && refundEntries.length > 0 && (
        <div className="ff-card" style={{ padding: 0, marginBottom: 24 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--ff-border)", display: "flex", alignItems: "center", gap: 8 }}>
            <RotateCcw size={15} style={{ color: "#ef4444" }} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>Refunds Processed</span>
            <span className="ff-muted-sm" style={{ marginLeft: "auto", fontSize: 11 }}>
              Total: {rupee(totalRefunds)}
            </span>
          </div>
          <TableWrap>
            <thead>
              <tr>
                <th>Booking Ref</th><th>Guest</th><th>Room</th>
                <th>Reason</th><th>Method</th>
                <th style={{ textAlign: "right" }}>Refund Amount</th>
                <th>Status</th><th>Processed At</th>
              </tr>
            </thead>
            <tbody>
              {refundEntries.map(b => (
                <tr key={`refund-${b.id}`}>
                  <td className="ff-mono" style={{ fontWeight: 600, fontSize: 12 }}>{b.reference}</td>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{b.guest}</td>
                  <td style={{ fontSize: 13 }}>{b.room}{b.room_number ? ` #${b.room_number}` : ""}</td>
                  <td style={{ fontSize: 12, textTransform: "capitalize", color: "var(--ff-muted)" }}>
                    {(b.refund_reason || "—").replace(/_/g, " ")}
                  </td>
                  <td style={{ textTransform: "capitalize", fontSize: 13 }}>{b.refund_method || "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "#ef4444" }}>
                    {rupee(b.refund_amount)}
                  </td>
                  <td>
                    <span className={`ff-badge ${b.refund_status === "processed" ? "ff-badge-green" : "ff-badge-yellow"}`}>
                      {b.refund_status === "processed" ? "Processed" : "Pending"}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--ff-muted)", whiteSpace: "nowrap" }}>
                    {b.refund_processed_at
                      ? new Date(b.refund_processed_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}

      {!bookings.loading && !bookings.error && (
        <div className="ff-card" style={{ padding: 0 }}>
          {data.filter(b => b.payment_entry_type !== 'refund').length === 0 ? (
            <EmptyState icon={CreditCard} text={`No bookings created on ${fmtDate(date + "T00:00:00")}.`} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Booking Ref</th>
                  <th>Guest</th>
                  <th>Room</th>
                  <th>Check-in / Out</th>
                  <th>Total</th>
                  <th>Advance</th>
                  <th>Pending</th>
                  <th>Method</th>
                  <th>Pay Status</th>
                  <th>Verified</th>
                  <th>Invoice</th>
                  {isOwner && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.filter(b => b.payment_entry_type !== 'refund').map(b => {
                  const badge = PAY_STATUS[b.payment_status] || PAY_STATUS.pending;
                  return (
                    <tr key={b.id} style={{ verticalAlign: "middle" }}>
                      <td>
                        {b.payment_entry_type === 'balance' ? (
                          <span className="ff-badge ff-badge-yellow" style={{ display: "flex", alignItems: "center", gap: 4, width: "fit-content" }}>
                            <Wallet size={10} /> Balance
                          </span>
                        ) : (
                          <span className="ff-badge ff-badge-blue" style={{ display: "flex", alignItems: "center", gap: 4, width: "fit-content" }}>
                            <CreditCard size={10} /> New
                          </span>
                        )}
                      </td>
                      <td className="ff-mono" style={{ fontWeight: 600, fontSize: 12 }}>{b.reference}</td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{b.guest}</div>
                        {b.email && (
                          <div style={{ fontSize: 11, color: "var(--ff-muted)" }}>{b.email}</div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: 13 }}>{b.room}</div>
                        {b.room_number && (
                          <div style={{ fontSize: 11, color: "var(--ff-muted)" }}>#{b.room_number}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        <div>{fmtDate(b.check_in)}</div>
                        <div style={{ color: "var(--ff-muted)" }}>{fmtDate(b.check_out)}</div>
                      </td>
                      <td style={{ fontWeight: 700, color: "var(--ff-text)" }}>{rupee(b.total_amount)}</td>
                      <td style={{ color: "#22c55e", fontWeight: 600 }}>{rupee(b.advance_paid)}</td>
                      <td style={{ color: Number(b.pending_amount) > 0 ? "#f59e0b" : "var(--ff-muted)", fontWeight: 600 }}>
                        {rupee(b.pending_amount)}
                      </td>
                      <td style={{ textTransform: "capitalize", fontSize: 13 }}>{b.payment_method}</td>
                      <td>
                        <span className={`ff-badge ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td>
                        {b.owner_payment_verified ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#a855f7", fontSize: 12, fontWeight: 600 }}>
                            <ShieldCheck size={13} /> Verified
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--ff-muted)" }}>—</span>
                        )}
                      </td>
                      <td>
                        {b.invoice_sent_at ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#3b82f6", fontSize: 12, fontWeight: 600 }}>
                            <CheckCircle size={13} /> Sent
                          </span>
                        ) : (
                          <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--ff-muted)", fontSize: 12 }}>
                            <Clock size={13} /> Not sent
                          </span>
                        )}
                      </td>
                      {isOwner && (
                        <td>
                          {!b.owner_payment_verified ? (
                            <button
                              className="ff-btn ff-btn-ghost"
                              style={{ fontSize: 12, padding: "4px 10px" }}
                              disabled={verifying[b.id]}
                              onClick={() => handleVerify(b)}
                              title="Mark payment as verified"
                            >
                              <ShieldCheck size={12} />
                              {verifying[b.id] ? "…" : "Verify"}
                            </button>
                          ) : (
                            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#a855f7", fontSize: 12, fontWeight: 600 }}>
                              <ShieldCheck size={13} /> Verified
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, color }) {
  return (
    <div className="ff-card" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon size={15} style={{ color }} />
        <span style={{ fontSize: 11, color: "var(--ff-muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ff-text)" }}>{value}</div>
    </div>
  );
}
