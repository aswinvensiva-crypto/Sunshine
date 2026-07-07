export default function DonutChart({ segments, size = 140, thickness = 28 }) {
  const cx = size / 2, cy = size / 2;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let cumulativePct = 0;

  return (
    <svg width={size} height={size} style={{ display: "block", flexShrink: 0 }}>
      {total === 0
        ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--ff-border)" strokeWidth={thickness} />
        : segments.filter(s => s.value > 0).map((seg, i) => {
            const pct = seg.value / total;
            const dash = pct * circ;
            const rotation = cumulativePct * 360;
            cumulativePct += pct;
            return (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={seg.color} strokeWidth={thickness}
                strokeDasharray={`${dash} ${circ}`}
                strokeDashoffset={circ * 0.25}
                transform={`rotate(${rotation} ${cx} ${cy})`}
              />
            );
          })
      }
    </svg>
  );
}
