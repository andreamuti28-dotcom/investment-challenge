import { useState } from "react";
import { LineChart, type Series } from "./LineChart";
import { ChartFrom, useChallengeStart } from "./ChartFrom";

/** Portfolio charts: they exist only from the challenge start, so the date can be chosen from there on. */
export function PortfolioChart({ series, yFormat, title, rebase }: {
  series: Series[]; yFormat: (v: number) => string; title: string;
  /** "return": show the return since the chosen date instead of the raw values */
  rebase?: boolean;
}) {
  const start = useChallengeStart();
  const [from, setFrom] = useState<string | null>(null);
  if (!start) return null;
  const f = from ?? start;
  const shown = series.map((s) => {
    const pts = s.points.filter((p) => p.x >= f);
    if (!rebase || !pts.length) return { ...s, points: pts };
    // returns recomputed from the chosen date: (1 + r_t) / (1 + r_from) - 1
    const base = 1 + pts[0].y;
    return { ...s, points: pts.map((p) => ({ x: p.x, y: (1 + p.y) / base - 1 })) };
  });
  return (
    <div>
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <ChartFrom value={f} onChange={setFrom} min={start} start={start} />
      </div>
      <LineChart series={shown} yFormat={yFormat} title={title} />
    </div>
  );
}
