import { useState, useEffect } from "react";
import { dueCheckoutsToday, notifyGuestCheckout } from "../../api/client.js";

export default function DueCheckoutsWidget({ onNavigate }) {
  const [bookings, setBookings] = useState([]);
  const [sending, setSending]   = useState({});
  const [sentAt, setSentAt]     = useState({});

  const load = () => {
    dueCheckoutsToday()
      .then(rows => {
        setBookings(Array.isArray(rows) ? rows : []);
        const init = {};
        rows.forEach(b => {
          if (b.checkout_notification_sent_at) {
            const t = new Date(b.checkout_notification_sent_at);
            init[b.id] = t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
          }
        });
        setSentAt(init);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (!bookings.length) return null;

  const handleNotify = async (b) => {
    setSending(s => ({ ...s, [b.id]: true }));
    try {
      const res = await notifyGuestCheckout(b.id);
      const t = new Date(res.sent_at);
      setSentAt(s => ({ ...s, [b.id]: t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }));
      setBookings(prev => prev.map(bk => bk.id === b.id ? { ...bk, checkout_notification_sent_at: res.sent_at } : bk));
    } catch (e) {
      alert('Failed to send notification: ' + e.message);
    } finally {
      setSending(s => ({ ...s, [b.id]: false }));
    }
  };

  return (
    <div style={{
      background: '#fffbeb', border: '1.5px solid #fbbf24', borderRadius: 12,
      padding: '16px 20px', marginBottom: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>🔔</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#92400e' }}>
          {bookings.length} guest{bookings.length > 1 ? 's' : ''} checking out today
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bookings.map(b => (
          <div key={b.id} style={{
            background: '#fff', borderRadius: 8, padding: '10px 14px',
            border: '1px solid #fde68a', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#111' }}>{b.guest}</div>
              <div style={{ fontSize: 12, color: '#666' }}>
                {b.room}{b.room_number ? ` ${b.room_number}` : ''} · #{b.reference}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {sentAt[b.id] ? (
                <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                  ✓ Notified at {sentAt[b.id]}
                </span>
              ) : (
                <button
                  disabled={sending[b.id]}
                  onClick={() => handleNotify(b)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8,
                    background: sending[b.id] ? '#e5e7eb' : '#f59e0b', color: sending[b.id] ? '#9ca3af' : '#fff',
                    border: 'none', cursor: sending[b.id] ? 'default' : 'pointer',
                  }}
                >
                  {sending[b.id] ? 'Sending…' : 'Notify Guest'}
                </button>
              )}
              <button
                onClick={() => onNavigate('checkout-extend')}
                style={{
                  fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8,
                  background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', cursor: 'pointer',
                }}
              >
                Manage →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
