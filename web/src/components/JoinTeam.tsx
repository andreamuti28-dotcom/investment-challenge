import { useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Notice } from "./ui";

/** Shown to a signed-in member who is not in a team yet: join with the team code. */
export default function JoinTeam({ inline = false }: { inline?: boolean } = {}) {
  const { session, refresh } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function join() {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("join_with_code", { p_code: code });
    setBusy(false);
    if (error) return setErr(errText(error));
    if ((data as any)?.error) return setErr((data as any).error);
    await refresh();
  }
  const form = (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); join(); }}>
      <Notice kind="err">{err}</Notice>
      <div>
        <label htmlFor="jt-cd">Team code</label>
        <input id="jt-cd" autoComplete="off" spellCheck={false} required placeholder="XXXX-XXXX-XXXX" style={{ fontFamily: "var(--mono)", letterSpacing: "0.1em" }}
          value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </div>
      <button type="submit" disabled={busy || code.replace(/[^A-Z0-9]/g, "").length < 12}>{busy ? "Joining…" : "Join my team"}</button>
      {!inline && <button type="button" className="linklike" onClick={() => supabase.auth.signOut()}>Sign out</button>}
    </form>
  );
  if (inline) return form;
  return (
    <div style={{ maxWidth: 480, margin: "40px auto" }}>
      <div className="auth-panel">
        <div className="eyebrow">Almost there</div>
        <h2 style={{ margin: "10px 0 8px" }}>Join your team</h2>
        <p className="sub">Signed in as {session?.user.email}. Enter the team code your president (or the organiser) gave you to join your association's team. Competition B teams are drawn by the organiser: yours will appear here automatically.</p>
        {form}
        <div className="stack" style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <p className="sub" style={{ margin: 0 }}>You can also play on your own: open your individual € 1,000,000 portfolio (Competition C), with as many stocks as you like.</p>
          <button type="button" className="secondary" disabled={busy} onClick={async () => {
            if (!window.confirm("Open your individual portfolio (Competition C)?\n\nIt is a separate € 1,000,000 portfolio in your own name, besides your association team: you trade it alone, with as many stocks as you like, and it is ranked only once at least half of it is invested. It appears with your name in the participants list.")) return;
            setBusy(true); setErr("");
            const { error } = await supabase.rpc("join_competition_c");
            setBusy(false);
            if (error) return setErr(errText(error));
            await refresh();
          }}>Open my individual portfolio</button>
        </div>
      </div>
    </div>
  );
}
