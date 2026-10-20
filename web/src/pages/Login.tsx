import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { codeEmail, normalizeCode } from "../lib/access";
import { Notice } from "../components/ui";

export default function Login() {
  const { session, isAdmin, team, loading } = useAuth();
  const [mode, setMode] = useState<"code" | "organiser">("code");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!loading && session) return <Navigate to={isAdmin && !team ? "/admin" : "/team"} replace />;

  async function signInWithCode() {
    const c = normalizeCode(code);
    if (c.length !== 12) return setErr("The access code has 12 characters, for example ABCD-EFGH-JKLM.");
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: await codeEmail(c), password: c });
    setBusy(false);
    if (error) setErr(error.message === "Invalid login credentials" ? "Access code not recognised. Check it or ask the organiser." : error.message);
  }

  return (
    <div className="card" style={{ maxWidth: 440, margin: "24px auto" }}>
      {mode === "code" ? (
        <>
          <h2>Team login</h2>
          <p className="muted small">Enter the access code of your team. You received it from the organiser: keep it within your team.</p>
          <Notice kind="err">{err}</Notice>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); signInWithCode(); }}>
            <div>
              <label htmlFor="code">Access code</label>
              <input id="code" className="code-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} required
                placeholder="XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </div>
            <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Enter"}</button>
          </form>
          <p className="small" style={{ marginTop: 20 }}>
            <button className="linklike" onClick={() => { setMode("organiser"); setErr(""); }}>Organiser sign-in</button>
          </p>
        </>
      ) : (
        <>
          <h2>Organiser sign-in</h2>
          <Notice kind="err">{err}</Notice>
          <form className="stack" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setErr("");
            const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
            setBusy(false);
            if (error) setErr(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
          }}>
            <div><label htmlFor="em">Email</label><input id="em" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          <p className="small" style={{ marginTop: 20 }}>
            <button className="linklike" onClick={() => { setMode("code"); setErr(""); }}>Back to team login</button>
          </p>
        </>
      )}
    </div>
  );
}
