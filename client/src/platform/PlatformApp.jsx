/**
 * PlatformApp.jsx — super_admin console at /platform.
 *
 * A small but polished operator console: sign in as a platform admin, list
 * tenants, create a tenant (with its first owner account), suspend/reactivate,
 * reset a tenant user's password, and mint a 30-minute support-impersonation
 * token. This unblocks onboarding a new resort without a manual DB insert.
 *
 * Deliberately self-contained: it ships its own dark "command-center" styling
 * (cyan accent, echoing the resort login) and does not depend on admin.css, so
 * the platform layer reads as distinct from — and above — any single tenant.
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import {
  Sun, LogOut, Building2, Users, CalendarCheck2, Plus, Pause, Play,
  KeyRound, Copy, X, Search, Loader2, ChevronDown, User, Lock, Eye, EyeOff,
  CheckCircle2, AlertTriangle, Fingerprint, ArrowRight, ShieldCheck,
} from 'lucide-react';

const TOKEN_KEY = 'platform_token';
const api = async (path, opts = {}) => {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`/api/platform${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) localStorage.removeItem(TOKEN_KEY);
    throw new Error(body.error || res.statusText);
  }
  return body;
};

const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function PlatformApp() {
  const [authed, setAuthed] = useState(!!localStorage.getItem(TOKEN_KEY));
  return (
    <div className="pc-root">
      <PlatformStyles />
      {authed
        ? <Console onSignOut={() => { localStorage.removeItem(TOKEN_KEY); setAuthed(false); }} />
        : <Login onOk={() => setAuthed(true)} />}
    </div>
  );
}

/* ─── Signed-in shell ────────────────────────────────────────────────────── */
function Console({ onSignOut }) {
  return (
    <div className="pc-shell">
      <header className="pc-header">
        <div className="pc-brand">
          <div className="pc-logo"><Sun size={22} /></div>
          <div>
            <p className="pc-eyebrow">Super Admin · Platform</p>
            <h1 className="pc-brand-title">Sunshine Console</h1>
          </div>
        </div>
        <button className="pc-btn pc-btn-ghost" onClick={onSignOut}>
          <LogOut size={15} /> Sign out
        </button>
      </header>
      <Tenants />
    </div>
  );
}

/* ─── Login ──────────────────────────────────────────────────────────────── */
function Login({ onOk }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const { token } = await api('/login', { method: 'POST', body: JSON.stringify({ username: u.trim(), password: p }) });
      localStorage.setItem(TOKEN_KEY, token);
      onOk();
    } catch (e2) {
      setErr(e2.message === 'Failed to fetch'
        ? "Can't reach the server — make sure the backend is running."
        : e2.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="pc-login-wrap">
      <form className="pc-login-card" onSubmit={submit}>
        <div className="pc-login-logo"><Sun size={26} /></div>
        <p className="pc-eyebrow" style={{ marginTop: 22 }}>Super Admin Access</p>
        <h1 className="pc-login-title">Platform Console</h1>
        <p className="pc-login-sub">Tenant management for Sunshine Resorts.</p>

        {err && <div className="pc-alert pc-alert-err"><AlertTriangle size={15} /> <span>{err}</span></div>}

        <label className="pc-label">Username</label>
        <div className={`pc-inp ${u ? 'is-filled' : ''}`}>
          <User size={16} className="pc-inp-icon" />
          <input value={u} onChange={e => { setU(e.target.value); setErr(''); }} autoFocus autoComplete="username" placeholder="platform admin" />
        </div>

        <label className="pc-label">Password</label>
        <div className={`pc-inp ${p ? 'is-filled' : ''}`}>
          <Lock size={16} className="pc-inp-icon" />
          <input type={show ? 'text' : 'password'} value={p} onChange={e => { setP(e.target.value); setErr(''); }} autoComplete="current-password" placeholder="••••••••" />
          <button type="button" className="pc-inp-eye" tabIndex={-1} onClick={() => setShow(v => !v)}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <button className="pc-btn pc-btn-primary pc-btn-block" disabled={busy} style={{ marginTop: 22 }}>
          {busy ? <><Loader2 size={16} className="pc-spin" /> Signing in…</> : <>Sign in <ArrowRight size={16} /></>}
        </button>

        <div className="pc-login-foot">
          <ShieldCheck size={13} /> Secure access · Sunshine Platform
        </div>
      </form>
    </div>
  );
}

/* ─── Tenants ────────────────────────────────────────────────────────────── */
function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null); // tenant row currently expanded
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    api('/tenants').then(setTenants).catch(e => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const setStatus = async (t, status) => {
    if (status === 'suspended' &&
        !window.confirm(`Suspend "${t.name}"? All its admin and guest APIs stop working immediately.`)) return;
    try {
      await api(`/tenants/${t.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (e) { setErr(e.message); }
  };

  const impersonate = async (t) => {
    try {
      const r = await api(`/tenants/${t.id}/impersonate`, { method: 'POST' });
      await navigator.clipboard?.writeText(r.token).catch(() => {});
      setNotice(`30-min owner token for "${t.name}" copied to clipboard. Use it on ${t.slug}'s domain ` +
        `(or set localStorage tenant_slug='${t.slug}' and ma_token to the token on /admin).`);
    } catch (e) { setErr(e.message); }
  };

  const stats = useMemo(() => {
    const active = tenants.filter(t => t.status === 'active').length;
    return {
      resorts: tenants.length,
      active,
      suspended: tenants.length - active,
      users: tenants.reduce((n, t) => n + (t.user_count || 0), 0),
      bookings: tenants.reduce((n, t) => n + (t.booking_count || 0), 0),
    };
  }, [tenants]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return tenants;
    return tenants.filter(t => t.slug.toLowerCase().includes(s) || t.name.toLowerCase().includes(s));
  }, [tenants, q]);

  return (
    <>
      {err && (
        <div className="pc-alert pc-alert-err pc-alert-bar">
          <AlertTriangle size={16} /> <span>{err}</span>
          <button className="pc-alert-x" onClick={() => setErr('')}><X size={14} /></button>
        </div>
      )}
      {notice && (
        <div className="pc-alert pc-alert-ok pc-alert-bar">
          <CheckCircle2 size={16} /> <span>{notice}</span>
          <button className="pc-alert-x" onClick={() => setNotice('')}><X size={14} /></button>
        </div>
      )}

      {/* Stat tiles */}
      <div className="pc-stats">
        <StatTile icon={<Building2 size={18} />} tone="accent" label="Resorts"
          value={stats.resorts} sub={`${stats.active} active · ${stats.suspended} suspended`} />
        <StatTile icon={<CheckCircle2 size={18} />} tone="success" label="Active" value={stats.active} sub="serving traffic" />
        <StatTile icon={<Users size={18} />} tone="violet" label="User accounts" value={stats.users} sub="across all resorts" />
        <StatTile icon={<CalendarCheck2 size={18} />} tone="amber" label="Bookings" value={stats.bookings} sub="lifetime total" />
      </div>

      {/* Resorts table */}
      <div className="pc-card">
        <div className="pc-card-head">
          <div>
            <h3 className="pc-card-title">Resorts</h3>
            <p className="pc-card-sub">{tenants.length} tenant{tenants.length === 1 ? '' : 's'} on the platform</p>
          </div>
          <div className={`pc-search ${q ? 'is-filled' : ''}`}>
            <Search size={15} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search resorts…" />
            {q && <button className="pc-search-x" onClick={() => setQ('')}><X size={13} /></button>}
          </div>
        </div>
        <div className="pc-table-wrap">
          <table className="pc-table">
            <thead>
              <tr>
                <th>Resort</th><th>Status</th><th className="pc-num">Users</th>
                <th className="pc-num">Bookings</th><th>Created</th><th className="pc-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(t => (
                <Fragment key={t.id}>
                  <tr className={selected === t.id ? 'is-open' : ''}>
                    <td>
                      <div className="pc-resort-name">{t.name}</div>
                      <span className="pc-slug">{t.slug}</span>
                    </td>
                    <td><StatusPill status={t.status} /></td>
                    <td className="pc-num pc-mono">{t.user_count}</td>
                    <td className="pc-num pc-mono">{t.booking_count}</td>
                    <td className="pc-dim">{fmtDate(t.created_at)}</td>
                    <td className="pc-right pc-actions">
                      <button className={`pc-btn pc-btn-sm pc-btn-outline ${selected === t.id ? 'is-active' : ''}`}
                        onClick={() => setSelected(selected === t.id ? null : t.id)}>
                        <ChevronDown size={14} className={`pc-caret ${selected === t.id ? 'rot' : ''}`} />
                        {selected === t.id ? 'Close' : 'Manage'}
                      </button>
                      {t.status === 'active'
                        ? <button className="pc-btn pc-btn-sm pc-btn-danger" onClick={() => setStatus(t, 'suspended')}><Pause size={14} /> Suspend</button>
                        : <button className="pc-btn pc-btn-sm pc-btn-success" onClick={() => setStatus(t, 'active')}><Play size={14} /> Reactivate</button>}
                      <button className="pc-btn pc-btn-sm pc-btn-soft" onClick={() => impersonate(t)} disabled={t.status !== 'active'}>
                        <Fingerprint size={14} /> Impersonate
                      </button>
                    </td>
                  </tr>
                  {selected === t.id && (
                    <tr className="pc-detail-row">
                      <td colSpan={6}>
                        <TenantDetail tenant={t} onErr={setErr} onChanged={load} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="pc-empty">
                    {tenants.length === 0 ? 'No tenants yet — create the first resort below.' : 'No resorts match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CreateTenant onCreated={load} onErr={setErr} />
    </>
  );
}

function StatTile({ icon, tone, label, value, sub }) {
  return (
    <div className={`pc-stat pc-tone-${tone}`}>
      <div className="pc-stat-top">
        <span className="pc-stat-label">{label}</span>
        <span className="pc-stat-icon">{icon}</span>
      </div>
      <div className="pc-stat-value">{value}</div>
      <div className="pc-stat-sub">{sub}</div>
    </div>
  );
}

function StatusPill({ status }) {
  const active = status === 'active';
  return (
    <span className={`pc-pill ${active ? 'pc-pill-ok' : 'pc-pill-off'}`}>
      <span className="pc-pill-dot" />{status}
    </span>
  );
}

/* ─── Tenant detail (accounts + password reset) ──────────────────────────── */
function TenantDetail({ tenant, onErr, onChanged }) {
  const [users, setUsers] = useState(null);
  const [resetFor, setResetFor] = useState(null); // user id whose password form is open
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');

  const loadUsers = useCallback(() => {
    api(`/tenants/${tenant.id}`)
      .then(d => setUsers(d.users))
      .catch(e => onErr(e.message));
  }, [tenant.id, onErr]);
  useEffect(loadUsers, [loadUsers]);

  const savePassword = async (u) => {
    if (pw.length < 6) { onErr('Password must be at least 6 characters.'); return; }
    setBusy(true); onErr('');
    try {
      await api(`/tenants/${tenant.id}/users/${u.id}/password`, {
        method: 'PATCH', body: JSON.stringify({ password: pw }),
      });
      setOk(`Password updated for "${u.username}". They can sign in with the new password now.`);
      setResetFor(null); setPw('');
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="pc-detail">
      <div className="pc-detail-meta">
        <span className="pc-detail-url">
          <ArrowRight size={13} /> <code>{tenant.slug}.localhost:5173/admin</code>
        </span>
        <span className="pc-detail-hint">Passwords are stored encrypted and can't be shown — use “Set password” to assign a new one.</span>
      </div>
      {ok && <div className="pc-alert pc-alert-ok"><CheckCircle2 size={15} /> <span>{ok}</span></div>}
      {users == null ? (
        <div className="pc-loading"><Loader2 size={15} className="pc-spin" /> Loading accounts…</div>
      ) : (
        <div className="pc-table-wrap">
          <table className="pc-table pc-table-sub">
            <thead>
              <tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th className="pc-right"></th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <Fragment key={u.id}>
                  <tr>
                    <td className="pc-mono">{u.username}</td>
                    <td>{u.full_name || '—'}</td>
                    <td><span className="pc-role">{u.role}</span></td>
                    <td>
                      <span className={`pc-pill ${u.is_blocked ? 'pc-pill-off' : 'pc-pill-ok'}`}>
                        <span className="pc-pill-dot" />{u.is_blocked ? 'blocked' : 'active'}
                      </span>
                    </td>
                    <td className="pc-right">
                      <button className={`pc-btn pc-btn-sm pc-btn-outline ${resetFor === u.id ? 'is-active' : ''}`}
                        onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setPw(''); }}>
                        <KeyRound size={13} /> {resetFor === u.id ? 'Cancel' : 'Set password'}
                      </button>
                    </td>
                  </tr>
                  {resetFor === u.id && (
                    <tr>
                      <td colSpan={5} className="pc-pw-row">
                        <div className="pc-pw-form">
                          <div className="pc-inp pc-inp-sm is-filled" style={{ maxWidth: 280 }}>
                            <Lock size={15} className="pc-inp-icon" />
                            <input type="text" autoFocus placeholder={`New password for ${u.username}`}
                              value={pw} onChange={e => setPw(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') savePassword(u); }} />
                          </div>
                          <button className="pc-btn pc-btn-sm pc-btn-success" disabled={busy} onClick={() => savePassword(u)}>
                            {busy ? <><Loader2 size={14} className="pc-spin" /> Saving…</> : <><CheckCircle2 size={14} /> Save password</>}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {users.length === 0 && <tr><td colSpan={5} className="pc-empty">No user accounts.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Create tenant ──────────────────────────────────────────────────────── */
function CreateTenant({ onCreated, onErr }) {
  const [f, setF] = useState({ slug: '', name: '', owner_username: '', owner_password: '', owner_full_name: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); onErr('');
    try {
      await api('/tenants', {
        method: 'POST',
        body: JSON.stringify({
          slug: f.slug.trim().toLowerCase(),
          name: f.name.trim(),
          owner: { username: f.owner_username.trim(), password: f.owner_password, full_name: f.owner_full_name.trim() || undefined },
        }),
      });
      setF({ slug: '', name: '', owner_username: '', owner_password: '', owner_full_name: '' });
      onCreated();
    } catch (e2) { onErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <form className="pc-card" onSubmit={submit}>
      <div className="pc-card-head">
        <div>
          <h3 className="pc-card-title">Create resort</h3>
          <p className="pc-card-sub">Provisions the tenant and seeds its first owner account.</p>
        </div>
        <span className="pc-stat-icon pc-tone-accent"><Plus size={18} /></span>
      </div>
      <div className="pc-card-body">
        <div className="pc-form-grid">
          <div className="pc-field">
            <label className="pc-label">Slug <span className="pc-label-hint">subdomain, e.g. bluewave</span></label>
            <div className="pc-inp is-filled">
              <input value={f.slug} onChange={set('slug')} pattern="[a-z0-9][a-z0-9-]*" placeholder="bluewave" required />
            </div>
          </div>
          <div className="pc-field">
            <label className="pc-label">Display name</label>
            <div className="pc-inp is-filled">
              <input value={f.name} onChange={set('name')} placeholder="Bluewave Resort" required />
            </div>
          </div>
          <div className="pc-field">
            <label className="pc-label">Owner username</label>
            <div className="pc-inp is-filled">
              <input value={f.owner_username} onChange={set('owner_username')} placeholder="owner" required />
            </div>
          </div>
          <div className="pc-field">
            <label className="pc-label">Owner password</label>
            <div className="pc-inp is-filled">
              <input type="password" value={f.owner_password} onChange={set('owner_password')} placeholder="••••••••" required />
            </div>
          </div>
          <div className="pc-field">
            <label className="pc-label">Owner full name <span className="pc-label-hint">optional</span></label>
            <div className="pc-inp is-filled">
              <input value={f.owner_full_name} onChange={set('owner_full_name')} placeholder="Jane Doe" />
            </div>
          </div>
        </div>
        <button className="pc-btn pc-btn-primary" disabled={busy} style={{ marginTop: 20 }}>
          {busy ? <><Loader2 size={16} className="pc-spin" /> Creating…</> : <><Plus size={16} /> Create resort + owner</>}
        </button>
      </div>
    </form>
  );
}

/* ─── Scoped styling (self-contained, no admin.css dependency) ───────────── */
function PlatformStyles() {
  return <style>{`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

.pc-root {
  --pc-bg: #070d1c;
  --pc-surface: #0d1a2e;
  --pc-surface2: #0f2038;
  --pc-border: #1a2d45;
  --pc-border2: #22395a;
  --pc-accent: #06b6d4;
  --pc-accent-2: #0284c7;
  --pc-text: #e8f0f8;
  --pc-sub: #9fb3cc;
  --pc-muted: #5a7290;
  --pc-dim: #47607e;
  --pc-success: #34d399;
  --pc-danger: #fc8080;
  --pc-warn: #fbbf24;
  --pc-violet: #a78bfa;
  --pc-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace;
  min-height: 100vh;
  background:
    radial-gradient(1000px 560px at 82% -12%, rgba(6,182,212,.12), transparent 60%),
    radial-gradient(760px 520px at -8% 112%, rgba(6,182,212,.07), transparent 60%),
    var(--pc-bg);
  color: var(--pc-text);
  font-family: 'Inter', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.pc-root * { box-sizing: border-box; }
.pc-root code { font-family: var(--pc-mono); }

/* Shell + header */
.pc-shell { max-width: 1080px; margin: 0 auto; padding: 28px 24px 72px; }
.pc-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; margin-bottom: 30px; flex-wrap: wrap;
}
.pc-brand { display: flex; align-items: center; gap: 14px; }
.pc-logo {
  width: 46px; height: 46px; border-radius: 13px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; color: #06121f;
  background: linear-gradient(135deg, #22d3ee, #06b6d4 55%, #0284c7);
  box-shadow: 0 8px 26px -8px rgba(6,182,212,.6), inset 0 1px 0 rgba(255,255,255,.35);
}
.pc-brand-title {
  margin: 2px 0 0; font-size: 24px; font-weight: 600; letter-spacing: -.01em;
  color: #fff; font-family: Georgia, 'Times New Roman', serif;
}
.pc-eyebrow {
  margin: 0; font-size: 10.5px; font-weight: 700; letter-spacing: .22em;
  text-transform: uppercase; color: var(--pc-accent);
}

/* Buttons */
.pc-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  font-family: inherit; font-size: 13px; font-weight: 600; letter-spacing: .01em;
  padding: 10px 16px; border-radius: 10px; border: 1px solid transparent;
  cursor: pointer; transition: .16s ease; white-space: nowrap;
}
.pc-btn:disabled { opacity: .5; cursor: not-allowed; }
.pc-btn-sm { padding: 7px 11px; font-size: 12px; border-radius: 8px; gap: 5px; }
.pc-btn-block { width: 100%; }
.pc-btn-primary {
  color: #06121f; border: none;
  background: linear-gradient(135deg, #22d3ee, #06b6d4 55%, #0284c7);
  box-shadow: 0 6px 20px -6px rgba(6,182,212,.6);
}
.pc-btn-primary:not(:disabled):hover { box-shadow: 0 8px 26px -6px rgba(6,182,212,.75); transform: translateY(-1px); }
.pc-btn-ghost { background: rgba(255,255,255,.02); border-color: var(--pc-border2); color: var(--pc-sub); }
.pc-btn-ghost:hover { border-color: var(--pc-accent); color: var(--pc-text); }
.pc-btn-outline { background: rgba(255,255,255,.02); border-color: var(--pc-border2); color: var(--pc-sub); }
.pc-btn-outline:hover { border-color: var(--pc-accent); color: var(--pc-text); }
.pc-btn-outline.is-active { border-color: var(--pc-accent); color: var(--pc-accent); background: rgba(6,182,212,.1); }
.pc-btn-soft { background: rgba(6,182,212,.1); border-color: rgba(6,182,212,.28); color: #67e8f9; }
.pc-btn-soft:not(:disabled):hover { background: rgba(6,182,212,.18); border-color: var(--pc-accent); }
.pc-btn-success { background: rgba(52,211,153,.12); border-color: rgba(52,211,153,.3); color: var(--pc-success); }
.pc-btn-success:not(:disabled):hover { background: rgba(52,211,153,.2); border-color: var(--pc-success); }
.pc-btn-danger { background: rgba(252,128,128,.1); border-color: rgba(252,128,128,.28); color: var(--pc-danger); }
.pc-btn-danger:not(:disabled):hover { background: rgba(252,128,128,.18); border-color: var(--pc-danger); }

/* Stat tiles */
.pc-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 22px; }
.pc-stat {
  position: relative; overflow: hidden;
  background: linear-gradient(180deg, var(--pc-surface2), var(--pc-surface));
  border: 1px solid var(--pc-border); border-radius: 14px; padding: 16px 18px;
}
.pc-stat::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--pc-accent); }
.pc-tone-accent.pc-stat::before { background: var(--pc-accent); }
.pc-tone-success.pc-stat::before { background: var(--pc-success); }
.pc-tone-violet.pc-stat::before { background: var(--pc-violet); }
.pc-tone-amber.pc-stat::before { background: var(--pc-warn); }
.pc-stat-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.pc-stat-label { font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--pc-muted); }
.pc-stat-icon { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; }
.pc-tone-accent .pc-stat-icon  { background: rgba(6,182,212,.14);  color: var(--pc-accent); }
.pc-tone-success .pc-stat-icon { background: rgba(52,211,153,.14); color: var(--pc-success); }
.pc-tone-violet .pc-stat-icon  { background: rgba(167,139,250,.16); color: var(--pc-violet); }
.pc-tone-amber .pc-stat-icon   { background: rgba(251,191,36,.14);  color: var(--pc-warn); }
.pc-stat-value { font-family: var(--pc-mono); font-size: 30px; font-weight: 500; line-height: 1; color: #fff; letter-spacing: -.02em; }
.pc-stat-sub { margin-top: 7px; font-size: 12px; color: var(--pc-muted); }

/* Cards */
.pc-card {
  background: linear-gradient(180deg, var(--pc-surface2), var(--pc-surface));
  border: 1px solid var(--pc-border); border-radius: 16px; margin-bottom: 20px;
  box-shadow: 0 24px 60px -40px rgba(0,0,0,.8);
}
.pc-card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 18px 22px; border-bottom: 1px solid var(--pc-border); flex-wrap: wrap;
}
.pc-card-title { margin: 0; font-size: 17px; font-weight: 600; color: #fff; letter-spacing: .01em; }
.pc-card-sub { margin: 3px 0 0; font-size: 12.5px; color: var(--pc-muted); }
.pc-card-body { padding: 20px 22px; }

/* Search */
.pc-search {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; min-width: 220px;
  background: #08111f; border: 1px solid var(--pc-border2); border-radius: 10px;
  color: var(--pc-dim); transition: .16s;
}
.pc-search.is-filled, .pc-search:focus-within { border-color: var(--pc-accent); color: var(--pc-accent); box-shadow: 0 0 0 3px rgba(6,182,212,.12); }
.pc-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; color: var(--pc-text); font: inherit; font-size: 13.5px; }
.pc-search input::placeholder { color: var(--pc-dim); }
.pc-search-x { background: none; border: none; color: var(--pc-muted); cursor: pointer; display: flex; padding: 0; }
.pc-search-x:hover { color: var(--pc-text); }

/* Tables */
.pc-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.pc-table { width: 100%; border-collapse: collapse; min-width: 640px; }
.pc-table th {
  text-align: left; font-size: 10px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--pc-muted);
  padding: 12px 18px; border-bottom: 1px solid var(--pc-border);
}
.pc-table td { padding: 14px 18px; border-bottom: 1px solid rgba(26,45,69,.6); font-size: 13.5px; vertical-align: middle; }
.pc-table tbody tr:last-child td { border-bottom: none; }
.pc-table tbody tr:hover td { background: rgba(6,182,212,.04); }
.pc-table tr.is-open td { background: rgba(6,182,212,.07); }
.pc-table tr.pc-detail-row:hover td, .pc-table tr.pc-detail-row td { background: transparent; padding: 0; }
.pc-num { text-align: right; }
.pc-right { text-align: right; }
.pc-mono { font-family: var(--pc-mono); font-variant-numeric: tabular-nums; font-size: 13px; }
.pc-dim { color: var(--pc-muted); }
.pc-resort-name { font-weight: 600; color: #fff; font-size: 14px; margin-bottom: 4px; }
.pc-slug {
  display: inline-block; font-family: var(--pc-mono); font-size: 11px; color: #67e8f9;
  background: rgba(6,182,212,.1); border: 1px solid rgba(6,182,212,.2);
  padding: 1px 8px; border-radius: 6px; letter-spacing: .02em;
}
.pc-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.pc-caret { transition: transform .2s; }
.pc-caret.rot { transform: rotate(180deg); }
.pc-role { text-transform: capitalize; color: var(--pc-sub); }
.pc-empty { text-align: center; color: var(--pc-muted); padding: 34px 18px; font-size: 13.5px; }

/* Status pill */
.pc-pill {
  display: inline-flex; align-items: center; gap: 6px; text-transform: capitalize;
  font-size: 11.5px; font-weight: 600; padding: 3px 10px 3px 8px; border-radius: 20px;
}
.pc-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
.pc-pill-ok  { color: var(--pc-success); background: rgba(52,211,153,.12); border: 1px solid rgba(52,211,153,.25); }
.pc-pill-off { color: var(--pc-danger);  background: rgba(252,128,128,.1);  border: 1px solid rgba(252,128,128,.24); }

/* Tenant detail */
.pc-detail { padding: 4px 18px 20px; background: rgba(4,10,20,.5); border-top: 1px solid var(--pc-border); }
.pc-detail-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 14px 0 12px; }
.pc-detail-url { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--pc-accent); }
.pc-detail-url code { color: #67e8f9; }
.pc-detail-hint { font-size: 12px; color: var(--pc-muted); }
.pc-table-sub { min-width: 520px; }
.pc-table-sub th { border-bottom-color: var(--pc-border); }
.pc-table-sub td { border-bottom-color: rgba(26,45,69,.5); }
.pc-pw-row { background: rgba(6,182,212,.04) !important; }
.pc-pw-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

/* Inputs */
.pc-label { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--pc-muted); margin: 0 0 7px; }
.pc-label-hint { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--pc-dim); font-size: 11px; }
.pc-inp {
  display: flex; align-items: center; gap: 10px; padding: 0 14px;
  background: #08111f; border: 1.5px solid var(--pc-border2); border-radius: 11px;
  transition: border-color .16s, box-shadow .16s;
}
.pc-inp + .pc-label { margin-top: 16px; }
.pc-inp-icon { color: var(--pc-dim); flex-shrink: 0; transition: color .16s; }
.pc-inp input { flex: 1; min-width: 0; background: none; border: none; outline: none; color: var(--pc-text); font: inherit; font-size: 14.5px; padding: 13px 0; caret-color: var(--pc-accent); }
.pc-inp input::placeholder { color: var(--pc-dim); }
.pc-inp.is-filled .pc-inp-icon { color: var(--pc-accent); }
.pc-inp:focus-within { border-color: var(--pc-accent); box-shadow: 0 0 0 3px rgba(6,182,212,.15); }
.pc-inp:focus-within .pc-inp-icon { color: var(--pc-accent); }
.pc-inp-sm { border-radius: 9px; }
.pc-inp-sm input { padding: 9px 0; font-size: 13.5px; }
.pc-inp-eye { background: none; border: none; cursor: pointer; color: var(--pc-dim); display: flex; padding: 0; flex-shrink: 0; }
.pc-inp-eye:hover { color: var(--pc-accent); }
.pc-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 18px; }
.pc-field { min-width: 0; }

/* Alerts */
.pc-alert {
  display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px;
  border-radius: 11px; font-size: 13px; line-height: 1.45; margin-bottom: 14px;
}
.pc-alert svg { flex-shrink: 0; margin-top: 1px; }
.pc-alert-err { background: rgba(252,128,128,.08); border: 1px solid rgba(252,128,128,.3); color: #fca5a5; }
.pc-alert-ok  { background: rgba(52,211,153,.08); border: 1px solid rgba(52,211,153,.3); color: #6ee7b7; }
.pc-alert-bar { position: relative; padding-right: 40px; }
.pc-alert-x { position: absolute; top: 10px; right: 10px; background: none; border: none; color: inherit; opacity: .6; cursor: pointer; display: flex; padding: 2px; border-radius: 5px; }
.pc-alert-x:hover { opacity: 1; background: rgba(255,255,255,.08); }

.pc-loading { display: flex; align-items: center; gap: 8px; color: var(--pc-muted); font-size: 13px; padding: 16px 0; }

/* Login */
.pc-login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.pc-login-card {
  width: 100%; max-width: 420px; padding: 34px 34px 26px;
  background: linear-gradient(180deg, var(--pc-surface2), var(--pc-surface));
  border: 1px solid var(--pc-border); border-radius: 20px;
  box-shadow: 0 40px 90px -30px rgba(0,0,0,.8), 0 0 0 1px rgba(6,182,212,.06);
}
.pc-login-logo {
  width: 54px; height: 54px; border-radius: 15px; color: #06121f;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #22d3ee, #06b6d4 55%, #0284c7);
  box-shadow: 0 12px 34px -8px rgba(6,182,212,.6), inset 0 1px 0 rgba(255,255,255,.4);
}
.pc-login-title { margin: 4px 0 0; font-size: 30px; font-weight: 600; color: #fff; font-family: Georgia, 'Times New Roman', serif; letter-spacing: -.01em; }
.pc-login-sub { margin: 8px 0 22px; font-size: 13.5px; color: var(--pc-muted); }
.pc-login-card .pc-label:first-of-type { margin-top: 4px; }
.pc-login-foot { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 24px; font-size: 11.5px; color: var(--pc-dim); }

/* Motion */
.pc-spin { animation: pc-spin .7s linear infinite; }
@keyframes pc-spin { to { transform: rotate(360deg); } }

/* Responsive */
@media (max-width: 900px) {
  .pc-stats { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 560px) {
  .pc-shell { padding: 20px 14px 56px; }
  .pc-stats { grid-template-columns: 1fr 1fr; gap: 10px; }
  .pc-stat-value { font-size: 24px; }
  .pc-form-grid { grid-template-columns: 1fr; }
  .pc-card-head { padding: 16px; }
  .pc-card-body { padding: 16px; }
  .pc-search { width: 100%; }
  .pc-brand-title { font-size: 20px; }
  .pc-login-card { padding: 26px 22px 22px; }
}
`}</style>;
}
