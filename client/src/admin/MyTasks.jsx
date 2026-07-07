/**
 * MyTasks.jsx — Housekeeping "My Tasks" tab.
 * Shows employee_routines assigned to the logged-in staff member.
 * Supports photo upload + "Mark Complete" to flip status and set room to clean.
 */
import { useState, useEffect, useRef } from "react";
import { Camera, CheckCircle, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { getEmployeeUser, apiFetch, fmtDate, fmtTime, notify } from "./adminContext.js";
import { SectionHeader } from "./ui.jsx";

const STATUS_CONFIG = {
  Pending:   { color: "#d97706", bg: "#fef3c7", icon: Clock,        label: "Pending"     },
  Active:    { color: "#2563eb", bg: "#dbeafe", icon: AlertCircle,  label: "In Progress" },
  Verified:  { color: "#16a34a", bg: "#dcfce7", icon: CheckCircle,  label: "Done"        },
  Flagged:   { color: "#dc2626", bg: "#fee2e2", icon: AlertCircle,  label: "Flagged"     },
};

export default function MyTasks() {
  const user = getEmployeeUser();
  const [tasks,    setTasks]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [completing, setCompleting] = useState({});
  const fileRefs = useRef({});

  const load = async () => {
    setLoading(true);
    try {
      const rows = await apiFetch(`/api/admin/my-tasks?employee_id=${user.employee_id}`);
      setTasks(Array.isArray(rows) ? rows : []);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleComplete = async (taskId, photoFile) => {
    setCompleting(s => ({ ...s, [taskId]: true }));
    try {
      let photo_url = null;
      if (photoFile) {
        const fd = new FormData();
        fd.append("photo", photoFile);
        const uploaded = await apiFetch(`/api/admin/routines/${taskId}/photo-upload`, { method: "POST", body: fd });
        photo_url = uploaded.url || null;
      }
      await apiFetch(`/api/admin/my-tasks/${taskId}/complete`, {
        method: "PATCH",
        body: JSON.stringify({ photo_url }),
      });
      notify("Task marked complete — room set to Clean & Ready!", "success");
      load();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setCompleting(s => ({ ...s, [taskId]: false }));
    }
  };

  if (loading) return (
    <div style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
      <RefreshCw size={24} style={{ animation: "spin 1s linear infinite" }} />
    </div>
  );

  const pending  = tasks.filter(t => t.status !== "Verified");
  const done     = tasks.filter(t => t.status === "Verified");

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Housekeeping"
        title="My Tasks"
        action={
          <button className="ff-btn ff-btn-outline" onClick={load} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      {tasks.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#9ca3af" }}>
          <CheckCircle size={40} style={{ marginBottom: 12, color: "#16a34a" }} />
          <p style={{ fontSize: 15, fontWeight: 600 }}>No tasks assigned to you today.</p>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Pending ({pending.length})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pending.map(t => <TaskCard key={t.routine_id} task={t} completing={completing[t.routine_id]} onComplete={handleComplete} fileRefs={fileRefs} />)}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Completed ({done.length})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {done.map(t => <TaskCard key={t.routine_id} task={t} completing={false} onComplete={null} fileRefs={fileRefs} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, completing, onComplete, fileRefs }) {
  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.Pending;
  const Icon = cfg.icon;
  const [photo, setPhoto] = useState(null);
  const isDone = task.status === "Verified";

  return (
    <div style={{
      background: "#fff", borderRadius: 12, border: "1.5px solid #e5e7eb",
      padding: "16px 18px", boxShadow: "0 1px 4px rgba(0,0,0,.06)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: cfg.bg, color: cfg.color,
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
            }}>
              <Icon size={11} /> {cfg.label}
            </span>
            {task.room_number && (
              <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", background: "#dbeafe", padding: "2px 8px", borderRadius: 20 }}>
                Room {task.room_number}
              </span>
            )}
          </div>
          <p style={{ fontWeight: 700, fontSize: 14, color: "#111827", margin: "0 0 4px" }}>{task.task_name}</p>
          {task.guest_name && (
            <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px" }}>Guest: {task.guest_name}</p>
          )}
          <p style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>
            Scheduled: {fmtDate(task.scheduled_time)} {fmtTime(task.scheduled_time)}
          </p>
        </div>
      </div>

      {!isDone && onComplete && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#f9fafb", border: "1.5px dashed #d1d5db",
            borderRadius: 8, padding: "7px 14px", cursor: "pointer",
            fontSize: 13, color: "#374151", fontWeight: 600,
          }}>
            <Camera size={14} />
            {photo ? photo.name : "Attach Photo"}
            <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
              ref={el => { if (el) fileRefs.current[task.routine_id] = el; }}
              onChange={e => setPhoto(e.target.files[0] || null)}
            />
          </label>
          {photo && <span style={{ fontSize: 12, color: "#16a34a" }}>✓ {photo.name}</span>}
          <button
            disabled={completing}
            onClick={() => onComplete(task.routine_id, photo)}
            style={{
              background: completing ? "#e5e7eb" : "#16a34a",
              color: completing ? "#9ca3af" : "#fff",
              border: "none", borderRadius: 8, padding: "8px 18px",
              fontSize: 13, fontWeight: 700, cursor: completing ? "default" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <CheckCircle size={14} /> {completing ? "Saving…" : "Mark Complete"}
          </button>
        </div>
      )}

      {isDone && task.photo_verification_url && (
        <div style={{ marginTop: 10 }}>
          <a href={task.photo_verification_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb" }}>
            View verification photo
          </a>
        </div>
      )}
    </div>
  );
}
