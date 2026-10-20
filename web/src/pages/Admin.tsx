import { Fragment, useMemo, useState, type ReactNode } from "react";
import { callFunction, errText, supabase } from "../lib/supabase";
import { must, useLoad, type Month, type Settings } from "../lib/data";
import { date, dateTime, download, num, pct, toCsv } from "../lib/format";
import { Loading, Notice, Tabs } from "../components/ui";

type Tab = "teams" | "orders" | "data" | "settings" | "engine" | "export";

export default function Admin() {
  const [tab, setTab] = useState<Tab>("teams");
  return (
    <>
      <div className="eyebrow">Organiser</div>
      <h1 style={{ fontSize: 38 }}>Admin panel</h1>
      <Tabs value={tab} onChange={setTab} items={[["teams", "Teams"], ["orders", "Orders"], ["data", "Market data"], ["settings", "Calendar & settings"], ["engine", "Engine"], ["export", "Export"]]} />
      {tab === "teams" && <Teams />}
      {tab === "orders" && <Orders />}
      {tab === "data" && <MarketData />}
      {tab === "settings" && <SettingsTab />}
      {tab === "engine" && <Engine />}
      {tab === "export" && <Export />}
    </>
  );
}

// ------------------------------------------------------------------ teams
function Teams() {
  const q = useLoad(async () => {
    const [teams, contacts] = await Promise.all([
      must(supabase.from("teams").select("*").order("competition").order("name")),
      must(supabase.from("team_contacts").select("*")),
    ]);
    const c = Object.fromEntries((contacts as any[]).map((x) => [x.team_id, x]));
    return (teams as any[]).map((t) => ({ ...t, contact: c[t.id] ?? {} }));
  });
  const [form, setForm] = useState({ name: "", competition: "A", university: "", contact_name: "", contact_email: "" });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: ReactNode } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function addTeam() {
    setMsg(null);
    const { data, error } = await supabase.from("teams").insert({ name: form.name.trim(), competition: form.competition, university: form.university.trim() || null }).select().single();
    if (error) return setMsg({ kind: "err", text: errText(error) });
    await supabase.from("team_contacts").insert({ team_id: data.id, contact_name: form.contact_name || null, contact_email: form.contact_email || null });
    setForm({ name: "", competition: "A", university: "", contact_name: "", contact_email: "" });
    setMsg({ kind: "ok", text: `Team ${data.name} created. Now create its account below.` });
    await q.reload();
  }

  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  return (
    <>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="card">
        <h3>Add a team</h3>
        <div className="row">
          <div className="field"><label htmlFor="tn">Team name</label><input id="tn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field narrow"><label htmlFor="tcomp">Competition</label><select id="tcomp" value={form.competition} onChange={(e) => setForm({ ...form, competition: e.target.value })}><option value="A">A · University</option><option value="B">B · International</option></select></div>
          <div className="field"><label htmlFor="tu">University / composition</label><input id="tu" value={form.university} onChange={(e) => setForm({ ...form, university: e.target.value })} /></div>
          <div className="field"><label htmlFor="tcn">Contact name</label><input id="tcn" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
          <div className="field"><label htmlFor="tce">Contact email</label><input id="tce" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
          <button style={{ alignSelf: "flex-end" }} disabled={!form.name.trim()} onClick={addTeam}>Add team</button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Team</th><th>Comp.</th><th>University</th><th>Contact</th><th className="num">Violations</th><th /></tr></thead>
          <tbody>
            {q.data.map((t: any) => (
              <TeamRow key={t.id} t={t} open={open === t.id} toggle={() => setOpen(open === t.id ? null : t.id)} reload={q.reload} setMsg={setMsg} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TeamRow({ t, open, toggle, reload, setMsg }: any) {
  const [users, setUsers] = useState<any[] | null>(null);
  const [email, setEmail] = useState(t.contact.contact_email ?? "");
  const [busy, setBusy] = useState(false);
  async function loadUsers() {
    try { setUsers((await callFunction("admin", { action: "list_team_users", teamId: t.id })).users ?? []); } catch (e) { setMsg({ kind: "err", text: errText(e) }); }
  }
  return (
    <>
      <tr>
        <td><b>{t.name}</b></td><td>{t.competition}</td><td>{t.university}</td>
        <td className="small">{t.contact.contact_name}<div className="muted">{t.contact.contact_email}</div></td>
        <td className="num">
          <input aria-label={`Violations of ${t.name}`} style={{ width: 70, minHeight: 32 }} type="number" min={0} defaultValue={t.violations}
            onBlur={async (e) => { const v = Number(e.target.value); if (v !== t.violations) { await supabase.from("teams").update({ violations: v }).eq("id", t.id); reload(); } }} />
        </td>
        <td><button className="secondary small" onClick={() => { toggle(); if (!open) loadUsers(); }}>{open ? "Close" : "Accounts"}</button></td>
      </tr>
      {open && (
        <tr><td colSpan={6} style={{ background: "#faf8f3" }}>
          <div className="stack">
            <div className="row">
              <div className="field"><label htmlFor={`em-${t.id}`}>Create a login for this team</label><input id={`em-${t.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="referent@university.edu" /></div>
              <button style={{ alignSelf: "flex-end" }} disabled={busy || !email} onClick={async () => {
                setBusy(true);
                try {
                  const r = await callFunction("admin", { action: "create_team_user", teamId: t.id, email });
                  setMsg({ kind: "ok", text: <>Account created for <b>{r.email}</b>. Temporary password: <span className="secret">{r.password}</span> Send it to the team now: it is not shown again.</> });
                  loadUsers();
                } catch (e) { setMsg({ kind: "err", text: errText(e) }); }
                setBusy(false);
              }}>Create account</button>
            </div>
            {users === null ? <span className="muted small">Loading accounts…</span> : users.length === 0 ? <span className="muted small">No accounts yet.</span> : (
              <table><tbody>{users.map((u) => (
                <tr key={u.id}><td>{u.email}</td><td className="small muted">last sign-in {u.lastSignIn ? dateTime(u.lastSignIn) : "never"}</td>
                  <td><button className="secondary small" onClick={async () => {
                    try { const r = await callFunction("admin", { action: "reset_password", userId: u.id }); setMsg({ kind: "ok", text: <>New temporary password for {u.email}: <span className="secret">{r.password}</span></> }); }
                    catch (e) { setMsg({ kind: "err", text: errText(e) }); }
                  }}>Reset password</button></td></tr>
              ))}</tbody></table>
            )}
          </div>
        </td></tr>
      )}
    </>
  );
}

// ------------------------------------------------------------------ orders
function Orders() {
  const [month, setMonth] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const q = useLoad(async () => {
    const [orders, transfers, teams, months] = await Promise.all([
      must(supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(5000)),
      must(supabase.from("transfer_orders").select("*").order("created_at", { ascending: false })),
      must(supabase.from("teams").select("id,name")),
      must(supabase.from("challenge_months").select("n,label").order("n")),
    ]);
    return { orders: orders as any[], transfers: transfers as any[], teamName: Object.fromEntries((teams as any[]).map((t) => [t.id, t.name])), months: months as any[] };
  });
  const [msg, setMsg] = useState("");
  const rows = useMemo(() => (q.data?.orders ?? []).filter((o) => (month === "all" || String(o.month_n) === month) && (status === "all" || o.status === status)), [q.data, month, status]);
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  const d = q.data;
  async function setOrder(table: "orders" | "transfer_orders", id: string, patch: Record<string, unknown>) {
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    setMsg(error ? errText(error) : "Saved. Results update at the next engine run (or run it now from the Engine tab).");
    q.reload();
  }
  return (
    <>
      {msg && <Notice kind="ok">{msg}</Notice>}
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="field narrow"><label htmlFor="fm">Month</label><select id="fm" value={month} onChange={(e) => setMonth(e.target.value)}><option value="all">All</option>{d.months.map((m: any) => <option key={m.n} value={m.n}>{m.label}</option>)}</select></div>
        <div className="field narrow"><label htmlFor="fs">Status</label><select id="fs" value={status} onChange={(e) => setStatus(e.target.value)}>{["all", "pending", "executed", "rejected", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select></div>
        <span className="muted small" style={{ alignSelf: "flex-end" }}>{rows.length} orders</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Team</th><th>Month</th><th>Stock</th><th>Action</th><th>Side</th><th className="num">Qty</th><th>Status</th><th>Executed</th><th className="num">Price</th><th>Note</th><th /></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}>
              <td>{d.teamName[o.team_id]}</td><td>{o.month_n}</td><td>{o.symbol}</td><td>{o.action}</td><td>{o.side ?? "–"}</td>
              <td className="num">{o.target_quantity ? num(o.target_quantity, 0) : "all"}</td>
              <td><span className={`badge ${o.status}`}>{o.status}</span>{o.reject_source === "admin" && <span className="small muted"> (admin)</span>}</td>
              <td>{date(o.executed_date)}</td><td className="num">{num(o.executed_price, 4)}</td><td className="small">{o.reject_reason}</td>
              <td className="row" style={{ gap: 6 }}>
                {o.reject_source !== "admin" && o.status !== "cancelled" ? (
                  <button className="danger small" onClick={() => setOrder("orders", o.id, { status: "rejected", reject_source: "admin", reject_reason: "Rejected by the organiser (Art. 13)" })}>Reject</button>
                ) : (
                  <button className="secondary small" onClick={() => setOrder("orders", o.id, { status: "pending", reject_source: null, reject_reason: null })}>Restore</button>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 24 }}>Currency transfers</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Team</th><th>Month</th><th>Currency</th><th className="num">EUR</th><th>Status</th><th className="num">Rate</th><th /></tr></thead>
          <tbody>{d.transfers.map((t: any) => (
            <tr key={t.id}><td>{d.teamName[t.team_id]}</td><td>{t.month_n}</td><td>{t.currency}</td><td className="num">{num(t.eur_amount)}</td>
              <td><span className={`badge ${t.status}`}>{t.status}</span></td><td className="num">{num(t.rate, 4)}</td>
              <td>{t.reject_source !== "admin" && t.status !== "cancelled"
                ? <button className="danger small" onClick={() => setOrder("transfer_orders", t.id, { status: "rejected", reject_source: "admin", reject_reason: "Rejected by the organiser" })}>Reject</button>
                : <button className="secondary small" onClick={() => setOrder("transfer_orders", t.id, { status: "pending", reject_source: null, reject_reason: null })}>Restore</button>}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ market data
function MarketData() {
  const q = useLoad(async () => {
    const [p, f, e, i] = await Promise.all([
      must(supabase.from("prices").select("*").eq("source", "manual").order("date", { ascending: false }).limit(200)),
      must(supabase.from("fx_rates").select("*").eq("source", "manual").order("date", { ascending: false }).limit(200)),
      must(supabase.from("corporate_events").select("*").eq("source", "manual").order("date", { ascending: false }).limit(200)),
      must(supabase.from("instruments").select("*").order("symbol")),
    ]);
    return { prices: p as any[], fx: f as any[], events: e as any[], instruments: i as any[] };
  });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pf, setPf] = useState({ symbol: "", date: "", close: "" });
  const [ff, setFf] = useState({ currency: "", date: "", rate: "" });
  const [ef, setEf] = useState({ symbol: "", date: "", type: "dividend", value: "" });
  const [sym, setSym] = useState("");
  const done = (error: any, text: string) => { setMsg(error ? { kind: "err", text: errText(error) } : { kind: "ok", text }); q.reload(); };
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  return (
    <>
      <Notice kind="warn">Manual values always win over Yahoo Finance and the ECB for the same day (Art. 14). Prices are in the main currency unit (pounds, not pence). FX rates are units of currency per 1 EUR.</Notice>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="grid cols-3">
        <div className="card stack">
          <h3>Manual price</h3>
          <div><label htmlFor="ps">Symbol</label><input id="ps" value={pf.symbol} onChange={(e) => setPf({ ...pf, symbol: e.target.value.toUpperCase() })} /></div>
          <div><label htmlFor="pd">Date</label><input id="pd" type="date" value={pf.date} onChange={(e) => setPf({ ...pf, date: e.target.value })} /></div>
          <div><label htmlFor="pc">Close</label><input id="pc" inputMode="decimal" value={pf.close} onChange={(e) => setPf({ ...pf, close: e.target.value })} /></div>
          <button disabled={!pf.symbol || !pf.date || !(Number(pf.close) > 0)} onClick={async () => {
            const { error } = await supabase.from("prices").upsert({ symbol: pf.symbol, date: pf.date, close: Number(pf.close), source: "manual" });
            done(error, `Price saved for ${pf.symbol} on ${pf.date}.`);
          }}>Save price</button>
        </div>
        <div className="card stack">
          <h3>Manual FX rate</h3>
          <div><label htmlFor="fc">Currency</label><input id="fc" value={ff.currency} onChange={(e) => setFf({ ...ff, currency: e.target.value.toUpperCase() })} /></div>
          <div><label htmlFor="fd">Date</label><input id="fd" type="date" value={ff.date} onChange={(e) => setFf({ ...ff, date: e.target.value })} /></div>
          <div><label htmlFor="fr">Units per 1 EUR</label><input id="fr" inputMode="decimal" value={ff.rate} onChange={(e) => setFf({ ...ff, rate: e.target.value })} /></div>
          <button disabled={!/^[A-Z]{3}$/.test(ff.currency) || !ff.date || !(Number(ff.rate) > 0)} onClick={async () => {
            const { error } = await supabase.from("fx_rates").upsert({ currency: ff.currency, date: ff.date, rate: Number(ff.rate), source: "manual" });
            done(error, `Rate saved for ${ff.currency} on ${ff.date}.`);
          }}>Save rate</button>
        </div>
        <div className="card stack">
          <h3>Manual dividend / split</h3>
          <div><label htmlFor="es">Symbol</label><input id="es" value={ef.symbol} onChange={(e) => setEf({ ...ef, symbol: e.target.value.toUpperCase() })} /></div>
          <div className="row">
            <div className="field"><label htmlFor="ed">Ex-date</label><input id="ed" type="date" value={ef.date} onChange={(e) => setEf({ ...ef, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="et">Type</label><select id="et" value={ef.type} onChange={(e) => setEf({ ...ef, type: e.target.value })}><option value="dividend">Dividend per share</option><option value="split">Split ratio (new/old)</option></select></div>
          </div>
          <div><label htmlFor="ev">Value</label><input id="ev" inputMode="decimal" value={ef.value} onChange={(e) => setEf({ ...ef, value: e.target.value })} /></div>
          <button disabled={!ef.symbol || !ef.date || !Number(ef.value)} onClick={async () => {
            const { error } = await supabase.from("corporate_events").upsert({ symbol: ef.symbol, date: ef.date, type: ef.type, value: Number(ef.value), source: "manual" });
            done(error, `${ef.type} saved for ${ef.symbol}.`);
          }}>Save event</button>
        </div>
      </div>

      <div className="card">
        <h3>Manual entries</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Kind</th><th>Item</th><th>Date</th><th className="num">Value</th><th /></tr></thead>
          <tbody>
            {q.data.prices.map((p) => <tr key={`p${p.symbol}${p.date}`}><td>price</td><td>{p.symbol}</td><td>{p.date}</td><td className="num">{num(p.close, 4)}</td>
              <td><button className="danger small" onClick={async () => { const { error } = await supabase.from("prices").delete().match({ symbol: p.symbol, date: p.date, source: "manual" }); done(error, "Deleted."); }}>Delete</button></td></tr>)}
            {q.data.fx.map((f) => <tr key={`f${f.currency}${f.date}`}><td>fx</td><td>{f.currency}</td><td>{f.date}</td><td className="num">{num(f.rate, 4)}</td>
              <td><button className="danger small" onClick={async () => { const { error } = await supabase.from("fx_rates").delete().match({ currency: f.currency, date: f.date, source: "manual" }); done(error, "Deleted."); }}>Delete</button></td></tr>)}
            {q.data.events.map((e) => <tr key={`e${e.symbol}${e.date}${e.type}`}><td>{e.type}</td><td>{e.symbol}</td><td>{e.date}</td><td className="num">{num(e.value, 4)}</td>
              <td><button className="danger small" onClick={async () => { const { error } = await supabase.from("corporate_events").delete().match({ symbol: e.symbol, date: e.date, type: e.type, source: "manual" }); done(error, "Deleted."); }}>Delete</button></td></tr>)}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <h3>Instruments ({q.data.instruments.length})</h3>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="field narrow"><label htmlFor="vs">Check a Yahoo symbol</label><input id="vs" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="VOD.L" /></div>
          <button className="secondary" style={{ alignSelf: "flex-end" }} disabled={!sym} onClick={async () => {
            try { const r = await callFunction("market-data", { action: "validate", symbol: sym }); done(null, `${r.instrument.symbol}: ${r.instrument.name}, ${r.instrument.currency}, last ${num(r.lastPrice, 4)}`); }
            catch (e) { setMsg({ kind: "err", text: errText(e) }); }
          }}>Check & add</button>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Symbol</th><th>Name</th><th>Exchange</th><th>Currency</th><th className="num">Unit divisor</th></tr></thead>
          <tbody>{q.data.instruments.map((i) => <tr key={i.symbol}><td>{i.symbol}</td><td>{i.name}</td><td>{i.exchange}</td><td>{i.currency}</td><td className="num">{i.price_divisor}</td></tr>)}</tbody>
        </table></div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ settings
function romeOffset(localIso: string): string {
  const dt = new Date(localIso + "Z");
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", timeZoneName: "shortOffset" }).formatToParts(dt).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
  const h = m ? Number(m[1]) : 1;
  return `${h >= 0 ? "+" : "-"}${String(Math.abs(h)).padStart(2, "0")}:${m?.[2] ?? "00"}`;
}
const toRomeInput = (iso: string) => {
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  return s.replace(" ", "T");
};
const fromRomeInput = (local: string) => `${local}:59${romeOffset(local + ":59")}`;

function SettingsTab() {
  const q = useLoad(async () => ({
    settings: (await must(supabase.from("challenge_settings").select("*").eq("id", 1).single())) as Settings,
    months: (await must(supabase.from("challenge_months").select("*").order("n"))) as Month[],
  }));
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [s, setS] = useState<any>(null);
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  const cur = s ?? q.data.settings;
  const set = (k: string, v: unknown) => setS({ ...cur, [k]: v });
  return (
    <>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="card">
        <h3>Settings</h3>
        <div className="grid cols-4">
          <div><label htmlFor="s1">Capital (EUR)</label><input id="s1" value={cur.capital} onChange={(e) => set("capital", e.target.value)} /></div>
          <div><label htmlFor="s2">Risk-free rate (annual, e.g. 0.02)</label><input id="s2" value={cur.risk_free_annual} onChange={(e) => set("risk_free_annual", e.target.value)} /></div>
          <div><label htmlFor="s3">Short stop threshold (0.5 = +50%)</label><input id="s3" value={cur.stop_threshold} onChange={(e) => set("stop_threshold", e.target.value)} /></div>
          <div><label htmlFor="s4">Benchmark symbol</label><input id="s4" value={cur.benchmark_symbol} onChange={(e) => set("benchmark_symbol", e.target.value)} /></div>
          <div><label htmlFor="s5">Benchmark currency</label><input id="s5" value={cur.benchmark_currency} onChange={(e) => set("benchmark_currency", e.target.value.toUpperCase())} /></div>
          <div><label htmlFor="s6">Start date</label><input id="s6" type="date" value={cur.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
          <div><label htmlFor="s7">End date</label><input id="s7" type="date" value={cur.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
          <div><label htmlFor="s8">Regulation PDF link</label><input id="s8" value={cur.regulation_url ?? ""} onChange={(e) => set("regulation_url", e.target.value || null)} placeholder="https://…" /></div>
        </div>
        <button style={{ marginTop: 16 }} disabled={!s} onClick={async () => {
          const { error } = await supabase.from("challenge_settings").update({
            capital: Number(cur.capital), risk_free_annual: Number(cur.risk_free_annual), stop_threshold: Number(cur.stop_threshold),
            benchmark_symbol: cur.benchmark_symbol, benchmark_currency: cur.benchmark_currency, start_date: cur.start_date, end_date: cur.end_date,
            regulation_url: cur.regulation_url, updated_at: new Date().toISOString(),
          }).eq("id", 1);
          setMsg(error ? { kind: "err", text: errText(error) } : { kind: "ok", text: "Settings saved. They apply from the next engine run." });
          setS(null); q.reload();
        }}>Save settings</button>
      </div>
      <div className="card">
        <h3>Calendar</h3>
        <p className="muted small">Order deadlines are in Rome time. Orders of a month are executed at the first close on or after its start date; month-end valuation uses the end date.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Label</th><th>Start</th><th>End (valuation)</th><th>Order deadline (Rome)</th><th /></tr></thead>
          <tbody>{q.data.months.map((m) => <MonthRow key={m.n} m={m} onSaved={(t) => { setMsg(t); q.reload(); }} />)}</tbody>
        </table></div>
      </div>
    </>
  );
}

function MonthRow({ m, onSaved }: { m: Month; onSaved: (x: { kind: "ok" | "err"; text: string }) => void }) {
  const [v, setV] = useState({ start_date: m.start_date, end_date: m.end_date, deadline: toRomeInput(m.order_deadline) });
  const dirty = v.start_date !== m.start_date || v.end_date !== m.end_date || v.deadline !== toRomeInput(m.order_deadline);
  return (
    <tr>
      <td>{m.n}</td><td>{m.label}</td>
      <td><input aria-label="start" type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></td>
      <td><input aria-label="end" type="date" value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></td>
      <td><input aria-label="deadline" type="datetime-local" value={v.deadline} onChange={(e) => setV({ ...v, deadline: e.target.value })} /></td>
      <td><button className="small" disabled={!dirty} onClick={async () => {
        const { error } = await supabase.from("challenge_months").update({ start_date: v.start_date, end_date: v.end_date, order_deadline: fromRomeInput(v.deadline) }).eq("n", m.n);
        onSaved(error ? { kind: "err", text: errText(error) } : { kind: "ok", text: `${m.label} saved.` });
      }}>Save</button></td>
    </tr>
  );
}

// ------------------------------------------------------------------ engine
function Engine() {
  const runs = useLoad(async () => (await must(supabase.from("engine_runs").select("*").order("id", { ascending: false }).limit(40))) as any[]);
  const [asOf, setAsOf] = useState("");
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<any>(null);
  const [test, setTest] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="grid cols-2">
        <div className="card stack">
          <h3>Run the engine now</h3>
          <p className="muted small">It runs automatically at 22:30 and 05:30 UTC. Run it by hand after a manual correction. It recalculates everything from scratch.</p>
          <div className="row">
            <div className="field"><label htmlFor="ao">Valuation date (empty = today)</label><input id="ao" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
            <label className="row" style={{ alignSelf: "flex-end", gap: 6, fontWeight: 400 }}><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={skip} onChange={(e) => setSkip(e.target.checked)} /> skip download</label>
          </div>
          <button disabled={busy} onClick={async () => {
            setBusy(true); setOut(null);
            try { setOut(await callFunction("engine", { asOf: asOf || undefined, skipFetch: skip })); } catch (e) { setOut({ status: "error", log: [errText(e)], warnings: [] }); }
            setBusy(false); runs.reload();
          }}>{busy ? "Running…" : "Run engine"}</button>
          {out && <><span className={`badge ${out.status}`}>{out.status}</span><pre className="log">{[...(out.log ?? []), ...(out.warnings ?? []).map((w: string) => "WARNING " + w)].join("\n")}</pre></>}
        </div>
        <div className="card stack">
          <h3>Self-test of the deployed engine</h3>
          <p className="muted small">Runs the acceptance case verified against the organiser's Excel workbook inside the deployed function. It does not touch the database.</p>
          <button className="secondary" onClick={async () => { try { setTest(await callFunction("engine", { selftest: true })); } catch (e) { setTest({ pass: false, checks: [{ name: errText(e), pass: false }] }); } }}>Run self-test</button>
          {test && (
            <>
              <Notice kind={test.pass ? "ok" : "err"}>{test.pass ? `All ${test.checks.length} checks passed.` : "Some checks failed."}</Notice>
              <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}><table><tbody>{test.checks.map((c: any) => (
                <tr key={c.name}><td>{c.pass ? "PASS" : "FAIL"}</td><td className="small">{c.name}</td><td className="num small">{String(c.actual)}</td></tr>
              ))}</tbody></table></div>
            </>
          )}
        </div>
      </div>
      <div className="card">
        <h3>Engine runs</h3>
        {!runs.data ? <Loading /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Finished</th><th>Status</th><th>As of</th><th>Trigger</th><th className="num">Warnings</th><th /></tr></thead>
            <tbody>{runs.data.map((r) => (
              <Fragment key={r.id}>
                <tr><td>{dateTime(r.finished_at)}</td><td><span className={`badge ${r.status}`}>{r.status}</span></td><td>{r.as_of}</td><td className="small">{r.trigger}</td>
                  <td className="num">{(r.warnings ?? []).length}</td><td><button className="secondary small" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Hide" : "Details"}</button></td></tr>
                {open === r.id && <tr><td colSpan={6}><pre className="log">{[r.log, ...(r.warnings ?? []).map((w: string) => "WARNING " + w)].join("\n")}</pre></td></tr>}
              </Fragment>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ export
function Export() {
  const [msg, setMsg] = useState("");
  const items: [string, () => Promise<any[]>][] = [
    ["leaderboard", async () => must(supabase.from("leaderboard").select("*"))],
    ["orders", async () => must(supabase.from("orders").select("*, teams(name)").order("created_at"))],
    ["transfers", async () => must(supabase.from("transfer_orders").select("*, teams(name)").order("created_at"))],
    ["positions", async () => must(supabase.from("positions").select("*, teams(name)").order("entry_date"))],
    ["subportfolios", async () => must(supabase.from("subportfolios").select("*, teams(name)"))],
    ["nav_monthly", async () => must(supabase.from("nav_monthly").select("*, teams(name)").order("month_n"))],
    ["nav_daily", async () => must(supabase.from("nav_daily").select("*, teams(name)").order("date").limit(50000))],
    ["cash_ledger", async () => must(supabase.from("cash_ledger").select("*, teams(name)").order("date").limit(50000))],
  ];
  return (
    <div className="card">
      <h3>Download CSV</h3>
      <p className="muted small">Useful for an independent check with the organiser's Excel workbook. Opens in Excel (comma separated).</p>
      {msg && <Notice kind="err">{msg}</Notice>}
      <div className="row">
        {items.map(([name, f]) => (
          <button key={name} className="secondary" onClick={async () => {
            try {
              const rows = (await f()).map((r: any) => { const { teams, ...rest } = r; return teams ? { team: teams.name, ...rest } : rest; });
              download(`${name}_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
            } catch (e) { setMsg(errText(e)); }
          }}>{name}</button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>Total return values are fractions (0.0123 = {pct(0.0123)}).</p>
    </div>
  );
}
