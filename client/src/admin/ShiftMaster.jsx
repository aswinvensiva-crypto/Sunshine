import { useState } from "react";
import { Pencil, X, Clock } from "lucide-react";
import { useApi, apiFetch, getUser, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, Field, Grid2, TableWrap, Modal, EmptyState } from "./ui.jsx";
import { UserX } from "lucide-react";

const ROLE_COLOR = {
  "Front Desk":    "#3b82f6",
  "Housekeeping":  "#10b981",
  "Maintenance":   "#f59e0b",
  "Manager":       "#a855f7",
  "Pool Attendant":"#06b6d4",
};

function fmt12(t) {
  if (!t) return "—";
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function ShiftMaster() {
  const master = useApi(() => apiFetch("/api/admin/shift-master"));

  const currentUser = getUser();
  const isOwner     = currentUser?.role === "owner";

  const [editModal, setEditModal] = useState(null); // employee object
  const [form,      setForm]      = useState({ default_start_time: "", default_end_time: "" });
  const [busy,      setBusy]      = useState(false);

  const employees = master.data || [];

  const openEdit = (emp) => {
    setForm({
      default_start_time: emp.default_start_time?.slice(0, 5) || "",
      default_end_time:   emp.default_end_time?.slice(0, 5)   || "",
    });
    setEditModal(emp);
  };

  const saveDefault = async (e) => {
    e.preventDefault();
    if (!form.default_start_time || !form.default_end_time)
      return notify("Both start and end time are required", "error");
    setBusy(true);
    try {
      await apiFetch(`/api/admin/shift-master/${editModal.employee_id}`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      notify(`Default shift updated for ${editModal.first_name}`, "success");
      setEditModal(null);
      master.reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  if (master.loading) return <Spinner />;

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="Workforce"
        title="Shift Master"
      />

      {/* Legend */}
      <div style={{ marginBottom: 16, padding: "10px 16px", background: "var(--ff-surface)", border: "1px solid var(--ff-border)", borderRadius: 8, fontSize: 12, color: "var(--ff-muted)", display: "flex", alignItems: "center", gap: 8 }}>
        <Clock size={14} style={{ flexShrink: 0 }} />
        <span>
          {isOwner
            ? "You can set or edit the default shift window for each employee. These times are auto-filled when assigning shifts."
            : "Default shift windows are set by the owner. These times are pre-filled when assigning shifts."}
        </span>
      </div>

      <Card title="Employee Shift Defaults" noPad>
        {master.error ? <ApiError msg={master.error} /> :
          employees.length === 0 ? <EmptyState text="No employees found." icon={UserX} /> : (
          <TableWrap>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role</th>
                <th>Default Shift</th>
                <th>Duration</th>
                {isOwner && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                const hasShift = emp.default_start_time && emp.default_end_time;
                let duration = "—";
                if (hasShift) {
                  const [sh, sm] = emp.default_start_time.slice(0, 5).split(":").map(Number);
                  const [eh, em] = emp.default_end_time.slice(0, 5).split(":").map(Number);
                  const mins = (eh * 60 + em) - (sh * 60 + sm);
                  if (mins > 0) duration = `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? (mins % 60) + "m" : ""}`.trim();
                }
                return (
                  <tr key={emp.employee_id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: "50%",
                          background: (ROLE_COLOR[emp.role] || "#64748b") + "33",
                          border: `2px solid ${ROLE_COLOR[emp.role] || "#64748b"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700, color: ROLE_COLOR[emp.role] || "#64748b",
                          flexShrink: 0,
                        }}>
                          {emp.first_name[0]}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ff-text)" }}>
                            {emp.first_name} {emp.last_name}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--ff-muted)" }}>
                            {emp.is_active ? "Active" : "Inactive"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="ff-badge" style={{ background: (ROLE_COLOR[emp.role] || "#64748b") + "22", color: ROLE_COLOR[emp.role] || "#64748b" }}>
                        {emp.role}
                      </span>
                    </td>
                    <td>
                      {hasShift ? (
                        <span style={{ fontWeight: 600, color: "var(--ff-text)", fontSize: 13 }}>
                          {fmt12(emp.default_start_time)} – {fmt12(emp.default_end_time)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--ff-muted)", fontSize: 12 }}>Not set</span>
                      )}
                    </td>
                    <td style={{ color: "var(--ff-muted)", fontSize: 12 }}>{duration}</td>
                    {isOwner && (
                      <td>
                        <button className="ff-icon-btn" title="Set default shift" onClick={() => openEdit(emp)}>
                          <Pencil size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Edit default shift modal — owner only */}
      {editModal && (
        <Modal
          title={`Default Shift — ${editModal.first_name} ${editModal.last_name || ""}`}
          onClose={() => setEditModal(null)}
        >
          <p style={{ fontSize: 12, color: "var(--ff-muted)", marginBottom: 16 }}>
            Set the standard shift window for this employee. This will be pre-filled whenever a shift is assigned to them.
          </p>
          <form onSubmit={saveDefault} className="ff-fields">
            <Grid2>
              <Field label="Default Start Time *">
                <input
                  type="time"
                  value={form.default_start_time}
                  onChange={e => setForm(p => ({ ...p, default_start_time: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Default End Time *">
                <input
                  type="time"
                  value={form.default_end_time}
                  onChange={e => setForm(p => ({ ...p, default_end_time: e.target.value }))}
                  required
                />
              </Field>
            </Grid2>
            {form.default_start_time && form.default_end_time && (() => {
              const [sh, sm] = form.default_start_time.split(":").map(Number);
              const [eh, em] = form.default_end_time.split(":").map(Number);
              const mins = (eh * 60 + em) - (sh * 60 + sm);
              if (mins <= 0) return null;
              return (
                <div style={{ fontSize: 12, color: "var(--ff-primary)", padding: "6px 10px", background: "var(--ff-primary-faint, #eff6ff)", borderRadius: 6 }}>
                  <Clock size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                  {editModal.first_name} works {fmt12(form.default_start_time)} – {fmt12(form.default_end_time)}
                  {" "}({Math.floor(mins / 60)}h{mins % 60 > 0 ? ` ${mins % 60}m` : ""})
                </div>
              );
            })()}
            <button
              type="submit"
              className="ff-btn ff-btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save Default Shift"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
