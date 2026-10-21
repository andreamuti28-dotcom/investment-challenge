// Stock search and validation for logged-in users.
// Body: { action: "search", q } | { action: "validate", symbol } | { action: "history", symbol, from? }
//     | { action: "benchmark", from }  public: the benchmark in euro before the challenge start
import { fetchChart, fetchEcb, searchEquities, validateSymbol } from "../_shared/marketdata.ts";
import { caller, cors, env, json, serviceHeaders } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "benchmark") {
      // public data only (index price and ECB rate), used by the charts before the start date
      const e = env();
      const st = (await (await fetch(`${e.supabaseUrl}/rest/v1/challenge_settings?select=benchmark_symbol,benchmark_currency,start_date&id=eq.1`, { headers: serviceHeaders(e.serviceKey) })).json())[0];
      const min = new Date(Date.now() - 5 * 366 * 86400_000).toISOString().slice(0, 10);
      let from = typeof body.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : min;
      if (from < min) from = min;
      if (from > st.start_date) return json({ points: [] });
      const back = new Date(Date.parse(from + "T00:00:00Z") - 10 * 86400_000).toISOString().slice(0, 10);
      const end = new Date(Date.parse(st.start_date + "T00:00:00Z") + 86400_000);
      const [c, fx] = await Promise.all([fetchChart(st.benchmark_symbol, back), st.benchmark_currency === "EUR" ? null : fetchEcb([st.benchmark_currency], back)]);
      const rates = (fx?.rates ?? []).sort((a, b) => a.date.localeCompare(b.date));
      let j = -1;
      const points: { date: string; eur: number }[] = [];
      for (const p of c.prices) {
        while (j + 1 < rates.length && rates[j + 1].date <= p.date) j++;
        const r = st.benchmark_currency === "EUR" ? 1 : rates[j]?.rate;
        if (!r || p.date > end.toISOString().slice(0, 10)) continue;
        points.push({ date: p.date, eur: p.close / r });
      }
      return json({ symbol: st.benchmark_symbol, start: st.start_date, points: points.filter((p) => p.date >= from) });
    }
    const who = await caller(req);
    if (!who) return json({ error: "Please sign in" }, 401);
    if (body.action === "search") {
      const q = String(body.q ?? "").trim();
      if (q.length < 1) return json({ results: [] });
      return json({ results: await searchEquities(q) });
    }
    if (body.action === "validate") {
      const symbol = String(body.symbol ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9.\-^=]{1,20}$/.test(symbol)) return json({ error: "Invalid symbol" }, 400);
      const v = await validateSymbol(symbol);
      if (v.quoteType !== "EQUITY") {
        return json({ error: `${symbol} is a ${v.quoteType || "non-equity"} instrument: only listed stocks are allowed` }, 400);
      }
      if (!v.currency) return json({ error: `No currency available for ${symbol}` }, 400);
      const e = env();
      const r = await fetch(`${e.supabaseUrl}/rest/v1/instruments?on_conflict=symbol`, {
        method: "POST",
        headers: { ...serviceHeaders(e.serviceKey), Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          symbol: v.symbol,
          name: v.name,
          exchange: v.exchange,
          currency: v.currency,
          price_divisor: v.priceDivisor,
          quote_type: "EQUITY",
          // used to execute orders at the close of the right trading day
          ...(v.timezone ? { exchange_tz: v.timezone } : {}),
          ...(v.closeTime ? { close_time: v.closeTime } : {}),
          // previous close (or the live price), used for the indicative cost and the budget check
          ...(v.lastClose || typeof v.lastPrice === "number"
            ? { last_price: v.lastClose?.close ?? v.lastPrice, last_price_at: new Date().toISOString() } : {}),
        }),
      });
      if (!r.ok) return json({ error: `Could not save instrument: ${await r.text()}` }, 500);
      // a currency never seen before: fetch its ECB rate now, so the order can be valued
      if (v.currency.toUpperCase() !== "EUR") {
        const H = serviceHeaders(e.serviceKey);
        const have = await fetch(`${e.supabaseUrl}/rest/v1/fx_rates?currency=eq.${encodeURIComponent(v.currency.toUpperCase())}&select=date&limit=1`, { headers: H });
        if (have.ok && ((await have.json()) as unknown[]).length === 0) {
          try {
            const fx = await fetchEcb([v.currency], new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10));
            if (fx.rates.length) {
              await fetch(`${e.supabaseUrl}/rest/v1/rpc/upsert_market_data`, {
                method: "POST",
                headers: H,
                body: JSON.stringify({ p: { prices: [], events: [], fx: fx.rates.map((x) => [x.currency, x.date, x.rate]) } }),
              });
            }
          } catch { /* the nightly run fetches it anyway */ }
        }
      }
      let fxRate: number | null = v.currency.toUpperCase() === "EUR" ? 1 : null;
      if (fxRate === null) {
        const q = await fetch(`${e.supabaseUrl}/rest/v1/fx_rates?currency=eq.${encodeURIComponent(v.currency.toUpperCase())}&select=rate,date&order=date.desc&limit=1`, { headers: serviceHeaders(e.serviceKey) });
        const rows = q.ok ? ((await q.json()) as { rate: number; date: string }[]) : [];
        fxRate = rows[0] ? Number(rows[0].rate) : null;
      }
      return json({ instrument: (await r.json())[0], lastPrice: v.lastPrice, lastClose: v.lastClose, fxRate });
    }
    if (body.action === "history") {
      // daily closes for the price chart of a stock (not dividend-adjusted, main currency unit)
      const symbol = String(body.symbol ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9.\-^=]{1,20}$/.test(symbol)) return json({ error: "Invalid symbol" }, 400);
      // up to five years of history; two years by default
      const min = new Date(Date.now() - 5 * 366 * 86400_000).toISOString().slice(0, 10);
      const from = typeof body.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from)
        ? (body.from < min ? min : body.from)
        : new Date(Date.now() - 2 * 366 * 86400_000).toISOString().slice(0, 10);
      const c = await fetchChart(symbol, from);
      return json({ symbol, name: c.name, currency: c.currency, prices: c.prices });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: `Market data unavailable: ${(e as Error).message}` }, 502);
  }
});
