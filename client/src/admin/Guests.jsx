import { useState } from "react";
import { Search, UserCheck, Phone, Calendar, TrendingUp, ShieldCheck, Edit2, X, Save, Users, Trash2, BookOpen } from "lucide-react";
import { useApi, rupee, fmtDate, adminGuests, adminUpdateGuest, adminDeleteGuest, adminGuestBookings, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, StatCard, Modal, Field, Grid2 } from "./ui.jsx";
import FfSubmitButton from "../components/FfSubmitButton.jsx";

const KYC_LABELS = {
  aadhaar:  "Aadhaar",
  pan:      "PAN",
  passport: "Passport",
  voter_id: "Voter ID",
  dl:       "Driving Licence",
};

const KYC_CONFIG = {
  aadhaar:  { maxLength: 12, pattern: /^[0-9]{12}$/ },
  pan:      { maxLength: 10, pattern: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/ },
  passport: { maxLength: 8,  pattern: /^[A-Z][0-9]{7}$/ },
  voter_id: { maxLength: 10, pattern: /^[A-Z]{3}[0-9]{7}$/ },
  dl:       { maxLength: 16, pattern: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,12}$/ },
};

const STATUS_BADGE = {
  confirmed:   { bg: "#dbeafe", color: "#1d4ed8" },
  checked_in:  { bg: "#d1fae5", color: "#065f46" },
  checked_out: { bg: "#f3f4f6", color: "#374151" },
  cancelled:   { bg: "#fee2e2", color: "#b91c1c" },
  pending:     { bg: "#fef3c7", color: "#92400e" },
};

function StatusBadge({ status }) {
  const s = STATUS_BADGE[status] || { bg: "#f3f4f6", color: "#374151" };
  return (
    <span style={{ background: s.bg, color: s.color, padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>
      {(status || "").replace("_", " ")}
    </span>
  );
}

function EditGuestModal({ guest, onClose, onSaved }) {
  const [f, setF] = useState({
    full_name:  guest.full_name  || "",
    phone:      guest.phone      || "",
    email:      guest.email      || "",
    addr1:      guest.addr1      || "",
    addr2:      guest.addr2      || "",
    state:      guest.state      || "",
    pincode:    guest.pincode    || "",
    kyc_type:   guest.kyc_type   || "",
    kyc_number: guest.kyc_number || "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  const kycCfg  = f.kyc_type ? KYC_CONFIG[f.kyc_type] : null;
  const kycValid = !f.kyc_type || !f.kyc_number || (kycCfg && kycCfg.pattern.test(f.kyc_number));

  const save = async () => {
    if (!f.full_name.trim()) return setErr("Name is required.");
    if (f.kyc_type && !f.kyc_number) return setErr("Enter the KYC number or clear the ID type.");
    if (!kycValid) return setErr("KYC number format is invalid.");
    setBusy(true); setErr("");
    try {
      await adminUpdateGuest(guest.id, f);
      notify("Guest updated", "success");
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Edit Guest" onClose={onClose} maxWidth={560}>
      <div className="ff-fields">
        <div className="ff-field" style={{ gridColumn: "1/-1" }}>
          <label>Full name *</label>
          <input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} />
        </div>

        <Grid2>
          <Field label="Phone">
            <input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
          </Field>
        </Grid2>

        <Field label="Address line 1">
          <input value={f.addr1} onChange={e => setF({ ...f, addr1: e.target.value })} />
        </Field>
        <Field label="Address line 2">
          <input value={f.addr2} onChange={e => setF({ ...f, addr2: e.target.value })} />
        </Field>

        <Grid2>
          <Field label="State">
            <input value={f.state} onChange={e => setF({ ...f, state: e.target.value })} />
          </Field>
          <Field label="Pincode">
            <input value={f.pincode} onChange={e => setF({ ...f, pincode: e.target.value })} />
          </Field>
        </Grid2>
      </div>

      <p className="ff-eyebrow" style={{ margin: "20px 0 12px" }}>KYC Verification</p>
      <Grid2>
        <Field label="ID type">
          <select value={f.kyc_type} onChange={e => setF({ ...f, kyc_type: e.target.value, kyc_number: "" })}>
            <option value="">— None —</option>
            {Object.entries(KYC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label={`ID number${kycCfg ? ` (${kycCfg.maxLength} chars)` : ""}`}>
          <input
            value={f.kyc_number}
            disabled={!f.kyc_type}
            placeholder={f.kyc_type ? `Enter ${KYC_LABELS[f.kyc_type]} number` : "Select ID type first"}
            style={{ borderColor: !kycValid ? "var(--ff-warning)" : undefined }}
            onChange={e => {
              let v = e.target.value.toUpperCase().replace(/\s/g, "");
              if (kycCfg && v.length > kycCfg.maxLength) v = v.slice(0, kycCfg.maxLength);
              setF({ ...f, kyc_number: v });
            }}
          />
        </Field>
      </Grid2>

      {err && <p className="ff-field-err" style={{ marginTop: 10 }}>{err}</p>}

      <div className="ff-form-actions" style={{ marginTop: 20 }}>
        <button className="ff-btn ff-btn-outline" onClick={onClose}>Cancel</button>
        <FfSubmitButton className="ff-btn-primary" onClick={save} spinnerLabel="Saving…">
          <Save size={14} /> Save changes
        </FfSubmitButton>
      </div>
    </Modal>
  );
}

function GuestDetailModal({ guest, onClose, onEdit }) {
  const { data: bookings, loading, error } = useApi(() => adminGuestBookings(guest.id), [guest.id]);

  return (
    <Modal title="Guest Profile" onClose={onClose} maxWidth={700}>
      {/* Guest info header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid var(--ff-border)" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "linear-gradient(135deg,#1a56db,#3b82f6)",
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 22, flexShrink: 0,
        }}>
          {(guest.full_name || "?")[0].toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{guest.full_name}</div>
          <div style={{ fontSize: 13, color: "var(--ff-muted)", marginTop: 2 }}>
            {[guest.phone, guest.email].filter(Boolean).join(" · ") || "No contact info"}
          </div>
          {guest.kyc_number && (
            <div style={{ marginTop: 4, fontSize: 12 }}>
              <span className="ff-badge ff-badge-green" style={{ marginRight: 6 }}>{KYC_LABELS[guest.kyc_type] || guest.kyc_type}</span>
              <span style={{ fontFamily: "monospace", letterSpacing: ".05em" }}>{guest.kyc_number}</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{rupee(guest.lifetime_value)}</div>
          <div style={{ fontSize: 12, color: "var(--ff-muted)" }}>lifetime value</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{guest.stays} stay{guest.stays !== 1 ? "s" : ""}</div>
        </div>
      </div>

      {/* Booking history */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <BookOpen size={15} style={{ color: "var(--ff-muted)" }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>Booking History</span>
      </div>

      {loading && <Spinner />}
      {error && <ApiError msg={error} />}

      {!loading && !error && (
        bookings?.length === 0 ? (
          <p style={{ color: "var(--ff-muted)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No bookings found</p>
        ) : (
          <div className="ff-table-wrap ff-sticky-head" style={{ maxHeight: 320, overflowY: "auto" }}>
            <table className="ff-table" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Room</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Guests</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings?.map(b => (
                  <tr key={b.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>{b.reference}</td>
                    <td style={{ fontSize: 13 }}>
                      <div>{b.room_type || "—"}</div>
                      {b.room_number && <div style={{ fontSize: 11, color: "var(--ff-muted)" }}>Room {b.room_number}</div>}
                    </td>
                    <td style={{ fontSize: 13 }}>{fmtDate(b.check_in)}</td>
                    <td style={{ fontSize: 13 }}>{fmtDate(b.check_out)}</td>
                    <td style={{ fontSize: 13 }}>{b.num_guests}</td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{rupee(b.total_amount)}</td>
                    <td><StatusBadge status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <div className="ff-form-actions" style={{ marginTop: 20 }}>
        <button className="ff-btn ff-btn-outline" onClick={onClose}>Close</button>
        <button className="ff-btn ff-btn-primary" onClick={() => { onClose(); onEdit(); }}>
          <Edit2 size={14} /> Edit Guest
        </button>
      </div>
    </Modal>
  );
}

export default function Guests() {
  const { data, loading, error, reload } = useApi(adminGuests);
  const [search, setSearch]       = useState("");
  const [editGuest, setEditGuest] = useState(null);
  const [viewGuest, setViewGuest] = useState(null);

  const guests = (data || []).filter(g => {
    const q = search.toLowerCase();
    return !q ||
      g.full_name?.toLowerCase().includes(q) ||
      g.phone?.toLowerCase().includes(q) ||
      g.email?.toLowerCase().includes(q) ||
      g.kyc_number?.toLowerCase().includes(q);
  });

  const returningCount = (data || []).filter(g => g.stays > 1).length;
  const kycCount       = (data || []).filter(g => g.kyc_number).length;
  const totalRevenue   = (data || []).reduce((s, g) => s + Number(g.lifetime_value || 0), 0);

  const handleDelete = async (g, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete guest "${g.full_name}"? This cannot be undone.`)) return;
    try {
      await adminDeleteGuest(g.id);
      notify("Guest deleted", "success");
      reload();
    } catch (err) {
      notify(err.message, "error");
    }
  };

  return (
    <div className="ff-page">
      <SectionHeader eyebrow="Analytics" title="Guests" />

      {/* KPI cards */}
      <div className="ff-stats-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <StatCard label="Total guests"    value={(data || []).length} icon={Users} iconBg="ff-icon-bg-primary" />
        <StatCard label="Returning guests" value={returningCount}      icon={UserCheck} iconBg="ff-icon-bg-primary" />
        <StatCard label="KYC verified"    value={kycCount}            icon={ShieldCheck} iconBg="ff-icon-bg-primary" />
        <StatCard label="Total revenue"   value={rupee(totalRevenue)} icon={TrendingUp} iconBg="ff-icon-bg-primary" />
      </div>

      {/* Search bar */}
      <div className="ff-card" style={{ padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <Search size={16} style={{ color: "var(--ff-muted)", flexShrink: 0 }} />
        <input
          style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 14, color: "var(--ff-text)" }}
          placeholder="Search by name, phone, email or KYC number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ff-muted)", display: "flex" }} onClick={() => setSearch("")}>
            <X size={14} />
          </button>
        )}
      </div>

      {loading && <Spinner />}
      {error   && <ApiError msg={error} />}

      {!loading && !error && (
        <div className="ff-card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ff-table-wrap ff-sticky-head">
            <table className="ff-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Guest</th>
                  <th><Phone size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />Contact</th>
                  <th><ShieldCheck size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />KYC</th>
                  <th><Calendar size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />Stays</th>
                  <th>Last Stay</th>
                  <th><TrendingUp size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />Lifetime Value</th>
                  <th>Since</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {guests.length === 0 && (
                  <tr>
                    <td colSpan={8} className="ff-empty">No guests found</td>
                  </tr>
                )}
                {guests.map(g => (
                  <tr key={g.id} style={{ cursor: "pointer" }} onClick={() => setViewGuest(g)}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: "50%",
                          background: "linear-gradient(135deg,#1a56db,#3b82f6)",
                          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 700, fontSize: 14, flexShrink: 0,
                        }}>
                          {(g.full_name || "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{g.full_name}</div>
                          {g.stays > 1 && (
                            <span style={{ fontSize: 11, color: "var(--ff-primary)", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                              <UserCheck size={11} /> Returning
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13 }}>{g.phone || <span style={{ color: "var(--ff-muted)" }}>—</span>}</div>
                      <div style={{ fontSize: 12, color: "var(--ff-muted)" }}>{g.email || ""}</div>
                    </td>
                    <td>
                      {g.kyc_number ? (
                        <div>
                          <span className="ff-badge ff-badge-green">
                            {KYC_LABELS[g.kyc_type] || g.kyc_type}
                          </span>
                          <div style={{ fontSize: 12, fontFamily: "monospace", letterSpacing: ".05em", marginTop: 2 }}>{g.kyc_number}</div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--ff-muted)" }}>Not recorded</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 600, fontSize: 15 }}>{g.stays}</td>
                    <td style={{ fontSize: 13 }}>
                      {g.last_stay ? fmtDate(g.last_stay) : <span style={{ color: "var(--ff-muted)" }}>—</span>}
                    </td>
                    <td style={{ fontWeight: 600 }}>{rupee(g.lifetime_value)}</td>
                    <td style={{ fontSize: 12, color: "var(--ff-muted)" }}>{fmtDate(g.created_at)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="ff-icon-btn" title="Edit guest" onClick={() => setEditGuest(g)}>
                          <Edit2 size={14} />
                        </button>
                        <button className="ff-icon-btn" title="Delete guest" style={{ color: "var(--ff-danger, #dc2626)" }} onClick={e => handleDelete(g, e)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {guests.length > 0 && (
            <div style={{ padding: "10px 16px", borderTop: "1px solid var(--ff-border)", fontSize: 12, color: "var(--ff-muted)" }}>
              Showing {guests.length} of {(data || []).length} guests
            </div>
          )}
        </div>
      )}

      {viewGuest && (
        <GuestDetailModal
          guest={viewGuest}
          onClose={() => setViewGuest(null)}
          onEdit={() => setEditGuest(viewGuest)}
        />
      )}

      {editGuest && (
        <EditGuestModal
          guest={editGuest}
          onClose={() => setEditGuest(null)}
          onSaved={() => { setEditGuest(null); reload(); }}
        />
      )}
    </div>
  );
}
