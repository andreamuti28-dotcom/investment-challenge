import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { errText, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/data";
import { eur, pct, signClass } from "../lib/format";
import { Loading, Notice } from "../components/ui";
import { PracticeBanner } from "../components/PracticeBanner";
import JoinTeam from "../components/JoinTeam";

type Comp = "A" | "B" | "C";
const INFO: Record<Comp, { title: string; text: string }> = {
  A: { title: "Association team", text: "Your association's portfolio, managed with your fellow members." },
  B: { title: "International team", text: "A mixed team drawn by the organiser, with students of other associations." },
  C: { title: "Individual", text: "Your own € 1,000,000 portfolio, with as many stocks as you like." },
};

/** First screen after signing in: choose the competition; everything after refers to it. */
export default function Hub() {
  const auth = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ids = auth.teams.map((t) => t.id).join(",");
  const stats = useLoad(async () => {
    if (!ids) return {} as Record<string, any>;
    const { data } = await supabase.from("leaderboard").select("team_id,nav,total_return,rank_in_competition,invested_share").in("team_id", ids.split(","));
    return Object.fromEntries(((data ?? []) as any[]).map((r) => [r.team_id, r])) as Record<string, any>;
  }, [ids]);

  if (auth.loading) return <Loading />;
  if (!auth.session) return <Navigate to="/login" replace />;
  if (auth.isAdmin) return <Navigate to="/admin" replace />;

  const enter = (c: Comp) => { auth.setCompetition(c); nav("/team"); };
  async function openC() {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("join_competition_c");
    if (error) { setBusy(false); return setErr(errText(error)); }
    await auth.refresh();
    setBusy(false);
    enter("C");
  }

  return (
    <div className="hub">
      <div className="page-head">
        <div className="eyebrow">Welcome{auth.session.user.email ? ` · ${auth.session.user.email}` : ""}</div>
        <h1>Choose your competition.</h1>
        <p className="muted" style={{ marginTop: 8 }}>Everything you do next (portfolio, orders, chat, leaderboard) refers to the competition you choose. You can switch at any time from the top bar.</p>
      </div>
      <PracticeBanner />
      {err && <Notice kind="err">{err}</Notice>}
      <div className="hub-grid">
        {(["A", "B", "C"] as Comp[]).map((c) => {
          const t = auth.teams.find((x) => x.competition === c);
          const st = t ? stats.data?.[t.id] : null;
          return (
            <div key={c} className={`hub-card ${t ? "ready" : ""} ${auth.competition === c ? "current" : ""}`}>
              <div className="hub-top">
                <span className="hub-letter">{c}</span>
                <div><div className="eyebrow">Competition {c}</div><h3>{INFO[c].title}</h3></div>
              </div>
              <p className="muted small">{INFO[c].text}</p>
              {t ? (
                <>
                  <div className="hub-team"><b>{c === "C" ? "My portfolio" : t.name}</b>{c === "A" && <span className="muted small"> · {t.role}</span>}</div>
                  {st && (
                    <div className="hub-stats">
                      <div><span className="muted small">Value</span><b>{eur(st.nav, 0)}</b></div>
                      <div><span className="muted small">Return</span><b className={signClass(st.total_return)}>{pct(st.total_return)}</b></div>
                      <div><span className="muted small">Rank</span><b>{st.rank_in_competition ?? "–"}</b></div>
                    </div>
                  )}
                  <button type="button" className="hub-go" onClick={() => enter(c)}>Enter competition {c} →</button>
                </>
              ) : c === "A" ? (
                <div className="hub-join">
                  <p className="small" style={{ margin: "0 0 8px" }}>Join your association's team with the code your president gave you.</p>
                  <JoinTeam inline />
                </div>
              ) : c === "B" ? (
                <p className="hub-wait small">Not drawn yet: the organiser draws the international teams after registrations close. Yours will appear here.</p>
              ) : (
                <button type="button" className="hub-go" disabled={busy} onClick={openC}>{busy ? "Opening…" : "Open my individual portfolio →"}</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
