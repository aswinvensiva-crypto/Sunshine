import { useState, useEffect } from 'react';

const API = '';

function fmt(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
}

export default function CheckIn() {
  const token = window.location.pathname.split('/check-in/')[1]?.split('/')[0];
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ id_type: 'Aadhaar', id_number: '', address: '', estimated_arrival: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError('Invalid link.'); return; }
    fetch(`${API}/api/check-in/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        if (d.already_submitted) setDone(true);
        if (d.pre_checkin_data) {
          setForm(f => ({ ...f, ...d.pre_checkin_data }));
        }
        if (d.guest?.address) setForm(f => ({ ...f, address: d.guest.address || '' }));
      })
      .catch(() => setError('Unable to load check-in details.'));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.id_number.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/check-in/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Submission failed');
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const s = {
    wrap: { minHeight: '100vh', background: '#f5f0eb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'Georgia, serif' },
    card: { background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,.10)', maxWidth: 480, width: '100%', overflow: 'hidden' },
    head: { background: '#1a3a4a', padding: '32px 36px', textAlign: 'center' },
    h1: { color: '#c9a96e', margin: 0, fontSize: 26, letterSpacing: '.06em' },
    sub: { color: 'rgba(255,255,255,.6)', fontSize: 12, margin: '6px 0 0', letterSpacing: '.2em', textTransform: 'uppercase' },
    body: { padding: '32px 36px' },
    label: { fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#c9a96e', fontWeight: 700, display: 'block', marginBottom: 6 },
    input: { width: '100%', border: '1px solid #e0d8ce', borderRadius: 6, padding: '10px 12px', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 16 },
    select: { width: '100%', border: '1px solid #e0d8ce', borderRadius: 6, padding: '10px 12px', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 16, background: '#fff' },
    btn: { width: '100%', background: '#1a3a4a', color: '#c9a96e', border: 'none', borderRadius: 6, padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer', letterSpacing: '.04em' },
    info: { background: '#f5f0eb', borderRadius: 6, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#555' },
    row: { display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#555', marginBottom: 6 },
    success: { textAlign: 'center', padding: '48px 36px' },
    tick: { fontSize: 48, marginBottom: 12 },
    errBox: { background: '#fee2e2', border: '1px solid #dc2626', borderRadius: 6, padding: '14px 18px', color: '#7f1d1d', fontSize: 14, textAlign: 'center' },
  };

  if (error) return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.head}><h1 style={s.h1}>Sunshine</h1><p style={s.sub}>Pre-Arrival Check-In</p></div>
        <div style={s.body}><div style={s.errBox}>{error}</div></div>
      </div>
    </div>
  );

  if (!data) return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.head}><h1 style={s.h1}>Sunshine</h1></div>
        <div style={{ ...s.body, textAlign: 'center', color: '#999' }}>Loading…</div>
      </div>
    </div>
  );

  if (done) return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.head}><h1 style={s.h1}>Sunshine</h1><p style={s.sub}>Pre-Arrival Check-In</p></div>
        <div style={s.success}>
          <div style={s.tick}>✓</div>
          <h2 style={{ color: '#1a3a4a', margin: '0 0 8px' }}>Details Saved!</h2>
          <p style={{ color: '#555', fontSize: 14, lineHeight: 1.7 }}>
            Thank you, <strong>{data.guest.full_name}</strong>! We have your details.<br/>
            See you on <strong>{fmt(data.booking.check_in)}</strong> at Sunshine.
          </p>
          <p style={{ color: '#999', fontSize: 12, marginTop: 16 }}>Ref: {data.booking.reference}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.head}><h1 style={s.h1}>Sunshine</h1><p style={s.sub}>Pre-Arrival Check-In</p></div>
        <div style={s.body}>
          <div style={s.info}>
            <div style={s.row}><span>Guest</span><strong>{data.guest.full_name}</strong></div>
            <div style={s.row}><span>Room</span><strong>{data.booking.room_type}</strong></div>
            <div style={s.row}><span>Check-in</span><strong>{fmt(data.booking.check_in)}</strong></div>
            <div style={s.row}><span>Check-out</span><strong>{fmt(data.booking.check_out)}</strong></div>
          </div>
          <p style={{ fontSize: 13, color: '#777', marginBottom: 20 }}>
            Pre-fill your details to speed up check-in. Takes 30 seconds.
          </p>
          <form onSubmit={submit}>
            <label style={s.label}>ID Type</label>
            <select style={s.select} value={form.id_type} onChange={e => setForm(f => ({ ...f, id_type: e.target.value }))}>
              <option>Aadhaar</option>
              <option>Passport</option>
              <option>PAN Card</option>
              <option>Voter ID</option>
              <option>Driving Licence</option>
              <option>Other</option>
            </select>

            <label style={s.label}>ID Number</label>
            <input style={s.input} value={form.id_number} onChange={e => setForm(f => ({ ...f, id_number: e.target.value }))}
              placeholder="Enter your ID number" required />

            <label style={s.label}>Address</label>
            <input style={s.input} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Current address (optional)" />

            <label style={s.label}>Estimated Arrival Time</label>
            <input style={s.input} type="time" value={form.estimated_arrival}
              onChange={e => setForm(f => ({ ...f, estimated_arrival: e.target.value }))} />

            {error && <div style={{ ...s.errBox, marginBottom: 12 }}>{error}</div>}
            <button type="submit" style={s.btn} disabled={busy}>{busy ? 'Saving…' : 'Save My Details'}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
