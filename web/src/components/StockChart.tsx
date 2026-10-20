import { useEffect, useMemo, useState } from "react";
import { callFunction } from "../lib/supabase";
import { date, num, pct, signClass } from "../lib/format";
import { LineChart, type Series } from "./LineChart";
import { ChartFrom, monthsBefore, today, useChallengeStart, yearsAgo } from "./ChartFrom";

type History = { currency: string; prices: { date: string; close: number }[] };
const cache = new Map<string, Promise<History>>();
const load = (symbol: string) => {
  // five years in one request, so any start date can be shown without reloading
  if (!cache.has(symbol)) cache.set(symbol, callFunction("market-data", { action: "history", symbol, from: yearsAgo(5) }));
  return cache.get(symbol)!;
};

/** Daily closing prices of one stock (Yahoo Finance), from a date of your choice, with the challenge start marked. */
export function StockChart({ symbol, entryPrice, entryDate, side }: { symbol: string; entryPrice?: number | null; entryDate?: string | null; side?: string }) {
  const start = useChallengeStart();
  const [h, setH] = useState<History | null>(null);
  const [err, setErr] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  useEffect(() => {
    setH(null); setErr("");
    load(symbol).then(setH).catch((e) => { cache.delete(symbol); setErr((e as Error).message); });
  }, [symbol]);
  // default: the challenge start; while the challenge has less than a month of prices, six months before it
  useEffect(() => {
    if (start && from === null) setFrom(start <= monthsBefore(today(), 1) ? start : monthsBefore(start, 6));
  }, [start, from]);

  const view = useMemo(() => {
    if (!h || !from) return null;
    const pts = h.prices.filter((p) => p.date >= from).map((p) => ({ x: p.date, y: p.close }));
    const series: Series[] = [{ name: `${symbol} (${h.currency})`, color: "#7aa2ff", points: pts }];
    if (entryPrice && pts.length > 1) {
      const s0 = entryDate && entryDate > pts[0].x ? entryDate : pts[0].x;
      series.push({ name: `Entry${side ? ` ${side}` : ""} @ ${num(entryPrice, 2)}`, color: "#f5c451", dashed: true, points: [{ x: s0, y: entryPrice }, { x: pts[pts.length - 1].x, y: entryPrice }] });
    }
    const change = pts.length > 1 ? pts[pts.length - 1].y / pts[0].y - 1 : null;
    return { series, change, last: pts.at(-1)?.y ?? null };
  }, [h, from, symbol, entryPrice, entryDate, side]);

  if (err) return <p className="muted small">Price history not available: {err}</p>;
  if (!view || !start || !from) return <p className="muted small">Loading the price history…</p>;
  const earliest = h!.prices[0]?.date ?? yearsAgo(5);
  return (
    <div>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div className="small">
          <b>{symbol}</b> · last close {num(view.last, 2)} {h!.currency} · <span className={signClass(view.change)}>{pct(view.change)}</span> since {date(from)}
        </div>
        <ChartFrom value={from} onChange={setFrom} min={earliest} start={start} />
      </div>
      <LineChart series={view.series} yFormat={(v) => num(v, v >= 1000 ? 0 : 2)} title={`Daily closing price of ${symbol}`}
        markers={[{ x: start, label: `Challenge start ${date(start)}` }]} />
    </div>
  );
}
