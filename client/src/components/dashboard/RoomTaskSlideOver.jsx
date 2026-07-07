import { X } from "lucide-react";

export default function RoomTaskSlideOver({ room, tasks, onClose }) {
  if (!room) return null;
  return (
    <>
      <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.35)",zIndex:999 }} />
      <div style={{
        position:"fixed",top:0,right:0,height:"100%",width:380,maxWidth:"95vw",
        background:"#fff",zIndex:1000,display:"flex",flexDirection:"column",
        boxShadow:"-4px 0 24px rgba(0,0,0,.12)",
      }}>
        <div style={{ padding:"20px 20px 14px", borderBottom:"1px solid #e5e7eb", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <p style={{ fontWeight:800, fontSize:17, margin:0 }}>Room {room.room_number}</p>
            <p style={{ fontSize:12, color:"#6b7280", margin:"2px 0 0" }}>{room.type}</p>
          </div>
          <button onClick={onClose} style={{ background:"none",border:"none",cursor:"pointer",padding:4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:20 }}>
          <p style={{ fontSize:12, fontWeight:700, color:"#6b7280", marginBottom:12, textTransform:"uppercase", letterSpacing:".05em" }}>
            Task Pipeline ({tasks.length})
          </p>
          {tasks.length === 0
            ? <p style={{ fontSize:13, color:"#9ca3af" }}>No open tasks for this room.</p>
            : tasks.map(t => (
              <div key={t.task_id} style={{ background:"#f9fafb",borderRadius:10,padding:"12px 14px",marginBottom:10,border:"1px solid #e5e7eb" }}>
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                  <span style={{
                    fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:10,
                    background: t.status==="In-Progress"?"#dbeafe":"#fef3c7",
                    color: t.status==="In-Progress"?"#1d4ed8":"#d97706",
                  }}>{t.status}</span>
                  <span style={{fontSize:10,color:"#6b7280"}}>{t.priority}</span>
                </div>
                <p style={{ fontWeight:600,fontSize:13,margin:0,color:"#111827" }}>{t.title}</p>
                {t.assigned_name && <p style={{ fontSize:11,color:"#6b7280",margin:"3px 0 0" }}>Assigned: {t.assigned_name}</p>}
              </div>
            ))
          }
        </div>
      </div>
    </>
  );
}
