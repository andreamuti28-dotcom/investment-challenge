import { supabase } from "../lib/supabase";
import { useLoad } from "../lib/data";
import { date, dateTime, num, pct, signClass } from "../lib/format";
import { Loading, Notice } from "./ui";

const ACTION: Record<string, string> = { open: "Open", close: "Close", change: "Change quantity" };
const WHY: Record<string, string> = { order: "closed", change: "resized", stop: "stop +50%" };

/** The stocks a participant opened and every move they made (executed orders are public). */
export default function PersonActivity({ userId, own = false }: { userId: string; own?: boolean }) {
  const q = useLoad(async () => {
    const [st, mv] = await Promise.all([
      supabase.rpc("participant_stocks", { p_user: userId }),
      supabase.rpc("participant_moves", { p_user: userId }),
    ]);
    if (st.error) throw new Error(st.error.message);
    if (mv.error) throw new Error(mv.error.message);
    return { stocks: (st.data ?? []) as any[], moves: (mv.data ?? []) as any[] };
  }, [userId]);
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  const open = q.data.stocks.filter((s) => !s.exit_date), closed = q.data.stocks.filter((s) => s.exit_date);
  const ret = (s: any) => {
    const exit = Number(s.exit_date ? s.exit_price : s.last_price), entry = Number(s.entry_price);
    return entry ? (s.side === "long" ? 1 : -1) * (exit / entry - 1) : null;
  };
  const stockTable = (rows: any[], isOpen: boolean) => rows.length === 0 ? <p className="muted small">{isOpen ? "No open stocks." : "None yet."}</p> : (
    <div className="table-wrap"><table>
      <thead><tr><th>Stock</th><th>Comp.</th><th>Team</th><th>Side</th><th className="num">Quantity</th><th>Entry</th><th className="num">Entry price</th>
        {isOpen ? <th className="num">Last close</th> : <><th>Exit</th><th className="num">Exit price</th></>}<th className="num">P&amp;L (local)</th><th className="num">Return</th></tr></thead>
      <tbody>{rows.map((s, i) => (
        <tr key={i}><td><b>{s.symbol}</b></td><td>{s.competition}</td><td className="small">{s.team}</td><td><span className={`badge ${s.side}`}>{s.side}</span></td>
          <td className="num">{num(s.quantity, 0)}</td><td>{date(s.entry_date)}</td><td className="num">{num(s.entry_price, 2)} {s.currency}</td>
          {isOpen ? <td className="num">{num(s.last_price, 2)} {s.currency}</td> : <><td>{date(s.exit_date)} <span className="muted small">{WHY[s.exit_reason] ?? ""}</span></td><td className="num">{num(s.exit_price, 2)} {s.currency}</td></>}
          <td className={`num ${signClass(s.pnl_local)}`}>{num(s.pnl_local)} {s.currency}</td><td className={`num ${signClass(ret(s))}`}>{pct(ret(s))}</td></tr>
      ))}</tbody>
    </table></div>
  );
  return (
    <>
      <div className="card">
        <h3>{own ? "My stocks" : "Stocks"} · open ({open.length})</h3>
        {stockTable(open, true)}
        <h3 style={{ marginTop: 20 }}>Closed ({closed.length})</h3>
        {stockTable(closed, false)}
      </div>
      <div className="card">
        <h3>{own ? "All my moves" : "Moves"} ({q.data.moves.length})</h3>
        {!own && <p className="muted small">Executed orders placed by this participant, for any of their teams.</p>}
        {q.data.moves.length === 0 ? <p className="muted small">No moves yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Placed</th><th>Comp.</th><th>Team</th><th>Stock</th><th>Action</th><th>Side</th><th className="num">Quantity</th><th>Status</th><th>Executed</th><th className="num">Price</th></tr></thead>
            <tbody>{q.data.moves.map((m) => (
              <tr key={m.id}><td className="small">{dateTime(m.placed_at)}</td><td>{m.competition}</td><td className="small">{m.team}</td><td><b>{m.symbol}</b></td>
                <td>{ACTION[m.action] ?? m.action}</td><td>{m.side ?? "–"}</td><td className="num">{m.quantity ? num(m.quantity, 0) : "all"}</td>
                <td><span className={`badge ${m.status}`}>{m.status}</span>{m.reject_reason && <div className="muted small">{m.reject_reason}</div>}</td>
                <td>{m.executed_date ? date(m.executed_date) : m.status === "pending" ? `close of ${date(m.exec_date)}` : "–"}</td><td className="num">{num(m.executed_price, 2)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
