import { Fragment, useMemo, useState } from "react";
import { callFunction, errText, supabase } from "../lib/supabase";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import JoinTeam from "../components/JoinTeam";
import TeamChat from "../components/TeamChat";
import { loadCalendar, must, useLoad } from "../lib/data";
import { date, dateTime, eur, num, pct, signClass } from "../lib/format";
import { Loading, Notice, RowDetail, Stat, Tabs } from "../components/ui";
import { StockChart } from "../components/StockChart";
import { PortfolioChart } from "../components/PortfolioChart";
import { PracticeBanner } from "../components/PracticeBanner";
import { LinkedIn } from "../components/LinkedIn";
import { ProfileForm } from "./Profile";

interface Position {
  id: number; symbol: string; currency: string; side: "long" | "short"; quantity: number; entry_date: string; entry_price: number;
  exit_date: string | null; exit_price: number | null; exit_reason: string | null; last_price: number | null; value_local: number | null;
  value_eur: number | null; pnl_local: number | null; pnl_eur: number | null;
}
interface Order {
  id: string; month_n: number; symbol: string; action: "open" | "close" | "change"; side: string | null; target_quantity: number | null;
  status: string; reject_reason: string | null; executed_date: string | null; executed_price: number | null; created_at: string;
  exec_date: string | null; cutoff_at: string | null;
}
interface Instrument { symbol: string; name: string | null; exchange: string | null; currency: string }

/** Portfolio area. Teams see their own; the organiser opens any team with teamId and acts for it. */
export default function MyTeam({ teamId }: { teamId?: string } = {}) {
  const auth = useAuth();
  const adminView = !!teamId;
  const t = useLoad(async () => {
    if (!teamId) return auth.team;
    const r = await must(supabase.from("teams").select("id,name,competition,university").eq("id", teamId).single());
    return { ...(r as any), role: "organiser" } as any;
  }, [teamId, auth.team?.id]);
  const team = t.data;
  const [tab, setTab] = useState<"portfolio" | "orders" | "history" | "chat" | "team" | "account">("portfolio");
  const [joinMsg, alertMsg] = useState<string | null>(null);
  const q = useLoad(async () => {
    if (!team) return null;
    const [cal, pos, sub, orders, nav, bench, met, instr, fx] = await Promise.all([
      loadCalendar(),
      must(supabase.from("positions").select("*").eq("team_id", team.id).order("entry_date")),
      must(supabase.from("subportfolios").select("*").eq("team_id", team.id)),
      must(supabase.from("orders").select("*").eq("team_id", team.id).order("created_at", { ascending: false })),
      must(supabase.from("nav_daily").select("date,nav_eur").eq("team_id", team!.id).order("date")),
      must(supabase.from("benchmark_daily").select("date,value_eur").order("date")),
      supabase.from("leaderboard").select("*").eq("team_id", team!.id).maybeSingle(),
      must(supabase.from("instruments").select("symbol,name,exchange,currency,last_price,last_price_at")),
      must(supabase.from("fx_rates").select("currency,date,rate").order("date", { ascending: false }).limit(400)),
    ]);
    const fxLatest: Record<string, number> = { EUR: 1 };
    for (const r of fx as any[]) if (!(r.currency in fxLatest)) fxLatest[r.currency] = Number(r.rate);
    return {
      ...cal,
      positions: pos as Position[],
      subs: sub as any[],
      orders: orders as Order[],
      nav: nav as any[],
      bench: bench as any[],
      metrics: met.data as any,
      instruments: Object.fromEntries((instr as Instrument[]).map((i) => [i.symbol, i])) as Record<string, Instrument>,
      fxLatest,
      teamId: team.id,
      adminView,
    };
  }, [team?.id]);

  if (t.error || q.error) return <Notice kind="err">{t.error ?? q.error}</Notice>;
  if (!team || !q.data) return <Loading />;
  const d = q.data;

  return (
    <>
      {!adminView && (auth.teams.length > 1 || !auth.teams.some((x) => x.competition === "C")) && (
        <div className="team-switch" role="tablist" aria-label="Your teams">
          {auth.teams.map((x) => (
            <button key={x.id} role="tab" aria-selected={x.id === team.id} className={x.id === team.id ? "on" : ""} onClick={() => auth.setActiveTeam(x.id)}>
              <span className="ts-comp">{x.competition}</span><span className="ts-name">{x.competition === "C" ? "My portfolio" : x.name}</span>
            </button>
          ))}
          {!auth.teams.some((x) => x.competition === "C") && (
            <button type="button" className="ts-join" title="Open your personal € 1,000,000 portfolio (Competition C)" onClick={async () => {
              const { data, error } = await supabase.rpc("join_competition_c");
              if (error) return alertMsg(errText(error));
              await auth.refresh();
              if ((data as any)?.teamId) auth.setActiveTeam((data as any).teamId);
            }}>
              <span className="ts-comp">C</span><span className="ts-name">+ Individual portfolio</span>
            </button>
          )}
        </div>
      )}
      {joinMsg && <Notice kind="err">{joinMsg}</Notice>}
      <div className="page-head">
        <div className="eyebrow">Competition {team.competition} · {adminView ? "organiser view" : team.competition === "C" ? "individual portfolio" : team.role}</div>
        <h1>{team.name}</h1>
        {adminView && <p className="muted small" style={{ marginTop: 8 }}>You are acting for this team: orders you place here are recorded in its name. <Link to="/admin">Back to the admin panel</Link></p>}
      </div>
      <PracticeBanner />
      <Tabs value={team.competition === "C" && (tab === "chat" || tab === "team") ? "portfolio" : tab} onChange={setTab} items={([
        ["portfolio", "Portfolio"], ["orders", "Orders"], ["history", "History"], ["chat", "Chat"], ["team", "Team"], ["account", "Account"],
      ] as [typeof tab, string][]).filter(([k]) => !(adminView && k === "account") && !(team.competition === "C" && (k === "chat" || k === "team")))} />
      {(tab === "portfolio" || (team.competition === "C" && (tab === "chat" || tab === "team"))) && <Portfolio d={d} />}
      {tab === "orders" && <Orders d={d} reload={q.reload} />}
      {tab === "history" && <History d={d} />}
      {tab === "chat" && team.competition !== "C" && <TeamChat key={team.id} teamId={team.id} teamName={team.name} />}
      {tab === "team" && team.competition !== "C" && <TeamTab key={team.id} teamId={team.id} admin={adminView} />}
      {tab === "account" && <Account />}
    </>
  );
}

function Portfolio({ d }: { d: any }) {
  const open: Position[] = d.positions.filter((p: Position) => !p.exit_date);
  const [chart, setChart] = useState<number | null>(null);
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
        <p className="muted small">Cash can be negative: shorts and purchases are financed in the currency of the stock (no margin, no interest). Each currency is a separate sub-portfolio: no conversion between currencies. The euro totals are indicative, at the ECB reference rate of the day.</p>
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
              <thead><tr><th>Stock</th><th>Side</th><th className="num">Quantity</th><th>Ccy</th><th>Entry</th><th className="num">Entry price</th><th className="num">Last price</th><th className="num">Value (EUR)</th><th className="num">P&amp;L (local)</th><th className="num">P&amp;L (EUR)</th><th className="num">Stop level</th><th /></tr></thead>
              <tbody>
                {open.map((p) => (
                  <Fragment key={p.id}>
                  <tr className="clickable" onClick={() => setChart(chart === p.id ? null : p.id)}>
                    <td><b>{p.symbol}</b><div className="muted small">{d.instruments[p.symbol]?.name}</div></td>
                    <td><span className={`badge ${p.side}`}>{p.side}</span></td>
                    <td className="num">{num(p.quantity, 0)}</td><td>{p.currency}</td><td>{date(p.entry_date)}</td>
                    <td className="num">{num(p.entry_price, 4)}</td><td className="num">{num(p.last_price, 4)}</td>
                    <td className="num">{eur(p.value_eur)}</td>
                    <td className={`num ${signClass(p.pnl_local)}`}>{num(p.pnl_local)}</td>
                    <td className={`num ${signClass(p.pnl_eur)}`}>{eur(p.pnl_eur)}</td>
                    <td className="num">{p.side === "short" ? num(Number(p.entry_price) * (1 + Number(d.settings.stop_threshold)), 4) : "–"}</td>
                    <td><button className="secondary small chart-toggle" aria-expanded={chart === p.id}>{chart === p.id ? "Hide chart" : "Chart"}</button></td>
                  </tr>
                  {chart === p.id && (
                    <tr className="chart-row"><td colSpan={12}><RowDetail><StockChart symbol={p.symbol} entryPrice={Number(p.entry_price)} entryDate={p.entry_date} side={p.side} /></RowDetail></td></tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Your portfolio value vs MSCI World</h3>
        <PortfolioChart
          title="Total return of the team compared with the MSCI World"
          yFormat={(v) => pct(v, 1)}
          series={[
            { name: "Your team", color: "#7aa2ff", points: d.nav.map((n: any) => ({ x: n.date, y: Number(n.nav_eur) / cap - 1 })) },
            { name: "MSCI World (SWDA)", color: "#8a94a3", dashed: true, benchmark: true, points: d.bench.map((b: any) => ({ x: b.date, y: Number(b.value_eur) / cap - 1 })) },
          ]}
        />
      </div>
    </>
  );
}

const editable = (cutoff: string | null) => !!cutoff && Date.parse(cutoff) > Date.now();
/** What the order does, in plain words. */
function describe(action: string, side: string, qty: string | number, symbol: string, heldSide?: string) {
  if (action === "close") return `${heldSide === "short" ? "Buy back" : "Sell"} all ${symbol}`;
  if (action === "open") return `${side === "short" ? "Sell short" : "Buy"} ${qty} ${symbol}`;
  return `Hold ${qty} ${symbol} ${side === "short" ? "short" : "long"}`;
}

function Orders({ d, reload }: { d: any; reload: () => Promise<void> }) {
  const auth = useAuth();
  const isC = auth.teams.find((x) => x.id === d.teamId)?.competition === "C";
  const sources = auth.teams.filter((x) => x.competition !== "C");
  const [copyMsg, setCopyMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  async function copyFrom(teamId: string, teamName: string) {
    setCopyMsg(null);
    const { data, error } = await supabase.rpc("copy_to_c", { p_source: teamId });
    if (error) return setCopyMsg({ kind: "err", text: errText(error) });
    const r = data as { copied: number; skipped: number; alreadyHeld: number; scale: number };
    const parts = [`${r.copied} ${r.copied === 1 ? "order" : "orders"} created from ${teamName}`];
    if (r.scale < 1) parts.push(`quantities scaled to ${Math.round(r.scale * 100)}% to fit your free budget`);
    if (r.alreadyHeld) parts.push(`${r.alreadyHeld} already in your portfolio`);
    if (r.skipped) parts.push(`${r.skipped} skipped (no price yet or too small)`);
    setCopyMsg({ kind: r.copied ? "ok" : "err", text: r.copied || r.alreadyHeld ? parts.join(" · ") + "." : `No stocks of yours to copy from ${teamName}: copy works with the positions and pending orders you placed there.` });
    await reload();
  }
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [sel, setSel] = useState<{ symbol: string; name: string; exchange: string; currency: string; lastPrice: number | null; closeDate: string | null; fx: number | null } | null>(null);
  const [timing, setTiming] = useState<{ exec_date: string; cutoff_at: string } | null>(null);
  const [action, setAction] = useState<"open" | "change" | "close">("open");
  const [side, setSide] = useState<"long" | "short">("long");
  const [qty, setQty] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // how many different stocks this member holds, against the team's per-member limit
  const usage = useLoad(async () => {
    if (d.adminView) return null;
    const { data } = await supabase.rpc("my_stock_usage", { p_team: d.teamId });
    return data as { used: number; limit: number } | null;
  }, [d.teamId, d.orders.length]);
  // euro invested by this member (long + short) against their share of the team value
  const budget = useLoad(async () => {
    if (d.adminView) return null;
    const { data } = await supabase.rpc("my_budget", { p_team: d.teamId });
    return data as { used: number; limit: number; nav: number; members: number; teamUsed: number } | null;
  }, [d.teamId, d.orders.length]);

  // holdings now, plus the effect of pending orders in the order they were placed
  const held = useMemo(() => {
    const m = new Map<string, { side: string; quantity: number; pending: boolean }>();
    for (const p of d.positions as Position[]) if (!p.exit_date) m.set(p.symbol, { side: p.side, quantity: Number(p.quantity), pending: false });
    const pend = (d.orders as Order[]).filter((o) => o.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const o of pend) {
      if (o.action === "close") m.delete(o.symbol);
      else m.set(o.symbol, { side: o.side!, quantity: Number(o.target_quantity), pending: true });
    }
    return m;
  }, [d]);

  const pending: Order[] = (d.orders as Order[]).filter((o) => o.status === "pending");
  const over = new Date().toISOString().slice(0, 10) > d.settings.end_date;

  async function loadTiming(symbol: string) {
    const { data } = await supabase.rpc("order_timing", { p_symbol: symbol });
    setTiming(Array.isArray(data) && data[0] ? data[0] : null);
  }
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
      setSel({ symbol: r.instrument.symbol, name: r.instrument.name, exchange: r.instrument.exchange, currency: r.instrument.currency, lastPrice: r.lastClose?.close ?? r.lastPrice ?? null, closeDate: r.lastClose?.date ?? null, fx: r.fxRate ?? d.fxLatest[r.instrument.currency] ?? null });
      const h = held.get(r.instrument.symbol);
      setAction(h ? "change" : "open");
      if (h) { setSide(h.side as any); setQty(String(h.quantity)); } else setQty("");
      setResults(null);
      await loadTiming(r.instrument.symbol);
    } catch (e) { setMsg({ kind: "err", text: errText(e) }); }
    setBusy(false);
  }
  function prefill(symbol: string, a: "change" | "close") {
    const i = d.instruments[symbol];
    const h = held.get(symbol)!;
    const pos = (d.positions as Position[]).find((p) => p.symbol === symbol && !p.exit_date);
    const lp = pos?.last_price != null ? Number(pos.last_price) : (i as any)?.last_price != null ? Number((i as any).last_price) : null;
    setSel({ symbol, name: i?.name ?? symbol, exchange: i?.exchange ?? "", currency: i?.currency ?? "", lastPrice: lp, closeDate: pos?.last_price != null ? d.metrics?.as_of ?? null : null, fx: d.fxLatest[i?.currency ?? ""] ?? null });
    setAction(a); setSide(h.side as any); setQty(String(h.quantity)); setMsg(null);
    loadTiming(symbol);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function submit() {
    if (!sel) return;
    setBusy(true); setMsg(null);
    const args = { p_symbol: sel.symbol, p_action: action, p_side: action === "close" ? null : side, p_quantity: action === "close" ? null : Number(qty) };
    const { data, error } = d.adminView
      ? await supabase.rpc("place_order_admin", { p_team: d.teamId, ...args })
      : await supabase.rpc("place_order_in", { p_team: d.teamId, ...args });
    setBusy(false);
    if (error) return setMsg({ kind: "err", text: errText(error) });
    const o = data as Order;
    setMsg({
      kind: "ok",
      text: `Order saved: ${describe(action, side, qty, sel.symbol, held.get(sel.symbol)?.side)}. It will be executed at the closing price of ${date(o.exec_date)}. You can cancel it until ${dateTime(o.cutoff_at)}.`,
    });
    setSel(null); setQty(""); setQuery(""); setTiming(null);
    usage.reload();
    budget.reload();
    await reload();
  }
  async function cancel(fn: "cancel_order", id: string) {
    const { error } = await supabase.rpc(d.adminView ? `${fn}_admin` : fn, { p_id: id });
    setMsg(error ? { kind: "err", text: errText(error) } : { kind: "ok", text: "Cancelled." });
    await reload();
  }

  if (over) return <Notice kind="warn">The challenge has ended: orders are closed.</Notice>;
  const ccy = sel?.currency ?? "";
  const indicative = sel?.lastPrice && Number(qty) > 0 ? Number(qty) * sel.lastPrice : null;
  const fx = sel?.fx ?? d.fxLatest[ccy];
  const indicativeEur = indicative !== null && fx ? indicative / fx : null;
  // euro value of the position this order replaces (a change re-sizes it)
  const curPos = sel ? (d.positions as Position[]).find((p) => p.symbol === sel.symbol && !p.exit_date) : undefined;
  const curEur = curPos?.value_eur != null ? Math.abs(Number(curPos.value_eur)) : 0;

  return (
    <>
      <Notice kind="warn">
        You can trade on any trading day. An order is executed at the <b>closing price of the day you place it</b>, on the stock's own
        exchange, with no commissions. Orders placed after that exchange has closed, or at the weekend, are executed at the close of the next
        trading day. Until the close you can cancel or replace
        an order. A short is closed automatically if the price rises {pct(d.settings.stop_threshold, 0).replace("+", "")} above entry.
      </Notice>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {isC && !d.adminView && sources.length > 0 && (
        <div className="card copy-card" style={{ marginBottom: 20 }}>
          <h3>Copy your picks</h3>
          <p className="muted small">Copy into your individual portfolio the stocks you chose in your teams (your positions and pending orders there), with the same side and quantity. If they do not fit in your free budget, the quantities are scaled down proportionally. Stocks you already hold here are left as they are; you can change everything afterwards.</p>
          {copyMsg && <Notice kind={copyMsg.kind}>{copyMsg.text}</Notice>}
          <div className="row">
            {sources.map((s) => <button key={s.id} type="button" className="secondary" onClick={() => copyFrom(s.id, s.name)}>Copy from {s.competition} · {s.name}</button>)}
          </div>
        </div>
      )}
      <div className="grid cols-2">
        <div className="card">
          <h3>New order</h3>
          {usage.data && usage.data.limit <= 10 && (
            <div className={`stock-quota ${usage.data.used >= usage.data.limit ? "full" : ""}`}>
              <span>Your stocks</span>
              <span className="dots" aria-hidden="true">{Array.from({ length: usage.data.limit }, (_, i) => <i key={i} className={i < usage.data!.used ? "on" : ""} />)}</span>
              <b>{usage.data.used} / {usage.data.limit}</b>
              <span className="muted small">{usage.data.used >= usage.data.limit ? "limit reached: close one to open a new stock" : "different stocks you can hold"}</span>
            </div>
          )}
          {budget.data && (() => {
            const b = budget.data!, used = Number(b.used), limit = Number(b.limit), share = limit > 0 ? Math.min(1, used / limit) : 1;
            return (
              <div className={`budget-meter ${used > limit ? "full" : ""}`}>
                <div className="bm-head">
                  <span>Your budget</span>
                  <b>{eur(used)} / {eur(limit)}</b>
                  <span className="muted small">invested (long + short) · team value {eur(Number(b.nav))} ÷ {b.members} {b.members === 1 ? "member" : "members"}</span>
                </div>
                <div className="bm-bar" aria-hidden="true"><i style={{ width: `${(share * 100).toFixed(1)}%` }} /></div>
              </div>
            );
          })()}
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
              <div><b>{sel.symbol}</b> · {sel.name} <span className="muted small">{sel.exchange} · {sel.currency}</span></div>
              {sel.lastPrice ? (
                <div className="price-ref">
                  <span className="muted small">Previous close{sel.closeDate ? ` (${date(sel.closeDate)})` : ""}</span>
                  <b>{num(sel.lastPrice, sel.lastPrice < 10 ? 4 : 2)} {ccy}</b>
                  {ccy !== "EUR" && fx ? <span>≈ <b>{eur(sel.lastPrice / fx)}</b> per share <span className="muted small">(ECB rate {num(fx, 4)} {ccy} per €)</span></span> : null}
                </div>
              ) : <p className="small muted" style={{ margin: 0 }}>Previous close not available yet: the cost is shown once the first close is stored.</p>}
              <StockChart symbol={sel.symbol} />
              {timing && (
                <p className="small" style={{ margin: 0 }}>
                  Execution at the close of <b>{date(timing.exec_date)}</b>. You can change or cancel it until {dateTime(timing.cutoff_at)}.
                </p>
              )}
              {(() => {
                const h = held.get(sel.symbol);
                if (!h) return (
                  <div className="trade-choices" role="radiogroup" aria-label="Order type">
                    <button type="button" role="radio" aria-checked={side === "long"} className={`trade-choice buy ${side === "long" ? "on" : ""}`} onClick={() => { setAction("open"); setSide("long"); }}>
                      <b>Buy</b><small>Go long: you gain if the price rises</small>
                    </button>
                    <button type="button" role="radio" aria-checked={side === "short"} className={`trade-choice short ${side === "short" ? "on" : ""}`} onClick={() => { setAction("open"); setSide("short"); }}>
                      <b>Sell short</b><small>You gain if the price falls (stop at +{Math.round(Number(d.settings.stop_threshold) * 100)}%)</small>
                    </button>
                  </div>
                );
                const other = h.side === "long" ? "short" : "long";
                return (
                  <>
                    <div className="small">The team holds <span className={`badge ${h.side}`}>{h.side}</span> <b>{num(h.quantity, 0)}</b> shares{h.pending ? " (after pending orders)" : ""}.</div>
                    <div className="trade-choices three" role="radiogroup" aria-label="Order type">
                      <button type="button" role="radio" aria-checked={action === "close"} className={`trade-choice ${action === "close" ? "on" : ""}`} onClick={() => setAction("close")}>
                        <b>{h.side === "short" ? "Buy back all" : "Sell all"}</b><small>Close the position</small>
                      </button>
                      <button type="button" role="radio" aria-checked={action === "change" && side === h.side} className={`trade-choice ${action === "change" && side === h.side ? "on" : ""}`} onClick={() => { setAction("change"); setSide(h.side as any); setQty(String(h.quantity)); }}>
                        <b>Change quantity</b><small>{h.side === "short" ? "Short more or buy back part" : "Buy more or sell part"}</small>
                      </button>
                      <button type="button" role="radio" aria-checked={action === "change" && side === other} className={`trade-choice ${other === "short" ? "short" : "buy"} ${action === "change" && side === other ? "on" : ""}`} onClick={() => { setAction("change"); setSide(other); }}>
                        <b>{other === "short" ? "Switch to short" : "Switch to long"}</b><small>Close and reverse</small>
                      </button>
                    </div>
                  </>
                );
              })()}
              {action !== "close" && (
                <div className="qty-row">
                  <label htmlFor="qty">{action === "change" ? `Shares to hold after the order (${side})` : `Number of shares to ${side === "short" ? "sell short" : "buy"}`}</label>
                  <div className="row" style={{ gap: 8 }}>
                    <input id="qty" className="qty-input" inputMode="numeric" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} />
                    {[10, 100, 1000].map((n) => <button key={n} type="button" className="secondary small" onClick={() => setQty(String(Number(qty || 0) + n))}>+{n}</button>)}
                  </div>
                  {action === "change" && held.get(sel.symbol) && Number(qty) > 0 && side === held.get(sel.symbol)!.side && (
                    <p className="small muted" style={{ margin: "6px 0 0" }}>
                      {Number(qty) > held.get(sel.symbol)!.quantity ? `${side === "short" ? "Sell short" : "Buy"} ${num(Number(qty) - held.get(sel.symbol)!.quantity, 0)} more`
                        : Number(qty) < held.get(sel.symbol)!.quantity ? `${side === "short" ? "Buy back" : "Sell"} ${num(held.get(sel.symbol)!.quantity - Number(qty), 0)}` : "No change"}
                    </p>
                  )}
                </div>
              )}
              {indicative !== null && action !== "close" && (
                <div className="cost-box">
                  <div className="cost-main">
                    <span className="muted small">Estimated amount</span>
                    <b>{indicativeEur !== null ? eur(indicativeEur) : `${num(indicative)} ${ccy}`}</b>
                  </div>
                  <div className="small muted">
                    {num(Number(qty), 0)} shares × {num(sel.lastPrice!, sel.lastPrice! < 10 ? 4 : 2)} {ccy}{ccy !== "EUR" ? ` = ${num(indicative)} ${ccy}` : ""}, at the previous close.
                    The order is executed at the close of {timing ? date(timing.exec_date) : "the execution day"}: the final amount depends on that price.
                  </div>
                  {budget.data && indicativeEur !== null && (() => {
                    const after = Number(budget.data.used) - (action === "change" ? curEur : 0) + indicativeEur;
                    const lim = Number(budget.data.limit);
                    return <div className={`small ${after > lim ? "neg" : ""}`}>Your budget after this order: <b>{eur(after)}</b> of {eur(lim)}{after > lim ? " · over budget: the order will be refused" : ""}</div>;
                  })()}
                </div>
              )}
              <div className="row">
                <button onClick={submit} disabled={busy || (action !== "close" && !(Number(qty) > 0))}>{describe(action, side, qty ? num(Number(qty), 0) : "…", sel.symbol, held.get(sel.symbol)?.side)}</button>
                <button className="secondary" onClick={() => { setSel(null); setTiming(null); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Pending orders</h3>
          {pending.length === 0 ? <p className="muted">None. Positions you do not touch are kept as they are.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Stock</th><th>Action</th><th>Side</th><th className="num">Quantity</th><th className="num">≈ Amount (€)</th><th>Close of</th><th /></tr></thead>
              <tbody>{pending.map((o) => (
                <tr key={o.id}><td>{o.symbol}</td><td>{o.action}</td><td>{o.side ? <span className={`badge ${o.side}`}>{o.side}</span> : "–"}</td>
                  <td className="num">{o.target_quantity ? num(o.target_quantity, 0) : "all"}</td>
                  <td className="num">{(() => {
                    const ins: any = d.instruments[o.symbol];
                    const pos = (d.positions as Position[]).find((p) => p.symbol === o.symbol && !p.exit_date);
                    const px = pos?.last_price != null ? Number(pos.last_price) : ins?.last_price != null ? Number(ins.last_price) : null;
                    const r = d.fxLatest[ins?.currency ?? ""];
                    if (o.action === "close") return pos?.value_eur != null ? eur(Math.abs(Number(pos.value_eur))) : "–";
                    return px && r && o.target_quantity ? eur((Number(o.target_quantity) * px) / r) : "–";
                  })()}</td>
                  <td>{date(o.exec_date)}</td>
                  <td>{editable(o.cutoff_at)
                    ? <button className="danger small" title={`Until ${dateTime(o.cutoff_at)}`} onClick={() => cancel("cancel_order", o.id)}>Cancel</button>
                    : <span className="badge pending" title="The market has closed: the order is executed at that close">locked</span>}</td></tr>
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

    </>
  );
}

function History({ d }: { d: any }) {
  const closed: Position[] = d.positions.filter((p: Position) => p.exit_date);
  const [chart, setChart] = useState<number | null>(null);
  return (
    <>
      <div className="card">
        <h3>All orders</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Placed</th><th>Stock</th><th>Action</th><th>Side</th><th className="num">Quantity</th><th>Status</th><th>Executed</th><th className="num">Price</th><th>Note</th></tr></thead>
          <tbody>{(d.orders as Order[]).map((o) => (
            <tr key={o.id}><td className="small">{dateTime(o.created_at)}</td><td>{o.symbol}</td><td>{o.action}</td><td>{o.side ?? "–"}</td>
              <td className="num">{o.target_quantity ? num(o.target_quantity, 0) : "all"}</td><td><span className={`badge ${o.status}`}>{o.status}</span></td>
              <td>{date(o.executed_date)}</td><td className="num">{num(o.executed_price, 4)}</td><td className="small">{o.reject_reason}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="card">
        <h3>Closed positions</h3>
        {closed.length === 0 ? <p className="muted">None yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Stock</th><th>Side</th><th className="num">Quantity</th><th>Entry</th><th className="num">Entry price</th><th>Exit</th><th className="num">Exit price</th><th>Reason</th><th className="num">P&amp;L (local)</th><th className="num">P&amp;L (EUR)</th><th /></tr></thead>
            <tbody>{closed.map((p) => (
              <Fragment key={p.id}>
              <tr className="clickable" onClick={() => setChart(chart === p.id ? null : p.id)}><td>{p.symbol}</td><td><span className={`badge ${p.side}`}>{p.side}</span></td><td className="num">{num(p.quantity, 0)}</td>
                <td>{date(p.entry_date)}</td><td className="num">{num(p.entry_price, 4)}</td><td>{date(p.exit_date)}</td><td className="num">{num(p.exit_price, 4)}</td>
                <td>{p.exit_reason === "stop" ? <span className="badge rejected">stop -50%</span> : p.exit_reason}</td>
                <td className={`num ${signClass(p.pnl_local)}`}>{num(p.pnl_local)}</td><td className={`num ${signClass(p.pnl_eur)}`}>{eur(p.pnl_eur)}</td>
                <td><button className="secondary small chart-toggle">{chart === p.id ? "Hide chart" : "Chart"}</button></td></tr>
              {chart === p.id && <tr className="chart-row"><td colSpan={11}><RowDetail><StockChart symbol={p.symbol} entryPrice={Number(p.entry_price)} entryDate={p.entry_date} side={p.side} /></RowDetail></td></tr>}
              </Fragment>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function TeamTab({ teamId, admin }: { teamId: string; admin: boolean }) {
  const { teams } = useAuth();
  const q = useLoad(async () => {
    const { data, error } = admin ? await supabase.rpc("team_info_admin", { p_team: teamId }) : await supabase.rpc("team_info_for", { p_team: teamId });
    if (error) throw new Error(error.message);
    return data as { role: string; code: string | null; members: { name: string; role: string; email: string | null; linkedin: string | null; joined: string }[] } | null;
  });
  const [copied, setCopied] = useState(false);
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  const t = q.data;
  return (
    <div className="grid cols-2">
      {(t.role === "president" || t.role === "organiser") && (
        <div className="card dark">
          <div className="eyebrow">Team code</div>
          <h3 style={{ marginTop: 10 }}>Invite your members</h3>
          <p className="muted">Share this code with your association's members: they enter it when they register, or later from their account. Keep it within the team.</p>
          <div className="row" style={{ marginTop: 16 }}>
            <span className="code-big">{t.code ?? "not generated yet"}</span>
            {t.code && (
              <button className="secondary small" onClick={async () => { try { await navigator.clipboard.writeText(t.code!); setCopied(true); } catch { /* the code stays visible */ } }}>
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="card">
        <h3>Members ({t.members.length})</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Role</th>{t.role !== "member" && <th>E-mail</th>}<th>LinkedIn</th><th>Joined</th></tr></thead>
          <tbody>{t.members.map((m, i) => (
            <tr key={i}><td>{m.name}</td><td><span className={`badge ${m.role === "president" ? "president" : ""}`}>{m.role}</span></td>
              {t.role !== "member" && <td className="small">{m.email}</td>}<td><LinkedIn url={m.linkedin} small /></td><td className="small">{date(m.joined)}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="muted small" style={{ marginTop: 12 }}>Every member can place and cancel orders for the team. Add your LinkedIn link in the Account tab. To remove a member, contact the organiser.</p>
      </div>
      <StockLimit teamId={teamId} canEdit={admin || (t.role === "president")} competition={teams.find((x) => x.id === teamId)?.competition ?? null} />
      {!admin && !teams.some((x) => x.competition === "A") && (
        <div className="card"><h3>Your association's team</h3><p className="muted small">You are not in a Competition A team yet: enter the code your president gave you.</p><JoinTeam inline /></div>
      )}
    </div>
  );
}

/** Max different stocks per member: the president of an association team chooses 1–10 ("no limit" = 10); always 10 in Competition B. */
function StockLimit({ teamId, canEdit, competition }: { teamId: string; canEdit: boolean; competition: "A" | "B" | "C" | null }) {
  const q = useLoad(async () => must(supabase.from("teams").select("competition,member_stock_limit").eq("id", teamId).single()) as Promise<any>, [teamId]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  if (!q.data) return null;
  const comp = q.data.competition ?? competition;
  const cur: number | null = q.data.member_stock_limit;
  const eff = comp === "B" ? 10 : Math.min(cur ?? 10, 10);
  return (
    <div className="card">
      <h3>Stocks per member</h3>
      <p className="muted small">Each member can hold at most <b>{eff}</b> different stocks at a time (positions they opened plus their pending orders). {comp === "B" ? "In Competition B the limit is always 10." : "The president chooses the limit, up to 10."}</p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {comp === "A" && canEdit && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field narrow"><label htmlFor="sl">Limit per member</label>
            <select id="sl" value={cur ?? ""} onChange={async (e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              const { error } = await supabase.rpc("set_stock_limit", { p_team: teamId, p_limit: v });
              setMsg(error ? { kind: "err", text: errText(error) } : { kind: "ok", text: `Saved: ${v ?? "no limit (10)"} per member. Positions already open are not affected.` });
              q.reload();
            }}>
              <option value="">No limit (max 10)</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function Account() {
  const { session, refresh } = useAuth();
  const uid = session?.user.id;
  const prof = useLoad(async () => {
    const { data } = await supabase.from("profiles").select("first_name,last_name,linkedin_url").eq("user_id", uid!).maybeSingle();
    return (data ?? { first_name: "", last_name: "", linkedin_url: null }) as { first_name: string; last_name: string; linkedin_url: string | null };
  }, [uid]);
  return (
    <div className="grid cols-2">
      {prof.data ? <ProfileForm initial={prof.data} onSaved={() => { prof.reload(); refresh(); }} /> : <Loading />}
      <PasswordCard />
    </div>
  );
}

function PasswordCard() {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  return (
    <div className="card">
      <h3>Change password</h3>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (p1.length < 8) return setMsg({ kind: "err", text: "Use at least 8 characters." });
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
