import { useState } from "react";
import { Plus, Trash2, Pencil, LayoutGrid, BedDouble, Sunset, AlertTriangle } from "lucide-react";
import { useApi, apiFetch, getUser, rupee, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Modal, Field, EmptyState } from "./ui.jsx";

/* ── Room grid helpers ── */
const STATUS_META = {
  vacant_clean:      { label: "Vacant & Clean",      color: "#1A7A45", bg: "#1A7A4520" },
  booked:            { label: "Booked",               color: "#2A6080", bg: "#2A608020" },
  stay_over_refresh: { label: "Stay Over & Refresh",  color: "#A06010", bg: "#A0601020" },
  maintenance:       { label: "Maintenance",           color: "#B83232", bg: "#B8323220" },
  unavailable:       { label: "Unavailable",           color: "#5C4828", bg: "#5C482820" },
};

const SETTABLE_STATUSES = ["vacant_clean", "maintenance", "unavailable"];

function mapStatus(room) {
  if (room.status === "maintenance") return "maintenance";
  if (room.status === "unavailable") return "unavailable";
  if (room.status === "stay_over")   return "stay_over_refresh";
  if (room.status === "occupied")    return "booked";
  return "vacant_clean";
}

function isOverdue(room) {
  return (
    mapStatus(room) === "maintenance" &&
    room.maintenance_until &&
    new Date(room.maintenance_until) < new Date()
  );
}

const initForm = { code: "", name: "", description: "", max_occupancy: "", base_rate: "", amenities: "" };

export default function RoomTypes() {
  const { data, loading, error, reload } = useApi(() => apiFetch("/api/admin/rooms"));
  const isOwner = getUser()?.role === "owner";

  /* ── Room type state ── */
  const [modal, setModal]           = useState(null);
  const [form, setForm]             = useState(initForm);
  const [confirmDelType, setConfirmDelType] = useState(null);

  /* ── Room grid state ── */
  const [selected, setSelected]     = useState(null);
  const [statusForm, setStatusForm] = useState({ status: "vacant_clean", maintenance_until: "" });
  const [addModal, setAddModal]     = useState(false);
  const [addForm, setAddForm]       = useState({ room_number: "", floor: "", room_type_id: "" });
  const [confirmDelRoom, setConfirmDelRoom] = useState(null);
  const [sweeping, setSweeping]     = useState(false);

  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (error)   return <ApiError msg={error} />;

  const types = data?.types || [];
  const rooms = data?.rooms || [];

  /* ── Room type helpers ── */
  const vacantCountByType = (typeId) =>
    rooms.filter(r => r.room_type_id === typeId && r.status === "available").length;

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const openCreate = () => { setForm(initForm); setModal("new"); };
  const openEdit   = (t) => {
    setForm({
      code: t.code,
      name: t.name,
      description: t.description || "",
      max_occupancy: String(t.max_occupancy),
      base_rate: String(t.base_rate),
      amenities: (t.amenities || []).join(", "),
    });
    setModal(t.id);
  };

  const saveType = async (e) => {
    e.preventDefault();
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim(),
      max_occupancy: Number(form.max_occupancy),
      base_rate: Number(form.base_rate),
      amenities: form.amenities
        ? form.amenities.split(",").map(s => s.trim()).filter(Boolean)
        : [],
    };
    if (!payload.code || !payload.name || !payload.max_occupancy || !payload.base_rate)
      return notify("Code, name, max occupancy and base rate are required", "error");

    setBusy(true);
    try {
      const isEdit = modal !== "new";
      await apiFetch(
        isEdit ? `/api/admin/room-types/${modal}` : "/api/admin/room-types",
        { method: isEdit ? "PUT" : "POST", body: JSON.stringify(payload) }
      );
      notify(isEdit ? "Room type updated" : "Room type created", "success");
      setModal(null);
      reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const doDeleteType = async () => {
    if (!confirmDelType) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/room-types/${confirmDelType}`, { method: "DELETE" });
      notify("Room type deleted", "success");
      setConfirmDelType(null);
      reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  /* ── Room grid helpers ── */
  const openRoom = (room) => {
    const ds = mapStatus(room);
    setStatusForm({
      status: SETTABLE_STATUSES.includes(ds) ? ds : "vacant_clean",
      maintenance_until: room.maintenance_until
        ? new Date(room.maintenance_until).toISOString().slice(0, 10)
        : "",
    });
    setSelected(room);
  };

  const saveStatus = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/admin/rooms/${selected.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: statusForm.status,
          maintenance_until: statusForm.maintenance_until || null,
        }),
      });
      notify("Room status updated", "success");
      setSelected(null);
      reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const addRoom = async (e) => {
    e.preventDefault();
    if (!addForm.room_type_id) return notify("Select a room type", "error");
    setBusy(true);
    try {
      await apiFetch("/api/admin/rooms-physical", {
        method: "POST",
        body: JSON.stringify(addForm),
      });
      notify("Room added", "success");
      setAddModal(false);
      setAddForm({ room_number: "", floor: "", room_type_id: "" });
      reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const deleteRoom = async () => {
    if (!confirmDelRoom) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/rooms-physical/${confirmDelRoom}`, { method: "DELETE" });
      notify("Room removed", "success");
      setConfirmDelRoom(null);
      reload();
    } catch (err) { notify(err.message, "error"); }
    finally { setBusy(false); }
  };

  const eodSweep = async () => {
    const stayOvers = rooms.filter(r => mapStatus(r) === "stay_over_refresh");
    if (!stayOvers.length) return notify("No stay-over rooms right now", "info");
    setSweeping(true);
    try {
      const employees = await apiFetch("/api/admin/employees");
      const maintStaff = (employees || []).filter(
        e => e.is_active && e.role && e.role.toLowerCase().includes("maintenance")
      );

      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 0, 0);

      await Promise.all(
        stayOvers.map((r, i) => {
          const assignee = maintStaff.length ? maintStaff[i % maintStaff.length] : null;
          return apiFetch("/api/admin/tasks", {
            method: "POST",
            body: JSON.stringify({
              title: `Room ${r.room_number} overnight refresh`,
              description: "Guest staying over. Housekeeping refresh required.",
              priority: "High",
              status: "Pending",
              due_at: endOfDay.toISOString(),
              room_id: r.id,
              assigned_to: assignee ? assignee.employee_id : null,
            }),
          });
        })
      );
      notify(
        `${stayOvers.length} housekeeping task${stayOvers.length > 1 ? "s" : ""} created${maintStaff.length ? ` and assigned to maintenance staff` : ""}`,
        "success"
      );
    } catch (err) { notify(err.message, "error"); }
    finally { setSweeping(false); }
  };

  const counts = Object.fromEntries(
    Object.keys(STATUS_META).map(s => [s, rooms.filter(r => mapStatus(r) === s).length])
  );

  return (
    <div className="ff-page">

      {/* ── Room Types section ── */}
      <SectionHeader
        eyebrow="Property"
        title="Room Types"
        action={
          isOwner && (
            <button className="ff-btn ff-btn-primary" onClick={openCreate}>
              <Plus size={15} /> Add Room Type
            </button>
          )
        }
      />

      {types.length === 0 ? (
        <EmptyState text="No room types configured yet." icon={LayoutGrid} />
      ) : (
        <div className="rt-grid">
          {types.map(t => {
            const totalRooms = t.total_rooms || 0;
            const vacant     = vacantCountByType(t.id);
            const pct        = totalRooms > 0 ? Math.round((vacant / totalRooms) * 100) : 0;
            const amenities  = t.amenities || [];
            return (
              <div key={t.id} className="ff-card ff-stat-card" style={{ display: "flex", flexDirection: "column", gap: 0 }}>

                {/* Header row — label + icon + actions */}
                <div className="ff-stat-header" style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span className="ff-stat-label">{t.code} · {t.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isOwner && (
                      <>
                        <button className="ff-icon-btn" title="Edit" onClick={() => openEdit(t)}>
                          <Pencil size={14} />
                        </button>
                        <button
                          className="ff-icon-btn"
                          title="Delete"
                          style={{ color: "var(--ff-danger)" }}
                          onClick={() => setConfirmDelType(t.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                    <div className="ff-stat-icon ff-icon-bg-accent">
                      <BedDouble size={20} />
                    </div>
                  </div>
                </div>

                {/* Primary value — nightly rate */}
                <div className="ff-stat-value" style={{ marginTop: 0 }}>{rupee(t.base_rate)}</div>

                {/* Sub line */}
                <div className="ff-muted-sm" style={{ marginTop: 6 }}>
                  Up to {t.max_occupancy} {t.max_occupancy === 1 ? "guest" : "guests"} &nbsp;·&nbsp; {totalRooms} {totalRooms === 1 ? "room" : "rooms"}
                </div>

                {/* Description */}
                {t.description && (
                  <p className="rt-card-desc" style={{ marginTop: 10 }}>{t.description}</p>
                )}

                {/* Availability gauge */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ff-muted)", marginBottom: 6 }}>
                    <span>Available</span>
                    <span style={{ color: "var(--ff-success)", fontWeight: 700 }}>{vacant} / {totalRooms}</span>
                  </div>
                  <div className="ff-progress">
                    <div
                      className="ff-progress-bar"
                      style={{ width: `${pct}%`, background: "var(--ff-success)" }}
                    />
                  </div>
                </div>

                {amenities.length > 0 && (
                  <div className="rt-amenities" style={{ marginTop: 12 }}>
                    {amenities.map(a => (
                      <span key={a} className="rt-amenity-chip">{a}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Room Grid section ── */}
      <div style={{ marginTop: 40 }}>
        <SectionHeader
          eyebrow="Property"
          title="Room Grid"
          action={
            <div style={{ display: "flex", gap: 10 }}>
              {isOwner && (
                <button className="ff-btn ff-btn-primary" onClick={() => setAddModal(true)}>
                  <Plus size={15} /> Add Room
                </button>
              )}
              {isOwner && (
                <button
                  className="ff-btn ff-btn-ghost"
                  onClick={eodSweep}
                  disabled={sweeping}
                  title="Create housekeeping tasks for all stay-over rooms and assign to maintenance staff"
                >
                  <Sunset size={15} /> {sweeping ? "Creating…" : "EOD Sweep"}
                </button>
              )}
            </div>
          }
        />

        <div className="rm-legend">
          {Object.entries(STATUS_META).map(([k, v]) => (
            <span key={k} className="rm-legend-chip" style={{ color: v.color, background: v.bg }}>
              <span className="rm-legend-dot" style={{ background: v.color }} />
              {v.label} ({counts[k] || 0})
            </span>
          ))}
        </div>

        {rooms.length === 0 ? (
          <EmptyState text="No rooms added yet." icon={BedDouble} />
        ) : (
          <div className="rm-grid">
            {rooms.map(room => {
              const ds = mapStatus(room);
              const meta = STATUS_META[ds];
              const overdue = isOverdue(room);
              return (
                <div
                  key={room.id}
                  className="rm-card"
                  style={{ borderColor: meta.color + "55", background: meta.bg }}
                  onClick={() => openRoom(room)}
                >
                  {overdue && (
                    <span className="rm-overdue-badge" title="Maintenance overdue">
                      <AlertTriangle size={11} />
                    </span>
                  )}
                  <div className="rm-card-number">{room.room_number}</div>
                  <div className="rm-card-type">{room.type}</div>
                  {room.floor && <div className="rm-card-floor">Floor {room.floor}</div>}
                  <span
                    className="rm-status-chip"
                    style={{ color: meta.color, background: meta.color + "22" }}
                  >
                    {meta.label}
                  </span>
                  {isOwner && (
                    <button
                      className="ff-icon-btn rm-del-btn"
                      title="Remove room"
                      style={{ color: "var(--ff-danger)" }}
                      onClick={e => { e.stopPropagation(); setConfirmDelRoom(room.id); }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Room status edit modal ── */}
      {selected && (
        <Modal title={`Room ${selected.room_number}`} onClose={() => setSelected(null)}>
          <form onSubmit={saveStatus} className="ff-fields">
            <div style={{ marginBottom: 14, color: "var(--ff-muted)", fontSize: 13 }}>
              Type: {selected.type}{selected.floor ? ` · Floor ${selected.floor}` : ""}
            </div>
            <Field label="Status">
              <select
                value={statusForm.status}
                onChange={e => setStatusForm(p => ({ ...p, status: e.target.value }))}
              >
                {SETTABLE_STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
            </Field>
            {statusForm.status === "maintenance" && (
              <Field label="Expected completion date (optional)">
                <input
                  type="date"
                  value={statusForm.maintenance_until}
                  onChange={e => setStatusForm(p => ({ ...p, maintenance_until: e.target.value }))}
                />
              </Field>
            )}
            <button
              type="submit"
              className="ff-btn ff-btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save Status"}
            </button>
          </form>
        </Modal>
      )}

      {/* ── Add room modal ── */}
      {addModal && (
        <Modal title="Add Room" onClose={() => setAddModal(false)}>
          <form onSubmit={addRoom} className="ff-fields">
            <Field label="Room Number *">
              <input
                value={addForm.room_number}
                onChange={e => setAddForm(p => ({ ...p, room_number: e.target.value }))}
                placeholder="e.g. 101"
                required
              />
            </Field>
            <Field label="Floor">
              <input
                value={addForm.floor}
                onChange={e => setAddForm(p => ({ ...p, floor: e.target.value }))}
                placeholder="e.g. 1"
              />
            </Field>
            <Field label="Room Type *">
              <select
                value={addForm.room_type_id}
                onChange={e => setAddForm(p => ({ ...p, room_type_id: e.target.value }))}
                required
              >
                <option value="">— Select type —</option>
                {types.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
            <button
              type="submit"
              className="ff-btn ff-btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
              disabled={busy}
            >
              {busy ? "Adding…" : "Add Room"}
            </button>
          </form>
        </Modal>
      )}

      {/* ── Room type form modal ── */}
      {modal !== null && (
        <Modal
          title={modal === "new" ? "Add Room Type" : "Edit Room Type"}
          onClose={() => setModal(null)}
        >
          <form onSubmit={saveType} className="ff-fields">
            <Field label="Code *">
              <input
                value={form.code}
                onChange={e => f("code", e.target.value)}
                placeholder="e.g. DLX"
                required
                disabled={modal !== "new"}
              />
            </Field>
            <Field label="Name *">
              <input
                value={form.name}
                onChange={e => f("name", e.target.value)}
                placeholder="e.g. Deluxe Room"
                required
              />
            </Field>
            <Field label="Description">
              <textarea
                value={form.description}
                onChange={e => f("description", e.target.value)}
                rows={2}
                placeholder="Short description…"
              />
            </Field>
            <div className="ff-grid-2">
              <Field label="Base Rate (₹) *">
                <input
                  type="number"
                  value={form.base_rate}
                  onChange={e => f("base_rate", e.target.value)}
                  placeholder="5000"
                  required
                  min={0}
                />
              </Field>
              <Field label="Max Occupancy *">
                <input
                  type="number"
                  value={form.max_occupancy}
                  onChange={e => f("max_occupancy", e.target.value)}
                  placeholder="2"
                  required
                  min={1}
                />
              </Field>
            </div>
            <Field label="Amenities (comma-separated)">
              <input
                value={form.amenities}
                onChange={e => f("amenities", e.target.value)}
                placeholder="AC, Pool view, King bed"
              />
            </Field>
            <button
              type="submit"
              className="ff-btn ff-btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
              disabled={busy}
            >
              {busy ? "Saving…" : modal === "new" ? "Create" : "Save Changes"}
            </button>
          </form>
        </Modal>
      )}

      {/* ── Delete room type confirm ── */}
      {confirmDelType && (
        <div className="ff-backdrop" onClick={() => setConfirmDelType(null)}>
          <div className="ff-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head"><h3>Delete Room Type?</h3></div>
            <div className="ff-modal-body">
              <p style={{ color: "var(--ff-muted)", marginBottom: 20 }}>
                All rooms in this category must be removed first. This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmDelType(null)}>Cancel</button>
                <button
                  className="ff-btn ff-btn-primary"
                  style={{ background: "var(--ff-danger)", borderColor: "var(--ff-danger)" }}
                  onClick={doDeleteType}
                  disabled={busy}
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete room confirm ── */}
      {confirmDelRoom && (
        <div className="ff-backdrop" onClick={() => setConfirmDelRoom(null)}>
          <div className="ff-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="ff-modal-head"><h3>Remove Room?</h3></div>
            <div className="ff-modal-body">
              <p style={{ color: "var(--ff-muted)", marginBottom: 20 }}>
                This permanently removes the room. Rooms with active bookings cannot be deleted.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="ff-btn ff-btn-ghost" onClick={() => setConfirmDelRoom(null)}>Cancel</button>
                <button
                  className="ff-btn ff-btn-primary"
                  style={{ background: "var(--ff-danger)", borderColor: "var(--ff-danger)" }}
                  onClick={deleteRoom}
                  disabled={busy}
                >
                  {busy ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
