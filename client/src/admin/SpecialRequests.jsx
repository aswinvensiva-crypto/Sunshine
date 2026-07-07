import { useState } from "react";
import { Clock, Plus, X, Check, AlertTriangle } from "lucide-react";
import { useApi, rupee, fmtDate, notify, apiFetch } from "./adminContext.js";
import { adminSpecialRequests, adminCreateSpecialRequest, adminUpdateSpecialRequest, adminBookings } from "../api/client.js";
import { Spinner, ApiError, SectionHeader, TableWrap, Modal, Field, Grid2, Card } from "./ui.jsx";

const STATUS_STYLE = {
  pending:  { bg: "#fef3c7", color: "#92400e", label: "Pending" },
  approved: { bg: "#dcfce7", color: "#14532d", label: "Approved" },
  denied:   { bg: "#fee2e2", color: "#7f1d1d", label: "Denied"  },
  waived:   { bg: "#f3f4f6", color: "#374151", label: "Waived"  },
};

const TYPE_LABEL = { early_checkin: "Early Check-In", late_checkout: "Late Check-Out" };

const FEE_PER_HOUR = 150; // mirrors backend default; update if EARLY_LATE_FEE_PER_HOUR env is set

function calcFee(requestType, requestedTime) {
  if (!requestedTime) return { hoursDelta: 0, totalFee: 0 };
  const standard = requestType === "early_checkin" ? "11:00" : "10:00";
  const [rh, rm] = requestedTime.split(":").map(Number);
  const [sh, sm] = standard.split(":").map(Number);
  const deltaMin = Math.abs((rh * 60 + rm) - (sh * 60 + sm));
  const hoursDelta = Math.round(deltaMin / 60 * 100) / 100;
  const totalFee = Math.round(hoursDelta * FEE_PER_HOUR * 100) / 100;
  return { hoursDelta, totalFee };
}

export default function SpecialRequests() {
  const [filter, setFilter] = useState("");
  const requests = useApi(() => adminSpecialRequests(filter), [filter]);

  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm]   = useState({ booking_ref: "", request_type: "early_checkin", requested_time: "09:00", notes: "" });
  const [addBusy, setAddBusy]   = useState(false);
  const [refMatches, setRefMatches] = useState([]);

  const [actionBusy, setActionBusy] = useState({});

  const updAdd = (k, v) => setAddForm(p => ({ ...p, [k]: v }));

  const { hoursDelta, totalFee } = calcFee(addForm.request_type, addForm.requested_time);

  const searchBookingRef = async (ref) => {
    updAdd("booking_ref", ref);
    if (ref.length < 3) { setRefMatches([]); return; }
    try {
      const list = await adminBookings(`?q=${encodeURIComponent(ref)}`);
      setRefMatches((list || []).slice(0, 5));
    } catch (_) { setRefMatches([]); }
  };

  const submitAdd = async (e) => {
    e.preventDefault();
    if (!addForm.booking_id) { notify("Select a booking first", "error"); return; }
    setAddBusy(true);
    try {
      await adminCreateSpecialRequest({
        booking_id:     addForm.booking_id,
        request_type:   addForm.request_type,
        requested_time: addForm.requested_time,
        notes:          addForm.notes || undefined,
      });
      notify("Request created", "success");
      setAddModal(false);
      setAddForm({ booking_ref: "", request_type: "early_checkin", requested_time: "09:00", notes: "" });
      setRefMatches([]);
      requests.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setAddBusy(false); }
  };

  const updateStatus = async (id, status) => {
    setActionBusy(p => ({ ...p, [id]: status }));
    try {
      await adminUpdateSpecialRequest(id, { status });
      notify(`Request ${status}`, "success");
      requests.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setActionBusy(p => ({ ...p, [id]: null })); }
  };

  const rows = requests.data || [];

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Guest Services"
        title="Special Requests"
        action={
          <button className="ff-btn ff-btn-primary" onClick={() => setAddModal(true)}>
            <Plus size={15} /> New Request
          </button>
        }
      />

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["", "pending", "approved", "denied", "waived"].map(s => (
          <button
            key={s}
            className={`ff-btn ${filter === s ? "ff-btn-primary" : "ff-btn-outline"}`}
            style={{ padding: "4px 14px", fontSize: 12 }}
            onClick={() => setFilter(s)}
          >
            {s === "" ? "All" : STATUS_STYLE[s]?.label}
          </button>
        ))}
      </div>

      {requests.loading && <Spinner />}
      {requests.error   && <ApiError msg={requests.error} />}

      {!requests.loading && !requests.error && (
        <div className="ff-card" style={{ padding: 0 }}>
          <TableWrap>
            <thead>
              <tr>
                <th>Booking</th>
                <th>Guest</th>
                <th>Room</th>
                <th>Stay</th>
                <th>Type</th>
                <th>Requested</th>
                <th style={{ textAlign: "right" }}>Fee</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="ff-empty" style={{ textAlign: "center" }}>No special requests{filter ? ` with status "${STATUS_STYLE[filter]?.label}"` : ""}.</td></tr>
              ) : rows.map(r => {
                const s = STATUS_STYLE[r.status] || STATUS_STYLE.pending;
                const busy = actionBusy[r.id];
                return (
                  <tr key={r.id}>
                    <td className="ff-mono" style={{ fontSize: 12 }}>{r.reference}</td>
                    <td>{r.guest_name}</td>
                    <td>{r.room_name}{r.room_number ? ` (#${r.room_number})` : ""}</td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      {fmtDate(r.check_in)} → {fmtDate(r.check_out)}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {TYPE_LABEL[r.request_type] || r.request_type}
                      </span>
                      <div style={{ fontSize: 11, color: "var(--ff-muted)" }}>
                        Standard: {r.request_type === "early_checkin" ? "11:00 AM" : "10:00 AM"}
                      </div>
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      {r.requested_time?.slice(0, 5)}
                      {r.hours_delta > 0 && (
                        <span style={{ fontSize: 11, color: "var(--ff-muted)", display: "block" }}>
                          {r.hours_delta}h difference
                        </span>
                      )}
                    </td>
                    <td className="ff-mono" style={{ textAlign: "right", fontWeight: 700, color: Number(r.total_fee) > 0 ? "#b45309" : "var(--ff-muted)" }}>
                      {Number(r.total_fee) > 0 ? rupee(r.total_fee) : "—"}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10,
                        background: s.bg, color: s.color,
                      }}>
                        {s.label}
                      </span>
                      {r.resolved_by_name && (
                        <div style={{ fontSize: 10, color: "var(--ff-muted)", marginTop: 2 }}>by {r.resolved_by_name}</div>
                      )}
                    </td>
                    <td>
                      {r.status === "pending" ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            className="ff-btn ff-btn-primary"
                            style={{ padding: "3px 10px", fontSize: 11 }}
                            disabled={!!busy}
                            onClick={() => updateStatus(r.id, "approved")}
                          >
                            {busy === "approved" ? "…" : <><Check size={11} /> Approve</>}
                          </button>
                          <button
                            className="ff-btn ff-btn-outline"
                            style={{ padding: "3px 10px", fontSize: 11, color: "var(--ff-danger)", borderColor: "var(--ff-danger)" }}
                            disabled={!!busy}
                            onClick={() => updateStatus(r.id, "denied")}
                          >
                            {busy === "denied" ? "…" : "Deny"}
                          </button>
                          <button
                            className="ff-btn ff-btn-outline"
                            style={{ padding: "3px 10px", fontSize: 11 }}
                            disabled={!!busy}
                            onClick={() => updateStatus(r.id, "waived")}
                          >
                            {busy === "waived" ? "…" : "Waive Fee"}
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--ff-muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </div>
      )}

      {/* New Request Modal */}
      {addModal && (
        <Modal title="Add Special Request" onClose={() => { setAddModal(false); setRefMatches([]); }}>
          <form onSubmit={submitAdd} className="ff-fields">
            <Field label="Booking Reference *">
              <input
                value={addForm.booking_ref}
                onChange={e => searchBookingRef(e.target.value)}
                placeholder="Type AZ-2024-… or guest name"
                autoFocus
              />
              {refMatches.length > 0 && (
                <div style={{ border: "1px solid var(--ff-border)", borderRadius: 6, marginTop: 4, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
                  {refMatches.map(b => (
                    <button
                      key={b.id}
                      type="button"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--ff-border)" }}
                      onClick={() => { updAdd("booking_ref", b.reference); updAdd("booking_id", b.id); setRefMatches([]); }}
                    >
                      <b>{b.reference}</b> — {b.guest} · {b.room} · {fmtDate(b.check_in)}
                    </button>
                  ))}
                </div>
              )}
              {addForm.booking_id && (
                <p style={{ fontSize: 11, color: "var(--ff-success)", marginTop: 4 }}>✓ Booking selected</p>
              )}
            </Field>

            <Grid2>
              <Field label="Request Type *">
                <select value={addForm.request_type} onChange={e => { updAdd("request_type", e.target.value); updAdd("requested_time", e.target.value === "early_checkin" ? "09:00" : "11:00"); }}>
                  <option value="early_checkin">Early Check-In</option>
                  <option value="late_checkout">Late Check-Out</option>
                </select>
              </Field>
              <Field label={`Requested Time * (standard: ${addForm.request_type === "early_checkin" ? "11:00 AM" : "10:00 AM"})`}>
                <input
                  type="time"
                  value={addForm.requested_time}
                  onChange={e => updAdd("requested_time", e.target.value)}
                  required
                />
              </Field>
            </Grid2>

            {/* Live fee preview */}
            {hoursDelta > 0 && (
              <div style={{ background: "#fef3c7", border: "1px solid #d97706", borderRadius: 6, padding: "10px 14px", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#92400e" }}>Difference: <b>{hoursDelta}h</b></span>
                  <span style={{ color: "#92400e", fontWeight: 700 }}>Fee: <b>{rupee(totalFee)}</b></span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "#b45309" }}>
                  ₹{FEE_PER_HOUR}/hr × {hoursDelta}h — will be added to balance if approved
                </p>
              </div>
            )}
            {hoursDelta === 0 && addForm.requested_time && (
              <div style={{ background: "#f0fdf4", border: "1px solid #16a34a", borderRadius: 6, padding: "8px 14px", fontSize: 12, color: "#14532d" }}>
                Requested time matches standard time — no fee applicable.
              </div>
            )}

            <Field label="Notes (optional)">
              <textarea value={addForm.notes} onChange={e => updAdd("notes", e.target.value)} rows={2} placeholder="Guest preference or special instruction…" />
            </Field>

            <button type="submit" className="ff-btn ff-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 4 }} disabled={addBusy}>
              {addBusy ? "Creating…" : "Create Request"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
