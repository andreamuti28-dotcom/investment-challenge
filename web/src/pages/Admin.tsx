import { Link } from "react-router-dom";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { callFunction, errText, supabase } from "../lib/supabase";
import { must, useLoad, type Settings } from "../lib/data";
import { calendarMonths } from "../lib/months";
import { loadEdition } from "../lib/edition";
import { date, dateTime, download, num, pct, toCsv } from "../lib/format";
import { Loading, Notice, Tabs } from "../components/ui";

type Tab = "teams" | "accounts" | "orders" | "data" | "manual" | "settings" | "engine" | "visits" | "export";

export default function Admin() {
  const [tab, setTab] = useState<Tab>("teams");
  const [open, setOpen] = useState(0);
  useEffect(() => {
    const count = () => supabase.from("password_requests").select("id", { count: "exact", head: true }).eq("status", "open").then(({ count: c }) => setOpen(c ?? 0));
    count();
    window.addEventListener("ic-requests", count);
    return () => window.removeEventListener("ic-requests", count);
  }, []);
  return (
    <>
      <div className="page-head"><div className="eyebrow">Organiser</div><h1>Admin panel</h1></div>
      <Tabs value={tab} onChange={setTab} items={[["teams", "Teams"], ["accounts", open ? `Accounts (${open})` : "Accounts"], ["orders", "Orders"], ["data", "Market data"], ["manual", "Manual corrections"], ["settings", "Calendar & settings"], ["engine", "Engine"], ["visits", "Visits"], ["export", "Export"]]} />
      {tab === "teams" && <Teams />}
      {tab === "accounts" && <Accounts />}
      {tab === "visits" && <Visits />}
      {tab === "manual" && <MarketData manual />}
      {tab === "orders" && <Orders />}
      {tab === "data" && <MarketData />}
      {tab === "settings" && <SettingsTab />}
      {tab === "engine" && <Engine />}
      {tab === "export" && <Export />}
    </>
  );
}

// ------------------------------------------------------------------ teams
async function refreshResults() {
  // ranks and results of the other teams change when a team is removed
  try { await callFunction("engine", { skipFetch: true }); } catch { /* the scheduled run will catch up */ }
}

function Teams() {
  const q = useLoad(async () => {
    const [teams, contacts, access, members] = await Promise.all([
      must(supabase.from("teams").select("*").order("competition").order("name")),
      must(supabase.from("team_contacts").select("*")),
      must(supabase.from("team_access").select("team_id,code,updated_at")),
      must(supabase.from("team_members").select("team_id,role,full_name")),
    ]);
    const c = Object.fromEntries((contacts as any[]).map((x) => [x.team_id, x]));
    const a = Object.fromEntries((access as any[]).map((x) => [x.team_id, x]));
    const m = members as any[];
    return (teams as any[]).map((t) => ({
      ...t, contact: c[t.id] ?? {}, access: a[t.id] ?? null,
      members: m.filter((x) => x.team_id === t.id).length,
      president: m.find((x) => x.team_id === t.id && x.role === "president")?.full_name ?? null,
    }));
  });
  const empty = { name: "", competition: "A", university: "" };
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);

  async function addTeam() {
    setMsg(null); setBusy(true);
    const { data, error } = await supabase.from("teams").insert({
      name: form.name.trim(), competition: form.competition, university: form.university.trim() || null,
    }).select().single();
    if (error) { setBusy(false); return setMsg({ kind: "err", text: errText(error) }); }
    try {
      const r = await callFunction("admin", { action: "set_team_code", teamId: data.id });
      setMsg({ kind: "ok", text: <>Team <b>{data.name}</b> created. Team code: <span className="secret">{r.code}</span> Give it to the president (mark them in Accounts once they have registered): members join the team with it.</> });
    } catch (e) {
      setMsg({ kind: "err", text: `Team created, but the team code could not be generated: ${errText(e)}. Use "Generate code" in the table.` });
    }
    setForm(empty);
    setBusy(false);
    await q.reload();
    // value the new team at once (capital, leaderboard row) without waiting for the nightly run
    callFunction("engine", { skipFetch: true }).catch(() => {});
  }

  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  return (
    <>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="card">
        <h3>Add a team</h3>
        <p className="muted small">A team code is generated automatically. Give it to the president: everyone registers with their own account and joins the team with the code. You choose the president in the Accounts tab.</p>
        <div className="row">
          <div className="field"><label htmlFor="tn">Team name</label><input id="tn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field narrow"><label htmlFor="tcomp">Competition</label><select id="tcomp" value={form.competition} onChange={(e) => setForm({ ...form, competition: e.target.value })}><option value="A">A · Associations</option><option value="B">B · International</option></select></div>
          <div className="field"><label htmlFor="tu">Association / composition</label><input id="tu" value={form.university} onChange={(e) => setForm({ ...form, university: e.target.value })} /></div>
          <button style={{ alignSelf: "flex-end" }} disabled={busy || !form.name.trim()} onClick={addTeam}>{busy ? "Adding…" : "Add team"}</button>
        </div>
      </div>
      <DrawB reload={q.reload} setMsg={setMsg} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Team</th><th>Comp.</th><th>President</th><th className="num">Members</th><th>Team code</th><th className="num">Violations</th><th /></tr></thead>
          <tbody>
            {q.data.map((t: any) => <TeamRow key={t.id} t={t} reload={q.reload} setMsg={setMsg} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TeamRow({ t, reload, setMsg }: any) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const code: string | null = t.access?.code ?? null;
  async function setCode() {
    if (code && !window.confirm(`Replace the team code of ${t.name}? The old code stops working for new registrations; members already registered are not affected.`)) return;
    setBusy(true);
    try {
      const r = await callFunction("admin", { action: "set_team_code", teamId: t.id });
      setMsg({ kind: "ok", text: <>New team code for <b>{t.name}</b>: <span className="secret">{r.code}</span></> });
      setShow(true);
      await reload();
    } catch (e) { setMsg({ kind: "err", text: errText(e) }); }
    setBusy(false);
  }
  async function deleteTeam() {
    const typed = window.prompt(`This permanently deletes ${t.name} with its orders, positions, results and chat. The members' accounts stay. It cannot be undone.\n\nType the team name to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== t.name) return setMsg({ kind: "err", text: "The name did not match: nothing was deleted." });
    setBusy(true);
    try {
      const r = await callFunction("admin", { action: "delete_team", teamId: t.id });
      setMsg({ kind: "ok", text: `${t.name} deleted.` }); void r;
      await reload();
      refreshResults();
    } catch (e) { setMsg({ kind: "err", text: errText(e) }); }
    setBusy(false);
  }
  return (
    <tr>
      <td><input aria-label={`Name of ${t.name}`} className="name-edit" defaultValue={t.name}
        onBlur={async (e) => { const v = e.target.value.trim(); if (!v || v === t.name) { e.target.value = t.name; return; } const { error } = await supabase.from("teams").update({ name: v }).eq("id", t.id); setMsg(error ? { kind: "err", text: errText(error) } : { kind: "ok", text: `Renamed to ${v}.` }); reload(); }} />
        <div className="muted small">{t.university}</div></td>
      <td>{t.competition}</td>
      <td>{t.competition === "B" ? <span className="muted small">no president</span> : <>{t.president ? <b>{t.president}</b> : <span className="badge pending">not set</span>}<div className="muted small" style={{ marginTop: 4 }}>set in Accounts</div></>}</td>
      <td className="num">{t.members}</td>
      <td>
        {code ? (
          <div className="code-cell">
            <span className="secret">{show ? code : "••••-••••-••••"}</span>
            <button className="secondary small" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
            <button className="secondary small" onClick={async () => { try { await navigator.clipboard.writeText(code); setMsg({ kind: "ok", text: `Code of ${t.name} copied.` }); } catch { setShow(true); } }}>Copy</button>
            <button className="secondary small" disabled={busy} onClick={setCode}>New</button>
          </div>
        ) : (
          <button className="small" disabled={busy} onClick={setCode}>Generate code</button>
        )}
      </td>
      <td className="num">
        <input aria-label={`Violations of ${t.name}`} style={{ width: 70, minHeight: 32 }} type="number" min={0} defaultValue={t.violations}
          onBlur={async (e) => { const v = Number(e.target.value); if (v !== t.violations) { await supabase.from("teams").update({ violations: v }).eq("id", t.id); reload(); } }} />
      </td>
      <td>
        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <Link className="btn small" to={`/admin/team/${t.id}`}>Open portfolio</Link>
          <button className="danger small" disabled={busy} onClick={deleteTeam}>Delete team</button>
        </div>
      </td>
    </tr>
  );
}

// Competition B: random mixed teams
function DrawB({ reload, setMsg }: { reload: () => void; setMsg: (m: { kind: "ok" | "err"; text: ReactNode }) => void }) {
  const users = useLoad(async () => (await callFunction("admin", { action: "list_users" })).users as any[]);
  const [size, setSize] = useState(5);
  const [busy, setBusy] = useState(false);
  const pool = (users.data ?? []).filter((u) => u.kind !== "admin" && !u.teamBId);
  const drawn = (users.data ?? []).filter((u) => u.teamBId).length;
  const teamsOut = Math.floor(pool.length / Math.max(2, size));
  async function draw() {
    if (!window.confirm(`Draw ${teamsOut} Competition B team(s) of ${size}${pool.length % size ? `–${size + 1}` : ""} people from the ${pool.length} registered people without a B team?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("generate_b_teams", { p_size: size });
    setBusy(false);
    if (error) return setMsg({ kind: "err", text: errText(error) });
    setMsg({ kind: "ok", text: `${(data as any).teams} Competition B team(s) drawn for ${(data as any).people} people. Each team already has its chat.` });
    users.reload(); reload();
    callFunction("engine", { skipFetch: true }).catch(() => {});
  }
  async function undo() {
    const typed = window.prompt("This deletes EVERY Competition B team with its orders, results and chat (accounts stay). Type DELETE B to confirm:");
    if (typed === null) return;
    if (typed.trim() !== "DELETE B") return setMsg({ kind: "err", text: "Not confirmed: nothing was deleted." });
    setBusy(true);
    try { const r = await callFunction("admin", { action: "delete_b_teams" }); setMsg({ kind: "ok", text: `${r.deletedTeams} Competition B team(s) deleted.` }); }
    catch (e) { setMsg({ kind: "err", text: errText(e) }); }
    setBusy(false);
    users.reload(); reload(); refreshResults();
  }
  return (
    <div className="card draw-b">
      <h3>Competition B · random teams</h3>
      <p className="muted small">Every registered person can also play in Competition B. The draw puts everybody who is not in a B team yet into new teams of the size you choose (some get one person more when numbers do not divide exactly), spreading members of the same association over different teams. B teams have no president; each has its own chat. People who register later can be drawn again, or added by hand in Accounts.</p>
      {users.error ? <Notice kind="err">{users.error}</Notice> : !users.data ? <Loading /> : (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="stat"><div className="label">Waiting for a B team</div><div className="value">{pool.length}</div></div>
          <div className="stat"><div className="label">Already in a B team</div><div className="value">{drawn}</div></div>
          <div className="field narrow"><label htmlFor="bsz">People per team</label><input id="bsz" type="number" min={2} max={20} value={size} onChange={(e) => setSize(Math.max(2, Math.min(20, Number(e.target.value) || 2)))} /></div>
          <button disabled={busy || teamsOut < 1} onClick={draw}>{busy ? "Drawing…" : teamsOut < 1 ? `Need at least ${size} people` : `Draw ${teamsOut} team${teamsOut > 1 ? "s" : ""}`}</button>
          {drawn > 0 && <button className="danger" disabled={busy} onClick={undo}>Delete all B teams</button>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ accounts
function Accounts() {
  const q = useLoad(async () => (await callFunction("admin", { action: "list_users" })).users as any[]);
  const teams = useLoad(async () => must(supabase.from("teams").select("id,name,competition").order("competition").order("name")) as Promise<any[]>);
  async function setMembership(u: any, teamId: string, role: string) {
    if (!teamId) return;
    const t = (teams.data ?? []).find((x) => x.id === teamId);
    if (role === "president" && !window.confirm(`Make ${u.name ?? u.email} the president of ${t?.name}? The current president, if any, becomes a member. The president sees the team code and shares it with the members.`)) return;
    const { error } = await supabase.rpc("set_membership_admin", { p_user: u.id, p_team: teamId, p_role: role });
    setMsg(error ? { kind: "err", text: errText(error) } : { kind: "ok", text: `${u.name ?? u.email}: ${role} of ${t?.name}.` });
    await q.reload();
  }
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: ReactNode } | null>(null);
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  return (
    <>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <PasswordRequests users={q.data} onMessage={setMsg} />
      <h3 style={{ marginTop: 8 }}>All accounts</h3>
      <p className="muted small">Everyone registers with their own account as a member. Each person can be in one Competition A team (their association) and one Competition B team (drawn in the Teams tab). Here you move people between teams and choose the president of each association team (one per team): the president sees the team code and shares it; members can also join by themselves with the code. Deleting a member or president removes only that person: the team and its results stay. A deleted person can register again with the same e-mail. To remove a whole team, use "Delete team" in the Teams tab.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>E-mail</th><th>Team A (association)</th><th>Role in A</th><th>Team B</th><th>Created</th><th>Last sign-in</th><th /></tr></thead>
        <tbody>{q.data.map((u) => (
          <tr key={u.id}>
            <td>{u.name ?? "–"}{u.self && <span className="badge" style={{ marginLeft: 6 }}>you</span>}</td>
            <td className="small">{u.email}</td>
            <td>{u.kind === "admin" ? <span className="badge president">admin</span> : (
              <select aria-label={`Competition A team of ${u.email}`} className="mini" value={u.teamId ?? ""} onChange={(e) => setMembership(u, e.target.value, "member")}>
                {!u.teamId && <option value="">– choose –</option>}
                {(teams.data ?? []).filter((t) => t.competition === "A").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}</td>
            <td>{u.kind === "admin" || !u.teamId ? "–" : (
              <select aria-label={`Role of ${u.email}`} className="mini" value={u.kind} onChange={(e) => setMembership(u, u.teamId, e.target.value)}>
                <option value="member">member</option><option value="president">president</option>
              </select>
            )}</td>
            <td>{u.kind === "admin" ? "–" : (
              <select aria-label={`Competition B team of ${u.email}`} className="mini" value={u.teamBId ?? ""} onChange={(e) => setMembership(u, e.target.value, "member")}>
                {!u.teamBId && <option value="">– not drawn –</option>}
                {(teams.data ?? []).filter((t) => t.competition === "B").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}</td>
            <td className="small">{date(u.createdAt)}</td>
            <td className="small">{u.lastSignIn ? dateTime(u.lastSignIn) : "never"}</td>
            <td>{!u.self && (
              <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <button className="secondary small" onClick={async () => {
                  if (!window.confirm(`Create a new temporary password for ${u.email}? The current one stops working.`)) return;
                  try { const r = await callFunction("admin", { action: "reset_password", userId: u.id }); setMsg({ kind: "ok", text: <>New temporary password for {u.email}: <span className="secret">{r.password}</span> Send it privately; they can change it in My team &gt; Account.</> }); }
                  catch (e) { setMsg({ kind: "err", text: errText(e) }); }
                }}>Reset password</button>
                <button className="danger small" onClick={async () => {
                  if (!window.confirm(`Delete the account of ${u.name ?? u.email}? It cannot be undone.`)) return;
                  try { await callFunction("admin", { action: "delete_user", userId: u.id }); setMsg({ kind: "ok", text: `${u.email} deleted.` }); await q.reload(); }
                  catch (e) { setMsg({ kind: "err", text: errText(e) }); }
                }}>Delete</button>
              </div>
            )}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

// "Forgot password?" requests from the sign-in box
function PasswordRequests({ users, onMessage }: { users: any[]; onMessage: (m: { kind: "ok" | "err"; text: ReactNode }) => void }) {
  const q = useLoad(async () => must(supabase.from("password_requests").select("*").eq("status", "open").order("created_at", { ascending: false })) as Promise<any[]>);
  if (q.error || !q.data) return null;
  const close = async (id: string, status: "done" | "dismissed") => {
    await supabase.from("password_requests").update({ status, handled_at: new Date().toISOString() }).eq("id", id);
    await q.reload();
    window.dispatchEvent(new Event("ic-requests"));
  };
  return (
    <div className={`card ${q.data.length ? "requests" : ""}`}>
      <h3>Password reset requests {q.data.length > 0 && <span className="badge pending" style={{ marginLeft: 6 }}>{q.data.length} open</span>}</h3>
      {q.data.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No open requests. When someone clicks "Forgot password?" you get an e-mail and the request appears here.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>E-mail</th><th>Team</th><th>Requested</th><th /></tr></thead>
          <tbody>{q.data.map((r) => (
            <tr key={r.id}>
              <td>{r.name ?? "–"}</td><td className="small">{r.email}</td><td>{r.team ?? "–"}</td><td className="small">{dateTime(r.created_at)}</td>
              <td><div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <button className="small" onClick={async () => {
                  const userId = r.user_id ?? users.find((u) => u.email?.toLowerCase() === r.email)?.id;
                  if (!userId) { onMessage({ kind: "err", text: "This account no longer exists." }); await close(r.id, "dismissed"); return; }
                  if (!window.confirm(`Create a temporary password for ${r.email}? Their account, team and portfolio stay as they are.`)) return;
                  try {
                    const res = await callFunction("admin", { action: "reset_password", userId });
                    onMessage({ kind: "ok", text: <>Temporary password for {r.email}: <span className="secret">{res.password}</span> Send it privately: they sign in with it and choose a new one in My team &gt; Account.</> });
                    await close(r.id, "done");
                  } catch (e) { onMessage({ kind: "err", text: errText(e) }); }
                }}>Reset password</button>
                <button className="secondary small" onClick={() => close(r.id, "dismissed")}>Dismiss</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ visits
function Visits() {
  const q = useLoad(async () => {
    const { data, error } = await supabase.rpc("visit_stats");
    if (error) throw new Error(error.message);
    return data as any;
  });
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  const s = q.data;
  return (
    <>
      <p className="muted small">Anonymous and aggregate: only visitors who accepted the statistics cookies are counted, one visit per browser session. Useful for the sponsor report.</p>
      <div className="card dark"><div className="grid cols-3">
        <div className="stat"><div className="label">Visits</div><div className="value">{num(s.visits, 0)}</div></div>
        <div className="stat"><div className="label">Unique visitors</div><div className="value">{num(s.visitors, 0)}</div></div>
        <div className="stat"><div className="label">Visits, last 30 days</div><div className="value">{num(s.last30, 0)}</div></div>
      </div></div>
      <div className="grid cols-2">
        <div className="card">
          <h3>By day (last 60 days)</h3>
          {(s.daily ?? []).length === 0 ? <p className="muted">No visits yet.</p> : (
            <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}><table>
              <thead><tr><th>Day</th><th className="num">Visits</th><th className="num">Visitors</th></tr></thead>
              <tbody>{[...(s.daily ?? [])].reverse().map((r: any) => <tr key={r.day}><td>{date(r.day)}</td><td className="num">{r.visits}</td><td className="num">{r.visitors}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <h3>Landing pages</h3>
          {s.pages.length === 0 ? <p className="muted">No visits yet.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Page</th><th className="num">Visits</th></tr></thead>
              <tbody>{s.pages.map((r: any) => <tr key={r.path}><td>{r.path}</td><td className="num">{r.visits}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ orders
function Orders() {
  const [month, setMonth] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const q = useLoad(async () => {
    const [orders, teams, settings] = await Promise.all([
      must(supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(5000)),
      must(supabase.from("teams").select("id,name")),
      must(supabase.from("challenge_settings").select("start_date,end_date").eq("id", 1).single()),
    ]);
    return { orders: orders as any[], teamName: Object.fromEntries((teams as any[]).map((t) => [t.id, t.name])), months: calendarMonths((settings as any).start_date, (settings as any).end_date) };
  });
  const [msg, setMsg] = useState("");
  const rows = useMemo(() => (q.data?.orders ?? []).filter((o) => (month === "all" || String(o.month_n) === month) && (status === "all" || o.status === status)), [q.data, month, status]);
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  const d = q.data;
  async function setOrder(table: "orders", id: string, patch: Record<string, unknown>) {
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
          <thead><tr><th>Team</th><th>Placed</th><th>Close of</th><th>Stock</th><th>Action</th><th>Side</th><th className="num">Qty</th><th>Status</th><th>Executed</th><th className="num">Price</th><th>Note</th><th /></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}>
              <td>{d.teamName[o.team_id]}</td><td className="small">{dateTime(o.created_at)}</td><td>{date(o.exec_date)}</td><td>{o.symbol}</td><td>{o.action}</td><td>{o.side ?? "–"}</td>
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
    </>
  );
}

// ------------------------------------------------------------------ market data
function MarketData({ manual = false }: { manual?: boolean }) {
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
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {manual && <>
      <p className="muted small">Use these only when the engine reports a wrong or missing price, exchange rate or dividend. A manual value replaces Yahoo Finance or the ECB for that day; then press "Run engine" in the Engine tab.</p>
      <Notice kind="warn">Manual values always win over Yahoo Finance and the ECB for the same day (Art. 14). Prices are in the main currency unit (pounds, not pence). FX rates are units of currency per 1 EUR.</Notice>
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
      </>}

      {!manual && <div className="card">
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
      </div>}
    </>
  );
}

// ------------------------------------------------------------------ settings
function SettingsTab() {
  const q = useLoad(async () => ({
    settings: (await must(supabase.from("challenge_settings").select("*").eq("id", 1).single())) as Settings,
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
          <div><label htmlFor="s5">Benchmark currency (of its listing: SWDA.L is in GBP)</label><input id="s5" value={cur.benchmark_currency} onChange={(e) => set("benchmark_currency", e.target.value.toUpperCase())} /></div>
          <div><label htmlFor="s6">Start date</label><input id="s6" type="date" value={cur.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
          <div><label htmlFor="s7">End date</label><input id="s7" type="date" value={cur.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
          <div><label htmlFor="s9">Edition (starting year)</label><input id="s9" type="number" min={2000} max={2100} value={cur.edition_year ?? 2026} onChange={(e) => set("edition_year", e.target.value)} /><p className="small muted" style={{ margin: "4px 0 0" }}>Shown everywhere as {(() => { const y = Number(cur.edition_year) || 2026; return `${String(y % 100).padStart(2, "0")}/${String((y + 1) % 100).padStart(2, "0")}`; })()}</p></div>
          <div><label htmlFor="s10">Start date shown on the website</label><input id="s10" type="date" value={cur.public_start_date ?? ""} onChange={(e) => set("public_start_date", e.target.value || null)} /><p className="small muted" style={{ margin: "4px 0 0" }}>Key dates on the home page. The start date above drives the calculations.</p></div>
          <div><label htmlFor="s11">Registration deadline</label><input id="s11" type="date" value={cur.registration_deadline ?? ""} onChange={(e) => set("registration_deadline", e.target.value)} /></div>
          <div><label htmlFor="s8">Regulation PDF link</label><input id="s8" value={cur.regulation_url ?? ""} onChange={(e) => set("regulation_url", e.target.value || null)} placeholder="https://…" /></div>
        </div>
        <button style={{ marginTop: 16 }} disabled={!s} onClick={async () => {
          const { error } = await supabase.from("challenge_settings").update({
            capital: Number(cur.capital), risk_free_annual: Number(cur.risk_free_annual), stop_threshold: Number(cur.stop_threshold),
            benchmark_symbol: cur.benchmark_symbol, benchmark_currency: cur.benchmark_currency, start_date: cur.start_date, end_date: cur.end_date,
            regulation_url: cur.regulation_url, edition_year: Number(cur.edition_year) || 2026, public_start_date: cur.public_start_date || null,
            registration_deadline: cur.registration_deadline, updated_at: new Date().toISOString(),
          }).eq("id", 1);
          if (error) { setMsg({ kind: "err", text: errText(error) }); return; }
          loadEdition(true);
          setMsg({ kind: "ok", text: "Settings saved. Recalculating everything with the new settings…" });
          setS(null); q.reload();
          try {
            const r = await callFunction("engine", {});
            setMsg({ kind: r.status === "error" ? "err" : "ok", text: `Settings saved and results recalculated (${r.status}). ${(r.warnings ?? []).slice(0, 3).join(" · ")}` });
          } catch (e) { setMsg({ kind: "err", text: `Settings saved, but the recalculation failed: ${errText(e)}. Run it from the Engine tab.` }); }
        }}>Save settings</button>
      </div>
      <div className="card">
        <h3>Calendar</h3>
        <p className="muted small">Calculated from the start and end dates above: month 1 starts on the start date, every month is valued on its last weekday. Results before the start date are not calculated; orders placed earlier are executed at the close of the start date. Changing the start date recalculates the whole challenge from that day.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Month</th><th>From</th><th>Valuation date</th></tr></thead>
          <tbody>{calendarMonths(cur.start_date, cur.end_date).map((m) => <tr key={m.n}><td>{m.n}</td><td>{m.label}</td><td>{date(m.start_date)}</td><td>{date(m.end_date)}</td></tr>)}</tbody>
        </table></div>
      </div>
    </>
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
    ["positions", async () => must(supabase.from("positions").select("*, teams(name)").order("entry_date"))],
    ["subportfolios", async () => must(supabase.from("subportfolios").select("*, teams(name)"))],
    ["nav_monthly", async () => must(supabase.from("nav_monthly").select("*, teams(name)").order("month_n"))],
    ["nav_daily", async () => must(supabase.from("nav_daily").select("*, teams(name)").order("date").limit(50000))],
    ["cash_ledger", async () => must(supabase.from("cash_ledger").select("*, teams(name)").order("date").limit(50000))],
  ];
  const teams = useLoad(async () => must(supabase.from("teams").select("id,name,competition,university").order("name")));
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  async function excel(id?: string) {
    setBusy(id ?? "all"); setMsg("");
    try { const { downloadReport } = await import("../lib/excel"); await downloadReport(id); }
    catch (e) { setMsg(errText(e)); }
    setBusy(null);
  }
  return (
    <>
    <div className="card">
      <h3>Excel reports</h3>
      <p className="muted small">Formatted workbooks with summary, sub-portfolios by currency, open and closed positions, orders, monthly and daily performance, cash movements. Totals, returns and P&amp;L are live Excel formulas.</p>
      {msg && <Notice kind="err">{msg}</Notice>}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <button disabled={!!busy} onClick={() => excel()}>{busy === "all" ? "Preparing…" : "Whole challenge (all teams)"}</button>
        <div className="field narrow" style={{ minWidth: 240 }}>
          <label htmlFor="xt">Single team</label>
          <select id="xt" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Choose a team…</option>
            {(teams.data as any[] ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.university ? ` · ${t.university}` : ""} ({t.competition})</option>)}
          </select>
        </div>
        <button className="secondary" disabled={!team || !!busy} onClick={() => excel(team)}>{busy === team && team ? "Preparing…" : "Download team report"}</button>
      </div>
    </div>
    <div className="card">
      <h3>Raw data (CSV)</h3>
      <p className="muted small">One table per file, for an independent check. Opens in Excel (comma separated).</p>
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
    </>
  );
}
