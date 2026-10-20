import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { callFunction, errText, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Notice } from "./ui";

type Mode = "signin" | "register" | "forgot";

/** Sign-in / registration / password recovery card shown over the hero image. */
export default function AuthPanel({ initial = "signin" }: { initial?: Mode }) {
  const { session, isAdmin, team } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>(initial);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"ask" | "form" | "sent">("ask");
  // Browsers must not fill the sign-in fields by themselves: until the user clicks or tabs into
  // one, the form has no login fields at all for the password manager (plain read-only text
  // inputs with autocomplete off); then they become e-mail/password and saved logins are offered.
  const [armed, setArmed] = useState(false);
  const arm = { readOnly: !armed, onMouseDown: () => setArmed(true), onTouchStart: () => setArmed(true), onFocus: () => setArmed(true) };

  if (session) {
    return (
      <div className="auth-panel auth-welcome" id="access">
        <div className="eyebrow">Signed in</div>
        <div className="who" style={{ margin: "8px 0 4px" }}>{team ? team.name : isAdmin ? "Organiser" : "Welcome"}</div>
        <p className="sub">{session.user.email}{team ? ` · ${team.role}` : ""}</p>
        <div className="stack">
          {team && <Link className="btn primary" to="/team">Open my portfolio</Link>}
          {!team && !isAdmin && <Link className="btn primary" to="/team">Join your team with the code</Link>}
          {isAdmin && <Link className="btn primary" to="/admin">Open the admin panel</Link>}
          <Link className="btn secondary" style={{ width: "100%" }} to="/leaderboard">See the leaderboard</Link>
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

  async function sendReset() {
    setBusy(true); setErr("");
    try {
      await callFunction("password-request", { email: email.trim() });
      setStep("sent");
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }

  async function register() {
    if (password.length < 8) return setErr("The password must have at least 8 characters.");
    setBusy(true); setErr("");
    try {
      await callFunction("register", { firstName, lastName, email: email.trim(), password, code: code.trim() || undefined });
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
        <button role="tab" aria-selected={mode !== "register"} className={mode !== "register" ? "on" : ""} onClick={() => { setMode("signin"); setErr(""); }}>Sign in</button>
        <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); setErr(""); }}>Register</button>
      </div>
      <Notice kind="err">{err}</Notice>

      {mode === "signin" ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); signIn(); }}>
          <div><label htmlFor="si-em">E-mail</label><input id="si-em" type={armed ? "email" : "text"} name={armed ? "email" : "ic-a"} autoComplete={armed ? "username" : "off"} {...arm} required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div>
            <div className="label-row"><label htmlFor="si-pw">Password</label><button type="button" className="linklike" onClick={() => { setMode("forgot"); setErr(""); setStep("ask"); }}>Forgot password?</button></div>
            <input id="si-pw" type={armed ? "password" : "text"} name={armed ? "password" : "ic-b"} autoComplete={armed ? "current-password" : "off"} {...arm} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      ) : mode === "forgot" ? (
        step === "ask" ? (
          <div className="stack forgot">
            <p className="forgot-q">Do you want to reset your password?</p>
            <p className="sub" style={{ margin: 0 }}>The organiser will be notified and will send you a temporary password. Your account, team and portfolio stay as they are.</p>
            <div className="yes-no">
              <button type="button" className="yes" onClick={() => setStep("form")}>Yes</button>
              <button type="button" className="no" onClick={() => { setMode("signin"); setErr(""); }}>No</button>
            </div>
          </div>
        ) : step === "form" ? (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); sendReset(); }}>
            <div><label htmlFor="fp-em">The e-mail you registered with</label><input id="fp-em" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send the request"}</button>
            <button type="button" className="linklike" onClick={() => { setMode("signin"); setErr(""); }}>← Back to sign in</button>
          </form>
        ) : (
          <div className="stack">
            <Notice kind="ok">Request sent. If <b>{email.trim()}</b> is registered, the organiser will contact you with a temporary password: sign in with it and choose a new one in My team &gt; Account.</Notice>
            <button type="button" className="linklike" onClick={() => { setMode("signin"); setStep("ask"); }}>← Back to sign in</button>
          </div>
        )
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); register(); }}>
          <div className="name-pair">
            <div><label htmlFor="rg-fn">First name</label><input id="rg-fn" autoComplete="given-name" required maxLength={40} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
            <div><label htmlFor="rg-ln">Last name</label><input id="rg-ln" autoComplete="family-name" required maxLength={40} value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          </div>
          <div><label htmlFor="rg-em">E-mail</label><input id="rg-em" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /><p className="small muted" style={{ margin: "6px 0 0" }}>Tip: with a university e-mail, WeFocusBuddy, our sponsor, is free.</p></div>
          <div><label htmlFor="rg-pw">Password (at least 8 characters)</label><input id="rg-pw" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div>
            <label htmlFor="rg-cd">Team code <span className="opt">(optional)</span></label>
            <input id="rg-cd" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" style={{ fontFamily: "var(--mono)", letterSpacing: "0.1em" }}
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <p className="small muted" style={{ margin: "6px 0 0" }}>Got it from your president? Enter it to join your team now, or later from your account.</p>
          </div>
          <button type="submit" disabled={busy}>{busy ? "Creating your account…" : "Create my account"}</button>
          <p className="sub" style={{ margin: 0 }}>By registering you accept the <Link to="/privacy">privacy notice</Link>.</p>
        </form>
      )}
    </div>
  );
}
