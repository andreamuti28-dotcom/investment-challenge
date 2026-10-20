import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { configured, supabase } from "./lib/supabase";
import Home from "./pages/Home";
import Leaderboard from "./pages/Leaderboard";
import MyTeam from "./pages/MyTeam";
import Admin from "./pages/Admin";
import { Cookies, Privacy } from "./pages/Legal";
import CookieBanner from "./components/CookieBanner";
import AuthPanel from "./components/AuthPanel";
import { openCookiePreferences, trackVisit } from "./lib/consent";

const SPONSOR_URL = "https://wefocusbuddy.com";
const heroVars = {
  "--hero-img-lg": `url("${import.meta.env.BASE_URL}hero-halftone.webp")`,
  "--hero-img-sm": `url("${import.meta.env.BASE_URL}hero-halftone-small.webp")`,
} as CSSProperties;

function Guard({ need, children }: { need: "team" | "admin"; children: ReactNode }) {
  const { session, loading, isAdmin, team } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (need === "admin" && !isAdmin) return <p>This area is reserved to the organiser.</p>;
  if (need === "team" && !team) {
    return isAdmin ? <Navigate to="/admin" replace /> : <p>Your account is not linked to a team. Please contact the organiser.</p>;
  }
  return <>{children}</>;
}

function LoginPage() {
  const { session, isAdmin, team, loading } = useAuth();
  if (!loading && session) return <Navigate to={team ? "/team" : isAdmin ? "/admin" : "/"} replace />;
  return (
    <div className="hero-full" style={{ minHeight: "calc(100svh - 64px)", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 440, margin: "0 auto", padding: "40px 16px" }}><AuthPanel /></div>
    </div>
  );
}

export default function App() {
  const { session, isAdmin, team } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const landing = loc.pathname === "/";
  useEffect(() => {
    const t = () => { trackVisit(loc.pathname).catch(() => {}); };
    t();
    window.addEventListener("ic-consent", t);
    return () => window.removeEventListener("ic-consent", t);
  }, [loc.pathname]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <div style={heroVars}>
      {!landing && (
        <header className="topbar">
          <div className="topbar-inner">
            <NavLink to="/" className="brand"><span className="brand-mark" aria-hidden="true" />Investment Challenge <span className="yr">26/27</span></NavLink>
            <nav className="nav" aria-label="Main">
              <NavLink to="/" end>Home</NavLink>
              <NavLink to="/leaderboard">Leaderboard</NavLink>
              {team && <NavLink to="/team">My team</NavLink>}
              {isAdmin && <NavLink to="/admin">Admin</NavLink>}
            </nav>
            <div className="nav-right">
              {session ? (
                <>
                  <span>{team ? `${team.name} · ${team.role}` : session.user.email}</span>
                  <button className="secondary small" onClick={async () => { await supabase.auth.signOut(); nav("/"); }}>Sign out</button>
                </>
              ) : (
                <NavLink to="/login" className="btn small">Sign in</NavLink>
              )}
            </div>
          </div>
        </header>
      )}
      <main className={landing || loc.pathname === "/login" ? "bleed" : ""}>
        {!configured && <div className="notice err">Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).</div>}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/team" element={<Guard need="team"><MyTeam /></Guard>} />
          <Route path="/admin" element={<Guard need="admin"><Admin /></Guard>} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/cookies" element={<Cookies />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="site">
        <div className="inner">
          <span>
            Interuniversity Investment Challenge 2026/27 · Organiser: Andrea Muti · Sponsored by{" "}
            <a href={SPONSOR_URL} target="_blank" rel="noreferrer">WeFocusBuddy</a>
          </span>
          <span className="footer-links">
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            <NavLink to="/privacy">Privacy</NavLink>
            <NavLink to="/cookies">Cookie Policy</NavLink>
            <button className="linklike" onClick={openCookiePreferences}>Cookie preferences</button>
            <a href="https://andreamuti.com" target="_blank" rel="noreferrer">andreamuti.com</a>
            <a href="https://www.linkedin.com/in/andrea-muti-24416b2a1" target="_blank" rel="noreferrer">LinkedIn</a>
          </span>
        </div>
      </footer>
      <CookieBanner />
    </div>
  );
}
