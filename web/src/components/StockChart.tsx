import { useMemo, useState } from "react";
import { callFunction } from "../lib/supabase";
import { useLoad } from "../lib/data";
import { num, pct, signClass } from "../lib/format";
import { LineChart, type Series } from "./LineChart";

const RANGES = [["1M", 31], ["3M", 92], ["6M", 183], ["1Y", 366]] as const;

/** Daily closing prices of one stock (Yahoo Finance), with the team's entry price if given. */
export function StockChart({ symbol, entryPrice, entryDate, side }: { symbol: string; entryPrice?: number | null; entryDate?: string | null; side?: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("6M");
  const q = useLoad(async () => (await callFunction("market-data", { action: "history", symbol })) as { currency: string; prices: { date: string; close: number }[] }, [symbol]);
  const view = useMemo(() => {
    if (!q.data) return null;
    const days = RANGES.find((r) => r[0] === range)![1];
    const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const pts = q.data.prices.filter((p) => p.date >= from).map((p) => ({ x: p.date, y: p.close }));
    const series: Series[] = [{ name: `${symbol} (${q.data.currency})`, color: "#7aa2ff", points: pts }];
    if (entryPrice && pts.length > 1) {
      const start = entryDate && entryDate > pts[0].x ? entryDate : pts[0].x;
      series.push({ name: `Entry ${side ?? ""} @ ${num(entryPrice, 2)}`.replace("  ", " "), color: "#f5c451", dashed: true, points: [{ x: start, y: entryPrice }, { x: pts[pts.length - 1].x, y: entryPrice }] });
    }
    const change = pts.length > 1 ? pts[pts.length - 1].y / pts[0].y - 1 : null;
    return { series, change, last: pts.at(-1)?.y ?? null };
  }, [q.data, range, symbol, entryPrice, entryDate, side]);

  if (q.error) return <p className="muted small">Price history not available: {q.error}</p>;
  if (!view) return <p className="muted small">Loading the price history…</p>;
  return (
    <div>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div className="small">
          <b>{symbol}</b> · last close {num(view.last, 2)} {q.data!.currency} · <span className={signClass(view.change)}>{pct(view.change)}</span> in {range}
        </div>
        <div className="seg" role="group" aria-label="Period">
          {RANGES.map(([r]) => <button key={r} type="button" className={range === r ? "on" : ""} style={{ minHeight: 30, padding: "4px 10px" }} onClick={() => setRange(r)}>{r}</button>)}
        </div>
      </div>
      <LineChart series={view.series} yFormat={(v) => num(v, v >= 1000 ? 0 : 2)} title={`Daily closing price of ${symbol}`} />
    </div>
  );
}
