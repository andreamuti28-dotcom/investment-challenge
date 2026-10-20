import { useMemo, useState } from "react";
import { callFunction, errText, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { loadCalendar, must, useLoad } from "../lib/data";
import { date, dateTime, eur, num, pct, signClass } from "../lib/format";
import { Countdown, Loading, Notice, Stat, Tabs } from "../components/ui";
import { LineChart } from "../components/LineChart";

interface Position {
  id: number; symbol: string; currency: string; side: "long" | "short"; quantity: number; entry_date: string; entry_price: number;
  exit_date: string | null; exit_price: number | null; exit_reason: string | null; last_price: number | null; value_local: number | null;
  value_eur: number | null; pnl_local: number | null; pnl_eur: number | null;
}
interface Order {
  id: string; month_n: number; symbol: string; action: "open" | "close" | "change"; side: string | null; target_quantity: number | null;
  status: string; reject_reason: string | null; executed_date: string | null; executed_price: number | null; created_at: string;
}
interface Transfer { id: string; month_n: number; currency: string; eur_amount: number; status: string; rate: number | null; executed_date: string | null; reject_reason: string | null }
interface Instrument { symbol: string; name: string | null; exchange: string | null; currency: string }

const CURRENCIES = ["USD", "GBP", "CHF", "JPY", "CAD", "AUD", "HKD", "SEK", "NOK", "DKK", "PLN", "KRW", "INR", "BRL", "SGD", "ZAR", "MXN", "CNY", "ILS", "TRY", "CZK", "HUF", "NZD"];

export default function MyTeam() {
  const { team } = useAuth();
  const [tab, setTab] = useState<"portfolio" | "orders" | "history" | "account">("portfolio");
  const q = useLoad(async () => {
    const [cal, pos, sub, orders, transfers, nav, bench, met, instr, fx] = await Promise.all([
      loadCalendar(),
      must(supabase.from("positions").select("*").order("entry_date")),
      must(supabase.from("subportfolios").select("*")),
      must(supabase.from("orders").select("*").order("created_at", { ascending: false })),
      must(supabase.from("transfer_orders").select("*").order("created_at", { ascending: false })),
      must(supabase.from("nav_daily").select("date,nav_eur").eq("team_id", team!.id).order("date")),
      must(supabase.from("benchmark_daily").select("date,value_eur").order("date")),
      supabase.from("leaderboard").select("*").eq("team_id", team!.id).maybeSingle(),
      must(supabase.from("instruments").select("symbol,name,exchange,currency")),
      must(supabase.from("fx_rates").select("currency,date,rate").order("date", { ascending: false }).limit(400)),
    ]);
    const fxLatest: Record<string, number> = { EUR: 1 };
    for (const r of fx as any[]) if (!(r.currency in fxLatest)) fxLatest[r.currency] = Number(r.rate);
    return {
      ...cal,
      positions: pos as Position[],
      subs: sub as any[],
      orders: orders as Order[],
      transfers: transfers as Transfer[],
      nav: nav as any[],
      bench: bench as any[],
      metrics: met.data as any,
      instruments: Object.fromEntries((instr as Instrument[]).map((i) => [i.symbol, i])) as Record<string, Instrument>,
      fxLatest,
    };
  }, [team?.id]);

  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  const d = q.data;

  return (
    <>
      <div className="row spread">
        <div>
          <div className="eyebrow">Competition {team!.competition}</div>
          <h1 style={{ fontSize: 38 }}>{team!.name}</h1>
        </div>
        {d.openMonth && (
          <div className="card" style={{ margin: 0, padding: "10px 16px" }}>
            <div className="small muted">Orders for {d.openMonth.label} close in</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22 }}><Countdown to={d.openMonth.order_deadline} /></div>
          </div>
        )}
      </div>
      <Tabs value={tab} onChange={setTab} items={[["portfolio", "Portfolio"], ["orders", "Orders"], ["history", "History"], ["account", "Account"]]} />
      {tab === "portfolio" && <Portfolio d={d} />}
      {tab === "orders" && <Orders d={d} reload={q.reload} />}
      {tab === "history" && <History d={d} />}
      {tab === "account" && <Account />}
    </>
  );
}

function Portfolio({ d }: { d: any }) {
  const open: Position[] = d.positions.filter((p: Position) => !p.exit_date);
  const m = d.metrics;
  const subsTotal = d.subs.reduce((a: number, s: any) => a + Number(s.total_eur ?? 0), 0);
  const cap = Number(d.settings.capital);
  return (
    <>
      <div className="card dark">
        <div className="grid cols-4">
          <Stat label="NAV" value={eur(m?.nav ?? cap, 0)} />
          <Stat label="Total return" value={pct(m?.total_return ?? 0)} />
          <Stat label="vs MSCI World" value={pct(m?.excess_return)} />
          <Stat label={`Rank in competition ${d.metrics?.competition ?? ""}`} value={m?.rank_in_competition ?? "–"} />
        </div>
      </div>
      {!m?.as_of && <Notice kind="warn">Your portfolio will be valued after the first engine run following {date(d.settings.start_date)}.</Notice>}

      <div className="card">
        <h3>Sub-portfolios by currency</h3>
        <p className="muted small">Cash can be negative: shorts and purchases are financed in the currency of the stock (no margin, no interest). Totals are converted at the ECB reference rate.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Currency</th><th className="num">Cash</th><th className="num">Positions</th><th className="num">Total (local)</th><th className="num">ECB rate</th><th className="num">Total (EUR)</th></tr></thead>
            <tbody>
              {d.subs.map((s: any) => (
                <tr key={s.currency}>
                  <td>{s.currency}</td><td className="num">{num(s.cash_local)}</td><td className="num">{num(s.positions_value_local)}</td>
                  <td className="num">{num(s.total_local)}</td><td className="num">{num(s.fx_rate, 4)}</td><td className="num">{eur(s.total_eur)}</td>
                </tr>
              ))}
            </tbody>
            {d.subs.length > 0 && <tfoot><tr><td colSpan={5}>Total = NAV</td><td className="num">{eur(subsTotal)}</td></tr></tfoot>}
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Open positions</h3>
        {open.length === 0 ? <p className="muted">No open positions.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Stock</th><th>Side</th><th className="num">Quantity</th><th>Ccy</th><th>Entry</th><th className="num">Entry price</th><th className="num">Last price</th><th className="num">Value (EUR)</th><th className="num">P&amp;L (local)</th><th className="num">P&amp;L (EUR)</th><th className="num">Stop level</th></tr></thead>
              <tbody>
                {open.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.symbol}</b><div className="muted small">{d.instruments[p.symbol]?.name}</div></td>
                    <td><span className={`badge ${p.side}`}>{p.side}</span></td>
                    <td className="num">{num(p.quantity, 0)}</td><td>{p.currency}</td><td>{date(p.entry_date)}</td>
                    <td className="num">{num(p.entry_price, 4)}</td><td className="num">{num(p.last_price, 4)}</td>
                    <td className="num">{eur(p.value_eur)}</td>
                    <td className={`num ${signClass(p.pnl_local)}`}>{num(p.pnl_local)}</td>
                    <td className={`num ${signClass(p.pnl_eur)}`}>{eur(p.pnl_eur)}</td>
                    <td className="num">{p.side === "short" ? num(Number(p.entry_price) * (1 + Number(d.settings.stop_threshold)), 4) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Your portfolio vs MSCI World</h3>
        <LineChart
          title="Total return of the team compared with the MSCI World"
          yFormat={(v) => pct(v, 1)}
          series={[
            { name: "Your team", color: "#1f4e8c", points: d.nav.map((n: any) => ({ x: n.date, y: Number(n.nav_eur) / cap - 1 })) },
            { name: "MSCI World (SWDA)", color: "#5b6676", dashed: true, points: d.bench.map((b: any) => ({ x: b.date, y: Number(b.value_eur) / cap - 1 })) },
          ]}
        />
      </div>
    </>
  );
}

function Orders({ d, reload }: { d: any; reload: () => Promise<void> }) {
  const om = d.openMonth;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [sel, setSel] = useState<{ symbol: string; name: string; exchange: string; currency: string; lastPrice: number | null } | null>(null);
  const [action, setAction] = useState<"open" | "change" | "close">("open");
  const [side, setSide] = useState<"long" | "short">("long");
  const [qty, setQty] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tc, setTc] = useState("USD");
  const [ta, setTa] = useState("");

  const held = useMemo(() => {
    const m = new Map<string, { side: string; quantity: number; pending: boolean }>();
    for (const p of d.positions as Position[]) if (!p.exit_date) m.set(p.symbol, { side: p.side, quantity: Number(p.quantity), pending: false });
    const earlier = (d.orders as Order[]).filter((o) => o.status === "pending" && om && o.month_n < om.n).sort((a, b) => a.month_n - b.month_n);
    for (const o of earlier) {
      if (o.action === "close") m.delete(o.symbol);
      else m.set(o.symbol, { side: o.side!, quantity: Number(o.target_quantity), pending: true });
    }
    return m;
  }, [d, om]);

  const thisMonth: Order[] = om ? d.orders.filter((o: Order) => o.month_n === om.n && o.status === "pending") : [];
  const transfers: Transfer[] = om ? d.transfers.filter((t: Transfer) => t.month_n === om.n && t.status === "pending") : [];

  async function search() {
    if (!query.trim()) return;
    setBusy(true); setMsg(null); setResults(null);
    try { setResults((await callFunction("market-data", { action: "search", q: query.trim() })).results); }
    catch (e) { setMsg({ kind: "err", text: errText(e) }); }
    setBusy(false);
  }
  async function pick(symbol: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await callFunction("market-data", { action: "validate", symbol });
      setSel({ symbol: r.instrument.symbol, name: r.instrument.name, exchange: r.instrument.exchange, currency: r.instrument.currency, lastPrice: r.lastPrice });
      const h = held.get(r.instrument.symbol);
      setAction(h ? "change" : "open");
      if (h) { setSide(h.side as any); setQty(String(h.quantity)); } else setQty("");
      setResults(null);
    } catch (e) { setMsg({ kind: "err", text: errText(e) }); }
    setBusy(false);
  }
  function prefill(symbol: string, a: "change" | "close") {
    const i = d.instruments[symbol];
    const h = held.get(symbol)!;
    setSel({ symbol, name: i?.name ?? symbol, exchange: i?.exchange ?? "", currency: i?.currency ?? "", lastPrice: null });
    setAction(a); setSide(h.side as any); setQty(String(h.quantity)); setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function submit() {
    if (!sel) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("place_order", {
      p_symbol: sel.symbol, p_action: action, p_side: action === "close" ? null : side, p_quantity: action === "close" ? null : Number(qty),
    });
    setBusy(false);
    if (error) return setMsg({ kind: "err", text: errText(error) });
    setMsg({ kind: "ok", text: `Order saved: ${action} ${action !== "close" ? `${side} ${qty} ` : ""}${sel.symbol}. It will be executed at the close of the first trading day of ${om.label}.` });
    setSel(null); setQty(""); setQuery("");
    await reload();
  }

  if (!om) return <Notice kind="warn">The order window is closed: the challenge has entered its final month or has ended.</Notice>;
  const ccy = sel?.currency ?? "";
  const indicative = sel?.lastPrice && Number(qty) > 0 ? Number(qty) * sel.lastPrice : null;
  const fx = d.fxLatest[ccy];

  return (
    <>
      <Notice kind="warn">
        Orders for <b>{om.label}</b> can be placed, changed or cancelled until <b>{dateTime(om.order_deadline)}</b>. They are executed at the
        closing price of the first trading day of the month on each stock's exchange, with no commissions. A short is closed automatically if the
        price rises {pct(d.settings.stop_threshold, 0).replace("+", "")} above entry: the loss is capped at that level.
      </Notice>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <div className="grid cols-2">
        <div className="card">
          <h3>New order</h3>
          <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <div className="field"><label htmlFor="q">Search a listed stock (name or ticker)</label><input id="q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Eni, ASML, 7203.T" /></div>
            <button type="submit" disabled={busy} style={{ alignSelf: "flex-end" }}>Search</button>
          </form>
          {results && (
            <div className="search-results">
              {results.length === 0 && <div className="small muted" style={{ padding: 10 }}>No listed stocks found.</div>}
              {results.map((r) => (
                <button key={r.symbol} onClick={() => pick(r.symbol)} disabled={busy}>
                  <span><b>{r.symbol}</b> · {r.name}</span><span className="muted small">{r.exchange}</span>
                </button>
              ))}
            </div>
          )}
          {sel && (
            <div className="stack" style={{ marginTop: 16 }}>
              <div><b>{sel.symbol}</b> · {sel.name} <span className="muted small">{sel.exchange} · {sel.currency}{sel.lastPrice ? ` · last ${num(sel.lastPrice, 4)}` : ""}</span></div>
              <div className="seg" role="group" aria-label="Action">
                {(held.has(sel.symbol) ? (["change", "close"] as const) : (["open"] as const)).map((a) => (
                  <button key={a} type="button" className={action === a ? "on" : ""} onClick={() => setAction(a)}>{a === "open" ? "Open" : a === "change" ? "Change" : "Close all"}</button>
                ))}
              </div>
              {action !== "close" && (
                <div className="row">
                  <div className="seg" role="group" aria-label="Side">
                    <button type="button" className={side === "long" ? "on" : ""} onClick={() => setSide("long")}>Long</button>
                    <button type="button" className={side === "short" ? "on" : ""} onClick={() => setSide("short")}>Short</button>
                  </div>
                  <div className="field narrow">
                    <label htmlFor="qty">{action === "change" ? "New total quantity" : "Quantity (shares)"}</label>
                    <input id="qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} />
                  </div>
                </div>
              )}
              {action === "change" && <p className="small muted">Write the quantity you want to hold after the change (e.g. you hold 1,000 and sell 400: write 600). You can also switch side.</p>}
              {indicative !== null && action !== "close" && (
                <p className="small muted">Indicative value: {ccy === "EUR" ? eur(indicative) : <>{num(indicative)} {ccy}{fx ? ` ≈ ${eur(indicative / fx)}` : ""}</>} (final price set at execution).</p>
              )}
              <div className="row">
                <button onClick={submit} disabled={busy || (action !== "close" && !(Number(qty) > 0))}>Save order</button>
                <button className="secondary" onClick={() => setSel(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Pending orders for {om.label}</h3>
          {thisMonth.length === 0 ? <p className="muted">None yet. Positions you do not touch are kept as they are.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Stock</th><th>Action</th><th>Side</th><th className="num">Quantity</th><th /></tr></thead>
              <tbody>{thisMonth.map((o) => (
                <tr key={o.id}><td>{o.symbol}</td><td>{o.action}</td><td>{o.side ? <span className={`badge ${o.side}`}>{o.side}</span> : "–"}</td>
                  <td className="num">{o.target_quantity ? num(o.target_quantity, 0) : "all"}</td>
                  <td><button className="danger small" onClick={async () => { const { error } = await supabase.rpc("cancel_order", { p_id: o.id }); if (error) setMsg({ kind: "err", text: errText(error) }); await reload(); }}>Cancel</button></td></tr>
              ))}</tbody>
            </table></div>
          )}
          <h3 style={{ marginTop: 20 }}>Holdings</h3>
          {held.size === 0 ? <p className="muted">No holdings yet.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Stock</th><th>Side</th><th className="num">Quantity</th><th /></tr></thead>
              <tbody>{[...held].map(([s, h]) => (
                <tr key={s}><td>{s}{h.pending && <span className="badge pending" style={{ marginLeft: 6 }}>pending</span>}</td><td><span className={`badge ${h.side}`}>{h.side}</span></td><td className="num">{num(h.quantity, 0)}</td>
                  <td className="row" style={{ gap: 6 }}><button className="secondary small" onClick={() => prefill(s, "change")}>Change</button><button className="secondary small" onClick={() => prefill(s, "close")}>Close</button></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Currency transfers (optional)</h3>
        <p className="muted small">Convert euro into another currency sub-portfolio at the ECB rate of the first trading day of {om.label} (Art. 3). A negative amount converts back into euro. Not required to buy foreign stocks.</p>
        <div className="row">
          <div className="field narrow"><label htmlFor="tc">Currency</label><select id="tc" value={tc} onChange={(e) => setTc(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field narrow"><label htmlFor="ta">EUR amount</label><input id="ta" inputMode="decimal" value={ta} onChange={(e) => setTa(e.target.value.replace(/[^0-9.\-]/g, ""))} /></div>
          <button style={{ alignSelf: "flex-end" }} disabled={!Number(ta)} onClick={async () => {
            const { error } = await supabase.rpc("place_transfer", { p_currency: tc, p_eur_amount: Number(ta) });
            if (error) setMsg({ kind: "err", text: errText(error) }); else { setTa(""); setMsg({ kind: "ok", text: "Transfer saved." }); }
            await reload();
          }}>Add transfer</button>
        </div>
        {transfers.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}><table>
            <thead><tr><th>Currency</th><th className="num">EUR amount</th><th /></tr></thead>
            <tbody>{transfers.map((t) => (
              <tr key={t.id}><td>{t.currency}</td><td className="num">{num(t.eur_amount)}</td>
                <td><button className="danger small" onClick={async () => { await supabase.rpc("cancel_transfer", { p_id: t.id }); await reload(); }}>Cancel</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function History({ d }: { d: any }) {
  const closed: Position[] = d.positions.filter((p: Position) => p.exit_date);
  return (
    <>
      <div className="card">
        <h3>All orders</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Month</th><th>Stock</th><th>Action</th><th>Side</th><th className="num">Quantity</th><th>Status</th><th>Executed</th><th className="num">Price</th><th>Note</th></tr></thead>
          <tbody>{(d.orders as Order[]).map((o) => (
            <tr key={o.id}><td>{d.months.find((m: any) => m.n === o.month_n)?.label}</td><td>{o.symbol}</td><td>{o.action}</td><td>{o.side ?? "–"}</td>
              <td className="num">{o.target_quantity ? num(o.target_quantity, 0) : "all"}</td><td><span className={`badge ${o.status}`}>{o.status}</span></td>
              <td>{date(o.executed_date)}</td><td className="num">{num(o.executed_price, 4)}</td><td className="small">{o.reject_reason}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="card">
        <h3>Closed positions</h3>
        {closed.length === 0 ? <p className="muted">None yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Stock</th><th>Side</th><th className="num">Quantity</th><th>Entry</th><th className="num">Entry price</th><th>Exit</th><th className="num">Exit price</th><th>Reason</th><th className="num">P&amp;L (local)</th><th className="num">P&amp;L (EUR)</th></tr></thead>
            <tbody>{closed.map((p) => (
              <tr key={p.id}><td>{p.symbol}</td><td><span className={`badge ${p.side}`}>{p.side}</span></td><td className="num">{num(p.quantity, 0)}</td>
                <td>{date(p.entry_date)}</td><td className="num">{num(p.entry_price, 4)}</td><td>{date(p.exit_date)}</td><td className="num">{num(p.exit_price, 4)}</td>
                <td>{p.exit_reason === "stop" ? <span className="badge rejected">stop -50%</span> : p.exit_reason}</td>
                <td className={`num ${signClass(p.pnl_local)}`}>{num(p.pnl_local)}</td><td className={`num ${signClass(p.pnl_eur)}`}>{eur(p.pnl_eur)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <div className="card">
        <h3>Currency transfers</h3>
        {d.transfers.length === 0 ? <p className="muted">None.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Month</th><th>Currency</th><th className="num">EUR amount</th><th>Status</th><th className="num">ECB rate</th><th>Executed</th></tr></thead>
            <tbody>{(d.transfers as Transfer[]).map((t) => (
              <tr key={t.id}><td>{d.months.find((m: any) => m.n === t.month_n)?.label}</td><td>{t.currency}</td><td className="num">{num(t.eur_amount)}</td>
                <td><span className={`badge ${t.status}`}>{t.status}</span></td><td className="num">{num(t.rate, 4)}</td><td>{date(t.executed_date)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function Account() {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  return (
    <div className="card" style={{ maxWidth: 460 }}>
      <h3>Change password</h3>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (p1.length < 10) return setMsg({ kind: "err", text: "Use at least 10 characters." });
        if (p1 !== p2) return setMsg({ kind: "err", text: "The two passwords do not match." });
        const { error } = await supabase.auth.updateUser({ password: p1 });
        if (error) setMsg({ kind: "err", text: error.message }); else { setMsg({ kind: "ok", text: "Password updated." }); setP1(""); setP2(""); }
      }}>
        <div><label htmlFor="p1">New password</label><input id="p1" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></div>
        <div><label htmlFor="p2">Repeat</label><input id="p2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></div>
        <button type="submit">Update password</button>
      </form>
    </div>
  );
}
