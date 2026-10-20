import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { errText, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Notice } from "../components/ui";

/** Landing page of the password recovery e-mail: the link signs the user in, here they choose a new password. */
export default function ResetPassword() {
  const { session, loading, team, isAdmin } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(t); }, []);

  async function save() {
    if (pw.length < 8) return setErr("The password must have at least 8 characters.");
    if (pw !== pw2) return setErr("The two passwords do not match.");
    setBusy(true); setErr("");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(errText(error));
    nav(team ? "/team" : isAdmin ? "/admin" : "/", { replace: true });
  }

  return (
    <div className="hero-full" style={{ minHeight: "calc(100svh - 64px)", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 440, margin: "0 auto", padding: "40px 16px" }}>
        <div className="auth-panel">
          <div className="eyebrow">Password recovery</div>
          <h2 style={{ margin: "10px 0 14px" }}>Choose a new password</h2>
          {!session ? (
            loading || !waited ? <p className="sub">Checking the link…</p> : (
              <div className="stack">
                <Notice kind="err">This link is not valid or has expired. Ask for a new one from the sign-in box.</Notice>
                <Link className="btn primary" to="/">Back to the home page</Link>
              </div>
            )
          ) : (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <Notice kind="err">{err}</Notice>
              <p className="sub" style={{ margin: 0 }}>Account: {session.user.email}</p>
              <div><label htmlFor="np1">New password (at least 8 characters)</label><input id="np1" type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
              <div><label htmlFor="np2">Repeat the new password</label><input id="np2" type="password" autoComplete="new-password" minLength={8} required value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
              <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save and sign in"}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
