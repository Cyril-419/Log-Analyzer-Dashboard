interface Bar {
  label: string;
  value: number;
  tone?: "high" | "medium" | "low" | "neutral";
}

interface Props {
  title: string;
  bars: Bar[];
  emptyText: string;
}

/** Horizontal bar chart drawn with plain SVG, so no chart library is needed. */
export function BarChart({ title, bars, emptyText }: Props) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const rowHeight = 30;
  const labelWidth = 180;
  const width = 480;
  const barArea = width - labelWidth - 50;

  return (
    <figure className="panel chart">
      <figcaption>{title}</figcaption>
      {bars.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${bars.length * rowHeight}`}
          role="img"
          aria-label={`${title}: ${bars.map((b) => `${b.label} ${b.value}`).join(", ")}`}
        >
          {bars.map((bar, i) => {
            const y = i * rowHeight;
            const w = Math.max(2, (bar.value / max) * barArea);
            return (
              <g key={bar.label} transform={`translate(0 ${y})`}>
                <text x={0} y={rowHeight / 2} dominantBaseline="middle" className="chart-label">
                  {bar.label.length > 24 ? `${bar.label.slice(0, 23)}…` : bar.label}
                </text>
                <rect x={labelWidth} y={6} width={w} height={rowHeight - 12} rx={4} className={`bar bar-${bar.tone ?? "neutral"}`} />
                <text x={labelWidth + w + 8} y={rowHeight / 2} dominantBaseline="middle" className="chart-value">
                  {bar.value.toLocaleString()}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </figure>
  );
}
