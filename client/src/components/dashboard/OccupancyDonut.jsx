export default function OccupancyDonut({ pct, occupied, dirty, available }) {
  const r = 52, circ = 2 * Math.PI * r;
  const fill = circ * (pct / 100);
  return (
    <div className="jqd-donut-wrap">
      <div className="jqd-donut">
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r={r} fill="none" stroke="#f3f4f6" strokeWidth="12" />
          <circle cx="65" cy="65" r={r} fill="none" stroke="#1d4ed8" strokeWidth="12"
            strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" />
        </svg>
        <div className="jqd-donut-center">
          <span className="jqd-donut-pct">{pct}%</span>
          <span className="jqd-donut-sub">Occupancy</span>
        </div>
      </div>
      <div className="jqd-donut-stats">
        <span><span className="jqd-donut-dot" style={{background:"#e8572a"}} />{occupied} occupied</span>
        <span><span className="jqd-donut-dot" style={{background:"#d97706"}} />{dirty} dirty</span>
        <span><span className="jqd-donut-dot" style={{background:"#3b82f6"}} />{available} available</span>
      </div>
    </div>
  );
}
