import { useState, useEffect } from "react";
import { Pencil, Trash2, X, IndianRupee, AlertTriangle, LogOut, RotateCcw, CalendarPlus, FileText, Search } from "lucide-react";
import {
  useApi, adminBookings, adminGetBooking, adminUpdateBooking, adminUpdateGuest,
  deleteBooking, getUser, rupee, fmtDate, notify, apiFetch,
} from "./adminContext.js";
import { adminConflictLog, earlyCheckout, markRefundProcessed, earlyCheckoutPreview, extendAvailability, extendStay } from "../api/client.js";
import { Spinner, ApiError, SectionHeader, TableWrap, StatusBadge, Modal, SideDrawer, Field, Grid2 } from "./ui.jsx";

const BOOKING_STATUS_MAP = {
  confirmed:   "ff-badge-blue",
  checked_in:  "ff-badge-green",
  checked_out: "ff-badge-muted",
  cancelled:   "ff-badge-red",
};

const PAYMENT_METHOD_MAP = {
  cash: "ff-badge-muted",
  card: "ff-badge-blue",
  upi:  "ff-badge-green",
};

function SourceBadge({ source }) {
  if (!source || source === "direct") {
    return <span className="ff-badge ff-badge-green" style={{ fontSize: 10, whiteSpace: "nowrap" }}>Direct</span>;
  }
  if (source === "walk_in") {
    return <span className="ff-badge ff-badge-green" style={{ fontSize: 10, whiteSpace: "nowrap" }}>Walk-in</span>;
  }
  const label = source.charAt(0).toUpperCase() + source.slice(1).replace(/_/g, " ");
  return <span className="ff-badge ff-badge-blue" style={{ fontSize: 10, whiteSpace: "nowrap" }}>{label}</span>;
}

const BLANK_EDIT = {
  check_in: "", check_out: "", status: "", additional_payment: "0", tax_percentage: "12",
  payment_method: "cash",
  full_name: "", phone: "", email: "",
  addr1: "", addr2: "", state: "", pincode: "",
  kyc_type: "aadhaar", kyc_number: "",
};

const REFUND_STATUS_BADGE = {
  pending:   { cls: "ff-badge-yellow", label: "Refund Pending" },
  processed: { cls: "ff-badge-green",  label: "Refunded"       },
  waived:    { cls: "ff-badge-muted",  label: "Waived"         },
};

const BLANK_EARLY_CHECKOUT = { actual_checkout: "", refund_method: "cash", waive_refund: false, refund_amount: "", notes: "" };

const KYC_CONFIG = {
  aadhaar:  { label: "Aadhaar Card",    maxLength: 12, pattern: "^[0-9]{12}$",                hint: "12-digit number",                   inputMode: "numeric" },
  pan:      { label: "PAN Card",        maxLength: 10, pattern: "^[A-Z]{5}[0-9]{4}[A-Z]{1}$", hint: "10 chars — AAAAA9999A",             inputMode: "text"    },
  passport: { label: "Passport",        maxLength: 8,  pattern: "^[A-Z][0-9]{7}$",             hint: "8 chars — A1234567",                inputMode: "text"    },
  voter_id: { label: "Voter ID",        maxLength: 10, pattern: "^[A-Z]{3}[0-9]{7}$",          hint: "10 chars — ABC1234567",             inputMode: "text"    },
  dl:       { label: "Driving Licence", maxLength: 16, pattern: "^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,12}$", hint: "State code + RTO + number",   inputMode: "text"    },
};

export default function Bookings({ isStaff = false }) {
  const list        = useApi(() => adminBookings(""));
  const conflictLog = useApi(adminConflictLog);
  const currentUser = getUser();
  const isOwner = currentUser?.role === "owner";

  const [editModal, setEditModal] = useState(null); // null | booking detail object
  const [form, setForm]           = useState(BLANK_EDIT);
  const [busy, setBusy]           = useState(false);
  const [confirmDel, setConfirmDel]           = useState(null); // booking id to confirm
  const [markingPaid, setMarkingPaid]         = useState({}); // { [id]: true }
  const [confirmBalance, setConfirmBalance]   = useState(null); // booking row
  // Early checkout
  const [earlyCheckoutModal, setEarlyCheckoutModal] = useState(null); // booking row
  const [earlyForm, setEarlyForm]                   = useState(BLANK_EARLY_CHECKOUT);
  const [earlyBusy, setEarlyBusy]                   = useState(false);
  const [earlyPreview, setEarlyPreview]             = useState(null);
  const [earlyPreviewLoading, setEarlyPreviewLoading] = useState(false);
  // Extend stay
  const [extendModal, setExtendModal]           = useState(null);
  const [extendNewCheckout, setExtendNewCheckout] = useState('');
  const [extendAvail, setExtendAvail]           = useState(null);
  const [extendAvailLoading, setExtendAvailLoading] = useState(false);
  const [extendSelectedAlt, setExtendSelectedAlt] = useState(null);
  const [extendPayment, setExtendPayment]       = useState('0');
  const [extendPayMethod, setExtendPayMethod]   = useState('cash');
  const [extendBusy, setExtendBusy]             = useState(false);
  // Refund processed
  const [refundProcessModal, setRefundProcessModal] = useState(null); // booking row
  const [refundProcessBusy, setRefundProcessBusy]   = useState(false);
  const [refundProcessForm, setRefundProcessForm]   = useState({ refund_amount: "", refund_method: "cash" });
  // Search / filter
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [otaOnly, setOtaOnly]           = useState(false);
  // Delete all
  const [confirmDelAll, setConfirmDelAll] = useState(false);
  const [deletingAll, setDeletingAll]     = useState(false);

  const upd = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Auto-fetch early checkout preview when date changes
  useEffect(() => {
    if (!earlyCheckoutModal || !earlyForm.actual_checkout) { setEarlyPreview(null); return; }
    const t = setTimeout(async () => {
      setEarlyPreviewLoading(true);
      try {
        const p = await earlyCheckoutPreview(earlyCheckoutModal.id, earlyForm.actual_checkout);
        setEarlyPreview(p);
        setEarlyForm(prev => ({ ...prev, refund_amount: String(p.refund_amount || 0) }));
      } catch { setEarlyPreview(null); }
      finally { setEarlyPreviewLoading(false); }
    }, 400);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earlyForm.actual_checkout, earlyCheckoutModal?.id]);

  // Auto-fetch extend availability when new checkout date changes
  useEffect(() => {
    if (!extendModal || !extendNewCheckout) { setExtendAvail(null); return; }
    const t = setTimeout(async () => {
      setExtendAvailLoading(true);
      try {
        const a = await extendAvailability(extendModal.id, extendNewCheckout);
        setExtendAvail(a);
      } catch (err) { setExtendAvail(null); notify(err.message, 'error'); }
      finally { setExtendAvailLoading(false); }
    }, 400);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extendNewCheckout, extendModal?.id]);

  const openExtend = (b) => {
    setExtendModal(b);
    const minDate = new Date(b.check_out); minDate.setDate(minDate.getDate() + 1);
    setExtendNewCheckout(minDate.toISOString().slice(0, 10));
    setExtendAvail(null);
    setExtendSelectedAlt(null);
    setExtendPayment('0');
    setExtendPayMethod('cash');
  };

  const submitExtend = async () => {
    if (!extendModal || !extendAvail) return;
    const canCommit = extendSelectedAlt ? extendSelectedAlt.fully_available : extendAvail.same_type.available_all;
    if (!canCommit) return;
    setExtendBusy(true);
    try {
      const payload = {
        new_checkout:        extendNewCheckout,
        additional_payment:  Number(extendPayment || 0),
        payment_method:      extendPayMethod,
      };
      if (extendSelectedAlt) payload.room_type_id = extendSelectedAlt.room_type_id;
      const result = await extendStay(extendModal.id, payload);
      notify(`Stay extended to ${new Date(extendNewCheckout).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} — ${rupee(result.extension_amount)} additional charge`, 'success');
      setExtendModal(null);
      list.reload();
    } catch (err) { notify(err.message, 'error'); }
    finally { setExtendBusy(false); }
  };

  const openEdit = async (id) => {
    setBusy(true);
    try {
      const b = await adminGetBooking(id);
      setEditModal(b);
      setForm({
        check_in:           b.check_in?.slice(0, 10)  || "",
        check_out:          b.check_out?.slice(0, 10) || "",
        status:             b.status || "",
        additional_payment: "0",
        tax_percentage:     b.tax_amount && b.base_amount
          ? String(Math.round((Number(b.tax_amount) / Number(b.base_amount)) * 100))
          : "12",
        payment_method:     b.payment_method || "cash",
        full_name: b.guest  || "",
        phone:     b.phone  || "",
        email:     b.email  || "",
        addr1:     b.addr1  || "",
        addr2:     b.addr2  || "",
        state:     b.state  || "",
        pincode:   b.pincode || "",
        kyc_type:   b.kyc_type   || "aadhaar",
        kyc_number: b.kyc_number || "",
      });
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editModal) return;
    const kycCfg = KYC_CONFIG[form.kyc_type];
    if (form.kyc_number && !new RegExp(kycCfg.pattern).test(form.kyc_number)) {
      notify(`Invalid ${kycCfg.label} number. Expected format: ${kycCfg.hint}`, "error");
      return;
    }
    if (!form.kyc_number) {
      notify("KYC ID number is required", "error");
      return;
    }
    setBusy(true);
    try {
      const wasCheckedOut = editModal.status !== "checked_out" && form.status === "checked_out";
      const [updResult] = await Promise.all([
        adminUpdateBooking(editModal.id, {
          check_in:           form.check_in,
          check_out:          form.check_out,
          status:             form.status,
          additional_payment: Number(form.additional_payment || 0),
          tax_percentage:     Number(form.tax_percentage || 0),
          payment_method:     form.payment_method,
        }),
        adminUpdateGuest(editModal.guest_id, {
          full_name:  form.full_name,
          phone:      form.phone,
          email:      form.email,
          addr1:      form.addr1,
          addr2:      form.addr2,
          state:      form.state,
          pincode:    form.pincode,
          kyc_type:   form.kyc_type,
          kyc_number: form.kyc_number.toUpperCase(),
        }),
      ]);
      if (wasCheckedOut) {
        // Trigger the status PATCH to fire the housekeeping dispatch
        try {
          const statusRes = await apiFetch(`/api/admin/bookings/${editModal.id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: "checked_out" }),
          });
          const empName = statusRes?.dispatched_employee;
          notify(
            empName
              ? `Housekeeping task auto-dispatched to ${empName} via WhatsApp.`
              : "Checkout complete — housekeeping task dispatched.",
            "success"
          );
        } catch { /* dispatch non-blocking */ }
      }
      notify("Booking updated", "success");
      setEditModal(null);
      list.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteBooking(confirmDel);
      notify("Booking deleted", "success");
      setConfirmDel(null);
      list.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const markBalancePaid = async () => {
    if (!confirmBalance) return;
    setMarkingPaid(p => ({ ...p, [confirmBalance.id]: true }));
    try {
      await apiFetch(`/api/admin/bookings/${confirmBalance.id}/mark-balance-paid`, { method: "PATCH" });
      notify("Balance payment recorded", "success");
      setConfirmBalance(null);
      list.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setMarkingPaid(p => ({ ...p, [confirmBalance.id]: false })); }
  };

  const openEarlyCheckout = (b) => {
    setEarlyPreview(null);
    setEarlyCheckoutModal(b);
    const minDate = new Date(b.check_in); minDate.setDate(minDate.getDate() + 1);
    setEarlyForm({
      ...BLANK_EARLY_CHECKOUT,
      actual_checkout: minDate.toISOString().slice(0, 10),
    });
  };

  const submitEarlyCheckout = async (e) => {
    e.preventDefault();
    if (!earlyCheckoutModal) return;
    setEarlyBusy(true);
    try {
      const result = await earlyCheckout(earlyCheckoutModal.id, {
        actual_checkout: earlyForm.actual_checkout,
        refund_method:   earlyForm.refund_method,
        waive_refund:    earlyForm.waive_refund,
        refund_amount:   earlyForm.waive_refund ? 0 : Number(earlyForm.refund_amount) || 0,
        notes:           earlyForm.notes || null,
      });
      notify(
        earlyForm.waive_refund
          ? "Early checkout recorded (refund waived)"
          : `Early checkout done — refund of ${rupee(result.refund_amount)} is pending`,
        "success"
      );
      setEarlyCheckoutModal(null);
      list.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setEarlyBusy(false); }
  };


  const submitRefundProcessed = async () => {
    if (!refundProcessModal) return;
    setRefundProcessBusy(true);
    try {
      const amt = Number(refundProcessForm.refund_amount) || 0;
      await markRefundProcessed(refundProcessModal.id, {
        refund_amount: amt,
        refund_method: refundProcessForm.refund_method,
      });
      notify(`Refund of ${rupee(amt)} marked as processed`, "success");
      setRefundProcessModal(null);
      list.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setRefundProcessBusy(false); }
  };

  const deleteAllBookings = async () => {
    setDeletingAll(true);
    try {
      await apiFetch("/api/admin/bookings", { method: "DELETE" });
      notify("All bookings deleted", "success");
      setConfirmDelAll(false);
      list.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setDeletingAll(false); }
  };

  if (list.loading) return <Spinner />;
  if (list.error)   return <ApiError msg={list.error} />;

  const allBookings = list.data || [];
  const q = search.trim().toLowerCase();
  const bookings = allBookings.filter(b => {
    if (statusFilter && b.status !== statusFilter) return false;
    if (otaOnly && (b.source === "direct" || b.source === "walk_in" || !b.source)) return false;
    if (!q) return true;
    return (
      b.reference?.toLowerCase().includes(q) ||
      b.guest?.toLowerCase().includes(q) ||
      b.phone?.toLowerCase().includes(q) ||
      b.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Reservations"
        title="All Bookings"
        action={isOwner && !isStaff && (
          <button
            className="ff-btn ff-btn-danger"
            disabled={allBookings.length === 0}
            onClick={() => setConfirmDelAll(true)}
          >
            <Trash2 size={14} /> Delete All Bookings
          </button>
        )}
      />

      {/* Search & status filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 340 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ff-muted)", pointerEvents: "none" }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search guest, phone, reference…"
            style={{ width: "100%", paddingLeft: 32, boxSizing: "border-box" }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["", "All"], ["confirmed", "Confirmed"], ["checked_in", "Checked In"], ["checked_out", "Checked Out"], ["cancelled", "Cancelled"]].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              className={`ff-btn ${statusFilter === val ? "ff-btn-primary" : "ff-btn-ghost"}`}
              style={{ fontSize: 12, padding: "4px 12px" }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setOtaOnly(p => !p)}
            className={`ff-btn ${otaOnly ? "ff-btn-primary" : "ff-btn-ghost"}`}
            style={{ fontSize: 12, padding: "4px 12px" }}
          >
            OTA Only
          </button>
        </div>
      </div>

      <div className="ff-card" style={{ padding: 0 }}>
        <TableWrap>
          <thead>
            <tr>
              <th>Ref</th><th>Guest</th><th>Room</th>
              <th>Source</th>
              <th>Check In</th><th>Check Out</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th style={{ textAlign: "right" }}>Advance</th>
              <th style={{ textAlign: "right" }}>Remaining</th>
              <th>Payment</th>
              <th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {bookings.length === 0 ? (
              <tr><td colSpan={12} className="ff-empty" style={{ textAlign: "center" }}>
                {q || statusFilter ? "No bookings match your search." : "No bookings yet."}
              </td></tr>
            ) : bookings.map(b => (
              <tr key={b.id}>
                <td className="ff-mono">{b.reference}</td>
                <td>{b.guest}</td>
                <td>{b.room}{b.room_number ? ` (#${b.room_number})` : ""}</td>
                <td><SourceBadge source={b.source} /></td>
                <td>{fmtDate(b.check_in)}</td>
                <td>{fmtDate(b.check_out)}</td>
                <td className="ff-mono" style={{ textAlign: "right" }}>{rupee(b.total_amount)}</td>
                <td className="ff-mono" style={{ textAlign: "right", color: "#22c55e", fontWeight: 600 }}>{rupee(b.advance_paid)}</td>
                <td className="ff-mono" style={{ textAlign: "right", color: Number(b.pending_amount) > 0 ? "#f59e0b" : "var(--ff-muted)", fontWeight: 600 }}>{rupee(b.pending_amount)}</td>
                <td><StatusBadge value={b.payment_method || "cash"} map={PAYMENT_METHOD_MAP} /></td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <StatusBadge value={b.status} map={BOOKING_STATUS_MAP} />
                    {b.refund_status && b.refund_status !== "none" && REFUND_STATUS_BADGE[b.refund_status] && (
                      <span className={`ff-badge ${REFUND_STATUS_BADGE[b.refund_status].cls}`} style={{ fontSize: 10 }}>
                        {REFUND_STATUS_BADGE[b.refund_status].label}
                        {b.refund_amount > 0 ? ` ${rupee(b.refund_amount)}` : ""}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="ff-icon-btn" title="Edit" onClick={() => openEdit(b.id)}>
                        <Pencil size={14} />
                      </button>
                      {isOwner && !isStaff && (
                        <button className="ff-icon-btn" title="Delete" style={{ color: "var(--ff-danger)" }} onClick={() => setConfirmDel(b.id)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    {Number(b.pending_amount) > 0 && b.status !== "checked_out" && (
                      <button
                        onClick={() => setConfirmBalance(b)}
                        disabled={markingPaid[b.id]}
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          background: "transparent",
                          border: "1.5px solid #f59e0b",
                          color: "#f59e0b",
                          borderRadius: 20,
                          padding: "3px 10px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          letterSpacing: ".02em",
                          transition: "background .15s, color .15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#f59e0b"; e.currentTarget.style.color = "#fff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#f59e0b"; }}
                        title={`Collect remaining balance of ${rupee(b.pending_amount)}`}
                      >
                        <IndianRupee size={11} />
                        {markingPaid[b.id] ? "Recording…" : "Collect Balance"}
                      </button>
                    )}
                    {b.status === "checked_out" && isOwner && (
                      <a
                        href={`/api/admin/bookings/${b.id}/dispute-package`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          background: "transparent", border: "1.5px solid #6366f1",
                          color: "#6366f1", borderRadius: 20, padding: "3px 10px",
                          fontSize: 11, fontWeight: 700, cursor: "pointer",
                          whiteSpace: "nowrap", textDecoration: "none",
                        }}
                        title="Download chargeback evidence PDF"
                      >
                        <FileText size={11} /> Dispute Package
                      </a>
                    )}
                    {isOwner && b.refund_status === "pending" && (
                      <button
                        onClick={() => { setRefundProcessModal(b); setRefundProcessForm({ refund_amount: b.refund_amount || "", refund_method: b.refund_method || "cash" }); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          background: "transparent",
                          border: "1.5px solid #22c55e",
                          color: "#22c55e",
                          borderRadius: 20, padding: "3px 10px",
                          fontSize: 11, fontWeight: 700, cursor: "pointer",
                          whiteSpace: "nowrap", letterSpacing: ".02em",
                          transition: "background .15s, color .15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#22c55e"; e.currentTarget.style.color = "#fff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#22c55e"; }}
                        title={`Mark refund of ${rupee(b.refund_amount)} as processed`}
                      >
                        <RotateCcw size={11} /> Mark Refunded
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      {/* Edit Modal */}
      {editModal && (
        <SideDrawer
          title={`Edit Booking — ${editModal.reference}`}
          onClose={() => setEditModal(null)}
        >
          <form onSubmit={saveEdit} className="ff-fields">
            <p className="ff-eyebrow" style={{ marginBottom: 8 }}>Booking Details</p>
            <Grid2>
              <Field label="Check-in Date">
                <input type="date" value={form.check_in} onChange={e => upd("check_in", e.target.value)} required />
              </Field>
              <Field label="Check-out Date">
                <input type="date" value={form.check_out} min={form.check_in} onChange={e => upd("check_out", e.target.value)} required />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={e => upd("status", e.target.value)}>
                  <option value="confirmed">Confirmed</option>
                  <option value="checked_in">Checked In</option>
                  <option value="checked_out">Checked Out</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
              <Field label="Additional Payment (₹)">
                <input type="number" min="0" value={form.additional_payment} onChange={e => upd("additional_payment", e.target.value)} />
              </Field>
              <Field label="Payment Method">
                <select value={form.payment_method} onChange={e => upd("payment_method", e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                </select>
              </Field>
            </Grid2>

            <div className="ff-divider" />
            <p className="ff-eyebrow" style={{ marginBottom: 8 }}>Guest Details</p>
            <Grid2>
              <Field label="Full Name">
                <input value={form.full_name} onChange={e => upd("full_name", e.target.value)} required />
              </Field>
              <Field label="Phone">
                <input value={form.phone} onChange={e => upd("phone", e.target.value)} />
              </Field>
              <Field label="Email">
                <input type="email" value={form.email} onChange={e => upd("email", e.target.value)} />
              </Field>
            </Grid2>

            <div className="ff-divider" />
            <p className="ff-eyebrow" style={{ marginBottom: 8 }}>Address</p>
            <Field label="Address Line 1">
              <input value={form.addr1} onChange={e => upd("addr1", e.target.value)} placeholder="House / flat / building" />
            </Field>
            <Field label="Address Line 2">
              <input value={form.addr2} onChange={e => upd("addr2", e.target.value)} placeholder="Street / area / locality" />
            </Field>
            <Grid2>
              <Field label="State">
                <input value={form.state} onChange={e => upd("state", e.target.value)} placeholder="e.g. Kerala" />
              </Field>
              <Field label="Pincode">
                <input value={form.pincode} onChange={e => upd("pincode", e.target.value)} placeholder="6-digit PIN" maxLength={6} />
              </Field>
            </Grid2>

            <div className="ff-divider" />
            <p className="ff-eyebrow" style={{ marginBottom: 8 }}>KYC Verification</p>
            <Grid2>
              <Field label="ID Type">
                <select value={form.kyc_type} onChange={e => upd("kyc_type", e.target.value)}>
                  {Object.entries(KYC_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </Field>
              <Field label={`${KYC_CONFIG[form.kyc_type].label} Number`}>
                <input
                  value={form.kyc_number}
                  onChange={e => {
                    const raw = e.target.value.toUpperCase().replace(/\s/g, "");
                    if (raw.length <= KYC_CONFIG[form.kyc_type].maxLength) upd("kyc_number", raw);
                  }}
                  placeholder={KYC_CONFIG[form.kyc_type].hint}
                  maxLength={KYC_CONFIG[form.kyc_type].maxLength}
                  inputMode={KYC_CONFIG[form.kyc_type].inputMode}
                  pattern={KYC_CONFIG[form.kyc_type].pattern}
                  title={KYC_CONFIG[form.kyc_type].hint}
                />
              </Field>
            </Grid2>

            <button type="submit" className="ff-btn ff-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} disabled={busy}>
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </form>
        </SideDrawer>
      )}

      {/* Balance Payment Confirmation */}
      {confirmBalance && (
        <div className="ff-backdrop" onClick={() => setConfirmBalance(null)}>
          <div className="ff-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Collect Remaining Balance</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setConfirmBalance(null)}><X size={18} /></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ marginBottom: 12 }}>
                Booking <strong>{confirmBalance.reference}</strong> — <strong>{confirmBalance.guest}</strong>
              </p>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                <span style={{ color: "var(--ff-muted)" }}>Total Amount</span>
                <span style={{ fontWeight: 700 }}>{rupee(confirmBalance.total_amount)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                <span style={{ color: "var(--ff-muted)" }}>Advance Paid</span>
                <span style={{ color: "#22c55e", fontWeight: 600 }}>{rupee(confirmBalance.advance_paid)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, fontSize: 13 }}>
                <span style={{ color: "var(--ff-muted)" }}>Balance Due</span>
                <span style={{ color: "#f59e0b", fontWeight: 700 }}>{rupee(confirmBalance.pending_amount)}</span>
              </div>
              <p style={{ color: "var(--ff-muted)", fontSize: 13, marginBottom: 20 }}>
                Recording this balance payment will:
              </p>
              <ul style={{ color: "var(--ff-muted)", fontSize: 13, marginBottom: 20, paddingLeft: 18, lineHeight: 1.8 }}>
                <li>Mark the booking as <strong>fully paid</strong></li>
                <li>Add it to today's <strong>Daily Payment sheet</strong> for owner verification</li>
                <li>Allow the owner to send an <strong>invoice</strong> to the customer</li>
              </ul>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmBalance(null)}>Cancel</button>
                <button
                  className="ff-btn ff-btn-primary"
                  onClick={markBalancePaid}
                  disabled={markingPaid[confirmBalance?.id]}
                >
                  {markingPaid[confirmBalance?.id] ? "Recording…" : `Confirm Payment — ${rupee(confirmBalance.pending_amount)}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Early Checkout Modal */}
      {earlyCheckoutModal && (
        <div className="ff-backdrop" onClick={() => { setEarlyCheckoutModal(null); setEarlyPreview(null); }}>
          <div className="ff-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Early Checkout — {earlyCheckoutModal.reference}</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => { setEarlyCheckoutModal(null); setEarlyPreview(null); }}><X size={18} /></button>
            </div>
            <div className="ff-modal-body">
              <form onSubmit={submitEarlyCheckout} className="ff-fields">
                <p style={{ fontSize: 13, color: "var(--ff-muted)", marginBottom: 14 }}>
                  Original stay: <strong>{fmtDate(earlyCheckoutModal.check_in)}</strong> → <strong>{fmtDate(earlyCheckoutModal.check_out)}</strong>
                  {" "}({earlyCheckoutModal.nights ?? Math.round((new Date(earlyCheckoutModal.check_out) - new Date(earlyCheckoutModal.check_in)) / 86400000)} nights)
                </p>
                <Grid2>
                  <Field label="Actual Check-out Date">
                    <input
                      type="date"
                      value={earlyForm.actual_checkout}
                      min={(() => { const d = new Date(earlyCheckoutModal.check_in); d.setDate(d.getDate() + 1); return d.toISOString().slice(0,10); })()}
                      max={(() => { const d = new Date(earlyCheckoutModal.check_out); d.setDate(d.getDate() - 1); return d.toISOString().slice(0,10); })()}
                      onChange={e => { setEarlyForm(p => ({ ...p, actual_checkout: e.target.value })); setEarlyPreview(null); }}
                      required
                    />
                  </Field>
                  <Field label="Refund Method">
                    <select value={earlyForm.refund_method} onChange={e => setEarlyForm(p => ({ ...p, refund_method: e.target.value }))}>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="upi">UPI</option>
                    </select>
                  </Field>
                </Grid2>

                {/* Preview card */}
                {earlyPreviewLoading && (
                  <p style={{ fontSize: 12, color: "var(--ff-muted)", textAlign: "center", marginBottom: 8 }}>Calculating…</p>
                )}
                {earlyPreview && !earlyPreviewLoading && (
                  <div style={{ background: "#f9fafb", border: "1px solid var(--ff-border)", borderRadius: 8, padding: "12px 14px", marginBottom: 10, fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: "var(--ff-muted)" }}>Nights staying:</span>
                      <span>{earlyPreview.actual_nights} of {earlyPreview.actual_nights + earlyPreview.unused_nights}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: "var(--ff-muted)" }}>Charge for actual stay:</span>
                      <span>{rupee(earlyPreview.amount_for_actual)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: "var(--ff-muted)" }}>Advance paid:</span>
                      <span style={{ color: "#22c55e", fontWeight: 600 }}>{rupee(earlyPreview.advance_paid)}</span>
                    </div>
                    {earlyPreview.balance_due > 0 ? (
                      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, marginTop: 4, borderTop: "1px solid #fca5a5", fontWeight: 700, color: "#dc2626" }}>
                        <span>Balance due from guest:</span>
                        <span>{rupee(earlyPreview.balance_due)}</span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, marginTop: 4, borderTop: "1px solid #86efac", fontWeight: 700, color: "#16a34a" }}>
                        <span>Refund to guest:</span>
                        <span>{rupee(earlyPreview.refund_amount)}</span>
                      </div>
                    )}
                  </div>
                )}
                {earlyPreview?.balance_due > 0 && (
                  <div style={{ background: "#fef2f2", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#991b1b", marginBottom: 10 }}>
                    ⚠ Guest owes {rupee(earlyPreview.balance_due)} for nights already stayed. Use "Collect Balance" from the booking list to collect payment first.
                  </div>
                )}

                {earlyCheckoutModal.source !== "direct" && (
                  <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e", marginBottom: 10 }}>
                    ⚠ OTA booking ({earlyCheckoutModal.source}). Refund is typically handled by the channel — confirm policy before proceeding.
                  </div>
                )}
                {!(earlyPreview?.balance_due > 0) && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        id="waive-refund"
                        checked={earlyForm.waive_refund}
                        onChange={e => setEarlyForm(p => ({ ...p, waive_refund: e.target.checked }))}
                        style={{ width: 16, height: 16 }}
                      />
                      <label htmlFor="waive-refund" style={{ fontSize: 13, cursor: "pointer" }}>Waive refund (no money returned to guest)</label>
                    </div>
                    {!earlyForm.waive_refund && (
                      <Field label="Refund Amount (₹)">
                        <input
                          type="number"
                          min="0"
                          max={earlyPreview ? earlyPreview.refund_amount : earlyCheckoutModal.advance_paid}
                          step="0.01"
                          value={earlyForm.refund_amount}
                          onChange={e => setEarlyForm(p => ({ ...p, refund_amount: e.target.value }))}
                          placeholder={earlyPreview ? `Suggested: ${rupee(earlyPreview.refund_amount)}` : `Max ${rupee(earlyCheckoutModal.advance_paid)}`}
                          required
                        />
                      </Field>
                    )}
                  </>
                )}
                <Field label="Notes (optional)">
                  <input value={earlyForm.notes} onChange={e => setEarlyForm(p => ({ ...p, notes: e.target.value }))} placeholder="Reason or remarks" />
                </Field>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
                  <button type="button" className="ff-btn ff-btn-ghost" onClick={() => { setEarlyCheckoutModal(null); setEarlyPreview(null); }}>Cancel</button>
                  <button type="submit" className="ff-btn ff-btn-primary" disabled={earlyBusy || (earlyPreview?.balance_due > 0)}>
                    <LogOut size={14} />
                    {earlyBusy ? "Processing…" : "Confirm Early Checkout"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Mark Refund Processed */}
      {refundProcessModal && (
        <div className="ff-backdrop" onClick={() => setRefundProcessModal(null)}>
          <div className="ff-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Mark Refund as Processed</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setRefundProcessModal(null)}><X size={18} /></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ marginBottom: 16 }}>
                Booking <strong>{refundProcessModal.reference}</strong> — <strong>{refundProcessModal.guest}</strong>
              </p>
              <Field label="Refund Amount (₹)">
                <input
                  type="number"
                  min="0"
                  max={refundProcessModal.advance_paid}
                  step="0.01"
                  value={refundProcessForm.refund_amount}
                  onChange={e => setRefundProcessForm(p => ({ ...p, refund_amount: e.target.value }))}
                  placeholder={`Max ${rupee(refundProcessModal.advance_paid)}`}
                />
              </Field>
              <Field label="Refund Method">
                <select value={refundProcessForm.refund_method} onChange={e => setRefundProcessForm(p => ({ ...p, refund_method: e.target.value }))}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                </select>
              </Field>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setRefundProcessModal(null)}>Cancel</button>
                <button
                  className="ff-btn ff-btn-primary"
                  style={{ background: "#22c55e", borderColor: "#22c55e" }}
                  onClick={submitRefundProcessed}
                  disabled={refundProcessBusy}
                >
                  <RotateCcw size={14} />
                  {refundProcessBusy ? "Saving…" : "Confirm — Refund Issued"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Extend Stay Modal */}
      {extendModal && (
        <div className="ff-backdrop" onClick={() => setExtendModal(null)}>
          <div className="ff-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Extend Stay — {extendModal.reference}</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setExtendModal(null)}><X size={18} /></button>
            </div>
            <div className="ff-modal-body ff-fields">
              <p style={{ fontSize: 13, color: "var(--ff-muted)", marginBottom: 14 }}>
                Current stay: <strong>{fmtDate(extendModal.check_in)}</strong> → <strong>{fmtDate(extendModal.check_out)}</strong>
                {" "}({extendModal.nights ?? Math.round((new Date(extendModal.check_out) - new Date(extendModal.check_in)) / 86400000)} nights)
              </p>

              <Field label="New Check-out Date">
                <input
                  type="date"
                  value={extendNewCheckout}
                  min={(() => { const d = new Date(extendModal.check_out); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })()}
                  onChange={e => { setExtendNewCheckout(e.target.value); setExtendAvail(null); setExtendSelectedAlt(null); }}
                />
              </Field>

              {extendModal.source !== "direct" && (
                <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e", marginBottom: 10 }}>
                  ⚠ OTA booking ({extendModal.source}). Extending here won't sync with the OTA — confirm you've coordinated with them first.
                </div>
              )}

              {extendAvailLoading && (
                <p style={{ fontSize: 12, color: "var(--ff-muted)", textAlign: "center", padding: "12px 0" }}>Checking availability…</p>
              )}

              {extendAvail && !extendAvailLoading && (() => {
                const same      = extendAvail.same_type;
                const activeAlt = extendSelectedAlt;
                const rateBase  = activeAlt ? activeAlt.rate_sum : same.rate_sum;
                const taxPct    = extendAvail.original_tax_pct;
                const extTax    = Math.round(rateBase * taxPct) / 100;
                const extTotal  = rateBase + extTax;
                const canCommit = activeAlt ? activeAlt.fully_available : same.available_all;

                return (
                  <>
                    {/* Availability status */}
                    {same.available_all && !activeAlt ? (
                      <div style={{ background: "#f0fdf4", border: "1px solid #22c55e", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#14532d", marginBottom: 10 }}>
                        ✓ {same.name} available for all {extendAvail.extension_nights} additional night{extendAvail.extension_nights > 1 ? "s" : ""}
                        {!extendAvail.same_room_available && extendModal.room_number && (
                          <span style={{ color: "#78350f" }}> — Note: physical room may need reassignment for extended nights</span>
                        )}
                      </div>
                    ) : activeAlt ? (
                      <div style={{ background: "#eff6ff", border: "1px solid #3b82f6", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#1e3a8a", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>✓ Switching to <strong>{activeAlt.name}</strong> for the extension</span>
                        <button style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 11, padding: 0 }} onClick={() => setExtendSelectedAlt(null)}>Use original room</button>
                      </div>
                    ) : same.available_count > 0 ? (
                      <div style={{ background: "#fefce8", border: "1px solid #eab308", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#713f12", marginBottom: 10 }}>
                        ⚠ Only {same.available_count} of {extendAvail.extension_nights} nights available in {same.name}.
                        {" "}Max extension: {same.nights.filter(n => n.available).slice(-1)[0]?.date ? fmtDate(same.nights.filter(n => n.available).slice(-1)[0].date) : ""}
                      </div>
                    ) : (
                      <div style={{ background: "#fef2f2", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#991b1b", marginBottom: 10 }}>
                        ✗ {same.name} is fully booked for the requested dates.
                      </div>
                    )}

                    {/* Alternative room types */}
                    {!same.available_all && !activeAlt && extendAvail.alternatives.filter(a => a.fully_available).length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--ff-muted)", marginBottom: 6 }}>Available alternatives:</p>
                        {extendAvail.alternatives.filter(a => a.fully_available).map(alt => (
                          <div key={alt.room_type_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", border: "1px solid var(--ff-border)", borderRadius: 8, marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{alt.name}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontSize: 12, color: "var(--ff-muted)" }}>{rupee(alt.rate_sum)} base ({extendAvail.extension_nights}n)</span>
                              <button className="ff-btn ff-btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setExtendSelectedAlt(alt)}>Select</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Rate breakdown */}
                    {canCommit && (
                      <div style={{ background: "#f9fafb", border: "1px solid var(--ff-border)", borderRadius: 8, padding: "12px 14px", marginBottom: 12, fontSize: 13 }}>
                        <p style={{ fontWeight: 700, marginBottom: 8, fontSize: 12, color: "var(--ff-muted)" }}>Extension Cost Breakdown</p>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ color: "var(--ff-muted)" }}>Room type:</span>
                          <span style={{ fontWeight: 600 }}>{activeAlt ? activeAlt.name : same.name}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ color: "var(--ff-muted)" }}>Nights:</span>
                          <span>{extendAvail.extension_nights}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ color: "var(--ff-muted)" }}>Base rate:</span>
                          <span>{rupee(rateBase)}</span>
                        </div>
                        {taxPct > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ color: "var(--ff-muted)" }}>Tax ({Math.round(taxPct)}%):</span>
                            <span>{rupee(extTax)}</span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--ff-border)", marginTop: 4, fontWeight: 700 }}>
                          <span>Additional charge:</span>
                          <span style={{ color: "#0ea5e9" }}>{rupee(extTotal)}</span>
                        </div>
                      </div>
                    )}

                    {/* Payment collection */}
                    {canCommit && (
                      <Grid2>
                        <Field label="Collect now (₹)">
                          <input
                            type="number"
                            min="0"
                            max={extTotal}
                            step="0.01"
                            value={extendPayment}
                            onChange={e => setExtendPayment(e.target.value)}
                            placeholder={`Full charge: ${rupee(extTotal)}`}
                          />
                        </Field>
                        <Field label="Payment Method">
                          <select value={extendPayMethod} onChange={e => setExtendPayMethod(e.target.value)}>
                            <option value="cash">Cash</option>
                            <option value="card">Card</option>
                            <option value="upi">UPI</option>
                          </select>
                        </Field>
                      </Grid2>
                    )}
                  </>
                );
              })()}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="ff-btn ff-btn-ghost" onClick={() => setExtendModal(null)}>Cancel</button>
                {extendAvail && (extendSelectedAlt ? extendSelectedAlt.fully_available : extendAvail.same_type.available_all) && (
                  <button
                    type="button"
                    className="ff-btn ff-btn-primary"
                    style={{ background: "#0ea5e9", borderColor: "#0ea5e9" }}
                    onClick={submitExtend}
                    disabled={extendBusy}
                  >
                    <CalendarPlus size={14} />
                    {extendBusy ? "Extending…" : `Extend to ${fmtDate(extendNewCheckout)}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overbooking Conflict Log */}
      {!conflictLog.loading && !conflictLog.error && (conflictLog.data || []).length > 0 && (
        <div className="ff-card" style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <AlertTriangle size={16} style={{ color: "#d97706" }} />
            <span style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>Overbooking Attempt Log</span>
            <span className="ff-muted-sm" style={{ marginLeft: "auto", fontSize: 11 }}>Last {(conflictLog.data || []).length} attempts</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ff-border)" }}>
                <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--ff-muted)", fontWeight: 600 }}>Time</th>
                <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--ff-muted)", fontWeight: 600 }}>Triggered By</th>
                <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--ff-muted)", fontWeight: 600 }}>Details</th>
                <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--ff-muted)", fontWeight: 600 }}>Alert</th>
              </tr>
            </thead>
            <tbody>
              {(conflictLog.data || []).map(row => (
                <tr key={row.id} style={{ borderBottom: "1px solid var(--ff-border)" }}>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: "var(--ff-muted)" }}>
                    {new Date(row.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{row.triggered_by || "—"}</td>
                  <td style={{ padding: "6px 8px", color: "#555" }}>{row.message || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                      background: row.status === "sent" ? "#dcfce7" : "#fef3c7",
                      color: row.status === "sent" ? "#14532d" : "#92400e",
                    }}>
                      {row.status === "sent" ? "Owner Notified" : row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete All Confirmation */}
      {confirmDelAll && (
        <div className="ff-backdrop" onClick={() => setConfirmDelAll(false)}>
          <div className="ff-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Delete All Bookings?</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setConfirmDelAll(false)}><X size={18} /></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ color: "var(--ff-muted)", marginBottom: 20 }}>
                This will permanently delete <strong>all {allBookings.length} bookings</strong> and release all room inventory. This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmDelAll(false)}>Cancel</button>
                <button
                  className="ff-btn ff-btn-primary"
                  style={{ background: "var(--ff-danger)", borderColor: "var(--ff-danger)" }}
                  onClick={deleteAllBookings}
                  disabled={deletingAll}
                >
                  {deletingAll ? "Deleting…" : "Yes, Delete All"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDel && (
        <div className="ff-backdrop" onClick={() => setConfirmDel(null)}>
          <div className="ff-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Delete Booking?</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setConfirmDel(null)}><X size={18} /></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ color: "var(--ff-muted)", marginBottom: 20 }}>
                This permanently deletes the booking and releases the inventory. This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                <button className="ff-btn ff-btn-primary" style={{ background: "var(--ff-danger)", borderColor: "var(--ff-danger)" }} onClick={confirmDelete} disabled={busy}>
                  {busy ? "Deleting…" : "Yes, Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
