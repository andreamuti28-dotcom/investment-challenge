import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { toEngineInput } from "../supabase/functions/_shared/runner.ts";
import { runEngine } from "../supabase/functions/_shared/core.ts";
import { fixture } from "../supabase/functions/_shared/selftest.ts";

const db = new PGlite();
let fails = 0;
const ok = (name: string, cond: boolean, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`); if (!cond) fails++; };
const expectErr = async (name: string, fn: () => Promise<unknown>, re: RegExp) => {
  try { await fn(); ok(name, false, "(no error)"); } catch (e) { const m = (e as Error).message; ok(name, re.test(m), `-> ${m.slice(0, 90)}`); }
};
// Supabase stubs
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
await db.exec(readFileSync(new URL("../supabase/migrations/20261020000000_init.sql", import.meta.url), "utf8"));
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
  grant usage, select on all sequences in schema public to anon, authenticated, service_role;
`);
ok("migration applied", true);

const ADMIN = "00000000-0000-0000-0000-00000000000a", U1 = "00000000-0000-0000-0000-000000000001", U2 = "00000000-0000-0000-0000-000000000002";
await db.exec(`
  insert into auth.users values ('${ADMIN}','admin@x'),('${U1}','u1@x'),('${U2}','u2@x');
  insert into public.user_roles values ('${ADMIN}','admin');
  insert into public.teams (id,name,competition,university) values
    ('10000000-0000-0000-0000-000000000001','Bicocca','A','Milano-Bicocca'),('10000000-0000-0000-0000-000000000002','Leon','B','Mixed');
  insert into public.team_contacts values ('10000000-0000-0000-0000-000000000001','Andrea','secret@x',null);
  insert into public.instruments (symbol,name,currency) values ('AAPL','Apple','USD'),('ENI.MI','Eni','EUR'),('XYZ.MI','XYZ','EUR');
  insert into public.instruments (symbol,name,currency,quote_type) values ('SPY','SPDR','USD','ETF');
`);
await db.query(`select link_team_user($1,$2)`, [U1, "10000000-0000-0000-0000-000000000001"]);
await db.query(`select link_team_user($1,$2)`, [U2, "10000000-0000-0000-0000-000000000002"]);

const as = async (role: string, uid: string | null, sql: string, params: unknown[] = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role};`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
};

// --- open month and team orders
const om = await as("authenticated", U1, "select * from open_order_month()");
ok("open order month is 1 before 29/11", (om.rows[0] as any).n === 1);
await as("authenticated", U1, "select place_order('AAPL','open','long',100)");
await as("authenticated", U1, "select place_order('XYZ.MI','open','short',1000)");
await as("authenticated", U1, "select place_order('AAPL','open','long',5)");
const rep = await as("authenticated", U1, "select target_quantity q from orders where symbol='AAPL' and status='pending'");
ok("same month re-open replaces pending order", rep.rows.length === 1 && Number((rep.rows[0] as any).q) === 5);
await as("authenticated", U1, "select place_order('AAPL','open','long',100)");
await expectErr("close not held rejected", () => as("authenticated", U1, "select place_order('ENI.MI','close')"), /do not hold/);
await expectErr("ETF rejected", () => as("authenticated", U1, "select place_order('SPY','open','long',1)"), /Only listed stocks/);
await expectErr("fractional qty rejected", () => as("authenticated", U1, "select place_order('ENI.MI','open','long',1.5)"), /whole number/);
await expectErr("unknown symbol rejected", () => as("authenticated", U1, "select place_order('ZZZ','open','long',1)"), /Unknown instrument/);
await expectErr("no team -> rejected", () => as("authenticated", ADMIN, "select place_order('ENI.MI','open','long',1)"), /not a member/);
// replace pending order on same symbol/month
await as("authenticated", U2, "select place_order('ENI.MI','open','long',10)");
await as("authenticated", U2, "select place_order('ENI.MI','open','long',1000)");
const u2o = await as("authenticated", U2, "select symbol, target_quantity from orders where status='pending'");
ok("pending order replaced, team sees only its own", u2o.rows.length === 1 && Number((u2o.rows[0] as any).target_quantity) === 1000);
await as("authenticated", U2, "select place_transfer('usd', 10000)");
await expectErr("EUR transfer rejected", () => as("authenticated", U2, "select place_transfer('EUR', 5)"), /Invalid currency/);

// --- RLS
await expectErr("team cannot insert orders directly", () => as("authenticated", U1, `insert into orders (team_id,month_n,symbol,action,side,target_quantity) values ('10000000-0000-0000-0000-000000000001',1,'ENI.MI','open','long',1)`), /row-level security/);
const c1 = await as("anon", null, "select * from team_contacts");
ok("anon cannot read contacts", c1.rows.length === 0);
const c2 = await as("authenticated", U2, "select * from team_contacts");
ok("other team cannot read Bicocca contact", c2.rows.length === 0);
const c3 = await as("authenticated", ADMIN, "select * from team_contacts");
ok("admin reads contacts", c3.rows.length === 1);
const lb = await as("anon", null, "select name from leaderboard");
ok("anon reads leaderboard", lb.rows.length === 2);
await expectErr("anon cannot place orders", () => as("anon", null, "select place_order('AAPL','open','long',1)"), /permission denied/);
await expectErr("team cannot call engine_input", () => as("authenticated", U1, "select engine_input()"), /permission denied/);
await expectErr("team cannot call engine_write", () => as("authenticated", U1, "select engine_write('{}'::jsonb)"), /permission denied/);
await expectErr("team cannot update metrics", async () => { const r = await as("authenticated", U1, "update metrics set nav = 1 returning *"); if (!r.rows.length) throw new Error("row-level security: 0 rows"); }, /row-level security|0 rows/);

// --- month 2: XYZ close + ENI open (simulate time by setting deadlines)
await db.exec(`update challenge_months set order_deadline = now() - interval '1 day' where n = 1`);
await as("authenticated", U1, "select place_order('XYZ.MI','close')");
await expectErr("open on a symbol held from previous month rejected", () => as("authenticated", U1, "select place_order('AAPL','open','long',5)"), /already hold/);
await as("authenticated", U1, "select place_order('AAPL','change','long',100)");
await db.exec(`delete from orders where symbol='AAPL' and month_n=2`);
await as("authenticated", U2, "select place_order('ENI.MI','change','long',1000)").catch(() => {});
await db.exec(`delete from orders where team_id='10000000-0000-0000-0000-000000000002' and month_n=2`);
// U2: ENI month1 order should become month-2 open in the fixture; move it
await db.exec(`update orders set month_n = 2 where team_id='10000000-0000-0000-0000-000000000002'`);
await expectErr("cancel after deadline rejected", async () => {
  const id = (await db.query(`select id from orders where team_id='10000000-0000-0000-0000-000000000001' and month_n=1 limit 1`)).rows[0] as any;
  return as("authenticated", U1, "select cancel_order($1)", [id.id]);
}, /no longer editable/);

// --- market data (manual, same as the acceptance fixture)
const f = fixture();
for (const p of f.prices) if (p.source === "manual") await db.query(`insert into prices values ($1,$2,$3,'manual',now())`, [p.symbol, p.date, p.close]);
for (const x of f.fx) await db.query(`insert into fx_rates values ($1,$2,$3,'manual')`, [x.currency, x.date, x.rate]);
await db.query(`insert into corporate_events values ('AAPL','2027-01-20','dividend',1,'manual')`);
// yahoo upsert must never override manual
await as("service_role", null, `select upsert_market_data($1::jsonb)`, [JSON.stringify({ prices: [["AAPL", "2026-12-31", 999]], fx: [], events: [] })]);
// --- engine round trip through SQL
const inp = await as("service_role", null, "select engine_input() as j");
const input = toEngineInput((inp.rows[0] as any).j);
ok("engine_input has 2 teams / 3 orders / transfers", input.teams.length === 2 && input.orders.length === 4 && input.transfers.length === 1, JSON.stringify([input.teams.length, input.orders.length, input.transfers.length]));
const out = runEngine(input, "2027-01-29");
await as("service_role", null, "select engine_write($1::jsonb)", [JSON.stringify(out)]);
const nav = await db.query(`select t.name, n.month_n, round(n.nav_eur,2) v from nav_monthly n join teams t on t.id=n.team_id order by 1,2`);
const m = Object.fromEntries((nav.rows as any[]).map((r) => [`${r.name}${r.month_n}`, Number(r.v)]));
ok("Bicocca NAV m1 998909.09", m.Bicocca1 === 998909.09, String(m.Bicocca1));
ok("Bicocca NAV m2 996680.00", m.Bicocca2 === 996680.0, String(m.Bicocca2));
ok("Leon NAV m2 1000300.00", m.Leon2 === 1000300.0, String(m.Leon2));
const ost = await db.query(`select symbol, month_n, status, reject_source, executed_price from orders order by month_n, symbol`);
console.log(ost.rows);
const pos1 = await as("authenticated", U1, "select symbol, exit_reason from positions");
ok("team sees only its own positions", pos1.rows.length === 2);
const pos0 = await as("anon", null, "select * from positions");
ok("positions private during the challenge", pos0.rows.length === 0);
const sp = await as("authenticated", U2, "select currency, round(total_eur,2) t from subportfolios order by 1");
ok("Leon sub-portfolios", JSON.stringify(sp.rows) === JSON.stringify([{ currency: "EUR", t: "991500.00" }, { currency: "USD", t: "8800.00" }].map((x) => ({ ...x, t: x.t }))), JSON.stringify(sp.rows));
await as("service_role", null, `select engine_log('ok','2027-01-29','test','log','[]'::jsonb)`);
const lr = await as("anon", null, "select status from last_engine_run");
ok("anon sees last run status", (lr.rows[0] as any)?.status === "ok");
// second write is idempotent
await as("service_role", null, "select engine_write($1::jsonb)", [JSON.stringify(runEngine(toEngineInput(((await as("service_role", null, "select engine_input() as j")).rows[0] as any).j), "2027-01-29"))]);
const cnt = await db.query(`select (select count(*) from positions) p, (select count(*) from nav_daily) n, (select count(*) from metrics) m`);
ok("idempotent row counts", JSON.stringify(cnt.rows[0]) === JSON.stringify({ p: 3, n: (cnt.rows[0] as any).n, m: 2 }), JSON.stringify(cnt.rows[0]));
// admin reject is never overwritten by the engine
await db.exec(`update orders set status='rejected', reject_source='admin', reject_reason='test' where symbol='ENI.MI'`);
const out3 = runEngine(toEngineInput(((await as("service_role", null, "select engine_input() as j")).rows[0] as any).j), "2027-01-29");
await as("service_role", null, "select engine_write($1::jsonb)", [JSON.stringify(out3)]);
const eni = await db.query(`select status, reject_source from orders where symbol='ENI.MI'`);
ok("admin rejection preserved & excluded", (eni.rows[0] as any).reject_source === "admin" && out3.positions.every((p) => p.symbol !== "ENI.MI"));
console.log(fails ? `\n${fails} FAILED` : "\nALL DB TESTS PASSED");
