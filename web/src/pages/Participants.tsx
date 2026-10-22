import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { LinkedIn } from "../components/LinkedIn";
import { useLoad } from "../lib/data";
import { pct, signClass } from "../lib/format";
import { Loading, Notice, Tabs } from "../components/ui";
import PersonActivity from "../components/PersonActivity";

interface P { user_id: string; first_name: string; last_name: string; linkedin_url: string | null; team_a: string | null; association: string | null; role: string | null; team_b: string | null; team_c_id: string | null; rank_c: number | null; return_c: number | null }

const loadAll = async () => {
  const { data, error } = await supabase.rpc("participants_list");
  if (error) throw new Error(error.message);
  return (data ?? []) as P[];
};

/** Public list of every participant, with association, role, Competition B team and LinkedIn. */
export default function Participants() {
  const q = useLoad(loadAll);
  const nav = useNavigate();
  const [find, setFind] = useState("");
  const [view, setView] = useState<"all" | "A" | "B" | "C">("all");
  const rows = useMemo(() => {
    const f = find.trim().toLowerCase();
    return (q.data ?? []).filter((p) => (view === "all" || (view === "A" ? p.team_a : view === "B" ? p.team_b : p.team_c_id))
      && (!f || [p.first_name, p.last_name, p.team_a, p.association, p.team_b].some((x) => (x ?? "").toLowerCase().includes(f))));
  }, [q.data, find, view]);
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  return (
    <>
      <div className="row spread page-head">
        <div><div className="eyebrow">Participants</div><h1>Who is playing.</h1></div>
        <p className="muted small">{q.data.length} participants · click a name to see their stocks and moves</p>
      </div>
      <div className="row" style={{ gap: 12, marginBottom: 12, alignItems: "center" }}>
        <input aria-label="Search participants" placeholder="Search a name, team or association…" value={find} onChange={(e) => setFind(e.target.value)} style={{ maxWidth: 360 }} />
        <Tabs value={view} onChange={setView} items={[["all", "Everyone"], ["A", "Competition A"], ["B", "Competition B"], ["C", "Individual portfolios (C)"]]} />
      </div>
      {rows.length === 0 ? <p className="muted">No participants found.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>First name</th><th>Last name</th><th>Association (team A)</th><th>Role</th><th>Team B</th><th>Individual portfolio (C)</th><th>LinkedIn</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.user_id} className="clickable" onClick={() => nav(`/participants/${p.user_id}`)}>
              <td><b>{p.first_name}</b></td><td><b>{p.last_name}</b></td>
              <td>{p.team_a ?? <span className="muted small">–</span>}{p.association && p.association !== p.team_a && <div className="muted small">{p.association}</div>}</td>
              <td>{p.role ? <span className={`badge ${p.role === "president" ? "president" : ""}`}>{p.role}</span> : <span className="muted small">–</span>}</td>
              <td>{p.team_b ?? <span className="muted small">not drawn yet</span>}</td>
              <td>{!p.team_c_id ? <span className="muted small">–</span> : p.rank_c ? <><b>#{p.rank_c}</b> <span className={signClass(p.return_c)}>{pct(p.return_c)}</span></> : <span className="muted small">opened, not invested yet</span>}</td>
              <td><LinkedIn url={p.linkedin_url} small /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

/** One participant: details, stocks and executed moves (public). */
export function Participant() {
  const { id } = useParams();
  const q = useLoad(loadAll);
  if (q.error) return <Notice kind="err">{q.error}</Notice>;
  if (!q.data) return <Loading />;
  const p = q.data.find((x) => x.user_id === id);
  if (!p) return <Notice kind="err">Participant not found. <Link to="/participants">Back to the list</Link></Notice>;
  return (
    <>
      <div className="row spread page-head">
        <div>
          <div className="eyebrow"><Link to="/participants">Participants</Link> · {p.role ?? "participant"}</div>
          <h1>{p.first_name} {p.last_name}</h1>
          <p className="muted small" style={{ marginTop: 8 }}>
            Competition A: <b>{p.team_a ?? "–"}</b>{p.association && p.association !== p.team_a ? ` (${p.association})` : ""} · Competition B: <b>{p.team_b ?? "not drawn yet"}</b> · Individual (C): <b>{!p.team_c_id ? "–" : p.rank_c ? `#${p.rank_c} (${pct(p.return_c)})` : "opened, not invested yet"}</b>
          </p>
        </div>
        <LinkedIn url={p.linkedin_url} />
      </div>
      <PersonActivity key={id} userId={id!} />
    </>
  );
}
