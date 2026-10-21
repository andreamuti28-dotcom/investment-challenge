// Investment Challenge engine core.
// Pure TypeScript, no dependencies, no I/O: runs unchanged in Deno (Supabase Edge
// Functions), Node (GitHub Actions fallback, tests) and the browser.
//
// The engine always recomputes the whole competition from scratch (replay) from
// orders, prices, corporate events and FX rates. It never updates balances
// incrementally, so any data correction propagates on the next run.

export type Side = "long" | "short";
export type Action = "open" | "close" | "change";

export interface Settings {
  capital: number;
  riskFreeAnnual: number;
  stopThreshold: number;
  benchmarkSymbol: string;
  benchmarkCurrency: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  /** optional warm-up before the start: orders execute from this date, and the positions still
   *  open on the eve of the start are carried into the challenge at the start's closing prices */
  practiceStartDate?: string | null;
}
export interface Month {
  n: number;
  startDate: string; // calendar first day of the month
  endDate: string; // last trading day used for month-end valuation
}
export interface Team {
  id: string;
  name: string;
  competition: "A" | "B" | "C";
  violations: number;
}
export interface Instrument {
  symbol: string;
  currency: string;
}
export interface Order {
  id: string;
  teamId: string;
  monthN: number;
  symbol: string;
  action: Action;
  side: Side | null;
  quantity: number | null; // target total quantity for open/change
  createdAt: string;
  /** date whose close executes the order (missing: legacy order, first close of its month) */
  execDate?: string | null;
}
export interface Transfer {
  id: string;
  teamId: string;
  monthN: number;
  currency: string;
  eurAmount: number;
  createdAt: string;
  /** date whose ECB rate executes the transfer (missing: first rate of its month) */
  execDate?: string | null;
}
export interface PriceRow {
  symbol: string;
  date: string;
  close: number;
  source: string; // 'manual' wins over anything else
}
export interface EventRow {
  symbol: string;
  date: string;
  type: "dividend" | "split";
  value: number;
  source: string;
}
export interface FxRow {
  currency: string;
  date: string;
  rate: number; // units of currency per 1 EUR
  source: string;
}
export interface EngineInput {
  settings: Settings;
  months: Month[];
  teams: Team[];
  instruments: Instrument[];
  orders: Order[];
  transfers: Transfer[];
  prices: PriceRow[];
  events: EventRow[];
  fx: FxRow[];
}

export interface PositionOut {
  teamId: string;
  symbol: string;
  currency: string;
  side: Side;
  quantity: number;
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: "order" | "change" | "stop" | null;
  openMonth: number;
  closeMonth: number | null;
  orderId: string;
  /** valuation at asOf (open) or realised result (closed), filled at the end of the run */
  lastPrice: number | null;
  valueLocal: number | null;
  valueEur: number | null;
  pnlLocal: number | null;
  pnlEur: number | null;
}
export interface LedgerOut {
  teamId: string;
  date: string;
  currency: string;
  amount: number;
  kind: "capital" | "trade" | "dividend" | "transfer";
  ref: string;
}
export interface SubportfolioOut {
  teamId: string;
  asOf: string;
  currency: string;
  cashLocal: number;
  positionsValueLocal: number;
  totalLocal: number;
  fxRate: number | null;
  totalEur: number | null;
}
export interface MetricsOut {
  teamId: string;
  asOf: string;
  monthsCompleted: number;
  nav: number | null;
  totalReturn: number | null;
  rankInCompetition: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  beta: number | null;
  trackingError: number | null;
  maxDrawdown: number | null;
  calmar: number | null;
  operations: number;
  maxWeight: number | null;
  hhi: number | null;
  currencyExposure: Record<string, number>;
  violations: number;
  /** long + short value as a share of NAV (Competition C ranks only portfolios with at least C_MIN_INVESTED) */
  investedShare: number | null;
}
export interface OrderUpdate {
  id: string;
  status: "pending" | "executed" | "rejected";
  executedDate: string | null;
  executedPrice: number | null;
  rejectReason: string | null;
}
export interface TransferUpdate {
  id: string;
  status: "pending" | "executed" | "rejected";
  executedDate: string | null;
  rate: number | null;
  rejectReason: string | null;
}
export interface EngineOutput {
  asOf: string;
  positions: PositionOut[];
  ledger: LedgerOut[];
  navDaily: { teamId: string; date: string; navEur: number }[];
  benchmarkDaily: { date: string; valueEur: number }[];
  navMonthly: { teamId: string; monthN: number; valuationDate: string; navEur: number }[];
  benchmarkMonthly: { monthN: number; valuationDate: string; valueEur: number }[];
  subportfolios: SubportfolioOut[];
  metrics: MetricsOut[];
  orderUpdates: OrderUpdate[];
  transferUpdates: TransferUpdate[];
  warnings: string[];
}

/** Competition C (individual): a portfolio is ranked only when at least this share of its value is invested. */
export const C_MIN_INVESTED = 0.5;

// ------------------------------------------------------------------ dates
const DAY = 86_400_000;
export const addDays = (d: string, n: number): string =>
  new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const weekday = (d: string): number => new Date(d + "T00:00:00Z").getUTCDay();
const isWeekday = (d: string) => {
  const w = weekday(d);
  return w !== 0 && w !== 6;
};

/** Valuation months derived from the start and end dates: month 1 is the calendar month of
 *  the start; each month is valued on its last weekday (the end date for the last month). */
export function generateMonths(startDate: string, endDate: string): Month[] {
  const out: Month[] = [];
  let y = Number(startDate.slice(0, 4)), m = Number(startDate.slice(5, 7));
  for (let n = 1; n <= 36; n++) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    if (first > endDate) break;
    let last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (last >= endDate) last = endDate;
    else while (!isWeekday(last)) last = addDays(last, -1);
    const from = n === 1 ? startDate : first;
    if (last < from) last = from; // start on the last weekend of a month
    out.push({ n, startDate: from, endDate: last });
    m++;
    if (m === 13) { m = 1; y++; }
  }
  return out;
}

// ------------------------------------------------------------------ series
class Series {
  dates: string[] = [];
  values: number[] = [];
  private exact = new Map<string, number>();
  constructor(rows: Map<string, number>) {
    const ds = [...rows.keys()].sort();
    for (const d of ds) {
      this.dates.push(d);
      this.values.push(rows.get(d)!);
      this.exact.set(d, rows.get(d)!);
    }
  }
  at(d: string): number | undefined {
    return this.exact.get(d);
  }
  /** latest value dated on or before d */
  asOf(d: string): { date: string; value: number } | undefined {
    let lo = 0, hi = this.dates.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid] <= d) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found < 0 ? undefined : { date: this.dates[found], value: this.values[found] };
  }
}

/** Merge rows keyed by (key, date): a 'manual' row always beats any other source. */
function buildSeries<T extends { date: string; source: string }>(
  rows: T[],
  key: (r: T) => string,
  val: (r: T) => number,
): Map<string, Series> {
  const tmp = new Map<string, Map<string, { v: number; manual: boolean }>>();
  for (const r of rows) {
    const k = key(r);
    if (!tmp.has(k)) tmp.set(k, new Map());
    const m = tmp.get(k)!;
    const manual = r.source === "manual";
    const cur = m.get(r.date);
    if (!cur || (manual && !cur.manual)) m.set(r.date, { v: val(r), manual });
  }
  const out = new Map<string, Series>();
  for (const [k, m] of tmp) {
    const plain = new Map<string, number>();
    for (const [d, x] of m) plain.set(d, x.v);
    out.set(k, new Series(plain));
  }
  return out;
}

// ------------------------------------------------------------------ stats
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
function stdev(x: number[]): number | null {
  if (x.length < 2) return null;
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
}
function cov(x: number[], y: number[]): number | null {
  if (x.length < 2 || x.length !== y.length) return null;
  const mx = mean(x), my = mean(y);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (x.length - 1);
}

// ------------------------------------------------------------------ engine
interface OpenPos {
  out: PositionOut;
}

export function runEngine(input: EngineInput, asOfRequested: string): EngineOutput {
  const S = input.settings;
  const asOf = asOfRequested > S.endDate ? S.endDate : asOfRequested;
  const warnings: string[] = [];
  const warnOnce = new Set<string>();
  const warn = (w: string) => {
    if (!warnOnce.has(w)) {
      warnOnce.add(w);
      warnings.push(w);
    }
  };

  const months = [...input.months].sort((a, b) => a.n - b.n);
  const monthByN = new Map(months.map((m) => [m.n, m]));
  const execDateOf = (x: { execDate?: string | null; monthN: number }): string | undefined =>
    x.execDate ?? monthByN.get(x.monthN)?.startDate;
  const monthOf = (d: string): number => {
    let k = months[0]?.n ?? 1;
    for (const m of months) if (m.startDate <= d) k = m.n;
    return k;
  };

  const ccyOf = new Map(input.instruments.map((i) => [i.symbol, i.currency.toUpperCase()]));
  const px = buildSeries(input.prices, (r) => r.symbol, (r) => r.close);
  const fxS = buildSeries(input.fx, (r) => r.currency.toUpperCase(), (r) => r.rate);
  const evMerged = new Map<string, EventRow>();
  for (const e of input.events) {
    const k = `${e.symbol}|${e.date}|${e.type}`;
    const cur = evMerged.get(k);
    if (!cur || (e.source === "manual" && cur.source !== "manual")) evMerged.set(k, e);
  }
  const eventsOn = new Map<string, EventRow[]>(); // key symbol|date
  for (const e of evMerged.values()) {
    const k = `${e.symbol}|${e.date}`;
    if (!eventsOn.has(k)) eventsOn.set(k, []);
    eventsOn.get(k)!.push(e);
  }

  const price = (sym: string, d: string) => px.get(sym)?.asOf(d)?.value;
  const closeOn = (sym: string, d: string) => px.get(sym)?.at(d);
  const fxAsOf = (c: string, d: string): number | undefined =>
    c === "EUR" ? 1 : fxS.get(c)?.asOf(d)?.value;
  const fxOn = (c: string, d: string): number | undefined => (c === "EUR" ? 1 : fxS.get(c)?.at(d));

  // calendar of days to replay
  const days: string[] = [];
  for (let d = S.startDate; d <= asOf; d = addDays(d, 1)) days.push(d);
  const monthEnds = new Set(months.map((m) => m.endDate));
  const storeDay = (d: string) => isWeekday(d) || d === S.startDate || monthEnds.has(d) || d === asOf;

  const out: EngineOutput = {
    asOf,
    positions: [],
    ledger: [],
    navDaily: [],
    benchmarkDaily: [],
    navMonthly: [],
    benchmarkMonthly: [],
    subportfolios: [],
    metrics: [],
    orderUpdates: [],
    transferUpdates: [],
    warnings,
  };

  // ---------------- benchmark
  const bSym = S.benchmarkSymbol, bCcy = S.benchmarkCurrency.toUpperCase();
  const bBaseP = price(bSym, S.startDate), bBaseFx = fxAsOf(bCcy, S.startDate);
  const benchAt = (d: string): number | null => {
    const p = price(bSym, d), f = fxAsOf(bCcy, d);
    if (bBaseP === undefined || bBaseFx === undefined || p === undefined || f === undefined) return null;
    return (S.capital * (p / f)) / (bBaseP / bBaseFx);
  };
  if (days.length && (bBaseP === undefined || bBaseFx === undefined)) {
    warn(`Benchmark ${bSym}: missing price or ${bCcy} rate on the start date`);
  }
  for (const d of days) {
    const v = benchAt(d);
    if (v !== null && storeDay(d)) out.benchmarkDaily.push({ date: d, valueEur: v });
  }
  out.benchmarkMonthly.push({ monthN: 0, valuationDate: S.startDate, valueEur: S.capital });
  for (const m of months) {
    if (m.endDate <= asOf) {
      const v = benchAt(m.endDate);
      if (v !== null) out.benchmarkMonthly.push({ monthN: m.n, valuationDate: m.endDate, valueEur: v });
    }
  }
  const benchMonthlyMap = new Map(out.benchmarkMonthly.map((b) => [b.monthN, b.valueEur]));

  // ---------------- teams
  const lastValuation = new Map<string, { nav: number | null; open: OpenPos[]; cash: Map<string, number> }>();
  const opsCount = new Map<string, number>();

  for (const team of input.teams) {
    const cash = new Map<string, number>([["EUR", 0]]);
    const addCash = (c: string, amt: number, date: string, kind: LedgerOut["kind"], ref: string) => {
      cash.set(c, (cash.get(c) ?? 0) + amt);
      out.ledger.push({ teamId: team.id, date, currency: c, amount: amt, kind, ref });
    };
    addCash("EUR", S.capital, S.startDate, "capital", "initial capital");

    const open: OpenPos[] = [];
    let ops = 0;
    const tOrders = input.orders
      .filter((o) => o.teamId === team.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const tTransfers = input.transfers
      .filter((t) => t.teamId === team.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const orderState = new Map<string, OrderUpdate>();
    for (const o of tOrders) {
      orderState.set(o.id, { id: o.id, status: "pending", executedDate: null, executedPrice: null, rejectReason: null });
      if (!execDateOf(o)) {
        orderState.set(o.id, { id: o.id, status: "rejected", executedDate: null, executedPrice: null, rejectReason: "unknown month" });
      } else if (!ccyOf.has(o.symbol)) {
        orderState.set(o.id, { id: o.id, status: "rejected", executedDate: null, executedPrice: null, rejectReason: "unknown instrument" });
      }
    }
    const trState = new Map<string, TransferUpdate>();
    for (const t of tTransfers) {
      const bad = t.currency.toUpperCase() === "EUR" || !t.eurAmount || !execDateOf(t);
      trState.set(t.id, {
        id: t.id,
        status: bad ? "rejected" : "pending",
        executedDate: null,
        rate: null,
        rejectReason: bad ? "invalid transfer" : null,
      });
    }

    const findOpen = (sym: string) => open.find((p) => p.out.symbol === sym);
    const closePos = (p: OpenPos, d: string, exitPrice: number, reason: PositionOut["exitReason"]) => {
      const o = p.out;
      o.exitDate = d;
      o.exitPrice = exitPrice;
      o.exitReason = reason;
      o.closeMonth = monthOf(d);
      const amt = o.side === "long" ? o.quantity * exitPrice : -o.quantity * exitPrice;
      addCash(o.currency, amt, d, "trade", `${reason === "stop" ? "stop" : "close"} ${o.side} ${o.quantity} ${o.symbol} @ ${exitPrice}`);
      open.splice(open.indexOf(p), 1);
    };
    const openPos = (ord: Order, side: Side, qty: number, d: string, p: number) => {
      const c = ccyOf.get(ord.symbol)!;
      const o: PositionOut = {
        teamId: team.id,
        symbol: ord.symbol,
        currency: c,
        side,
        quantity: qty,
        entryDate: d,
        entryPrice: p,
        exitDate: null,
        exitPrice: null,
        exitReason: null,
        openMonth: monthOf(d),
        closeMonth: null,
        orderId: ord.id,
        lastPrice: null,
        valueLocal: null,
        valueEur: null,
        pnlLocal: null,
        pnlEur: null,
      };
      out.positions.push(o);
      open.push({ out: o });
      if (!cash.has(c)) cash.set(c, 0);
      addCash(c, side === "long" ? -qty * p : qty * p, d, "trade", `open ${side} ${qty} ${ord.symbol} @ ${p}`);
    };

    for (const d of days) {
      // a) positions held from before today: splits, dividends (holder of record keeps the
      //    dividend even if it sells today), then the stop on shorts. The stop runs BEFORE
      //    orders so that a loss can never exceed the threshold (Art. 7), even on gaps.
      for (const p of [...open]) {
        const o = p.out;
        if (o.entryDate >= d) continue;
        for (const e of eventsOn.get(`${o.symbol}|${d}`) ?? []) {
          if (e.type === "split" && e.value > 0) {
            o.quantity *= e.value;
            o.entryPrice /= e.value;
          }
        }
        for (const e of eventsOn.get(`${o.symbol}|${d}`) ?? []) {
          if (e.type === "dividend" && e.value) {
            const amt = (o.side === "long" ? 1 : -1) * o.quantity * e.value;
            addCash(o.currency, amt, d, "dividend", `dividend ${e.value} x ${o.quantity} ${o.symbol} (${o.side})`);
          }
        }
        if (o.side === "short") {
          const c = closeOn(o.symbol, d);
          const trigger = o.entryPrice * (1 + S.stopThreshold);
          if (c !== undefined && c >= trigger - 1e-12) {
            closePos(p, d, trigger, "stop");
            ops += 1;
          }
        }
      }

      // b) order execution: first day >= month start with a close for the symbol
      const due = tOrders.filter((o) => {
        const st = orderState.get(o.id)!;
        if (st.status !== "pending") return false;
        return execDateOf(o)! <= d && closeOn(o.symbol, d) !== undefined;
      });
      const rank: Record<Action, number> = { close: 0, change: 1, open: 2 };
      // chronological: the order placed first is executed first (same close price for all)
      due.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || rank[a.action] - rank[b.action]);
      for (const o of due) {
        const p = closeOn(o.symbol, d)!;
        const st = orderState.get(o.id)!;
        const existing = findOpen(o.symbol);
        const reject = (why: string) => {
          st.status = "rejected";
          st.rejectReason = why;
        };
        const qtyOk = o.quantity !== null && o.quantity > 0;
        const sideOk = o.side === "long" || o.side === "short";
        if (o.action === "close") {
          if (!existing) {
            reject("no open position to close (possibly stopped out)");
            continue;
          }
          closePos(existing, d, p, "order");
          ops += 1;
        } else if (o.action === "change") {
          if (!existing) {
            reject("no open position to change (possibly stopped out)");
            continue;
          }
          if (!qtyOk || !sideOk) {
            reject("invalid side or quantity");
            continue;
          }
          closePos(existing, d, p, "change");
          openPos(o, o.side!, o.quantity!, d, p);
          ops += 2;
        } else {
          if (existing) {
            reject("position already open on this symbol");
            continue;
          }
          if (!qtyOk || !sideOk) {
            reject("invalid side or quantity");
            continue;
          }
          openPos(o, o.side!, o.quantity!, d, p);
          ops += 1;
        }
        st.status = "executed";
        st.executedDate = d;
        st.executedPrice = p;
      }
      for (const t of tTransfers) {
        const st = trState.get(t.id)!;
        if (st.status !== "pending") continue;
        const c = t.currency.toUpperCase();
        const r = fxOn(c, d);
        if (execDateOf(t)! <= d && r !== undefined) {
          addCash("EUR", -t.eurAmount, d, "transfer", `convert ${t.eurAmount} EUR into ${c} @ ${r}`);
          if (!cash.has(c)) cash.set(c, 0);
          addCash(c, t.eurAmount * r, d, "transfer", `from ${t.eurAmount} EUR @ ${r}`);
          st.status = "executed";
          st.executedDate = d;
          st.rate = r;
        }
      }

      // e) valuation
      if (storeDay(d) || d === asOf) {
        const nav = valueTeam(d);
        if (nav !== null && storeDay(d)) out.navDaily.push({ teamId: team.id, date: d, navEur: nav });
      }
      for (const m of months) {
        if (m.endDate === d) {
          const nav = valueTeam(d);
          if (nav !== null) out.navMonthly.push({ teamId: team.id, monthN: m.n, valuationDate: d, navEur: nav });
          else warn(`${team.name}: month ${m.n} NAV not computable (missing FX rate)`);
        }
      }
    }

    function valueTeam(d: string): number | null {
      let nav = 0;
      const totals = new Map<string, number>(cash);
      for (const p of open) {
        const pr = price(p.out.symbol, d) ?? p.out.entryPrice;
        const v = (p.out.side === "long" ? 1 : -1) * p.out.quantity * pr;
        totals.set(p.out.currency, (totals.get(p.out.currency) ?? 0) + v);
      }
      for (const [c, tot] of totals) {
        if (Math.abs(tot) < 1e-9) continue;
        const r = fxAsOf(c, d);
        if (r === undefined) {
          warn(`Missing ECB rate for ${c}: insert a manual rate (Art. 14)`);
          return null;
        }
        nav += tot / r;
      }
      return nav;
    }

    // month 0
    out.navMonthly.push({ teamId: team.id, monthN: 0, valuationDate: S.startDate, navEur: S.capital });

    // sub-portfolios at asOf
    const totals = new Map<string, { cash: number; pos: number }>();
    for (const [c, v] of cash) totals.set(c, { cash: v, pos: 0 });
    for (const p of open) {
      const pr = price(p.out.symbol, asOf) ?? p.out.entryPrice;
      const v = (p.out.side === "long" ? 1 : -1) * p.out.quantity * pr;
      const t = totals.get(p.out.currency) ?? { cash: 0, pos: 0 };
      t.pos += v;
      totals.set(p.out.currency, t);
    }
    for (const [c, t] of [...totals].sort((a, b) => (a[0] === "EUR" ? -1 : b[0] === "EUR" ? 1 : a[0].localeCompare(b[0])))) {
      const r = days.length ? fxAsOf(c, asOf) ?? null : c === "EUR" ? 1 : null;
      const tot = t.cash + t.pos;
      if (Math.abs(tot) < 1e-9 && Math.abs(t.cash) < 1e-9 && c !== "EUR") continue;
      out.subportfolios.push({
        teamId: team.id,
        asOf,
        currency: c,
        cashLocal: t.cash,
        positionsValueLocal: t.pos,
        totalLocal: tot,
        fxRate: r,
        totalEur: r ? tot / r : null,
      });
    }

    // position valuation at asOf (open) / realised result (closed, converted at the exit date)
    for (const o of out.positions.filter((x) => x.teamId === team.id)) {
      const sgn = o.side === "long" ? 1 : -1;
      if (o.exitDate === null) {
        const pr = price(o.symbol, asOf) ?? o.entryPrice;
        const f = fxAsOf(o.currency, asOf);
        o.lastPrice = pr;
        o.valueLocal = sgn * o.quantity * pr;
        o.pnlLocal = sgn * o.quantity * (pr - o.entryPrice);
        o.valueEur = f ? o.valueLocal / f : null;
        o.pnlEur = f ? o.pnlLocal / f : null;
      } else {
        const f = fxAsOf(o.currency, o.exitDate);
        o.lastPrice = o.exitPrice;
        o.valueLocal = 0;
        o.valueEur = 0;
        o.pnlLocal = sgn * o.quantity * (o.exitPrice! - o.entryPrice);
        o.pnlEur = f ? o.pnlLocal / f : null;
      }
    }

    // stale data warnings
    for (const p of open) {
      const last = px.get(p.out.symbol)?.asOf(asOf);
      if (last && addDays(last.date, 6) < asOf) warn(`${p.out.symbol}: no new price since ${last.date}`);
    }
    for (const o of tOrders) {
      const st = orderState.get(o.id)!;
      const ed = execDateOf(o);
      if (st.status === "pending" && ed && addDays(ed, 5) < asOf) {
        warn(`${team.name}: order ${o.action} ${o.symbol} (due ${ed}) still not executed: no price available`);
      }
    }

    out.orderUpdates.push(...orderState.values());
    out.transferUpdates.push(...trState.values());
    const lastNav = days.length ? out.navDaily.filter((x) => x.teamId === team.id).at(-1)?.navEur ?? null : S.capital;
    lastValuation.set(team.id, { nav: days.length ? lastNav : S.capital, open, cash });
    opsCount.set(team.id, ops);
  }

  // ---------------- metrics
  const rf = S.riskFreeAnnual / 12;
  const benchNow = days.length ? benchAt(asOf) : S.capital;
  const benchReturn = benchNow === null ? null : benchNow / S.capital - 1;
  for (const team of input.teams) {
    const lv = lastValuation.get(team.id)!;
    const nm = new Map(out.navMonthly.filter((x) => x.teamId === team.id).map((x) => [x.monthN, x.navEur]));
    const navs: number[] = [S.capital];
    const r: number[] = [];
    const rb: number[] = [];
    for (const m of months) {
      if (!nm.has(m.n) || !benchMonthlyMap.has(m.n) || !benchMonthlyMap.has(m.n - 1)) break;
      const prev = navs[navs.length - 1];
      const cur = nm.get(m.n)!;
      navs.push(cur);
      r.push(cur / prev - 1);
      rb.push(benchMonthlyMap.get(m.n)! / benchMonthlyMap.get(m.n - 1)! - 1);
    }
    const n = r.length;
    const sd = stdev(r);
    const totalReturn = lv.nav === null ? null : lv.nav / S.capital - 1;
    let maxDD: number | null = null;
    if (n >= 1) {
      let peak = navs[0];
      maxDD = 0;
      for (const v of navs) {
        peak = Math.max(peak, v);
        maxDD = Math.min(maxDD, v / peak - 1);
      }
    }
    const downside = n >= 1 ? Math.sqrt(r.reduce((a, x) => a + Math.min(x - rf, 0) ** 2, 0) / n) : 0;
    const varB = rb.length >= 2 ? cov(rb, rb) : null;
    const covRB = cov(r, rb);
    const excessSeries = r.map((x, i) => x - rb[i]);
    const sdEx = stdev(excessSeries);
    const Rn = n >= 1 ? navs[n] / S.capital - 1 : null;

    // concentration at asOf
    const vals: { v: number; c: string }[] = [];
    for (const p of lv.open) {
      const pr = price(p.out.symbol, asOf) ?? p.out.entryPrice;
      const f = fxAsOf(p.out.currency, asOf);
      if (f === undefined) continue;
      vals.push({ v: Math.abs(p.out.quantity * pr) / f, c: p.out.currency });
    }
    const gross = vals.reduce((a, b) => a + b.v, 0);
    const exposure: Record<string, number> = {};
    for (const x of vals) exposure[x.c] = (exposure[x.c] ?? 0) + (gross ? x.v / gross : 0);

    out.metrics.push({
      teamId: team.id,
      asOf,
      monthsCompleted: n,
      nav: lv.nav,
      totalReturn,
      rankInCompetition: null,
      benchmarkReturn: benchReturn,
      excessReturn: totalReturn !== null && benchReturn !== null ? totalReturn - benchReturn : null,
      volatility: sd === null ? null : sd * Math.sqrt(12),
      sharpe: sd ? ((mean(r) - rf) / sd) * Math.sqrt(12) : null,
      sortino: n >= 1 && downside > 0 ? ((mean(r) - rf) / downside) * Math.sqrt(12) : null,
      beta: covRB !== null && varB ? covRB / varB : null,
      trackingError: sdEx === null ? null : sdEx * Math.sqrt(12),
      maxDrawdown: maxDD,
      calmar: Rn !== null && maxDD ? (Math.pow(1 + Rn, 12 / n) - 1) / Math.abs(maxDD) : null,
      operations: opsCount.get(team.id) ?? 0,
      maxWeight: gross && lv.nav ? Math.max(...vals.map((x) => x.v)) / lv.nav : null,
      hhi: gross ? vals.reduce((a, x) => a + (x.v / gross) ** 2, 0) : null,
      currencyExposure: exposure,
      violations: team.violations ?? 0,
      investedShare: lv.nav ? gross / lv.nav : null,
    });
  }
  for (const comp of ["A", "B", "C"]) {
    // in Competition C a portfolio that is mostly cash is not ranked (otherwise doing nothing could win)
    const eligible = (m: MetricsOut) => m.totalReturn !== null && (comp !== "C" || (m.investedShare ?? 0) >= C_MIN_INVESTED - 1e-9);
    const group = out.metrics.filter((m) => input.teams.find((t) => t.id === m.teamId)?.competition === comp).filter(eligible);
    for (const m of group) {
      if (m.totalReturn === null) continue;
      m.rankInCompetition = 1 + group.filter((x) => x.totalReturn !== null && x.totalReturn > m.totalReturn! + 1e-12).length;
    }
  }
  return out;
}

// ------------------------------------------------------------------ practice period
/** Runs the challenge with an optional practice period before the official start.
 *  - Before the start: the practice is replayed from practiceStartDate with the full capital.
 *  - From the start: the practice is replayed up to the eve of the start; every position still
 *    open is re-entered (same side and quantity) at the start's closing price, on a fresh
 *    capital, and the practice results are discarded. The carried position keeps the id of the
 *    order that opened it, so it stays attributed to the member who opened it. Practice orders
 *    keep their own execution date and price in the history. */
export function runChallenge(input: EngineInput, asOfRequested: string): EngineOutput {
  const S = input.settings;
  const ps = S.practiceStartDate;
  if (!ps || ps >= S.startDate) return runEngine(input, asOfRequested);
  const eve = addDays(S.startDate, -1);
  const monthStart = new Map(input.months.map((m) => [m.n, m.startDate]));
  const execOf = (o: Order) => o.execDate ?? monthStart.get(o.monthN) ?? S.startDate;
  const practiceOrders = input.orders.filter((o) => execOf(o) < S.startDate);
  const officialOrders = input.orders.filter((o) => execOf(o) >= S.startDate);
  const practiceInput: EngineInput = {
    ...input,
    settings: { ...S, startDate: ps, endDate: eve, practiceStartDate: null },
    months: generateMonths(ps, eve),
    orders: practiceOrders,
    transfers: [],
  };
  if (asOfRequested < S.startDate) return runEngine(practiceInput, asOfRequested);

  const practice = runEngine(practiceInput, eve);
  const carried: Order[] = practice.positions
    .filter((p) => p.exitDate === null)
    .map((p) => ({
      id: p.orderId,
      teamId: p.teamId,
      monthN: 1,
      symbol: p.symbol,
      action: "open" as const,
      side: p.side,
      quantity: p.quantity,
      createdAt: "0000-01-01T00:00:00Z", // before any real order of the start day
      execDate: S.startDate,
    }));
  const carriedIds = new Set(carried.map((c) => c.id));
  const official = runEngine({ ...input, settings: { ...S, practiceStartDate: null }, orders: [...carried, ...officialOrders] }, asOfRequested);

  // carried opens are not trades: remove them from the operations count and from the order history
  const carriedExecuted = new Map<string, number>();
  for (const u of official.orderUpdates) {
    if (carriedIds.has(u.id) && u.status === "executed") {
      const team = carried.find((c) => c.id === u.id)!.teamId;
      carriedExecuted.set(team, (carriedExecuted.get(team) ?? 0) + 1);
    }
  }
  for (const m of official.metrics) m.operations = Math.max(0, m.operations - (carriedExecuted.get(m.teamId) ?? 0));
  official.orderUpdates = [
    ...official.orderUpdates.filter((u) => !carriedIds.has(u.id)),
    ...practice.orderUpdates.map((u) =>
      u.status === "pending" ? { ...u, status: "rejected" as const, rejectReason: "not executed before the start of the challenge" } : u
    ),
  ];
  return official;
}
