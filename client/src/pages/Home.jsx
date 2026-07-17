import { useState, useEffect, useRef, useCallback } from "react";
import {
  Menu, X, ChevronRight, ChevronLeft, MapPin, Phone, Mail, Waves, Wind, Coffee,
  Utensils, Wifi, Car, Star, Minus, Plus, CalendarDays, Users, ArrowUpRight,
  Check, Lock, LayoutDashboard, PlusCircle, BookOpen, BedDouble, Receipt,
  ShieldCheck, LogOut, Pencil, Printer, CreditCard,
  Flower2, Bike, Leaf,
} from "lucide-react";
import {
  getRooms, checkAvailability, createBooking,
  getToken, setSession, clearSession, getUser, login,
  adminDashboard, adminBookings, adminCalendar, adminRooms,
  adminCreateBooking, adminGetBooking, adminUpdateBooking,
  adminAddGuest, adminUpdateGuest, adminGuests, adminLookupGuestByKyc,
  adminExpenses, addExpense, adminUsers, addUser,
  setRoomRate, setRoomStatus,
} from "../api/client.js";
import AdminApp from "../admin/AdminApp.jsx";

/* ══════════════════════════════════════════════════════════════════
   MAISON AZURE  —  public website + admin dashboard in one file
   Public site is always visible.
   "Staff Login" opens a modal; correct credentials reveal the full
   admin panel (replaces page content). Sign out returns to the site.
   ══════════════════════════════════════════════════════════════════ */

// ─── constants ───────────────────────────────────────────────────
const FALLBACK_ROOMS = [
  { code:"DLX",   name:"Deluxe Garden Room", description:"A serene retreat opening onto the frangipani courtyard, with hand-finished teak and cool stone floors.", base_rate:8500,  max_occupancy:2, img:"https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=80" },
  { code:"POOL",  name:"Pool-View Suite",    description:"Wake to the water. A private balcony frames the pool and the line of palms beyond it.",                base_rate:12500, max_occupancy:3, img:"https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&q=80" },
  { code:"SUITE", name:"Maison Suite",       description:"Our flagship — a colonial-era footprint reimagined, with a deep soaking tub and a sea-facing daybed.", base_rate:18900, max_occupancy:4, img:"https://images.unsplash.com/photo-1591088398332-8a7791972843?w=1200&q=80" },
];
const IMG_BY_CODE = {
  DLX:"https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=80",
  POOL:"https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&q=80",
  SUITE:"https://images.unsplash.com/photo-1591088398332-8a7791972843?w=1200&q=80",
};
const AMENITIES = [
  {
    icon: Waves,
    label: "Saltwater Infinity Pool",
    desc: "Our 20-metre infinity pool is fed by filtered seawater and tested at dawn every morning. Perched at the edge of the property, it dissolves seamlessly into the horizon of the Bay of Bengal.",
    img: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=900&q=80",
  },
  {
    icon: Flower2,
    label: "Garden Courtyards",
    desc: "Three private walled courtyards planted with frangipani, jasmine, and bougainvillea. Each room opens onto a garden that fills with birdsong at first light and lantern glow after dark.",
    img: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=900&q=80",
  },
  {
    icon: Bike,
    label: "Curated Cycling Routes",
    desc: "Handpicked routes mapped by our concierge team — from a gentle sunrise loop along the Promenade Beach to a half-day ride through Auroville's red-earth forests. Vintage cycles provided.",
    img: "https://images.unsplash.com/photo-1541625602330-2277a4c46182?w=900&q=80",
  },
  {
    icon: Leaf,
    label: "Rooftop Yoga Pavilion",
    desc: "An open-air pavilion shaded by a hand-loomed cotton canopy, perched above the treeline with unobstructed views of the sea. Morning sessions begin at sunrise — all skill levels welcome.",
    img: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=900&q=80",
  },
  {
    icon: Wind,
    label: "Sea-Breeze Terraces",
    desc: "Each room's private terrace is positioned to catch the prevailing southwest breeze off the coast. Furnished with hand-crafted teak daybeds and linen cushions woven locally in Pondicherry.",
    img: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=900&q=80",
  },
  {
    icon: Wifi,
    label: "Fibre Wi-Fi & Work Lounge",
    desc: "Symmetrical 1 Gbps fibre throughout the property, with a dedicated co-working lounge stocked with ergonomic seating, monitor stands, and a quiet soundscape — for those who work from paradise.",
    img: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=900&q=80",
  },
  {
    icon: Car,
    label: "Chauffeur & Airport Transfer",
    desc: "Our fleet of air-conditioned Innova Crystas meets every guest at Pondicherry Airport or Chennai International. A complimentary transfer is included with every direct booking of two nights or more.",
    img: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=900&q=80",
  },
];
const GALLERY = [
  "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=900&q=80",
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=80",
  "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=900&q=80",
  "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=900&q=80",
];
const ADMIN_SECTIONS = [
  { key:"dashboard", label:"Dashboard",   icon:LayoutDashboard },
  { key:"newbooking",label:"New Booking", icon:PlusCircle      },
  { key:"bookings",  label:"Bookings",    icon:BookOpen        },
  { key:"calendar",  label:"Calendar",    icon:CalendarDays    },
  { key:"rooms",     label:"Rooms",       icon:BedDouble       },
  { key:"guests",    label:"Guests",      icon:Users           },
  { key:"expenses",  label:"Expenses",    icon:Receipt         },
  { key:"staff",     label:"Staff",       icon:ShieldCheck, adminOnly:true },
];
const TAX_PCT = 12; // GST shown on receipts
const BOOKING_STATUSES = ["confirmed","checked_in","checked_out","cancelled"];
const EXPENSE_CATS     = ["Pool","Salaries","Utilities","Supplies","Marketing","Maintenance","Food","Other"];
const ROOM_STATUSES    = ["available","maintenance","unavailable"];
const STAFF_ROLES      = ["staff","manager","owner"];

// ─── tiny helpers ─────────────────────────────────────────────────
const rupee    = (n) => "₹" + Number(n||0).toLocaleString("en-IN");
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const todayPlus= (n) => { const t=new Date(); t.setDate(t.getDate()+n); return t.toISOString().slice(0,10); };
const monthKey = (d) => d.toISOString().slice(0,7);

// ─── shared hooks ─────────────────────────────────────────────────
function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches){setShown(true);return;}
    const el=ref.current; if(!el) return;
    const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){setShown(true);io.disconnect();}},{threshold:0.15});
    io.observe(el); return ()=>io.disconnect();
  },[]);
  return [ref, shown];
}
function Reveal({children,delay=0}){
  const [ref,shown]=useReveal();
  return <div ref={ref} style={{opacity:shown?1:0,transform:shown?"translateY(0)":"translateY(20px)",transition:`opacity .65s ease ${delay}ms,transform .65s cubic-bezier(.2,.7,.2,1) ${delay}ms`}}>{children}</div>;
}

function useLoad(fn, deps=[]){
  const [data,  setData]   = useState(null);
  const [error, setError]  = useState("");
  const [loading,setLoading]=useState(true);
  const run = useCallback(()=>{
    setLoading(true); setError("");
    fn().then(setData).catch(e=>{
      if(e?.status===401){clearSession();window.location.reload();}
      setError(e.message);
    }).finally(()=>setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(()=>{run();},[run]);
  return {data,error,loading,reload:run};
}

// ─── small UI atoms ───────────────────────────────────────────────
const Pill  = ({v}) => <span className={`pill pill-${v}`}>{String(v).replace("_"," ")}</span>;
const Spin  = () => <div className="adm-loading">Loading…</div>;
const Err   = ({m}) => <div className="adm-err-line">Couldn't load: {m} — is the backend running?</div>;
const Empty = ({t}) => <div style={{color:"var(--muted)",fontSize:14,padding:"10px 0"}}>{t}</div>;
function AdmHead({eyebrow,title,right}){
  return(
    <div className="adm-head">
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div>
      {right}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  ROOT COMPONENT
// ══════════════════════════════════════════════════════════════════
export default function Home(){
  return <PublicSite />;
}

// ══════════════════════════════════════════════════════════════════
//  LOGIN MODAL  (overlaid on the public site)
// ══════════════════════════════════════════════════════════════════
function LoginModal({onSuccess,onClose}){
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);

  const submit=async(e)=>{
    e.preventDefault(); setErr(""); setBusy(true);
    try{
      const {token,user,tenant}=await login(username.trim(),password);
      setSession(token,user,tenant); onSuccess();
    }catch(e2){
      setErr(e2.message==="Failed to fetch"
        ?"Can't reach the server — start the backend first."
        :e2.message);
    }finally{setBusy(false);}
  };

  return(
    <div className="modal-backdrop" onClick={e=>{if(e.target.classList.contains("modal-backdrop"))onClose();}}>
      <form className="login-card" onSubmit={submit}>
        <button type="button" className="login-close" onClick={onClose} aria-label="Close"><X size={20}/></button>
        <div className="login-brand">Sunshine <span>Staff</span></div>
        <div className="login-sub"><Lock size={12}/> Sign in to manage your resort</div>
        <label className="login-label">Username</label>
        <input className="login-input" value={username} onChange={e=>setUsername(e.target.value)} autoFocus autoComplete="username" placeholder="admin"/>
        <label className="login-label">Password</label>
        <input className="login-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••"/>
        {err && <div className="login-err">{err}</div>}
        <button className="login-submit" disabled={busy}>{busy?"Signing in…":"Sign In"}</button>
        <div className="login-hint">Default: <b>admin</b> / <b>admin123</b></div>
      </form>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  ADMIN SHELL  (replaces the whole page after login)
// ══════════════════════════════════════════════════════════════════
function AdminShell({onLogout}){
  const user=getUser();
  const isOwner=user.role==="owner"||user.role==="manager";
  const sections=ADMIN_SECTIONS.filter(s=>!s.adminOnly||isOwner);
  const [active,setActive]=useState("dashboard");

  return(
    <div className="adm">
      <div className="adm-shell">
        {/* ── sidebar ── */}
        <aside className="adm-side">
          <div className="adm-brand">Sunshine <span>Admin</span></div>
          <div className="adm-role">{user.full_name||user.username} · {user.role}</div>
          <nav className="adm-nav">
            {sections.map(s=>(
              <button key={s.key} className={active===s.key?"active":""} onClick={()=>setActive(s.key)}>
                <s.icon size={17}/> {s.label}
              </button>
            ))}
          </nav>
          <div className="adm-foot">
            <button onClick={onLogout}><LogOut size={15}/> Sign out & back to site</button>
          </div>
        </aside>

        {/* ── main ── */}
        <main className="adm-main">
          {active==="dashboard" && <SecDashboard/>}
          {active==="newbooking"&& <SecNewBooking/>}
          {active==="bookings"  && <SecBookings/>}
          {active==="calendar"  && <SecCalendar/>}
          {active==="rooms"     && <SecRooms/>}
          {active==="guests"    && <SecGuests/>}
          {active==="expenses"  && <SecExpenses/>}
          {active==="staff"     && <SecStaff/>}
        </main>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  ADMIN SECTIONS
// ══════════════════════════════════════════════════════════════════
function SecDashboard(){
  const {data,error,loading}=useLoad(adminDashboard);
  const [searchDate,setSearchDate]=useState("");
  if(loading) return <Spin/>;
  if(error)   return <Err m={error}/>;
  const d=data;

  // bookings whose stay period covers the searched date
  const inPeriod = searchDate
    ? d.recent.filter(b=>{
        const s=new Date(b.check_in); s.setHours(0,0,0,0);
        const e=new Date(b.check_out); e.setHours(0,0,0,0);
        const q=new Date(searchDate); q.setHours(0,0,0,0);
        return q>=s && q<e;
      })
    : [];

  // exact-match bookings (check_in date equals searched date)
  const exactMatch = searchDate
    ? d.recent.filter(b=>b.check_in&&b.check_in.slice(0,10)===searchDate)
    : d.recent;

  const Kpi=({label,val,sub,cls=""})=>(
    <div className={`adm-kpi ${cls}`}>
      <div className="label">{label}</div>
      <div className="val">{val}</div>
      {sub&&<div className="sub">{sub}</div>}
    </div>
  );
  return(<>
    <AdmHead eyebrow="Overview" title="Dashboard" right={<span style={{color:"var(--muted)",fontSize:13}}>{fmtDate(new Date())}</span>}/>
    <div className="adm-kpis">
      <Kpi label="Occupancy today"    val={`${d.occupancyPct}%`}  sub={`${d.occupiedToday} of ${d.totalRooms} rooms`}/>
      <Kpi label="In-house"          val={d.inHouse}              sub={`${d.arrivals} arriving · ${d.departures} departing`}/>
      <Kpi label="ADR this month"    val={rupee(d.adr)}           sub="Avg daily rate"/>
      <Kpi label="RevPAR this month" val={rupee(d.revpar)}        sub="Rev per available room"/>
    </div>
    <div className="adm-kpis">
      <Kpi label="Revenue (month)"  val={rupee(d.monthRevenue)}  sub={`${d.monthBookings} bookings`}/>
      <Kpi label="Expenses (month)" val={rupee(d.monthExpenses)}/>
      <Kpi label="Profit (month)"   val={rupee(d.monthProfit)}   cls={d.monthProfit>=0?"pos":"neg"}/>
      <Kpi label="Total rooms"      val={d.totalRooms}            sub="Boutique inventory"/>
    </div>
    <div className="adm-grid2">
      <div className="adm-panel">
        <h3>Revenue by channel</h3>
        {d.bySource.length===0?<Empty t="No bookings this month yet."/>:(
          <table className="adm-table">
            <thead><tr><th>Channel</th><th>Bookings</th><th style={{textAlign:"right"}}>Revenue</th></tr></thead>
            <tbody>{d.bySource.map(s=>(
              <tr key={s.source}>
                <td style={{textTransform:"capitalize"}}>{s.source}</td>
                <td>{s.bookings}</td>
                <td style={{textAlign:"right"}}>{rupee(s.revenue)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="adm-panel">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:12}}>
          <h3 style={{margin:0}}>Recent bookings</h3>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <CalendarDays size={14} color="var(--brass)"/>
            <input
              type="date"
              value={searchDate}
              onChange={e=>setSearchDate(e.target.value)}
              style={{fontSize:12,padding:"4px 8px",border:"1px solid var(--line)",borderRadius:6,background:"var(--paper)",color:"var(--ink)",outline:"none"}}
            />
            {searchDate&&(
              <button onClick={()=>setSearchDate("")} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted)",lineHeight:1,padding:0}}>
                <X size={14}/>
              </button>
            )}
          </div>
        </div>

        {/* ── default view: no search ── */}
        {!searchDate&&(
          d.recent.length===0?<Empty t="No bookings yet."/>:(
            <table className="adm-table">
              <thead><tr><th>Guest</th><th>Room</th><th>Status</th></tr></thead>
              <tbody>{d.recent.map(b=>(
                <tr key={b.id}>
                  <td>{b.guest}<div className="src">{b.reference}</div></td>
                  <td>{b.room}<div className="src">{fmtDate(b.check_in)} → {fmtDate(b.check_out)}</div></td>
                  <td><Pill v={b.status}/></td>
                </tr>
              ))}</tbody>
            </table>
          )
        )}

        {/* ── search results ── */}
        {searchDate&&(<>
          {/* checked-in on this date */}
          <div style={{fontSize:11,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:"var(--muted)",marginBottom:6}}>
            Checked in on {fmtDate(searchDate)}
          </div>
          {exactMatch.length===0
            ?<Empty t="No check-ins on this date."/>
            :<table className="adm-table" style={{marginBottom:16}}>
              <thead><tr><th>Guest</th><th>Room</th><th>Status</th></tr></thead>
              <tbody>{exactMatch.map(b=>(
                <tr key={b.id}>
                  <td>{b.guest}<div className="src">{b.reference}</div></td>
                  <td>{b.room}<div className="src">{fmtDate(b.check_in)} → {fmtDate(b.check_out)}</div></td>
                  <td><Pill v={b.status}/></td>
                </tr>
              ))}</tbody>
            </table>
          }

          {/* in-house on this date (booked across this date) */}
          <div style={{fontSize:11,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:"var(--muted)",marginBottom:6,marginTop:4}}>
            Rooms occupied on {fmtDate(searchDate)}
          </div>
          {inPeriod.length===0
            ?<Empty t="No rooms occupied on this date."/>
            :<table className="adm-table">
              <thead><tr><th>Room</th><th>Guest</th><th>Stay period</th><th>Status</th></tr></thead>
              <tbody>{inPeriod.map(b=>(
                <tr key={b.id}>
                  <td style={{fontWeight:600}}>{b.room}</td>
                  <td>{b.guest}<div className="src">{b.reference}</div></td>
                  <td className="src">{fmtDate(b.check_in)} → {fmtDate(b.check_out)}</td>
                  <td><Pill v={b.status}/></td>
                </tr>
              ))}</tbody>
            </table>
          }
        </>)}
      </div>
    </div>
  </>);
}

function SecBookings(){
  const [filter,setFilter]=useState("");
  const q=filter?`?status=${filter}`:"";
  const {data,error,loading,reload}=useLoad(()=>adminBookings(q),[q]);
  const [editId,setEditId]=useState(null);
  const [receiptId,setReceiptId]=useState(null);

  return(<>
    <AdmHead eyebrow="Reservations" title="Bookings"/>
    <div className="adm-filters">
      <span style={{fontSize:11,letterSpacing:".1em",textTransform:"uppercase",color:"var(--muted)"}}>Filter</span>
      <select value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="">All statuses</option>
        {BOOKING_STATUSES.map(s=><option key={s} value={s}>{s.replace("_"," ")}</option>)}
      </select>
    </div>
    <div className="adm-panel" style={{padding:0}}>
      {loading?<Spin/>:error?<Err m={error}/>:data.length===0?<div style={{padding:22}}><Empty t="No bookings match."/></div>:(
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Ref</th><th>Guest</th><th>Room</th><th>Stay</th><th>Source</th><th style={{textAlign:"right"}}>Total</th><th style={{textAlign:"right"}}>Pending</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{data.map(b=>(
              <tr key={b.id}>
                <td className="mono">{b.reference}</td>
                <td>{b.guest}<div className="src">{b.phone||b.email||""}</div></td>
                <td>{b.room}</td>
                <td>{fmtDate(b.check_in)}<div className="src">→ {fmtDate(b.check_out)}</div></td>
                <td className="src">{b.source}</td>
                <td className="mono" style={{textAlign:"right"}}>{rupee(b.total_amount)}</td>
                <td className="mono" style={{textAlign:"right",color:Number(b.pending_amount)>0?"var(--warn)":"var(--good)"}}>{rupee(b.pending_amount)}</td>
                <td><Pill v={b.payment_status||"pending"}/></td>
                <td><Pill v={b.status}/></td>
                <td style={{whiteSpace:"nowrap"}}>
                  <button className="adm-icon-btn" title="Edit" onClick={()=>setEditId(b.id)}><Pencil size={15}/></button>
                  <button className="adm-icon-btn" title="Receipt" onClick={()=>setReceiptId(b.id)}><Printer size={15}/></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
    <p style={{fontSize:12,color:"var(--muted)"}}>Tap the pencil to edit dates, record a payment, or change status. Tap the printer for a receipt. Cancelling releases the rooms automatically.</p>
    {editId    && <EditBookingModal id={editId} onClose={()=>setEditId(null)} onSaved={()=>{setEditId(null);reload();}} onReceipt={(id)=>{setEditId(null);setReceiptId(id);}}/>}
    {receiptId && <ReceiptModal id={receiptId} onClose={()=>setReceiptId(null)}/>}
  </>);
}

// ── KYC config (for returning guest verification) ──
const NB_KYC_CONFIG = {
  aadhaar:  { label:"Aadhaar Card",    maxLength:12, pattern:/^[0-9]{12}$/,                hint:"12-digit number" },
  pan:      { label:"PAN Card",        maxLength:10, pattern:/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, hint:"AAAAA9999A" },
  passport: { label:"Passport",        maxLength:8,  pattern:/^[A-Z][0-9]{7}$/,             hint:"A1234567" },
  voter_id: { label:"Voter ID",        maxLength:10, pattern:/^[A-Z]{3}[0-9]{7}$/,          hint:"ABC1234567" },
  dl:       { label:"Driving Licence", maxLength:16, pattern:/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,12}$/, hint:"State code + RTO + number" },
};

// ── New booking (front desk / walk-in / phone) ──
function SecNewBooking(){
  const rooms = useLoad(adminRooms);
  const [mode,setMode]=useState("returning"); // returning | new
  // KYC verification state for returning guest
  const [kycType,setKycType]=useState("");
  const [kycNum,setKycNum]=useState("");
  const [kycBusy,setKycBusy]=useState(false);
  const [kycErr,setKycErr]=useState("");
  const [verifiedGuest,setVerifiedGuest]=useState(null); // guest found by KYC

  const [f,setF]=useState({
    guest_id:"", full_name:"", phone:"", email:"", address:"",
    room_type_id:"", check_in:todayPlus(0), check_out:todayPlus(1),
    num_guests:2, advance_paid:"0", status:"confirmed",
  });
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [done,setDone]=useState(null);

  const types = rooms.data?.types || [];
  const rt = types.find(t=>String(t.id)===String(f.room_type_id));
  const nights = Math.max(0, Math.round((new Date(f.check_out)-new Date(f.check_in))/86400000));
  const rate = rt ? Number(rt.rate_today ?? rt.base_rate) : 0;
  const base = rate * nights;
  const tax = Math.round(base * TAX_PCT)/100;
  const total = base + tax;
  const pending = Math.max(total - Number(f.advance_paid||0), 0);

  const kycCfg = kycType ? NB_KYC_CONFIG[kycType] : null;

  const verifyKyc = async () => {
    setKycErr("");
    if(!kycType) return setKycErr("Please select an ID type.");
    if(!kycNum.trim()) return setKycErr("Please enter the ID number.");
    if(kycCfg && !kycCfg.pattern.test(kycNum)) return setKycErr(`Invalid format for ${kycCfg.label}.`);
    setKycBusy(true);
    try {
      const g = await adminLookupGuestByKyc(kycNum);
      setVerifiedGuest(g);
      setF(prev=>({...prev, guest_id:String(g.id), full_name:g.full_name, phone:g.phone||"", email:g.email||"", address:g.address||""}));
    } catch(e) { setKycErr(e.status===404 ? "No guest found with that KYC number." : e.message); }
    finally { setKycBusy(false); }
  };

  const resetMode = (m) => {
    setMode(m);
    setKycType(""); setKycNum(""); setKycErr(""); setVerifiedGuest(null);
    setF(prev=>({...prev,guest_id:"",full_name:"",phone:"",email:"",address:""}));
  };

  const submit=async()=>{
    setErr("");
    if(!f.room_type_id) return setErr("Please choose a room type.");
    if(nights<1) return setErr("Check-out must be after check-in.");
    if(mode==="returning" && !verifiedGuest) return setErr("Please verify the returning guest's KYC before proceeding.");
    if(mode==="new" && !f.full_name.trim()) return setErr("Guest name is required.");
    setBusy(true);
    try{
      const payload={
        room_type_id:Number(f.room_type_id), check_in:f.check_in, check_out:f.check_out,
        num_guests:Number(f.num_guests), advance_paid:Number(f.advance_paid||0),
        tax_percentage:TAX_PCT, status:f.status,
      };
      if(mode==="returning") payload.guest_id=Number(f.guest_id);
      else payload.guest={full_name:f.full_name,phone:f.phone,email:f.email,address:f.address};
      const r=await adminCreateBooking(payload);
      setDone(r.booking);
    }catch(e){ setErr(e.message); }
    finally{ setBusy(false); }
  };

  if(done) return <ReceiptInline booking={done} onNew={()=>{setDone(null);setVerifiedGuest(null);setKycType("");setKycNum("");setF({...f,advance_paid:"0",full_name:"",phone:"",email:"",address:"",guest_id:""});}}/>;

  return(<>
    <AdmHead eyebrow="Front desk" title="New Booking"/>
    <div className="adm-panel" style={{maxWidth:760}}>
      <h3>Guest</h3>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <button className={`adm-seg ${mode==="returning"?"on":""}`} onClick={()=>resetMode("returning")}>Returning guest</button>
        <button className={`adm-seg ${mode==="new"?"on":""}`} onClick={()=>resetMode("new")}>New guest</button>
      </div>

      {mode==="returning" && !verifiedGuest && (
        <div style={{background:"var(--surface-alt,#f8fafc)",borderRadius:10,padding:18,border:"1px solid var(--border)"}}>
          <p style={{fontSize:13,color:"var(--muted)",marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
            <ShieldCheck size={15} style={{color:"#1a56db"}}/> Verify the guest's government-issued ID to auto-fill their details.
          </p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div className="adm-field" style={{margin:0}}>
              <label>ID type</label>
              <select value={kycType} onChange={e=>{setKycType(e.target.value);setKycNum("");setKycErr("");}}>
                <option value="">Select…</option>
                {Object.entries(NB_KYC_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="adm-field" style={{margin:0}}>
              <label>ID number {kycCfg?`(${kycCfg.hint})`:""}</label>
              <input
                type="text" value={kycNum}
                disabled={!kycType}
                placeholder={kycType ? `Enter ${NB_KYC_CONFIG[kycType].label} number` : "Select ID type first"}
                onChange={e=>{
                  let v=e.target.value.toUpperCase().replace(/\s/g,"");
                  if(kycCfg && v.length>kycCfg.maxLength) v=v.slice(0,kycCfg.maxLength);
                  setKycNum(v); setKycErr("");
                }}
                onKeyDown={e=>e.key==="Enter"&&verifyKyc()}
              />
            </div>
          </div>
          {kycErr && <div style={{color:"var(--warn)",fontSize:13,marginBottom:10}}>{kycErr}</div>}
          <button className="adm-btn-brass" onClick={verifyKyc} disabled={kycBusy||!kycType||!kycNum}>
            <ShieldCheck size={14}/> {kycBusy?"Verifying…":"Verify & fetch guest"}
          </button>
        </div>
      )}

      {mode==="returning" && verifiedGuest && (
        <div style={{background:"#ecfdf5",borderRadius:10,padding:16,border:"1px solid #a7f3d0"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <ShieldCheck size={16} style={{color:"#059669"}}/>
                <span style={{fontWeight:700,fontSize:15,color:"#065f46"}}>Identity verified</span>
              </div>
              <div style={{fontSize:14,fontWeight:600,color:"#1a1a1a"}}>{verifiedGuest.full_name}</div>
              {verifiedGuest.phone && <div style={{fontSize:13,color:"#444"}}>{verifiedGuest.phone}</div>}
              {verifiedGuest.email && <div style={{fontSize:13,color:"#444"}}>{verifiedGuest.email}</div>}
              <div style={{marginTop:8,fontSize:12,color:"#059669",fontWeight:600}}>
                {NB_KYC_CONFIG[verifiedGuest.kyc_type]?.label || verifiedGuest.kyc_type}: {verifiedGuest.kyc_number}
                &nbsp;·&nbsp;{verifiedGuest.stays} prior stay{verifiedGuest.stays!==1?"s":""}
              </div>
            </div>
            <button style={{background:"none",border:"none",cursor:"pointer",color:"#059669",padding:4}} title="Change guest" onClick={()=>{setVerifiedGuest(null);setKycNum("");setKycErr("");}}>
              <X size={16}/>
            </button>
          </div>
        </div>
      )}

      {mode==="new" && (
        <div className="adm-grid-fields">
          <div className="adm-field"><label>Full name *</label><input type="text" value={f.full_name} onChange={e=>setF({...f,full_name:e.target.value})}/></div>
          <div className="adm-field"><label>Phone</label><input type="text" value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></div>
          <div className="adm-field"><label>Email</label><input type="text" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></div>
          <div className="adm-field"><label>Address</label><input type="text" value={f.address} onChange={e=>setF({...f,address:e.target.value})}/></div>
        </div>
      )}
    </div>

    <div className="adm-panel" style={{maxWidth:760}}>
      <h3>Stay</h3>
      <div className="adm-grid-fields">
        <div className="adm-field"><label>Room type</label>
          <select value={f.room_type_id} onChange={e=>setF({...f,room_type_id:e.target.value})}>
            <option value="">Choose…</option>
            {types.map(t=><option key={t.id} value={t.id}>{t.name} — {rupee(t.rate_today??t.base_rate)}/night{t.available_today!=null?` (${t.available_today} free today)`:""}</option>)}
          </select>
        </div>
        <div className="adm-field"><label>Guests</label><input type="number" min="1" value={f.num_guests} onChange={e=>setF({...f,num_guests:e.target.value})}/></div>
        <div className="adm-field"><label>Check in</label><input type="date" value={f.check_in} onChange={e=>setF({...f,check_in:e.target.value})}/></div>
        <div className="adm-field"><label>Check out</label><input type="date" value={f.check_out} min={f.check_in} onChange={e=>setF({...f,check_out:e.target.value})}/></div>
        <div className="adm-field"><label>Advance paid (₹)</label><input type="number" min="0" value={f.advance_paid} onChange={e=>setF({...f,advance_paid:e.target.value})}/></div>
        <div className="adm-field"><label>Status</label>
          <select value={f.status} onChange={e=>setF({...f,status:e.target.value})}>
            {BOOKING_STATUSES.filter(s=>s!=="cancelled").map(s=><option key={s} value={s}>{s.replace("_"," ")}</option>)}
          </select>
        </div>
      </div>

      <div className="adm-summary">
        <div><span>{nights} night{nights!==1?"s":""} × {rupee(rate)}</span><b>{rupee(base)}</b></div>
        <div><span>GST ({TAX_PCT}%)</span><b>{rupee(tax)}</b></div>
        <div className="t"><span>Total</span><b>{rupee(total)}</b></div>
        <div><span>Advance</span><b>{rupee(Number(f.advance_paid||0))}</b></div>
        <div className="due"><span>Balance due</span><b>{rupee(pending)}</b></div>
      </div>
      {err && <div style={{color:"var(--warn)",fontSize:13,marginTop:10}}>{err}</div>}
      <button className="adm-btn-brass" style={{marginTop:14}} onClick={submit} disabled={busy}>
        {busy?"Creating…":"Create booking"}
      </button>
    </div>
  </>);
}

// ── shared receipt rendering + printing ──
function receiptRows(b){
  const nights = b.nights || Math.round((new Date(b.check_out)-new Date(b.check_in))/86400000);
  return { nights };
}
function printReceipt(b){
  const { nights } = receiptRows(b);
  const html = `<html><head><title>Receipt ${b.reference}</title><style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
    body{font-family:'Playfair Display',Georgia,serif;max-width:600px;margin:0 auto;padding:40px;color:#1a1a1a;}
    h1{font-size:24px;margin:0;letter-spacing:.04em;} .sub{color:#888;font-size:11px;letter-spacing:.3em;text-transform:uppercase;}
    .ref{color:#666;font-size:13px;margin-top:8px;font-family:'IBM Plex Mono',monospace;letter-spacing:.1em;font-weight:500;} hr{border:none;border-top:1px solid #ddd;margin:18px 0;}
    .st{font-weight:bold;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#B08D4F;margin:18px 0 8px;}
    .row{display:flex;justify-content:space-between;padding:5px 0;font-size:14px;}
    .row.total{font-weight:bold;font-size:17px;border-top:2px solid #333;padding-top:10px;margin-top:8px;}
    .row.due{color:#b4452f;font-weight:bold;} .foot{text-align:center;margin-top:34px;font-size:11px;color:#aaa;}
  </style></head><body>
    <div style="text-align:center"><h1>Sunshine</h1><div class="sub">Pondicherry</div><div class="ref">Receipt · ${b.reference}</div></div>
    <hr/>
    <div class="st">Guest</div>
    <div class="row"><span>Name</span><b>${b.guest||""}</b></div>
    ${b.phone?`<div class="row"><span>Phone</span><span>${b.phone}</span></div>`:""}
    ${b.email?`<div class="row"><span>Email</span><span>${b.email}</span></div>`:""}
    ${b.address?`<div class="row"><span>Address</span><span>${b.address}</span></div>`:""}
    <div class="st">Stay</div>
    <div class="row"><span>Room</span><b>${b.room||""}</b></div>
    <div class="row"><span>Check in</span><span>${new Date(b.check_in).toDateString()}</span></div>
    <div class="row"><span>Check out</span><span>${new Date(b.check_out).toDateString()}</span></div>
    <div class="row"><span>Nights</span><span>${nights}</span></div>
    <div class="st">Charges</div>
    <div class="row"><span>Room charge</span><span>₹${Number(b.base_amount||b.total_amount).toLocaleString("en-IN")}</span></div>
    <div class="row"><span>Tax</span><span>₹${Number(b.tax_amount||0).toLocaleString("en-IN")}</span></div>
    <div class="row total"><span>Total</span><span>₹${Number(b.total_amount).toLocaleString("en-IN")}</span></div>
    <div class="row"><span>Advance paid</span><span>₹${Number(b.advance_paid||0).toLocaleString("en-IN")}</span></div>
    <div class="row due"><span>Balance due</span><span>₹${Number(b.pending_amount||0).toLocaleString("en-IN")}</span></div>
    <div class="foot">Thank you for staying with us · ${new Date().toLocaleDateString("en-IN")}</div>
  </body></html>`;
  const w=window.open("","_blank","width=680,height=800");
  if(!w){ alert("Please allow pop-ups to print the receipt."); return; }
  w.document.write(html); w.document.close(); w.focus(); setTimeout(()=>w.print(),300);
}

function ReceiptBody({b}){
  const { nights } = receiptRows(b);
  const Row=({l,v,cls=""})=> <div className={`rcp-row ${cls}`}><span>{l}</span><b>{v}</b></div>;
  return(
    <div className="rcp">
      <div className="rcp-head">
        <div className="rcp-brand">Sunshine</div>
        <div className="rcp-sub">Pondicherry</div>
        <div className="rcp-ref">{b.reference}</div>
      </div>
      <div className="rcp-st">Guest</div>
      <Row l="Name" v={b.guest}/>
      {b.phone && <Row l="Phone" v={b.phone}/>}
      {b.email && <Row l="Email" v={b.email}/>}
      <div className="rcp-st">Stay</div>
      <Row l="Room" v={b.room}/>
      <Row l="Check in" v={fmtDate(b.check_in)}/>
      <Row l="Check out" v={fmtDate(b.check_out)}/>
      <Row l="Nights" v={nights}/>
      <div className="rcp-st">Charges</div>
      <Row l="Room charge" v={rupee(b.base_amount||b.total_amount)}/>
      <Row l="Tax" v={rupee(b.tax_amount||0)}/>
      <Row l="Total" v={rupee(b.total_amount)} cls="total"/>
      <Row l="Advance paid" v={rupee(b.advance_paid||0)}/>
      <Row l="Balance due" v={rupee(b.pending_amount||0)} cls="due"/>
    </div>
  );
}

function ReceiptInline({booking,onNew}){
  return(<>
    <AdmHead eyebrow="Front desk" title="Booking created" right={
      <button className="adm-btn-brass" onClick={onNew}><PlusCircle size={15} style={{verticalAlign:"-2px",marginRight:6}}/>New booking</button>
    }/>
    <div className="adm-panel" style={{maxWidth:480}}>
      <ReceiptBody b={booking}/>
      <button className="adm-btn-brass" style={{width:"100%",justifyContent:"center",marginTop:16}} onClick={()=>printReceipt(booking)}>
        <Printer size={15} style={{marginRight:7}}/> Print receipt
      </button>
    </div>
  </>);
}

function ReceiptModal({id,onClose}){
  const {data,error,loading}=useLoad(()=>adminGetBooking(id),[id]);
  return(
    <div className="modal-backdrop" onClick={e=>{if(e.target.classList.contains("modal-backdrop"))onClose();}}>
      <div className="adm-modal" style={{maxWidth:440}}>
        <div className="adm-modal-head"><h3>Receipt</h3><button onClick={onClose}><X size={20}/></button></div>
        <div className="adm-modal-body">
          {loading?<Spin/>:error?<Err m={error}/>:(<>
            <ReceiptBody b={data}/>
            <button className="adm-btn-brass" style={{width:"100%",justifyContent:"center",marginTop:16}} onClick={()=>printReceipt(data)}>
              <Printer size={15} style={{marginRight:7}}/> Print receipt
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}

function EditBookingModal({id,onClose,onSaved,onReceipt}){
  const {data,error,loading}=useLoad(()=>adminGetBooking(id),[id]);
  const [f,setF]=useState(null);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  useEffect(()=>{
    if(data) setF({
      check_in:data.check_in.slice(0,10), check_out:data.check_out.slice(0,10),
      additional_payment:"0", status:data.status,
    });
  },[data]);

  const save=async()=>{
    setBusy(true); setMsg("");
    try{
      await adminUpdateBooking(id,{
        check_in:f.check_in, check_out:f.check_out,
        additional_payment:Number(f.additional_payment||0), status:f.status,
      });
      onSaved();
    }catch(e){ setMsg(e.message); }
    finally{ setBusy(false); }
  };

  return(
    <div className="modal-backdrop" onClick={e=>{if(e.target.classList.contains("modal-backdrop"))onClose();}}>
      <div className="adm-modal" style={{maxWidth:480}}>
        <div className="adm-modal-head">
          <div><div className="eyebrow" style={{color:"var(--brass)"}}>Edit booking</div><h3>{data?.reference||""}</h3></div>
          <button onClick={onClose}><X size={20}/></button>
        </div>
        <div className="adm-modal-body">
          {loading||!f?<Spin/>:error?<Err m={error}/>:(<>
            <div className="adm-summary" style={{marginTop:0,marginBottom:16}}>
              <div><span>Guest</span><b>{data.guest}</b></div>
              <div><span>Room</span><b>{data.room}</b></div>
              <div><span>Total</span><b>{rupee(data.total_amount)}</b></div>
              <div><span>Already paid</span><b>{rupee(data.advance_paid)}</b></div>
              <div className="due"><span>Balance due</span><b>{rupee(data.pending_amount)}</b></div>
            </div>
            <div className="adm-grid-fields">
              <div className="adm-field"><label>Check in</label><input type="date" value={f.check_in} onChange={e=>setF({...f,check_in:e.target.value})}/></div>
              <div className="adm-field"><label>Check out</label><input type="date" value={f.check_out} min={f.check_in} onChange={e=>setF({...f,check_out:e.target.value})}/></div>
              <div className="adm-field"><label><CreditCard size={11} style={{verticalAlign:"-1px"}}/> Record payment (₹)</label><input type="number" min="0" value={f.additional_payment} onChange={e=>setF({...f,additional_payment:e.target.value})} placeholder="0"/></div>
              <div className="adm-field"><label>Status</label>
                <select value={f.status} onChange={e=>setF({...f,status:e.target.value})}>
                  {BOOKING_STATUSES.map(s=><option key={s} value={s}>{s.replace("_"," ")}</option>)}
                </select>
              </div>
            </div>
            {msg && <div style={{color:"var(--warn)",fontSize:13,marginTop:10}}>{msg}</div>}
            <div style={{display:"flex",gap:8,marginTop:16}}>
              <button className="adm-btn-brass" style={{flex:1,justifyContent:"center"}} onClick={save} disabled={busy}>{busy?"Saving…":"Save changes"}</button>
              <button className="adm-btn-ghost" onClick={()=>onReceipt(id)}><Printer size={15}/></button>
            </div>
            <p style={{fontSize:12,color:"var(--muted)",marginTop:10}}>Changing dates re-checks availability and reprices the stay. Cancelling releases the rooms.</p>
          </>)}
        </div>
      </div>
    </div>
  );
}

function SecCalendar(){
  const [month,setMonth]=useState(monthKey(new Date()));
  const {data,error,loading}=useLoad(()=>adminCalendar(month),[month]);
  const shift=delta=>{
    const [y,m]=month.split("-").map(Number);
    setMonth(monthKey(new Date(y,m-1+delta,1)));
  };
  const byDate={};
  (data?.days||[]).forEach(d=>{byDate[d.stay_date.slice(0,10)]=d;});
  const [y,m]=month.split("-").map(Number);
  const first=new Date(y,m-1,1);
  const dim=new Date(y,m,0).getDate();
  const lead=first.getDay();
  const cells=[];
  for(let i=0;i<lead;i++) cells.push(null);
  for(let day=1;day<=dim;day++){
    const key=`${y}-${String(m).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    cells.push({day,info:byDate[key]});
  }
  const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return(<>
    <AdmHead eyebrow="Occupancy" title="Calendar" right={
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <button className="adm-btn-sm" onClick={()=>shift(-1)}><ChevronLeft size={14}/></button>
        <span style={{minWidth:140,textAlign:"center",fontWeight:600,fontSize:14}}>
          {first.toLocaleDateString("en-IN",{month:"long",year:"numeric"})}
        </span>
        <button className="adm-btn-sm" onClick={()=>shift(1)}><ChevronRight size={14}/></button>
      </div>
    }/>
    <div className="adm-panel">
      {loading?<Spin/>:error?<Err m={error}/>:(
        <>
          <div className="adm-cal">
            {DOW.map(d=><div key={d} className="cal-dow">{d}</div>)}
            {cells.map((c,i)=>{
              if(!c) return <div key={i} className="cal-empty"/>;
              const info=c.info;
              const pct=info&&info.total?Math.round((info.booked/info.total)*100):null;
              return(
                <div key={i} className="cal-cell">
                  <span className="cal-d">{c.day}</span>
                  {pct!=null?(
                    <>
                      <span className="cal-occ">{info.booked}/{info.total}</span>
                      <div className="cal-bar"><i style={{width:pct+"%"}}/></div>
                    </>
                  ):<span className="cal-d" style={{opacity:.4}}>—</span>}
                </div>
              );
            })}
          </div>
          <p style={{fontSize:12,color:"var(--muted)",marginTop:12}}>Each cell: booked / total rooms for that night.</p>
        </>
      )}
    </div>
  </>);
}

function SecRooms(){
  const {data,error,loading,reload}=useLoad(adminRooms);
  const [rate,setRate]=useState({room_type_id:"",from:todayPlus(0),to:todayPlus(30),rate:""});
  const [msg,setMsg]=useState("");
  const applyRate=async()=>{
    if(!rate.room_type_id||!rate.rate){setMsg("Pick a room type and enter a rate.");return;}
    setMsg("");
    try{const r=await setRoomRate({...rate,rate:Number(rate.rate)});setMsg(`Updated ${r.updated} nights.`);reload();}
    catch(e){setMsg(e.message);}
  };
  const chStatus=async(id,status)=>{
    try{await setRoomStatus(id,status);reload();}catch(e){alert(e.message);}
  };
  if(loading) return <Spin/>;
  if(error)   return <Err m={error}/>;
  return(<>
    <AdmHead eyebrow="Inventory" title="Rooms"/>
    <div className="adm-panel">
      <h3>Room types</h3>
      <table className="adm-table">
        <thead><tr><th>Code</th><th>Name</th><th>Sleeps</th><th>Rooms</th><th>Rate today</th><th>Free today</th></tr></thead>
        <tbody>{data.types.map(t=>(
          <tr key={t.id}>
            <td className="mono">{t.code}</td><td>{t.name}</td><td>{t.max_occupancy}</td>
            <td>{t.total_rooms}</td><td className="mono">{rupee(t.rate_today??t.base_rate)}</td>
            <td>{t.available_today??"—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    <div className="adm-panel">
      <h3>Dynamic pricing</h3>
      <div className="adm-form-row">
        <div><label>Room type</label>
          <select value={rate.room_type_id} onChange={e=>setRate({...rate,room_type_id:e.target.value})}>
            <option value="">Select…</option>
            {data.types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div><label>From</label><input type="date" value={rate.from} onChange={e=>setRate({...rate,from:e.target.value})}/></div>
        <div><label>To</label><input type="date" value={rate.to} onChange={e=>setRate({...rate,to:e.target.value})}/></div>
        <div><label>Rate (₹)</label><input type="number" value={rate.rate} onChange={e=>setRate({...rate,rate:e.target.value})} placeholder="9500"/></div>
        <button className="adm-btn-brass" onClick={applyRate}>Apply</button>
      </div>
      {msg&&<div style={{fontSize:13,color:"var(--azure)"}}>{msg}</div>}
    </div>
    <div className="adm-panel">
      <h3>Housekeeping</h3>
      <table className="adm-table">
        <thead><tr><th>Room</th><th>Type</th><th>Status</th><th>Change</th></tr></thead>
        <tbody>{data.rooms.map(r=>(
          <tr key={r.id}>
            <td className="mono">{r.room_number}</td><td>{r.type}</td>
            <td><Pill v={r.status}/></td>
            <td><select value={r.status} onChange={e=>chStatus(r.id,e.target.value)}>
              {ROOM_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  </>);
}

function SecGuests(){
  const {data,error,loading,reload}=useLoad(adminGuests);
  const [editing,setEditing]=useState(null); // null | {} (new) | guest (edit)
  return(<>
    <AdmHead eyebrow="Relationships" title="Guests" right={
      <button className="adm-btn-brass" onClick={()=>setEditing({})}><Plus size={15} style={{verticalAlign:"-2px",marginRight:6}}/>Add guest</button>
    }/>
    <div className="adm-panel" style={{padding:0}}>
      {loading?<Spin/>:error?<Err m={error}/>:data.length===0?<div style={{padding:22}}><Empty t="No guests yet."/></div>:(
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Name</th><th>Contact</th><th>Stays</th><th>Last stay</th><th style={{textAlign:"right"}}>Lifetime value</th><th></th></tr></thead>
            <tbody>{data.map(g=>(
              <tr key={g.id}>
                <td>{g.full_name}</td>
                <td className="src">{g.email||"—"}{g.phone?` · ${g.phone}`:""}</td>
                <td>{g.stays}</td><td>{fmtDate(g.last_stay)}</td>
                <td className="mono" style={{textAlign:"right"}}>{rupee(g.lifetime_value)}</td>
                <td><button className="adm-icon-btn" title="Edit" onClick={()=>setEditing(g)}><Pencil size={15}/></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
    {editing!==null && <GuestModal guest={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);reload();}}/>}
  </>);
}

function GuestModal({guest,onClose,onSaved}){
  const isEdit=!!guest.id;
  const [f,setF]=useState({full_name:guest.full_name||"",phone:guest.phone||"",email:guest.email||"",address:guest.address||""});
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const save=async()=>{
    if(!f.full_name.trim()){setMsg("Name is required.");return;}
    setBusy(true);setMsg("");
    try{ isEdit?await adminUpdateGuest(guest.id,f):await adminAddGuest(f); onSaved(); }
    catch(e){ setMsg(e.message); }
    finally{ setBusy(false); }
  };
  return(
    <div className="modal-backdrop" onClick={e=>{if(e.target.classList.contains("modal-backdrop"))onClose();}}>
      <div className="adm-modal" style={{maxWidth:440}}>
        <div className="adm-modal-head"><h3>{isEdit?"Edit guest":"Add guest"}</h3><button onClick={onClose}><X size={20}/></button></div>
        <div className="adm-modal-body">
          <div className="adm-grid-fields">
            <div className="adm-field"><label>Full name *</label><input type="text" value={f.full_name} onChange={e=>setF({...f,full_name:e.target.value})}/></div>
            <div className="adm-field"><label>Phone</label><input type="text" value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></div>
            <div className="adm-field"><label>Email</label><input type="text" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></div>
            <div className="adm-field"><label>Address</label><input type="text" value={f.address} onChange={e=>setF({...f,address:e.target.value})}/></div>
          </div>
          {msg && <div style={{color:"var(--warn)",fontSize:13,marginTop:10}}>{msg}</div>}
          <button className="adm-btn-brass" style={{width:"100%",justifyContent:"center",marginTop:16}} onClick={save} disabled={busy}>{busy?"Saving…":(isEdit?"Save changes":"Add guest")}</button>
        </div>
      </div>
    </div>
  );
}

function SecExpenses(){
  const {data,error,loading,reload}=useLoad(adminExpenses);
  const [form,setForm]=useState({category:"Pool",description:"",amount:""});
  const [msg,setMsg]=useState("");
  const add=async()=>{
    if(!form.amount){setMsg("Enter an amount.");return;}
    setMsg("");
    try{await addExpense({...form,amount:Number(form.amount)});setForm({category:"Pool",description:"",amount:""});reload();}
    catch(e){setMsg(e.message);}
  };
  const total=(data||[]).reduce((s,e)=>s+Number(e.amount),0);
  return(<>
    <AdmHead eyebrow="Operations" title="Expenses"/>
    <div className="adm-panel">
      <h3>Record an expense</h3>
      <div className="adm-form-row">
        <div><label>Category</label>
          <select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>
            {EXPENSE_CATS.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{gridColumn:"span 2"}}><label>Description</label>
          <input type="text" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="optional"/>
        </div>
        <div><label>Amount (₹)</label><input type="number" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></div>
        <button className="adm-btn-brass" onClick={add}>Add</button>
      </div>
      {msg&&<div style={{fontSize:13,color:"var(--warn)"}}>{msg}</div>}
    </div>
    <div className="adm-panel" style={{padding:0}}>
      {loading?<Spin/>:error?<Err m={error}/>:data.length===0?<div style={{padding:22}}><Empty t="No expenses recorded."/></div>:(
        <table className="adm-table">
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th style={{textAlign:"right"}}>Amount</th></tr></thead>
          <tbody>
            {data.map(e=>(
              <tr key={e.id}>
                <td>{fmtDate(e.spent_on)}</td><td>{e.category}</td>
                <td className="src">{e.description||"—"}</td>
                <td className="mono" style={{textAlign:"right"}}>{rupee(e.amount)}</td>
              </tr>
            ))}
            <tr style={{fontWeight:600}}>
              <td colSpan={3}>Total shown</td>
              <td className="mono" style={{textAlign:"right"}}>{rupee(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  </>);
}

function SecStaff(){
  const {data,error,loading,reload}=useLoad(adminUsers);
  const [form,setForm]=useState({username:"",full_name:"",password:"",role:"staff"});
  const [msg,setMsg]=useState("");
  const create=async()=>{
    if(!form.username||!form.password){setMsg("Username and password are required.");return;}
    setMsg("");
    try{await addUser(form);setForm({username:"",full_name:"",password:"",role:"staff"});reload();setMsg("Staff account created.");}
    catch(e){setMsg(e.message);}
  };
  return(<>
    <AdmHead eyebrow="Access" title="Staff"/>
    <div className="adm-panel">
      <h3>Add a staff member</h3>
      <div className="adm-form-row">
        <div><label>Username</label><input type="text" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></div>
        <div><label>Full name</label><input type="text" value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/></div>
        <div><label>Password</label><input type="text" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></div>
        <div><label>Role</label>
          <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
            {STAFF_ROLES.map(r=><option key={r}>{r}</option>)}
          </select>
        </div>
        <button className="adm-btn-brass" onClick={create}>Create</button>
      </div>
      {msg&&<div style={{fontSize:13,color:"var(--azure)"}}>{msg}</div>}
    </div>
    <div className="adm-panel" style={{padding:0}}>
      {loading?<Spin/>:error?<Err m={error}/>:data.length===0?<div style={{padding:22}}><Empty t="No staff accounts."/></div>:(
        <table className="adm-table">
          <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Created</th></tr></thead>
          <tbody>{data.map(u=>(
            <tr key={u.id}>
              <td className="mono">{u.username}</td><td>{u.full_name||"—"}</td>
              <td style={{textTransform:"capitalize"}}>{u.role}</td><td>{fmtDate(u.created_at)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  </>);
}

// ══════════════════════════════════════════════════════════════════
//  PUBLIC SITE
// ══════════════════════════════════════════════════════════════════
function PublicSite(){
  const [navOpen,setNavOpen]=useState(false);
  const [scrolled,setScrolled]=useState(false);
  const [rooms,setRooms]=useState(FALLBACK_ROOMS);
  const [checkIn,setCheckIn]=useState(todayPlus(7));
  const [checkOut,setCheckOut]=useState(todayPlus(9));
  const [guests,setGuests]=useState(2);
  const [result,setResult]=useState(null);
  const [checking,setChecking]=useState(false);
  const roomsRef=useRef(null);
  const [booking,setBooking]=useState(null);
  const [form,setForm]=useState({full_name:"",email:"",phone:""});
  const [confirmation,setConfirmation]=useState(null);
  const [submitting,setSubmitting]=useState(false);
  const [bookErr,setBookErr]=useState("");

  useEffect(()=>{
    const onScroll=()=>setScrolled(window.scrollY>40);
    window.addEventListener("scroll",onScroll);
    return()=>window.removeEventListener("scroll",onScroll);
  },[]);
  useEffect(()=>{
    getRooms().then(d=>{if(Array.isArray(d)&&d.length)setRooms(d);}).catch(()=>{});
  },[]);

  const runCheck=async()=>{
    setChecking(true);setResult(null);
    try{
      const d=await checkAvailability(checkIn,checkOut,guests);
      const res={live:true,...d};
      setResult(res);
      if(res.room_types?.length){
        setTimeout(()=>roomsRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),80);
      }
    }catch{
      const nights=Math.max(1,Math.round((new Date(checkOut)-new Date(checkIn))/86400000));
      setResult({live:false,nights,room_types:rooms.map(r=>({...r,available_units:3,avg_rate:r.base_rate}))});
      setTimeout(()=>roomsRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),80);
    }finally{setChecking(false);}
  };

  const openBooking=rt=>{setBooking(rt);setBookErr("");setConfirmation(null);};
  const submitBooking=async()=>{
    if(!form.full_name.trim()){setBookErr("Please enter your name.");return;}
    if(!form.phone.trim()){setBookErr("Please enter your phone number.");return;}
    setSubmitting(true);setBookErr("");
    try{
      const d=await createBooking({room_type_id:booking.id,check_in:checkIn,check_out:checkOut,num_guests:guests,guest:form});
      setConfirmation(d.booking);
    }catch(e){
      setBookErr(e.message==="Failed to fetch"?"Start the backend to make a real reservation.":e.message);
    }finally{setSubmitting(false);}
  };

  const displayRooms=result?.room_types?.length?result.room_types:rooms;
  const navLinks=["Rooms","The Pool","Amenities","Gallery","Explore","Contact"];

  return(
    <div className="ma-root">
      <style>{CSS}</style>

      {/* ── HEADER ── */}
      <header className={`ma-head ${scrolled?"solid":"bare"}`}>
        <div className="ma-wrap ma-head-row">
          <div className="ma-logo"><b>Sunshine</b><span>Pondicherry</span></div>
          <nav className="ma-nav">
            {navLinks.map(l=><a key={l} href={`#${l.toLowerCase().replace(/\s/g,"")}`}>{l}</a>)}
            <button className="ma-btn ma-btn-brass" onClick={()=>window.scrollTo({top:0,behavior:"smooth"})}>Book Direct</button>
          </nav>
          <button className="ma-burger" onClick={()=>setNavOpen(v=>!v)}>{navOpen?<X size={24}/>:<Menu size={24}/>}</button>
        </div>
        {navOpen&&(
          <div className="ma-mobile-nav">
            {navLinks.map(l=>(
              <a key={l} href={`#${l.toLowerCase().replace(/\s/g,"")}`} onClick={()=>setNavOpen(false)}>{l}</a>
            ))}
          </div>
        )}
      </header>

      {/* ── HERO ── */}
      <section className="ma-hero" style={{backgroundImage:"linear-gradient(180deg,rgba(14,42,56,.45),rgba(14,42,56,.15) 35%,rgba(14,42,56,.72)),url('https://images.unsplash.com/photo-1582610116397-edb318620f90?w=1900&q=80')"}}>
        <div className="ma-wrap ma-hero-inner">
          <div className="ma-eyebrow">A 15-room coastal retreat</div>
          <h1>Where the sea shore meets quiet luxury.</h1>
          <p>An intimate boutique resort on the Coromandel coast — fifteen rooms, one saltwater pool, and the unhurried grace of French-colonial Pondicherry.</p>
          <div className="ma-hero-cta">
            <a href="#rooms" className="ma-btn ma-btn-brass">Explore Rooms <ChevronRight size={15}/></a>
            <a href="#thepool" className="ma-btn ma-btn-ghost-light">See the Pool</a>
          </div>
        </div>
      </section>

      {/* ── BOOKING BAR ── */}
      <div className="ma-wrap">
        <div className="ma-book">
          <div className="ma-book-grid">
            <div className="ma-field"><label><CalendarDays size={12}/> Check in</label>
              <input type="date" value={checkIn} min={todayPlus(0)} onChange={e=>setCheckIn(e.target.value)}/></div>
            <div className="ma-field"><label><CalendarDays size={12}/> Check out</label>
              <input type="date" value={checkOut} min={checkIn} onChange={e=>setCheckOut(e.target.value)}/></div>
            <div className="ma-field"><label><Users size={12}/> Guests</label>
              <div className="ma-stepper">
                <button onClick={()=>setGuests(g=>Math.max(1,g-1))}><Minus size={13}/></button>
                <span>{guests}</span>
                <button onClick={()=>setGuests(g=>Math.min(6,g+1))}><Plus size={13}/></button>
              </div>
            </div>
            <button className="ma-btn ma-btn-brass" onClick={runCheck} disabled={checking}>{checking?"Checking…":"Check Availability"}</button>
          </div>
          {result&&(result.room_types?.length?(
            <div className="ma-result">
              <Star size={14} color="var(--brass)" fill="var(--brass)"/>
              <span><b>{result.room_types.length} room type{result.room_types.length!==1?"s":""}</b> available for {result.nights} nights — book direct for the best rate &amp; breakfast.
                {!result.live&&" (sample data — start backend for live availability)"}</span>
            </div>
          ):(
            <div className="ma-result ma-result-none">
              <X size={14}/>
              <span>No rooms available from <b>{fmtDate(checkIn)}</b> to <b>{fmtDate(checkOut)}</b>. Please try different dates.</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── INTRO ── */}
      <section className="ma-sec ma-wrap" id="about">
        <div className="ma-intro">
          <Reveal>
            <div className="ma-eyebrow">The house</div>
            <h2 className="ma-h2">Small by design, generous by nature.</h2>
            <p className="ma-lede">With only fifteen rooms, every stay at Sunshine is personal. We trade the scale of a grand hotel for something rarer — a place where the staff know your name, the kitchen cooks to the morning's catch, and the pool is never crowded.</p>
            <div className="ma-stat-row">
              <div className="ma-stat"><b>15</b><span>Rooms only</span></div>
              <div className="ma-stat"><b>1:1</b><span>Staff to room</span></div>
              <div className="ma-stat"><b>4.9</b><span>Guest rating</span></div>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="ma-intro-img" style={{backgroundImage:"url('https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1000&q=80')"}}/>
          </Reveal>
        </div>
      </section>

      {/* ── ROOMS ── */}
      <section className="ma-sec ma-wrap" id="rooms" style={{paddingTop:0}} ref={roomsRef}>
        <div className="ma-sec-head">
          <div className="ma-eyebrow">Stay with us</div>
          <h2 className="ma-h2">Three ways to settle in.</h2>
          <p className="ma-lede">Each room is its own room. Rates shown are nightly, inclusive of breakfast for direct bookings.</p>
        </div>
        <div className="ma-rooms">
          {displayRooms.map((r,i)=>{
            const rate=r.avg_rate||r.base_rate;
            return(
              <Reveal key={r.code||i} delay={i*100}>
                <article className="ma-card">
                  <div className="ma-card-img" style={{backgroundImage:`url('${r.img||IMG_BY_CODE[r.code]||GALLERY[0]}')`}}>
                    <span className="ma-tag">{r.code}</span>
                  </div>
                  <div className="ma-card-body">
                    <h3>{r.name}</h3>
                    <div className="ma-card-meta">Up to {r.max_occupancy} guests</div>
                    <p>{r.description}</p>
                    <div className="ma-card-foot">
                      <div className="ma-price">
                        <b>{rupee(rate)}</b><span> / night</span>
                        {r.available_units!=null&&<div className="ma-left">{r.available_units} left for your dates</div>}
                      </div>
                      <button className="ma-btn ma-btn-ghost" style={{padding:"10px 16px"}} onClick={()=>openBooking(r)} disabled={!r.id}>
                        Reserve <ArrowUpRight size={14}/>
                      </button>
                    </div>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
        {!displayRooms.some(r=>r.id)&&<p style={{fontSize:12,color:"#888",marginTop:16}}>Reserve enabled once the backend + database are running.</p>}
      </section>

      {/* ── POOL ── */}
      <section className="ma-pool" id="thepool" style={{backgroundImage:"linear-gradient(rgba(14,42,56,.55),rgba(14,42,56,.7)),url('https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1900&q=80')"}}>
        <div className="ma-wrap">
          <Reveal>
            <div className="ma-eyebrow">The pool</div>
            <h2 className="ma-h2" style={{color:"#fff",maxWidth:560}}>A saltwater pool, kept immaculate, kept yours.</h2>
            <p style={{maxWidth:480,fontSize:17,color:"rgba(255,255,255,.9)"}}>Tested every morning at first light. With only fifteen rooms, the water is rarely shared.</p>
            <div style={{marginTop:26}}><a href="#rooms" className="ma-btn ma-btn-brass">Reserve a Poolside Cabana <ChevronRight size={15}/></a></div>
          </Reveal>
        </div>
      </section>

      {/* ── AMENITIES ── */}
      <section className="ma-sec ma-wrap" id="amenities">
        <div className="ma-sec-head">
          <div className="ma-eyebrow">Everything you need</div>
          <h2 className="ma-h2">Considered comforts.</h2>
          <p className="ma-lede">Seven thoughtfully designed amenities — each one curated for stillness, discovery, and the pleasure of being exactly where you are.</p>
        </div>
        <div className="ma-amen-grid">
          {AMENITIES.map((a, i) => (
            <Reveal key={a.label} delay={i * 60}>
              <div className="ma-amen-card">
                <div className="ma-amen-img" style={{ backgroundImage: `url('${a.img}')` }}>
                  <div className="ma-amen-icon-wrap">
                    <a.icon size={22} strokeWidth={1.5} />
                  </div>
                </div>
                <div className="ma-amen-body">
                  <h3>{a.label}</h3>
                  <p>{a.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── PERKS BAND ── */}
      <section className="ma-perks">
        <div className="ma-wrap ma-perks-row">
          <div>
            <div className="ma-eyebrow" style={{color:"#E7D6AE"}}>Member rate</div>
            <h2 className="ma-h2" style={{color:"#fff",fontSize:"clamp(26px,3.2vw,40px)"}}>Book here, not there — and keep the difference.</h2>
            <ul className="ma-perks-list">
              <li><Star size={13} fill="var(--brass)"/> Best-rate guarantee</li>
              <li><Coffee size={13}/> Free breakfast</li>
              <li><MapPin size={13}/> Late checkout</li>
            </ul>
          </div>
          <a href="#rooms" className="ma-btn ma-btn-brass">Unlock Member Rates</a>
        </div>
      </section>

      {/* ── GALLERY ── */}
      <section className="ma-sec ma-wrap" id="gallery">
        <div className="ma-sec-head">
          <div className="ma-eyebrow">The setting</div>
          <h2 className="ma-h2">A look around.</h2>
        </div>
        <div className="ma-gallery">
          {GALLERY.map((g,i)=>(
            <Reveal key={i} delay={i*70}>
              <div style={{backgroundImage:`url('${g}')`,height:"100%"}}/>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── NEARBY ATTRACTIONS ── */}
      <section className="ma-sec ma-wrap" id="explore">
        <div className="ma-sec-head">
          <div className="ma-eyebrow">Around Serenity Beach</div>
          <h2 className="ma-h2">Explore Pondicherry.</h2>
          <p className="ma-lede">Step beyond the resort and discover one of India's most charming coastal towns — French boulevards, ancient temples, vibrant bazaars, and the endless Bay of Bengal.</p>
        </div>

        {/* Places */}
        <div className="ma-eyebrow" style={{marginBottom:18}}>Tourist Places Nearby</div>
        <div className="ma-attract-grid">
          {[
            {
              title:"Serenity Beach",
              dist:"2 min walk",
              img:"https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80",
              desc:"A wide, quiet stretch of golden sand less crowded than Paradise Beach. Perfect for sunrise walks and early-morning swims in the calm Bay of Bengal.",
            },
            {
              title:"Auroville",
              dist:"12 km · 20 min",
              img:"https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800&q=80",
              desc:"An experimental universal township founded in 1968. Visit the iconic Matrimandir — a golden sphere set in landscaped gardens — and explore the many artisan boutiques.",
            },
            {
              title:"French Quarter (White Town)",
              dist:"8 km · 15 min",
              img:"https://images.unsplash.com/photo-1568454537842-d933259bb258?w=800&q=80",
              desc:"Shaded promenades lined with mustard-yellow colonial buildings, bougainvillea cascading over iron balconies, and the iconic Pondicherry Lighthouse overlooking the seafront.",
            },
            {
              title:"Sri Aurobindo Ashram",
              dist:"8 km · 15 min",
              img:"https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=800&q=80",
              desc:"A living spiritual community founded in 1926. The flower-filled inner courtyard and library hold works of Sri Aurobindo and The Mother — a place of profound calm.",
            },
            {
              title:"Manakula Vinayagar Temple",
              dist:"9 km · 18 min",
              img:"https://images.unsplash.com/photo-1604537466608-109fa2f16c3b?w=800&q=80",
              desc:"One of Pondicherry's most beloved temples, famous for its elephant Lakshmi who blesses visitors every morning. The golden gopuram glows brilliantly at dusk.",
            },
            {
              title:"Paradise Beach",
              dist:"15 km · 30 min",
              img:"https://images.unsplash.com/photo-1520454974749-a09a77e8df1e?w=800&q=80",
              desc:"Accessible only by a 10-minute ferry ride across the Chunnambar backwaters, this secluded beach rewards the short journey with pristine sand and crystal-clear water.",
            },
            {
              title:"Chunnambar Boat House",
              dist:"14 km · 28 min",
              img:"https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800&q=80",
              desc:"A scenic backwater resort where the river meets the sea. Hire a rowing boat or paddleboat to drift through mangrove channels — magical at golden hour.",
            },
            {
              title:"Botanical Garden",
              dist:"10 km · 20 min",
              img:"https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=80",
              desc:"Established in 1826 by the French, this sprawling 22-acre garden houses rare tropical species, a French fountain, and a musical fountain show on weekend evenings.",
            },
          ].map((p,i)=>(
            <Reveal key={p.title} delay={i*60}>
              <div className="ma-attract-card">
                <div className="ma-attract-img" style={{backgroundImage:`url('${p.img}')`}}>
                  <span className="ma-attract-dist">{p.dist}</span>
                </div>
                <div className="ma-attract-body">
                  <h3>{p.title}</h3>
                  <p>{p.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Activities */}
        <div className="ma-eyebrow" style={{margin:"56px 0 18px"}}>Fun Activities</div>
        <div className="ma-activity-grid">
          {[
            { emoji:"🏄", title:"Surfing & Boogie Boarding", desc:"Serenity Beach is Pondicherry's surf hub. Certified instructors offer lessons for all levels from October through March when the swells are consistent." },
            { emoji:"🚴", title:"Cycling the French Quarter", desc:"Rent a bicycle and pedal the leafy streets of White Town at your own pace — past boulangeries, heritage museums, and seafront promenades." },
            { emoji:"🤿", title:"Scuba Diving", desc:"Dive sites off the Pondicherry coast feature coral gardens, sea turtles, and occasional reef sharks. Dive centres offer PADI certification courses." },
            { emoji:"🚶", title:"Backwater Kayaking", desc:"Paddle through the tranquil mangrove-lined backwaters of Chunnambar with a local guide — spot egrets, kingfishers, and otters along the way." },
            { emoji:"🧘", title:"Sunrise Yoga on the Beach", desc:"Join a guided yoga session on the sand each morning as the sun rises over the Bay of Bengal — a ritual that sets the tone for the entire day." },
            { emoji:"🎣", title:"Traditional Fishing with Locals", desc:"Head out before dawn with the Serenity Beach fishing community on a traditional catamaran — cast nets by hand and return for a fresh-catch breakfast." },
            { emoji:"🛵", title:"Scooter Day Trips", desc:"Hire a scooter and explore on your own terms — Auroville, the mustard fields of Villianur, or the sleepy French enclave of Karikal are all within reach." },
            { emoji:"🍽️", title:"Tamil & French Fusion Cooking Class", desc:"Learn to cook Pondicherry's unique Franco-Tamil cuisine — from fish moilee to crème brûlée — with a local chef in a heritage kitchen." },
            { emoji:"🌅", title:"Sunset Catamaran Cruise", desc:"Sail along the Coromandel coast at dusk on a traditional wooden catamaran, watching the sky turn amber over the water with a cold drink in hand." },
            { emoji:"🎨", title:"Auroville Artisan Workshops", desc:"Participate in handmade paper, pottery, incense-rolling, or natural perfume workshops run by Auroville artisans — meaningful souvenirs to take home." },
          ].map((a,i)=>(
            <Reveal key={a.title} delay={i*50}>
              <div className="ma-activity-card">
                <div className="ma-activity-emoji">{a.emoji}</div>
                <h4>{a.title}</h4>
                <p>{a.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="ma-foot" id="contact">
        <div className="ma-wrap">
          <div className="ma-foot-grid">
            <div>
              <div className="ma-logo" style={{color:"#fff",marginBottom:16}}><b>Sunshine</b><span>Pondicherry</span></div>
              <p style={{maxWidth:300,fontSize:14}}>A fifteen-room boutique resort on the Coromandel coast.</p>
            </div>
            <div>
              <h4 className="ma-foot-h4">Visit</h4>
              <p style={{display:"flex",gap:9,alignItems:"center",fontSize:14,marginBottom:10}}><MapPin size={14}/> White Town, Puducherry, India</p>
              <p style={{display:"flex",gap:9,alignItems:"center",fontSize:14,marginBottom:10}}><Phone size={14}/> +91 90000 00000</p>
              <p style={{display:"flex",gap:9,alignItems:"center",fontSize:14}}><Mail size={14}/> stay@maisonazure.in</p>
            </div>
            <div>
              <h4 className="ma-foot-h4">Explore</h4>
              {navLinks.map(l=>(
                <a key={l} href={`#${l.toLowerCase().replace(/\s/g,"")}`} style={{display:"block",fontSize:14,marginBottom:10}}>{l}</a>
              ))}
            </div>
          </div>
          <div className="ma-foot-bot">
            <span>© {new Date().getFullYear()} Sunshine. All rights reserved.</span>
            <div style={{display:"flex",gap:16,alignItems:"center"}}>
              <span style={{fontSize:11,opacity:.6,letterSpacing:".1em",textTransform:"uppercase"}}>Booking.com · Agoda · MakeMyTrip</span>
            </div>
          </div>
        </div>
      </footer>

      {/* ── GUEST BOOKING MODAL ── */}
      {booking&&(
        <div className="modal-backdrop" onClick={e=>{if(e.target.classList.contains("modal-backdrop"))setBooking(null);}}>
          <div className="booking-card">
            {!confirmation?(
              <>
                <div className="booking-head">
                  <div>
                    <div className="ma-eyebrow" style={{color:"var(--brass)"}}>Reserve</div>
                    <h3 style={{fontFamily:"var(--serif)",fontSize:26,color:"var(--ink)",marginTop:4}}>{booking.name}</h3>
                  </div>
                  <button style={{background:"none",border:"none",cursor:"pointer",color:"#888"}} onClick={()=>setBooking(null)}><X size={22}/></button>
                </div>
                <div className="booking-body">
                  <div className="booking-row"><span>Check in</span><b>{checkIn}</b></div>
                  <div className="booking-row"><span>Check out</span><b>{checkOut}</b></div>
                  <div className="booking-row"><span>Guests</span><b>{guests}</b></div>
                  <div className="booking-row"><span>Rate / night</span><b>{rupee(booking.avg_rate||booking.base_rate)}</b></div>
                  <input className="booking-input" placeholder="Full name *" value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/>
                  <input className="booking-input" placeholder="Phone number *" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} type="tel"/>
                  <input className="booking-input" placeholder="Email (optional)" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
                  {bookErr&&<div style={{color:"#b4452f",fontSize:13,marginTop:10}}>{bookErr}</div>}
                  <button className="ma-btn ma-btn-brass" style={{width:"100%",justifyContent:"center",marginTop:18,padding:15}} onClick={submitBooking} disabled={submitting}>
                    {submitting?"Reserving…":"Confirm Reservation"}
                  </button>
                </div>
              </>
            ):(
              <div style={{padding:"28px 28px 32px",textAlign:"center"}}>
                <div style={{width:52,height:52,borderRadius:"50%",background:"var(--brass)",color:"#fff",display:"grid",placeItems:"center",margin:"0 auto 16px"}}>
                  <Check size={26}/>
                </div>
                <h3 style={{fontFamily:"var(--serif)",fontSize:28,color:"var(--ink)"}}>You're booked.</h3>
                <p style={{color:"#67767c",fontSize:14,margin:"8px 0 0"}}>Confirmation reference:</p>
                <div style={{fontFamily:"var(--mono)",fontSize:22,color:"var(--brass)",margin:"14px 0",letterSpacing:".12em",fontWeight:500}}>{confirmation.reference}</div>
                <div style={{fontSize:13,color:"#46555c"}}>Total: <b>{rupee(confirmation.total_amount)}</b></div>
                <button className="ma-btn ma-btn-brass" style={{marginTop:20,padding:"12px 28px"}} onClick={()=>setBooking(null)}>Done</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  ALL CSS  (public site + admin + modals in one block)
// ══════════════════════════════════════════════════════════════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:ital,wght@0,400;0,500;1,400&display=swap');

/* ── root tokens ── */
.ma-root,.adm{
  --ink:#0E2A38; --azure:#2C7DA0; --sand:#F3EEE4; --paper:#FBFAF7;
  --brass:#B08D4F; --charcoal:#1B2429; --line:rgba(14,42,56,.13);
  --serif:'Playfair Display',Georgia,serif; --sans:'Inter',system-ui,sans-serif; --mono:'IBM Plex Mono','DM Mono',monospace;
  --good:#2e7d52; --warn:#b4452f; --muted:#67767c;
  -webkit-font-smoothing:antialiased; line-height:1.55;
}
*{box-sizing:border-box;}
.ma-root{font-family:var(--sans);color:var(--charcoal);background:var(--paper);}
.ma-root h1,.ma-root h2,.ma-root h3{margin:0;font-weight:500;font-family:var(--serif);}
.ma-eyebrow{font-size:11px;letter-spacing:.26em;text-transform:uppercase;font-weight:600;color:var(--brass);}
.ma-wrap{max-width:1200px;margin:0 auto;padding:0 28px;}
.ma-btn{font-family:var(--sans);font-weight:600;font-size:13px;letter-spacing:.05em;text-transform:uppercase;
  cursor:pointer;border:none;transition:.22s;display:inline-flex;align-items:center;gap:7px;text-decoration:none;}
.ma-btn-brass{background:var(--brass);color:#fff;padding:14px 24px;}
.ma-btn-brass:hover{background:#9a7838;} .ma-btn-brass:disabled{opacity:.6;cursor:default;}
.ma-btn-ghost{background:transparent;color:var(--ink);border:1px solid var(--line);padding:13px 22px;}
.ma-btn-ghost:hover{border-color:var(--ink);}
.ma-btn-ghost-light{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);padding:13px 22px;font-family:var(--sans);font-weight:600;font-size:13px;letter-spacing:.05em;text-transform:uppercase;display:inline-flex;align-items:center;gap:7px;text-decoration:none;transition:.22s;}
.ma-btn-ghost-light:hover{border-color:#fff;}
a{color:inherit;text-decoration:none;}
:focus-visible{outline:2px solid var(--azure);outline-offset:2px;}

/* ── header ── */
.ma-head{position:fixed;inset:0 0 auto 0;z-index:40;transition:.28s;}
.ma-head.bare{background:transparent;}
.ma-head.solid{background:var(--paper);box-shadow:0 1px 0 var(--line);}
.ma-head-row{display:flex;align-items:center;justify-content:space-between;height:72px;}
.ma-logo{font-family:var(--serif);font-size:24px;letter-spacing:.04em;display:flex;align-items:baseline;gap:8px;color:var(--ink);}
.ma-logo b{font-weight:600;}
.ma-logo span{font-family:var(--sans);font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:var(--brass);}
.ma-head.bare .ma-logo,.ma-head.bare .ma-nav a,.ma-head.bare .ma-burger{color:#fff;}
.ma-head.bare .ma-btn-ghost{color:#fff;border-color:rgba(255,255,255,.4);}
.ma-nav{display:flex;gap:22px;align-items:center;}
.ma-nav a{font-size:13px;font-weight:500;letter-spacing:.03em;position:relative;padding:3px 0;}
.ma-nav a::after{content:'';position:absolute;left:0;bottom:0;height:1px;width:0;background:var(--brass);transition:.3s;}
.ma-nav a:hover::after{width:100%;}
.ma-burger{display:none;background:none;border:none;cursor:pointer;color:var(--ink);}
.ma-mobile-nav{background:var(--paper);padding:4px 28px 20px;box-shadow:0 12px 24px -12px rgba(0,0,0,.18);}
.ma-mobile-nav a{display:block;padding:13px 0;font-size:15px;border-bottom:1px solid var(--line);color:var(--ink);}

/* ── hero ── */
.ma-hero{min-height:92vh;display:flex;align-items:flex-end;background-size:cover;background-position:center;}
.ma-hero-inner{padding-bottom:160px;color:#fff;max-width:680px;}
.ma-hero .ma-eyebrow{color:#E7D6AE;}
.ma-hero h1{font-size:clamp(40px,6vw,80px);color:#fff;margin:14px 0 16px;}
.ma-hero p{font-size:18px;color:rgba(255,255,255,.9);max-width:520px;}
.ma-hero-cta{margin-top:28px;display:flex;gap:14px;flex-wrap:wrap;}

/* ── booking bar ── */
.ma-book{position:relative;z-index:20;margin:-74px auto 0;max-width:1060px;
  background:rgba(251,250,247,.84);backdrop-filter:blur(14px);
  border:1px solid rgba(176,141,79,.38);box-shadow:0 26px 56px -26px rgba(14,42,56,.48);padding:10px;}
.ma-book-grid{display:grid;grid-template-columns:1.3fr 1.3fr 1fr auto;gap:1px;background:var(--line);}
.ma-field{background:var(--paper);padding:15px 18px;}
.ma-field label{display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--azure);font-weight:600;margin-bottom:5px;}
.ma-field input{border:none;background:transparent;font-family:var(--sans);font-size:15px;font-weight:500;color:var(--ink);width:100%;}
.ma-field input:focus{outline:none;}
.ma-stepper{display:flex;align-items:center;gap:12px;}
.ma-stepper button{width:24px;height:24px;border:1px solid var(--line);background:#fff;cursor:pointer;display:grid;place-items:center;}
.ma-stepper span{font-size:15px;font-weight:600;min-width:14px;text-align:center;}
.ma-book .ma-btn-brass{justify-content:center;padding:0 28px;}
.ma-result{padding:13px 18px;font-size:13.5px;border-top:1px solid var(--line);display:flex;align-items:center;gap:9px;}
.ma-result b{color:var(--brass);}
.ma-result-none{color:#b4452f;}
.ma-result-none b{color:#b4452f;}

/* ── sections ── */
.ma-sec{padding:96px 0;}
.ma-sec-head{max-width:600px;margin-bottom:52px;}
.ma-h2{font-size:clamp(30px,4vw,50px);color:var(--ink);margin:12px 0 0;}
.ma-lede{font-size:17px;color:#46555c;margin-top:16px;}
.ma-intro{display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center;}
.ma-intro-img{aspect-ratio:4/5;background-size:cover;background-position:center;}
.ma-stat-row{display:flex;gap:36px;margin-top:30px;border-top:1px solid var(--line);padding-top:26px;}
.ma-stat b{font-family:var(--serif);font-size:36px;color:var(--brass);display:block;line-height:1;}
.ma-stat span{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}

/* ── room cards ── */
.ma-rooms{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;}
.ma-card{background:#fff;border:1px solid var(--line);overflow:hidden;display:flex;flex-direction:column;transition:.32s;}
.ma-card:hover{box-shadow:0 22px 46px -24px rgba(14,42,56,.38);transform:translateY(-4px);}
.ma-card-img{aspect-ratio:3/2;background:#c3d0d4 center/cover;position:relative;}
.ma-tag{position:absolute;top:13px;left:13px;background:rgba(251,250,247,.92);font-size:11px;letter-spacing:.07em;padding:5px 10px;color:var(--ink);font-weight:600;}
.ma-card-body{padding:24px;display:flex;flex-direction:column;flex:1;}
.ma-card h3{font-family:var(--serif);font-size:24px;color:var(--ink);}
.ma-card-meta{font-size:12px;color:var(--muted);margin:6px 0 12px;letter-spacing:.04em;text-transform:uppercase;}
.ma-card p{font-size:14px;color:#46555c;flex:1;}
.ma-card-foot{display:flex;align-items:flex-end;justify-content:space-between;margin-top:20px;padding-top:16px;border-top:1px solid var(--line);}
.ma-price b{font-family:var(--sans);font-size:24px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
.ma-price span{font-size:12px;color:var(--muted);}
.ma-left{font-size:11px;color:var(--brass);font-weight:600;letter-spacing:.04em;}

/* ── pool ── */
.ma-pool{padding:110px 0;background-size:cover;background-position:center;color:#fff;}
.ma-pool .ma-eyebrow{color:#E7D6AE;}

/* ── amenities ── */
.ma-amen-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;}
.ma-amen-card{background:#fff;border:1px solid var(--line);overflow:hidden;display:flex;flex-direction:column;transition:.32s;}
.ma-amen-card:hover{transform:translateY(-5px);box-shadow:0 20px 48px -20px rgba(14,42,56,.28);}
.ma-amen-img{position:relative;aspect-ratio:16/9;background:#c3d0d4 center/cover;}
.ma-amen-icon-wrap{position:absolute;bottom:14px;left:14px;width:44px;height:44px;background:rgba(251,250,247,.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;color:var(--brass);}
.ma-amen-body{padding:22px 24px;flex:1;}
.ma-amen-body h3{font-family:var(--serif);font-size:21px;color:var(--ink);margin:0 0 10px;font-weight:500;}
.ma-amen-body p{font-size:14px;color:#46555c;line-height:1.7;margin:0;}

/* ── nearby attractions ── */
.ma-attract-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px;margin-bottom:8px;}
.ma-attract-card{background:#fff;border:1px solid var(--line);overflow:hidden;border-radius:2px;display:flex;flex-direction:column;transition:.3s;}
.ma-attract-card:hover{transform:translateY(-5px);box-shadow:0 18px 40px -18px rgba(14,42,56,.28);}
.ma-attract-img{position:relative;aspect-ratio:4/3;background:#c3d0d4 center/cover;}
.ma-attract-dist{position:absolute;bottom:10px;left:10px;background:rgba(251,250,247,.92);font-size:11px;font-weight:600;padding:4px 10px;color:var(--ink);letter-spacing:.04em;}
.ma-attract-body{padding:18px 20px;flex:1;}
.ma-attract-body h3{font-family:var(--serif);font-size:20px;color:var(--ink);margin:0 0 8px;}
.ma-attract-body p{font-size:13.5px;color:#46555c;line-height:1.6;margin:0;}

.ma-activity-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:18px;}
.ma-activity-card{background:var(--paper);border:1px solid var(--line);padding:22px 18px;transition:.28s;border-radius:2px;}
.ma-activity-card:hover{transform:translateY(-4px);box-shadow:0 12px 32px -14px rgba(14,42,56,.22);border-color:var(--brass);}
.ma-activity-emoji{font-size:28px;margin-bottom:12px;}
.ma-activity-card h4{font-family:var(--serif);font-size:17px;color:var(--ink);margin:0 0 8px;font-weight:500;}
.ma-activity-card p{font-size:13px;color:#46555c;line-height:1.65;margin:0;}

/* ── perks ── */
.ma-perks{background:var(--ink);padding:76px 0;}
.ma-perks-row{display:flex;align-items:center;justify-content:space-between;gap:36px;flex-wrap:wrap;}
.ma-perks-list{list-style:none;padding:0;margin:14px 0 0;display:flex;gap:24px;flex-wrap:wrap;}
.ma-perks-list li{font-size:14px;color:rgba(255,255,255,.85);display:flex;gap:7px;align-items:center;}

/* ── gallery ── */
.ma-gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.ma-gallery div{aspect-ratio:3/4;background:#c3d0d4 center/cover;transition:.38s;}
.ma-gallery div:hover{filter:brightness(1.06);transform:scale(1.01);}

/* ── footer ── */
.ma-foot{background:#0A1F29;color:rgba(255,255,255,.68);padding:68px 0 34px;}
.ma-foot-grid{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:44px;margin-bottom:44px;}
.ma-foot-h4{color:#fff;font-family:var(--sans);font-size:11px;letter-spacing:.16em;text-transform:uppercase;margin:0 0 16px;}
.ma-foot a:hover{color:#fff;}
.ma-foot-bot{border-top:1px solid rgba(255,255,255,.12);padding-top:24px;display:flex;justify-content:space-between;font-size:12px;flex-wrap:wrap;gap:12px;align-items:center;}

/* ── modals (login + guest booking) ── */
.modal-backdrop{position:fixed;inset:0;z-index:100;background:rgba(10,31,41,.58);backdrop-filter:blur(4px);display:grid;place-items:center;padding:20px;}
.login-card{background:var(--paper);width:100%;max-width:400px;padding:38px 34px;border-top:3px solid var(--brass);box-shadow:0 32px 72px -24px rgba(0,0,0,.55);position:relative;}
.login-close{position:absolute;top:14px;right:14px;background:none;border:none;cursor:pointer;color:var(--muted);}
.login-brand{font-family:var(--serif);font-size:28px;color:var(--ink);display:flex;align-items:baseline;gap:8px;}
.login-brand span{font-family:var(--sans);font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:var(--brass);}
.login-sub{font-size:12px;color:var(--muted);margin:14px 0 20px;display:flex;align-items:center;gap:7px;letter-spacing:.04em;}
.login-label{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--azure);font-weight:600;margin:14px 0 5px;}
.login-input{width:100%;padding:12px 13px;border:1px solid var(--line);background:#fff;font-family:var(--sans);font-size:14px;color:var(--ink);}
.login-input:focus{outline:none;border-color:var(--azure);}
.login-err{color:var(--warn);font-size:13px;margin-top:12px;}
.login-submit{width:100%;margin-top:22px;padding:14px;background:var(--brass);color:#fff;font-family:var(--sans);font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase;border:none;cursor:pointer;transition:.22s;}
.login-submit:hover{background:#9a7838;} .login-submit:disabled{opacity:.6;cursor:default;}
.login-hint{font-size:12px;color:var(--muted);margin-top:14px;text-align:center;}
.booking-card{background:var(--paper);width:100%;max-width:440px;border:1px solid rgba(176,141,79,.4);box-shadow:0 28px 64px -24px rgba(0,0,0,.52);}
.booking-head{padding:22px 26px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-start;}
.booking-body{padding:22px 26px;}
.booking-row{display:flex;justify-content:space-between;font-size:13px;color:#46555c;margin-bottom:8px;}
.booking-input{width:100%;padding:12px 13px;border:1px solid var(--line);background:#fff;font-family:var(--sans);font-size:14px;color:var(--ink);margin-top:10px;}
.booking-input:focus{outline:none;border-color:var(--azure);}

/* ══ ADMIN ══════════════════════════════════════════════════════ */
.adm{font-family:var(--sans);color:var(--charcoal);background:var(--sand);min-height:100vh;}
.adm h1,.adm h2,.adm h3{margin:0;font-weight:600;}
.adm-shell{display:grid;grid-template-columns:240px 1fr;min-height:100vh;}
.adm-side{background:var(--ink);color:rgba(255,255,255,.72);padding:26px 0;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;}
.adm-brand{font-family:var(--serif);font-size:22px;color:#fff;padding:0 22px 4px;display:flex;align-items:baseline;gap:8px;}
.adm-brand span{font-family:var(--sans);font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:var(--brass);}
.adm-role{font-size:11px;color:rgba(255,255,255,.42);padding:0 22px 20px;letter-spacing:.06em;}
.adm-nav{display:flex;flex-direction:column;gap:2px;flex:1;}
.adm-nav button{display:flex;align-items:center;gap:12px;padding:11px 22px;background:none;border:none;
  color:rgba(255,255,255,.7);font-family:var(--sans);font-size:14px;cursor:pointer;text-align:left;
  border-left:3px solid transparent;transition:.16s;}
.adm-nav button:hover{color:#fff;background:rgba(255,255,255,.06);}
.adm-nav button.active{color:#fff;border-left-color:var(--brass);background:rgba(176,141,79,.12);}
.adm-foot{padding:16px 22px 0;border-top:1px solid rgba(255,255,255,.1);}
.adm-foot button{color:rgba(255,255,255,.6);font-size:13px;display:flex;align-items:center;gap:9px;background:none;border:none;cursor:pointer;padding:8px 0;font-family:var(--sans);}
.adm-foot button:hover{color:#fff;}
.adm-main{padding:32px 36px;overflow:auto;}
.adm-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28px;}
.adm-head .eyebrow{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--brass);font-weight:600;}
.adm-head h1{font-family:var(--serif);font-size:36px;color:var(--ink);margin-top:6px;}
.adm-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px;}
.adm-kpi{background:var(--paper);border:1px solid var(--line);padding:20px;border-top:3px solid var(--brass);}
.adm-kpi .label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
.adm-kpi .val{font-family:var(--serif);font-size:34px;color:var(--ink);line-height:1;margin-top:10px;}
.adm-kpi .sub{font-size:12px;color:var(--muted);margin-top:6px;}
.adm-kpi.pos .val{color:var(--good);} .adm-kpi.neg .val{color:var(--warn);}
.adm-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.adm-panel{background:var(--paper);border:1px solid var(--line);padding:20px;margin-bottom:16px;overflow-x:auto;}
.adm-panel h3{font-family:var(--serif);font-size:22px;color:var(--ink);margin-bottom:14px;}
.adm-table{width:100%;border-collapse:collapse;font-size:13.5px;}
.adm-table th{text-align:left;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:9px 11px;border-bottom:1px solid var(--line);}
.adm-table td{padding:11px;border-bottom:1px solid var(--line);}
.adm-table tr:last-child td{border-bottom:none;}
.adm-table tr:hover td{background:rgba(44,125,160,.04);}
.mono{font-variant-numeric:tabular-nums;}
.src{font-size:11px;color:var(--muted);text-transform:capitalize;}
.pill{font-size:11px;font-weight:600;padding:3px 9px;display:inline-block;text-transform:capitalize;}
.pill-confirmed{background:#e7eef2;color:var(--azure);}
.pill-checked_in{background:#e3f0e8;color:var(--good);}
.pill-checked_out{background:#eee;color:var(--muted);}
.pill-cancelled{background:#f6e3df;color:var(--warn);}
.pill-available{background:#e3f0e8;color:var(--good);}
.pill-maintenance{background:#fbf0dd;color:#9a7838;}
.pill-unavailable{background:#f6e3df;color:var(--warn);}
.adm select,.adm input[type=text],.adm input[type=number],.adm input[type=date]{
  font-family:var(--sans);font-size:13px;padding:7px 9px;border:1px solid var(--line);background:#fff;color:var(--ink);}
.adm-filters{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;}
.adm-form-row{display:grid;grid-template-columns:repeat(4,1fr) auto;gap:10px;align-items:end;margin-bottom:16px;}
.adm-form-row label{display:block;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;}
.adm-form-row input,.adm-form-row select{width:100%;}
.adm-btn-brass{background:var(--brass);color:#fff;font-family:var(--sans);font-weight:600;font-size:13px;padding:9px 18px;border:none;cursor:pointer;transition:.2s;white-space:nowrap;}
.adm-btn-brass:hover{background:#9a7838;}
.adm-btn-sm{background:#fff;border:1px solid var(--line);padding:7px 11px;cursor:pointer;display:inline-flex;align-items:center;}
.adm-btn-sm:hover{border-color:var(--ink);}
.adm-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;}
.cal-dow{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);text-align:center;padding-bottom:5px;}
.cal-cell{border:1px solid var(--line);background:#fff;padding:5px;font-size:12px;position:relative;aspect-ratio:1;}
.cal-d{color:var(--muted);font-size:11px;}
.cal-occ{position:absolute;bottom:5px;left:5px;font-weight:600;font-size:12px;color:var(--ink);}
.cal-bar{height:3px;background:var(--line);margin-top:3px;}
.cal-bar i{display:block;height:100%;background:var(--brass);}
.cal-empty{border:none;}
.adm-loading{padding:54px;text-align:center;color:var(--muted);}
.adm-err-line{color:var(--warn);font-size:13px;padding:20px;}

/* ── new admin components ── */
.adm-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
.adm-table-wrap .adm-table{min-width:560px;}
.adm-icon-btn{background:#fff;border:1px solid var(--line);padding:6px 8px;cursor:pointer;color:var(--ink);margin-right:6px;display:inline-flex;align-items:center;transition:.18s;}
.adm-icon-btn:hover{border-color:var(--brass);color:var(--brass);}
.adm-seg{flex:1;padding:10px;background:#fff;border:1px solid var(--line);cursor:pointer;font-family:var(--sans);font-size:13px;color:var(--muted);transition:.18s;}
.adm-seg.on{background:var(--ink);color:#fff;border-color:var(--ink);}
.adm-grid-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.adm-field label{display:flex;align-items:center;gap:5px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--azure);font-weight:600;margin-bottom:6px;}
.adm-field input,.adm-field select{width:100%;padding:10px 12px;border:1px solid var(--line);background:#fff;font-family:var(--sans);font-size:14px;color:var(--ink);}
.adm-field input:focus,.adm-field select:focus{outline:none;border-color:var(--azure);}
.adm-summary{margin-top:18px;border-top:1px solid var(--line);padding-top:14px;}
.adm-summary>div{display:flex;justify-content:space-between;font-size:14px;color:#46555c;padding:5px 0;}
.adm-summary>div.t{border-top:1px solid var(--line);margin-top:6px;padding-top:10px;font-size:17px;color:var(--ink);font-family:var(--serif);}
.adm-summary>div.t b{font-family:var(--serif);}
.adm-summary>div.due{color:var(--warn);font-weight:600;}
.adm-btn-ghost{background:#fff;color:var(--ink);border:1px solid var(--line);padding:10px 14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:.18s;}
.adm-btn-ghost:hover{border-color:var(--ink);}
.adm-modal{background:var(--paper);width:100%;border:1px solid var(--brass);box-shadow:0 28px 64px -24px rgba(0,0,0,.5);max-height:92vh;overflow:auto;}
.adm-modal-head{padding:20px 24px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-start;}
.adm-modal-head h3{font-family:var(--serif);font-size:24px;color:var(--ink);}
.adm-modal-head button{background:none;border:none;cursor:pointer;color:var(--muted);}
.adm-modal-body{padding:22px 24px;}
.rcp{font-family:var(--serif);}
.rcp-head{text-align:center;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:6px;}
.rcp-brand{font-size:26px;color:var(--ink);}
.rcp-sub{font-family:var(--sans);font-size:9px;letter-spacing:.32em;text-transform:uppercase;color:var(--brass);}
.rcp-ref{font-family:var(--sans);font-size:11px;color:var(--muted);margin-top:6px;}
.rcp-st{font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--brass);margin:16px 0 6px;}
.rcp-row{display:flex;justify-content:space-between;font-family:var(--sans);font-size:13.5px;color:#46555c;padding:4px 0;}
.rcp-row b{color:var(--ink);}
.rcp-row.total{border-top:2px solid var(--ink);margin-top:6px;padding-top:9px;font-size:16px;font-family:var(--serif);}
.rcp-row.total b{font-family:var(--serif);}
.rcp-row.due{color:var(--warn);font-weight:600;}
.pill-pending{background:#fbf0dd;color:#9a7838;}
.pill-partial{background:#e7eef2;color:var(--azure);}
.pill-paid{background:#e3f0e8;color:var(--good);}

/* ── responsive ── */
@media(max-width:960px){
  .ma-nav{display:none;} .ma-burger{display:block;}
  .ma-book-grid{grid-template-columns:1fr 1fr;} .ma-book .ma-btn-brass{grid-column:1/-1;padding:15px;}
  .ma-intro{grid-template-columns:1fr;gap:32px;}
  .ma-rooms{grid-template-columns:repeat(2,1fr);} .ma-amen-grid{grid-template-columns:1fr 1fr;}
  .ma-gallery{grid-template-columns:1fr 1fr;} .ma-foot-grid{grid-template-columns:1fr;}
  .ma-attract-grid{grid-template-columns:1fr 1fr;}
  .ma-activity-grid{grid-template-columns:repeat(2,1fr);}
  .adm-kpis{grid-template-columns:repeat(2,1fr);} .adm-grid2{grid-template-columns:1fr;}
  .adm-shell{grid-template-columns:1fr;}
  .adm-side{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;padding:10px 4px;gap:2px;overflow-x:auto;}
  .adm-brand{padding-left:16px;font-size:20px;} .adm-role{display:none;}
  .adm-nav{flex-direction:row;flex-wrap:nowrap;flex:1 1 100%;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
  .adm-nav::-webkit-scrollbar{display:none;}
  .adm-nav button{border-left:none;border-bottom:3px solid transparent;padding:9px 13px;white-space:nowrap;flex-shrink:0;}
  .adm-nav button.active{border-left:none;border-bottom-color:var(--brass);}
  .adm-foot{border-top:none;padding:0 16px;} .adm-foot button{font-size:12px;white-space:nowrap;}
  .adm-main{padding:18px 16px;}
  .adm-head h1{font-size:28px;}
  .adm-grid2{grid-template-columns:1fr;}
}
@media(max-width:768px){
  .ma-head-row{height:62px;}
  .ma-book{margin:-48px auto 0;}
  .ma-pool{padding:80px 0;}
  .ma-perks{padding:60px 0;}
}
@media(max-width:640px){
  .ma-rooms{grid-template-columns:1fr;}
  .ma-amen-grid{grid-template-columns:1fr;}
}
@media(max-width:560px){
  .ma-wrap{padding:0 16px;}
  .ma-book-grid{grid-template-columns:1fr;}
  .ma-hero{min-height:80vh;}
  .ma-hero-inner{padding-bottom:96px;}
  .ma-hero h1{font-size:clamp(30px,7vw,52px);}
  .ma-hero p{font-size:16px;}
  .ma-hero-cta{flex-direction:column;gap:10px;}
  .ma-hero-cta .ma-btn{width:100%;justify-content:center;}
  .ma-perks-row{flex-direction:column;align-items:flex-start;gap:20px;}
  .ma-perks-row .ma-btn-brass{width:100%;justify-content:center;}
  .ma-attract-grid{grid-template-columns:1fr;}
  .ma-activity-grid{grid-template-columns:1fr 1fr;}
  .ma-gallery{grid-template-columns:1fr 1fr;}
  .ma-sec{padding:52px 0;}
  .ma-sec-head{margin-bottom:28px;}
  .ma-stat-row{gap:20px;flex-wrap:wrap;}
  .ma-book{margin:-32px auto 0;}
  .ma-pool{padding:64px 0;}
  .ma-perks{padding:52px 0;}
  .ma-foot{padding:48px 0 24px;}
  .ma-foot-grid{gap:24px;}
  .ma-intro-img{aspect-ratio:16/9;}
  .ma-field{padding:12px 14px;}
  .ma-field input{font-size:16px;min-height:44px;}
  .ma-stepper button{width:36px;height:36px;}
  .ma-book .ma-btn-brass{min-height:48px;}
  .ma-card-foot{flex-direction:column;align-items:flex-start;gap:12px;}
  .ma-card-foot .ma-btn{width:100%;justify-content:center;}
  .booking-input{min-height:48px;font-size:16px;}
  .login-input{min-height:48px;font-size:16px;}
  .modal-backdrop{padding:10px;align-items:flex-end;padding-bottom:0;}
  .login-card,.booking-card{border-radius:16px 16px 0 0;max-width:100%;}
  .adm-kpis{grid-template-columns:1fr 1fr;gap:10px;} .adm-form-row{grid-template-columns:1fr;}
  .adm-grid-fields{grid-template-columns:1fr;}
  .adm-kpi{padding:14px;} .adm-kpi .val{font-size:26px;}
  .adm-main{padding:14px 12px;} .adm-panel{padding:16px;}
  .adm-head{flex-direction:column;align-items:flex-start;gap:10px;}
  .adm-modal{max-height:88vh;width:calc(100vw - 20px);}
}
@media(max-width:400px){
  .ma-wrap{padding:0 12px;}
  .ma-hero h1{font-size:clamp(26px,8vw,36px);}
  .ma-hero p{font-size:15px;}
  .ma-card h3{font-size:20px;}
  .ma-gallery{grid-template-columns:1fr;}
  .ma-activity-grid{grid-template-columns:1fr;}
  .ma-head-row{height:58px;}
  .ma-logo{font-size:20px;}
  .ma-sec{padding:36px 0;}
  .adm-kpis{grid-template-columns:1fr;}
  .booking-card,.login-card{padding:24px 16px;}
  .ma-mobile-nav a{font-size:17px;padding:16px 0;}
  .ma-foot-grid{gap:20px;}
  .ma-pool{padding:52px 0;}
  .ma-perks{padding:40px 0;}
}

/* ═══════════════════════════════════════════════════
   FOCUSFLOW ADMIN — vibrant dark futuristic theme
   All ff-* classes used by the separate admin pages.
   ═══════════════════════════════════════════════════ */
:root {
  --ff-bg:      #F0E6CE;
  --ff-card:    #FDF8EE;
  --ff-card2:   #F5EEDA;
  --ff-border:  rgba(140,105,40,.18);
  --ff-primary: #7A5C20;
  --ff-accent:  #A07838;
  --ff-success: #1A7A45;
  --ff-danger:  #B83232;
  --ff-warning: #A06010;
  --ff-purple:  #6A4E20;
  --ff-blue:    #2A6080;
  --ff-muted:   #8A7650;
  --ff-text:    #1A1005;
  --ff-sub:     #5C4828;
  --ff-radius:  10px;
  --ff-num:     'DM Mono', 'IBM Plex Mono', monospace;
}

/* Shell layout */
.ff-shell{display:grid;grid-template-columns:240px 1fr;min-height:100vh;background:var(--ff-bg);color:var(--ff-text);font-family:var(--sans);-webkit-font-smoothing:antialiased;}

/* Sidebar */
.ff-sidebar{background:#1C1610;border-right:1px solid rgba(140,105,40,.25);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;padding:0;}
.ff-sidebar-brand{padding:24px 20px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(200,169,110,.2);}
.ff-brand-dot{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#C8A96E,#9A7838);flex-shrink:0;}
.ff-brand-name{font-size:15px;font-weight:600;color:#C8A96E;margin:0;line-height:1;letter-spacing:.06em;font-family:var(--serif);}
.ff-brand-sub{font-size:11px;color:rgba(200,169,110,.55);margin:3px 0 0;letter-spacing:.04em;}
.ff-sidebar-nav{flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:2px;overflow-y:auto;}
.ff-nav-btn{display:flex;align-items:center;gap:11px;padding:11px 14px;background:none;border:none;color:rgba(220,195,145,.6);font-family:var(--sans);font-size:13.5px;cursor:pointer;border-radius:6px;transition:.18s;text-align:left;width:100%;border-left:3px solid transparent;}
.ff-nav-btn:hover{color:#E8C98A;background:rgba(200,169,110,.1);}
.ff-nav-btn.active{color:#F5EDD0;background:linear-gradient(90deg,rgba(200,169,110,.22),rgba(200,169,110,.06));border-left:3px solid #C8A96E;}
.ff-sidebar-foot{padding:16px;border-top:1px solid rgba(200,169,110,.2);}
.ff-sidebar-user{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
.ff-avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#8A6C2C,#5A4010);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#F5EDD0;flex-shrink:0;}
.ff-sidebar-username{font-size:13px;font-weight:600;color:#F5EDD0;margin:0;}
.ff-sidebar-role{font-size:11px;color:rgba(200,169,110,.6);margin:2px 0 0;text-transform:capitalize;}
.ff-logout-btn{display:flex;align-items:center;gap:8px;background:none;border:1px solid rgba(200,169,110,.25);color:rgba(200,169,110,.7);font-family:var(--sans);font-size:13px;padding:8px 14px;cursor:pointer;border-radius:8px;width:100%;transition:.18s;}
.ff-logout-btn:hover{color:#E05252;border-color:#E05252;}

/* Main content */
.ff-main{overflow:auto;min-height:100vh;}
.ff-page{padding:36px 40px;max-width:1280px;}
.ff-page-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;flex-wrap:wrap;gap:14px;}
.ff-page-title{font-family:var(--serif);font-size:34px;color:var(--ff-text);margin:0;font-weight:500;letter-spacing:.01em;}
.ff-page-sub{font-size:14px;color:var(--ff-muted);margin:6px 0 0;}
.ff-section-title{font-family:var(--serif);font-size:19px;color:var(--ff-text);margin:0 0 16px;font-weight:500;letter-spacing:.02em;}

/* Cards */
.ff-card{background:var(--ff-card);border:1px solid var(--ff-border);border-radius:var(--ff-radius);transition:.18s;}
.ff-card-header{padding:20px 24px;}
.ff-card-header-border{border-bottom:1px solid var(--ff-border);}
.ff-card-header-row{display:flex;align-items:center;justify-content:space-between;}
.ff-card-title{font-family:var(--serif);font-size:20px;color:var(--ff-text);margin:0;font-weight:500;letter-spacing:.02em;}
.ff-card-body{padding:20px 24px;}

/* Stat cards */
.ff-stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;}
.ff-stat-card{padding:20px 22px;border-left:3px solid var(--ff-primary);}
.ff-stat-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.ff-stat-label{font-size:12px;font-weight:500;color:var(--ff-muted);letter-spacing:.06em;}
.ff-stat-value{font-family:var(--ff-num);font-size:28px;color:var(--ff-text);line-height:1;font-weight:500;letter-spacing:-.01em;margin-top:6px;}
.ff-stat-icon{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;}
.ff-icon{width:20px;height:20px;}

/* Icon backgrounds */
.ff-icon-bg-primary{background:rgba(200,169,110,.15);color:var(--ff-primary);}
.ff-icon-bg-success{background:rgba(16,185,129,.15);color:var(--ff-success);}
.ff-icon-bg-accent{background:rgba(232,201,138,.15);color:var(--ff-accent);}
.ff-icon-bg-danger{background:rgba(239,68,68,.15);color:var(--ff-danger);}
.ff-icon-bg-warning{background:rgba(212,151,58,.15);color:var(--ff-warning);}

/* Metric cards */
.ff-metrics-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;}
.ff-metric-card{padding:20px;}
.ff-metric-inner{display:flex;align-items:flex-start;gap:14px;}
.ff-metric-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.ff-metric-body{flex:1;}
.ff-metric-label{font-size:11px;font-weight:600;color:var(--ff-muted);letter-spacing:.1em;margin:0 0 6px;}
.ff-metric-value{font-family:var(--ff-num);font-size:26px;color:var(--ff-text);font-weight:500;line-height:1;margin:0 0 6px;letter-spacing:-.01em;}
.ff-metric-change{font-size:13px;}
.ff-up{color:var(--ff-success);display:flex;align-items:center;gap:3px;}
.ff-dn{color:var(--ff-danger);display:flex;align-items:center;gap:3px;}
.ff-flat{color:var(--ff-muted);}

/* Room revenue list */
.ff-room-rev-list{display:flex;flex-direction:column;gap:20px;}
.ff-room-rev-row{display:flex;align-items:center;gap:16px;}
.ff-room-rev-num{width:32px;height:32px;border-radius:50%;background:rgba(140,105,40,.15);color:var(--ff-primary);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0;}
.ff-room-rev-info{flex:1;}
.ff-room-rev-name-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.ff-room-rev-name{font-weight:600;font-size:14px;}
.ff-room-rev-amount{text-align:right;}
.ff-amount-big{font-family:var(--ff-num);font-size:18px;font-weight:500;color:var(--ff-text);letter-spacing:-.01em;}
.ff-progress-row{display:flex;align-items:center;gap:10px;}
.ff-progress{flex:1;height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden;}
.ff-progress-bar{height:100%;background:linear-gradient(90deg,var(--ff-primary),var(--ff-accent));border-radius:4px;transition:.5s;}

/* Badges */
.ff-badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:6px;display:inline-block;letter-spacing:.02em;}
.ff-badge-blue{background:rgba(59,130,246,.15);color:#60a5fa;}
.ff-badge-green{background:rgba(16,185,129,.15);color:#34d399;}
.ff-badge-red{background:rgba(239,68,68,.15);color:#f87171;}
.ff-badge-muted{background:rgba(107,114,128,.15);color:#9ca3af;}
.ff-badge-yellow{background:rgba(245,158,11,.15);color:#fbbf24;}
.ff-badge-purple{background:rgba(168,85,247,.15);color:#c084fc;}
.ff-badge-gold{background:rgba(245,158,11,.2);color:var(--ff-accent);}

/* Tables */
.ff-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
.ff-table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:520px;}
.ff-table th{text-align:left;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ff-primary);font-weight:600;padding:13px 14px;border-bottom:1px solid var(--ff-border);}
.ff-table td{padding:13px 14px;border-bottom:1px solid var(--ff-border);color:var(--ff-text);font-size:13.5px;}
.ff-table tr:last-child td{border-bottom:none;}
.ff-table tr:hover td{background:rgba(255,255,255,.03);}
.ff-mono{font-variant-numeric:tabular-nums;font-family:var(--ff-num);font-size:13px;letter-spacing:.01em;}
.ff-sub-text{font-size:11px;color:var(--ff-muted);margin-top:2px;display:flex;align-items:center;gap:4px;}

/* Buttons */
.ff-btn{font-family:var(--sans);font-weight:600;font-size:13px;letter-spacing:.04em;cursor:pointer;border:none;border-radius:8px;transition:.2s;display:inline-flex;align-items:center;gap:7px;padding:11px 20px;text-transform:none;}
.ff-btn-primary{background:linear-gradient(135deg,#8A6C2C,#5A4010);color:#F5EDD0;}
.ff-btn-primary:hover{opacity:.88;} .ff-btn-primary:disabled{opacity:.55;cursor:default;}
.ff-btn-outline{background:transparent;color:var(--ff-text);border:1px solid var(--ff-border);}
.ff-btn-outline:hover{border-color:var(--ff-primary);color:var(--ff-primary);}
.ff-btn-ghost{background:transparent;color:var(--ff-text);border:1px solid rgba(140,105,40,.3);}
.ff-btn-ghost:hover{background:rgba(140,105,40,.08);}
.ff-btn-sm{padding:7px 12px;font-size:12px;}
.ff-icon-btn{background:#fff;border:1px solid rgba(140,105,40,.22);padding:7px 9px;cursor:pointer;color:var(--ff-muted);border-radius:7px;margin-right:6px;display:inline-flex;align-items:center;transition:.18s;}
.ff-icon-btn:hover{border-color:var(--ff-primary);color:var(--ff-primary);}
.ff-icon-danger:hover{border-color:var(--ff-danger);color:var(--ff-danger);}

/* Forms */
.ff-fields{display:flex;flex-direction:column;gap:14px;}
.ff-field label{display:block;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ff-muted);margin-bottom:6px;}
.ff-field input,.ff-field select,.ff-field textarea{width:100%;padding:11px 13px;background:#fff;border:1px solid rgba(140,105,40,.25);border-radius:8px;color:var(--ff-text);font-family:var(--sans);font-size:14px;transition:.18s;}
.ff-field input:focus,.ff-field select:focus,.ff-field textarea:focus{outline:none;border-color:var(--ff-primary);background:#FFFDF7;}
.ff-field input::placeholder,.ff-field textarea::placeholder{color:#B0A080;}
.ff-field select option{background:#fff;color:var(--ff-text);}
.ff-hint{font-size:12px;color:var(--ff-muted);margin-top:5px;}
.ff-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.ff-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;}
.ff-form-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;}
.ff-toggle-row{display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;color:var(--ff-text);}
.ff-toggle-row input[type=checkbox]{width:16px;height:16px;accent-color:var(--ff-primary);}
.ff-select{padding:9px 12px;background:#fff;border:1px solid rgba(140,105,40,.25);border-radius:8px;color:var(--ff-text);font-family:var(--sans);font-size:13px;}
.ff-select option{background:#fff;color:var(--ff-text);}
.ff-select-sm{padding:6px 10px;background:#fff;border:1px solid rgba(140,105,40,.25);border-radius:6px;color:var(--ff-text);font-family:var(--sans);font-size:12px;}
.ff-select-sm option{background:#fff;color:var(--ff-text);}

/* Filters bar */
.ff-filters{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;}
.ff-filter-label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ff-muted);font-weight:600;}

/* Billing summary */
.ff-billing{background:rgba(200,169,110,.05);border:1px solid rgba(200,169,110,.12);border-radius:8px;padding:18px;}
.ff-billing-row{display:flex;justify-content:space-between;font-size:14px;color:var(--ff-sub);padding:5px 0;}
.ff-billing-row span{color:var(--ff-muted);}
.ff-billing-row b{color:var(--ff-text);font-weight:600;}
.ff-billing-total{border-top:1px solid var(--ff-border);padding-top:10px;margin-top:5px;font-size:17px;font-family:var(--ff-num);}
.ff-billing-total b{color:var(--ff-primary);font-family:var(--ff-num);}
.ff-billing-advance b{color:var(--ff-success);}
.ff-billing-pending{color:var(--ff-danger);}
.ff-billing-pending b{color:var(--ff-danger);}

/* Receipt */
.ff-receipt{font-family:var(--serif);}
.ff-receipt-head{text-align:center;border-bottom:1px solid var(--ff-border);padding-bottom:14px;margin-bottom:10px;}
.ff-receipt-brand{font-size:24px;color:var(--ff-text);font-weight:600;margin:0;font-family:var(--serif);letter-spacing:.04em;}
.ff-receipt-sub{font-family:var(--sans);font-size:9px;letter-spacing:.34em;text-transform:uppercase;color:var(--ff-primary);margin:4px 0;}
.ff-receipt-ref{font-family:var(--sans);font-size:11px;color:var(--ff-muted);margin:6px 0 0;}
.ff-receipt-row{display:flex;justify-content:space-between;font-family:var(--sans);font-size:13.5px;color:var(--ff-sub);padding:5px 0;}
.ff-receipt-row b{color:var(--ff-text);}
.ff-receipt-total{border-top:2px solid var(--ff-text);margin-top:6px;padding-top:10px;font-size:16px;}
.ff-receipt-total b{color:var(--ff-primary);font-family:var(--ff-num);}
.ff-receipt-due{color:var(--ff-danger);font-weight:600;}
.ff-receipt-hr{border:none;border-top:1px solid var(--ff-border);margin:12px 0;}

/* Modal / dialog */
.ff-backdrop{position:fixed;inset:0;z-index:100;background:rgba(20,12,0,.45);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;}
.ff-modal{background:var(--ff-card);border:1px solid var(--ff-border);border-top:2px solid var(--ff-primary);border-radius:var(--ff-radius);width:100%;box-shadow:0 32px 80px -20px rgba(0,0,0,.9);max-height:92vh;overflow:auto;}
.ff-modal-head{padding:22px 24px;border-bottom:1px solid var(--ff-border);display:flex;justify-content:space-between;align-items:flex-start;}
.ff-modal-head h3{font-family:var(--serif);font-size:22px;color:var(--ff-text);margin:0;}
.ff-modal-body{padding:22px 24px;}

/* Calendar */
.ff-avail-card{padding:18px;cursor:default;}
.ff-avail-dot{width:10px;height:10px;border-radius:50%;margin-bottom:10px;}
.ff-avail-label{font-size:12px;font-weight:600;color:var(--ff-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;}
.ff-avail-nums{display:flex;align-items:baseline;gap:6px;}
.ff-avail-big{font-family:var(--ff-num);font-size:28px;font-weight:500;color:var(--ff-primary);letter-spacing:-.02em;}
.ff-avail-of{font-size:13px;color:var(--ff-muted);}
.ff-avail-sub{font-size:12px;color:var(--ff-muted);margin-top:4px;}
.ff-month-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}
.ff-dow{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ff-muted);text-align:center;padding-bottom:6px;}
.ff-day-cell{border:1px solid rgba(140,105,40,.18);background:#fff;border-radius:8px;padding:8px;min-height:80px;position:relative;transition:.18s;}
.ff-day-cell:hover{border-color:var(--ff-primary);}
.ff-day-busy{background:rgba(200,169,110,.08);border-color:rgba(200,169,110,.3);}
.ff-day-empty{border:none;background:transparent;}
.ff-day-num{font-size:13px;font-weight:600;color:var(--ff-sub);margin-bottom:4px;}
.ff-day-occ{font-size:12px;font-weight:700;color:var(--ff-text);margin:4px 0 3px;}
.ff-day-bar{height:4px;background:rgba(140,105,40,.15);border-radius:2px;}
.ff-day-bar-fill{height:100%;background:linear-gradient(90deg,var(--ff-primary),var(--ff-accent));border-radius:2px;}

/* Rooms */
.ff-cat-header{display:flex;align-items:center;gap:12px;margin-bottom:14px;}
.ff-cat-badge{font-size:12px;font-weight:600;padding:5px 14px;border-radius:20px;letter-spacing:.04em;}
.ff-cat-muted{background:rgba(107,114,128,.15);color:#9ca3af;}
.ff-cat-primary{background:rgba(224,68,154,.15);color:var(--ff-primary);}
.ff-cat-accent{background:rgba(59,130,246,.15);color:#60a5fa;}
.ff-cat-purple{background:rgba(168,85,247,.15);color:#c084fc;}
.ff-cat-gold{background:linear-gradient(135deg,rgba(224,68,154,.2),rgba(245,158,11,.2));color:var(--ff-accent);}
.ff-rooms-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.ff-room-card{background:var(--ff-card);border:1px solid var(--ff-border);border-radius:var(--ff-radius);padding:18px;transition:.25s;}
.ff-room-card:hover{border-color:var(--ff-primary);box-shadow:0 4px 20px rgba(140,105,40,.15);}
.ff-room-card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;}
.ff-room-name{font-size:16px;font-weight:600;color:var(--ff-text);margin:0 0 2px;}
.ff-room-code{font-size:11px;color:var(--ff-muted);letter-spacing:.1em;text-transform:uppercase;margin:0;}
.ff-room-card-body{margin-bottom:14px;}
.ff-room-rate{font-family:var(--serif);font-size:22px;color:var(--ff-primary);font-weight:600;margin:6px 0;}
.ff-room-rate span{font-size:13px;color:var(--ff-muted);font-family:var(--sans);}
.ff-room-card-actions{display:flex;gap:8px;}
.ff-status-badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:6px;}

/* Customers */
.ff-contact-row{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ff-sub);}

/* Expenses */
.ff-total-chip{background:rgba(16,185,129,.15);color:var(--ff-success);font-size:13px;font-weight:600;padding:4px 12px;border-radius:8px;}

/* Users */
.ff-roles-guide{display:flex;flex-direction:column;gap:14px;}
.ff-role-row{display:flex;align-items:flex-start;gap:14px;}

/* Login screen */
.ff-login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F0E6CE;padding:24px;}
.ff-login-card{background:var(--ff-card);border:1px solid var(--ff-border);border-top:2px solid var(--ff-primary);border-radius:var(--ff-radius);padding:40px 36px;width:100%;max-width:400px;box-shadow:0 32px 80px -20px rgba(0,0,0,.9);}
.ff-login-brand{display:flex;align-items:center;gap:14px;}
.ff-login-logo{width:46px;height:46px;border-radius:12px;background:linear-gradient(135deg,#8A6C2C,#5A4010);display:flex;align-items:center;justify-content:center;color:#F5EDD0;flex-shrink:0;}
.ff-login-title{font-family:var(--serif);font-size:24px;color:var(--ff-text);margin:0;font-weight:500;}
.ff-login-sub{font-size:12px;color:var(--ff-muted);margin:3px 0 0;}
.ff-login-err{color:var(--ff-danger);font-size:13px;margin:10px 0 0;padding:10px 14px;background:rgba(239,68,68,.1);border-radius:8px;border:1px solid rgba(239,68,68,.2);}
.ff-login-hint{font-size:12px;color:var(--ff-muted);text-align:center;margin-top:14px;}

/* Gradient text */
.ff-gradient-text{background:linear-gradient(135deg,#C8A96E,#E8C98A);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.ff-text-success{color:var(--ff-success) !important;}
.ff-text-danger{color:var(--ff-danger) !important;}
.ff-text-warning{color:var(--ff-warning) !important;}

/* Toaster */
.ff-toaster{position:fixed;bottom:24px;right:24px;z-index:200;display:flex;flex-direction:column;gap:8px;}
.ff-toast{padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.4);animation:slideIn .3s ease;}
@keyframes slideIn{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
.ff-toast-success{background:#064e3b;color:#34d399;border:1px solid #065f46;}
.ff-toast-error{background:#450a0a;color:#f87171;border:1px solid #7f1d1d;}
.ff-toast-info{background:#1e3a5f;color:#93c5fd;border:1px solid #1e40af;}

/* Utilities */
.ff-empty{color:var(--ff-muted);font-size:14px;padding:32px;text-align:center;}
.ff-loading{padding:60px;text-align:center;color:var(--ff-muted);font-size:14px;}
.ff-error{color:var(--ff-danger);font-size:14px;padding:20px;background:rgba(239,68,68,.08);border-radius:8px;border:1px solid rgba(239,68,68,.2);}
.ff-footnote{font-size:12px;color:var(--ff-muted);margin-top:10px;}
.ff-muted-sm{font-size:12px;color:var(--ff-muted);display:flex;align-items:center;gap:5px;}

/* ── Tokens for new admin pages (f1 + f2 blueprint) ── */
.ff-eyebrow{font-size:10.5px;letter-spacing:.24em;text-transform:uppercase;color:var(--ff-primary);font-weight:600;margin:0 0 6px;opacity:.85;}
.ff-field-err{font-size:11px;color:var(--ff-danger);margin:4px 0 0;}
.ff-divider{border:none;border-top:1px solid var(--ff-border);margin:10px 0;}

/* Wizard stepper */
.ff-stepper{display:flex;align-items:center;margin-bottom:28px;overflow-x:auto;padding-bottom:4px;}
.ff-step{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ff-muted);white-space:nowrap;}
.ff-step::after{content:"";display:block;width:28px;height:1px;background:var(--ff-border);margin:0 8px;flex-shrink:0;}
.ff-step:last-child::after{display:none;}
.ff-step.active{color:var(--ff-primary);font-weight:600;}
.ff-step.done{color:var(--ff-success);}
.ff-step-dot{width:24px;height:24px;border-radius:50%;border:2px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;}
.ff-step.active .ff-step-dot{background:var(--ff-primary);color:#fff;border-color:var(--ff-primary);}
.ff-step.done  .ff-step-dot{background:var(--ff-success);color:#fff;border-color:var(--ff-success);}

/* Alert boxes */
.ff-alert{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:10px;font-size:14px;}
.ff-alert-warn{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);color:var(--ff-accent);}
.ff-alert-info{background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.25);color:#93c5fd;}
.ff-alert-success{background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.25);color:var(--ff-success);}

/* Check-in success screen */
.ff-checkin-success{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:40px 20px;}
.ff-success-icon{width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--ff-success),#059669);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 0 40px rgba(16,185,129,.4);}

/* Extra badge / icon-bg colors */
.ff-icon-bg-primary{background:rgba(200,169,110,.15);color:var(--ff-primary);}
.ff-icon-bg-purple{background:rgba(168,85,247,.15);color:var(--ff-purple);}
.ff-icon-bg-danger{background:rgba(239,68,68,.15);color:var(--ff-danger);}
.ff-badge-purple{background:rgba(168,85,247,.15);color:#c084fc;}
.ff-text-danger{color:var(--ff-danger)!important;}
.ff-text-success{color:var(--ff-success)!important;}
.ff-text-warning{color:var(--ff-warning)!important;}

/* Responsive */
@media(max-width:1024px){
  .ff-shell{grid-template-columns:200px 1fr;}
  .ff-metrics-grid{grid-template-columns:repeat(2,1fr);}
  .ff-stats-grid{grid-template-columns:repeat(2,1fr);}
  .ff-form-grid{grid-template-columns:1fr;}
  .ff-rooms-grid{grid-template-columns:1fr 1fr;}
}
@media(max-width:768px){
  .ff-shell{grid-template-columns:1fr;grid-template-rows:auto 1fr;}
  .ff-sidebar{position:static;height:auto;flex-direction:row;flex-wrap:wrap;padding:10px;}
  .ff-sidebar-brand{border-bottom:none;padding:10px 14px;}
  .ff-sidebar-nav{flex-direction:row;flex-wrap:nowrap;overflow-x:auto;flex:1 1 100%;padding:4px 10px 8px;gap:4px;}
  .ff-nav-btn{white-space:nowrap;border-left:none;border-bottom:3px solid transparent;border-radius:6px 6px 0 0;padding:9px 12px;}
  .ff-nav-btn.active{border-left:none;border-bottom-color:var(--ff-primary);}
  .ff-sidebar-foot{display:none;}
  .ff-page{padding:18px 16px;}
  .ff-stats-grid,.ff-metrics-grid{grid-template-columns:1fr 1fr;}
  .ff-rooms-grid{grid-template-columns:1fr;}
  .ff-grid-2{grid-template-columns:1fr;}
}
@media(max-width:480px){
  .ff-stats-grid,.ff-metrics-grid{grid-template-columns:1fr;}
  .ff-page-title{font-size:26px;}
  .ff-backdrop{padding:10px;align-items:flex-start;padding-top:30px;}
}
`;
