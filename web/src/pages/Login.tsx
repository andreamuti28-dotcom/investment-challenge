import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Notice } from "../components/ui";

export default function Login() {
  const { session, isAdmin, team, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!loading && session) return <Navigate to={isAdmin && !team ? "/admin" : "/team"} replace />;
  return (
    <div className="card" style={{ maxWidth: 440, margin: "24px auto" }}>
      <h2>Team login</h2>
      <p className="muted small">Accounts are created by the organiser. Use the email and the temporary password you received, then change it from the Account tab.</p>
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
    </div>
  );
}
