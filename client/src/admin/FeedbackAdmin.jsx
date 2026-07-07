import { useState, useEffect } from 'react';
import { apiFetch } from './adminContext.js';

function fmt(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function Stars({ n }) {
  if (!n) return <span style={{ color: '#ccc' }}>—</span>;
  return <span style={{ color: '#c9a96e', fontSize: 16 }}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;
}

export default function FeedbackAdmin() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/admin/feedback'),
      apiFetch('/api/admin/feedback/stats'),
    ]).then(([feedback, s]) => {
      setRows(Array.isArray(feedback) ? feedback : []);
      setStats(s);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = rows.filter(r => {
    if (fromDate && r.check_in < fromDate) return false;
    if (toDate && r.check_out > toDate) return false;
    return true;
  }).filter(r => r.submitted_at);

  const s = {
    page: { padding: '32px 36px', fontFamily: 'inherit' },
    h1: { fontSize: 22, color: '#1a3a4a', margin: '0 0 4px' },
    sub: { fontSize: 12, color: '#999', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 28 },
    cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16, marginBottom: 32 },
    card: { background: '#fff', border: '1px solid #e8e0d6', borderRadius: 8, padding: '18px 20px' },
    cardLabel: { fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#c9a96e', fontWeight: 700, marginBottom: 6 },
    cardVal: { fontSize: 28, fontWeight: 700, color: '#1a3a4a' },
    cardSub: { fontSize: 12, color: '#999', marginTop: 2 },
    filters: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' },
    input: { border: '1px solid #e0d8ce', borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', padding: '10px 12px', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#c9a96e', fontWeight: 700, borderBottom: '2px solid #f0ebe4' },
    td: { padding: '10px 12px', borderBottom: '1px solid #f5f0eb', color: '#333', verticalAlign: 'top' },
    comment: { fontSize: 12, color: '#777', fontStyle: 'italic', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' },
    empty: { textAlign: 'center', padding: '48px', color: '#bbb', fontSize: 14 },
    npsBar: { display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' },
    npsChip: (score) => ({
      background: score >= 9 ? '#dcfce7' : score >= 7 ? '#fef9c3' : '#fee2e2',
      color: score >= 9 ? '#166534' : score >= 7 ? '#92400e' : '#7f1d1d',
      borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 700,
    }),
  };

  const avg = (v) => v ? Number(v).toFixed(1) : '—';

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Guest Feedback</h1>
      <p style={s.sub}>Post-checkout satisfaction scores</p>

      {stats && (
        <div style={s.cards}>
          <div style={s.card}>
            <div style={s.cardLabel}>Responses</div>
            <div style={s.cardVal}>{stats.summary?.total_responses ?? 0}</div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>Overall</div>
            <div style={s.cardVal}>{avg(stats.summary?.avg_overall)}<span style={{ fontSize: 14, color: '#c9a96e' }}> / 5</span></div>
            <div style={s.cardSub}>avg rating</div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>Room</div>
            <div style={s.cardVal}>{avg(stats.summary?.avg_room)}<span style={{ fontSize: 14, color: '#c9a96e' }}> / 5</span></div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>Service</div>
            <div style={s.cardVal}>{avg(stats.summary?.avg_service)}<span style={{ fontSize: 14, color: '#c9a96e' }}> / 5</span></div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>Avg NPS</div>
            <div style={s.cardVal}>{avg(stats.summary?.avg_nps)}<span style={{ fontSize: 14, color: '#c9a96e' }}> / 10</span></div>
          </div>
        </div>
      )}

      {stats?.nps_distribution?.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e8e0d6', borderRadius: 8, padding: '18px 20px', marginBottom: 28 }}>
          <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#c9a96e', fontWeight: 700, marginBottom: 10 }}>NPS Distribution</div>
          <div style={s.npsBar}>
            {stats.nps_distribution.map(({ nps_score, cnt }) => (
              <div key={nps_score} style={s.npsChip(nps_score)}>
                {nps_score}: ×{cnt}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={s.filters}>
        <span style={{ fontSize: 12, color: '#999' }}>Filter by stay dates:</span>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={s.input} />
        <span style={{ color: '#ccc' }}>→</span>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={s.input} />
        {(fromDate || toDate) && (
          <button onClick={() => { setFromDate(''); setToDate(''); }}
            style={{ fontSize: 12, color: '#999', background: 'none', border: 'none', cursor: 'pointer' }}>
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div style={s.empty}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>No feedback submitted yet.</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Guest</th>
              <th style={s.th}>Stay Dates</th>
              <th style={s.th}>Overall</th>
              <th style={s.th}>Room</th>
              <th style={s.th}>Service</th>
              <th style={s.th}>NPS</th>
              <th style={s.th}>Comment</th>
              <th style={s.th}>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <>
                <tr key={r.id}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600, color: '#1a3a4a' }}>{r.guest_name}</div>
                    <div style={{ fontSize: 11, color: '#999' }}>{r.reference}</div>
                  </td>
                  <td style={s.td}>{fmt(r.check_in)} → {fmt(r.check_out)}</td>
                  <td style={s.td}><Stars n={r.rating_overall} /></td>
                  <td style={s.td}><Stars n={r.rating_room} /></td>
                  <td style={s.td}><Stars n={r.rating_service} /></td>
                  <td style={s.td}>
                    {r.nps_score !== null
                      ? <span style={s.npsChip(r.nps_score)}>{r.nps_score}</span>
                      : '—'}
                  </td>
                  <td style={s.td}>
                    {r.comments ? (
                      <div style={s.comment} title={r.comments}
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {r.comments}
                      </div>
                    ) : <span style={{ color: '#ccc' }}>—</span>}
                  </td>
                  <td style={s.td}>{fmt(r.submitted_at)}</td>
                </tr>
                {expanded === r.id && r.comments && (
                  <tr key={`${r.id}-exp`}>
                    <td colSpan={8} style={{ ...s.td, background: '#fafaf8', padding: '12px 20px' }}>
                      <div style={{ fontSize: 13, color: '#555', lineHeight: 1.7, fontStyle: 'italic' }}>"{r.comments}"</div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
