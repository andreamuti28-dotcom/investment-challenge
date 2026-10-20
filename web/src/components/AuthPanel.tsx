import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { callFunction, errText, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Notice } from "./ui";

type Mode = "signin" | "register";
type Role = "president" | "member";

/** White sign-in / registration card shown over the hero image. */
export default function AuthPanel({ initial = "signin" }: { initial?: Mode }) {
  const { session, isAdmin, team } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>(initial);
  const [role, setRole] = useState<Role>("member");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (session) {
    return (
      <div className="auth-panel auth-welcome" id="access">
        <div className="eyebrow" style={{ color: "#26324a" }}>Signed in</div>
        <div className="who" style={{ margin: "8px 0 4px" }}>{team ? team.name : "Organiser"}</div>
        <p className="sub">{session.user.email}{team ? ` · ${team.role}` : ""}</p>
        <div className="stack">
          {team && <Link className="btn primary" to="/team">Open my portfolio</Link>}
          {isAdmin && <Link className="btn primary" to="/admin">Open the admin panel</Link>}
          <Link className="btn secondary" style={{ width: "100%", color: "#0b0e14", borderColor: "#cfd5de" }} to="/leaderboard">See the leaderboard</Link>
          <button className="linklike" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  async function signIn() {
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setErr(error.message === "Invalid login credentials" ? "Wrong e-mail or password." : error.message);
    nav("/team");
  }

  async function register() {
    if (password.length < 8) return setErr("The password must have at least 8 characters.");
    setBusy(true); setErr("");
    try {
      await callFunction("register", { role, name, email: email.trim(), password, code: role === "member" ? code : undefined });
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      nav("/team");
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }

  return (
    <div className="auth-panel" id="access">
      <div className="auth-tabs" role="tablist">
        <button role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => { setMode("signin"); setErr(""); }}>Sign in</button>
        <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); setErr(""); }}>Register</button>
      </div>
      <Notice kind="err">{err}</Notice>

      {mode === "signin" ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); signIn(); }}>
          <div><label htmlFor="si-em">E-mail</label><input id="si-em" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label htmlFor="si-pw">Password</label><input id="si-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <p className="sub" style={{ margin: 0 }}>Forgot your password? Ask the organiser for a new one.</p>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); register(); }}>
          <div>
            <label>I am registering as</label>
            <div className="role-pick" role="radiogroup" aria-label="Role">
              <button type="button" role="radio" aria-checked={role === "president"} className={role === "president" ? "on" : ""} onClick={() => setRole("president")}>
                President<small>Your e-mail was given to the organiser</small>
              </button>
              <button type="button" role="radio" aria-checked={role === "member"} className={role === "member" ? "on" : ""} onClick={() => setRole("member")}>
                Member<small>You have the team code from your president</small>
              </button>
            </div>
          </div>
          <div><label htmlFor="rg-nm">Full name</label><input id="rg-nm" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label htmlFor="rg-em">E-mail{role === "president" ? " (the one registered by the organiser)" : ""}</label><input id="rg-em" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label htmlFor="rg-pw">Password (at least 8 characters)</label><input id="rg-pw" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {role === "member" && (
            <div>
              <label htmlFor="rg-cd">Team code</label>
              <input id="rg-cd" autoComplete="off" spellCheck={false} required placeholder="XXXX-XXXX-XXXX" style={{ fontFamily: "var(--mono)", letterSpacing: "0.1em" }}
                value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </div>
          )}
          <button type="submit" disabled={busy}>{busy ? "Creating your account…" : role === "president" ? "Register as president" : "Join my team"}</button>
          <p className="sub" style={{ margin: 0 }}>By registering you accept the <Link to="/privacy" style={{ color: "#26324a" }}>privacy notice</Link>.</p>
        </form>
      )}
    </div>
  );
}
