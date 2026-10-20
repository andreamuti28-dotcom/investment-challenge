import { useMemo, useState } from "react";

export interface Series {
  name: string;
  color: string;
  dashed?: boolean;
  points: { x: string; y: number }[]; // x = YYYY-MM-DD
}

const narrow = typeof window !== "undefined" && window.innerWidth < 640;
const W = narrow ? 420 : 900, H = narrow ? 300 : 320, PL = 56, PR = 12, PT = 16, PB = 36;

export function LineChart({ series, yFormat, title }: { series: Series[]; yFormat: (v: number) => string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  const dates = useMemo(() => [...new Set(all.map((p) => p.x))].sort(), [series]);
  if (all.length < 2) return <p className="muted small">The chart appears after the first trading days.</p>;
  const t = (d: string) => Date.parse(d + "T00:00:00Z");
  const x0 = t(dates[0]), x1 = Math.max(t(dates[dates.length - 1]), x0 + 86_400_000);
  let y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y));
  if (y0 === y1) { y0 -= 0.01; y1 += 0.01; }
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const X = (d: string) => PL + ((t(d) - x0) / (x1 - x0)) * (W - PL - PR);
  const Y = (v: number) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  const ticks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const monthTicks = dates.filter((d, i) => i === 0 || d.slice(0, 7) !== dates[i - 1].slice(0, 7));
  const hx = hover !== null ? dates[hover] : null;

  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0, bd = Infinity;
          dates.forEach((d, i) => { const dd = Math.abs(X(d) - px); if (dd < bd) { bd = dd; best = i; } });
          setHover(best);
        }}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} stroke="#1f2631" />
            <text x={PL - 8} y={Y(v) + 4} textAnchor="end" fontSize="12" fill="#8a94a3">{yFormat(v)}</text>
          </g>
        ))}
        {monthTicks.map((d) => (
          <text key={d} x={X(d)} y={H - 12} fontSize="12" fill="#8a94a3" textAnchor="middle">
            {new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}
          </text>
        ))}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "6 4" : undefined}
            points={s.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} />
        ))}
        {hx && (
          <g>
            <line x1={X(hx)} x2={X(hx)} y1={PT} y2={H - PB} stroke="#ffffff" strokeOpacity={0.3} />
            {series.map((s) => {
              const p = s.points.filter((q) => q.x <= hx).at(-1);
              return p ? <circle key={s.name} cx={X(p.x)} cy={Y(p.y)} r={3.5} fill={s.color} /> : null;
            })}
          </g>
        )}
      </svg>
      <div className="legend">
        {series.map((s) => {
          const p = hx ? s.points.filter((q) => q.x <= hx).at(-1) : s.points.at(-1);
          return (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}{p ? `: ${yFormat(p.y)}` : ""}
            </span>
          );
        })}
        {hx && <span className="muted">{new Date(hx + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
      </div>
    </figure>
  );
}

export const PALETTE = ["#7aa2ff", "#f5c451", "#3ddc97", "#ff7a7a", "#c49bff", "#38d6d0"];
