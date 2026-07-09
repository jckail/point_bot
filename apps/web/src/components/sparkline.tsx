/**
 * Dependency-free SVG sparkline. `values` are ordered oldest → newest.
 */
export function Sparkline({
  values,
  width = 480,
  height = 120,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 8;

  const points = values.map((value, index) => {
    const x =
      padding + (index / (values.length - 1)) * (width - padding * 2);
    const y =
      height - padding - ((value - min) / range) * (height - padding * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const lastPoint = points[points.length - 1]!;
  const area = `${padding},${height - padding} ${line} ${lastPoint[0]},${height - padding}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="Balance history chart"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C5CFF" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7C5CFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="spark-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#FFB547" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline
        points={line}
        fill="none"
        stroke="url(#spark-line)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="4" fill="#FFB547" />
    </svg>
  );
}
