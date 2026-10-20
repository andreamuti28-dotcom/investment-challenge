// Orchestrates one engine run: read inputs, refresh market data, replay, write results,
// notify. Talks to Supabase through PostgREST RPCs with plain fetch, so the same file
// runs inside the Edge Function (Deno) and in the GitHub Actions fallback (Node).
import { type EngineInput, type EngineOutput, addDays, runEngine } from "./core.ts";
import { fetchChart, fetchEcb } from "./marketdata.ts";

export interface RunnerEnv {
  supabaseUrl: string;
  serviceKey: string;
  telegramToken?: string;
  telegramChatId?: string;
}

export async function rpc<T = unknown>(env: RunnerEnv, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // new-style secret keys (sb_secret_...) are not JWTs: send them only as apikey
  const auth: Record<string, string> = env.serviceKey.startsWith("sb_") ? {} : { Authorization: `Bearer ${env.serviceKey}` };
  const r = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: env.serviceKey, ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${txt}`);
  return (txt ? JSON.parse(txt) : null) as T;
}

/** Converts the jsonb returned by engine_input() into the engine's input. */
export function toEngineInput(db: any): EngineInput {
  const s = db.settings;
  const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    settings: {
      capital: Number(s.capital),
      riskFreeAnnual: Number(s.risk_free_annual),
      stopThreshold: Number(s.stop_threshold),
      benchmarkSymbol: s.benchmark_symbol,
      benchmarkCurrency: s.benchmark_currency,
      startDate: s.start_date,
      endDate: s.end_date,
    },
    months: db.months.map((m: any) => ({ n: m.n, startDate: m.start_date, endDate: m.end_date })),
    teams: db.teams.map((t: any) => ({ id: t.id, name: t.name, competition: t.competition, violations: t.violations ?? 0 })),
    instruments: db.instruments.map((i: any) => ({ symbol: i.symbol, currency: i.currency })),
    orders: db.orders.map((o: any) => ({
      id: o.id,
      teamId: o.team_id,
      monthN: o.month_n,
      symbol: o.symbol,
      action: o.action,
      side: o.side,
      quantity: num(o.target_quantity),
      createdAt: o.created_at,
    })),
    transfers: db.transfers.map((t: any) => ({
      id: t.id,
      teamId: t.team_id,
      monthN: t.month_n,
      currency: t.currency,
      eurAmount: Number(t.eur_amount),
      createdAt: t.created_at,
    })),
    prices: db.prices.map((p: any[]) => ({ symbol: p[0], date: p[1], close: Number(p[2]), source: p[3] })),
    events: db.events.map((e: any) => ({ symbol: e.symbol, date: e.date, type: e.type, value: Number(e.value), source: e.source })),
    fx: db.fx.map((f: any[]) => ({ currency: f[0], date: f[1], rate: Number(f[2]), source: f[3] })),
  };
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export function todayIn(tz = "Europe/Rome", now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface RunResult {
  status: "ok" | "warning" | "error";
  asOf: string;
  log: string[];
  warnings: string[];
  summary?: Record<string, number>;
}

export async function runOnce(
  env: RunnerEnv,
  opts: { asOf?: string; skipFetch?: boolean; trigger?: string } = {},
): Promise<RunResult> {
  const log: string[] = [];
  const L = (m: string) => {
    log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
  };
  const warnings: string[] = [];
  let asOf = opts.asOf ?? todayIn();
  try {
    let db = await rpc<any>(env, "engine_input");
    const settings = db.settings;
    const fetchStart = addDays(settings.start_date, -7);

    if (!opts.skipFetch) {
      // symbols in play: any non-cancelled order + benchmark
      const symbols = [...new Set<string>([...db.orders.map((o: any) => o.symbol), settings.benchmark_symbol])];
      const divisorOf = new Map(db.instruments.map((i: any) => [i.symbol, Number(i.price_divisor)]));
      const prices: unknown[] = [], events: unknown[] = [];
      let failed = 0;
      await pool(symbols, 6, async (sym) => {
        const last = db.last_yahoo?.[sym];
        const from = last && addDays(last, -10) > fetchStart ? addDays(last, -10) : fetchStart;
        try {
          const c = await fetchChart(sym, from);
          const expected = divisorOf.get(sym);
          if (expected !== undefined && expected !== c.divisor) {
            warnings.push(`${sym}: Yahoo quote unit changed (divisor ${c.divisor} vs ${expected}), check manually`);
          }
          for (const p of c.prices) if (p.date >= fetchStart) prices.push([sym, p.date, p.close]);
          for (const d of c.dividends) if (d.date >= fetchStart) events.push([sym, d.date, "dividend", d.value]);
          for (const s of c.splits) if (s.date >= fetchStart) events.push([sym, s.date, "split", s.value]);
        } catch (e) {
          failed++;
          warnings.push(`Yahoo: ${sym} not updated (${(e as Error).message})`);
        }
      });
      L(`Yahoo: ${symbols.length - failed}/${symbols.length} symbols, ${prices.length} prices, ${events.length} events`);

      const ccys = new Set<string>([settings.benchmark_currency]);
      for (const i of db.instruments) ccys.add(i.currency);
      for (const t of db.transfers) ccys.add(t.currency);
      ccys.delete("EUR");
      const lastEcb = Object.values(db.last_ecb ?? {}) as string[];
      const ecbFrom = lastEcb.length ? addDays(lastEcb.sort()[0], -10) : addDays(settings.start_date, -14);
      let fx: unknown[] = [];
      try {
        const r = await fetchEcb([...ccys], ecbFrom < addDays(settings.start_date, -14) ? addDays(settings.start_date, -14) : ecbFrom);
        fx = r.rates.map((x) => [x.currency, x.date, x.rate]);
        for (const m of r.missing) warnings.push(`ECB does not publish ${m}: insert manual rates (Art. 14)`);
        L(`ECB: ${fx.length} rates for ${[...ccys].join(", ") || "-"}`);
      } catch (e) {
        warnings.push(`ECB not updated (${(e as Error).message})`);
      }
      const up = await rpc<any>(env, "upsert_market_data", { p: { prices, events, fx } });
      L(`stored: ${JSON.stringify(up)}`);
      db = await rpc<any>(env, "engine_input");
    }

    const input = toEngineInput(db);
    if (asOf > input.settings.endDate) asOf = input.settings.endDate;
    const out: EngineOutput = runEngine(input, asOf);
    warnings.push(...out.warnings);
    const executed = out.orderUpdates.filter((o) => o.status === "executed").length;
    const stops = out.positions.filter((p) => p.exitReason === "stop").length;
    L(`replay as of ${asOf}: ${input.teams.length} teams, ${out.positions.length} positions, ${executed} orders executed, ${stops} stop-outs`);

    await rpc(env, "engine_write", { p: out });
    L("results written");
    const status = warnings.length ? "warning" : "ok";
    await rpc(env, "engine_log", {
      p_status: status,
      p_as_of: asOf,
      p_trigger: opts.trigger ?? "manual",
      p_log: log.join("\n"),
      p_warnings: warnings,
    });
    const res: RunResult = { status, asOf, log, warnings, summary: { teams: input.teams.length, executed, stops } };
    await notify(env, res);
    return res;
  } catch (e) {
    L(`ERROR ${(e as Error).message}`);
    try {
      await rpc(env, "engine_log", { p_status: "error", p_as_of: asOf, p_trigger: opts.trigger ?? "manual", p_log: log.join("\n"), p_warnings: warnings });
    } catch { /* ignore */ }
    const res: RunResult = { status: "error", asOf, log, warnings };
    await notify(env, res);
    return res;
  }
}

async function notify(env: RunnerEnv, r: RunResult) {
  if (!env.telegramToken || !env.telegramChatId) return;
  const icon = r.status === "ok" ? "OK" : r.status === "warning" ? "WARNING" : "ERROR";
  const lines = [
    `Investment Challenge engine: ${icon}`,
    `As of ${r.asOf}`,
    r.summary ? `Teams ${r.summary.teams} | orders executed ${r.summary.executed} | stop-outs ${r.summary.stops}` : "",
    ...r.warnings.slice(0, 15).map((w) => `- ${w}`),
    r.warnings.length > 15 ? `... and ${r.warnings.length - 15} more (see Admin > Engine runs)` : "",
    r.status === "error" ? r.log.at(-1) ?? "" : "",
  ].filter(Boolean);
  try {
    await fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.telegramChatId, text: lines.join("\n").slice(0, 4000) }),
    });
  } catch { /* notifications are best effort */ }
}
