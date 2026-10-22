import { useState } from "react";
import { supabase } from "../lib/supabase";
import { must, useLoad } from "../lib/data";
import { date, num, pct, signClass } from "../lib/format";
import { Loading, Notice } from "./ui";

/** Public list of a team's positions (open and closed) with their performance. */
export function TeamHoldings({ teamId }: { teamId: string }) {
  const [view, setView] = useState<"open" | "closed">("open");
  const q = useLoad(async () => {
    const [pos, instr] = await Promise.all([
      must(supabase.from("positions").select("symbol,currency,side,quantity,entry_date,entry_price,exit_date,exit_price,exit_reason,last_price,value_local,pnl_local").eq("team_id", teamId).order("entry_date")),
      must(supabase.from("instruments").select("symbol,name")),
    ]);
    return { pos: pos as any[], names: Object.fromEntries((instr as any[]).map((i) => [i.symbol, i.name])) as Record<string, string> };
  }, [teamId]);
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  const rows = q.data.pos.filter((p) => (view === "open" ? !p.exit_date : p.exit_date));
  const ret = (p: any) => {
    const exit = p.exit_date ? Number(p.exit_price) : Number(p.last_price);
    return Number(p.entry_price) ? (p.side === "long" ? 1 : -1) * (exit / Number(p.entry_price) - 1) : null;
  };
  const why: Record<string, string> = { order: "closed", change: "resized", stop: "stop +50%", stop_loss: "stop loss", take_profit: "take profit" };
  return (
    <div className="holdings">
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <button className={`small ${view === "open" ? "" : "secondary"}`} onClick={() => setView("open")}>Open positions ({q.data.pos.filter((p) => !p.exit_date).length})</button>
        <button className={`small ${view === "closed" ? "" : "secondary"}`} onClick={() => setView("closed")}>Closed ({q.data.pos.filter((p) => p.exit_date).length})</button>
      </div>
      {rows.length === 0 ? <p className="muted small">{view === "open" ? "No open positions." : "No closed positions yet."}</p> : (
        <div className="table-wrap"><table>
          <thead><tr>
            <th>Stock</th><th>Side</th><th className="num">Quantity</th><th>Entry</th><th className="num">Entry price</th>
            {view === "open" ? <th className="num">Last close</th> : <><th>Exit</th><th className="num">Exit price</th></>}
            <th className="num">P&amp;L (local)</th><th className="num">Return</th>
          </tr></thead>
          <tbody>{rows.map((p, i) => (
            <tr key={i}>
              <td><b>{p.symbol}</b> <span className="muted small">{q.data!.names[p.symbol] ?? ""}</span></td>
              <td><span className={`badge ${p.side}`}>{p.side}</span></td>
              <td className="num">{num(p.quantity, 0)}</td>
              <td>{date(p.entry_date)}</td>
              <td className="num">{num(p.entry_price, 2)} {p.currency}</td>
              {view === "open" ? <td className="num">{num(p.last_price, 2)} {p.currency}</td> : <><td>{date(p.exit_date)} <span className="muted small">{why[p.exit_reason] ?? ""}</span></td><td className="num">{num(p.exit_price, 2)} {p.currency}</td></>}
              <td className={`num ${signClass(p.pnl_local)}`}>{num(p.pnl_local)} {p.currency}</td>
              <td className={`num ${signClass(ret(p))}`}>{pct(ret(p))}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
