import { useState, useEffect } from "react";
import { apiFetch, rupee } from "../../admin/adminContext.js";

export default function SuppressedYieldPanel() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/admin/suppressed-yield")
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ fontSize: 12, color: "#9ca3af", padding: "8px 0" }}>Loading yield data…</p>;
  if (!data || data.total_suppressed === 0) return (
    <div style={{ fontSize: 13, color: "#6b7280", padding: "12px 0" }}>
      No suppressed yield events this month. The GST cap has not been triggered yet.
    </div>
  );

  const daily = data.daily || [];
  const maxVal = Math.max(...daily.map(d => Number(d.suppressed)), 1);

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ background: "#fef3c7", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 140 }}>
          <p style={{ fontSize: 11, color: "#92400e", fontWeight: 700, margin: "0 0 4px", textTransform: "uppercase" }}>Total Suppressed</p>
          <p style={{ fontSize: 22, fontWeight: 800, color: "#92400e", margin: 0 }}>{rupee(data.total_suppressed)}</p>
          <p style={{ fontSize: 11, color: "#b45309", margin: "4px 0 0" }}>{data.events} cap event{data.events !== 1 ? "s" : ""} this month</p>
        </div>
        <div style={{ background: "#ede9fe", borderRadius: 10, padding: "12px 16px", flex: 2, minWidth: 220 }}>
          <p style={{ fontSize: 11, color: "#5b21b6", fontWeight: 700, margin: "0 0 4px", textTransform: "uppercase" }}>Insight</p>
          <p style={{ fontSize: 12, color: "#4c1d95", margin: 0 }}>
            You left <b>{rupee(data.total_suppressed)}</b> on the table this month due to the 12%→18% GST threshold cap.
            Rooms priced above ₹8,200 comfortably clear this. Consider upgrading amenities to sustain rates above ₹8,200 and eliminate the cap.
          </p>
        </div>
      </div>

      {daily.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Daily suppressed revenue (this month)</p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80, overflowX: "auto" }}>
            {daily.map(d => {
              const h = Math.max(4, (Number(d.suppressed) / maxVal) * 72);
              return (
                <div key={d.booking_date} title={`${d.booking_date}: ${rupee(d.suppressed)} suppressed`}
                  style={{ flex: "0 0 18px", height: h, background: "#f59e0b", borderRadius: "3px 3px 0 0", cursor: "default" }}
                />
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
            <span>{daily[0]?.booking_date?.slice(5)}</span>
            <span>{daily[daily.length - 1]?.booking_date?.slice(5)}</span>
          </div>
        </>
      )}
    </div>
  );
}
