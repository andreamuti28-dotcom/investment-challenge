import { Link } from "react-router-dom";
import { loadCalendar, useLoad } from "../lib/data";
import { date, dateTime, eur } from "../lib/format";
import { Countdown, Loading, Notice } from "../components/ui";

export default function Home() {
  const { data, error } = useLoad(loadCalendar);
  if (error) return <Notice kind="err">{error}</Notice>;
  if (!data) return <Loading />;
  const { settings: s, months, openMonth } = data;
  return (
    <>
      <section className="hero">
        <div className="eyebrow" style={{ color: "#c9a227" }}>Edition 2026 / 2027</div>
        <h1>The Interuniversity Investment Challenge</h1>
        <p>University teams manage a simulated portfolio of listed stocks from any market in the world, long and short, valued in euro against the MSCI World.</p>
        <div className="rule" />
        <div className="grid cols-3">
          <div className="stat"><div className="label" style={{ color: "#c9a227" }}>Start</div><div className="value">{date(s.start_date)}</div></div>
          <div className="stat"><div className="label" style={{ color: "#c9a227" }}>Finish</div><div className="value">{date(s.end_date)}</div></div>
          <div className="stat"><div className="label" style={{ color: "#c9a227" }}>Capital per team</div><div className="value">{eur(s.capital, 0)}</div></div>
        </div>
      </section>

      {openMonth && (
        <div className="card row spread">
          <div>
            <div className="eyebrow">Order window open</div>
            <h3 style={{ margin: "4px 0" }}>Orders for {openMonth.label}</h3>
            <span className="muted">Deadline {dateTime(openMonth.order_deadline)}. Execution at the close of the first trading day of the month.</span>
          </div>
          <div className="stat"><div className="label">Time left</div><div className="value"><Countdown to={openMonth.order_deadline} /></div></div>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <h2>How it works</h2>
          <div className="stack">
            <p>Each university enters a team. Teams can buy or sell short any listed stock in the world. Derivatives, ETFs and funds are not allowed.</p>
            <p>Portfolios can be rebalanced once a month. Orders placed before the deadline are executed at the closing price of the first trading day of the following month, with no commissions.</p>
            <p>A short position is closed automatically when the stock rises 50% above its entry price: the loss on that position is capped at 50%. There are no margin calls.</p>
            <p>Each currency is tracked in its own sub-portfolio and converted into euro at the ECB reference rate. Dividends are reinvested on long positions and charged on short positions.</p>
            <p><b>The winner is the team with the highest total return in euro.</b> Sharpe, Sortino, volatility, beta, tracking error, drawdown and concentration are published for every team.</p>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <Link to="/leaderboard" className="btn">See the leaderboard</Link>
            {s.regulation_url && <a className="btn secondary" href={s.regulation_url} target="_blank" rel="noreferrer">Read the regulation</a>}
          </div>
        </div>
        <div className="card">
          <h2>Key dates</h2>
          <div className="timeline">
            <div><div className="when">{date(s.registration_deadline)}</div><div><b>Registration deadline.</b> Universities confirm their teams.</div></div>
            <div><div className="when">{date(months[0]?.order_deadline)}</div><div><b>Initial portfolio.</b> Orders for December must be placed by 23:59 (Rome).</div></div>
            <div><div className="when">{date(s.start_date)}</div><div><b>Start.</b> Initial portfolios executed at the closing price.</div></div>
            <div><div className="when">Monthly</div><div><b>Rebalancing.</b> Orders by the last trading day of each month.</div></div>
            <div><div className="when">{date(s.end_date)}</div><div><b>End.</b> Final valuation in euro at the ECB reference rate.</div></div>
          </div>
          <h3 style={{ marginTop: 20 }}>Two competitions</h3>
          <p><b>A.</b> University teams, with students from a single university. <b>B.</b> International teams, with students from different universities and countries. Same rules, separate rankings.</p>
        </div>
      </div>
      <section className="card sponsor" aria-label="Sponsor">
        <div>
          <div className="eyebrow">Official sponsor</div>
          <h2 style={{ margin: "4px 0 6px" }}>WeFocusBuddy</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
            The Interuniversity Investment Challenge is sponsored by WeFocusBuddy, one-to-one online coworking sessions to study and work with focus.
          </p>
        </div>
        <a className="btn gold" href="https://wefocusbuddy.com" target="_blank" rel="noreferrer">Visit wefocusbuddy.com</a>
      </section>
    </>
  );
}
