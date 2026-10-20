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
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
for (const m of ["20261020000000_init.sql", "20261020120000_daily_close_access_codes.sql", "20261020150000_president_member.sql", "20261020160000_calendar_from_dates.sql", "20261020170000_admin_orders.sql", "20261020180000_no_currency_transfers.sql", "20261020190000_public_positions.sql", "20261020200000_edition_password_requests.sql", "20261020210000_mail_key_vault.sql", "20261020220000_self_registration.sql", "20261020230000_two_competitions_chat.sql", "20261020240000_member_stock_limit.sql"]) {
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
ok("teams see every team's positions", pos1.rows.length === 3, String(pos1.rows.length));
const pos0 = await as("anon", null, "select * from positions");
ok("positions public during the challenge", pos0.rows.length === 3, String(pos0.rows.length));
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
// password reset requests
const pr1 = await as("service_role", null, "select request_password_reset(' pres@uni.IT ') j");
ok("reset request stored for an existing account", (pr1.rows[0] as any).j.stored === true && (pr1.rows[0] as any).j.organisers.includes("admin@x"), JSON.stringify(pr1.rows[0]));
const pr2 = await as("service_role", null, "select request_password_reset('pres@uni.it') j");
ok("duplicate request within 30 minutes not stored", (pr2.rows[0] as any).j.stored === false);
const pr3 = await as("service_role", null, "select request_password_reset('nobody@uni.it') j");
ok("unknown e-mail not stored", (pr3.rows[0] as any).j.stored === false);
await expectErr("anon cannot call request_password_reset", () => as("anon", null, "select request_password_reset('pres@uni.it')"), /permission denied/);
const prA = await as("anon", null, "select * from password_requests");
ok("requests hidden from anon", prA.rows.length === 0);
const prAd = await as("authenticated", ADMIN, "select email from password_requests");
ok("admin sees the requests", prAd.rows.length === 1);
// self-registration: join with the code, organiser sets presidents
const U5 = "00000000-0000-0000-0000-000000000005", U6 = "00000000-0000-0000-0000-000000000006";
await db.exec(`insert into auth.users values ('${U5}','new@uni.it','{"full_name":"Nuovo Membro"}'),('${U6}','six@uni.it',null)`);
const j1 = await as("authenticated", U5, "select join_with_code('WRONG-CODE-0000') j");
ok("wrong code refused", /not recognised/.test((j1.rows[0] as any).j.error ?? ""), JSON.stringify(j1.rows[0]));
const j2 = await as("authenticated", U5, "select join_with_code('abcd efgh jklm') j");
ok("joins with the code (any spacing/case)", (j2.rows[0] as any).j.team !== undefined, JSON.stringify(j2.rows[0]));
const j3 = await as("authenticated", U5, "select join_with_code('ABCD-EFGH-JKLM') j");
ok("cannot join twice", /already in a Competition A team/.test((j3.rows[0] as any).j.error ?? ""));
const mem5 = await db.query(`select role, full_name from team_members where user_id = '${U5}'`);
ok("joined as member with the registration name", (mem5.rows[0] as any)?.role === "member" && (mem5.rows[0] as any)?.full_name === "Nuovo Membro", JSON.stringify(mem5.rows));
for (let i = 0; i < 10; i++) await as("authenticated", U6, "select join_with_code('ZZZZ-ZZZZ-ZZZZ')");
const j4 = await as("authenticated", U6, "select join_with_code('ABCD-EFGH-JKLM') j");
ok("too many wrong codes blocked", /Too many/.test((j4.rows[0] as any).j.error ?? ""), JSON.stringify(j4.rows[0]));
await expectErr("members cannot set roles", () => as("authenticated", U5, `select set_membership_admin('${U5}', '10000000-0000-0000-0000-000000000001', 'president')`), /Reserved/);
await as("authenticated", ADMIN, `select set_membership_admin('${U5}', '10000000-0000-0000-0000-000000000001', 'president')`);
const pres = await db.query(`select user_id from team_members where team_id = '10000000-0000-0000-0000-000000000001' and role = 'president'`);
ok("organiser makes a president (only one per team)", pres.rows.length === 1 && (pres.rows[0] as any).user_id === U5, JSON.stringify(pres.rows));
await as("authenticated", ADMIN, `select set_membership_admin('${U6}', '10000000-0000-0000-0000-000000000002', 'member')`);
ok("organiser adds an account to a team", (await db.query(`select 1 from team_members where user_id = '${U6}'`)).rows.length === 1);
// two competitions: one A team and one B team per person, random B draw, team chat
const A1 = "10000000-0000-0000-0000-000000000001", B1 = "10000000-0000-0000-0000-000000000002", A2 = "10000000-0000-0000-0000-0000000000a2";
await db.exec(`insert into teams (id,name,competition,university) values ('${A2}','Other A','A','Other')`);
await as("authenticated", ADMIN, `select set_membership_admin('${U1}', '${B1}', 'member')`);
ok("an A member can also be in a B team", (await db.query(`select team_id from team_members where user_id = '${U1}'`)).rows.length === 2);
await expectErr("never two A teams", () => db.query(`insert into team_members (user_id, team_id, role) values ('${U1}', '${A2}', 'member')`), /Already in a Competition A team/);
const myIds = await as("authenticated", U1, "select count(*)::int c from my_team_ids()");
ok("my_team_ids lists both teams", (myIds.rows[0] as any).c === 2);
const ob = await as("authenticated", U1, `select (place_order_in('${B1}','AAPL','open','long',5)).team_id t`);
ok("orders for the chosen team", (ob.rows[0] as any).t === B1);
await expectErr("no orders for someone else's team", () => as("authenticated", U1, `select place_order_in('${A2}','AAPL','open','long',5)`), /not a member/);
const seeB = await as("authenticated", U1, `select count(*)::int c from orders where team_id = '${B1}'`);
ok("member reads the orders of both teams", (seeB.rows[0] as any).c >= 1);
// draw
const pool = await db.query(`select count(*)::int c from auth.users u where not exists (select 1 from user_roles r where r.user_id=u.id and r.role='admin')
  and not exists (select 1 from team_members m join teams t on t.id=m.team_id where m.user_id=u.id and t.competition='B')`);
const nPool = (pool.rows[0] as any).c;
const gen = await as("authenticated", ADMIN, "select generate_b_teams(2) j");
const gj = (gen.rows[0] as any).j;
ok("B draw creates teams for everyone", gj.people === nPool && gj.teams === Math.floor(nPool / 2), JSON.stringify([gj, nPool]));
const left = await db.query(`select count(*)::int c from auth.users u where not exists (select 1 from user_roles r where r.user_id=u.id and r.role='admin')
  and not exists (select 1 from team_members m join teams t on t.id=m.team_id where m.user_id=u.id and t.competition='B')`);
ok("nobody left without a B team", (left.rows[0] as any).c === 0);
const names = await db.query(`select name from teams where competition='B' and name like 'B Team %' order by name`);
ok("B teams named in sequence", (names.rows[0] as any)?.name === "B Team 01", JSON.stringify(names.rows));
await expectErr("draw needs enough people", () => as("authenticated", ADMIN, "select generate_b_teams(2)"), /at least 2 are needed/);
await expectErr("only the organiser draws", () => as("authenticated", U1, "select generate_b_teams(2)"), /Reserved/);
// chat
await as("authenticated", U1, `insert into team_messages (team_id, body, author) values ('${A1}', '  hello team  ', 'fake')`);
const msg = await db.query(`select author, body, user_id from team_messages`);
ok("message stamped by the server", (msg.rows[0] as any).user_id === U1 && (msg.rows[0] as any).body === "hello team" && (msg.rows[0] as any).author !== "fake", JSON.stringify(msg.rows));
const outsider = await db.query(`select user_id from team_members where team_id = '${B1}' and user_id <> '${U1}' and user_id not in (select user_id from team_members where team_id = '${A1}') limit 1`);
const OUT = (outsider.rows[0] as any).user_id;
ok("other teams cannot read the chat", (await as("authenticated", OUT, `select * from team_messages where team_id = '${A1}'`)).rows.length === 0);
await expectErr("other teams cannot write in the chat", () => as("authenticated", OUT, `insert into team_messages (team_id, body) values ('${A1}', 'x')`), /row-level security/);
ok("organiser reads every chat", (await as("authenticated", ADMIN, "select * from team_messages")).rows.length === 1);
// per-member stock limit
const U7 = "00000000-0000-0000-0000-000000000007";
await db.exec(`insert into auth.users values ('${U7}','seven@uni.it','{"full_name":"Seven"}')`);
await as("authenticated", ADMIN, `select set_membership_admin('${U7}', '${A2}', 'member')`);
ok("default limit is 10", (await db.query(`select stock_limit_of('${A2}') l`)).rows[0] && ((await db.query(`select stock_limit_of('${A2}') l`)).rows[0] as any).l === 10);
await expectErr("members cannot set the limit", () => as("authenticated", U7, `select set_stock_limit('${A2}', 2)`), /Only the president/);
await as("authenticated", ADMIN, `select set_membership_admin('${U7}', '${A2}', 'president')`);
await as("authenticated", U7, `select set_stock_limit('${A2}', 2)`);
await as("authenticated", U7, `select place_order_in('${A2}','AAPL','open','long',1)`);
await as("authenticated", U7, `select place_order_in('${A2}','ENI.MI','open','long',1)`);
await expectErr("third stock over the limit of 2", () => as("authenticated", U7, `select place_order_in('${A2}','XYZ.MI','open','short',1)`), /limit is 2 per member/);
const use = await as("authenticated", U7, `select my_stock_usage('${A2}') j`);
ok("usage reported", (use.rows[0] as any).j.used === 2 && (use.rows[0] as any).j.limit === 2, JSON.stringify(use.rows[0]));
await as("authenticated", U7, `select set_stock_limit('${A2}', null)`);
await as("authenticated", U7, `select place_order_in('${A2}','XYZ.MI','open','short',1)`);
ok("no limit means 10", ((await db.query(`select stock_limit_of('${A2}') l`)).rows[0] as any).l === 10);
await expectErr("limit above 10 refused", () => as("authenticated", U7, `select set_stock_limit('${A2}', 50)`), /between 1 and 10/);
ok("Competition B is always 10", ((await db.query(`select stock_limit_of('${B1}') l`)).rows[0] as any).l === 10);
console.log(fails ? `\n${fails} FAILED` : "\nALL DB TESTS PASSED");
