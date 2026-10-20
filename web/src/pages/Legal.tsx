import { Link } from "react-router-dom";
import { openCookiePreferences } from "../lib/consent";

const LINKEDIN = "https://www.linkedin.com/in/andrea-muti-24416b2a1";
const UPDATED = "October 2026";
const AUTH_KEY = `sb-${new URL(import.meta.env.VITE_SUPABASE_URL || "https://project.supabase.co").hostname.split(".")[0]}-auth-token`;

const STORAGE = [
  { name: AUTH_KEY, category: "Technical", purpose: "Keeps a participant or the organiser signed in (Supabase sign-in session). Present only after signing in.", duration: "Until sign-out" },
  { name: "ic_cookie_consent", category: "Technical", purpose: "Stores your cookie choice.", duration: "12 months" },
  { name: "ic_visitor", category: "Statistics (with consent)", purpose: "Anonymous random identifier for aggregate visit counting.", duration: "12 months, deleted if you withdraw consent" },
  { name: "ic_session", category: "Statistics (with consent)", purpose: "Marks the current visit so that it is counted only once (sessionStorage).", duration: "Until the tab is closed" },
];

export function Privacy() {
  return (
    <article className="card legal">
      <div className="eyebrow">Information</div>
      <h1>Privacy &amp; Cookie</h1>

      <h2>Data controller</h2>
      <p>
        Andrea Muti, organiser of the Interuniversity Investment Challenge 2026/2027. For any request about your data you can contact me via{" "}
        <a href={LINKEDIN} target="_blank" rel="noreferrer noopener">LinkedIn</a>.
      </p>

      <h2>Data collected</h2>
      <p>
        The public pages (home, leaderboard, rules) do not require registration and do not collect identifying personal data. To take part,
        team presidents and members register with their full name, e-mail address and a password; the password is stored only in encrypted
        (hashed) form by the authentication service and is never visible to the organiser. The organiser receives the e-mail address of each
        team president from the participating university or association and uses it only to allow that person to register as president.
      </p>
      <p>
        Within a team, every member sees the names of the other members; the president also sees their e-mail addresses. The organiser sees
        all accounts. The team name, university and results are published in the leaderboard; during the challenge positions and orders are
        visible only to the team itself and become public after the end. If you accept the cookie notice, an anonymous random identifier is
        stored in your browser and used only to count visits in aggregate form. Full IP addresses, cross-site browsing data, profiling data
        and advertising data are not collected by the site.
      </p>

      <h2>Cookies and storage</h2>
      <ul>
        <li>Technical (always active): the sign-in session of participants and of the organiser, and your cookie choice, stored in localStorage.</li>
        <li>Anonymous statistics (only with your consent): an anonymous token in localStorage and a session marker, used to count aggregate visits.</li>
      </ul>
      <p>There are no profiling cookies, advertising third-party cookies or social tracking cookies. Details are in the <Link to="/cookies">Cookie Policy</Link>.</p>

      <h2>Service providers</h2>
      <p>
        The website is hosted on GitHub Pages (GitHub Inc.), which receives the technical data of every web request, such as the IP address,
        to deliver the pages and protect the service. Database, sign-in and calculations run on Supabase, in its Frankfurt (EU) data centre.
        Market prices are downloaded by the server from Yahoo Finance and the European Central Bank: no visitor data is sent to them.
      </p>

      <h2>Legal basis and retention</h2>
      <p>
        Account and team data: execution of the participation in the challenge (art. 6.1.b GDPR). Technical storage: legitimate interest in the
        operation and security of the website (art. 6.1.f GDPR). Anonymous statistics: your consent (art. 6.1.a GDPR), which you can deny or
        withdraw at any time. Accounts and contact data are kept until the end of the edition and the publication of the final results, and
        deleted within twelve months afterwards; you can ask for your account to be deleted at any time; results and the leaderboard may remain published as the record of the edition.
      </p>

      <h2>Withdrawing consent</h2>
      <p>
        You can change or withdraw your choice at any time with the button below or the "Cookie preferences" link at the bottom of every page.
        Withdrawing consent deletes the anonymous identifier from your browser.
      </p>
      <button className="secondary" onClick={openCookiePreferences}>Change cookie preferences</button>

      <h2>Your rights</h2>
      <p>
        Under the GDPR you have the right of access, rectification, erasure, restriction, objection and portability regarding your data. To
        exercise them, write via <a href={LINKEDIN} target="_blank" rel="noreferrer noopener">LinkedIn</a>. You also have the right to lodge
        a complaint with the Italian Data Protection Authority (<a href="https://www.garanteprivacy.it" target="_blank" rel="noreferrer noopener">garanteprivacy.it</a>).
      </p>
      <p className="muted small">Last updated: {UPDATED}.</p>
      <Link to="/">Back to home</Link>
    </article>
  );
}

export function Cookies() {
  return (
    <article className="card legal">
      <div className="eyebrow">Information</div>
      <h1>Cookie Policy</h1>

      <h2>What cookies are</h2>
      <p>
        Cookies are small text files stored by the browser while browsing. Similar techniques, such as localStorage and sessionStorage, are
        treated here in the same way as cookies. This site uses only localStorage and sessionStorage, no classic cookies.
      </p>

      <h2>Storage used</h2>
      <div className="storage-list">
        {STORAGE.map((x) => (
          <div key={x.name} className="storage-item">
            <code>{x.name}</code>
            <dl>
              <div><dt>Category</dt><dd>{x.category}</dd></div>
              <div><dt>Purpose</dt><dd>{x.purpose}</dd></div>
              <div><dt>Duration</dt><dd>{x.duration}</dd></div>
            </dl>
          </div>
        ))}
      </div>

      <h2>Third-party cookies</h2>
      <p>
        The website does not use third-party cookies or services for profiling or marketing. Fonts are hosted directly on the website
        (self-hosting), so no browsing data is sent to Google Fonts or other external CDNs. Google Analytics, Meta Pixel and advertising networks
        are not integrated. Links to external sites, such as LinkedIn or the sponsor's website, are reached only if you click them, and those
        sites apply their own policies.
      </p>

      <h2>Consent management</h2>
      <p>
        You can change or withdraw your choice at any time with the button below. Your choice is asked again after twelve months. Information on
        the processing of personal data is in the <Link to="/privacy">Privacy</Link> page.
      </p>
      <button className="secondary" onClick={openCookiePreferences}>Change cookie preferences</button>
      <p className="muted small" style={{ marginTop: 24 }}>Last updated: {UPDATED}.</p>
      <Link to="/">Back to home</Link>
    </article>
  );
}
