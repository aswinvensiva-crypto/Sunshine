/**
 * PlatformApp.jsx — minimal super_admin console at /platform.
 *
 * Deliberately small (no admin-app polish): login as a platform admin, list
 * tenants, create a tenant (with its first owner account), suspend/reactivate,
 * and mint a 30-minute support-impersonation token. This unblocks onboarding
 * a new resort without a manual DB insert.
 */
import { useState, useEffect, useCallback, Fragment } from 'react';

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

const box = { maxWidth: 860, margin: '40px auto', padding: '0 20px', fontFamily: 'Inter, system-ui, sans-serif', color: '#1a2b3c' };
const card = { background: '#fff', border: '1px solid #dde5ee', borderRadius: 10, padding: 20, marginBottom: 20, boxShadow: '0 1px 4px rgba(20,40,70,.06)' };
const input = { display: 'block', width: '100%', boxSizing: 'border-box', padding: '9px 12px', margin: '6px 0 14px', border: '1px solid #c5d2e0', borderRadius: 8, fontSize: 14 };
const btn = (bg = '#0369a1') => ({ padding: '9px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' });
const errBox = { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '10px 14px', fontSize: 13.5, marginBottom: 14 };

export default function PlatformApp() {
  const [authed, setAuthed] = useState(!!localStorage.getItem(TOKEN_KEY));
  return (
    <div style={{ background: '#f2f6fa', minHeight: '100vh' }}>
      <div style={box}>
        <h1 style={{ fontSize: 22, margin: '18px 0 4px' }}>Sunshine Platform Console</h1>
        <p style={{ margin: '0 0 24px', color: '#5a7290', fontSize: 13.5 }}>
          super_admin · tenant management {authed && (
            <button style={{ ...btn('#64748b'), marginLeft: 12, padding: '4px 10px' }}
              onClick={() => { localStorage.removeItem(TOKEN_KEY); setAuthed(false); }}>Sign out</button>
          )}
        </p>
        {authed ? <Tenants /> : <Login onOk={() => setAuthed(true)} />}
      </div>
    </div>
  );
}

function Login({ onOk }) {
  const [u, setU] = useState(''); const [p, setP] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const { token } = await api('/login', { method: 'POST', body: JSON.stringify({ username: u.trim(), password: p }) });
      localStorage.setItem(TOKEN_KEY, token);
      onOk();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <form style={{ ...card, maxWidth: 380 }} onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>Platform sign in</h3>
      {err && <div style={errBox}>{err}</div>}
      <label style={{ fontSize: 13 }}>Username
        <input style={input} value={u} onChange={e => setU(e.target.value)} autoFocus /></label>
      <label style={{ fontSize: 13 }}>Password
        <input style={input} type="password" value={p} onChange={e => setP(e.target.value)} /></label>
      <button style={btn()} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null); // tenant row currently expanded

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

  return (
    <>
      {err && <div style={errBox}>{err} <button style={{ ...btn('#64748b'), padding: '2px 8px', marginLeft: 8 }} onClick={() => setErr('')}>×</button></div>}
      {notice && <div style={{ ...errBox, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>{notice}</div>}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Resorts</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#5a7290' }}>
              <th style={{ padding: '6px 8px' }}>Slug</th><th>Name</th><th>Status</th>
              <th>Users</th><th>Bookings</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map(t => (
              <Fragment key={t.id}>
                <tr style={{ borderTop: '1px solid #e7edf4', background: selected === t.id ? '#eef5fb' : undefined }}>
                  <td style={{ padding: '8px', fontFamily: 'monospace' }}>{t.slug}</td>
                  <td>{t.name}</td>
                  <td style={{ color: t.status === 'active' ? '#15803d' : '#b91c1c', fontWeight: 600 }}>{t.status}</td>
                  <td>{t.user_count}</td>
                  <td>{t.booking_count}</td>
                  <td style={{ padding: '6px 0', whiteSpace: 'nowrap' }}>
                    <button style={btn('#0369a1')} onClick={() => setSelected(selected === t.id ? null : t.id)}>
                      {selected === t.id ? 'Close' : 'Manage'}
                    </button>
                    {' '}
                    {t.status === 'active'
                      ? <button style={btn('#b91c1c')} onClick={() => setStatus(t, 'suspended')}>Suspend</button>
                      : <button style={btn('#15803d')} onClick={() => setStatus(t, 'active')}>Reactivate</button>}
                    {' '}
                    <button style={btn('#64748b')} onClick={() => impersonate(t)} disabled={t.status !== 'active'}>Impersonate</button>
                  </td>
                </tr>
                {selected === t.id && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0, background: '#f7fafd' }}>
                      <TenantDetail tenant={t} onErr={setErr} onChanged={load} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {tenants.length === 0 && <tr><td colSpan={6} style={{ padding: 12, color: '#5a7290' }}>No tenants yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <CreateTenant onCreated={load} onErr={setErr} />
    </>
  );
}

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
    <div style={{ padding: '16px 20px' }}>
      <div style={{ fontSize: 12.5, color: '#5a7290', marginBottom: 10 }}>
        Login URL: <code>{tenant.slug}.localhost:5173/admin</code> · Passwords are stored encrypted and cannot be shown — use "Set password" to assign a new one.
      </div>
      {ok && <div style={{ ...errBox, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>{ok}</div>}
      {users == null ? <div style={{ color: '#5a7290', fontSize: 13 }}>Loading accounts…</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#5a7290' }}>
              <th style={{ padding: '4px 8px' }}>Username</th><th>Name</th><th>Role</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <Fragment key={u.id}>
                <tr style={{ borderTop: '1px solid #e7edf4' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{u.username}</td>
                  <td>{u.full_name || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{u.role}</td>
                  <td style={{ color: u.is_blocked ? '#b91c1c' : '#15803d' }}>{u.is_blocked ? 'blocked' : 'active'}</td>
                  <td style={{ textAlign: 'right', padding: '4px 0' }}>
                    <button style={btn('#0369a1')}
                      onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setPw(''); }}>
                      {resetFor === u.id ? 'Cancel' : 'Set password'}
                    </button>
                  </td>
                </tr>
                {resetFor === u.id && (
                  <tr>
                    <td colSpan={5} style={{ padding: '8px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input style={{ ...input, margin: 0, maxWidth: 260 }} type="text" autoFocus
                          placeholder={`New password for ${u.username}`}
                          value={pw} onChange={e => setPw(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') savePassword(u); }} />
                        <button style={btn('#15803d')} disabled={busy} onClick={() => savePassword(u)}>
                          {busy ? 'Saving…' : 'Save password'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {users.length === 0 && <tr><td colSpan={5} style={{ padding: 10, color: '#5a7290' }}>No user accounts.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

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
    <form style={card} onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>Create resort</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
        <label style={{ fontSize: 13 }}>Slug (subdomain, e.g. <code>bluewave</code>)
          <input style={input} value={f.slug} onChange={set('slug')} pattern="[a-z0-9][a-z0-9-]*" required /></label>
        <label style={{ fontSize: 13 }}>Display name
          <input style={input} value={f.name} onChange={set('name')} required /></label>
        <label style={{ fontSize: 13 }}>Owner username
          <input style={input} value={f.owner_username} onChange={set('owner_username')} required /></label>
        <label style={{ fontSize: 13 }}>Owner password
          <input style={input} type="password" value={f.owner_password} onChange={set('owner_password')} required /></label>
        <label style={{ fontSize: 13 }}>Owner full name (optional)
          <input style={input} value={f.owner_full_name} onChange={set('owner_full_name')} /></label>
      </div>
      <button style={btn('#15803d')} disabled={busy}>{busy ? 'Creating…' : 'Create resort + owner'}</button>
    </form>
  );
}
