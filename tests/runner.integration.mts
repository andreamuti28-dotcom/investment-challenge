import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { runOnce } from "../supabase/functions/_shared/runner.ts";

const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb); create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
for (const m of ["20261020000000_init.sql", "20261020120000_daily_close_access_codes.sql", "20261020150000_president_member.sql", "20261020160000_calendar_from_dates.sql", "20261020170000_admin_orders.sql", "20261020180000_no_currency_transfers.sql", "20261020190000_public_positions.sql", "20261020200000_edition_password_requests.sql", "20261020210000_mail_key_vault.sql", "20261020220000_self_registration.sql"]) {
  await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
}
await db.exec(`grant usage on schema public to service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
  insert into teams (id,name,competition) values ('10000000-0000-0000-0000-000000000001','Bicocca','A'),('10000000-0000-0000-0000-000000000002','Leon','B');
  insert into instruments (symbol,currency,price_divisor) values ('AAPL','USD',1),('XYZ.MI','EUR',1),('ENI.MI','EUR',1),('VOD.L','GBP',100);
  insert into orders (team_id,month_n,symbol,action,side,target_quantity,created_at) values
   ('10000000-0000-0000-0000-000000000001',1,'AAPL','open','long',100,'2026-11-20'),
   ('10000000-0000-0000-0000-000000000001',1,'XYZ.MI','open','short',1000,'2026-11-20'),
   ('10000000-0000-0000-0000-000000000001',2,'XYZ.MI','close',null,null,'2026-12-20'),
   ('10000000-0000-0000-0000-000000000002',2,'ENI.MI','open','long',1000,'2026-12-20'),
   ('10000000-0000-0000-0000-000000000002',1,'VOD.L','open','long',100,'2026-11-20');
  insert into transfer_orders (team_id,month_n,currency,eur_amount) values ('10000000-0000-0000-0000-000000000002',1,'USD',10000);
  insert into corporate_events values ('AAPL','2027-01-20','dividend',1,'manual');`);

// fake PostgREST: /rest/v1/rpc/<fn> executed as service_role
const srv = createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const fn = req.url!.split("/rpc/")[1];
  const args = JSON.parse(body || "{}");
  const names = Object.keys(args);
  try {
    await db.exec("set role service_role");
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(",")}) as r`;
    const vals = names.map((n) => (typeof args[n] === "object" && args[n] !== null ? JSON.stringify(args[n]) : args[n]));
    const r = await db.query(sql, vals);
    await db.exec("reset role");
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify((r.rows[0] as any).r ?? null));
  } catch (e) { await db.exec("reset role"); res.writeHead(400); res.end(String((e as Error).message)); }
});
await new Promise<void>((r) => srv.listen(54329, r));

// fake Yahoo / ECB
const P: Record<string, [string, number][]> = {
  "AAPL": [["2026-12-01", 200], ["2026-12-31", 210], ["2027-01-04", 212], ["2027-01-29", 220]],
  "XYZ.MI": [["2026-12-01", 10], ["2026-12-31", 12], ["2027-01-04", 15]],
  "ENI.MI": [["2027-01-04", 15], ["2027-01-29", 16.5]],
  "VOD.L": [["2026-12-01", 7000], ["2027-01-29", 7700]],
  "SWDA.L": [["2026-12-01", 100], ["2026-12-31", 102], ["2027-01-29", 105]],
};
const ccy: Record<string, string> = { AAPL: "USD", "XYZ.MI": "EUR", "ENI.MI": "EUR", "VOD.L": "GBp", "SWDA.L": "USD" };
const realFetch = globalThis.fetch;
let yahooCalls = 0;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url);
  if (u.includes("finance.yahoo.com/v8/finance/chart/")) {
    yahooCalls++;
    const sym = decodeURIComponent(u.split("/chart/")[1].split("?")[0]);
    const rows = P[sym] ?? [];
    return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: ccy[sym], gmtoffset: 0, instrumentType: "EQUITY" },
      timestamp: rows.map(([d]) => Date.parse(d + "T15:00:00Z") / 1000), indicators: { quote: [{ close: rows.map(([, c]) => c) }] } }] } }));
  }
  if (u.includes("data-api.ecb.europa.eu")) {
    const lines = ["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE"];
    for (const [d, r] of [["2026-12-01", 1.1], ["2026-12-31", 1.1], ["2027-01-04", 1.1], ["2027-01-29", 1.25]]) lines.push(`x,D,USD,EUR,SP00,A,${d},${r}`);
    for (const [d, r] of [["2026-12-01", 0.85], ["2027-01-29", 0.85]]) lines.push(`x,D,GBP,EUR,SP00,A,${d},${r}`);
    return new Response(lines.join("\n"));
  }
  return realFetch(url, init);
}) as typeof fetch;

const env = { supabaseUrl: "http://127.0.0.1:54329", serviceKey: "test-key" };
const r = await runOnce(env, { asOf: "2027-01-29", trigger: "e2e" });
console.log("status", r.status, "| warnings", r.warnings, "| yahoo calls", yahooCalls);
console.log(r.log.join("\n"));
const nav = await db.query(`select t.name, n.month_n, round(n.nav_eur,2) v from nav_monthly n join teams t on t.id=n.team_id where month_n>0 order by 1,2`);
console.log(nav.rows);
const p = await db.query(`select symbol, date, close, source from prices where symbol='VOD.L' order by date`);
console.log(p.rows);
const o = await db.query(`select symbol, month_n, status, executed_price, reject_reason from orders order by month_n, symbol`);
console.log(o.rows);
// second run: incremental fetch, same results
const r2 = await runOnce(env, { asOf: "2027-01-29", trigger: "e2e" });
const nav2 = await db.query(`select round(sum(nav_eur),2) s from nav_monthly`);
const runs = await db.query(`select status, trigger from engine_runs order by id`);
console.log("second run", r2.status, nav2.rows, runs.rows);
srv.close();
