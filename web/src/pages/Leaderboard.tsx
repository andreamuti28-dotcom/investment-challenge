import { Fragment, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { must, useLoad } from "../lib/data";
import { dateTime, eur, pct, pctU, plain, signClass } from "../lib/format";
import { Loading, Notice, RowDetail, Tabs } from "../components/ui";
import { PALETTE, type Series } from "../components/LineChart";
import { PortfolioChart } from "../components/PortfolioChart";
import { TeamHoldings } from "../components/TeamHoldings";
import { PracticeBanner } from "../components/PracticeBanner";

interface Row {
  team_id: string; name: string; competition: "A" | "B" | "C"; university: string | null; nav: number | null;
  total_return: number | null; rank_in_competition: number | null; excess_return: number | null; benchmark_return: number | null;
  volatility: number | null; sharpe: number | null; sortino: number | null; beta: number | null; tracking_error: number | null;
  max_drawdown: number | null; calmar: number | null; operations: number | null; max_weight: number | null; hhi: number | null;
  violations: number | null; months_completed: number | null; as_of: string | null; invested_share: number | null;
}

type SortKey = "nav" | "total_return" | "excess_return" | "volatility" | "sharpe" | "sortino" | "beta" | "max_drawdown" | "calmar" | "operations" | "max_weight" | "hhi" | "violations" | "invested_share";
const COLS: [SortKey, string, string][] = [
  ["nav", "NAV", "Portfolio value in euro"],
  ["total_return", "Total return", "Official ranking metric (Art. 12)"],
  ["excess_return", "vs MSCI World", "Total return minus the MSCI World return"],
  ["volatility", "Volatility", "Annualised, from monthly returns"],
  ["sharpe", "Sharpe", "Excess return per unit of risk"],
  ["sortino", "Sortino", "Excess return per unit of downside risk"],
  ["beta", "Beta", "Sensitivity to the MSCI World"],
  ["max_drawdown", "Max drawdown", "Worst fall from a peak (closer to 0 is better)"],
  ["calmar", "Calmar", "Annualised return / max drawdown"],
  ["operations", "Operations", "Orders executed"],
  ["max_weight", "Max weight", "Largest position as % of the portfolio"],
  ["hhi", "HHI", "Concentration (Herfindahl index)"],
  ["violations", "Violations", "Rule violations recorded by the organiser"],
  ["invested_share", "Invested", "Long + short positions as % of the portfolio value"],
];

export default function Leaderboard() {
  const [comp, setComp] = useState<"A" | "B" | "C">("A");
  const [open, setOpen] = useState<string | null>(null);
  // ranking metric: highest first by default; click again to reverse
  const [sortKey, setSortKey] = useState<SortKey>("total_return");
  const [desc, setDesc] = useState(true);
  const sortBy = (k: SortKey) => { if (k === sortKey) setDesc(!desc); else { setSortKey(k); setDesc(true); } };
  const { data, error } = useLoad(async () => {
    const [rows, run, nav, bench] = await Promise.all([
      must(supabase.from("leaderboard").select("*")),
      supabase.from("last_engine_run").select("*").maybeSingle(),
      must(supabase.from("nav_daily").select("team_id,date,nav_eur").order("date").limit(20000)),
      must(supabase.from("benchmark_daily").select("date,value_eur").order("date")),
    ]);
    return { rows: rows as Row[], run: run.data as any, nav: nav as any[], bench: bench as any[] };
  });

  const rows = useMemo(() => {
    const r = (data?.rows ?? []).filter((x) => x.competition === comp);
    const val = (x: Row) => { const v = x[sortKey]; return v === null || v === undefined ? null : Number(v); };
    return r.sort((a, b) => {
      // Competition C: portfolios not ranked (less than half invested) always after the ranked ones
      if (comp === "C" && (a.rank_in_competition === null) !== (b.rank_in_competition === null)) return a.rank_in_competition === null ? 1 : -1;
      const va = val(a), vb = val(b);
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1; // teams without a value always at the bottom
      if (vb === null) return -1;
      return (desc ? vb - va : va - vb) || a.name.localeCompare(b.name);
    });
  }, [data, comp, sortKey, desc]);

  const series: Series[] = useMemo(() => {
    if (!data) return [];
    const top = rows.filter((r) => r.rank_in_competition !== null).slice(0, 5);
    const cap = 1_000_000;
    const s: Series[] = top.map((t, i) => ({
      name: t.name,
      color: PALETTE[i % PALETTE.length],
      points: data.nav.filter((n) => n.team_id === t.team_id).map((n) => ({ x: n.date, y: Number(n.nav_eur) / cap - 1 })),
    }));
    s.push({ name: "MSCI World (SWDA)", color: "#8a94a3", dashed: true, benchmark: true, points: data.bench.map((b) => ({ x: b.date, y: Number(b.value_eur) / cap - 1 })) });
    return s;
  }, [data, rows]);

  if (error) return <Notice kind="err">{error}</Notice>;
  if (!data) return <Loading />;
  const na = (n: number | null | undefined, need: number) => (n ?? 0) < need;
  const months = rows[0]?.months_completed ?? 0;

  return (
    <>
      <div className="row spread page-head">
        <div>
          <div className="eyebrow">Leaderboard</div>
          <h1>Return decides. Risk explains.</h1>
        </div>
        <p className="muted small">Last update: {data.run ? dateTime(data.run.finished_at) : "not yet calculated"}{data.run?.as_of ? ` · prices as of ${data.run.as_of}` : ""}</p>
      </div>
      <PracticeBanner />
      <Tabs value={comp} onChange={setComp} items={[["A", "Competition A · Association teams"], ["B", "Competition B · International teams"], ["C", "Competition C · Individual"]]} />
      {rows.length === 0 ? (
        <p className="muted">No teams registered in this competition yet.</p>
      ) : (
        <>
          <div className="rank-by">
            <label htmlFor="rankby">Rank by</label>
            <select id="rankby" value={sortKey} onChange={(e) => { setSortKey(e.target.value as SortKey); setDesc(true); }}>
              {COLS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <button type="button" className="secondary small" onClick={() => setDesc(!desc)} aria-label="Reverse order">{desc ? "Highest first ↓" : "Lowest first ↑"}</button>
          </div>
          <div className="table-wrap">
            <table className="sticky-2">
              <thead>
                <tr>
                  <th className="num">#</th><th>Team</th>
                  {COLS.map(([k, label, title]) => (
                    <th key={k} className={`num sortable ${sortKey === k ? "sorted" : ""}`} title={title} aria-sort={sortKey === k ? (desc ? "descending" : "ascending") : "none"}>
                      <button type="button" onClick={() => sortBy(k)}>{label}<span className="arrow" aria-hidden="true">{sortKey === k ? (desc ? "↓" : "↑") : "↕"}</span></button>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Fragment key={r.team_id}>
                  <tr className={`clickable ${i === 0 && r[sortKey] !== null ? "first" : ""}`} onClick={() => setOpen(open === r.team_id ? null : r.team_id)}>
                    <td className="num">{comp === "C" && r.rank_in_competition === null ? <span className="not-ranked" title="Less than 50% of the portfolio invested">–</span> : i + 1}</td>
                    <td style={{ minWidth: 190 }}><div><b>{r.name}</b></div><div className="muted small">{r.university}{comp === "C" && r.rank_in_competition === null ? " · not ranked: less than 50% invested" : ""}</div></td>
                    <td className="num">{eur(r.nav, 0)}</td>
                    <td className={`num strong ${signClass(r.total_return)}`}>{pct(r.total_return)}</td>
                    <td className={`num ${signClass(r.excess_return)}`}>{pct(r.excess_return)}</td>
                    <td className="num">{na(r.months_completed, 2) ? "n/a" : pctU(r.volatility)}</td>
                    <td className="num">{na(r.months_completed, 2) ? "n/a" : plain(r.sharpe)}</td>
                    <td className="num">{na(r.months_completed, 1) ? "n/a" : plain(r.sortino)}</td>
                    <td className="num">{na(r.months_completed, 2) ? "n/a" : plain(r.beta)}</td>
                    <td className={`num ${signClass(r.max_drawdown)}`}>{na(r.months_completed, 1) ? "n/a" : pct(r.max_drawdown)}</td>
                    <td className="num">{na(r.months_completed, 1) ? "n/a" : plain(r.calmar)}</td>
                    <td className="num">{r.operations ?? 0}</td>
                    <td className="num">{pctU(r.max_weight)}</td>
                    <td className="num">{plain(r.hhi, 3)}</td>
                    <td className="num">{r.violations ?? 0}</td>
                    <td className="num">{pctU(r.invested_share)}</td>
                    <td><button className="secondary small chart-toggle" aria-expanded={open === r.team_id}>{open === r.team_id ? "Hide" : "Details"}</button></td>
                  </tr>
                  {open === r.team_id && (
                    <tr className="chart-row"><td colSpan={17}><RowDetail>
                      <div className="small muted" style={{ marginBottom: 8 }}>Portfolio value of {r.name} in euro compared with the MSCI World (both start at {eur(1_000_000, 0)})</div>
                      <PortfolioChart mode="value"
                        title={`Portfolio value of ${r.name}`}
                        yFormat={(v) => `€ ${(v / 1e6).toFixed(Math.abs(v) >= 1e7 ? 1 : 3)}M`}
                        series={[
                          { name: r.name, color: "#7aa2ff", points: data.nav.filter((n) => n.team_id === r.team_id).map((n) => ({ x: n.date, y: Number(n.nav_eur) })) },
                          { name: "MSCI World (SWDA)", color: "#8a94a3", dashed: true, benchmark: true, points: data.bench.map((b) => ({ x: b.date, y: Number(b.value_eur) })) },
                        ]}
                      />
                      <h3 style={{ margin: "18px 0 8px" }}>Positions of {r.name}</h3>
                      <TeamHoldings teamId={r.team_id} />
                    </RowDetail></td></tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Click a team to see its portfolio chart and every position it holds, with its performance.{comp === "C" ? " In Competition C a portfolio is ranked only when at least 50% of its value is invested (long + short), so that keeping the cash cannot win." : ""} The official ranking is by total return in euro (Art. 12); click any column to rank the teams by that metric (click again to reverse). MSCI World return to date: {pct(rows[0]?.benchmark_return)}. Risk metrics use month-end values
            and need {months < 2 ? "at least two completed months (n/a until then)" : `${months} completed months`}. Risk-free rate as set by the organiser.
          </p>
          <div className="card" style={{ marginTop: 20 }}>
            <h3>Performance since the start</h3>
            <PortfolioChart series={series} yFormat={(v) => pct(v, 1)} title="Total return of the top teams compared with the MSCI World" />
          </div>
        </>
      )}
    </>
  );
}
