/**
 * Access.jsx — Users & roles, approvals inbox, housekeeping PIN/devices.
 * UI only hides what you can't do; every action is enforced by the API.
 */
import { useState } from "react";
import { ShieldCheck, KeyRound, Smartphone, Check, X as XIcon, UserPlus } from "lucide-react";
import { useApi, apiFetch, getUser, can, rupee, fmtDate, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, Field, Grid2, TableWrap, Modal, EmptyState } from "./ui.jsx";

const json = (method, body) => ({ method, body: JSON.stringify(body || {}) });
const KIND_LABEL = { "refund.booking": "Refund", "refund.gateway": "Gateway refund", writeoff: "Write-off", "rate.override": "Rate override" };

function UsersAndRoles() {
  const users = useApi(() => apiFetch("/api/admin/users"));
  const roles = useApi(() => apiFetch("/api/admin/iam/roles"));
  const [resetFor, setResetFor] = useState(null);
  const [pw, setPw] = useState("");
  const [add, setAdd] = useState(null);
  const canAdmin = can("user.admin");
  const me = getUser();

  const act = async (fn, ok) => {
    try { await fn(); notify(ok, "success"); users.reload(); } catch (e) { notify(e.message, "error"); }
  };

  if (users.loading || roles.loading) return <Spinner />;
  if (users.error) return <ApiError msg={users.error} />;

  return (
    <>
      <Card
        title="Users"
        action={can("user.manage") && (
          <button className="ff-btn ff-btn-primary" onClick={() => setAdd({ username: "", full_name: "", password: "", role_code: "FRONT_DESK", phone: "" })}>
            <UserPlus size={15} /> Add user
          </button>
        )}
      >
        <TableWrap>
          <thead><tr><th>User</th><th>Role</th><th>WhatsApp</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>
            {(users.data || []).map(u => (
              <tr key={u.id}>
                <td><b>{u.full_name || u.username}</b><div style={{ fontSize: 11, color: "var(--ff-muted)" }}>{u.username}{u.is_blocked ? " · blocked" : ""}</div></td>
                <td>
                  {canAdmin && u.username !== me.username ? (
                    <select
                      className="ff-input"
                      value={u.role_code || ""}
                      onChange={e => act(() => apiFetch(`/api/admin/iam/users/${u.id}/role`, json("PUT", { role_code: e.target.value })), "Role updated; their session was signed out")}
                    >
                      {(roles.data || []).map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
                    </select>
                  ) : (u.role_name || u.role)}
                </td>
                <td>{u.phone || "—"}</td>
                <td>{u.last_login_at ? fmtDate(u.last_login_at) : "never"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="ff-btn ff-btn-outline" onClick={() => { setPw(""); setResetFor(u); }}><KeyRound size={14} /> Reset password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {resetFor && (
        <Modal title={`Reset password — ${resetFor.username}`} onClose={() => setResetFor(null)}>
          <Field label="New password (min 8 characters)">
            <input className="ff-input" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
          </Field>
          <p style={{ fontSize: 12, color: "var(--ff-muted)" }}>They will be signed out everywhere and any lockout is cleared.</p>
          <button className="ff-btn ff-btn-primary" onClick={() => act(async () => {
            await apiFetch(`/api/admin/iam/users/${resetFor.id}/reset-password`, json("POST", { password: pw }));
            setResetFor(null);
          }, "Password reset")}>Reset</button>
        </Modal>
      )}

      {add && (
        <Modal title="Add user" onClose={() => setAdd(null)}>
          <Grid2>
            <Field label="Username"><input className="ff-input" value={add.username} onChange={e => setAdd({ ...add, username: e.target.value })} /></Field>
            <Field label="Full name"><input className="ff-input" value={add.full_name} onChange={e => setAdd({ ...add, full_name: e.target.value })} /></Field>
            <Field label="Password (min 8)"><input className="ff-input" type="password" autoComplete="new-password" value={add.password} onChange={e => setAdd({ ...add, password: e.target.value })} /></Field>
            <Field label="Role">
              <select className="ff-input" value={add.role_code} onChange={e => setAdd({ ...add, role_code: e.target.value })}>
                {(roles.data || []).map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="WhatsApp number (+91…)"><input className="ff-input" value={add.phone} onChange={e => setAdd({ ...add, phone: e.target.value })} /></Field>
          </Grid2>
          <button className="ff-btn ff-btn-primary" onClick={() => act(async () => {
            const created = await apiFetch("/api/admin/users", json("POST", { ...add, phone: undefined }));
            if (add.phone) await apiFetch(`/api/admin/iam/users/${created.id}/phone`, json("PUT", { phone: add.phone }));
            setAdd(null);
          }, "User created")}>Create</button>
        </Modal>
      )}

      <Card title="What each role can do">
        <TableWrap>
          <thead><tr><th>Role</th><th>Permissions</th></tr></thead>
          <tbody>
            {(roles.data || []).map(r => (
              <tr key={r.code}>
                <td><b>{r.name}</b></td>
                <td style={{ fontSize: 11.5, color: "var(--ff-muted)" }}>{r.permissions.length} permissions — {r.permissions.slice(0, 8).join(", ")}{r.permissions.length > 8 ? " …" : ""}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

function Approvals() {
  const list = useApi(() => apiFetch("/api/admin/iam/approvals"));
  const [note, setNote] = useState({});
  const decide = async (id, decision) => {
    try {
      await apiFetch(`/api/admin/iam/approvals/${id}/decide`, json("POST", { decision, note: note[id] }));
      notify(decision === "approve" ? "Approved and applied" : "Rejected", "success");
    } catch (e) { notify(e.message, "error"); }
    list.reload();
  };
  if (list.loading) return <Spinner />;
  if (list.error) return <ApiError msg={list.error} />;
  const rows = list.data || [];
  const approver = can("approval.decide");
  return (
    <Card title={approver ? "Approval requests" : "My requests"}>
      {rows.length === 0 ? <EmptyState text="No approval requests." icon={ShieldCheck} /> : (
        <TableWrap>
          <thead><tr><th>Request</th><th>By</th><th>Amount</th><th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id}>
                <td><b>{KIND_LABEL[a.kind] || a.kind}</b><div style={{ fontSize: 11, color: "var(--ff-muted)" }}>{fmtDate(a.created_at)}{a.payload?.booking_id ? ` · booking #${a.payload.booking_id}` : ""}</div></td>
                <td>{a.requested_by_name}</td>
                <td>{a.amount != null ? rupee(a.amount) : "—"}</td>
                <td>{a.reason || "—"}</td>
                <td>{a.status}{a.status === "failed" && a.result?.message ? ` — ${a.result.message}` : ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {approver && a.status === "pending" && (
                    <>
                      <input className="ff-input" placeholder="Note (optional)" value={note[a.id] || ""} onChange={e => setNote({ ...note, [a.id]: e.target.value })} style={{ width: 150, marginRight: 6 }} />
                      <button className="ff-btn ff-btn-primary" onClick={() => decide(a.id, "approve")}><Check size={14} /> Approve</button>{" "}
                      <button className="ff-btn ff-btn-outline" onClick={() => decide(a.id, "reject")}><XIcon size={14} /> Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

function Housekeeping() {
  const emps = useApi(() => apiFetch("/api/admin/employees"));
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState("");
  const [code, setCode] = useState(null);
  if (emps.loading) return <Spinner />;
  if (emps.error) return <ApiError msg={emps.error} />;
  const hk = (emps.data || []).filter(e => (e.roles || [e.role]).some(r => /housekeep|pool|maint/i.test(r)));
  return (
    <>
      <Card title="Housekeeping phones & PINs">
        <p style={{ fontSize: 12.5, color: "var(--ff-muted)" }}>
          Staff sign in on a shared phone with a 4–6 digit PIN. Each phone must be registered once with a one-time code (valid 15 minutes).
        </p>
        {hk.length === 0 ? <EmptyState text="No housekeeping staff yet." /> : (
          <TableWrap>
            <thead><tr><th>Employee</th><th /></tr></thead>
            <tbody>
              {hk.map(e => (
                <tr key={e.employee_id}>
                  <td><b>{e.first_name} {e.last_name}</b><div style={{ fontSize: 11, color: "var(--ff-muted)" }}>{e.username || "no portal username yet — set one in Staff"}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="ff-btn ff-btn-outline" onClick={() => { setPin(""); setPinFor(e); }}><KeyRound size={14} /> Set PIN</button>{" "}
                    <button className="ff-btn ff-btn-outline" onClick={async () => {
                      try { setCode({ emp: e, ...(await apiFetch(`/api/admin/iam/employees/${e.employee_id}/device-code`, json("POST"))) }); }
                      catch (err) { notify(err.message, "error"); }
                    }}><Smartphone size={14} /> Phone code</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {pinFor && (
        <Modal title={`Set PIN — ${pinFor.first_name}`} onClose={() => setPinFor(null)}>
          <Field label="PIN (4–6 digits)"><input className="ff-input" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} /></Field>
          <button className="ff-btn ff-btn-primary" onClick={async () => {
            try { await apiFetch(`/api/admin/iam/employees/${pinFor.employee_id}/pin`, json("PUT", { pin })); notify("PIN saved", "success"); setPinFor(null); }
            catch (e) { notify(e.message, "error"); }
          }}>Save PIN</button>
        </Modal>
      )}
      {code && (
        <Modal title={`Register a phone — ${code.emp.first_name}`} onClose={() => setCode(null)}>
          <p>On their phone open the staff portal, tap <b>Register this phone</b> and enter:</p>
          <div style={{ fontSize: 34, letterSpacing: 8, fontWeight: 800, textAlign: "center", margin: "12px 0" }}>{code.code}</div>
          <p style={{ fontSize: 12, color: "var(--ff-muted)" }}>One-time code, expires {new Date(code.expires_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.</p>
        </Modal>
      )}
    </>
  );
}

export default function Access() {
  const tabs = [
    can("user.manage") && ["users", "Users & roles"],
    ["approvals", can("approval.decide") ? "Approvals" : "My requests"],
    can("staff.manage") && ["hk", "Housekeeping PINs"],
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <div className="ff-page">
      <SectionHeader eyebrow="Security" title="Access & Approvals" />
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {tabs.map(([k, label]) => (
          <button key={k} className={`ff-btn ${tab === k ? "ff-btn-primary" : "ff-btn-outline"}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === "users" && <UsersAndRoles />}
      {tab === "approvals" && <Approvals />}
      {tab === "hk" && <Housekeeping />}
    </div>
  );
}
