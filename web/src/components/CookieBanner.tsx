import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { readConsent, saveConsent } from "../lib/consent";

export default function CookieBanner() {
  const [open, setOpen] = useState(() => !readConsent());
  const [prefs, setPrefs] = useState(false);
  const [stats, setStats] = useState(() => readConsent()?.stats ?? false);

  useEffect(() => {
    const reopen = () => {
      setStats(readConsent()?.stats ?? false);
      setPrefs(true);
      setOpen(true);
    };
    window.addEventListener("ic-open-cookies", reopen);
    return () => window.removeEventListener("ic-open-cookies", reopen);
  }, []);

  if (!open) return null;
  const done = (s: boolean) => {
    saveConsent(s);
    setOpen(false);
    setPrefs(false);
  };

  return (
    <div className="cookie-banner" role="dialog" aria-modal="false" aria-labelledby="cookie-title">
      {!prefs ? (
        <>
          <p id="cookie-title" className="cookie-text">
            This site uses technical storage (always on) and, only with your consent, an anonymous identifier to count visits in aggregate.
            No profiling, no advertising trackers, no third-party marketing.{" "}
            <Link to="/cookies">Cookie Policy</Link> · <Link to="/privacy">Privacy</Link>.
          </p>
          <div className="cookie-actions">
            <button className="secondary" onClick={() => setPrefs(true)}>Manage preferences</button>
            <button className="secondary" onClick={() => done(false)}>Reject</button>
            <button onClick={() => done(true)}>Accept</button>
          </div>
        </>
      ) : (
        <>
          <h3 id="cookie-title" style={{ marginBottom: 8 }}>Cookie preferences</h3>
          <div className="cookie-option">
            <input type="checkbox" checked disabled id="ck-tech" />
            <label htmlFor="ck-tech"><b>Technical</b> (always on). Needed for the site to work: sign-in session and your cookie choice.</label>
          </div>
          <div className="cookie-option">
            <input type="checkbox" id="ck-stats" checked={stats} onChange={(e) => setStats(e.target.checked)} />
            <label htmlFor="ck-stats"><b>Anonymous statistics</b>. A random token to count visits in aggregate. No personal data.</label>
          </div>
          <div className="cookie-actions">
            <button className="secondary" onClick={() => (readConsent() ? setOpen(false) : setPrefs(false))}>Back</button>
            <button onClick={() => done(stats)}>Save preferences</button>
          </div>
        </>
      )}
    </div>
  );
}
