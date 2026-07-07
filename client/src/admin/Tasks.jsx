/**
 * Tasks.jsx
 * Ad-Hoc Task Manager from f1.docx:
 * "title, description, assigned_to, priority (Low/Medium/High/Urgent),
 * status (Pending/In-Progress/Completed/Delayed), due_at, completed_at"
 */
import { useState, useRef } from "react";
import { Plus, Pencil, CheckCircle, Clock, AlertTriangle, X, Flag, Trash2, Camera, Eye, ShieldCheck } from "lucide-react";
import { useApi, apiFetch, deleteTask, getUser, fmtDate, fmtTime, todayISO, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, Field, Grid2, TableWrap, Modal, SideDrawer, EmptyState } from "./ui.jsx";

const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const STATUSES   = ["Pending", "In-Progress", "Completed", "Delayed"];

const PRIORITY_COLOR = { Low:"#64748b", Medium:"#3b82f6", High:"#f59e0b", Urgent:"#ef4444" };
const STATUS_COLOR   = { Pending:"ff-badge-muted", "In-Progress":"ff-badge-blue", Completed:"ff-badge-green", Delayed:"ff-badge-red" };

const initForm = { title:"", description:"", assigned_to:"", priority:"Medium", status:"Pending", due_at:"", photo_required:false };

export default function Tasks({ isStaff = false }) {
  const tasks = useApi(() => apiFetch("/api/admin/tasks"));
  const emp   = useApi(() => apiFetch("/api/admin/employees"));

  const [modal, setModal] = useState(null);
  const [form,  setForm]  = useState(initForm);
  const [busy,  setBusy]  = useState(false);
  const [filter, setFilter] = useState("all");
  const [confirmDel, setConfirmDel] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [photoComplete, setPhotoComplete] = useState(null); // task needing photo to complete

  const isOwner = getUser()?.role === "owner";

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const employees = emp.data || [];
  const taskList  = tasks.data || [];

  const filtered = filter === "all" ? taskList : taskList.filter(t => t.status === filter || t.priority === filter);

  const openCreate = () => { setForm(initForm); setModal("new"); };
  const openEdit   = (t) => {
    setForm({
      title: t.title, description: t.description || "", assigned_to: t.assigned_to || "",
      priority: t.priority, status: t.status,
      due_at: t.due_at ? new Date(t.due_at).toISOString().slice(0, 16) : "",
      photo_required: !!t.photo_required,
    });
    setModal(t.task_id);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title || !form.due_at) return notify("Title and due date are required", "error");
    setBusy(true);
    try {
      const isEdit = modal !== "new";
      await apiFetch(isEdit ? `/api/admin/tasks/${modal}` : "/api/admin/tasks", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      notify(isEdit ? "Task updated!" : "Task created!", "success");
      setModal(null); tasks.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const markDone = async (id) => {
    try {
      await apiFetch(`/api/admin/tasks/${id}`, { method:"PUT", body:JSON.stringify({ status:"Completed" }) });
      notify("Task marked complete!", "success"); tasks.reload();
    } catch (err) { notify(err.message, "error"); }
  };

  const doDeleteTask = async () => {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteTask(confirmDel);
      notify("Task deleted", "success");
      setConfirmDel(null); tasks.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const counts = {
    Pending:   taskList.filter(t => t.status === "Pending").length,
    "In-Progress": taskList.filter(t => t.status === "In-Progress").length,
    Completed: taskList.filter(t => t.status === "Completed").length,
    Delayed:   taskList.filter(t => t.status === "Delayed").length,
  };

  if (tasks.loading) return <Spinner />;
  if (tasks.error)   return <ApiError msg={tasks.error} />;

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Operations"
        title="Task Manager"
        action={
          !isStaff && (
            <button className="ff-btn ff-btn-primary" onClick={openCreate}>
              <Plus size={15} /> Create Task
            </button>
          )
        }
      />

      {/* Status summary chips */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:20 }}>
        {["all", ...STATUSES].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ background: filter===s ? "var(--ff-primary)" : "rgba(255,255,255,.06)", color: filter===s ? "#fff" : "var(--ff-muted)", border:`1px solid ${filter===s ? "var(--ff-primary)" : "var(--ff-border)"}`, padding:"6px 14px", borderRadius:20, cursor:"pointer", fontSize:13, fontFamily:"var(--sans)", fontWeight:600, transition:".18s" }}>
            {s === "all" ? `All (${taskList.length})` : `${s} (${counts[s] || 0})`}
          </button>
        ))}
      </div>

      {isStaff ? (
        /* ── Staff: card-based view matching RoutineCard style ── */
        filtered.length === 0 ? (
          <EmptyState text="No tasks assigned to you." icon={Flag} />
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {filtered.map(t => (
              <StaffTaskCard key={t.task_id} task={t} onReload={tasks.reload} />
            ))}
          </div>
        )
      ) : (
        /* ── Owner / manager: table view ── */
        <div className="ff-card" style={{ padding:0 }}>
          {filtered.length === 0 ? (
            <EmptyState text="No tasks found. Create one above." icon={Flag} />
          ) : (
            <TableWrap>
              <thead>
                <tr><th>Title</th><th>Assigned to</th><th>Priority</th><th>Due</th><th>Status</th><th>Evidence</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const isOverdue = t.status !== "Completed" && new Date(t.due_at) < new Date();
                  return (
                    <tr key={t.task_id}>
                      <td>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ fontWeight:600, color:"var(--ff-text)" }}>{t.title}</span>
                          {t.photo_required && (
                            <span title="Photo evidence required" style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, color:"var(--ff-primary)", background:"rgba(99,102,241,.12)", borderRadius:4, padding:"2px 5px" }}>
                              <Camera size={10}/> Required
                            </span>
                          )}
                        </div>
                        {t.description && <div className="ff-sub-text">{t.description.slice(0,60)}{t.description.length > 60 ? "…" : ""}</div>}
                      </td>
                      <td>{t.assigned_name || "Unassigned"}</td>
                      <td>
                        <span className="ff-badge" style={{ background: PRIORITY_COLOR[t.priority] + "22", color: PRIORITY_COLOR[t.priority] }}>
                          {t.priority}
                        </span>
                      </td>
                      <td style={{ color: isOverdue ? "var(--ff-danger)" : "" }}>
                        {fmtDate(t.due_at)}
                        {isOverdue && <div className="ff-sub-text" style={{ color:"var(--ff-danger)" }}><AlertTriangle size={10}/> Overdue</div>}
                      </td>
                      <td><span className={`ff-badge ${STATUS_COLOR[t.status]}`}>{t.status}</span></td>
                      <td>
                        {t.photo_verification_url ? (
                          <button className="ff-icon-btn" title="View photo"
                            onClick={() => setLightbox({ url: t.photo_verification_url, task: t.title, completed_at: t.completed_at })}>
                            <Eye size={15}/>
                          </button>
                        ) : <span style={{ color:"var(--ff-border)", fontSize:12 }}>No photo</span>}
                      </td>
                      <td style={{ whiteSpace:"nowrap" }}>
                        {t.status !== "Completed" && (
                          t.photo_required
                            ? <button className="ff-icon-btn" title="Complete with photo" onClick={() => setPhotoComplete(t)}><Camera size={15}/></button>
                            : <button className="ff-icon-btn" title="Mark complete" onClick={() => markDone(t.task_id)}><CheckCircle size={15}/></button>
                        )}
                        <button className="ff-icon-btn" title="Edit" onClick={() => openEdit(t)}><Pencil size={15}/></button>
                        <button className="ff-icon-btn" title="Delete task" style={{ color:"var(--ff-danger)" }} onClick={() => setConfirmDel(t.task_id)}><Trash2 size={15}/></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}

      {modal !== null && (
        <SideDrawer title={modal === "new" ? "Create Task" : "Edit Task"} onClose={() => setModal(null)}>
          <form onSubmit={save} className="ff-fields">
            <Field label="Title *"><input value={form.title} onChange={e => f("title",e.target.value)} placeholder="What needs to be done?" required/></Field>
            <Field label="Description"><textarea value={form.description} onChange={e => f("description",e.target.value)} rows={2} placeholder="Details…"/></Field>
            <Grid2>
              <Field label="Assign to">
                <select value={form.assigned_to} onChange={e => f("assigned_to",e.target.value)}>
                  <option value="">Unassigned</option>
                  {employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name} — {e.role}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select value={form.priority} onChange={e => f("priority",e.target.value)}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={e => f("status",e.target.value)}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Due Date & Time *"><input type="datetime-local" value={form.due_at} onChange={e => f("due_at",e.target.value)} required/></Field>
            </Grid2>
            <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", padding:"4px 0" }}>
              <input type="checkbox" checked={form.photo_required} onChange={e => f("photo_required", e.target.checked)} style={{ width:16, height:16, accentColor:"var(--ff-primary)" }}/>
              <span style={{ fontSize:13, color:"var(--ff-text)" }}>Require photo evidence to complete</span>
            </label>
            <button type="submit" className="ff-btn ff-btn-primary" style={{ width:"100%", justifyContent:"center" }} disabled={busy}>
              {busy ? "Saving…" : (modal === "new" ? "Create Task" : "Save Changes")}
            </button>
          </form>
        </SideDrawer>
      )}

      {/* Delete Task Confirmation */}
      {confirmDel && (
        <div className="ff-backdrop" onClick={() => setConfirmDel(null)}>
          <div className="ff-modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head">
              <h3>Delete Task?</h3>
              <button className="ff-btn ff-btn-ghost" style={{ padding:"4px 8px" }} onClick={() => setConfirmDel(null)}><X size={18}/></button>
            </div>
            <div className="ff-modal-body">
              <p style={{ color:"var(--ff-muted)", marginBottom:20 }}>This will permanently remove the task.</p>
              <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                <button className="ff-btn ff-btn-primary" style={{ background:"var(--ff-danger)", borderColor:"var(--ff-danger)" }} onClick={doDeleteTask} disabled={busy}>
                  {busy ? "Deleting…" : "Yes, Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Photo-required completion modal (owner table) */}
      {photoComplete && (
        <Modal title={`Complete: ${photoComplete.title}`} onClose={() => setPhotoComplete(null)}>
          <div style={{ marginBottom:12, display:"flex", alignItems:"center", gap:6, fontSize:13, color:"var(--ff-primary)" }}>
            <ShieldCheck size={14}/> Photo evidence is required to complete this task.
          </div>
          <TaskPhotoCapture task={photoComplete} onDone={() => { setPhotoComplete(null); tasks.reload(); }} />
        </Modal>
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

const STATUS_BG = {
  Pending:      "rgba(100,116,139,.15)",
  "In-Progress":"rgba(59,130,246,.12)",
  Completed:    "rgba(16,185,129,.12)",
  Delayed:      "rgba(239,68,68,.12)",
};

function StaffTaskCard({ task: t, onReload }) {
  const isOverdue = t.status !== "Completed" && t.due_at && new Date(t.due_at) < new Date();

  return (
    <div style={{ background: STATUS_BG[t.status] || "var(--ff-card)", border:"1px solid var(--ff-border)", borderRadius:12, padding:"16px 18px" }}>
      {/* Header row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <h4 style={{ margin:0, fontFamily:"var(--serif)", fontSize:18, color:"var(--ff-text)" }}>{t.title}</h4>
          {t.description && (
            <p className="ff-muted-sm" style={{ marginTop:4 }}>{t.description}</p>
          )}
          <p className="ff-muted-sm" style={{ marginTop:4, display:"flex", alignItems:"center", gap:6 }}>
            <Clock size={12}/>
            Due: {fmtDate(t.due_at)}
            {isOverdue && <span style={{ color:"var(--ff-danger)", marginLeft:4 }}><AlertTriangle size={11}/> Overdue</span>}
          </p>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
          <span className={`ff-badge ${STATUS_COLOR[t.status]}`}>{t.status}</span>
          <span className="ff-badge" style={{ background: PRIORITY_COLOR[t.priority] + "22", color: PRIORITY_COLOR[t.priority] }}>
            {t.priority}
          </span>
        </div>
      </div>

      {/* Body */}
      {t.status === "Completed" ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, color:"var(--ff-success)", fontSize:14 }}>
          <CheckCircle size={18}/> Completed{t.completed_at ? ` at ${fmtTime(t.completed_at)}` : ""}
        </div>
      ) : (
        <TaskPhotoCapture task={t} onDone={onReload} />
      )}
    </div>
  );
}

function TaskPhotoCapture({ task: t, onDone }) {
  const [dataUrl,    setDataUrl]    = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);

  const capture = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setDataUrl(ev.target.result);
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!dataUrl) return notify("Please attach a photo first", "error");
    setSubmitting(true);
    try {
      await apiFetch(`/api/admin/tasks/${t.task_id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "Completed", photo_verification_url: dataUrl }),
      });
      notify("Task verified and marked complete!", "success");
      onDone();
    } catch (err) { notify(err.message, "error"); }
    finally { setSubmitting(false); }
  };

  if (t.status === "Completed") {
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, color:"var(--ff-success)", fontSize:14, padding:"12px 16px" }}>
        <CheckCircle size={18}/> Task already completed
      </div>
    );
  }

  const needsPhoto = !!t.photo_required;

  return (
    <div style={{ background:"rgba(59,130,246,.08)", border:"1px solid var(--ff-border)", borderRadius:10, padding:"16px 18px", margin:"4px 0" }}>
      {needsPhoto && !dataUrl && (
        <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--ff-primary)", marginBottom:8 }}>
          <ShieldCheck size={13}/> Photo evidence required to submit
        </div>
      )}
      {/* No capture="" attribute — lets desktop use file picker and mobile prompt camera or gallery */}
      <input type="file" accept="image/*" ref={fileRef} onChange={capture} style={{ display:"none" }}/>
      {dataUrl ? (
        <div style={{ marginBottom:10 }}>
          <img src={dataUrl} alt="Preview" style={{ width:"100%", maxHeight:200, objectFit:"cover", borderRadius:8 }}/>
          <button className="ff-btn ff-btn-outline" style={{ marginTop:8 }} onClick={() => fileRef.current.click()}>
            <Camera size={14}/> Retake Photo
          </button>
        </div>
      ) : (
        <button
          className="ff-btn ff-btn-outline"
          style={{ marginBottom:10, borderColor: needsPhoto ? "var(--ff-danger, #ef4444)" : undefined }}
          onClick={() => fileRef.current.click()}
        >
          <Camera size={15}/> {needsPhoto ? "Attach Photo Evidence *" : "Attach Photo Evidence"}
        </button>
      )}
      <button className="ff-btn ff-btn-primary" style={{ width:"100%", justifyContent:"center" }} onClick={submit} disabled={!dataUrl || submitting}>
        {submitting ? "Uploading…" : <><CheckCircle size={15}/> Submit Verified Task</>}
      </button>
    </div>
  );
}
