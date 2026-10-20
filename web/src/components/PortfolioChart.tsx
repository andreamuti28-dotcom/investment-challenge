import { useEffect, useState } from "react";
import { callFunction } from "../lib/supabase";
import { date } from "../lib/format";
import { LineChart, type Series } from "./LineChart";
import { ChartFrom, useChallengeStart, yearsAgo } from "./ChartFrom";

let preStart: Promise<{ date: string; eur: number }[]> | null = null;
/** MSCI World in euro before the challenge start (five years, loaded once). */
const loadPreStart = () =>
  (preStart ??= callFunction("market-data", { action: "benchmark", from: yearsAgo(5) }).then((r: any) => r.points ?? []).catch((e) => { preStart = null; throw e; }));

/** Portfolio charts. Teams exist from the challenge start; before it the benchmark alone is shown,
 *  so the chart can start from any date in the last five years. */
export function PortfolioChart({ series, yFormat, title, mode = "return", capital = 1_000_000 }: {
  series: Series[]; yFormat: (v: number) => string; title: string;
  /** "return": y are returns since the start; "value": y are euro values starting at the capital */
  mode?: "return" | "value"; capital?: number;
}) {
  const start = useChallengeStart();
  const [from, setFrom] = useState<string | null>(null);
  const [pre, setPre] = useState<{ date: string; eur: number }[] | null>(null);
  const [err, setErr] = useState("");
  const f = from ?? start;
  useEffect(() => {
    if (start && f && f < start && !pre) loadPreStart().then(setPre).catch((e) => setErr((e as Error).message));
  }, [start, f, pre]);
  if (!start || !f) return null;

  let shown: Series[] = series.map((s) => ({ ...s, points: s.points.filter((p) => p.x >= f) }));
  if (f < start && pre) {
    const base = pre.filter((p) => p.date <= start).at(-1)?.eur;
    if (base) {
      const before = pre.filter((p) => p.date >= f && p.date < start)
        .map((p) => ({ x: p.date, y: mode === "value" ? (capital * p.eur) / base : p.eur / base - 1 }));
      shown = shown.map((s) => (s.benchmark ? { ...s, points: [...before, ...s.points] } : s));
    }
  }
  if (mode === "return" && f > start) {
    // returns recomputed from the chosen date: (1 + r_t) / (1 + r_from) - 1
    shown = shown.map((s) => {
      if (!s.points.length) return s;
      const b = 1 + s.points[0].y;
      return { ...s, points: s.points.map((p) => ({ x: p.x, y: (1 + p.y) / b - 1 })) };
    });
  }
  return (
    <div>
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <ChartFrom value={f} onChange={setFrom} min={yearsAgo(5)} start={start} />
      </div>
      {err && <p className="muted small">History before the start not available: {err}</p>}
      {f < start && !pre && !err && <p className="muted small">Loading the MSCI World history…</p>}
      <LineChart series={shown} yFormat={yFormat} title={title} markers={[{ x: start, label: `Challenge start ${date(start)}` }]} />
      {f < start && <p className="muted small" style={{ marginTop: 6 }}>Before the start only the MSCI World is shown (in euro); team portfolios begin on {date(start)}.</p>}
    </div>
  );
}
