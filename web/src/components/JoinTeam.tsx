import { useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Notice } from "./ui";

/** Shown to a signed-in member who is not in a team yet: join with the team code. */
export default function JoinTeam() {
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
  return (
    <div style={{ maxWidth: 480, margin: "40px auto" }}>
      <div className="auth-panel">
        <div className="eyebrow">Almost there</div>
        <h2 style={{ margin: "10px 0 8px" }}>Join your team</h2>
        <p className="sub">Signed in as {session?.user.email}. Enter the team code your president (or the organiser) gave you: you will join your association's team and see its portfolio.</p>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); join(); }}>
          <Notice kind="err">{err}</Notice>
          <div>
            <label htmlFor="jt-cd">Team code</label>
            <input id="jt-cd" autoComplete="off" spellCheck={false} required placeholder="XXXX-XXXX-XXXX" style={{ fontFamily: "var(--mono)", letterSpacing: "0.1em" }}
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </div>
          <button type="submit" disabled={busy || code.replace(/[^A-Z0-9]/g, "").length < 12}>{busy ? "Joining…" : "Join my team"}</button>
          <button type="button" className="linklike" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </form>
      </div>
    </div>
  );
}
