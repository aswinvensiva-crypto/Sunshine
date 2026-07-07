import { useState, useEffect } from 'react';

const API = '';

function fmt(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
}

function StarPicker({ value, onChange, label }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#c9a96e', fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button"
            style={{ fontSize: 30, background: 'none', border: 'none', cursor: 'pointer', color: n <= (hover || value) ? '#c9a96e' : '#d1c4b0', padding: 0, lineHeight: 1 }}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
          >★</button>
        ))}
      </div>
    </div>
  );
}

export default function FeedbackPage() {
  const token = window.location.pathname.split('/feedback/')[1]?.split('/')[0];
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ rating_overall: 0, rating_room: 0, rating_service: 0, nps_score: 8, comments: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError('Invalid feedback link.'); return; }
    fetch(`${API}/api/feedback/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        if (d.submitted_at) setDone(true);
      })
      .catch(() => setError('Unable to load feedback form.'));
  }, [token]);

  // Pre-set rating from URL param (clicked star in email)
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('r');
    if (r && Number(r) >= 1 && Number(r) <= 5) {
      setForm(f => ({ ...f, rating_overall: Number(r) }));
    }
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.rating_overall) { setError('Please rate your overall experience.'); return; }
    setBusy(true); setError('');
    try {
      const r = await fetch(`${API}/api/feedback/${token}`, {
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
    card: { background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,.10)', maxWidth: 520, width: '100%', overflow: 'hidden' },
    head: { background: '#1a3a4a', padding: '32px 36px', textAlign: 'center' },
    h1: { color: '#c9a96e', margin: 0, fontSize: 26, letterSpacing: '.06em' },
    sub: { color: 'rgba(255,255,255,.6)', fontSize: 12, margin: '6px 0 0', letterSpacing: '.2em', textTransform: 'uppercase' },
    body: { padding: '32px 36px' },
    info: { background: '#f5f0eb', borderRadius: 6, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#555' },
    row: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },
    npsLabel: { fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#c9a96e', fontWeight: 700, marginBottom: 8 },
    slider: { width: '100%', marginBottom: 6, accentColor: '#1a3a4a' },
    textarea: { width: '100%', border: '1px solid #e0d8ce', borderRadius: 6, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', minHeight: 90, boxSizing: 'border-box', resize: 'vertical', marginBottom: 20 },
    btn: { width: '100%', background: '#1a3a4a', color: '#c9a96e', border: 'none', borderRadius: 6, padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer', letterSpacing: '.04em' },
    errBox: { background: '#fee2e2', border: '1px solid #dc2626', borderRadius: 6, padding: '12px 16px', color: '#7f1d1d', fontSize: 14, marginBottom: 16 },
    success: { textAlign: 'center', padding: '48px 36px' },
  };

  if (error && !data) return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.head}><h1 style={s.h1}>Sunshine</h1><p style={s.sub}>Guest Feedback</p></div>
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
        <div style={s.head}><h1 style={s.h1}>Sunshine</h1><p style={s.sub}>Guest Feedback</p></div>
        <div style={s.success}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🙏</div>
          <h2 style={{ color: '#1a3a4a', margin: '0 0 8px' }}>Thank You!</h2>
          <p style={{ color: '#555', fontSize: 14, lineHeight: 1.7 }}>
            Your feedback means the world to us, <strong>{data.full_name}</strong>.<br/>
            We hope to welcome you back to Sunshine soon.
          </p>
        </div>
      </div>
    </div>
  );

  const npsLabels = { 0: 'Not at all likely', 5: 'Neutral', 10: 'Extremely likely' };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.head}><h1 style={s.h1}>Sunshine</h1><p style={s.sub}>How was your stay?</p></div>
        <div style={s.body}>
          <div style={s.info}>
            <div style={s.row}><span>Guest</span><strong>{data.full_name}</strong></div>
            <div style={s.row}><span>Stay</span><strong>{fmt(data.check_in)} → {fmt(data.check_out)}</strong></div>
            <div style={s.row}><span>Room</span><strong>{data.room_type}</strong></div>
          </div>
          <form onSubmit={submit}>
            <StarPicker label="Overall Experience" value={form.rating_overall}
              onChange={v => setForm(f => ({ ...f, rating_overall: v }))} />
            <StarPicker label="Room Quality" value={form.rating_room}
              onChange={v => setForm(f => ({ ...f, rating_room: v }))} />
            <StarPicker label="Service" value={form.rating_service}
              onChange={v => setForm(f => ({ ...f, rating_service: v }))} />

            <div style={{ marginBottom: 20 }}>
              <div style={s.npsLabel}>How likely are you to recommend us? ({form.nps_score}/10)</div>
              <input type="range" min={0} max={10} step={1} value={form.nps_score}
                onChange={e => setForm(f => ({ ...f, nps_score: Number(e.target.value) }))}
                style={s.slider} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#999' }}>
                <span>0 — Not likely</span><span>10 — Definitely</span>
              </div>
            </div>

            <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#c9a96e', fontWeight: 700, marginBottom: 8 }}>Comments (optional)</div>
            <textarea style={s.textarea} value={form.comments}
              onChange={e => setForm(f => ({ ...f, comments: e.target.value }))}
              placeholder="Tell us what you loved or how we can improve…" />

            {error && <div style={s.errBox}>{error}</div>}
            <button type="submit" style={s.btn} disabled={busy}>{busy ? 'Submitting…' : 'Submit Feedback'}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
