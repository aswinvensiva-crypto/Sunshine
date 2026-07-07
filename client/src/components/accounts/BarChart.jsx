export default function BarChart({ bars, height = 120 }) {
  const maxVal = Math.max(...bars.map(b => Math.abs(b.value)), 1);
  const barW = 52;
  const gap = 24;
  const svgW = bars.length * (barW + gap) - gap;
  const labelH = 44;

  return (
    <svg width={svgW} height={height + labelH} style={{ overflow: "visible", display: "block" }}>
      <line x1={0} y1={height} x2={svgW} y2={height} stroke="var(--ff-border)" strokeWidth={1} />
      {bars.map((bar, i) => {
        const x = i * (barW + gap);
        const pct = Math.abs(bar.value) / maxVal;
        const barH = Math.max(4, pct * height);
        const isNeg = bar.value < 0;
        const color = isNeg ? "#ef4444" : bar.color;
        const y = isNeg ? height : height - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={color} rx={5} opacity={0.88} />
            <text x={x + barW / 2} y={height + 18} textAnchor="middle" fontSize={11} fill="var(--ff-muted)">{bar.label}</text>
            <text x={x + barW / 2} y={isNeg ? y + barH + 14 : y - 6} textAnchor="middle" fontSize={11} fill={color} fontWeight={600}>{bar.short}</text>
          </g>
        );
      })}
    </svg>
  );
}
