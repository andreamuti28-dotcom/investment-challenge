import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "./lib/auth";
import { configured, supabase } from "./lib/supabase";
import Home from "./pages/Home";
import Leaderboard from "./pages/Leaderboard";
import Login from "./pages/Login";
import MyTeam from "./pages/MyTeam";
import Admin from "./pages/Admin";
import { Cookies, Privacy } from "./pages/Legal";
import CookieBanner from "./components/CookieBanner";
import { openCookiePreferences, trackVisit } from "./lib/consent";
import type { ReactNode } from "react";

function Guard({ need, children }: { need: "team" | "admin"; children: ReactNode }) {
  const { session, loading, isAdmin, team } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (need === "admin" && !isAdmin) return <p>This area is reserved to the organiser.</p>;
  if (need === "team" && !team) return <p>Your account is not linked to a team yet. Please contact the organiser.</p>;
  return <>{children}</>;
}

export default function App() {
  const { session, isAdmin, team } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    const t = () => { trackVisit(loc.pathname).catch(() => {}); };
    t();
    window.addEventListener("ic-consent", t);
    return () => window.removeEventListener("ic-consent", t);
  }, [loc.pathname]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">Investment Challenge <span>26/27</span></NavLink>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            {team && <NavLink to="/team">My team</NavLink>}
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="nav-right">
            {session ? (
              <>
                <span>{team ? team.name : session.user.email}</span>
                <button className="secondary small" onClick={async () => { await supabase.auth.signOut(); nav("/"); }}>Sign out</button>
              </>
            ) : (
              <NavLink to="/login" className="btn gold small" style={{ background: "#c9a227", color: "#0f1b2d", borderColor: "#c9a227", minHeight: 32, padding: "4px 12px" }}>Team login</NavLink>
            )}
          </div>
        </div>
      </header>
      <main>
        {!configured && (
          <div className="notice err">Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).</div>
        )}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/login" element={<Login />} />
          <Route path="/team" element={<Guard need="team"><MyTeam /></Guard>} />
          <Route path="/admin" element={<Guard need="admin"><Admin /></Guard>} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/cookies" element={<Cookies />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer>
        <div className="inner">
          <span>Interuniversity Investment Challenge 2026/2027 · Organiser: Andrea Muti · Sponsored by <a href="https://wefocusbuddy.com" target="_blank" rel="noreferrer">WeFocusBuddy</a></span>
          <span className="footer-links">
            <NavLink to="/privacy">Privacy</NavLink>
            <NavLink to="/cookies">Cookie Policy</NavLink>
            <button className="linklike" onClick={openCookiePreferences}>Cookie preferences</button>
            <a href="https://andreamuti.com" target="_blank" rel="noreferrer">andreamuti.com</a>
            <a href="https://www.linkedin.com/in/andrea-muti-24416b2a1" target="_blank" rel="noreferrer">LinkedIn</a>
          </span>
        </div>
      </footer>
      <CookieBanner />
    </>
  );
}
