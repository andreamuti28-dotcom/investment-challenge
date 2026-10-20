import { useEffect } from "react";
import { Link } from "react-router-dom";
import { loadCalendar, useLoad } from "../lib/data";
import { date, eur } from "../lib/format";
import AuthPanel from "../components/AuthPanel";

const SPONSOR_URL = "https://wefocusbuddy.com";

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal:not(.in)");
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  });
}

export default function Home() {
  const { data } = useLoad(loadCalendar);
  const s = data?.settings;
  const start = s ? date(s.start_date) : "1 Dec 2026";
  const end = s ? date(s.end_date) : "31 May 2027";
  const capital = s ? eur(s.capital, 0) : "€ 1,000,000";
  useReveal();

  return (
    <div className="landing">
      {/* ---------------- first screen: challenge, sign in / register, sponsor */}
      <section className="hero-full" aria-label="Interuniversity Investment Challenge">
        <div className="hero-bar">
          <span className="brand"><span className="brand-mark" aria-hidden="true" />Investment Challenge <span className="yr">26/27</span></span>
          <a className="sponsor-pill" href={SPONSOR_URL} target="_blank" rel="noreferrer">
            <span className="tag">Sponsor</span><span className="long">Powered by</span> <b>WeFocusBuddy</b> <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="hero-main">
          <div className="hero-copy">
            <div className="eyebrow">Interuniversity Investment Challenge · Edition 2026/27</div>
            <h1>Trade the world.<br /><span className="dim">Beat the index.</span></h1>
            <p className="lead">
              University teams run {capital} of virtual capital on any listed stock on earth, long or short, from {start} to {end}.
              Every trade at the closing price. One leaderboard against the MSCI World.
            </p>
            <div className="hero-facts">
              <span>{capital} per team</span><span>Long &amp; short</span><span>Daily close</span><span>6 months</span>
            </div>
          </div>
          <AuthPanel />
        </div>
        <a className="scroll-cue" href="#how">Discover the challenge ↓</a>
      </section>

      {/* ---------------- how it works */}
      <section className="section" id="how">
        <div className="section-head reveal">
          <div><div className="eyebrow">01 · How it works</div><h2>Three moves<br />to the top.</h2></div>
          <p>A real-market simulation with the discipline of a fund: no commissions, no shortcuts, every position valued in euro every day.</p>
        </div>
        <div className="steps reveal">
          <div className="step"><div className="n">01</div><h3>Form your team</h3><p>The president registers with the e-mail given to the organiser and shares the team code. Every member joins with that code.</p></div>
          <div className="step"><div className="n">02</div><h3>Trade at the close</h3><p>Buy, sell or short any listed stock in the world. Orders are executed at that day's closing price, on the stock's own exchange.</p></div>
          <div className="step"><div className="n">03</div><h3>Beat the benchmark</h3><p>Portfolios are valued daily against the MSCI World. The highest total return in euro wins; risk metrics are public for all.</p></div>
        </div>
      </section>

      {/* ---------------- numbers */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="section-head reveal">
          <div><div className="eyebrow">02 · The rules in numbers</div><h2>Simple rules.<br />Real markets.</h2></div>
          <p>Each currency lives in its own sub-portfolio, converted at the ECB reference rate. Dividends and splits are applied automatically.</p>
        </div>
        <div className="numbers reveal">
          <div><div className="big">€1M</div><div className="cap">Virtual capital per team</div></div>
          <div><div className="big">6</div><div className="cap">Months of live markets</div></div>
          <div><div className="big">0</div><div className="cap">Commissions on every trade</div></div>
          <div><div className="big">50%</div><div className="cap">Maximum loss on a short: automatic stop</div></div>
        </div>
      </section>

      {/* ---------------- competitions */}
      <div className="band">
        <section className="section">
          <div className="section-head reveal">
            <div><div className="eyebrow">03 · Two competitions</div><h2>Same rules.<br />Separate podiums.</h2></div>
            <p>Choose the competition that fits your team. Rankings are published separately, with the same metrics.</p>
          </div>
          <div className="comps reveal">
            <div className="comp"><div className="letter">A</div><h3>University teams</h3><p>Students from a single university competing for their institution.</p></div>
            <div className="comp"><div className="letter">B</div><h3>International teams</h3><p>Students from different universities and countries, building one portfolio together.</p></div>
          </div>
        </section>
      </div>

      {/* ---------------- key dates */}
      <section className="section">
        <div className="section-head reveal">
          <div><div className="eyebrow">04 · Key dates</div><h2>Mark the calendar.</h2></div>
          <p>Orders can be placed before the start: they are executed at the close of the first day.</p>
        </div>
        <ol className="dates reveal">
          <li><div className="when">{s ? date(s.registration_deadline) : "15 Nov 2026"}</div><h3>Registration</h3><p>Universities confirm their teams and presidents.</p></li>
          <li><div className="when">Before the start</div><h3>Initial portfolio</h3><p>Teams place their first orders.</p></li>
          <li><div className="when">{start}</div><h3>The bell rings</h3><p>Initial portfolios executed at the closing price.</p></li>
          <li><div className="when">{end}</div><h3>Final valuation</h3><p>Results in euro at the ECB reference rate.</p></li>
        </ol>
      </section>

      {/* ---------------- sponsor */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="sponsor-block reveal">
          <div>
            <div className="eyebrow">Official sponsor</div>
            <h2>WeFocusBuddy</h2>
            <p>One-to-one online coworking sessions to study and work with focus. The partner of the 2026/27 edition.</p>
          </div>
          <a className="btn" href={SPONSOR_URL} target="_blank" rel="noreferrer">Visit wefocusbuddy.com ↗</a>
        </div>
      </section>

      {/* ---------------- final call */}
      <section className="section cta-final reveal">
        <div className="eyebrow">The 2026/27 edition</div>
        <h2>Ready when the bell rings?</h2>
        <div className="row">
          <a className="btn" href="#access" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Register your team</a>
          <Link className="btn ghost" to="/leaderboard">See the leaderboard</Link>
          {s?.regulation_url && <a className="btn ghost" href={s.regulation_url} target="_blank" rel="noreferrer">Read the regulation</a>}
        </div>
      </section>
    </div>
  );
}
