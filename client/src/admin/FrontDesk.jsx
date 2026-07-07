/**
 * FrontDesk.jsx
 * Smart Check-In Wizard from f2.docx:
 * "A multi-step form to guarantee clean database collection.
 * If nationality ≠ 'Indian' → blocks completion until Form C upload resolved.
 * If corporate box checked → regex validation forces 15-character GSTIN."
 */
import { useState, useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck, Upload, AlertTriangle, Check, User, Building2, X } from "lucide-react";
import { useApi, adminRooms, adminGuests, adminAvailableRooms, adminCreateBooking, adminLookupGuestByKyc, apiFetch, rupee, todayISO, notify } from "./adminContext.js";
import { checkConflict } from "../api/client.js";
import { Spinner, ApiError, SectionHeader, Field, Grid2, Card, Modal } from "./ui.jsx";

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const STEPS       = ["Guest Details", "KYC & ID", "Booking Details", "Payment Summary"];

const KYC_CONFIG = {
  "Aadhaar":         { maxLength: 12, pattern: /^[0-9]{12}$/,                    hint: "12-digit number",       inputMode: "numeric" },
  "PAN":             { maxLength: 10, pattern: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,    hint: "AAAAA9999A",            inputMode: "text"    },
  "Passport":        { maxLength: 8,  pattern: /^[A-Z][0-9]{7}$/,                hint: "A1234567",              inputMode: "text"    },
  "Voter ID":        { maxLength: 10, pattern: /^[A-Z]{3}[0-9]{7}$/,             hint: "ABC1234567",            inputMode: "text"    },
  "Driving Licence": { maxLength: 16, pattern: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,12}$/, hint: "KL0120240001234", inputMode: "text"    },
};
const ID_TYPES = Object.keys(KYC_CONFIG);

export default function FrontDesk({ onNavigate }) {
  const rooms  = useApi(adminRooms);
  const guests = useApi(adminGuests);

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  // KYC verification state for returning guests
  const [kycVerifyType, setKycVerifyType] = useState("Aadhaar");
  const [kycVerifyNum,  setKycVerifyNum]  = useState("");
  const [kycVerifyBusy, setKycVerifyBusy] = useState(false);
  const [kycVerifyErr,  setKycVerifyErr]  = useState("");
  const [verifiedGuest, setVerifiedGuest] = useState(null);

  const [f, setF] = useState({
    // Guest
    isNewGuest:     true,
    existingGuestId: "",
    fullName:       "",
    phone:          "",
    email:          "",
    nationality:    "Indian",
    addr1:          "",
    addr2:          "",
    addrState:      "",
    pincode:        "",
    // KYC
    isCorporate:    false,
    idType:         "Aadhaar",
    idNumber:       "",
    corporateGstin: "",
    corporateName:  "",
    formCUploaded:  false,
    // Booking
    roomTypeId:     "",
    roomId:         "",
    checkIn:        todayISO(),
    checkOut:       (() => { const t = new Date(); t.setDate(t.getDate()+1); return t.toISOString().slice(0,10); })(),
    taxPercentage:  "12",
    advancePaid:    "0",
    paymentMethod:  "cash",
    bookingStatus:  "checked_in",
    notes:          "",
  });

  const upd = (k, v) => setF(p => ({ ...p, [k]: v }));

  const verifyReturningGuest = async () => {
    setKycVerifyErr("");
    if (!kycVerifyNum.trim()) return setKycVerifyErr("Enter the ID number.");
    const cfg = KYC_CONFIG[kycVerifyType];
    if (cfg && !cfg.pattern.test(kycVerifyNum)) return setKycVerifyErr(`Invalid ${kycVerifyType} format — expected: ${cfg.hint}`);
    setKycVerifyBusy(true);
    try {
      const g = await adminLookupGuestByKyc(kycVerifyNum);
      setVerifiedGuest(g);
      upd("existingGuestId", String(g.id));
      // Pre-fill KYC step with the stored ID
      if (g.kyc_type) {
        const kycLabel = { aadhaar:"Aadhaar", pan:"PAN", passport:"Passport", voter_id:"Voter ID", dl:"Driving Licence" }[g.kyc_type] || g.kyc_type;
        setF(p => ({ ...p, existingGuestId: String(g.id), idType: kycLabel, idNumber: g.kyc_number || kycVerifyNum }));
      } else {
        setF(p => ({ ...p, existingGuestId: String(g.id), idType: kycVerifyType, idNumber: kycVerifyNum }));
      }
    } catch (e) {
      setKycVerifyErr(e.status === 404 ? "No guest found with that ID number." : e.message);
    } finally { setKycVerifyBusy(false); }
  };

  const resetReturningGuest = () => {
    setVerifiedGuest(null);
    setKycVerifyNum("");
    setKycVerifyErr("");
    upd("existingGuestId", "");
  };

  const [availableRooms, setAvailableRooms] = useState([]);
  const [roomsLoading, setRoomsLoading]      = useState(false);
  const [conflictDates, setConflictDates]    = useState([]);
  const conflictTimer = useRef(null);

  // Advisory conflict check — debounced 400ms, does not block submission.
  useEffect(() => {
    if (conflictTimer.current) clearTimeout(conflictTimer.current);
    if (!f.roomTypeId || !f.checkIn || !f.checkOut) { setConflictDates([]); return; }
    conflictTimer.current = setTimeout(() => {
      checkConflict({ room_type_id: Number(f.roomTypeId), check_in: f.checkIn, check_out: f.checkOut })
        .then(({ conflicts }) => setConflictDates(conflicts || []))
        .catch(() => setConflictDates([]));
    }, 400);
    return () => clearTimeout(conflictTimer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.roomTypeId, f.checkIn, f.checkOut]);

  // Whenever the room type or dates change, reload which physical rooms of
  // that type are free for the whole stay and clear any stale selection.
  useEffect(() => {
    if (!f.roomTypeId || !f.checkIn || !f.checkOut) { setAvailableRooms([]); return; }
    setRoomsLoading(true);
    adminAvailableRooms(f.roomTypeId, f.checkIn, f.checkOut)
      .then(list => {
        setAvailableRooms(list);
        if (!list.some(r => String(r.id) === f.roomId)) upd("roomId", "");
      })
      .catch(() => setAvailableRooms([]))
      .finally(() => setRoomsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.roomTypeId, f.checkIn, f.checkOut]);

  const types     = rooms.data?.types || [];
  const guestList = guests.data || [];
  const selType   = types.find(t => String(t.id) === f.roomTypeId);
  const nights    = Math.max(0, Math.round((new Date(f.checkOut) - new Date(f.checkIn)) / 86400000));
  const rate      = selType ? Number(selType.rate_today ?? selType.base_rate) : 0;
  const base      = rate * nights;
  const gst       = base > 7500 ? 0.18 : 0.05; // f2.docx GST safeguard rule
  const taxAmt    = Math.round(base * gst);
  const total     = base + taxAmt;
  const pending   = Math.max(total - Number(f.advancePaid || 0), 0);

  const validate = (s) => {
    const e = {};
    if (s === 0) {
      if (f.isNewGuest && !f.fullName.trim()) e.fullName = "Name is required";
      if (f.isNewGuest && !f.phone.trim())    e.phone = "Phone is required";
      if (!f.isNewGuest && !verifiedGuest)    e.existingGuestId = "Verify the returning guest's ID before proceeding";
    }
    if (s === 1) {
      const kycCfg = KYC_CONFIG[f.idType];
      if (!f.idNumber.trim()) {
        e.idNumber = "ID number is required";
      } else if (!kycCfg.pattern.test(f.idNumber)) {
        e.idNumber = `Invalid ${f.idType} — expected format: ${kycCfg.hint}`;
      }
      if (f.nationality !== "Indian" && !f.formCUploaded) e.formC = "Form C must be uploaded for foreign nationals";
      if (f.isCorporate && !GSTIN_REGEX.test(f.corporateGstin)) e.corporateGstin = "Enter a valid 15-character GSTIN";
    }
    if (s === 2) {
      if (!f.roomTypeId) e.roomTypeId = "Select a room";
      if (nights < 1)   e.checkOut   = "Check-out must be after check-in";
      if (f.roomTypeId && nights >= 1 && !f.roomId) e.roomId = "Select a room number";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => { if (validate(step)) setStep(s => Math.min(s + 1, 3)); };
  const back = () => setStep(s => Math.max(s - 1, 0));

  const submit = async () => {
    if (!validate(2)) return;
    setBusy(true);
    try {
      const payload = {
        room_type_id:   Number(f.roomTypeId),
        room_id:        Number(f.roomId),
        check_in:       f.checkIn,
        check_out:      f.checkOut,
        num_guests:     1,
        advance_paid:   Number(f.advancePaid || 0),
        tax_percentage: Number(f.taxPercentage),
        payment_method: f.paymentMethod,
        status:         f.bookingStatus,
      };
      if (f.isNewGuest) {
        payload.guest = {
          full_name: f.fullName, phone: f.phone, email: f.email,
          addr1: f.addr1, addr2: f.addr2, state: f.addrState, pincode: f.pincode,
        };
      } else {
        payload.guest_id = Number(f.existingGuestId);
      }
      const res = await adminCreateBooking(payload);
      setDone({ ...res.booking, _selType: selType });
      notify("Check-in completed!", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally { setBusy(false); }
  };

  const launchRazorpay = async (bookingId, amount) => {
    try {
      const order = await apiFetch("/api/payments/create-order", {
        method: "POST",
        body: JSON.stringify({ booking_id: bookingId, amount }),
      });
      const rz = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: "INR",
        order_id: order.order_id,
        name: "Sunshine Resort",
        description: "Room booking payment",
        handler: async (response) => {
          try {
            await apiFetch("/api/payments/verify", {
              method: "POST",
              body: JSON.stringify({
                booking_id:           bookingId,
                razorpay_order_id:    response.razorpay_order_id,
                razorpay_payment_id:  response.razorpay_payment_id,
                razorpay_signature:   response.razorpay_signature,
              }),
            });
            notify("Payment captured successfully!", "success");
            setDone(prev => prev ? { ...prev, payment_status: "paid" } : prev);
          } catch (e) {
            notify("Payment captured but verification failed: " + e.message, "error");
          }
        },
        theme: { color: "#1a56db" },
      });
      rz.open();
    } catch (e) {
      notify("Could not launch Razorpay: " + e.message, "error");
    }
  };

  if (rooms.loading || guests.loading) return <Spinner />;
  if (rooms.error || guests.error) return <ApiError msg={rooms.error || guests.error} />;

  if (done) return (
    <div className="ff-page">
      <div className="ff-checkin-success">
        <div className="ff-success-icon"><Check size={36} /></div>
        <h2 className="ff-page-title" style={{ marginTop: 16 }}>Check-In Complete</h2>
        <p className="ff-muted-sm" style={{ justifyContent: "center", marginTop: 6 }}>Booking reference: <b className="ff-mono">{done.reference}</b></p>
        <div className="ff-billing" style={{ maxWidth: 380, margin: "20px auto" }}>
          <div className="ff-billing-row"><span>Room</span><b>{selType?.name} {done.room_number ? `(#${done.room_number})` : ""}</b></div>
          <div className="ff-billing-row"><span>Check in</span><b>{f.checkIn}</b></div>
          <div className="ff-billing-row"><span>Check out</span><b>{f.checkOut}</b></div>
          <div className="ff-billing-row ff-billing-total"><span>Total</span><b>{rupee(done.total_amount)}</b></div>
          <div className="ff-billing-row ff-billing-pending"><span>Balance due</span><b>{rupee(done.pending_amount)}</b></div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
          <button className="ff-btn ff-btn-primary" onClick={() => { setDone(null); setStep(0); setF(p => ({ ...p, fullName: "", phone: "", email: "", idNumber: "", advancePaid: "0", roomId: "" })); }}>
            New Check-In
          </button>
          <button className="ff-btn ff-btn-outline" onClick={() => onNavigate("bookings")}>View Bookings</button>
          {done.id && Number(done.pending_amount) > 0 && done.payment_status !== "paid" && (
            <button
              className="ff-btn"
              style={{ background: "#528FF0", color: "#fff" }}
              onClick={() => launchRazorpay(done.id, done.pending_amount)}
            >
              Pay Balance via Razorpay
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Front Desk"
        title="Smart Check-In Wizard"
        action={<button className="ff-icon-btn" onClick={() => onNavigate("dashboard")}><ArrowLeft size={18} /></button>}
      />

      {/* Stepper */}
      <div className="ff-stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={`ff-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
            <div className="ff-step-dot">{i < step ? <Check size={12} /> : i + 1}</div>
            <span>{s}</span>
          </div>
        ))}
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto" }}>

        {/* Step 0 — Guest Details */}
        {step === 0 && (
          <Card title="Guest Details">
            <div className="ff-fields">
              <label className="ff-toggle-row">
                <input type="checkbox" checked={!f.isNewGuest} onChange={e => { upd("isNewGuest", !e.target.checked); if (e.target.checked) { setVerifiedGuest(null); setKycVerifyNum(""); setKycVerifyErr(""); } }} />
                <span>Returning guest — select from directory</span>
              </label>
              {!f.isNewGuest ? (
                <div style={{ background: "var(--surface-alt,#f8fafc)", borderRadius: 10, padding: 16, border: "1px solid var(--border)" }}>
                  {!verifiedGuest ? (
                    <>
                      {/* Directory dropdown */}
                      {guestList.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <Field label="Select from Guest Directory">
                            <select
                              value=""
                              onChange={e => {
                                const g = guestList.find(x => String(x.id) === e.target.value);
                                if (!g) return;
                                setVerifiedGuest({ ...g, stays: g.stays ?? 0 });
                                const kycLabel = { aadhaar:"Aadhaar", pan:"PAN", passport:"Passport", voter_id:"Voter ID", dl:"Driving Licence" }[g.kyc_type] || g.kyc_type || kycVerifyType;
                                setKycVerifyType(kycLabel);
                                setKycVerifyNum(g.kyc_number || "");
                                setF(p => ({ ...p, existingGuestId: String(g.id), idType: kycLabel, idNumber: g.kyc_number || "" }));
                              }}
                            >
                              <option value="">— Search guest by name —</option>
                              {guestList.map(g => (
                                <option key={g.id} value={g.id}>
                                  {g.full_name}{g.phone ? ` · ${g.phone}` : ""}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0", color: "var(--muted)", fontSize: 12 }}>
                            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                            <span>or verify by government ID</span>
                            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                          </div>
                        </div>
                      )}
                      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
                        <ShieldCheck size={14} style={{ color: "#1a56db" }} />
                        Enter the guest's government-issued ID to verify and auto-fill their details.
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <Field label="ID Type">
                          <select value={kycVerifyType} onChange={e => { setKycVerifyType(e.target.value); setKycVerifyNum(""); setKycVerifyErr(""); }}>
                            {ID_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </Field>
                        <Field label={`ID Number (${KYC_CONFIG[kycVerifyType].hint})`}>
                          <input
                            value={kycVerifyNum}
                            placeholder={KYC_CONFIG[kycVerifyType].hint}
                            maxLength={KYC_CONFIG[kycVerifyType].maxLength}
                            inputMode={KYC_CONFIG[kycVerifyType].inputMode}
                            onChange={e => { setKycVerifyNum(e.target.value.toUpperCase().replace(/\s/g, "")); setKycVerifyErr(""); }}
                            onKeyDown={e => e.key === "Enter" && verifyReturningGuest()}
                          />
                        </Field>
                      </div>
                      {kycVerifyErr && <p className="ff-field-err" style={{ marginBottom: 10 }}>{kycVerifyErr}</p>}
                      {errors.existingGuestId && <p className="ff-field-err" style={{ marginBottom: 10 }}>{errors.existingGuestId}</p>}
                      <button
                        className="ff-btn ff-btn-primary"
                        onClick={verifyReturningGuest}
                        disabled={kycVerifyBusy || !kycVerifyNum}
                        style={{ display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <ShieldCheck size={14} /> {kycVerifyBusy ? "Verifying…" : "Verify & fetch guest"}
                      </button>
                    </>
                  ) : (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <ShieldCheck size={16} style={{ color: "#059669" }} />
                          <span style={{ fontWeight: 700, fontSize: 15, color: "#065f46" }}>Identity verified</span>
                        </div>
                        <button style={{ background: "none", border: "none", cursor: "pointer", color: "#059669" }} onClick={resetReturningGuest} title="Change guest">
                          <X size={16} />
                        </button>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{verifiedGuest.full_name}</div>
                      {verifiedGuest.phone && <div style={{ fontSize: 13, color: "#444", marginTop: 2 }}>{verifiedGuest.phone}</div>}
                      {verifiedGuest.email && <div style={{ fontSize: 13, color: "#444" }}>{verifiedGuest.email}</div>}
                      <div style={{ marginTop: 8, fontSize: 12, color: "#059669", fontWeight: 600 }}>
                        {kycVerifyType}: {kycVerifyNum} · {verifiedGuest.stays} prior stay{verifiedGuest.stays !== 1 ? "s" : ""}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Grid2>
                    <Field label="Full Name *"><input value={f.fullName} onChange={e => upd("fullName", e.target.value)} placeholder="As on ID"/>{errors.fullName && <p className="ff-field-err">{errors.fullName}</p>}</Field>
                    <Field label="Phone *"><input value={f.phone} onChange={e => upd("phone", e.target.value)} placeholder="+91…"/>{errors.phone && <p className="ff-field-err">{errors.phone}</p>}</Field>
                    <Field label="Email"><input type="email" value={f.email} onChange={e => upd("email", e.target.value)} placeholder="email@example.com"/></Field>
                    <Field label="Nationality">
                      <select value={f.nationality} onChange={e => upd("nationality", e.target.value)}>
                        <option value="Indian">Indian</option>
                        <option value="Foreign">Foreign National</option>
                      </select>
                    </Field>
                  </Grid2>
                  <Field label="Address Line 1"><input value={f.addr1} onChange={e => upd("addr1", e.target.value)} placeholder="House / flat / building"/></Field>
                  <Field label="Address Line 2"><input value={f.addr2} onChange={e => upd("addr2", e.target.value)} placeholder="Street / area / locality"/></Field>
                  <Grid2>
                    <Field label="State"><input value={f.addrState} onChange={e => upd("addrState", e.target.value)} placeholder="e.g. Kerala"/></Field>
                    <Field label="Pincode"><input value={f.pincode} onChange={e => upd("pincode", e.target.value)} placeholder="6-digit PIN" maxLength={6}/></Field>
                  </Grid2>
                </>
              )}
            </div>
          </Card>
        )}

        {/* Step 1 — KYC & ID */}
        {step === 1 && (
          <Card title="KYC & Compliance">
            <div className="ff-fields">
              {/* Form C gate for foreign nationals */}
              {f.nationality !== "Indian" && (
                <div className="ff-alert ff-alert-warn">
                  <AlertTriangle size={18} />
                  <div>
                    <b>Foreign National — Form C Required</b>
                    <p style={{ margin: "4px 0 10px", fontSize: 13 }}>
                      Check-in cannot be completed until Form C is uploaded. This is mandatory under Foreigners Act regulations.
                    </p>
                    <label className="ff-toggle-row" style={{ cursor: "pointer" }}>
                      <input type="checkbox" checked={f.formCUploaded} onChange={e => upd("formCUploaded", e.target.checked)} />
                      <Upload size={14} />
                      <span>Form C uploaded and verified</span>
                    </label>
                    {errors.formC && <p className="ff-field-err">{errors.formC}</p>}
                  </div>
                </div>
              )}

              <Grid2>
                <Field label="ID Type">
                  <select value={f.idType} onChange={e => setF(p => ({ ...p, idType: e.target.value, idNumber: "" }))}>
                    {ID_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label={`${f.idType} Number *`}>
                  <input
                    value={f.idNumber}
                    onChange={e => {
                      const raw = e.target.value.toUpperCase().replace(/\s/g, "");
                      if (raw.length <= KYC_CONFIG[f.idType].maxLength) upd("idNumber", raw);
                    }}
                    placeholder={KYC_CONFIG[f.idType].hint}
                    maxLength={KYC_CONFIG[f.idType].maxLength}
                    inputMode={KYC_CONFIG[f.idType].inputMode}
                  />
                  {errors.idNumber && <p className="ff-field-err">{errors.idNumber}</p>}
                </Field>
              </Grid2>

              {/* Corporate/GSTIN toggle */}
              <div className="ff-divider" />
              <label className="ff-toggle-row">
                <input type="checkbox" checked={f.isCorporate} onChange={e => upd("isCorporate", e.target.checked)} />
                <Building2 size={15} />
                <span>Corporate booking — GST invoice required</span>
              </label>

              {f.isCorporate && (
                <div className="ff-alert ff-alert-info">
                  <ShieldCheck size={18} />
                  <div style={{ flex: 1 }}>
                    <b>GSTIN Validation (15-digit)</b>
                    <p style={{ margin: "4px 0 10px", fontSize: 13 }}>Format: 2-digit state code + 5-letter PAN + 4 digits + 1 letter + 1 char + Z + 1 char</p>
                    <Grid2>
                      <Field label="Company Name"><input value={f.corporateName} onChange={e => upd("corporateName", e.target.value)} placeholder="Registered company name"/></Field>
                      <Field label="GSTIN *">
                        <input value={f.corporateGstin} onChange={e => upd("corporateGstin", e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" maxLength={15}/>
                        {f.corporateGstin && (
                          <p style={{ fontSize: 11, marginTop: 4, color: GSTIN_REGEX.test(f.corporateGstin) ? "var(--ff-success)" : "var(--ff-danger)" }}>
                            {GSTIN_REGEX.test(f.corporateGstin) ? "✓ Valid GSTIN format" : "✗ Invalid format"}
                          </p>
                        )}
                        {errors.corporateGstin && <p className="ff-field-err">{errors.corporateGstin}</p>}
                      </Field>
                    </Grid2>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Step 2 — Booking Details */}
        {step === 2 && (
          <div className="ff-form-grid">
            <Card title="Booking Details">
              <div className="ff-fields">
                <Field label="Room Type *">
                  <select value={f.roomTypeId} onChange={e => upd("roomTypeId", e.target.value)}>
                    <option value="">Select room…</option>
                    {types.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {rupee(t.rate_today ?? t.base_rate)}/night {t.available_today != null ? `(${t.available_today} free)` : ""}
                      </option>
                    ))}
                  </select>
                  {errors.roomTypeId && <p className="ff-field-err">{errors.roomTypeId}</p>}
                </Field>
                <Field label="Room Number *">
                  <select value={f.roomId} onChange={e => upd("roomId", e.target.value)} disabled={!f.roomTypeId || roomsLoading}>
                    <option value="">
                      {!f.roomTypeId ? "Select a room type first…"
                        : roomsLoading ? "Loading…"
                        : availableRooms.length === 0 ? "No rooms free for these dates"
                        : "Select room number…"}
                    </option>
                    {availableRooms.map(r => (
                      <option key={r.id} value={r.id}>{r.room_number}</option>
                    ))}
                  </select>
                  {errors.roomId && <p className="ff-field-err">{errors.roomId}</p>}
                </Field>
                <Grid2>
                  <Field label="Check-in Date"><input type="date" value={f.checkIn} onChange={e => upd("checkIn", e.target.value)}/></Field>
                  <Field label="Check-out Date"><input type="date" value={f.checkOut} min={f.checkIn} onChange={e => upd("checkOut", e.target.value)}/>{errors.checkOut && <p className="ff-field-err">{errors.checkOut}</p>}</Field>
                  <Field label="GST % (auto-set by tariff)">
                    <input value={base > 7500 ? "18 (tariff > ₹7,500)" : "5 (tariff ≤ ₹7,500)"} readOnly style={{ opacity: .7 }}/>
                  </Field>
                  <Field label="Advance Paid (₹)"><input type="number" min="0" value={f.advancePaid} onChange={e => upd("advancePaid", e.target.value)}/></Field>
                  <Field label="Payment Method">
                    <select value={f.paymentMethod} onChange={e => upd("paymentMethod", e.target.value)}>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="upi">UPI</option>
                    </select>
                  </Field>
                </Grid2>
                <Field label="Status">
                  <select value={f.bookingStatus} onChange={e => upd("bookingStatus", e.target.value)}>
                    <option value="confirmed">Confirmed</option>
                    <option value="checked_in">Checked In</option>
                  </select>
                </Field>
                <Field label="Notes"><textarea value={f.notes} onChange={e => upd("notes", e.target.value)} rows={2} placeholder="Special requests, preferences…"/></Field>
              </div>
            </Card>

            <Card title="Billing Summary">
              <div className="ff-billing">
                <div className="ff-billing-row"><span>Nights</span><b>{nights}</b></div>
                <div className="ff-billing-row"><span>Rate / night</span><b>{rupee(rate)}</b></div>
                <div className="ff-billing-row"><span>Base amount</span><b>{rupee(base)}</b></div>
                <div className="ff-billing-row">
                  <span>GST ({base > 7500 ? 18 : 5}%)</span>
                  <b>{rupee(taxAmt)}</b>
                </div>
                <div className="ff-billing-row ff-billing-total"><span>Total</span><b>{rupee(total)}</b></div>
                <div className="ff-billing-row ff-billing-advance"><span>Advance paid</span><b>{rupee(Number(f.advancePaid || 0))}</b></div>
                <div className="ff-billing-row ff-billing-pending"><span>Balance due</span><b>{rupee(pending)}</b></div>
              </div>
              {base > 7500 && base < 8200 && (
                <div className="ff-alert ff-alert-warn" style={{ marginTop: 14 }}>
                  <AlertTriangle size={16} />
                  <span style={{ fontSize: 12 }}>
                    Tariff is in the GST danger zone (₹7,500–₹8,200). The surge engine has capped this at ₹7,499 to protect the guest from the 18% GST bracket jump.
                  </span>
                </div>
              )}
              {conflictDates.length > 0 && (
                <div className="ff-alert ff-alert-warn" style={{ marginTop: 14 }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <div>
                    <b>Inventory Warning — Dates at Capacity</b>
                    <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                      {conflictDates.length} night{conflictDates.length > 1 ? "s" : ""} in this range are at full occupancy
                      ({conflictDates.map(c => new Date(c.stay_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })).join(", ")}).
                      Submission will be blocked if inventory is still sold out at the time of booking.
                    </p>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Step 3 — Summary before confirm */}
        {step === 3 && (
          <Card title="Confirm Check-In">
            <div className="ff-billing">
              <div className="ff-billing-row"><span>Guest</span><b>{f.fullName || "Existing guest"}</b></div>
              <div className="ff-billing-row"><span>Nationality</span><b>{f.nationality}</b></div>
              {f.nationality !== "Indian" && <div className="ff-billing-row"><span>Form C</span><b style={{ color: f.formCUploaded ? "var(--ff-success)" : "var(--ff-danger)" }}>{f.formCUploaded ? "✓ Uploaded" : "✗ Missing"}</b></div>}
              {f.isCorporate && <div className="ff-billing-row"><span>GSTIN</span><b className="ff-mono">{f.corporateGstin}</b></div>}
              <div className="ff-billing-row"><span>Room</span><b>{selType?.name || "—"} {availableRooms.find(r => String(r.id) === f.roomId)?.room_number ? `(#${availableRooms.find(r => String(r.id) === f.roomId).room_number})` : ""}</b></div>
              <div className="ff-billing-row"><span>Check in → out</span><b>{f.checkIn} → {f.checkOut} ({nights}n)</b></div>
              <div className="ff-billing-row ff-billing-total"><span>Total incl. GST</span><b>{rupee(total)}</b></div>
              <div className="ff-billing-row"><span>Payment Method</span><b style={{ textTransform: "capitalize" }}>{f.paymentMethod}</b></div>
              <div className="ff-billing-row ff-billing-pending"><span>Balance due</span><b>{rupee(pending)}</b></div>
            </div>
          </Card>
        )}

        {/* Navigation buttons */}
        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "space-between" }}>
          <button className="ff-btn ff-btn-outline" onClick={back} disabled={step === 0}><ArrowLeft size={15} /> Back</button>
          {step < 3 ? (
            <button className="ff-btn ff-btn-primary" onClick={next}>
              Next <ArrowRight size={15} />
            </button>
          ) : (
            <button className="ff-btn ff-btn-primary" onClick={submit} disabled={busy}>
              {busy ? "Checking in…" : <><Check size={15} /> Complete Check-In</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
