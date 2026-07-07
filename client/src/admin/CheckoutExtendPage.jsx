import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, LogOut, CalendarPlus, X, AlertTriangle,
} from 'lucide-react';
import { apiFetch, notify, rupee, fmtDate, todayISO } from './adminContext.js';
import { earlyCheckoutPreview, earlyCheckout, extendAvailability, extendStay, notifyGuestCheckout } from '../api/client.js';

// ── ActiveStaysList ──────────────────────────────────────────────────────────
function ActiveStaysList({ onSelect, selectedId, searchQuery, reload }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [notifySending, setNotifySending] = useState({});
  const [notifiedAt, setNotifiedAt]       = useState({});
  const today = todayISO();

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/admin/bookings?status=checked_in')
      .then(data => {
        const rows = Array.isArray(data) ? data : [];
        setBookings(rows);
        const init = {};
        rows.forEach(b => {
          if (b.checkout_notification_sent_at) {
            const t = new Date(b.checkout_notification_sent_at);
            init[b.id] = t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
          }
        });
        setNotifiedAt(init);
      })
      .catch(e => notify(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [reload]);

  const handleNotify = async (e, b) => {
    e.stopPropagation();
    setNotifySending(s => ({ ...s, [b.id]: true }));
    try {
      const res = await notifyGuestCheckout(b.id);
      const t = new Date(res.sent_at);
      setNotifiedAt(s => ({ ...s, [b.id]: t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setNotifySending(s => ({ ...s, [b.id]: false }));
    }
  };

  const filtered = searchQuery.trim()
    ? bookings.filter(b =>
        b.guest?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.reference?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.phone?.includes(searchQuery)
      )
    : bookings;

  const dueToday = b => b.check_out?.slice(0, 10) === today;

  if (loading) return <div style={{ padding: 24, color: '#888', textAlign: 'center', fontSize: 13 }}>Loading stays…</div>;
  if (!filtered.length) return <div style={{ padding: 24, color: '#888', textAlign: 'center', fontSize: 13 }}>No active stays found</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {filtered.map(b => (
        <button
          key={b.id}
          onClick={() => onSelect(b)}
          style={{
            display: 'flex', flexDirection: 'column', gap: 3,
            padding: '10px 12px', borderRadius: 8, border: 'none',
            background: selectedId === b.id ? '#eff6ff' : dueToday(b) ? '#fff7ed' : '#f9fafb',
            cursor: 'pointer', textAlign: 'left',
            borderLeft: `3px solid ${selectedId === b.id ? '#3b82f6' : dueToday(b) ? '#f59e0b' : 'transparent'}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#111' }}>{b.guest}</span>
            {dueToday(b) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {notifiedAt[b.id] ? (
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#16a34a' }}>✓ {notifiedAt[b.id]}</span>
                ) : (
                  <button
                    disabled={notifySending[b.id]}
                    onClick={(e) => handleNotify(e, b)}
                    style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                      background: notifySending[b.id] ? '#e5e7eb' : '#f59e0b',
                      color: notifySending[b.id] ? '#9ca3af' : '#fff',
                      border: 'none', cursor: notifySending[b.id] ? 'default' : 'pointer',
                    }}
                  >
                    {notifySending[b.id] ? '…' : '🔔 Notify'}
                  </button>
                )}
                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: '#fef3c7', padding: '2px 7px', borderRadius: 10 }}>
                  DUE TODAY
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#666' }}>
            <span>{b.room || b.code}</span>
            <span>#{b.reference}</span>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>
            {fmtDate(b.check_in)} → {fmtDate(b.check_out)} · {b.nights}n
          </div>
        </button>
      ))}
    </div>
  );
}

// ── StayCard ─────────────────────────────────────────────────────────────────
function StayCard({ b }) {
  const statusColor = { paid: '#10b981', partial: '#f59e0b', pending: '#ef4444' }[b.payment_status] || '#9ca3af';
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
      padding: '14px 18px', marginBottom: 18,
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px',
    }}>
      <div>
        <div style={labelStyle}>Guest</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{b.guest}</div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 1 }}>{b.phone}</div>
      </div>
      <div>
        <div style={labelStyle}>Room</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{b.room}{b.room_number ? ` · ${b.room_number}` : ''}</div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 1 }}>#{b.reference}</div>
      </div>
      <div>
        <div style={labelStyle}>Stay</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(b.check_in)} → {fmtDate(b.check_out)}</div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 1 }}>{b.nights} nights</div>
      </div>
      <div>
        <div style={labelStyle}>Payment</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: statusColor + '22', padding: '2px 8px', borderRadius: 10 }}>
            {(b.payment_status || '').toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
          Adv: {rupee(b.advance_paid)} · Pend: {rupee(b.pending_amount)}
        </div>
      </div>
      {b.source && b.source !== 'direct' && (
        <div style={{
          gridColumn: '1 / -1',
          background: '#fef3c7', border: '1px solid #fbbf24',
          borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#92400e',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertTriangle size={12} />
          OTA booking via <strong style={{ marginLeft: 3 }}>{b.source}</strong>
          &nbsp;— changes here won't sync with the channel.
        </div>
      )}
    </div>
  );
}

// ── RefundCalculator ─────────────────────────────────────────────────────────
function RefundCalculator({ preview, overrideAmount, showOverride, onOverrideChange }) {
  if (!preview) return null;
  const { nights_breakdown = [], amount_for_actual, advance_paid, auto_refund_amount, balance_due } = preview;
  return (
    <div style={calcBoxStyle}>
      <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13, color: '#374151' }}>Refund Calculation</div>
      {nights_breakdown.map((n, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 12, color: '#555' }}>
          <span>{n.date}</span>
          <span>{rupee(n.rate)} + {rupee(n.tax)} GST = {rupee(n.total)}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8 }}>
        <Row label="Amount for actual stay" value={rupee(amount_for_actual)} bold />
        <Row label="Advance paid" value={rupee(advance_paid)} muted />
        <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 6, paddingTop: 6 }}>
          <Row label="Auto refund" value={rupee(auto_refund_amount)} bold valueColor={auto_refund_amount > 0 ? '#10b981' : undefined} />
        </div>
        {showOverride && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>Override amount:</span>
            <input
              type="number" min={0} max={advance_paid}
              value={overrideAmount}
              onChange={e => onOverrideChange(e.target.value)}
              style={{ width: 110, padding: '4px 8px', border: '1.5px solid #f59e0b', borderRadius: 6, fontSize: 13 }}
            />
          </div>
        )}
        {balance_due > 0 && (
          <div style={{ marginTop: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 10px', color: '#991b1b', fontSize: 12 }}>
            Balance due: <strong>{rupee(balance_due)}</strong> — guest must pay before checkout can be confirmed.
          </div>
        )}
      </div>
    </div>
  );
}

// ── EarlyCheckoutForm ────────────────────────────────────────────────────────
function EarlyCheckoutForm({ booking, onSuccess }) {
  const checkIn  = booking.check_in?.slice(0, 10);
  const origOut  = booking.check_out?.slice(0, 10);
  const today    = todayISO();
  const defaultDate = today < origOut ? today : '';
  const maxDate = (() => { const d = new Date(origOut); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();

  const [actualDate,   setActualDate]   = useState(defaultDate);
  const [preview,      setPreview]      = useState(null);
  const [prevLoading,  setPrevLoading]  = useState(false);
  const [prevErr,      setPrevErr]      = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [waive,        setWaive]        = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideAmt,  setOverrideAmt]  = useState('');
  const [notes,        setNotes]        = useState('');
  const [busy,         setBusy]         = useState(false);
  const [showZeroWarn, setShowZeroWarn] = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const timerRef = useRef(null);

  const fetchPreview = useCallback(async (date) => {
    if (!date || date <= checkIn || date >= origOut) { setPreview(null); return; }
    setPrevLoading(true); setPrevErr('');
    try {
      const p = await earlyCheckoutPreview(booking.id, date);
      setPreview(p);
      setOverrideAmt(String(p.auto_refund_amount));
    } catch (e) { setPrevErr(e.message); setPreview(null); }
    finally { setPrevLoading(false); }
  }, [booking.id, checkIn, origOut]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchPreview(actualDate), 400);
    return () => clearTimeout(timerRef.current);
  }, [actualDate, fetchPreview]);

  // Initial fetch
  useEffect(() => { if (defaultDate) fetchPreview(defaultDate); }, []); // eslint-disable-line

  const handleDateChange = v => {
    setActualDate(v);
    if (v === checkIn) setShowZeroWarn(true);
  };

  const canSubmit = actualDate > checkIn && actualDate < origOut && preview && !preview.balance_due && !busy;

  const effectiveRefund = showOverride && overrideAmt !== '' ? Number(overrideAmt) : (preview?.auto_refund_amount ?? 0);

  const handleSubmit = async () => {
    setBusy(true);
    try {
      await earlyCheckout(booking.id, {
        actual_checkout: actualDate,
        refund_method: waive ? null : refundMethod,
        waive_refund: waive,
        manual_refund_amount: showOverride && overrideAmt !== '' ? Number(overrideAmt) : null,
        notes,
      });
      notify('Early checkout confirmed', 'success');
      onSuccess();
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); setShowConfirm(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Date */}
      <Field label="Actual Checkout Date">
        <input
          type="date" value={actualDate} min={checkIn} max={maxDate}
          onChange={e => handleDateChange(e.target.value)}
          style={inputStyle}
        />
      </Field>

      {prevLoading && <div style={{ fontSize: 12, color: '#888' }}>Calculating…</div>}
      {prevErr    && <div style={{ fontSize: 12, color: '#ef4444' }}>{prevErr}</div>}

      {/* Balance due gate */}
      {preview?.balance_due > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ color: '#991b1b', fontWeight: 700, fontSize: 13 }}>
            Guest owes {rupee(preview.balance_due)} — mark balance paid in Bookings first.
          </div>
        </div>
      )}

      {/* Refund calculator */}
      {preview && !prevLoading && (
        <RefundCalculator
          preview={preview}
          overrideAmount={overrideAmt}
          showOverride={showOverride}
          onOverrideChange={setOverrideAmt}
        />
      )}

      {/* Override toggle */}
      {preview && !waive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => { setShowOverride(v => !v); }}
            style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1.5px solid ${showOverride ? '#f59e0b' : '#d1d5db'}`,
              background: showOverride ? '#fef3c7' : 'transparent',
              color: showOverride ? '#92400e' : '#555', cursor: 'pointer',
            }}
          >
            {showOverride ? 'Cancel Override' : 'Override Refund Amount'}
          </button>
          {showOverride && (
            <span style={{ fontSize: 11, color: '#92400e' }}>
              Manual override will be flagged in payment records
            </span>
          )}
        </div>
      )}

      {/* Waive */}
      {preview && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={waive} onChange={e => { setWaive(e.target.checked); if (e.target.checked) setShowOverride(false); }} />
          Waive refund (no refund issued)
        </label>
      )}

      {/* Refund method */}
      {preview && !waive && (
        <Field label="Refund Method">
          <select value={refundMethod} onChange={e => setRefundMethod(e.target.value)} style={inputStyle}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="upi">UPI</option>
            <option value="ota">OTA</option>
          </select>
        </Field>
      )}

      {/* Notes */}
      <Field label="Notes">
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)}
          rows={2} placeholder="Optional notes…"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      {/* CTA */}
      <button
        onClick={() => setShowConfirm(true)}
        disabled={!canSubmit}
        style={ctaStyle(canSubmit, '#6366f1')}
      >
        <LogOut size={15} /> Confirm Early Checkout
      </button>

      {/* Zero-night warning */}
      {showZeroWarn && (
        <ConfirmModal
          title="Zero-Night Checkout"
          body={`Guest is leaving on the check-in day. A minimum charge of 1 night applies. Manager confirmation required.`}
          confirmLabel="Confirm 1-Night Minimum"
          confirmColor="#6366f1"
          onCancel={() => setShowZeroWarn(false)}
          onConfirm={() => setShowZeroWarn(false)}
        />
      )}

      {/* Final confirm */}
      {showConfirm && (
        <ConfirmModal
          title="Confirm Early Checkout"
          body={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: '#444' }}>
              <div>Checkout date: <strong>{actualDate}</strong></div>
              <div>Refund: <strong>{waive ? 'Waived' : rupee(effectiveRefund)}</strong>{!waive && ` via ${refundMethod}`}</div>
              {showOverride && <div style={{ color: '#92400e', fontSize: 12 }}>⚠ Manual refund override will be flagged.</div>}
              <div style={{ color: '#9ca3af', fontSize: 12 }}>Unused-night inventory will be released.</div>
            </div>
          }
          confirmLabel={busy ? 'Processing…' : 'Confirm'}
          confirmColor="#6366f1"
          disabled={busy}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleSubmit}
        />
      )}
    </div>
  );
}

// ── ExtensionPricingBreakdown ─────────────────────────────────────────────────
function ExtensionPricingBreakdown({ avail, booking }) {
  if (!avail) return null;
  const { same_type, extension_nights, original_tax_pct } = avail;
  const taxRate = (original_tax_pct || 0) / 100;

  const getBadge = () => {
    if (same_type.available_all) return { color: '#10b981', bg: '#d1fae5', label: 'Available' };
    if (same_type.available_count > 0) return { color: '#f59e0b', bg: '#fef3c7', label: `Only ${same_type.available_count} of ${extension_nights} nights available` };
    return { color: '#ef4444', bg: '#fee2e2', label: 'No rooms available' };
  };
  const badge = getBadge();
  const base  = same_type.additional_base ?? same_type.rate_sum;
  const tax   = same_type.additional_tax  ?? Math.round(base * taxRate);
  const total = same_type.additional_total ?? (base + tax);

  return (
    <div style={calcBoxStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#374151' }}>Extension Pricing</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: badge.color, background: badge.bg, padding: '3px 10px', borderRadius: 10 }}>
          {badge.label}
        </span>
      </div>
      {(same_type.nights || []).map((n, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 12, color: n.available ? '#444' : '#aaa' }}>
          <span>{n.date}{!n.available ? ' (unavailable)' : ''}</span>
          <span>{rupee(n.rate)}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8 }}>
        <Row label={`${extension_nights} night${extension_nights !== 1 ? 's' : ''} base`} value={rupee(base)} />
        <Row label={`GST (${original_tax_pct}%)`} value={rupee(tax)} muted />
        <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 6, paddingTop: 6 }}>
          <Row label="Additional charge" value={rupee(total)} bold valueColor="#3b82f6" />
        </div>
        {booking.pending_amount != null && (
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
            Current pending: {rupee(booking.pending_amount)} → New pending: {rupee(Number(booking.pending_amount) + total)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ExtendStayForm ────────────────────────────────────────────────────────────
function ExtendStayForm({ booking, onSuccess }) {
  const origOut = booking.check_out?.slice(0, 10);
  const minDate = (() => { const d = new Date(origOut); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

  const [newDate,       setNewDate]       = useState('');
  const [avail,         setAvail]         = useState(null);
  const [availLoading,  setAvailLoading]  = useState(false);
  const [availErr,      setAvailErr]      = useState('');
  const [selectedType,  setSelectedType]  = useState(null); // room_type_id
  const [payAmount,     setPayAmount]     = useState('');
  const [payMethod,     setPayMethod]     = useState('cash');
  const [notes,         setNotes]         = useState('');
  const [busy,          setBusy]          = useState(false);
  const [showConfirm,   setShowConfirm]   = useState(false);
  const timerRef = useRef(null);

  const fetchAvail = useCallback(async (date) => {
    if (!date || date <= origOut) { setAvail(null); return; }
    setAvailLoading(true); setAvailErr('');
    try {
      const a = await extendAvailability(booking.id, date);
      setAvail(a);
      setSelectedType(a.same_type.room_type_id);
      const total = a.same_type.additional_total ?? (a.same_type.rate_sum + Math.round(a.same_type.rate_sum * a.original_tax_pct / 100));
      setPayAmount(String(total));
    } catch (e) { setAvailErr(e.message); setAvail(null); }
    finally { setAvailLoading(false); }
  }, [booking.id, origOut]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchAvail(newDate), 400);
    return () => clearTimeout(timerRef.current);
  }, [newDate, fetchAvail]);

  const isSameType   = avail && selectedType === avail.same_type.room_type_id;
  const selectedAlt  = avail?.alternatives?.find(a => a.room_type_id === selectedType);
  const isAvailable  = isSameType ? avail?.same_type?.available_all : selectedAlt?.fully_available;
  const canSubmit    = newDate > origOut && avail && isAvailable && !busy;
  const totalCharge  = avail
    ? (isSameType
        ? (avail.same_type.additional_total ?? avail.same_type.rate_sum)
        : (selectedAlt?.additional_total ?? selectedAlt?.rate_sum ?? 0))
    : 0;

  const handleSubmit = async () => {
    setBusy(true);
    try {
      await extendStay(booking.id, {
        new_checkout:        newDate,
        room_type_id:        !isSameType ? selectedType : undefined,
        additional_payment:  Number(payAmount) || 0,
        payment_method:      payMethod,
        notes,
      });
      notify('Stay extended successfully', 'success');
      onSuccess();
    } catch (e) { notify(e.message, 'error'); }
    finally { setBusy(false); setShowConfirm(false); }
  };

  // Highlight if extension nights have a rate > 20% above original nightly rate
  const origNightlyRate = booking.base_amount && booking.nights
    ? Number(booking.base_amount) / Number(booking.nights)
    : 0;
  const peakWarning = avail?.same_type?.nights?.some(n => origNightlyRate > 0 && n.rate > origNightlyRate * 1.2);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="New Checkout Date">
        <input
          type="date" value={newDate} min={minDate}
          onChange={e => setNewDate(e.target.value)}
          style={inputStyle}
        />
      </Field>

      {availLoading && <div style={{ fontSize: 12, color: '#888' }}>Checking availability…</div>}
      {availErr    && <div style={{ fontSize: 12, color: '#ef4444' }}>{availErr}</div>}

      {avail?.ota_warning && (
        <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={12} />
          OTA booking via <strong style={{ marginLeft: 3 }}>{avail.ota_source}</strong> — changes won't sync with the channel.
        </div>
      )}

      {peakWarning && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#0369a1' }}>
          Some extension nights are at a higher rate (peak / weekend pricing).
        </div>
      )}

      {/* Pricing breakdown — always for same_type */}
      {avail && <ExtensionPricingBreakdown avail={{ ...avail, same_type: avail.same_type }} booking={booking} />}

      {/* Alternative room types when same type unavailable */}
      {avail && !avail.same_type.available_all && avail.alternatives?.filter(a => a.fully_available).length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            Same room type unavailable — select an alternative:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {avail.alternatives.filter(a => a.fully_available).map(a => (
              <button
                key={a.room_type_id}
                onClick={() => { setSelectedType(a.room_type_id); setPayAmount(String(a.additional_total ?? a.rate_sum)); }}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '9px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  border: `1.5px solid ${selectedType === a.room_type_id ? '#3b82f6' : '#d1d5db'}`,
                  background: selectedType === a.room_type_id ? '#eff6ff' : '#fff',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>{rupee(a.additional_total ?? a.rate_sum)} total</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No availability */}
      {avail && !isAvailable && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#991b1b' }}>
          No rooms available for the selected extension dates.
        </div>
      )}

      {/* Payment fields — only when available */}
      {avail && isAvailable && (
        <>
          <Field label="Collect Now (₹)">
            <input
              type="number" min={0} value={payAmount}
              onChange={e => setPayAmount(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Payment Method">
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={inputStyle}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="upi">UPI</option>
            </select>
          </Field>
        </>
      )}

      <Field label="Notes">
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)}
          rows={2} placeholder="Optional notes…"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      <button
        onClick={() => setShowConfirm(true)}
        disabled={!canSubmit}
        style={ctaStyle(canSubmit, '#0ea5e9')}
      >
        <CalendarPlus size={15} /> Extend to {newDate || '…'}
      </button>

      {showConfirm && (
        <ConfirmModal
          title="Confirm Extension"
          body={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: '#444' }}>
              <div>New checkout: <strong>{newDate}</strong></div>
              <div>Additional charge: <strong>{rupee(totalCharge)}</strong></div>
              <div>Collect now: <strong>{rupee(payAmount || 0)}</strong> via {payMethod}</div>
              {!isSameType && <div style={{ color: '#3b82f6', fontSize: 12 }}>Room type will change to {selectedAlt?.name}.</div>}
            </div>
          }
          confirmLabel={busy ? 'Processing…' : 'Confirm Extension'}
          confirmColor="#0ea5e9"
          disabled={busy}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleSubmit}
        />
      )}
    </div>
  );
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────
const labelStyle = { fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 };
const inputStyle  = { padding: '7px 10px', border: '1.5px solid #d1d5db', borderRadius: 7, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const calcBoxStyle = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '13px 15px' };
const ctaStyle = (active, color) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '10px 20px', borderRadius: 8, border: 'none',
  background: active ? color : '#e5e7eb',
  color: active ? '#fff' : '#9ca3af',
  fontWeight: 700, fontSize: 14,
  cursor: active ? 'pointer' : 'default',
});

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value, bold, muted, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 12, color: muted ? '#9ca3af' : '#444' }}>
      <span>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: valueColor }}>{value}</span>
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, confirmColor, disabled, onCancel, onConfirm }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{title}</div>
        <div style={{ marginBottom: 20 }}>{body}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel} disabled={disabled}
            style={{ flex: 1, padding: '9px', borderRadius: 7, border: '1.5px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600 }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm} disabled={disabled}
            style={{ flex: 1, padding: '9px', borderRadius: 7, border: 'none', background: confirmColor, color: '#fff', fontWeight: 700, cursor: disabled ? 'default' : 'pointer' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CheckoutExtendPage({ onNavigate, navParams }) {
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);
  const [tab,      setTab]      = useState('early');
  const [listKey,  setListKey]  = useState(0);

  // Deep-link: auto-select booking from navParams
  useEffect(() => {
    const bookingId = navParams?.bookingId;
    if (!bookingId) return;
    apiFetch(`/api/admin/bookings/${bookingId}`)
      .then(data => { if (data?.id) setSelected(data); })
      .catch(() => {});
  }, [navParams?.bookingId]);

  useEffect(() => {
    if (navParams?.tab) setTab(navParams.tab);
  }, [navParams?.tab]);

  const handleSuccess = () => {
    setSelected(null);
    setListKey(k => k + 1);
  };

  const TABS = [
    { key: 'early',  label: 'Early Checkout', Icon: LogOut,       color: '#6366f1' },
    { key: 'extend', label: 'Extend Stay',     Icon: CalendarPlus, color: '#0ea5e9' },
  ];

  return (
    <div style={{ display: 'flex', height: '100%', background: '#f3f4f6', overflow: 'hidden' }}>
      {/* Left panel */}
      <div style={{ width: 320, minWidth: 260, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: '#111', margin: '0 0 10px 0' }}>Active Stays</h2>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Name, reference, phone…"
              style={{ width: '100%', padding: '6px 8px 6px 28px', border: '1.5px solid #d1d5db', borderRadius: 7, fontSize: 12, boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          <ActiveStaysList
            reload={listKey}
            onSelect={b => { setSelected(b); setTab('early'); }}
            selectedId={selected?.id}
            searchQuery={search}
          />
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        {!selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 280, color: '#d1d5db', gap: 12 }}>
            <LogOut size={40} />
            <div style={{ fontSize: 14, color: '#9ca3af' }}>Select a stay from the left to manage checkout or extension</div>
          </div>
        ) : (
          <div style={{ maxWidth: 900 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111', margin: 0 }}>
                {selected.guest} — #{selected.reference}
              </h2>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <StayCard b={selected} />

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 20px', border: 'none', background: 'transparent',
                    fontWeight: tab === t.key ? 700 : 400,
                    color: tab === t.key ? t.color : '#6b7280',
                    borderBottom: tab === t.key ? `2.5px solid ${t.color}` : '2.5px solid transparent',
                    cursor: 'pointer', fontSize: 13, marginBottom: -2,
                  }}
                >
                  <t.Icon size={14} /> {t.label}
                </button>
              ))}
            </div>

            {tab === 'early'  && <EarlyCheckoutForm  key={selected.id + '-early'}  booking={selected} onSuccess={handleSuccess} />}
            {tab === 'extend' && <ExtendStayForm      key={selected.id + '-extend'} booking={selected} onSuccess={handleSuccess} />}
          </div>
        )}
      </div>
    </div>
  );
}
