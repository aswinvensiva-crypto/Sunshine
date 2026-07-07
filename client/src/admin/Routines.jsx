/**
 * Routines.jsx
 * Photo-Verified Routine Manager from f1.docx:
 * employee_routines table + photo_verification_url + status state machine.
 * Owner view: Live Operations Feed with photo lightbox.
 * Staff view: timestamped timeline + camera capture.
 * "If completed_at − started_at < 15 mins → flag orange as warning."
 */
import { useState, useRef } from "react";
import { Camera, CheckCircle, Eye, Clock, AlertTriangle, Plus, X, Image, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { useApi, apiFetch, fmtDate, fmtTime, todayISO, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, Field, Grid2, TableWrap, Modal, SideDrawer, StatusBadge, EmptyState } from "./ui.jsx";
import FfSubmitButton from "../components/FfSubmitButton.jsx";

const ROUTINE_STATUS = {
  Pending:  "ff-badge-muted",
  Active:   "ff-badge-blue",
  Verified: "ff-badge-green",
  Flagged:  "ff-badge-red",
};

export default function Routines({ isStaff = false }) {
  const routines = useApi(() => apiFetch("/api/admin/routines"));
  const emp      = useApi(() => apiFetch("/api/admin/employees"));

  const [viewMode,    setViewMode]    = useState(isStaff ? "staff" : "owner"); // "owner" | "staff"
  const [createModal, setCreateModal] = useState(false);
  const [editRoutine, setEditRoutine] = useState(null);
  const [lightbox,    setLightbox]    = useState(null);
  const [form,        setForm]        = useState({ employee_id:"", task_name:"", scheduled_time:"", photo_required:false });
  const [editForm,    setEditForm]    = useState({ employee_id:"", task_name:"", scheduled_time:"", photo_required:false });
  const [busy,        setBusy]        = useState(false);

  const routineList = routines.data || [];
  const employees   = emp.data || [];

  // Check if a completed routine was suspiciously fast (< 15 min)
  const isFastCompletion = (r) => {
    if (!r.started_at || !r.completed_at) return false;
    const diff = (new Date(r.completed_at) - new Date(r.started_at)) / 60000;
    return diff < 15;
  };

  const openEdit = (r) => {
    setEditRoutine(r);
    setEditForm({
      employee_id: String(r.employee_id),
      task_name: r.task_name,
      scheduled_time: r.scheduled_time ? r.scheduled_time.slice(0, 16) : "",
      photo_required: !!r.photo_required,
    });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/admin/routines/${editRoutine.routine_id}`, { method:"PUT", body:JSON.stringify(editForm) });
      notify("Routine updated!", "success");
      setEditRoutine(null); routines.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const deleteRoutine = async (r) => {
    if (!window.confirm(`Delete routine "${r.task_name}"?`)) return;
    try {
      await apiFetch(`/api/admin/routines/${r.routine_id}`, { method:"DELETE" });
      notify("Routine deleted.", "success");
      routines.reload();
    } catch (err) { notify(err.message, "error"); }
  };

  const createRoutine = async (e) => {
    e.preventDefault();
    if (!form.employee_id || !form.task_name || !form.scheduled_time) return notify("All fields are required", "error");
    setBusy(true);
    try {
      await apiFetch("/api/admin/routines", { method:"POST", body:JSON.stringify(form) });
      notify("Routine scheduled!", "success");
      setCreateModal(false); routines.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  if (routines.loading) return <Spinner />;
  if (routines.error)   return <ApiError msg={routines.error} />;

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Operations"
        title="Routine Manager"
        action={
          <div style={{ display:"flex", gap:10 }}>
            {!isStaff && (
              <div style={{ display:"flex", background:"rgba(255,255,255,.06)", borderRadius:8, border:"1px solid var(--ff-border)", overflow:"hidden" }}>
                {["owner","staff"].map(m => (
                  <button key={m} onClick={() => setViewMode(m)} style={{ padding:"9px 16px", background: viewMode===m ? "var(--ff-primary)" : "transparent", color: viewMode===m ? "#fff" : "var(--ff-muted)", border:"none", cursor:"pointer", fontFamily:"var(--sans)", fontSize:13, fontWeight:600, textTransform:"capitalize", transition:".18s" }}>
                    {m === "owner" ? "Owner View" : "Staff View"}
                  </button>
                ))}
              </div>
            )}
            {!isStaff && (
              <button className="ff-btn ff-btn-primary" onClick={() => setCreateModal(true)}>
                <Plus size={15} /> Schedule Routine
              </button>
            )}
          </div>
        }
      />

      {!isStaff && viewMode === "owner" ? (
        <OwnerFeed routines={routineList} isFast={isFastCompletion} onPhoto={setLightbox} onEdit={openEdit} onDelete={deleteRoutine} />
      ) : (
        <StaffTimeline routines={routineList} onReload={routines.reload} />
      )}

      {createModal && (
        <SideDrawer title="Schedule a Routine" onClose={() => { setCreateModal(false); setForm({ employee_id:"", task_name:"", scheduled_time:"", photo_required:false }); }}>
          <form onSubmit={createRoutine} className="ff-fields">
            <Field label="Assign to Employee *">
              <select value={form.employee_id} onChange={e => setForm(p => ({...p, employee_id:e.target.value}))} required>
                <option value="">Select…</option>
                {employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name} — {e.role}</option>)}
              </select>
            </Field>
            <Field label="Task Name *">
              <input value={form.task_name} onChange={e => setForm(p => ({...p, task_name:e.target.value}))} placeholder="e.g. Pool pH & Chlorine Check" required/>
            </Field>
            <Field label="Scheduled Time *">
              <input type="datetime-local" value={form.scheduled_time} onChange={e => setForm(p => ({...p, scheduled_time:e.target.value}))} required/>
            </Field>
            <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", padding:"4px 0" }}>
              <input type="checkbox" checked={form.photo_required} onChange={e => setForm(p => ({...p, photo_required:e.target.checked}))} style={{ width:16, height:16, accentColor:"var(--ff-primary)" }}/>
              <span style={{ fontSize:13, color:"var(--ff-text)" }}>Require photo evidence to complete</span>
            </label>
            <FfSubmitButton className="ff-btn-primary" style={{ width:"100%", justifyContent:"center" }} onClick={createRoutine} spinnerLabel="Scheduling…">
              Schedule Routine
            </FfSubmitButton>
          </form>
        </SideDrawer>
      )}

      {editRoutine && (
        <SideDrawer title="Edit Routine" onClose={() => setEditRoutine(null)}>
          <form onSubmit={saveEdit} className="ff-fields">
            <Field label="Assign to Employee *">
              <select value={editForm.employee_id} onChange={e => setEditForm(p => ({...p, employee_id:e.target.value}))} required>
                <option value="">Select…</option>
                {employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name} — {e.role}</option>)}
              </select>
            </Field>
            <Field label="Task Name *">
              <input value={editForm.task_name} onChange={e => setEditForm(p => ({...p, task_name:e.target.value}))} required/>
            </Field>
            <Field label="Scheduled Time *">
              <input type="datetime-local" value={editForm.scheduled_time} onChange={e => setEditForm(p => ({...p, scheduled_time:e.target.value}))} required/>
            </Field>
            <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", padding:"4px 0" }}>
              <input type="checkbox" checked={editForm.photo_required} onChange={e => setEditForm(p => ({...p, photo_required:e.target.checked}))} style={{ width:16, height:16, accentColor:"var(--ff-primary)" }}/>
              <span style={{ fontSize:13, color:"var(--ff-text)" }}>Require photo evidence to complete</span>
            </label>
            <FfSubmitButton className="ff-btn-primary" style={{ width:"100%", justifyContent:"center" }} onClick={saveEdit} spinnerLabel="Saving…">
              Save Changes
            </FfSubmitButton>
          </form>
        </SideDrawer>
      )}

      {/* Photo lightbox */}
      {lightbox && (
        <div className="ff-backdrop" onClick={() => setLightbox(null)}>
          <div style={{ maxWidth:640, width:"100%", position:"relative" }}>
            <button className="ff-icon-btn" onClick={() => setLightbox(null)} style={{ position:"absolute", top:-40, right:0 }}><X size={20}/></button>
            <img src={lightbox.url} alt={lightbox.task} style={{ width:"100%", borderRadius:12, boxShadow:"0 32px 80px rgba(0,0,0,.8)" }}/>
            <div style={{ marginTop:10, color:"#fff", textAlign:"center", fontSize:14 }}>
              <b>{lightbox.task}</b> — completed {fmtTime(lightbox.completed_at)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OwnerFeed({ routines, isFast, onPhoto, onEdit, onDelete }) {
  return (
    <Card title="Live Operations Feed" noPad>
      {routines.length === 0 ? <EmptyState text="No routines scheduled yet." icon={Clock} /> : (
        <TableWrap>
          <thead>
            <tr>
              <th>Employee</th><th>Task</th><th>Scheduled</th>
              <th>Started</th><th>Completed</th><th>Status</th><th>Evidence</th><th></th>
            </tr>
          </thead>
          <tbody>
            {routines.map(r => {
              const fast = r.status === "Verified" && isFast(r);
              return (
                <tr key={r.routine_id} style={{ background: fast ? "rgba(245,158,11,.07)" : "transparent" }}>
                  <td style={{ fontWeight:600 }}>{r.employee_name || `#${r.employee_id}`}</td>
                  <td>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      {r.task_name}
                      {r.photo_required && (
                        <span title="Photo evidence required" style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, color:"var(--ff-primary)", background:"rgba(99,102,241,.12)", borderRadius:4, padding:"2px 5px" }}>
                          <Camera size={10}/> Required
                        </span>
                      )}
                    </div>
                    {fast && (
                      <div className="ff-sub-text" style={{ color:"var(--ff-warning)" }}>
                        <AlertTriangle size={11}/> Completed in &lt;15 min — verify manually
                      </div>
                    )}
                  </td>
                  <td>{fmtTime(r.scheduled_time)}</td>
                  <td>{r.started_at ? fmtTime(r.started_at) : <span style={{ color:"var(--ff-muted)" }}>—</span>}</td>
                  <td>{r.completed_at ? fmtTime(r.completed_at) : <span style={{ color:"var(--ff-muted)" }}>—</span>}</td>
                  <td><StatusBadge value={r.status} map={ROUTINE_STATUS} /></td>
                  <td>
                    {r.photo_verification_url ? (
                      <button className="ff-icon-btn" title="View photo" onClick={() => onPhoto({ url:r.photo_verification_url, task:r.task_name, completed_at:r.completed_at })}>
                        <Eye size={15}/>
                      </button>
                    ) : <span style={{ color:"var(--ff-border)", fontSize:12 }}>No photo</span>}
                  </td>
                  <td>
                    <div style={{ display:"flex", gap:4 }}>
                      <button className="ff-icon-btn" title="Edit routine" onClick={() => onEdit(r)}>
                        <Pencil size={14}/>
                      </button>
                      <button className="ff-icon-btn" title="Delete routine" onClick={() => onDelete(r)} style={{ color:"var(--ff-danger, #ef4444)" }}>
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

function StaffTimeline({ routines, onReload }) {
  const today = new Date().toISOString().slice(0, 10);
  const mine  = routines.filter(r => r.scheduled_time?.slice(0,10) === today);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <p className="ff-muted-sm" style={{ justifyContent:"center", textAlign:"center" }}>
        Today's routine — {new Date().toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long" })}
      </p>
      {mine.length === 0 ? (
        <EmptyState text="No routines scheduled for today." icon={CheckCircle} />
      ) : mine.map(r => (
        <RoutineCard key={r.routine_id} routine={r} onReload={onReload} />
      ))}
    </div>
  );
}

function RoutineCard({ routine: r, onReload }) {
  const [image,       setImage]       = useState(null);
  const [preview,     setPreview]     = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const fileRef = useRef(null);

  const capture = (e) => {
    const file = e.target.files[0];
    if (file) { setImage(file); setPreview(URL.createObjectURL(file)); }
  };

  const submit = async () => {
    if (!image) return notify("Please capture photo evidence first", "error");
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("photo", image);
      const token = localStorage.getItem("emp_token") || localStorage.getItem("ma_token") || "";
      const res = await fetch(`/api/admin/routines/${r.routine_id}/complete`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      notify("Routine verified and logged!", "success");
      onReload();
    } catch (err) { notify(err.message, "error"); }
    finally { setSubmitting(false); }
  };

  const statusBg = { Pending:"rgba(100,116,139,.15)", Active:"rgba(59,130,246,.12)", Verified:"rgba(16,185,129,.12)", Flagged:"rgba(239,68,68,.12)" };

  return (
    <div style={{ background: statusBg[r.status] || "var(--ff-card)", border:"1px solid var(--ff-border)", borderRadius:12, padding:"16px 18px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <h4 style={{ margin:0, fontFamily:"var(--serif)", fontSize:18, color:"var(--ff-text)" }}>{r.task_name}</h4>
          <p className="ff-muted-sm" style={{ marginTop:4 }}><Clock size={12}/> Scheduled: {fmtTime(r.scheduled_time)}</p>
        </div>
        <StatusBadge value={r.status} map={ROUTINE_STATUS} />
      </div>

      {r.status === "Verified" ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, color:"var(--ff-success)", fontSize:14 }}>
          <CheckCircle size={18}/> Completed at {fmtTime(r.completed_at)}
        </div>
      ) : (
        <>
          {r.photo_required && (
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--ff-primary)", marginBottom:8 }}>
              <ShieldCheck size={13}/> Photo evidence required to submit
            </div>
          )}
          <input type="file" accept="image/*" capture="environment" ref={fileRef} onChange={capture} style={{ display:"none" }}/>
          {preview ? (
            <div style={{ marginBottom:10 }}>
              <img src={preview} alt="Preview" style={{ width:"100%", maxHeight:200, objectFit:"cover", borderRadius:8 }}/>
              <button className="ff-btn ff-btn-outline" style={{ marginTop:8 }} onClick={() => fileRef.current.click()}>
                <Camera size={14}/> Retake Photo
              </button>
            </div>
          ) : (
            <button
              className="ff-btn ff-btn-outline"
              style={{ marginBottom:10, borderColor: r.photo_required && !image ? "var(--ff-danger, #ef4444)" : undefined }}
              onClick={() => fileRef.current.click()}
            >
              <Camera size={15}/> {r.photo_required ? "Capture Photo Evidence *" : "Open Camera & Verify"}
            </button>
          )}
          <FfSubmitButton className="ff-btn-primary" style={{ width:"100%", justifyContent:"center" }} onClick={submit} disabled={!image} spinnerLabel="Uploading…">
            <CheckCircle size={15}/> Submit Verified Task
          </FfSubmitButton>
        </>
      )}
    </div>
  );
}
