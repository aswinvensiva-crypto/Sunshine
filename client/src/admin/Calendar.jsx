/**
 * Calendar.jsx — PMS Tape Chart
 *
 * Layout:
 *   Root = calc(100vh - 56px)
 *   ┌── Toolbar  (44px)
 *   ├── Legend   (28px)
 *   └── Grid zone (flex-1)
 *       ├── Left panel  (168px) — corner + room sidebar (synced Y)
 *       └── Right panel (flex-1) — date header (synced X) + grid body (scroll driver)
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  ChevronLeft, ChevronRight, X, AlertCircle,
  Upload, CheckCircle, User, FileText, CreditCard, RefreshCw, Flag,
} from 'lucide-react';

/* ─── Layout constants ──────────────────────────────────────── */
const DAY_W   = 120;
const ROW_H   = 40;
const DAYS    = 14;
const SIDEBAR = 168;
const HDR_H   = 80;
const TOPBAR  = 56;
const TOOLBAR = 44;
const LEGEND  = 28;

/* ─── API ───────────────────────────────────────────────────── */
const API   = 'http://localhost:5001/api';
const SOCK  = 'http://localhost:5001';
const TOKEN = () => localStorage.getItem('ma_token') || localStorage.getItem('adminToken') || '';

/* ─── OTA badge — derive color from source string hash ─────── */
const OTA_PALETTE = [
  '#059669','#2563eb','#dc2626','#ea580c','#7c3aed',
  '#0891b2','#65a30d','#d97706','#db2777',
];
function otaColor(src) {
  if (!src) return '#6b7280';
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
  return OTA_PALETTE[h % OTA_PALETTE.length];
}
function otaLabel(src) {
  if (!src) return '—';
  const known = { 'Direct':'DIR','Booking.com':'BDC','Agoda':'AGD','MakeMyTrip':'MMT','Expedia':'EXP','Airbnb':'ABB','Goibibo':'GIB' };
  return known[src] || src.slice(0, 3).toUpperCase();
}

/* ─── Room-status badge styles ──────────────────────────────── */
const STATUS_STYLE = {
  'Vacant Clean':       { bg:'#f0fdf4', color:'#15803d', border:'#86efac' },
  'Dirty':              { bg:'#fffbeb', color:'#b45309', border:'#fcd34d' },
  'Stay-Over Refresh':  { bg:'#f0f9ff', color:'#0369a1', border:'#7dd3fc' },
  'Maintenance Outage': { bg:'#fef2f2', color:'#b91c1c', border:'#fca5a5' },
};
const getStatusStyle = s => STATUS_STYLE[s] || { bg:'#f9fafb', color:'#6b7280', border:'#d1d5db' };

/* ─── Booking block colour by status ───────────────────────── */
function blockBg(status) {
  if (status === 'checked_in')  return '#3b82f6';
  if (status === 'checked_out') return '#9ca3af';
  if (status === 'no_show')     return '#f43f5e';
  return '#14b8a6';
}

/* ─── GST cap + surge pricing ───────────────────────────────── */
function surgeRate(basePrice, occPct) {
  let p = Number(basePrice);
  if (occPct >= 80)      p = Math.round(p * 1.30);
  else if (occPct >= 60) p = Math.round(p * 1.15);
  else if (occPct >= 40) p = Math.round(p * 1.05);
  if (p >= 7500 && p <= 8200) p = 7499;
  return p;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/* ─── Date helpers ──────────────────────────────────────────── */
const toISO    = d  => new Date(d).toISOString().split('T')[0];
const addDays  = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
const fmtPretty = d => d
  ? new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
  : '—';

/* ═══════════════════════════════════════════════════════════
   ROOT COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function CalendarView() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d;
  });
  const [rooms,     setRooms]     = useState([]);
  const [bookings,  setBookings]  = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [occMap,    setOccMap]    = useState({});
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const [selected,      setSelected]      = useState(null);
  const [drawerTab,     setDrawerTab]     = useState('details');
  const [formCDone,     setFormCDone]     = useState(false);
  const [gstinVal,      setGstinVal]      = useState('');
  const [gstinOk,       setGstinOk]       = useState(false);
  const [actionMsg,     setActionMsg]     = useState(null);

  const [dragging,     setDragging]     = useState(null);
  const [dropTarget,   setDropTarget]   = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const bodyRef    = useRef(null);
  const headerRef  = useRef(null);
  const sidebarRef = useRef(null);
  const socketRef  = useRef(null);

  const today     = useMemo(() => toISO(new Date()), []);
  const dateRange = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => addDays(startDate, i)),
    [startDate],
  );

  /* ── synced scroll ──────────────────────────────────────── */
  const onBodyScroll = useCallback(() => {
    const b = bodyRef.current;
    if (!b) return;
    if (headerRef.current)  headerRef.current.scrollLeft = b.scrollLeft;
    if (sidebarRef.current) sidebarRef.current.scrollTop = b.scrollTop;
  }, []);

  /* ── socket.io ──────────────────────────────────────────── */
  useEffect(() => {
    let socket;
    import('socket.io-client').then(({ io }) => {
      socket = io(SOCK, { auth: { token: TOKEN() }, transports: ['websocket','polling'] });
      socketRef.current = socket;
      socket.on('ROOM_SWAP_BROADCAST', ({ booking }) =>
        setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, ...booking } : b)),
      );
      socket.on('ROOM_SWAP_ERROR', ({ message }) => setError(`Swap rejected: ${message}`));
    }).catch(() => {});
    return () => { socket?.disconnect(); socketRef.current = null; };
  }, []);

  /* ── fetch ──────────────────────────────────────────────── */
  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `${API}/admin/calendar?start=${toISO(startDate)}&days=${DAYS}`,
        { headers: { Authorization: `Bearer ${TOKEN()}` } },
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
      }
      const data = await res.json();
      const roomList    = data.rooms    || [];
      const bookingList = data.bookings || [];
      setRooms(roomList);
      setBookings(bookingList);
      setStatusMap(data.roomStatuses || {});

      const occ = {};
      dateRange.forEach(d => {
        const iso = toISO(d);
        occ[iso] = bookingList.filter(b =>
          toISO(b.check_in) <= iso && toISO(b.check_out) > iso && b.status !== 'cancelled',
        ).length;
      });
      setOccMap(occ);
    } catch (e) {
      const msg = e.message === 'Failed to fetch'
        ? 'Cannot reach the server — make sure the backend is running on port 5001.'
        : `Failed to load calendar data — ${e.message}`;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [startDate, dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── room grouping — dynamic, order follows backend sort ── */
  const roomsSorted = rooms; // backend already orders by room_type_id then room_number

  const typeOrder = useMemo(() => {
    const seen = new Set();
    const order = [];
    roomsSorted.forEach(r => {
      const t = r.room_type || 'Other';
      if (!seen.has(t)) { seen.add(t); order.push(t); }
    });
    return order;
  }, [roomsSorted]);

  const groupedRooms = useMemo(() => {
    const g = {};
    roomsSorted.forEach((r, idx) => {
      const t = r.room_type || 'Other';
      if (!g[t]) g[t] = [];
      g[t].push({ ...r, rowIndex: idx });
    });
    return g;
  }, [roomsSorted]);

  const totalRooms = roomsSorted.length || 1;
  const gridW = DAYS * DAY_W;

  /* pixel Y of each room in the grid — mirrors the sidebar layout (type headers + rows) */
  const GROUP_H = 22;
  const rowTopMap = useMemo(() => {
    const map = {};
    let y = 0;
    typeOrder.filter(t => groupedRooms[t]).forEach(type => {
      y += GROUP_H;
      groupedRooms[type].forEach(room => { map[room.id] = y; y += ROW_H; });
    });
    return map;
  }, [typeOrder, groupedRooms]);

  const gridH = useMemo(() => {
    let h = 0;
    typeOrder.filter(t => groupedRooms[t]).forEach(type => {
      h += GROUP_H;
      h += groupedRooms[type].length * ROW_H;
    });
    return h;
  }, [typeOrder, groupedRooms]);

  /* ── drag handlers ──────────────────────────────────────── */
  const onDragStart = useCallback((e, booking) => {
    setDragging(booking);
    e.dataTransfer.effectAllowed = 'move';
    const ghost = document.createElement('div');
    ghost.style.cssText = 'position:fixed;top:-999px;opacity:0';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => ghost.remove(), 0);
  }, []);

  const onDragEnd = useCallback(() => { setDragging(null); setDropTarget(null); }, []);

  const onCellDragOver = useCallback((e, roomId, iso) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    setDropTarget({ roomId, iso });
  }, []);

  const onCellDrop = useCallback((e, targetRoomId, targetIso) => {
    e.preventDefault(); setDropTarget(null);
    if (!dragging) return;
    const delta  = diffDays(targetIso, toISO(dragging.check_in));
    const nights = diffDays(dragging.check_out, dragging.check_in);
    const newCI  = toISO(addDays(dragging.check_in, delta));
    const newCO  = toISO(addDays(newCI, nights));
    if (targetRoomId === dragging.room_id && newCI === toISO(dragging.check_in)) {
      setDragging(null); return;
    }
    setConfirmModal({ booking: dragging, newRoomId: targetRoomId, newCheckIn: newCI, newCheckOut: newCO });
    setDragging(null);
  }, [dragging]);

  /* ── swap execution ─────────────────────────────────────── */
  const executeSwap = useCallback(async (modal) => {
    const { booking, newRoomId, newCheckIn, newCheckOut } = modal;
    setConfirmModal(null);
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('ROOM_SWAP_REQUEST', { bookingId: booking.id, newRoomId, newCheckIn, newCheckOut });
    } else {
      try {
        const r = await fetch(`${API}/admin/calendar/swap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
          body: JSON.stringify({ bookingId: booking.id, newRoomId, newCheckIn, newCheckOut }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        fetchData();
      } catch (e) { setError(`Swap failed: ${e.message}`); }
    }
  }, [fetchData]);

  /* ── drawer ─────────────────────────────────────────────── */
  const drawerMode = useMemo(() => {
    if (!selected) return null;
    if (toISO(selected.check_in) === today && selected.status === 'confirmed') return 'checkin';
    if (toISO(selected.check_out) === today && selected.status === 'checked_in') return 'checkout';
    return 'view';
  }, [selected, today]);

  const openDrawer = useCallback((booking) => {
    setSelected(booking);
    setDrawerTab('details');
    setFormCDone(!!booking.is_form_c_submitted);
    setGstinVal(booking.corporate_gstin || '');
    setGstinOk(GSTIN_RE.test(booking.corporate_gstin || ''));
    setActionMsg(null);
  }, []);

  const handleGstin = v => {
    const val = v.toUpperCase().slice(0, 15);
    setGstinVal(val); setGstinOk(GSTIN_RE.test(val));
  };

  const canCheckin = selected && (
    (selected.nationality === 'Indian' || formCDone) &&
    (!selected.corporate_gstin || gstinOk)
  );

  const doCheckin = async () => {
    if (!selected) return;
    try {
      const r = await fetch(`${API}/admin/bookings/${selected.id}/checkin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({ is_form_c_submitted: formCDone, corporate_gstin: gstinOk ? gstinVal : undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Check-in failed');
      setActionMsg({ ok: true, text: 'Guest checked in successfully.' });
      fetchData();
    } catch (e) { setActionMsg({ ok: false, text: e.message }); }
  };

  const doCheckout = async () => {
    if (!selected) return;
    try {
      const r = await fetch(`${API}/admin/bookings/${selected.id}/checkout`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN()}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Checkout failed');
      setActionMsg({ ok: true, text: 'Checked out. Invoice generated.' });
      fetchData();
    } catch (e) { setActionMsg({ ok: false, text: e.message }); }
  };

  /* ══════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════ */
  return (
    <div style={{ height:`calc(100vh - ${TOPBAR}px)`, display:'flex', flexDirection:'column', background:'#f3f4f6', fontFamily:'Inter,system-ui,sans-serif', overflow:'hidden' }}>

      {/* TOOLBAR */}
      <div style={{ height:TOOLBAR, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', background:'#fff', borderBottom:'1px solid #e5e7eb', boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontWeight:700, fontSize:15, color:'#1f2937' }}>Tape Chart</span>
          <span style={{ fontSize:12, color:'#9ca3af' }}>
            {dateRange[0]?.toLocaleDateString('en-IN', { day:'numeric', month:'short' })}
            {' — '}
            {dateRange[DAYS-1]?.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
          </span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <button onClick={fetchData} title="Refresh" style={iconBtn}><RefreshCw size={14} /></button>
          <button onClick={() => setStartDate(d => addDays(d, -7))} style={iconBtn}><ChevronLeft size={17} /></button>
          <button
            onClick={() => { const d = new Date(); d.setHours(0,0,0,0); setStartDate(d); }}
            style={{ padding:'5px 12px', fontSize:12, fontWeight:600, background:'#4f46e5', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>
            Today
          </button>
          <button onClick={() => setStartDate(d => addDays(d, 7))} style={iconBtn}><ChevronRight size={17} /></button>
        </div>
      </div>

      {/* ERROR BANNER */}
      {error && (
        <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:8, padding:'6px 16px', background:'#fef2f2', borderBottom:'1px solid #fecaca', color:'#b91c1c', fontSize:12 }}>
          <AlertCircle size={13} />
          <span style={{ flex:1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#b91c1c' }}><X size={13} /></button>
        </div>
      )}

      {/* LEGEND */}
      <div style={{ flexShrink:0, height:LEGEND, display:'flex', alignItems:'center', gap:16, padding:'0 16px', background:'#fff', borderBottom:'1px solid #f3f4f6', fontSize:11 }}>
        {[['#14b8a6','Confirmed'],['#3b82f6','Checked-In'],['#9ca3af','Checked-Out'],['#f43f5e','No-Show']].map(([c,l]) => (
          <span key={l} style={{ display:'flex', alignItems:'center', gap:5, color:'#6b7280' }}>
            <span style={{ width:10, height:10, borderRadius:2, background:c, flexShrink:0 }} />{l}
          </span>
        ))}
        <span style={{ display:'flex', alignItems:'center', gap:5, color:'#6b7280' }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:'#f87171', flexShrink:0 }} />Balance due
        </span>
        <span style={{ marginLeft:8, color:'#d97706', fontWeight:600 }}>⚠ = GST cap at ₹7,499</span>
      </div>

      {/* GRID ZONE */}
      {loading ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
          <div style={{ width:36, height:36, border:'3px solid #4f46e5', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
          <span style={{ fontSize:13, color:'#6b7280' }}>Loading tape chart…</span>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : rooms.length === 0 ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8 }}>
          <span style={{ fontSize:32 }}>🏨</span>
          <span style={{ fontWeight:700, fontSize:15, color:'#374151' }}>No rooms configured</span>
          <span style={{ fontSize:13, color:'#9ca3af' }}>Add rooms in the database to see the tape chart.</span>
        </div>
      ) : (
        <div style={{ flex:1, overflow:'hidden', display:'flex' }}>

          {/* LEFT PANEL */}
          <div style={{ width:SIDEBAR, flexShrink:0, display:'flex', flexDirection:'column', background:'#fff', borderRight:'1px solid #e5e7eb', boxShadow:'2px 0 6px rgba(0,0,0,.06)', zIndex:20 }}>
            <div style={{ height:HDR_H, flexShrink:0, display:'flex', alignItems:'flex-end', padding:'0 12px 10px', background:'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
              <span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#9ca3af' }}>Rooms</span>
            </div>
            <div ref={sidebarRef} style={{ flex:1, overflow:'hidden' }}>
              {typeOrder.filter(t => groupedRooms[t]).map(type => (
                <div key={type}>
                  <div style={{ height:22, display:'flex', alignItems:'center', padding:'0 12px', background:'#f3f4f6', borderBottom:'1px solid #e5e7eb' }}>
                    <span style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', color:'#9ca3af' }}>{type}</span>
                  </div>
                  {groupedRooms[type].map(room => {
                    const s  = statusMap[room.id] || 'Vacant Clean';
                    const ss = getStatusStyle(s);
                    return (
                      <div key={room.id} style={{ height:ROW_H, borderBottom:'1px solid #f3f4f6', display:'flex', flexDirection:'column', justifyContent:'center', padding:'0 12px', gap:4 }}>
                        <span style={{ fontSize:13, fontWeight:700, color:'#1f2937' }}>#{room.room_number}</span>
                        <span style={{ fontSize:9, fontWeight:600, padding:'1px 6px', borderRadius:4, border:`1px solid ${ss.border}`, background:ss.bg, color:ss.color, width:'fit-content' }}>{s}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div style={{ height:1 }} />
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

            {/* DATE HEADER */}
            <div ref={headerRef} style={{ height:HDR_H, flexShrink:0, overflowX:'hidden', overflowY:'hidden', borderBottom:'1px solid #e5e7eb', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
              <div style={{ display:'flex', width:gridW, height:HDR_H }}>
                {dateRange.map(date => {
                  const iso     = toISO(date);
                  const occ     = occMap[iso] || 0;
                  const pct     = Math.round((occ / totalRooms) * 100);
                  const bp      = roomsSorted[0]?.base_price || 3000;
                  const rate    = surgeRate(bp, pct);
                  const capped  = rate === 7499;
                  const isToday = iso === today;
                  const occColor = pct >= 80 ? '#dc2626' : pct >= 60 ? '#d97706' : '#16a34a';
                  const occBg   = pct >= 80 ? '#fef2f2' : pct >= 60 ? '#fffbeb' : '#f0fdf4';
                  return (
                    <div key={iso} style={{ width:DAY_W, minWidth:DAY_W, flexShrink:0, borderRight:'1px solid #e5e7eb', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3, background:isToday ? '#eef2ff' : '#fff' }}>
                      <span style={{ fontSize:11, fontWeight:700, color:isToday ? '#4338ca' : '#374151' }}>
                        {date.toLocaleDateString('en-IN', { weekday:'short' })}, {date.toLocaleDateString('en-IN', { month:'short' })} {date.getDate()}
                      </span>
                      <span style={{ fontSize:10, fontWeight:600, padding:'1px 7px', borderRadius:20, background:occBg, color:occColor }}>{pct}% occ</span>
                      <span style={{ fontSize:10, color:'#6b7280', fontWeight:500 }}>
                        ₹{rate.toLocaleString('en-IN')}
                        {capped && <span style={{ color:'#d97706', marginLeft:2 }} title="GST cap applied">⚠</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* GRID BODY */}
            <div ref={bodyRef} onScroll={onBodyScroll} style={{ flex:1, overflow:'auto', position:'relative' }}>
              <div style={{ position:'relative', width:gridW, height:gridH, minWidth:gridW }}>

                {/* Row backgrounds + drop zones */}
                {roomsSorted.map((room) => (
                  <div key={room.id} style={{ position:'absolute', top:rowTopMap[room.id], left:0, width:'100%', height:ROW_H, borderBottom:'1px solid #f3f4f6', display:'flex' }}>
                    {dateRange.map(date => {
                      const iso      = toISO(date);
                      const isTarget = dropTarget?.roomId === room.id && dropTarget?.iso === iso;
                      const isToday  = iso === today;
                      return (
                        <div
                          key={iso}
                          style={{ width:DAY_W, minWidth:DAY_W, flexShrink:0, borderRight:'1px solid #f3f4f6', height:'100%', background:isTarget ? 'rgba(99,102,241,.15)' : isToday ? 'rgba(99,102,241,.04)' : 'transparent', transition:'background .1s' }}
                          onDragOver={e => onCellDragOver(e, room.id, iso)}
                          onDrop={e => onCellDrop(e, room.id, iso)}
                        />
                      );
                    })}
                  </div>
                ))}

                {/* Today line */}
                {(() => {
                  const off = diffDays(today, toISO(startDate));
                  if (off < 0 || off >= DAYS) return null;
                  return <div style={{ position:'absolute', top:0, bottom:0, left:off*DAY_W + DAY_W/2, width:2, background:'#818cf8', zIndex:5, pointerEvents:'none' }} />;
                })()}

                {/* Reservation blocks */}
                {bookings.map(booking => {
                  const roomTop = rowTopMap[booking.room_id];
                  if (roomTop === undefined) return null;
                  const rawLeft = diffDays(toISO(booking.check_in), toISO(startDate));
                  const nights  = diffDays(booking.check_out, booking.check_in);
                  const vStart  = Math.max(0, rawLeft);
                  const vEnd    = Math.min(DAYS, rawLeft + nights);
                  if (vEnd <= 0 || vStart >= DAYS || vEnd <= vStart) return null;

                  const lx = vStart * DAY_W + 2;
                  const w  = (vEnd - vStart) * DAY_W - 4;
                  const ty = roomTop + 8;
                  const ht = ROW_H - 16;

                  const bg     = blockBg(booking.status);
                  const hasBal = Number(booking.ledger_balance) > 0;
                  const isDrag = dragging?.id === booking.id;
                  const isSel  = selected?.id === booking.id;
                  const oc     = otaColor(booking.ota_source);
                  const ol     = otaLabel(booking.ota_source);

                  return (
                    <div
                      key={booking.id}
                      draggable
                      onDragStart={e => onDragStart(e, booking)}
                      onDragEnd={onDragEnd}
                      onClick={e => { e.stopPropagation(); openDrawer(booking); }}
                      title={`${booking.guest_name} · ${booking.ota_source || 'Direct'} · ${toISO(booking.check_in)} → ${toISO(booking.check_out)}`}
                      style={{
                        position:'absolute', left:lx, top:ty, width:w, height:ht, zIndex:10,
                        background:bg, borderRadius:5, border:`1px solid ${bg}cc`,
                        boxShadow:isSel ? `0 0 0 2px #fff,0 0 0 4px ${bg}` : '0 1px 3px rgba(0,0,0,.2)',
                        display:'flex', alignItems:'center', gap:5, padding:'0 8px',
                        cursor:'grab', opacity:isDrag ? 0.4 : 1, transition:'opacity .1s',
                        overflow:'hidden', userSelect:'none',
                      }}>
                      <span style={{ fontSize:9, fontWeight:700, padding:'2px 5px', borderRadius:3, background:oc, color:'#fff', flexShrink:0 }}>{ol}</span>
                      <span style={{ fontSize:11, fontWeight:600, color:'#fff', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{booking.guest_name}</span>
                      {booking.sr_type && (
                        <Flag size={10} color="#fbbf24" fill="#fbbf24" style={{ flexShrink:0 }} title={`Approved: ${booking.sr_type === 'early_checkin' ? 'Early Check-In' : 'Late Check-Out'} at ${booking.sr_time}`} />
                      )}
                      {hasBal && <span style={{ width:7, height:7, borderRadius:'50%', background:'#f87171', flexShrink:0 }} title={`Due: ₹${Number(booking.ledger_balance).toLocaleString('en-IN')}`} />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* BOOKING DRAWER */}
          {selected && (
            <BookingDrawer
              booking={selected}
              drawerMode={drawerMode}
              drawerTab={drawerTab}
              setDrawerTab={setDrawerTab}
              formCDone={formCDone} setFormCDone={setFormCDone}
              gstinVal={gstinVal} handleGstin={handleGstin} gstinOk={gstinOk}
              canCheckin={canCheckin}
              actionMsg={actionMsg}
              onClose={() => { setSelected(null); setActionMsg(null); }}
              onCheckin={doCheckin}
              onCheckout={doCheckout}
            />
          )}
        </div>
      )}

      {/* SWAP CONFIRM MODAL */}
      {confirmModal && (
        <SwapModal
          modal={confirmModal}
          rooms={roomsSorted}
          onConfirm={() => executeSwap(confirmModal)}
          onCancel={() => { setConfirmModal(null); fetchData(); }}
        />
      )}
    </div>
  );
}

/* ─── icon button style ─────────────────────────────────────── */
const iconBtn = {
  padding:'5px 7px', background:'none', border:'1px solid #e5e7eb',
  borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', color:'#6b7280',
};

/* ═══════════════════════════════════════════════════════════
   BOOKING DRAWER
   ═══════════════════════════════════════════════════════════ */
function SpecialReqCard({ booking }) {
  if (!booking.sr_type) return null;
  const label = booking.sr_type === 'early_checkin' ? 'Early Check-In' : 'Late Check-Out';
  const time  = booking.sr_time ? booking.sr_time.slice(0, 5) : '—';
  const fee   = Number(booking.sr_fee || 0);
  return (
    <div style={{ padding:12, borderRadius:8, border:'1px solid #fde68a', background:'#fffbeb', display:'flex', flexDirection:'column', gap:6 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <Flag size={13} color="#d97706" fill="#d97706" />
        <span style={{ fontSize:12, fontWeight:700, color:'#92400e' }}>Approved Special Request</span>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#374151' }}>
        <span>Type</span><span style={{ fontWeight:600 }}>{label}</span>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#374151' }}>
        <span>Requested Time</span><span style={{ fontWeight:600 }}>{time}</span>
      </div>
      {fee > 0 && (
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#374151' }}>
          <span>Fee</span><span style={{ fontWeight:600 }}>₹{fee.toLocaleString('en-IN')}</span>
        </div>
      )}
      {booking.sr_notes && (
        <div style={{ fontSize:11, color:'#78350f', marginTop:2, fontStyle:'italic' }}>"{booking.sr_notes}"</div>
      )}
    </div>
  );
}

function BookingDrawer({ booking, drawerMode, drawerTab, setDrawerTab, formCDone, setFormCDone, gstinVal, handleGstin, gstinOk, canCheckin, actionMsg, onClose, onCheckin, onCheckout }) {
  const nights = diffDays(booking.check_out, booking.check_in);
  const base   = Number(booking.base_rate || 0);
  const total  = Number(booking.total_amount || 0);
  const tax    = total - base * nights;
  const tabLabel = drawerMode === 'checkin' ? 'Check-In' : drawerMode === 'checkout' ? 'Check-Out' : 'Actions';

  return (
    <div style={{ width:360, flexShrink:0, display:'flex', flexDirection:'column', background:'#fff', borderLeft:'1px solid #e5e7eb', boxShadow:'-4px 0 16px rgba(0,0,0,.08)' }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid #f3f4f6', background:'#f9fafb', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:14, color:'#111827' }}>{booking.guest_name}</div>
          <div style={{ fontSize:11, color:'#9ca3af', marginTop:1 }}>Ref: {booking.reference || `#${booking.id}`}</div>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', padding:4, borderRadius:6, display:'flex', alignItems:'center', color:'#6b7280' }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ display:'flex', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
        {[['details','Details',User],['folio','Folio',FileText],['action',tabLabel,CreditCard]].map(([k,l,Icon]) => (
          <button key={k} onClick={() => setDrawerTab(k)} style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:5, padding:'9px 4px', fontSize:11, fontWeight:600, border:'none', cursor:'pointer', borderBottom:drawerTab===k ? '2px solid #4f46e5' : '2px solid transparent', color:drawerTab===k ? '#4f46e5' : '#6b7280', background:drawerTab===k ? '#eef2ff' : '#fff' }}>
            <Icon size={12} />{l}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:16 }}>

        {drawerTab === 'details' && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <SpecialReqCard booking={booking} />
            {[
              ['Room',      `#${booking.room_number || booking.room_id}`],
              ['Status',    <StatusChip key="s" s={booking.status} />],
              ['Check-In',  fmtPretty(booking.check_in)],
              ['Check-Out', fmtPretty(booking.check_out)],
              ['Nights',    nights],
              ['Source',    <OtaChip key="o" src={booking.ota_source} />],
              booking.nationality && ['Nationality', booking.nationality],
              booking.phone       && ['Phone', booking.phone],
              booking.email       && ['Email', booking.email],
              booking.corporate_gstin && ['GSTIN', <code key="g" style={{ fontSize:11 }}>{booking.corporate_gstin}</code>],
            ].filter(Boolean).map(([label, value]) => (
              <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13, gap:8 }}>
                <span style={{ color:'#6b7280', flexShrink:0 }}>{label}</span>
                <span style={{ color:'#111827', fontWeight:500, textAlign:'right', wordBreak:'break-all' }}>{value}</span>
              </div>
            ))}
          </div>
        )}

        {drawerTab === 'folio' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse', background:'#f9fafb', borderRadius:8, overflow:'hidden', border:'1px solid #e5e7eb' }}>
              <thead>
                <tr style={{ background:'#f3f4f6', borderBottom:'1px solid #e5e7eb' }}>
                  <th style={{ textAlign:'left', padding:'8px 12px', color:'#6b7280', fontWeight:600 }}>Item</th>
                  <th style={{ textAlign:'right', padding:'8px 12px', color:'#6b7280', fontWeight:600 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                  <td style={{ padding:'8px 12px', color:'#374151' }}>Room ({nights}N × ₹{base.toLocaleString('en-IN')})</td>
                  <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:500 }}>₹{(base*nights).toLocaleString('en-IN')}</td>
                </tr>
                <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
                  <td style={{ padding:'8px 12px', color:'#374151' }}>GST ({booking.gst_rate || 0}%)</td>
                  <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:500 }}>₹{Math.max(0,tax).toLocaleString('en-IN')}</td>
                </tr>
                <tr style={{ background:'#eef2ff' }}>
                  <td style={{ padding:'10px 12px', fontWeight:700, color:'#111827' }}>Total</td>
                  <td style={{ padding:'10px 12px', textAlign:'right', fontWeight:700, color:'#4338ca', fontSize:14 }}>₹{total.toLocaleString('en-IN')}</td>
                </tr>
              </tbody>
            </table>
            {Number(booking.ledger_balance) > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:10, background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:12, color:'#b91c1c' }}>
                <AlertCircle size={13} />Outstanding: <strong>₹{Number(booking.ledger_balance).toLocaleString('en-IN')}</strong>
              </div>
            )}
          </div>
        )}

        {drawerTab === 'action' && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <SpecialReqCard booking={booking} />
            {actionMsg && (
              <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:10, background:actionMsg.ok ? '#f0fdf4' : '#fef2f2', border:`1px solid ${actionMsg.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius:8, fontSize:12, color:actionMsg.ok ? '#15803d' : '#b91c1c' }}>
                {actionMsg.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                {actionMsg.text}
              </div>
            )}
            {drawerMode === 'checkin' && (
              <CheckInWizard booking={booking} formCDone={formCDone} setFormCDone={setFormCDone} gstinVal={gstinVal} handleGstin={handleGstin} gstinOk={gstinOk} canCheckin={canCheckin} onCheckin={onCheckin} />
            )}
            {drawerMode === 'checkout' && (
              <CheckOutPane booking={booking} nights={nights} base={base} tax={tax} total={total} onCheckout={onCheckout} />
            )}
            {drawerMode === 'view' && (
              <div style={{ textAlign:'center', padding:'32px 0', color:'#9ca3af', fontSize:13 }}>
                <User size={28} style={{ margin:'0 auto 8px', opacity:0.3 }} />
                <div>No action required today.</div>
                <div style={{ fontSize:11, marginTop:4 }}>Check-in appears on arrival day; check-out on departure day.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Check-In Wizard ───────────────────────────────────────── */
function CheckInWizard({ booking, formCDone, setFormCDone, gstinVal, handleGstin, gstinOk, canCheckin, onCheckin }) {
  const needFormC = booking.nationality !== 'Indian';
  const needGstin = !!booking.corporate_gstin;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ fontWeight:600, fontSize:14, color:'#111827' }}>Process Check-In</div>
      {needFormC && (
        <div style={{ padding:12, borderRadius:8, border:`1px solid ${formCDone ? '#bbf7d0' : '#fcd34d'}`, background:formCDone ? '#f0fdf4' : '#fffbeb' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <span style={{ fontSize:12, fontWeight:600, color:'#374151' }}>Form C — Foreign National ({booking.nationality})</span>
            {formCDone && <CheckCircle size={14} color="#16a34a" />}
          </div>
          {!formCDone ? (
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 10px', background:'#d97706', color:'#fff', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 }}>
              <input type="file" accept=".pdf,image/*" style={{ display:'none' }} onChange={() => setFormCDone(true)} />
              <Upload size={12} /> Upload Form C
            </label>
          ) : (
            <span style={{ fontSize:12, color:'#16a34a', fontWeight:600 }}>Form C uploaded ✓</span>
          )}
        </div>
      )}
      {needGstin && (
        <div style={{ padding:12, borderRadius:8, border:`1px solid ${gstinOk ? '#bbf7d0' : '#e5e7eb'}`, background:gstinOk ? '#f0fdf4' : '#f9fafb' }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:6 }}>Corporate GSTIN</div>
          <input
            type="text" value={gstinVal} maxLength={15}
            onChange={e => handleGstin(e.target.value)}
            placeholder="e.g. 27AAPFU0939F1ZV"
            style={{ width:'100%', padding:'7px 10px', fontSize:12, fontFamily:'monospace', border:`1px solid ${gstinOk ? '#86efac' : gstinVal.length > 0 ? '#fca5a5' : '#d1d5db'}`, borderRadius:6, outline:'none', boxSizing:'border-box' }}
          />
          {gstinVal.length > 0 && (
            <div style={{ fontSize:10, marginTop:4, color:gstinOk ? '#16a34a' : '#dc2626', fontWeight:500 }}>
              {gstinOk ? '✓ Valid GSTIN' : '✗ Must be 15 chars: 2 digits + 5 alpha + 4 digits + 1 alpha + 1Z + check digit'}
            </div>
          )}
        </div>
      )}
      <div style={{ padding:10, borderRadius:8, border:`1px solid ${canCheckin ? '#bbf7d0' : '#e5e7eb'}`, background:canCheckin ? '#f0fdf4' : '#f9fafb', fontSize:12, color:canCheckin ? '#16a34a' : '#6b7280' }}>
        {canCheckin ? '✓ All checks passed — ready to check in'
          : `Pending: ${[needFormC && !formCDone && 'Form C', needGstin && !gstinOk && 'Valid GSTIN'].filter(Boolean).join(', ') || 'requirements above'}`}
      </div>
      <button
        disabled={!canCheckin} onClick={onCheckin}
        style={{ padding:10, borderRadius:8, fontSize:13, fontWeight:600, border:'none', cursor:canCheckin ? 'pointer' : 'not-allowed', background:canCheckin ? '#4f46e5' : '#e5e7eb', color:canCheckin ? '#fff' : '#9ca3af', transition:'background .2s' }}>
        Process Check-In
      </button>
    </div>
  );
}

/* ─── Check-Out Pane ────────────────────────────────────────── */
function CheckOutPane({ booking, nights, base, tax, total, onCheckout }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ fontWeight:600, fontSize:14, color:'#111827' }}>Check-Out Invoice</div>
      <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse', border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden' }}>
        <tbody>
          <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
            <td style={{ padding:'9px 12px', color:'#374151' }}>Room ({nights}N × ₹{base.toLocaleString('en-IN')})</td>
            <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:500 }}>₹{(base*nights).toLocaleString('en-IN')}</td>
          </tr>
          <tr style={{ borderBottom:'1px solid #f3f4f6' }}>
            <td style={{ padding:'9px 12px', color:'#374151' }}>GST ({booking.gst_rate || 0}%)</td>
            <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:500 }}>₹{Math.max(0,tax).toLocaleString('en-IN')}</td>
          </tr>
          {Number(booking.ledger_balance) > 0 && (
            <tr style={{ borderBottom:'1px solid #fecaca', background:'#fef2f2' }}>
              <td style={{ padding:'9px 12px', color:'#b91c1c', fontWeight:600 }}>Outstanding</td>
              <td style={{ padding:'9px 12px', textAlign:'right', color:'#b91c1c', fontWeight:700 }}>₹{Number(booking.ledger_balance).toLocaleString('en-IN')}</td>
            </tr>
          )}
          <tr style={{ background:'#eef2ff' }}>
            <td style={{ padding:'11px 12px', fontWeight:700, color:'#111827' }}>Total Charged</td>
            <td style={{ padding:'11px 12px', textAlign:'right', fontWeight:700, color:'#4338ca', fontSize:14 }}>₹{total.toLocaleString('en-IN')}</td>
          </tr>
        </tbody>
      </table>
      <button onClick={onCheckout} style={{ padding:10, borderRadius:8, fontSize:13, fontWeight:600, border:'none', cursor:'pointer', background:'#059669', color:'#fff' }}>
        Confirm Check-Out &amp; Generate Invoice
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SWAP CONFIRM MODAL
   ═══════════════════════════════════════════════════════════ */
function SwapModal({ modal, rooms, onConfirm, onCancel }) {
  const { booking, newRoomId, newCheckIn, newCheckOut } = modal;
  const oldRoom = rooms.find(r => r.id === booking.room_id);
  const newRoom = rooms.find(r => r.id === newRoomId);
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.5)', backdropFilter:'blur(2px)' }}>
      <div style={{ background:'#fff', borderRadius:12, boxShadow:'0 20px 60px rgba(0,0,0,.3)', width:420, maxWidth:'calc(100vw - 32px)', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #f3f4f6', background:'#f9fafb' }}>
          <div style={{ fontWeight:700, fontSize:15, color:'#111827' }}>Confirm Reservation Move</div>
          <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>Review changes before applying</div>
        </div>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ fontWeight:600, fontSize:14, color:'#111827' }}>{booking.guest_name}</div>
          {booking.room_id !== newRoomId && (
            <div style={{ display:'flex', gap:10, fontSize:12 }}>
              <div style={{ flex:1, padding:10, background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, color:'#b91c1c' }}>
                <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', marginBottom:3 }}>From room</div>
                #{oldRoom?.room_number || booking.room_id}
              </div>
              <div style={{ alignSelf:'center', color:'#9ca3af', fontWeight:700 }}>→</div>
              <div style={{ flex:1, padding:10, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, color:'#15803d' }}>
                <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', marginBottom:3 }}>To room</div>
                #{newRoom?.room_number || newRoomId}
              </div>
            </div>
          )}
          {toISO(booking.check_in) !== newCheckIn && (
            <div style={{ display:'flex', gap:10, fontSize:12 }}>
              <div style={{ flex:1, padding:10, background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, color:'#b91c1c' }}>
                <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', marginBottom:3 }}>Old dates</div>
                {fmtPretty(booking.check_in)} → {fmtPretty(booking.check_out)}
              </div>
              <div style={{ alignSelf:'center', color:'#9ca3af', fontWeight:700 }}>→</div>
              <div style={{ flex:1, padding:10, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, color:'#15803d' }}>
                <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', marginBottom:3 }}>New dates</div>
                {fmtPretty(newCheckIn)} → {fmtPretty(newCheckOut)}
              </div>
            </div>
          )}
          <div style={{ padding:10, background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, fontSize:11, color:'#92400e' }}>
            ⚠ Conflict check runs under SERIALIZABLE isolation — overlapping bookings will automatically reject this move.
          </div>
        </div>
        <div style={{ display:'flex', gap:10, padding:'12px 20px', borderTop:'1px solid #f3f4f6', background:'#f9fafb' }}>
          <button onClick={onCancel} style={{ flex:1, padding:9, borderRadius:8, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontSize:13, fontWeight:600, color:'#374151' }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex:1, padding:9, borderRadius:8, border:'none', background:'#4f46e5', cursor:'pointer', fontSize:13, fontWeight:600, color:'#fff' }}>Confirm Move</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Tiny chips ────────────────────────────────────────────── */
function StatusChip({ s }) {
  const map = { confirmed:'#14b8a6', checked_in:'#3b82f6', checked_out:'#9ca3af', cancelled:'#ef4444', no_show:'#f43f5e' };
  const bg = map[s] || '#9ca3af';
  return <span style={{ padding:'2px 8px', borderRadius:20, background:bg+'22', color:bg, fontWeight:600, fontSize:11 }}>{s?.replace('_',' ')}</span>;
}
function OtaChip({ src }) {
  const bg = otaColor(src);
  return <span style={{ padding:'2px 7px', borderRadius:4, background:bg, color:'#fff', fontWeight:700, fontSize:11 }}>{src || '—'}</span>;
}
