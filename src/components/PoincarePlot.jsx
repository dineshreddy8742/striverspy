// ── PoincarePlot.jsx ──────────────────────────────────────────────────────────
// Pure SVG Poincaré plot. No external libraries.
// Props: { ibis, sd1, sd2, risk }

export function PoincarePlot({ ibis, sd1, sd2, risk }) {
  if (!ibis || ibis.length < 4) return null;

  // SVG dimensions
  const SVG_W    = 160;
  const SVG_H    = 160;
  const PAD      = 20;
  const PLOT_W   = SVG_W - PAD * 2; // 120
  const PLOT_H   = SVG_H - PAD * 2; // 120
  const PLOT_X   = PAD;             // 20
  const PLOT_Y   = PAD;             // 20
  const AXIS_BTM = SVG_H - PAD;     // 140

  // Axis range: based on all IBI values
  const allVals = [...ibis];
  const minVal  = Math.min(...allVals) - 20;
  const maxVal  = Math.max(...allVals) + 20;
  const range   = maxVal - minVal || 1;

  // Coordinate transforms
  const toX = (v) => PLOT_X + ((v - minVal) / range) * PLOT_W;
  const toY = (v) => AXIS_BTM - ((v - minVal) / range) * PLOT_H; // Y inverted

  // Point colour by risk level
  const dotColor =
    risk === 'HIGH'     ? '#ef4444' :
    risk === 'MODERATE' ? '#f59e0b' :
    '#10b981';

  // Poincaré plot points: (IBI[i], IBI[i+1])
  const points = ibis.slice(0, ibis.length - 1).map((ibi, i) => ({
    cx: toX(ibi),
    cy: toY(ibis[i + 1]),
  }));

  return (
    <div>
      <svg
        width={SVG_W}
        height={SVG_H}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        style={{ display: 'block' }}
      >
        {/* Background */}
        <rect
          x={0} y={0}
          width={SVG_W} height={SVG_H}
          fill="#0f172a" rx={8}
        />

        {/* X axis */}
        <line
          x1={PLOT_X}      y1={AXIS_BTM}
          x2={PLOT_X + PLOT_W} y2={AXIS_BTM}
          stroke="rgba(255,255,255,0.15)" strokeWidth={1}
        />

        {/* Y axis */}
        <line
          x1={PLOT_X} y1={PLOT_Y}
          x2={PLOT_X} y2={AXIS_BTM}
          stroke="rgba(255,255,255,0.15)" strokeWidth={1}
        />

        {/* Identity line y = x (dashed): (PLOT_X, AXIS_BTM) → (PLOT_X + PLOT_W, PLOT_Y) */}
        <line
          x1={PLOT_X}           y1={AXIS_BTM}
          x2={PLOT_X + PLOT_W}  y2={PLOT_Y}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />

        {/* Data points */}
        {points.map((pt, i) => (
          <circle
            key={i}
            cx={pt.cx}
            cy={pt.cy}
            r={3}
            fill={dotColor}
            opacity={0.8}
          />
        ))}

        {/* X axis label */}
        <text
          x={PLOT_X + PLOT_W / 2}
          y={SVG_H - 5}
          fontSize={9}
          fill="rgba(255,255,255,0.35)"
          textAnchor="middle"
          fontFamily="monospace"
        >
          IBI[n] ms
        </text>

        {/* Y axis label — rotated */}
        <text
          x={8}
          y={PLOT_Y + PLOT_H / 2}
          fontSize={9}
          fill="rgba(255,255,255,0.35)"
          textAnchor="middle"
          fontFamily="monospace"
          transform={`rotate(-90, 8, ${PLOT_Y + PLOT_H / 2})`}
        >
          IBI[n+1]
        </text>
      </svg>

      {/* SD1 / SD2 readout below plot */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginTop: '6px',
        fontFamily: 'monospace',
        fontSize: '10px',
        color: 'rgba(255,255,255,0.3)',
        letterSpacing: '0.03em',
      }}>
        <span>SD1: {Math.round(sd1 ?? 0)}ms</span>
        <span>SD2: {Math.round(sd2 ?? 0)}ms</span>
      </div>
    </div>
  );
}
