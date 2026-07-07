import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { adminCalendar } from "../../api/client.js";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["M","T","W","T","F","S","S"];

export default function MiniCalendar() {
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [occMap, setOccMap] = useState({});
  const [loading, setLoading] = useState(false);

  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  useEffect(() => {
    setLoading(true);
    adminCalendar(monthKey)
      .then(data => {
        const map = {};
        (data.days || []).forEach(row => {
          const dateStr = row.stay_date?.slice(0, 10) ?? row.date?.slice(0, 10);
          if (!dateStr) return;
          const total  = row.total  ?? 0;
          const booked = row.booked ?? 0;
          const avail  = total - booked;
          const availPct = total > 0 ? (avail / total) * 100 : null;
          map[dateStr] = { total, booked, avail, availPct };
        });
        setOccMap(map);
      })
      .catch(() => setOccMap({}))
      .finally(() => setLoading(false));
  }, [monthKey]);

  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prev = () => { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); };

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function getDayInfo(d) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const cellDate = new Date(year, month, d);
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isPast  = cellDate < todayMidnight;
    const isToday = cellDate.getTime() === todayMidnight.getTime();
    const inv = occMap[dateStr];

    if (!inv) return { isToday, isPast, tier: "none", label: "–", title: "No inventory" };
    if (inv.total === 0) return { isToday, isPast, tier: "closed", label: "CLSD", title: "Closed" };
    if (inv.avail <= 0) return { isToday, isPast, tier: "sold", label: "FULL", title: `${inv.booked}/${inv.total} booked` };

    let tier;
    if (inv.availPct <= 30)      tier = "low";
    else if (inv.availPct <= 70) tier = "mid";
    else                          tier = "high";

    return { isToday, isPast, tier, label: String(inv.avail), title: `${inv.avail} of ${inv.total} available` };
  }

  const legendCounts = { low: 0, mid: 0, high: 0 };
  Object.values(occMap).forEach(inv => {
    if (inv.total === 0 || inv.availPct === null) return;
    if (inv.avail <= 0) return;
    if (inv.availPct <= 30)      legendCounts.low++;
    else if (inv.availPct <= 70) legendCounts.mid++;
    else                          legendCounts.high++;
  });

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="jqd-cal-header">
        <button className="jqd-cal-nav" onClick={prev}><ChevronLeft size={14}/></button>
        <span className="jqd-cal-title">{MONTHS[month]} {year}</span>
        <button className="jqd-cal-nav" onClick={next}><ChevronRight size={14}/></button>
      </div>
      {loading && <div className="jqd-cal-loading">Loading…</div>}
      <div className={`jqd-cal-grid${loading ? " jqd-cal-grid--faded" : ""}`}>
        {DAYS.map((d,i) => <div key={i} className="jqd-cal-dow">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const { isToday, isPast, tier, label, title } = getDayInfo(d);
          const cellClass = [
            "jqd-cal-cell",
            isToday ? "today" : "",
            isPast  ? "past"  : "",
          ].filter(Boolean).join(" ");
          const occClass = `jqd-cal-occ ${tier !== "none" ? tier : ""}`.trim();
          return (
            <div key={d} className={cellClass} title={title}>
              <span className="jqd-cal-day">{d}</span>
              <span className={occClass}>{label}</span>
            </div>
          );
        })}
      </div>
      <div className="jqd-cal-legend">
        <div className="jqd-cal-legend-item low">
          <div className="jqd-cal-legend-num">{legendCounts.low}</div>
          <div className="jqd-cal-legend-label">0–30% avail</div>
        </div>
        <div className="jqd-cal-legend-item mid">
          <div className="jqd-cal-legend-num">{legendCounts.mid}</div>
          <div className="jqd-cal-legend-label">30–70% avail</div>
        </div>
        <div className="jqd-cal-legend-item high">
          <div className="jqd-cal-legend-num">{legendCounts.high}</div>
          <div className="jqd-cal-legend-label">70%+ avail</div>
        </div>
      </div>
    </div>
  );
}
