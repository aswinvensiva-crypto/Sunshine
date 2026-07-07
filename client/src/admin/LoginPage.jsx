import { useState } from 'react';
import { Eye, EyeOff, User, Lock, ShieldCheck } from 'lucide-react';

/* ─── Beach Sunset Scene (SVG) ──────────────────────────────────── */
function BeachSunset() {
  return (
    <svg viewBox="0 0 760 900" xmlns="http://www.w3.org/2000/svg"
      style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}>
      <defs>
        {/* Sky */}
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#6b8caa"/>
          <stop offset="30%"  stopColor="#9fb5c8"/>
          <stop offset="58%"  stopColor="#d4a87a"/>
          <stop offset="75%"  stopColor="#e8865a"/>
          <stop offset="88%"  stopColor="#f0a04a"/>
          <stop offset="100%" stopColor="#f5c060"/>
        </linearGradient>
        {/* Sun halo */}
        <radialGradient id="sunHalo" cx="38%" cy="58%" r="30%">
          <stop offset="0%"   stopColor="#fff8e0" stopOpacity="0.95"/>
          <stop offset="12%"  stopColor="#fdd86a" stopOpacity="0.7"/>
          <stop offset="30%"  stopColor="#f0a030" stopOpacity="0.35"/>
          <stop offset="60%"  stopColor="#e07020" stopOpacity="0.08"/>
          <stop offset="100%" stopColor="#e07020" stopOpacity="0"/>
        </radialGradient>
        {/* Ocean */}
        <linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#3a8fa8"/>
          <stop offset="30%"  stopColor="#2e7a90"/>
          <stop offset="70%"  stopColor="#1e5f72"/>
          <stop offset="100%" stopColor="#14475a"/>
        </linearGradient>
        {/* Sun path on water */}
        <radialGradient id="sunPath" cx="38%" cy="0%" r="100%">
          <stop offset="0%"   stopColor="#f5c060" stopOpacity="0.55"/>
          <stop offset="50%"  stopColor="#f0a030" stopOpacity="0.2"/>
          <stop offset="100%" stopColor="#f0a030" stopOpacity="0"/>
        </radialGradient>
        {/* Sand */}
        <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#c8a87a"/>
          <stop offset="40%"  stopColor="#b89464"/>
          <stop offset="100%" stopColor="#a07c50"/>
        </linearGradient>
        {/* Wet sand */}
        <linearGradient id="wetSand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#8a7458" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#c8a87a" stopOpacity="0.8"/>
        </linearGradient>
        {/* Wave foam */}
        <linearGradient id="foam1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="white" stopOpacity="0"/>
          <stop offset="20%"  stopColor="white" stopOpacity="0.6"/>
          <stop offset="50%"  stopColor="white" stopOpacity="0.9"/>
          <stop offset="80%"  stopColor="white" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="white" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="foam2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="white" stopOpacity="0"/>
          <stop offset="30%"  stopColor="white" stopOpacity="0.5"/>
          <stop offset="60%"  stopColor="white" stopOpacity="0.8"/>
          <stop offset="100%" stopColor="white" stopOpacity="0"/>
        </linearGradient>
        {/* Overlay for bottom text */}
        <linearGradient id="bottomOverlay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#0a1628" stopOpacity="0"/>
          <stop offset="50%"  stopColor="#0a1628" stopOpacity="0.55"/>
          <stop offset="100%" stopColor="#0a1628" stopOpacity="0.82"/>
        </linearGradient>
        {/* Top overlay */}
        <linearGradient id="topOverlay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#0a1628" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="#0a1628" stopOpacity="0"/>
        </linearGradient>
        <filter id="blur2">
          <feGaussianBlur stdDeviation="2"/>
        </filter>
        <filter id="blur6">
          <feGaussianBlur stdDeviation="6"/>
        </filter>
      </defs>

      {/* Sky */}
      <rect width="760" height="900" fill="url(#sky)"/>

      {/* Distant haze near horizon */}
      <rect x="0" y="470" width="760" height="60" fill="#d4b090" opacity="0.18"/>

      {/* Sun halo glow */}
      <rect width="760" height="900" fill="url(#sunHalo)"/>

      {/* Sun disc */}
      <circle cx="290" cy="522" r="46" fill="#fff8d0" opacity="0.95"/>
      <circle cx="290" cy="522" r="38" fill="#fff4a0" opacity="1"/>
      <circle cx="290" cy="522" r="28" fill="#fffde0" opacity="1"/>

      {/* Light rays from sun */}
      {[0,18,36,54,72,90,108,126,144,162,180,198,216,234,252,270,288,306,324,342].map((deg,i) => {
        const rad = (deg * Math.PI) / 180;
        const x2 = 290 + Math.cos(rad) * 320;
        const y2 = 522 + Math.sin(rad) * 320;
        return (
          <line key={i} x1="290" y1="522" x2={x2} y2={y2}
            stroke="#f8d060" strokeWidth="1.5" strokeOpacity={0.06 + (i % 3) * 0.02}/>
        );
      })}

      {/* Clouds - layer 1 (far, pink/orange tint) */}
      <ellipse cx="560" cy="160" rx="130" ry="38" fill="#e8c4a0" opacity="0.55"/>
      <ellipse cx="590" cy="148" rx="90" ry="28" fill="#f0d0b0" opacity="0.5"/>
      <ellipse cx="520" cy="168" rx="80" ry="22" fill="#d8b898" opacity="0.45"/>

      <ellipse cx="120" cy="200" rx="110" ry="32" fill="#d4b090" opacity="0.45"/>
      <ellipse cx="90" cy="188" rx="70" ry="22" fill="#e0c0a0" opacity="0.4"/>
      <ellipse cx="150" cy="192" rx="85" ry="24" fill="#d8b898" opacity="0.4"/>

      <ellipse cx="680" cy="280" rx="95" ry="28" fill="#c8a888" opacity="0.38"/>
      <ellipse cx="710" cy="268" rx="65" ry="20" fill="#d8b898" opacity="0.35"/>

      {/* Clouds - layer 2 (mid, warmer) */}
      <ellipse cx="400" cy="320" rx="140" ry="36" fill="#c4907a" opacity="0.3"/>
      <ellipse cx="440" cy="308" rx="100" ry="26" fill="#d0a080" opacity="0.28"/>

      <ellipse cx="200" cy="360" rx="105" ry="28" fill="#b88070" opacity="0.28"/>
      <ellipse cx="650" cy="380" rx="115" ry="30" fill="#b88070" opacity="0.25"/>

      {/* Horizon glow band */}
      <rect x="0" y="505" width="760" height="35" fill="#f0c060" opacity="0.22"/>
      <rect x="0" y="515" width="760" height="15" fill="#f8d870" opacity="0.18"/>

      {/* Ocean */}
      <path d="M0 540 Q190 530 380 540 Q570 550 760 538 L760 900 L0 900Z" fill="url(#ocean)"/>

      {/* Sun reflection path on ocean */}
      <path d="M0 540 Q190 530 380 540 Q570 550 760 538 L760 900 L0 900Z" fill="url(#sunPath)"/>

      {/* Ocean texture — horizontal ripple lines */}
      <line x1="0"   y1="558" x2="760" y2="556" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5"/>
      <line x1="0"   y1="572" x2="760" y2="570" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
      <line x1="0"   y1="588" x2="760" y2="586" stroke="rgba(255,255,255,0.05)" strokeWidth="1.5"/>
      <line x1="0"   y1="605" x2="760" y2="603" stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
      <line x1="0"   y1="622" x2="760" y2="620" stroke="rgba(255,255,255,0.04)" strokeWidth="1.5"/>
      <line x1="0"   y1="645" x2="760" y2="643" stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
      <line x1="0"   y1="670" x2="760" y2="668" stroke="rgba(255,255,255,0.04)" strokeWidth="1.5"/>

      {/* Sun reflection column on water */}
      <ellipse cx="290" cy="570" rx="22" ry="6" fill="#fff8a0" opacity="0.55"/>
      <ellipse cx="286" cy="595" rx="18" ry="5" fill="#f8d860" opacity="0.4"/>
      <ellipse cx="282" cy="618" rx="14" ry="4" fill="#f0c040" opacity="0.3"/>
      <ellipse cx="278" cy="642" rx="11" ry="3.5" fill="#e8a820" opacity="0.22"/>
      <ellipse cx="274" cy="665" rx="9"  ry="3" fill="#e0a020" opacity="0.18"/>
      {/* Wider glow column */}
      <ellipse cx="290" cy="600" rx="55" ry="60" fill="#f8c040" opacity="0.07" filter="url(#blur6)"/>

      {/* Main wave - large, crashing on sand */}
      <path d="M-10 730 Q80 710 170 720 Q250 728 310 718 Q380 706 450 714 Q520 722 600 714 Q680 706 770 718 L770 760 Q680 748 600 756 Q520 764 450 756 Q380 748 310 760 Q250 770 170 762 Q80 752 -10 764Z"
        fill="white" opacity="0.18"/>
      <path d="M-10 726 Q80 706 180 718 Q260 728 320 716 Q390 704 460 712 Q530 720 610 710 Q680 702 770 714"
        stroke="white" strokeWidth="2.5" fill="none" opacity="0.35"/>

      {/* Second wave - smaller */}
      <path d="M-10 752 Q60 738 140 746 Q220 754 290 742 Q360 730 440 740 Q510 750 590 740 Q660 730 770 742 L770 762 Q660 752 590 762 Q510 772 440 762 Q360 750 290 762 Q220 774 140 766 Q60 758 -10 768Z"
        fill="white" opacity="0.12"/>

      {/* Wave foam runup on sand */}
      <path d="M-10 768 Q100 758 220 766 Q320 773 430 764 Q530 755 640 763 Q700 768 770 762 L770 782 Q700 788 640 783 Q530 775 430 784 Q320 793 220 786 Q100 778 -10 788Z"
        fill="url(#foam1)" opacity="0.75"/>
      <path d="M-10 778 Q120 770 250 778 Q350 784 470 776 Q570 768 680 774 Q720 777 770 772 L770 790 Q720 796 680 790 Q570 786 470 794 Q350 802 250 796 Q120 790 -10 798Z"
        fill="url(#foam2)" opacity="0.5"/>

      {/* Sand */}
      <path d="M0 785 Q190 775 380 782 Q570 788 760 780 L760 900 L0 900Z" fill="url(#sand)"/>

      {/* Wet sand (where wave receded) */}
      <path d="M0 785 Q190 775 380 782 Q570 788 760 780 L760 820 Q570 826 380 820 Q190 814 0 820Z"
        fill="url(#wetSand)" opacity="0.55"/>

      {/* Sand texture - subtle lines */}
      <line x1="0" y1="800" x2="760" y2="798" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
      <line x1="0" y1="820" x2="760" y2="818" stroke="rgba(160,120,80,0.15)" strokeWidth="1"/>
      <line x1="0" y1="840" x2="760" y2="838" stroke="rgba(160,120,80,0.1)" strokeWidth="1"/>

      {/* Small pebbles/details on wet sand */}
      {[[120,808,3],[250,815,2],[340,810,2.5],[480,808,2],[610,812,3],[700,806,2]].map(([x,y,r],i)=>(
        <ellipse key={i} cx={x} cy={y} rx={r*2} ry={r} fill="rgba(100,80,60,0.2)"/>
      ))}

      {/* Distant boat silhouette on horizon */}
      <rect x="580" y="530" width="22" height="5" rx="2" fill="rgba(30,50,70,0.55)"/>
      <path d="M588 530 L591 518 L594 530Z" fill="rgba(30,50,70,0.45)"/>

      {/* Seagulls */}
      <path d="M460 340 Q465 335 470 340" stroke="rgba(50,60,80,0.5)" strokeWidth="1.5" fill="none"/>
      <path d="M478 328 Q484 322 490 328" stroke="rgba(50,60,80,0.45)" strokeWidth="1.5" fill="none"/>
      <path d="M500 348 Q505 343 510 348" stroke="rgba(50,60,80,0.4)" strokeWidth="1.2" fill="none"/>
      <path d="M540 318 Q546 312 552 318" stroke="rgba(50,60,80,0.4)" strokeWidth="1.2" fill="none"/>

      {/* Top gradient overlay */}
      <rect width="760" height="900" fill="url(#topOverlay)"/>
      {/* Bottom gradient overlay for text */}
      <rect width="760" height="900" fill="url(#bottomOverlay)"/>

      {/* Sunshine logo — top left */}
      <rect x="28" y="24" width="46" height="46" rx="12" fill="rgba(15,25,45,0.55)"/>
      <rect x="30" y="26" width="42" height="42" rx="11" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      {/* Sun icon */}
      <circle cx="51" cy="47" r="8" fill="#f8c840" opacity="0.9"/>
      {[0,45,90,135,180,225,270,315].map((deg,i) => {
        const r = (deg*Math.PI)/180;
        return <line key={i} x1={51+Math.cos(r)*10} y1={47+Math.sin(r)*10} x2={51+Math.cos(r)*13.5} y2={47+Math.sin(r)*13.5} stroke="#f8c840" strokeWidth="1.8" strokeLinecap="round" opacity="0.75"/>;
      })}

      <text x="84" y="43" fontFamily="Georgia, serif" fontWeight="700" fontSize="15" fill="white" opacity="0.95">Sunshine</text>
      <text x="84" y="59" fontFamily="Inter, system-ui, sans-serif" fontWeight="500" fontSize="10" fill="rgba(255,255,255,0.6)" letterSpacing="0.18em">RESORT · PONDICHERRY</text>

      {/* Bottom tagline */}
      <text x="38" y="800" fontFamily="Georgia, serif" fontStyle="italic" fontSize="32" fontWeight="400" fill="white" opacity="0.92">Where the ocean</text>
      <text x="38" y="840" fontFamily="Georgia, serif" fontStyle="italic" fontSize="32" fontWeight="400" fill="white" opacity="0.92">meets luxury.</text>

      {/* Location tag */}
      <circle cx="40" cy="864" r="4" fill="#06b6d4"/>
      <text x="52" y="869" fontFamily="Inter, system-ui, sans-serif" fontSize="11" fontWeight="600" fill="rgba(255,255,255,0.75)" letterSpacing="0.14em">PONDICHERRY, INDIA</text>
    </svg>
  );
}

/* ─── Shared login page ──────────────────────────────────────────── */
export default function LoginPage({ subtitle, hint, onLogin, isStaff }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [err,      setErr]      = useState('');
  const [busy,     setBusy]     = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim()) { setErr('Username is required.'); return; }
    if (!password)        { setErr('Password is required.');  return; }
    setErr(''); setBusy(true);
    try {
      await onLogin(username.trim(), password);
    } catch (e2) {
      setErr(
        e2.message === 'Failed to fetch'
          ? "Can't reach the server — make sure the backend is running."
          : e2.message,
      );
    } finally { setBusy(false); }
  };

  const inputBox = (focused) => ({
    display:'flex', alignItems:'center',
    background:'#0d1a2e',
    border:'1.5px solid', borderColor: focused ? '#06b6d4' : '#1a2d45',
    borderRadius:12, overflow:'hidden',
    transition:'border-color .18s, box-shadow .18s',
    boxShadow: focused ? '0 0 0 3px rgba(6,182,212,0.15)' : 'none',
  });

  return (
    <div style={{
      display:'flex', height:'100vh', width:'100vw',
      fontFamily:"'Inter', system-ui, sans-serif",
      overflow:'hidden',
    }}>

      {/* ── LEFT — beach sunset ───────────────────────────────────── */}
      <div style={{ width:'44%', position:'relative', overflow:'hidden', flexShrink:0 }}>
        <BeachSunset />
      </div>

      {/* ── RIGHT — dark form panel ───────────────────────────────── */}
      <div style={{
        flex:1,
        background:'#070d1c',
        display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        padding:'48px 32px',
        position:'relative',
        overflow:'hidden',
      }}>
        {/* Subtle radial glow top-right */}
        <div style={{
          position:'absolute', top:-120, right:-120,
          width:420, height:420, borderRadius:'50%',
          background:'radial-gradient(circle, rgba(6,182,212,0.07) 0%, transparent 70%)',
          pointerEvents:'none',
        }}/>
        {/* Subtle radial glow bottom-left */}
        <div style={{
          position:'absolute', bottom:-80, left:-80,
          width:320, height:320, borderRadius:'50%',
          background:'radial-gradient(circle, rgba(6,182,212,0.05) 0%, transparent 70%)',
          pointerEvents:'none',
        }}/>

        <div style={{ width:'100%', maxWidth:420, position:'relative', zIndex:1 }}>

          {/* Section label */}
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:28 }}>
            <div style={{ width:28, height:2, background:'#06b6d4', borderRadius:2, flexShrink:0 }}/>
            <span style={{
              fontSize:11, fontWeight:700, letterSpacing:'.2em',
              color:'#06b6d4', textTransform:'uppercase',
            }}>
              {isStaff ? 'Staff Portal' : 'Resort Management'}
            </span>
          </div>

          {/* Heading */}
          <div style={{ marginBottom:12 }}>
            <h1 style={{
              margin:0, lineHeight:1.1,
              fontSize:52, fontWeight:700,
              fontFamily:"Georgia, 'Times New Roman', serif",
              color:'#ffffff',
              letterSpacing:'-.5px',
            }}>
              Welcome
            </h1>
            <h1 style={{
              margin:0, lineHeight:1.05,
              fontSize:52, fontWeight:400,
              fontFamily:"Georgia, 'Times New Roman', serif",
              fontStyle:'italic',
              color:'#06b6d4',
              letterSpacing:'-.5px',
            }}>
              back.
            </h1>
          </div>

          <p style={{ margin:'0 0 36px', fontSize:14, color:'#5a7290', lineHeight:1.5 }}>
            Sign in to access your resort workspace.
          </p>

          {/* Form */}
          <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:20 }}>

            {/* Username */}
            <div>
              <label style={{
                display:'block', marginBottom:8,
                fontSize:11, fontWeight:700, letterSpacing:'.12em',
                color:'#4a6080', textTransform:'uppercase',
              }}>Username</label>
              <div style={inputBox(!!username)}>
                <div style={{ padding:'0 14px', color: username ? '#06b6d4' : '#2a4060', display:'flex', alignItems:'center', flexShrink:0, transition:'color .18s' }}>
                  <User size={16}/>
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setErr(''); }}
                  placeholder={isStaff ? 'staff.username' : 'admin'}
                  autoFocus
                  autoComplete="username"
                  style={{
                    flex:1, border:'none', outline:'none',
                    padding:'14px 14px 14px 0',
                    fontSize:15, color:'#e8f0f8',
                    background:'transparent', fontFamily:'inherit',
                    caretColor:'#06b6d4',
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={{
                display:'block', marginBottom:8,
                fontSize:11, fontWeight:700, letterSpacing:'.12em',
                color:'#4a6080', textTransform:'uppercase',
              }}>Password</label>
              <div style={inputBox(!!password)}>
                <div style={{ padding:'0 14px', color: password ? '#06b6d4' : '#2a4060', display:'flex', alignItems:'center', flexShrink:0, transition:'color .18s' }}>
                  <Lock size={16}/>
                </div>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setErr(''); }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{
                    flex:1, border:'none', outline:'none',
                    padding:'14px 0',
                    fontSize:15, color:'#e8f0f8',
                    background:'transparent', fontFamily:'inherit',
                    caretColor:'#06b6d4',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  tabIndex={-1}
                  style={{
                    padding:'0 14px', background:'none', border:'none',
                    cursor:'pointer', color: showPass ? '#06b6d4' : '#2a4060',
                    display:'flex', alignItems:'center', flexShrink:0,
                    transition:'color .18s',
                  }}
                >
                  {showPass ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
            </div>

            {/* Error */}
            {err && (
              <div style={{
                padding:'11px 14px',
                background:'rgba(239,68,68,0.1)',
                border:'1px solid rgba(239,68,68,0.3)',
                borderRadius:10, fontSize:13, color:'#fc8080', lineHeight:1.4,
              }}>
                {err}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={busy}
              style={{
                width:'100%', padding:'15px',
                background: busy
                  ? 'rgba(6,182,212,0.4)'
                  : 'linear-gradient(135deg, #06b6d4 0%, #0284c7 100%)',
                color:'#fff', border:'none', borderRadius:12,
                fontSize:15, fontWeight:700,
                cursor: busy ? 'not-allowed' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                letterSpacing:'.03em', marginTop:4,
                boxShadow: busy ? 'none' : '0 4px 20px rgba(6,182,212,0.35)',
                transition:'all .18s',
              }}
              onMouseEnter={e => { if (!busy) e.currentTarget.style.boxShadow = '0 6px 28px rgba(6,182,212,0.5)'; }}
              onMouseLeave={e => { if (!busy) e.currentTarget.style.boxShadow = '0 4px 20px rgba(6,182,212,0.35)'; }}
            >
              {busy ? (
                <>
                  <span style={{
                    width:15, height:15, border:'2.5px solid rgba(255,255,255,0.3)',
                    borderTopColor:'#fff', borderRadius:'50%',
                    animation:'spin .7s linear infinite', display:'inline-block',
                  }}/>
                  Signing in…
                </>
              ) : 'Sign in  →'}
            </button>

            {/* Hint */}
            {hint && (
              <div style={{
                display:'flex', alignItems:'center', gap:16,
                color:'#2a4060',
              }}>
                <div style={{ flex:1, height:'1px', background:'#0d1e32' }}/>
                <span style={{ fontSize:12.5, color:'#5a7290', whiteSpace:'nowrap' }}>
                  Default:&nbsp;
                  <span style={{ color:'#06b6d4', fontWeight:700 }}>
                    {isStaff ? 'staff credentials' : 'admin / admin123'}
                  </span>
                </span>
                <div style={{ flex:1, height:'1px', background:'#0d1e32' }}/>
              </div>
            )}
          </form>

          {/* Footer */}
          <div style={{
            marginTop:44, display:'flex', alignItems:'center', justifyContent:'center',
            gap:6, color:'#253545',
          }}>
            <ShieldCheck size={13} color="#253545"/>
            <span style={{ fontSize:11.5 }}>Secure access</span>
            <span style={{ fontSize:11.5, color:'#1a2535' }}>·</span>
            <span style={{ fontSize:11.5 }}>Sunshine Pondicherry</span>
            <span style={{ fontSize:11.5, color:'#1a2535' }}>·</span>
            <span style={{ fontSize:11.5 }}>v1.1</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        input::placeholder { color: #2a4060; }
      `}</style>
    </div>
  );
}
