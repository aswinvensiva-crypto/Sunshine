/**
 * Staff.jsx
 * Employee Directory + Shift Cycle Manager from f1.docx:
 * employees table, shift_schedules table, clock-in/out.
 * "Shift Calendar Grid Component — assign shifts dynamically across days."
 */
import { useState } from "react";
import { Plus, Pencil, X, Clock, UserCheck, UserX, ShieldOff, Shield, Trash2, KeyRound } from "lucide-react";
import { useApi, apiFetch, adminUsers, blockUser, deleteUser, deleteEmployee, getUser, fmtDate, fmtTime, todayISO, notify, setEmployeeCredentials } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, Field, Grid2, TableWrap, Modal, StatusBadge, EmptyState } from "./ui.jsx";

const ROLES      = ["Front Desk", "Housekeeping", "Maintenance", "Manager", "Pool Attendant"];
const DAYS       = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() + i - 3);
  return { label: d.toLocaleDateString("en-IN", { weekday: "short", month:"short", day:"numeric" }), iso: d.toISOString().slice(0, 10) };
});

const ROLE_COLOR = {
  "Front Desk":  "#3b82f6",
  "Housekeeping":"#10b981",
  "Maintenance": "#f59e0b",
  "Manager":     "#a855f7",
  "Pool Attendant":"#06b6d4",
};

export default function Staff() {
  const emp         = useApi(() => apiFetch("/api/admin/employees"));
  const shifts      = useApi(() => apiFetch("/api/admin/shifts"));
  const users       = useApi(adminUsers);
  const shiftMaster = useApi(() => apiFetch("/api/admin/shift-master"));

  const currentUser = getUser();
  const isOwner = currentUser?.role === "owner";

  const [empModal,   setEmpModal]   = useState(null);
  const [shiftModal, setShiftModal] = useState(null);
  const [empForm,    setEmpForm]    = useState({ first_name:"", last_name:"", roles:["Front Desk"], phone:"", is_active:true });
  const [shiftForm,  setShiftForm]  = useState({ employee_id:"", shift_date: todayISO(), start_time:"09:00", end_time:"17:00" });
  const [credForm,   setCredForm]   = useState({ username:"", password:"", confirm:"" });
  const [busy, setBusy] = useState(false);
  const [confirmDelUser, setConfirmDelUser] = useState(null);
  const [confirmDelEmp, setConfirmDelEmp] = useState(null);
  const [confirmDelShift, setConfirmDelShift] = useState(null); // { employee_id, shift_date, label }

  const employees   = emp.data || [];
  const shiftList   = shifts.data || [];
  const masterList  = shiftMaster.data || [];

  // Build default shift lookup: employeeId → { default_start_time, default_end_time }
  const masterMap = {};
  masterList.forEach(m => { masterMap[m.employee_id] = m; });

  // Build shift map: employeeId → date → shift
  const shiftMap = {};
  shiftList.forEach(s => {
    if (!shiftMap[s.employee_id]) shiftMap[s.employee_id] = {};
    shiftMap[s.employee_id][s.shift_date?.slice(0,10)] = s;
  });

  const toggleBlock = async (u) => {
    setBusy(true);
    try {
      await blockUser(u.id, !u.is_blocked);
      notify(u.is_blocked ? `${u.username} unblocked` : `${u.username} blocked`, "success");
      users.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const doDeleteUser = async () => {
    if (!confirmDelUser) return;
    setBusy(true);
    try {
      await deleteUser(confirmDelUser.id);
      notify(`${confirmDelUser.username} deleted`, "success");
      setConfirmDelUser(null); users.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const doDeleteShift = async () => {
    if (!confirmDelShift) return;
    setBusy(true);
    try {
      await apiFetch("/api/admin/shifts", { method: "DELETE", body: JSON.stringify({ employee_id: confirmDelShift.employee_id, shift_date: confirmDelShift.shift_date }) });
      notify("Shift removed", "success");
      setConfirmDelShift(null); shifts.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const doDeleteEmployee = async () => {
    if (!confirmDelEmp) return;
    setBusy(true);
    try {
      await deleteEmployee(confirmDelEmp.employee_id);
      notify(`${confirmDelEmp.first_name} removed from directory`, "success");
      setConfirmDelEmp(null); emp.reload(); shifts.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const saveCredentials = async (e) => {
    e.preventDefault();
    if (!empModal?.employee_id) return;
    if (!credForm.username) return notify("Username is required", "error");
    if (credForm.password && credForm.password !== credForm.confirm) return notify("Passwords do not match", "error");
    if (!credForm.password && !empModal.username) return notify("Password is required for new credentials", "error");
    setBusy(true);
    try {
      const payload = { username: credForm.username };
      if (credForm.password) payload.password = credForm.password;
      await setEmployeeCredentials(empModal.employee_id, payload);
      notify("Portal credentials saved!", "success");
      setCredForm({ username:"", password:"", confirm:"" });
      emp.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const saveEmployee = async (e) => {
    e.preventDefault();
    if (!empForm.first_name || !empForm.phone) return notify("Name and phone are required", "error");
    if (!empForm.roles || empForm.roles.length === 0) return notify("At least one role is required", "error");
    setBusy(true);
    try {
      const isEdit = empModal?.employee_id;
      await apiFetch(isEdit ? `/api/admin/employees/${isEdit}` : "/api/admin/employees", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(empForm),
      });
      notify(isEdit ? "Staff updated!" : "Staff added!", "success");
      setEmpModal(null); emp.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const saveShift = async (e) => {
    e.preventDefault();
    if (!shiftForm.employee_id || !shiftForm.shift_date) return notify("Employee and date required", "error");
    setBusy(true);
    try {
      await apiFetch("/api/admin/shifts", { method: "POST", body: JSON.stringify(shiftForm) });
      notify("Shift assigned!", "success");
      setShiftModal(null); shifts.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  if (emp.loading) return <Spinner />;

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Workforce"
        title="Staff Management"
        action={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ff-btn ff-btn-outline" onClick={() => { setShiftForm({ employee_id:"", shift_date:todayISO(), start_time:"09:00", end_time:"17:00" }); setShiftModal(true); }}>
              <Clock size={15} /> Assign Shift
            </button>
            <button className="ff-btn ff-btn-primary" onClick={() => { setEmpForm({ first_name:"", last_name:"", roles:["Front Desk"], phone:"", is_active:true }); setEmpModal({}); }}>
              <Plus size={15} /> Add Employee
            </button>
          </div>
        }
      />

      {/* Shift Calendar Grid */}
      <Card title="Shift Calendar — 7-Day View">
        {emp.error ? <ApiError msg={emp.error} /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={{ padding: "10px 14px", textAlign:"left", fontSize:11, letterSpacing:".08em", textTransform:"uppercase", color:"var(--ff-muted)", width: 160 }}>Employee</th>
                  {DAYS.map(d => (
                    <th key={d.iso} style={{ padding:"10px 8px", fontSize:11, textAlign:"center", color: d.iso === todayISO() ? "var(--ff-primary)" : "var(--ff-muted)" }}>
                      {d.label}{d.iso === todayISO() && <div style={{ fontSize:9, color:"var(--ff-primary)" }}>TODAY</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr><td colSpan={DAYS.length + 1} style={{ padding: 24, textAlign:"center", color:"var(--ff-muted)" }}>No employees yet — add one above.</td></tr>
                ) : employees.map(emp => (
                  <tr key={emp.employee_id} style={{ borderTop: "1px solid var(--ff-border)" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {(() => { const primaryRole = (emp.roles || [emp.role])[0]; const c = ROLE_COLOR[primaryRole] || "#6b7280"; return (
                        <div style={{ width:30, height:30, borderRadius:"50%", background: c + "33", border:`2px solid ${c}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color: c }}>
                          {emp.first_name[0]}
                        </div>
                        ); })()}
                        <div>
                          <div style={{ fontSize:13, fontWeight:600, color:"var(--ff-text)" }}>{emp.first_name} {emp.last_name}</div>
                          <div style={{ fontSize:10, color:"var(--ff-muted)", display:"flex", flexWrap:"wrap", gap:3 }}>
                            {(emp.roles || [emp.role]).map(r => <span key={r} style={{ color: ROLE_COLOR[r] || "var(--ff-muted)" }}>{r}</span>).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`sep-${i}`} style={{ color:"var(--ff-border)" }}>·</span>, el], [])}
                          </div>
                        </div>
                      </div>
                    </td>
                    {DAYS.map(d => {
                      const s = shiftMap[emp.employee_id]?.[d.iso];
                      const openEdit = () => {
                        const def = masterMap[emp.employee_id];
                        setShiftForm({
                          employee_id: String(emp.employee_id),
                          shift_date:  d.iso,
                          start_time:  s ? s.start_time?.slice(0,5) : (def?.default_start_time?.slice(0,5) || "09:00"),
                          end_time:    s ? s.end_time?.slice(0,5)   : (def?.default_end_time?.slice(0,5)   || "17:00"),
                        });
                        setShiftModal(true);
                      };
                      const shiftColor = ROLE_COLOR[(emp.roles || [emp.role])[0]] || "#6b7280";
                      return (
                        <td key={d.iso} style={{ padding:"8px", textAlign:"center" }}>
                          {s ? (
                            <div style={{ background: shiftColor + "22", border:`1px solid ${shiftColor}44`, borderRadius:6, padding:"4px 6px", fontSize:10, color: shiftColor, fontWeight:600 }}>
                              {s.start_time?.slice(0,5)} – {s.end_time?.slice(0,5)}
                              {s.clock_in && <div style={{ fontSize:9, opacity:.7 }}>In: {fmtTime(s.clock_in)}</div>}
                              {isOwner && (
                                <div style={{ display:"flex", gap:4, justifyContent:"center", marginTop:3 }}>
                                  <button
                                    style={{ fontSize:9, padding:"1px 5px", borderRadius:3, border:"1px solid currentColor", background:"transparent", color:"inherit", cursor:"pointer", opacity:.75 }}
                                    onClick={openEdit}
                                    title="Edit shift"
                                  >✎</button>
                                  <button
                                    style={{ fontSize:9, padding:"1px 5px", borderRadius:3, border:"1px solid var(--ff-danger)", background:"transparent", color:"var(--ff-danger)", cursor:"pointer", opacity:.75 }}
                                    onClick={() => setConfirmDelShift({ employee_id: emp.employee_id, shift_date: d.iso, label: `${emp.first_name} ${emp.last_name} — ${d.label}` })}
                                    title="Delete shift"
                                  >✕</button>
                                </div>
                              )}
                            </div>
                          ) : (
                            isOwner ? (
                              <div
                                style={{ fontSize:10, color:"var(--ff-border)", letterSpacing:".1em", cursor:"pointer" }}
                                title="Assign shift"
                                onClick={openEdit}
                              >+</div>
                            ) : (
                              <div style={{ fontSize:10, color:"var(--ff-border)", letterSpacing:".1em" }}>—</div>
                            )
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Employee Directory */}
      <Card title="Employee Directory" noPad style={{ marginTop: 20 }}>
        {employees.length === 0 ? <EmptyState text="No employees added yet." icon={UserX} /> : (
          <TableWrap>
            <thead>
              <tr><th>Name</th><th>Role</th><th>Phone</th><th>Status</th><th>Portal</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {employees.map(e => (
                <tr key={e.employee_id}>
                  <td style={{ fontWeight:600 }}>{e.first_name} {e.last_name}</td>
                  <td>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                      {(e.roles || [e.role]).map(r => (
                        <span key={r} className="ff-badge" style={{ background: (ROLE_COLOR[r] || "#6b7280") + "22", color: ROLE_COLOR[r] || "#6b7280" }}>{r}</span>
                      ))}
                    </div>
                  </td>
                  <td className="ff-mono">{e.phone}</td>
                  <td>
                    {e.is_active
                      ? <span className="ff-badge ff-badge-green"><UserCheck size={11} style={{ verticalAlign:"-1px", marginRight:4 }}/>Active</span>
                      : <span className="ff-badge ff-badge-muted"><UserX size={11} style={{ verticalAlign:"-1px", marginRight:4 }}/>Inactive</span>}
                  </td>
                  <td>
                    {e.username
                      ? <span className="ff-badge ff-badge-blue" title={`Username: ${e.username}`}><Shield size={11} style={{ verticalAlign:"-1px", marginRight:4 }}/>{e.username}</span>
                      : <span className="ff-badge ff-badge-muted">No access</span>}
                  </td>
                  <td style={{ whiteSpace:"nowrap" }}>
                    <button className="ff-icon-btn" onClick={() => { setEmpModal(e); setEmpForm({ first_name:e.first_name, last_name:e.last_name, roles: e.roles || [e.role || "Front Desk"], phone:e.phone, is_active:e.is_active }); setCredForm({ username: e.username || "", password:"", confirm:"" }); }}>
                      <Pencil size={15} />
                    </button>
                    {isOwner && (
                      <button className="ff-icon-btn" title="Remove employee" style={{ color: "var(--ff-danger)" }} onClick={() => setConfirmDelEmp(e)}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Add/Edit Employee Modal */}
      {empModal !== null && (
        <Modal title={empModal?.employee_id ? "Edit Employee" : "Add New Employee"} onClose={() => setEmpModal(null)}>
          <form onSubmit={saveEmployee} className="ff-fields">
            <Grid2>
              <Field label="First Name *"><input value={empForm.first_name} onChange={e => setEmpForm(p => ({...p, first_name:e.target.value}))} required/></Field>
              <Field label="Last Name"><input value={empForm.last_name} onChange={e => setEmpForm(p => ({...p, last_name:e.target.value}))}/></Field>
              <Field label="Roles (select all that apply)">
                <div style={{ display:"flex", flexWrap:"wrap", gap:"8px 16px", paddingTop:4 }}>
                  {ROLES.map(r => (
                    <label key={r} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, cursor:"pointer", userSelect:"none" }}>
                      <input
                        type="checkbox"
                        checked={(empForm.roles || []).includes(r)}
                        onChange={e => {
                          const cur = empForm.roles || [];
                          setEmpForm(p => ({
                            ...p,
                            roles: e.target.checked ? [...cur, r] : cur.filter(x => x !== r),
                          }));
                        }}
                        style={{ accentColor: ROLE_COLOR[r] || "var(--ff-primary)", width:14, height:14 }}
                      />
                      <span style={{ color: (empForm.roles || []).includes(r) ? (ROLE_COLOR[r] || "var(--ff-primary)") : "var(--ff-muted)" }}>{r}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Phone *"><input value={empForm.phone} onChange={e => setEmpForm(p => ({...p, phone:e.target.value}))} required/></Field>
            </Grid2>
            <label className="ff-toggle-row">
              <input type="checkbox" checked={empForm.is_active} onChange={e => setEmpForm(p => ({...p, is_active:e.target.checked}))}/>
              <span>Active employee</span>
            </label>
            <button type="submit" className="ff-btn ff-btn-primary" style={{ width:"100%", justifyContent:"center" }} disabled={busy}>
              {busy ? "Saving…" : (empModal?.employee_id ? "Save Changes" : "Add Employee")}
            </button>
          </form>

          {empModal?.employee_id && (
            <>
              <div style={{ margin:"20px 0 12px", borderTop:"1px solid var(--ff-border)", paddingTop:16 }}>
                <p style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--ff-muted)", marginBottom:12 }}>
                  Staff Portal Access
                </p>
                {empModal.username && (
                  <p style={{ fontSize:12, color:"var(--ff-muted)", marginBottom:10 }}>
                    Current username: <b style={{ color:"var(--ff-text)" }}>{empModal.username}</b>
                  </p>
                )}
              </div>
              <form onSubmit={saveCredentials} className="ff-fields">
                <Grid2>
                  <Field label="Portal Username *">
                    <input value={credForm.username} onChange={e => setCredForm(p => ({...p, username:e.target.value}))} placeholder="e.g. john.doe" autoComplete="off"/>
                  </Field>
                  <Field label={empModal.username ? "New Password (leave blank to keep)" : "Password *"}>
                    <input type="password" value={credForm.password} onChange={e => setCredForm(p => ({...p, password:e.target.value}))} placeholder="••••••••" autoComplete="new-password"/>
                  </Field>
                  {credForm.password && (
                    <Field label="Confirm Password">
                      <input type="password" value={credForm.confirm} onChange={e => setCredForm(p => ({...p, confirm:e.target.value}))} placeholder="••••••••" autoComplete="new-password"/>
                    </Field>
                  )}
                </Grid2>
                <button type="submit" className="ff-btn ff-btn-outline" style={{ width:"100%", justifyContent:"center" }} disabled={busy}>
                  {busy ? "Saving…" : (empModal.username ? "Update Portal Credentials" : "Set Portal Credentials")}
                </button>
              </form>
            </>
          )}
        </Modal>
      )}

      {/* Assign Shift Modal */}
      {shiftModal && (
        <Modal title={shiftForm.employee_id && shiftForm.shift_date && shiftMap[shiftForm.employee_id]?.[shiftForm.shift_date] ? "Edit Shift" : "Assign Shift"} onClose={() => setShiftModal(null)}>
          <form onSubmit={saveShift} className="ff-fields">
            <Field label="Employee *">
              <select
                value={shiftForm.employee_id}
                onChange={e => {
                  const eid = e.target.value;
                  const defaults = masterMap[eid];
                  setShiftForm(p => ({
                    ...p,
                    employee_id: eid,
                    start_time: defaults?.default_start_time?.slice(0, 5) || p.start_time,
                    end_time:   defaults?.default_end_time?.slice(0, 5)   || p.end_time,
                  }));
                }}
                required
              >
                <option value="">Select…</option>
                {employees.map(e => {
                  const def = masterMap[e.employee_id];
                  const tag = def?.default_start_time && def?.default_end_time
                    ? ` (${def.default_start_time.slice(0,5)}–${def.default_end_time.slice(0,5)})`
                    : "";
                  const roleLabel = (e.roles || [e.role]).join(", ");
                  return <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name} — {roleLabel}{tag}</option>;
                })}
              </select>
            </Field>
            <Grid2>
              <Field label="Date *"><input type="date" value={shiftForm.shift_date} onChange={e => setShiftForm(p => ({...p, shift_date:e.target.value}))} required/></Field>
              <Field label="Start Time *"><input type="time" value={shiftForm.start_time} onChange={e => setShiftForm(p => ({...p, start_time:e.target.value}))} required/></Field>
              <Field label="End Time *"><input type="time" value={shiftForm.end_time} onChange={e => setShiftForm(p => ({...p, end_time:e.target.value}))} required/></Field>
            </Grid2>
            <button type="submit" className="ff-btn ff-btn-primary" style={{ width:"100%", justifyContent:"center" }} disabled={busy}>
              {busy ? "Saving…" : (shiftForm.employee_id && shiftMap[shiftForm.employee_id]?.[shiftForm.shift_date] ? "Update Shift" : "Assign Shift")}
            </button>
          </form>
        </Modal>
      )}

      {/* User Access Panel — owner only */}
      {isOwner && (
        <Card title="Admin User Access" noPad style={{ marginTop: 20 }}>
          {users.loading ? <Spinner /> : users.error ? <ApiError msg={users.error} /> : (
            <TableWrap>
              <thead>
                <tr><th>Username</th><th>Full Name</th><th>Role</th><th>Access</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {(users.data || []).map(u => {
                  const isSelf = u.username === currentUser.username;
                  return (
                    <tr key={u.id}>
                      <td className="ff-mono">{u.username}</td>
                      <td>{u.full_name || "—"}</td>
                      <td><span className="ff-badge ff-badge-blue">{u.role}</span></td>
                      <td>
                        {u.is_blocked
                          ? <span className="ff-badge ff-badge-red"><ShieldOff size={11} style={{ verticalAlign:"-1px", marginRight:4 }}/>Blocked</span>
                          : <span className="ff-badge ff-badge-green"><Shield size={11} style={{ verticalAlign:"-1px", marginRight:4 }}/>Active</span>}
                      </td>
                      <td>
                        {!isSelf && (
                          <div style={{ display:"flex", gap:6 }}>
                            <button
                              className="ff-icon-btn"
                              title={u.is_blocked ? "Unblock" : "Block"}
                              style={{ color: u.is_blocked ? "var(--ff-success)" : "var(--ff-warning)" }}
                              onClick={() => toggleBlock(u)}
                              disabled={busy}
                            >
                              {u.is_blocked ? <UserCheck size={15} /> : <UserX size={15} />}
                            </button>
                            <button
                              className="ff-icon-btn"
                              title="Permanently delete"
                              style={{ color: "var(--ff-danger)" }}
                              onClick={() => setConfirmDelUser(u)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                        {isSelf && <span style={{ fontSize:11, color:"var(--ff-muted)" }}>You</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {/* Delete User Confirmation */}
      {confirmDelUser && (
        <div className="ff-backdrop" onClick={() => setConfirmDelUser(null)}>
          <div className="ff-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Delete User?</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding:"4px 8px" }} onClick={() => setConfirmDelUser(null)}><X size={18}/></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ color:"var(--ff-muted)", marginBottom:20 }}>
                Permanently delete <b>{confirmDelUser.username}</b>? They will no longer be able to sign in.
              </p>
              <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmDelUser(null)}>Cancel</button>
                <button className="ff-btn ff-btn-primary" style={{ background:"var(--ff-danger)", borderColor:"var(--ff-danger)" }} onClick={doDeleteUser} disabled={busy}>
                  {busy ? "Deleting…" : "Yes, Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Shift Confirmation */}
      {confirmDelShift && (
        <div className="ff-backdrop" onClick={() => setConfirmDelShift(null)}>
          <div className="ff-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Remove Shift?</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding:"4px 8px" }} onClick={() => setConfirmDelShift(null)}><X size={18}/></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ color:"var(--ff-muted)", marginBottom:20 }}>
                Remove the assigned shift for <b>{confirmDelShift.label}</b>?
              </p>
              <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmDelShift(null)}>Cancel</button>
                <button className="ff-btn ff-btn-primary" style={{ background:"var(--ff-danger)", borderColor:"var(--ff-danger)" }} onClick={doDeleteShift} disabled={busy}>
                  {busy ? "Removing…" : "Yes, Remove"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Employee Confirmation */}
      {confirmDelEmp && (
        <div className="ff-backdrop" onClick={() => setConfirmDelEmp(null)}>
          <div className="ff-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Remove Employee?</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding:"4px 8px" }} onClick={() => setConfirmDelEmp(null)}><X size={18}/></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ color:"var(--ff-muted)", marginBottom:20 }}>
                Permanently remove <b>{confirmDelEmp.first_name} {confirmDelEmp.last_name}</b> from the employee directory? Their shift history will also be removed.
              </p>
              <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmDelEmp(null)}>Cancel</button>
                <button className="ff-btn ff-btn-primary" style={{ background:"var(--ff-danger)", borderColor:"var(--ff-danger)" }} onClick={doDeleteEmployee} disabled={busy}>
                  {busy ? "Removing…" : "Yes, Remove"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
