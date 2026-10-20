// Engine endpoint. Called by pg_cron (header x-engine-secret) or by an admin from the
// Admin panel. Body: { asOf?: "YYYY-MM-DD", skipFetch?: boolean, selftest?: boolean }
// { probe: true } is public and only reports whether Yahoo Finance and the ECB answer.
import { rpc, runOnce } from "../_shared/runner.ts";
import { runSelfTest } from "../_shared/selftest.ts";
import { fetchChart, fetchEcb } from "../_shared/marketdata.ts";
import { caller, cors, env, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  if (body.probe) {
    const from = new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10);
    const out: Record<string, unknown> = {};
    for (const s of ["SWDA.L", "VOD.L", "AAPL", "ENI.MI"]) {
      try {
        const c = await fetchChart(s, from);
        out[s] = { ok: true, currency: c.currency, last: c.prices.at(-1) };
      } catch (e) {
        out[s] = { ok: false, error: (e as Error).message };
      }
    }
    try {
      const r = await fetchEcb(["USD", "GBP"], from);
      out.ecb = { ok: r.rates.length > 0, last: r.rates.at(-1) };
    } catch (e) {
      out.ecb = { ok: false, error: (e as Error).message };
    }
    return json(out);
  }
  // scheduled calls carry the secret kept in Supabase Vault (or the ENGINE_SECRET env, if set)
  const sent = req.headers.get("x-engine-secret");
  const envSecret = Deno.env.get("ENGINE_SECRET");
  let trigger = "cron";
  let trusted = false;
  if (sent) {
    trusted = (!!envSecret && sent === envSecret) ||
      (await rpc<boolean>(env(), "verify_engine_secret", { p: sent }).catch(() => false)) === true;
  }
  if (!trusted) {
    const who = await caller(req);
    if (!who?.admin) return json({ error: "unauthorized" }, 401);
    trigger = `admin:${who.email}`;
  }
  if (body.selftest) return json(runSelfTest());
  const e = env();
  if (!e.supabaseUrl || !e.serviceKey) return json({ error: "missing SUPABASE_URL or service key" }, 500);
  const res = await runOnce(e, {
    asOf: typeof body.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ? body.asOf : undefined,
    skipFetch: !!body.skipFetch,
    trigger,
  });
  return json(res, res.status === "error" ? 500 : 200);
});
