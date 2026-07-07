import { useState, useEffect } from "react";
import {
  Plus, ChevronRight, TrendingUp,
  Users, DollarSign, Building2, CalendarSearch,
  Search, CalendarDays, Brush, CreditCard, BarChart2,
  ArrowUpRight, ArrowDownLeft, X, ChevronDown,
} from "lucide-react";
import { useApi, adminDashboard, adminRooms, rupee, fmtDate, apiFetch } from "./adminContext.js";
import { Spinner, TableWrap, StatusBadge } from "./ui.jsx";
import MiniCalendar from "../components/dashboard/MiniCalendar.jsx";
import OccupancyDonut from "../components/dashboard/OccupancyDonut.jsx";
import RoomCell, { ROOM_STATUS } from "../components/dashboard/RoomCell.jsx";
import RoomTaskSlideOver from "../components/dashboard/RoomTaskSlideOver.jsx";
import DueCheckoutsWidget from "../components/dashboard/DueCheckoutsWidget.jsx";

/* ── Constants ── */
const GRID_FILTERS = [
  { key:"all",         label:"All Rooms",        status:null },
  { key:"occupied",    label:"Booked",           status:"occupied" },
  { key:"available",   label:"Vacant & Clean",   status:"available" },
  { key:"stay_over",   label:"Stay-Over Refresh",status:"stay_over" },
  { key:"unavailable", label:"Unavailable",      status:"unavailable" },
  { key:"maintenance", label:"Maintenance",      status:"maintenance" },
];

const BOOKING_STATUS_MAP = {
  confirmed:   "ff-badge-blue",
  checked_in:  "ff-badge-green",
  checked_out: "ff-badge-muted",
  cancelled:   "ff-badge-red",
};

const QUICK_ACTIONS = [
  { label:"New Booking",   sub:"Create new reservation",  icon:Plus,         bg:"#dcfce7", color:"#16a34a", key:"frontdesk" },
  { label:"Search Guest",  sub:"Find guest information",  icon:Search,       bg:"#dbeafe", color:"#1d4ed8", key:"guests"       },
  { label:"Calendar",      sub:"View booking calendar",   icon:CalendarDays, bg:"#ede9fe", color:"#7c3aed", key:"calendar"     },
  { label:"Housekeeping",  sub:"Manage room status",      icon:Brush,        bg:"#ffedd5", color:"#ea580c", key:"roomtypes"    },
  { label:"Payments",      sub:"Process payments",        icon:CreditCard,   bg:"#fce7f3", color:"#db2777", key:"dailypayments"},
  { label:"Reports",       sub:"View analytics",          icon:BarChart2,    bg:"#ccfbf1", color:"#0d9488", key:"accounts"     },
];

const CHANNELS = [
  { label:"Direct",    source:"direct",    icon:"D", bg:"#dbeafe", color:"#1d4ed8" },
  { label:"Walk-in",   source:"walk_in",   icon:"W", bg:"#fef9c3", color:"#ca8a04" },
  { label:"OTA",       source:"ota",       icon:"O", bg:"#ede9fe", color:"#7c3aed" },
  { label:"Agent",     source:"agent",     icon:"A", bg:"#dcfce7", color:"#16a34a" },
  { label:"Corporate", source:"corporate", icon:"C", bg:"#fce7f3", color:"#db2777" },
  { label:"Website",   source:"website",   icon:"W", bg:"#ffedd5", color:"#ea580c" },
  { label:"Meta",      source:"meta",      icon:"M", bg:"#fee2e2", color:"#dc2626" },
];

function getSurgeTier(n) {
  if (n <= 3)  return { multiplier:1.00, label:"Base rate",         color:"#16a34a" };
  if (n <= 6)  return { multiplier:1.10, label:"+10% occupancy",    color:"#3b82f6" };
  if (n <= 9)  return { multiplier:1.25, label:"+25% mid-surge",    color:"#d97706" };
  if (n <= 12) return { multiplier:1.45, label:"+45% high-demand",  color:"#f97316" };
  if (n <= 14) return { multiplier:1.70, label:"+70% near-full",    color:"#dc2626" };
  return               { multiplier:2.00, label:"×2 last room",     color:"#991b1b" };
}

function getNext7Days() {
  const days = [], dow = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    days.push({ dow: dow[d.getDay()], date: d.getDate(), isToday: i === 0, key: d.toISOString().slice(0,10) });
  }
  return days;
}

/* ══════════════════════════════════════════════
   MAIN DASHBOARD
   ══════════════════════════════════════════════ */
export default function Dashboard({ onNavigate }) {
  const kpi   = useApi(adminDashboard);
  const rooms = useApi(adminRooms);
  const [gridFilter, setGridFilter] = useState("all");
  const [searchDate, setSearchDate] = useState("");
  const [roomTasks,  setRoomTasks]  = useState({});
  const [slideOver,  setSlideOver]  = useState(null);

  useEffect(() => {
    apiFetch("/api/admin/rooms/tasks")
      .then(data => setRoomTasks(data || {}))
      .catch(() => {});
  }, []);

  const physRooms    = rooms.data?.rooms || [];
  const filteredRooms = gridFilter === "all" ? physRooms : physRooms.filter(r => r.status === gridFilter);

  const d       = kpi.data || {};
  const surge   = getSurgeTier(d.occupiedToday || 0);
  const week    = getNext7Days();
  const recent  = d.recent || [];

  const occupied    = physRooms.filter(r => r.status === "occupied").length;
  const available   = physRooms.filter(r => r.status === "available").length;
  const dirty       = physRooms.filter(r => r.status === "stay_over").length;
  const totalRooms  = d.totalRooms || 15;
  const occPct      = d.occupancyPct || 0;

  const typeNames = [...new Set(physRooms.map(r => r.type).filter(Boolean))];

  const arrivalsByType   = d.arrivalsByType   || typeNames.map(t => ({ name: t, expected: 0, in: 0 }));
  const departuresByType = d.departuresByType || typeNames.map(t => ({ name: t, expected: 0, out: 0 }));

  if (kpi.loading || rooms.loading) return <Spinner />;

  return (
    <div className="jqd-wrap">
      {/* ═══════════ MAIN COLUMN ═══════════ */}
      <div className="jqd-main">

        {/* Header */}
        <div className="jqd-header">
          <div className="jqd-header-text">
            <h1>Today's Overview</h1>
            <p>Here's what's happening at your property</p>
          </div>
          <button className="jqd-new-btn" onClick={() => onNavigate("frontdesk")}>
            <Plus size={16} /> New Check-In
          </button>
        </div>

        {/* Due Checkouts Alert */}
        <DueCheckoutsWidget onNavigate={onNavigate} />

        {/* Today's Overview — 3 cards */}
        <div className="jqd-overview-grid">

          {/* Arrivals */}
          <div className="jqd-ov-card">
            <div className="jqd-ov-card-head">
              <h3 className="jqd-ov-card-title">Arrivals</h3>
              <button className="jqd-ov-show-btn jqd-ov-blue" onClick={() => onNavigate("frontdesk")}>
                <ArrowUpRight size={12}/> Show Arrivals
              </button>
            </div>
            <div className="jqd-ov-big">{d.arrivals || 0}</div>
            <p className="jqd-ov-label">expected</p>
            <div className="jqd-ov-badge jqd-ov-badge-blue">
              <ArrowUpRight size={11}/> {d.checkedInToday || 0} in
            </div>
            <hr className="jqd-ov-divider" />
            {arrivalsByType.length === 0
              ? <div style={{fontSize:13,color:"#9ca3af"}}>No arrivals today</div>
              : arrivalsByType.map(t => (
                <div key={t.name} className="jqd-ov-room-row">
                  <span>{t.name}</span>
                  <span className="jqd-ov-room-count">
                    <span>{t.expected} expected</span>
                    <span className="jqd-ov-room-in">• {t.in} in</span>
                  </span>
                </div>
              ))
            }
          </div>

          {/* In-house / occupancy donut */}
          <div className="jqd-ov-card">
            <div className="jqd-ov-card-head">
              <h3 className="jqd-ov-card-title">In-house</h3>
              <button className="jqd-ov-show-btn jqd-ov-green" onClick={() => onNavigate("bookings")}>
                <ArrowUpRight size={12}/> Show In-house
              </button>
            </div>
            <div className="jqd-ov-big">{occupied}</div>
            <p className="jqd-ov-label">in</p>
            <OccupancyDonut pct={occPct} occupied={occupied} dirty={dirty} available={available} />
            <div className="jqd-projected">
              Projected <b>{occPct.toFixed(2)}%</b> by tonight
            </div>
          </div>

          {/* Departures */}
          <div className="jqd-ov-card">
            <div className="jqd-ov-card-head">
              <h3 className="jqd-ov-card-title">Departures</h3>
              <button className="jqd-ov-show-btn jqd-ov-red" onClick={() => onNavigate("bookings")}>
                <ArrowDownLeft size={12}/> Show Departures
              </button>
            </div>
            <div className="jqd-ov-big">{d.departures || 0}</div>
            <p className="jqd-ov-label">expected</p>
            <div className="jqd-ov-badge jqd-ov-badge-red">
              <ArrowDownLeft size={11}/> {d.checkedOutToday || 0} out
            </div>
            <hr className="jqd-ov-divider" />
            {departuresByType.length === 0
              ? <div style={{fontSize:13,color:"#9ca3af"}}>No departures today</div>
              : departuresByType.map(t => (
                <div key={t.name} className="jqd-ov-room-row">
                  <span>{t.name}</span>
                  <span className="jqd-ov-room-count">
                    <span>{t.expected} expected</span>
                    <span className="jqd-ov-room-out">• {t.out} out</span>
                  </span>
                </div>
              ))
            }
          </div>
        </div>

        {/* Surge engine */}
        <div className="jqd-surge">
          <div>
            <p className="ff-eyebrow" style={{marginBottom:4}}>Live Surge Engine</p>
            <p style={{fontSize:19,fontWeight:700,color:surge.color,margin:0}}>
              {surge.label} — ×{surge.multiplier.toFixed(2)} multiplier
            </p>
          </div>
          <div style={{display:"flex",gap:6}}>
            {[0,3,6,9,12,14,15].map((n,i,arr) => {
              const active = (d.occupiedToday||0) >= n && (d.occupiedToday||0) < (arr[i+1]||16);
              const t = getSurgeTier(n);
              return (
                <div key={n} title={t.label} style={{
                  width:28,height:28,borderRadius:6,background:t.color,
                  opacity:active?1:0.28,display:"flex",alignItems:"center",
                  justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff",
                }}>{n}</div>
              );
            })}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="jqd-section-head">
          <p className="jqd-section-title">Quick Actions</p>
          <p className="jqd-section-sub">Jump to frequently used features</p>
        </div>
        <div className="jqd-quick-grid">
          {QUICK_ACTIONS.map(a => (
            <button key={a.label} className="jqd-quick-card" onClick={() => onNavigate(a.key)}>
              <ChevronRight size={14} className="jqd-quick-arrow" />
              <div className="jqd-quick-icon" style={{background:a.bg}}>
                <a.icon size={22} color={a.color} />
              </div>
              <p className="jqd-quick-label">{a.label}</p>
              <p className="jqd-quick-sub">{a.sub}</p>
            </button>
          ))}
        </div>

        {/* Next 7 Days */}
        <div className="jqd-section-head">
          <p className="jqd-section-title">Next 7 Days at a Glance</p>
          <p className="jqd-section-sub">Upcoming occupancy forecast and guest movements</p>
        </div>
        <div className="jqd-week-grid">
          {week.map(day => {
            const arrivals   = recent.filter(b => b.check_in?.slice(0,10) === day.key).length;
            const departures = recent.filter(b => b.check_out?.slice(0,10) === day.key).length;
            return (
              <div key={day.key} className={`jqd-day-card ${day.isToday ? "today" : ""}`}>
                <p className="jqd-day-dow">{day.dow}</p>
                <p className="jqd-day-num">{day.date}</p>
                <p className={`jqd-day-occ ${occPct > 70 ? "high" : ""}`}>{day.isToday ? `${occPct}%` : "0%"}</p>
                <div className="jqd-day-bar"><div className="jqd-day-bar-fill" style={{width:`${day.isToday?occPct:0}%`}} /></div>
                <div className="jqd-day-moves">
                  <span><ArrowUpRight size={11} color="#1d4ed8"/>{arrivals}</span>
                  <span><ArrowDownLeft size={11} color="#dc2626"/>{departures}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="jqd-week-legend" style={{marginBottom:28}}>
          {[
            {label:"Arrivals",   color:"#1d4ed8"},
            {label:"Departures", color:"#dc2626"},
            {label:"Full capacity", color:"#d97706"},
            {label:"Overbooked", color:"#991b1b"},
          ].map(l => (
            <div key={l.label} className="jqd-week-legend-item">
              <div className="jqd-week-legend-dot" style={{background:l.color}} />
              {l.label}
            </div>
          ))}
        </div>

        {/* 15-Room Visual Grid */}
        <div className="jqd-room-section">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
            <p className="jqd-section-title" style={{margin:0}}>{totalRooms}-Room Live Grid</p>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
            {GRID_FILTERS.map(f => {
              const count = f.status===null ? physRooms.length : physRooms.filter(r=>r.status===f.status).length;
              const color = f.status ? ROOM_STATUS[f.status]?.color : "#1d4ed8";
              const active = gridFilter === f.key;
              return (
                <button key={f.key} onClick={() => setGridFilter(f.key)} style={{
                  background: active ? color : "#ffffff",
                  color: active ? "#fff" : "#6b7280",
                  border: `1.5px solid ${active ? color : "#e5e7eb"}`,
                  padding:"5px 14px",borderRadius:20,cursor:"pointer",
                  fontSize:12,fontFamily:"'Inter',system-ui,sans-serif",fontWeight:600,
                  transition:".15s",display:"flex",alignItems:"center",gap:6,
                }}>
                  {f.status && <span style={{width:8,height:8,borderRadius:"50%",background:active?"#fff":ROOM_STATUS[f.status]?.color,display:"inline-block"}}/>}
                  {f.label}
                  <span style={{background:active?"rgba(255,255,255,.25)":"#f3f4f6",borderRadius:10,padding:"1px 7px",fontSize:11}}>{count}</span>
                </button>
              );
            })}
          </div>
          <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:16}}>
            {Object.entries(ROOM_STATUS).map(([k,v]) => (
              <div key={k} style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}>
                <div style={{width:12,height:12,borderRadius:3,background:v.color}}/>
                <span style={{color:"#6b7280"}}>{v.label}</span>
              </div>
            ))}
          </div>
          <div className="ff-room-status-grid">
            {physRooms.length===0
              ? Array.from({length:15},(_,i)=>(
                  <RoomCell key={i} room={{room_number:`R${i+1}`,status:"available",type:"—"}} tasks={[]} onClick={null}/>
                ))
              : filteredRooms.length===0
                ? <div style={{gridColumn:"1/-1",textAlign:"center",padding:"32px 0",color:"#9ca3af",fontSize:14}}>No rooms in this category.</div>
                : filteredRooms.map(r => (
                    <RoomCell
                      key={r.id}
                      room={r}
                      tasks={roomTasks[r.id] || []}
                      onClick={(room, tasks) => setSlideOver({ room, tasks })}
                    />
                  ))
            }
          </div>
        </div>

        {/* Recent Bookings */}
        <div className="jqd-bookings-section">
          <div className="jqd-bookings-head">
            <h3 className="jqd-bookings-title">Recent Bookings</h3>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <CalendarSearch size={15} color="#1d4ed8"/>
              <span style={{fontSize:12,color:"#9ca3af"}}>Search by date:</span>
              <input type="date" value={searchDate} onChange={e=>setSearchDate(e.target.value)} style={{
                fontSize:12,padding:"5px 10px",border:"1.5px solid #e5e7eb",borderRadius:8,
                background:"#fff",color:"#111827",outline:"none",cursor:"pointer",
              }}/>
              {searchDate && (
                <button onClick={()=>setSearchDate("")} style={{background:"none",border:"none",cursor:"pointer",color:"#9ca3af",display:"flex",alignItems:"center",padding:0}}>
                  <X size={14}/>
                </button>
              )}
            </div>
          </div>
          <div style={{padding:0}}>
            {recent.length===0
              ? <p className="ff-empty">No bookings yet.</p>
              : (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Reference</th><th>Guest</th><th>Room</th>
                      <th>Check In</th><th>Check Out</th>
                      <th style={{textAlign:"right"}}>Total</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(searchDate
                      ? recent.filter(b => b.check_in?.slice(0,10)===searchDate || b.check_out?.slice(0,10)===searchDate)
                      : recent
                    ).map(b => (
                      <tr key={b.id}>
                        <td className="ff-mono">{b.reference}</td>
                        <td>{b.guest}</td>
                        <td>{b.room}{b.room_number?` (#${b.room_number})`:""}</td>
                        <td>{fmtDate(b.check_in)}</td>
                        <td>{fmtDate(b.check_out)}</td>
                        <td className="ff-mono" style={{textAlign:"right"}}>{rupee(b.total_amount)}</td>
                        <td><StatusBadge value={b.status} map={BOOKING_STATUS_MAP}/></td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )
            }
          </div>
        </div>

      </div>{/* /jqd-main */}

      {/* ═══════════ RIGHT SIDEBAR ═══════════ */}
      <div className="jqd-sidebar">

        {/* Mini Calendar */}
        <MiniCalendar />

        {/* Booking Channels */}
        <div className="jqd-sidebar-section">
          <p className="jqd-sidebar-title">Booking Channels</p>
          {(() => {
            const bySource = d.bySource || [];
            const total = bySource.reduce((s, r) => s + r.bookings, 0);
            return (
              <>
                <p className="jqd-sidebar-sub">{total} total bookings this month</p>
                {CHANNELS.map(ch => {
                  const row = bySource.find(r => r.source === ch.source);
                  const count = row ? row.bookings : 0;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={ch.label} className="jqd-channel-row">
                      <div className="jqd-channel-left">
                        <div className="jqd-channel-icon" style={{background:ch.bg,color:ch.color}}>{ch.icon}</div>
                        {ch.label}
                      </div>
                      <span className="jqd-channel-val">{count} / {pct}%</span>
                    </div>
                  );
                })}
              </>
            );
          })()}
          <button className="jqd-show-all" onClick={() => onNavigate("bookings")}>
            Show All Bookings <ChevronRight size={14}/>
          </button>
        </div>

        {/* Recent Activity */}
        <div className="jqd-sidebar-section">
          <p className="jqd-sidebar-title">Recent Activity</p>
          {recent.length === 0
            ? <p style={{fontSize:13,color:"#9ca3af"}}>No recent activity.</p>
            : recent.slice(0,6).map(b => (
              <div key={b.id} className="jqd-activity-row">
                <div className="jqd-activity-dot" style={{background: b.status==="checked_in"?"#16a34a":b.status==="cancelled"?"#dc2626":"#1d4ed8"}} />
                <div>
                  <div className="jqd-activity-text">{b.guest} — {b.room}</div>
                  <div className="jqd-activity-time">{fmtDate(b.check_in)} → {fmtDate(b.check_out)}</div>
                </div>
              </div>
            ))
          }
        </div>

        {/* KPI Summary */}
        <div className="jqd-sidebar-section">
          <p className="jqd-sidebar-title">This Month</p>
          {[
            { label:"Revenue",   value:rupee(d.monthRevenue),  color:"#16a34a" },
            { label:"Profit",    value:rupee(d.monthProfit),   color: d.monthProfit>=0?"#16a34a":"#dc2626" },
            { label:"Bookings",  value:d.monthBookings||0,     color:"#1d4ed8" },
            { label:"ADR",       value:rupee(d.adr),           color:"#374151" },
            { label:"RevPAR",    value:rupee(d.revpar),        color:"#374151" },
          ].map(s => (
            <div key={s.label} className="jqd-channel-row">
              <span style={{fontSize:13,color:"#6b7280"}}>{s.label}</span>
              <span style={{fontSize:13,fontWeight:700,color:s.color}}>{s.value}</span>
            </div>
          ))}
        </div>

      </div>{/* /jqd-sidebar */}

      {slideOver && (
        <RoomTaskSlideOver
          room={slideOver.room}
          tasks={slideOver.tasks}
          onClose={() => setSlideOver(null)}
        />
      )}
    </div>
  );
}
