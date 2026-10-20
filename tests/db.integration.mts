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
for (const m of ["20261020000000_init.sql", "20261020120000_daily_close_access_codes.sql", "20261020150000_president_member.sql", "20261020160000_calendar_from_dates.sql", "20261020170000_admin_orders.sql", "20261020180000_no_currency_transfers.sql"]) {
  await db.exec(readFileSync(new URL(`../supabase/migrations/${m}`, import.meta.url), "utf8"));
}
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
  insert into public.instruments (symbol,name,currency,exchange_tz,close_time) values
    ('AAPL','Apple','USD','America/New_York','16:00'),('ENI.MI','Eni','EUR','Europe/Rome','17:30'),('XYZ.MI','XYZ','EUR',null,null);
  insert into public.instruments (symbol,name,currency,quote_type) values ('SPY','SPDR','USD','ETF');
`);
await db.query(`select link_team_user($1,$2)`, [U1, "10000000-0000-0000-0000-000000000001"]);
await db.query(`select link_team_user($1,$2)`, [U2, "10000000-0000-0000-0000-000000000002"]);

const as = async (role: string, uid: string | null, sql: string, params: unknown[] = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role};`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
};

// --- execution date: close of the trading day on the stock's exchange
const timing = async (sym: string, at: string) => {
  const r = (await db.query(`select exec_date::text d, to_char(cutoff_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') c from order_timing($1, $2::timestamptz)`, [sym, at])).rows[0] as any;
  return `${r.d} ${r.c}`;
};
ok("Milan 10:00 -> same day, cutoff 17:30 Rome", (await timing("ENI.MI", "2026-12-02 10:00+01")) === "2026-12-02 2026-12-02 16:30");
ok("Milan 18:00 -> next day", (await timing("ENI.MI", "2026-12-02 18:00+01")).startsWith("2026-12-03 "));
ok("Friday after close -> Monday", (await timing("ENI.MI", "2026-12-04 17:31+01")).startsWith("2026-12-07 "));
ok("Saturday -> Monday", (await timing("ENI.MI", "2026-12-05 11:00+01")).startsWith("2026-12-07 "));
ok("New York 21:00 Rome (15:00 NY) -> same day", (await timing("AAPL", "2026-12-02 21:00+01")) === "2026-12-02 2026-12-02 21:00");
ok("New York 22:30 Rome (16:30 NY) -> next day", (await timing("AAPL", "2026-12-02 22:30+01")).startsWith("2026-12-03 "));
ok("unknown exchange -> Rome 17:30 default", (await timing("XYZ.MI", "2026-12-02 17:00+01")) === "2026-12-02 2026-12-02 16:30");
ok("before the start -> start date", (await timing("ENI.MI", "2026-10-20 10:00+02")) === "2026-12-01 2026-12-01 16:30");

// --- team orders
await as("authenticated", U1, "select place_order('AAPL','open','long',100)");
await as("authenticated", U1, "select place_order('XYZ.MI','open','short',1000)");
await as("authenticated", U1, "select place_order('AAPL','open','long',5)");
const rep = await as("authenticated", U1, "select target_quantity q, exec_date::text d, month_n from orders where symbol='AAPL' and status='pending'");
ok("re-open before the close replaces the pending order", rep.rows.length === 1 && Number((rep.rows[0] as any).q) === 5);
ok("order placed before the start runs at the start close (month 1)", (rep.rows[0] as any).d === "2026-12-01" && (rep.rows[0] as any).month_n === 1);
await as("authenticated", U1, "select place_order('AAPL','open','long',100)");
await expectErr("close not held rejected", () => as("authenticated", U1, "select place_order('ENI.MI','close')"), /not hold/);
await expectErr("ETF rejected", () => as("authenticated", U1, "select place_order('SPY','open','long',1)"), /Only listed stocks/);
await expectErr("fractional qty rejected", () => as("authenticated", U1, "select place_order('ENI.MI','open','long',1.5)"), /whole number/);
await expectErr("unknown symbol rejected", () => as("authenticated", U1, "select place_order('ZZZ','open','long',1)"), /Unknown instrument/);
await expectErr("no team -> rejected", () => as("authenticated", ADMIN, "select place_order('ENI.MI','open','long',1)"), /not a member/);
// locked order (market closed, engine not run yet): it is kept and later orders build on it
await db.exec(`update orders set cutoff_at = now() - interval '1 minute' where symbol = 'AAPL' and status = 'pending'`);
await expectErr("cancel after the close rejected", async () => {
  const id = (await db.query(`select id from orders where symbol='AAPL' and status='pending'`)).rows[0] as any;
  return as("authenticated", U1, "select cancel_order($1)", [id.id]);
}, /locked/);
await expectErr("open on a symbol with a locked open order rejected", () => as("authenticated", U1, "select place_order('AAPL','open','long',5)"), /already hold/);
await as("authenticated", U1, "select place_order('AAPL','change','long',60)");
const two = await db.query(`select action, status from orders where symbol='AAPL' order by created_at`);
ok("locked order kept, change queued after it", JSON.stringify((two.rows as any[]).filter((r) => r.status === "pending").map((r) => r.action)) === '["open","change"]');
// cancel before the close works
const xyz = (await db.query(`select id from orders where symbol='XYZ.MI'`)).rows[0] as any;
await as("authenticated", U1, "select cancel_order($1)", [xyz.id]);
ok("cancel before the close", ((await db.query(`select status from orders where id=$1`, [xyz.id])).rows[0] as any).status === "cancelled");
// after the end of the challenge
await db.exec(`update challenge_settings set end_date = '2026-11-30'`);
await expectErr("no orders after the end", () => as("authenticated", U2, "select place_order('ENI.MI','open','long',1)"), /challenge is over/);
await db.exec(`update challenge_settings set end_date = '2027-05-31'`);
await as("authenticated", U2, "select place_order('ENI.MI','open','long',10)");
const u2o = await as("authenticated", U2, "select symbol from orders where status='pending'");
ok("team sees only its own orders", u2o.rows.length === 1);
await expectErr("currency transfers disabled", () => as("authenticated", U2, "select place_transfer('USD', 5)"), /not available/);

// --- access codes: organiser only
await db.query(`insert into team_access (team_id, user_id, code) values ($1, $2, 'ABCD-EFGH-JKLM')`, ["10000000-0000-0000-0000-000000000001", U1]);
ok("admin reads access codes", (await as("authenticated", ADMIN, "select code from team_access")).rows.length === 1);
ok("team cannot read access codes", (await as("authenticated", U1, "select code from team_access")).rows.length === 0);
ok("anon cannot read access codes", (await as("anon", null, "select code from team_access")).rows.length === 0);
await expectErr("team cannot write access codes", () => as("authenticated", U2, `insert into team_access values ('10000000-0000-0000-0000-000000000002', '${U2}', 'X')`), /row-level security/);

// --- registration roles: president by saved e-mail, members by team code
const T1 = "10000000-0000-0000-0000-000000000001", U3 = "00000000-0000-0000-0000-000000000003", U4 = "00000000-0000-0000-0000-000000000004";
await db.exec(`insert into auth.users values ('${U3}','Pres@Uni.it'),('${U4}','other@x'); update teams set president_email = 'pres@uni.it' where id = '${T1}'`);
const fp = (await as("service_role", null, "select * from team_for_president('  PRES@uni.it ')")).rows[0] as any;
ok("president e-mail found (case-insensitive), not taken yet", fp?.team_id === T1 && fp.taken === false);
ok("unknown e-mail is not a president", (await as("service_role", null, "select * from team_for_president('x@y.z')")).rows.length === 0);
await as("service_role", null, `select join_team('${U3}', '${T1}', 'president', 'Ada President')`);
ok("president slot now taken", ((await as("service_role", null, "select * from team_for_president('pres@uni.it')")).rows[0] as any).taken === true);
await expectErr("only one president per team", () => as("service_role", null, `select join_team('${U4}', '${T1}', 'president', 'Second')`), /duplicate key|unique/);
const fc = (await as("service_role", null, "select * from team_for_code('abcd efgh-jklm')")).rows[0] as any;
ok("team code found whatever the format", fc?.team_id === T1);
ok("wrong team code finds nothing", (await as("service_role", null, "select * from team_for_code('ABCD-EFGH-JKLX')")).rows.length === 0);
await expectErr("anon cannot look up team codes", () => as("anon", null, "select * from team_for_code('ABCD-EFGH-JKLM')"), /permission denied/);
await expectErr("members cannot call join_team", () => as("authenticated", U1, `select join_team('${U4}', '${T1}', 'president', 'x')`), /permission denied/);
const infoP = ((await as("authenticated", U3, "select my_team_info() i")).rows[0] as any).i;
ok("president sees the team code and member e-mails", infoP.role === "president" && infoP.code === "ABCD-EFGH-JKLM" && infoP.members.some((m: any) => m.email === "u1@x"), JSON.stringify(infoP));
const infoM = ((await as("authenticated", U1, "select my_team_info() i")).rows[0] as any).i;
ok("member sees teammates but no code and no e-mails", infoM.role === "member" && infoM.code === null && infoM.members.length === 2 && infoM.members.every((m: any) => m.email === null));
ok("no team -> no info", ((await as("authenticated", U4, "select my_team_info() i")).rows[0] as any).i === null);

// --- organiser acting for a team
await as("authenticated", ADMIN, `select place_order_admin('${T1}', 'ENI.MI', 'open', 'short', 7)`);
const adm = (await db.query(`select team_id, side, target_quantity q, status from orders where symbol='ENI.MI' and team_id='${T1}'`)).rows[0] as any;
ok("admin places an order for a team", adm?.side === "short" && Number(adm.q) === 7 && adm.status === "pending");
await expectErr("members cannot use the admin order function", () => as("authenticated", U1, `select place_order_admin('${T1}', 'ENI.MI', 'close')`), /Reserved to the organiser/);
const admId = (await db.query(`select id from orders where symbol='ENI.MI' and team_id='${T1}' and status='pending'`)).rows[0] as any;
await as("authenticated", ADMIN, "select cancel_order_admin($1)", [admId.id]);
ok("admin cancels it", ((await db.query(`select status from orders where id=$1`, [admId.id])).rows[0] as any).status === "cancelled");
ok("admin sees team info", ((await as("authenticated", ADMIN, `select team_info_admin('${T1}') i`)).rows[0] as any).i.members.length === 2);
ok("members get no admin team info", ((await as("authenticated", U1, `select team_info_admin('${T1}') i`)).rows[0] as any).i === null);

// --- anonymous visit statistics
const V = "20000000-0000-0000-0000-000000000001";
await as("anon", null, "select track_visit($1, '/')", [V]);
await as("anon", null, "select track_visit($1, '/leaderboard')", [V]);
await as("anon", null, "select track_visit($1, '/')", ["20000000-0000-0000-0000-000000000002"]);
ok("one visit per visitor per 30 minutes", Number(((await db.query("select count(*) n from site_visits")).rows[0] as any).n) === 2);
ok("anon cannot read visits", (await as("anon", null, "select * from site_visits")).rows.length === 0);
await expectErr("anon cannot read stats", () => as("anon", null, "select visit_stats()"), /permission denied/);
ok("team gets no stats", ((await as("authenticated", U1, "select visit_stats() s")).rows[0] as any).s === null);
const st = ((await as("authenticated", ADMIN, "select visit_stats() s")).rows[0] as any).s;
ok("admin stats", st.visits === 2 && st.visitors === 2, JSON.stringify(st));

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

// --- replace the orders with the acceptance case (legacy monthly orders: no exec_date)
await db.exec(`delete from orders; delete from transfer_orders;`);
const TEAM = { A1: "10000000-0000-0000-0000-000000000001", B1: "10000000-0000-0000-0000-000000000002" } as Record<string, string>;
for (const o of fixture().orders.filter((x) => x.teamId in TEAM)) {
  await db.query(`insert into orders (team_id, month_n, symbol, action, side, target_quantity, created_at) values ($1,$2,$3,$4,$5,$6,$7)`,
    [TEAM[o.teamId], o.monthN, o.symbol, o.action, o.side, o.quantity, o.createdAt]);
}
await db.query(`insert into transfer_orders (team_id, month_n, currency, eur_amount) values ($1, 1, 'USD', 10000)`, [TEAM.B1]);

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
ok("engine_input has 2 teams / 4 orders / transfers ignored", input.teams.length === 2 && input.orders.length === 4 && input.transfers.length === 0, JSON.stringify([input.teams.length, input.orders.length, input.transfers.length]));
const out = runEngine(input, "2027-01-29");
await as("service_role", null, "select engine_write($1::jsonb)", [JSON.stringify(out)]);
const nav = await db.query(`select t.name, n.month_n, round(n.nav_eur,2) v from nav_monthly n join teams t on t.id=n.team_id order by 1,2`);
const m = Object.fromEntries((nav.rows as any[]).map((r) => [`${r.name}${r.month_n}`, Number(r.v)]));
ok("Bicocca NAV m1 998909.09", m.Bicocca1 === 998909.09, String(m.Bicocca1));
ok("Bicocca NAV m2 996680.00", m.Bicocca2 === 996680.0, String(m.Bicocca2));
ok("Leon NAV m2 1001500.00 (no currency transfer)", m.Leon2 === 1001500.0, String(m.Leon2));
const ost = await db.query(`select symbol, month_n, status, reject_source, executed_price from orders order by month_n, symbol`);
console.log(ost.rows);
const pos1 = await as("authenticated", U1, "select symbol, exit_reason from positions");
ok("team sees only its own positions", pos1.rows.length === 2);
const pos0 = await as("anon", null, "select * from positions");
ok("positions private during the challenge", pos0.rows.length === 0);
const sp = await as("authenticated", U2, "select currency, round(total_eur,2) t from subportfolios order by 1");
ok("Leon sub-portfolios", JSON.stringify(sp.rows) === JSON.stringify([{ currency: "EUR", t: "1001500.00" }].map((x) => ({ ...x, t: x.t }))), JSON.stringify(sp.rows));
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
