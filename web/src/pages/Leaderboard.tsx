import { Fragment, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { must, useLoad } from "../lib/data";
import { dateTime, eur, pct, pctU, plain, signClass } from "../lib/format";
import { Loading, Notice, Tabs } from "../components/ui";
import { LineChart, PALETTE, type Series } from "../components/LineChart";

interface Row {
  team_id: string; name: string; competition: "A" | "B"; university: string | null; nav: number | null;
  total_return: number | null; rank_in_competition: number | null; excess_return: number | null; benchmark_return: number | null;
  volatility: number | null; sharpe: number | null; sortino: number | null; beta: number | null; tracking_error: number | null;
  max_drawdown: number | null; calmar: number | null; operations: number | null; max_weight: number | null; hhi: number | null;
  violations: number | null; months_completed: number | null; as_of: string | null;
}

export default function Leaderboard() {
  const [comp, setComp] = useState<"A" | "B">("A");
  const [open, setOpen] = useState<string | null>(null);
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
    return r.sort((a, b) => (a.rank_in_competition ?? 999) - (b.rank_in_competition ?? 999) || a.name.localeCompare(b.name));
  }, [data, comp]);

  const series: Series[] = useMemo(() => {
    if (!data) return [];
    const top = rows.filter((r) => r.rank_in_competition !== null).slice(0, 5);
    const cap = 1_000_000;
    const s: Series[] = top.map((t, i) => ({
      name: t.name,
      color: PALETTE[i % PALETTE.length],
      points: data.nav.filter((n) => n.team_id === t.team_id).map((n) => ({ x: n.date, y: Number(n.nav_eur) / cap - 1 })),
    }));
    s.push({ name: "MSCI World (SWDA)", color: "#8a94a3", dashed: true, points: data.bench.map((b) => ({ x: b.date, y: Number(b.value_eur) / cap - 1 })) });
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
      <Tabs value={comp} onChange={setComp} items={[["A", "Competition A · University teams"], ["B", "Competition B · International teams"]]} />
      {rows.length === 0 ? (
        <p className="muted">No teams registered in this competition yet.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th><th>Team</th><th className="num">NAV</th><th className="num">Total return</th>
                  <th className="num">vs MSCI World</th><th className="num" title="Annualised, monthly returns">Volatility</th>
                  <th className="num">Sharpe</th><th className="num">Sortino</th><th className="num">Beta</th>
                  <th className="num">Tracking error</th><th className="num">Max drawdown</th><th className="num">Calmar</th>
                  <th className="num">Operations</th><th className="num">Max weight</th><th className="num">HHI</th><th className="num">Violations</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.team_id}>
                  <tr className={`clickable ${r.rank_in_competition === 1 ? "first" : ""}`} onClick={() => setOpen(open === r.team_id ? null : r.team_id)}>
                    <td className="num">{r.rank_in_competition ?? "–"}</td>
                    <td style={{ minWidth: 190 }}><div><b>{r.name}</b></div><div className="muted small">{r.university}</div></td>
                    <td className="num">{eur(r.nav, 0)}</td>
                    <td className={`num ${signClass(r.total_return)}`}>{pct(r.total_return)}</td>
                    <td className={`num ${signClass(r.excess_return)}`}>{pct(r.excess_return)}</td>
                    <td className="num">{na(r.months_completed, 2) ? "n/a" : pctU(r.volatility)}</td>
                    <td className="num">{na(r.months_completed, 2) ? "n/a" : plain(r.sharpe)}</td>
                    <td className="num">{na(r.months_completed, 1) ? "n/a" : plain(r.sortino)}</td>
                    <td className="num">{na(r.months_completed, 2) ? "n/a" : plain(r.beta)}</td>
                    <td className="num">{na(r.months_completed, 2) ? "n/a" : pctU(r.tracking_error)}</td>
                    <td className={`num ${signClass(r.max_drawdown)}`}>{na(r.months_completed, 1) ? "n/a" : pct(r.max_drawdown)}</td>
                    <td className="num">{na(r.months_completed, 1) ? "n/a" : plain(r.calmar)}</td>
                    <td className="num">{r.operations ?? 0}</td>
                    <td className="num">{pctU(r.max_weight)}</td>
                    <td className="num">{plain(r.hhi, 3)}</td>
                    <td className="num">{r.violations ?? 0}</td>
                    <td><button className="secondary small chart-toggle" aria-expanded={open === r.team_id}>{open === r.team_id ? "Hide" : "Chart"}</button></td>
                  </tr>
                  {open === r.team_id && (
                    <tr className="chart-row"><td colSpan={17}>
                      <div className="small muted" style={{ marginBottom: 8 }}>Portfolio value of {r.name} in euro compared with the MSCI World (both start at {eur(1_000_000, 0)})</div>
                      <LineChart
                        title={`Portfolio value of ${r.name}`}
                        yFormat={(v) => eur(v, 0)}
                        series={[
                          { name: r.name, color: "#7aa2ff", points: data.nav.filter((n) => n.team_id === r.team_id).map((n) => ({ x: n.date, y: Number(n.nav_eur) })) },
                          { name: "MSCI World (SWDA)", color: "#8a94a3", dashed: true, points: data.bench.map((b) => ({ x: b.date, y: Number(b.value_eur) })) },
                        ]}
                      />
                    </td></tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Click a team to see the chart of its portfolio value. Ranking by total return in euro (Art. 12). MSCI World return to date: {pct(rows[0]?.benchmark_return)}. Risk metrics use month-end values
            and need {months < 2 ? "at least two completed months (n/a until then)" : `${months} completed months`}. Risk-free rate as set by the organiser.
          </p>
          <div className="card" style={{ marginTop: 20 }}>
            <h3>Performance since the start</h3>
            <LineChart series={series} yFormat={(v) => pct(v, 1)} title="Total return of the top teams compared with the MSCI World" />
          </div>
        </>
      )}
    </>
  );
}
