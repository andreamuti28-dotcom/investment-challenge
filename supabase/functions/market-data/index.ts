// Stock search and validation for logged-in users.
// Body: { action: "search", q } | { action: "validate", symbol }
import { searchEquities, validateSymbol } from "../_shared/marketdata.ts";
import { caller, cors, env, json, serviceHeaders } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const who = await caller(req);
  if (!who) return json({ error: "Please sign in" }, 401);
  const body = await req.json().catch(() => ({}));
  try {
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
        }),
      });
      if (!r.ok) return json({ error: `Could not save instrument: ${await r.text()}` }, 500);
      return json({ instrument: (await r.json())[0], lastPrice: v.lastPrice });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: `Market data unavailable: ${(e as Error).message}` }, 502);
  }
});
