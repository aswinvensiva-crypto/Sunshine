export const ROOM_STATUS = {
  available:   { label: "Vacant Clean",       color: "#16a34a" },
  occupied:    { label: "Occupied",            color: "#e8572a" },
  stay_over:   { label: "Stay-Over Refresh",   color: "#3b82f6" },
  maintenance: { label: "Maintenance Outage",  color: "#d97706" },
  unavailable: { label: "Unavailable",         color: "#dc2626" },
};

export default function RoomCell({ room, tasks, onClick }) {
  const s = ROOM_STATUS[room.status] || ROOM_STATUS.available;
  const roomTasks = tasks || [];
  const hasUrgent  = roomTasks.some(t => t.priority === "Urgent" || t.status === "Blocked");
  const hasActive  = roomTasks.some(t => t.status === "In-Progress");
  const hasPending = roomTasks.length > 0;

  let taskBadge = null;
  if (hasUrgent) {
    taskBadge = { label: "Blocked / Maint.", bg: "#fee2e2", color: "#dc2626" };
  } else if (hasActive) {
    taskBadge = { label: "Turnaround…", bg: "#fef3c7", color: "#d97706" };
  } else if (hasPending) {
    taskBadge = { label: "Task Pending", bg: "#fef3c7", color: "#d97706" };
  } else if (room.status === "available") {
    taskBadge = { label: "Clean & Ready", bg: "#dcfce7", color: "#16a34a" };
  }

  return (
    <div
      onClick={() => onClick && onClick(room, roomTasks)}
      style={{
        background: s.color + "18", border: `2px solid ${s.color}`,
        borderRadius: 10, padding: "12px 10px", textAlign: "center",
        position: "relative", minHeight: 90, cursor: "pointer",
        transition: ".15s", userSelect: "none",
      }}
    >
      <div style={{ position:"absolute", top:6, right:8, width:8, height:8, borderRadius:"50%", background:s.color }} />
      <div style={{ fontSize:20, fontWeight:700, color:"#111827" }}>{room.room_number}</div>
      <div style={{ fontSize:10, color:"#6b7280", marginTop:4 }}>{room.type}</div>
      <div style={{ fontSize:10, marginTop:4, color:s.color, fontWeight:600 }}>{s.label}</div>
      {taskBadge && (
        <div style={{
          marginTop: 6, display: "inline-block",
          background: taskBadge.bg, color: taskBadge.color,
          fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10,
        }}>
          {taskBadge.label}
        </div>
      )}
    </div>
  );
}
