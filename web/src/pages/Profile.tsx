import { useState } from "react";
import { Link } from "react-router-dom";
import { errText, supabase } from "../lib/supabase";
import { useLoad } from "../lib/data";
import { useAuth } from "../lib/auth";
import { Loading, Notice } from "../components/ui";
import PersonActivity from "../components/PersonActivity";

/** Personal area: profile (name, LinkedIn), Competition B team name vote, my stocks and moves. */
export default function Profile() {
  const { session, teams, refresh } = useAuth();
  const uid = session!.user.id;
  const prof = useLoad(async () => {
    const { data } = await supabase.from("profiles").select("first_name,last_name,linkedin_url").eq("user_id", uid).maybeSingle();
    return (data ?? { first_name: "", last_name: "", linkedin_url: null }) as { first_name: string; last_name: string; linkedin_url: string | null };
  }, [uid]);
  const teamB = teams.find((t) => t.competition === "B") ?? null;
  const teamA = teams.find((t) => t.competition === "A") ?? null;
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Personal area</div>
        <h1>{prof.data ? `${prof.data.first_name} ${prof.data.last_name}`.trim() || "My profile" : "My profile"}</h1>
        <p className="muted small" style={{ marginTop: 8 }}>
          {teamA ? <>Competition A: <b>{teamA.name}</b> ({teamA.role})</> : "Not in a Competition A team yet"}{" · "}
          {teamB ? <>Competition B: <b>{teamB.name}</b></> : "Competition B team not drawn yet"} · <Link to={`/participants/${uid}`}>See my public page</Link>
        </p>
      </div>
      <div className="grid cols-2">
        {prof.data ? <ProfileForm initial={prof.data} onSaved={() => { prof.reload(); refresh(); }} /> : <Loading />}
        {teamB ? <NameVote teamId={teamB.id} teamName={teamB.name} onRenamed={refresh} /> : (
          <div className="card"><h3>Competition B team name</h3><p className="muted small">When the organiser draws the Competition B teams you will be able to propose a name for yours here.</p></div>
        )}
      </div>
      <PersonActivity userId={uid} own />
    </>
  );
}

function ProfileForm({ initial, onSaved }: { initial: { first_name: string; last_name: string; linkedin_url: string | null }; onSaved: () => void }) {
  const [first, setFirst] = useState(initial.first_name);
  const [last, setLast] = useState(initial.last_name);
  const [li, setLi] = useState(initial.linkedin_url ?? "");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <h3>My profile</h3>
      <p className="muted small">Your name, association and LinkedIn appear in the public list of participants.</p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setMsg(null);
        const { error } = await supabase.rpc("update_my_profile", { p_first: first, p_last: last, p_linkedin: li });
        setBusy(false);
        if (error) return setMsg({ kind: "err", text: errText(error) });
        setMsg({ kind: "ok", text: "Profile saved." }); onSaved();
      }}>
        <div className="name-pair">
          <div><label htmlFor="pf-fn">First name</label><input id="pf-fn" required maxLength={40} value={first} onChange={(e) => setFirst(e.target.value)} /></div>
          <div><label htmlFor="pf-ln">Last name</label><input id="pf-ln" required maxLength={40} value={last} onChange={(e) => setLast(e.target.value)} /></div>
        </div>
        <div><label htmlFor="pf-li">LinkedIn profile (optional)</label><input id="pf-li" inputMode="url" placeholder="https://www.linkedin.com/in/your-name" value={li} onChange={(e) => setLi(e.target.value)} /></div>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>
    </div>
  );
}

function NameVote({ teamId, teamName, onRenamed }: { teamId: string; teamName: string; onRenamed: () => void }) {
  const { session } = useAuth();
  const q = useLoad(async () => {
    const { data, error } = await supabase.rpc("team_name_status", { p_team: teamId });
    if (error) throw new Error(error.message);
    return (data ?? []) as { user_id: string; name: string; proposal: string | null }[];
  }, [teamId]);
  const mine = q.data?.find((r) => r.user_id === session?.user.id)?.proposal ?? "";
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const value = name ?? mine;
  const agreeing = q.data ? q.data.filter((r) => r.proposal && r.proposal === value.trim()).length : 0;
  return (
    <div className="card">
      <h3>Competition B team name</h3>
      <p className="muted small">Your team is called <b>{teamName}</b>. Propose a new name: it changes only when <b>every member</b> proposes exactly the same name (same spelling, capitals and spaces).</p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <form className="row" onSubmit={async (e) => {
        e.preventDefault(); setMsg(null);
        const { data, error } = await supabase.rpc("propose_team_name", { p_team: teamId, p_name: value });
        if (error) return setMsg({ kind: "err", text: errText(error) });
        const r = data as any;
        if (r.error) setMsg({ kind: "warn", text: r.error });
        else if (r.renamed) { setMsg({ kind: "ok", text: `Everyone agreed: the team is now called "${r.name}".` }); onRenamed(); }
        else setMsg({ kind: "ok", text: `Proposal saved: ${r.agreed} of ${r.members} members propose this name.` });
        setName(null); q.reload();
      }}>
        <div className="field"><label htmlFor="bn">Proposed name</label><input id="bn" maxLength={40} value={value} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Bulls" /></div>
        <button type="submit" disabled={value.trim().length < 2} style={{ alignSelf: "flex-end" }}>Propose</button>
      </form>
      {q.data && (
        <div className="table-wrap" style={{ marginTop: 12 }}><table>
          <thead><tr><th>Member</th><th>Proposal</th></tr></thead>
          <tbody>{q.data.map((r) => (
            <tr key={r.user_id}><td>{r.name}</td><td>{r.proposal ? <span className={r.proposal === value.trim() ? "pos" : ""}>{r.proposal}</span> : <span className="muted small">no proposal yet</span>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {q.data && value.trim().length >= 2 && <p className="muted small" style={{ marginTop: 8 }}>{agreeing} of {q.data.length} members currently propose "{value.trim()}".</p>}
    </div>
  );
}
