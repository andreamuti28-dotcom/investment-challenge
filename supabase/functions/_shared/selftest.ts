// Acceptance test with values verified against the organiser's Excel workbook.
// Used by the Node test suite and by the deployed engine (`{"selftest": true}`),
// so the exact code running in production is checked on demand from the Admin panel.
import { type EngineInput, runEngine } from "./core.ts";

export const MONTHS = [
  { n: 1, startDate: "2026-12-01", endDate: "2026-12-31" },
  { n: 2, startDate: "2027-01-01", endDate: "2027-01-29" },
  { n: 3, startDate: "2027-02-01", endDate: "2027-02-26" },
  { n: 4, startDate: "2027-03-01", endDate: "2027-03-31" },
  { n: 5, startDate: "2027-04-01", endDate: "2027-04-30" },
  { n: 6, startDate: "2027-05-01", endDate: "2027-05-31" },
];

const p = (symbol: string, date: string, close: number) => ({ symbol, date, close, source: "manual" });
const t0 = "2026-11-20T10:00:00Z";

export function fixture(): EngineInput {
  return {
    settings: {
      capital: 1_000_000,
      riskFreeAnnual: 0.02,
      stopThreshold: 0.5,
      benchmarkSymbol: "SWDA.L",
      benchmarkCurrency: "USD",
      startDate: "2026-12-01",
      endDate: "2027-05-31",
    },
    months: MONTHS,
    teams: [
      { id: "A1", name: "TEST_A1", competition: "A", violations: 0 },
      { id: "B1", name: "TEST_B1", competition: "B", violations: 0 },
      { id: "ST", name: "TEST_STOP", competition: "A", violations: 1 },
    ],
    instruments: [
      { symbol: "AAPL", currency: "USD" },
      { symbol: "XYZ.MI", currency: "EUR" },
      { symbol: "ENI.MI", currency: "EUR" },
      { symbol: "STOPTEST", currency: "EUR" },
      { symbol: "SWDA.L", currency: "USD" },
    ],
    orders: [
      { id: "o1", teamId: "A1", monthN: 1, symbol: "AAPL", action: "open", side: "long", quantity: 100, createdAt: t0 },
      { id: "o2", teamId: "A1", monthN: 1, symbol: "XYZ.MI", action: "open", side: "short", quantity: 1000, createdAt: t0 },
      { id: "o3", teamId: "A1", monthN: 2, symbol: "XYZ.MI", action: "close", side: null, quantity: null, createdAt: t0 },
      { id: "o4", teamId: "B1", monthN: 2, symbol: "ENI.MI", action: "open", side: "long", quantity: 1000, createdAt: t0 },
      { id: "o5", teamId: "ST", monthN: 1, symbol: "STOPTEST", action: "open", side: "short", quantity: 1000, createdAt: t0 },
    ],
    transfers: [{ id: "x1", teamId: "B1", monthN: 1, currency: "USD", eurAmount: 10_000, createdAt: t0 }],
    prices: [
      p("AAPL", "2026-12-01", 200), p("AAPL", "2026-12-31", 210), p("AAPL", "2027-01-04", 212), p("AAPL", "2027-01-29", 220),
      p("XYZ.MI", "2026-12-01", 10), p("XYZ.MI", "2026-12-31", 12), p("XYZ.MI", "2027-01-04", 15),
      p("ENI.MI", "2027-01-04", 15), p("ENI.MI", "2027-01-29", 16.5),
      p("STOPTEST", "2026-12-01", 10), p("STOPTEST", "2026-12-31", 14), p("STOPTEST", "2027-01-05", 17), p("STOPTEST", "2027-01-29", 20),
      p("SWDA.L", "2026-12-01", 100), p("SWDA.L", "2026-12-31", 102), p("SWDA.L", "2027-01-29", 105),
      // a Yahoo row that must lose against the manual one on the same day
      { symbol: "AAPL", date: "2026-12-31", close: 999, source: "yahoo" },
    ],
    events: [{ symbol: "AAPL", date: "2027-01-20", type: "dividend", value: 1, source: "manual" }],
    fx: [
      { currency: "USD", date: "2026-12-01", rate: 1.1, source: "manual" },
      { currency: "USD", date: "2026-12-31", rate: 1.1, source: "manual" },
      { currency: "USD", date: "2027-01-04", rate: 1.1, source: "manual" },
      { currency: "USD", date: "2027-01-29", rate: 1.25, source: "manual" },
    ],
  };
}

export interface Check {
  name: string;
  expected: number | string;
  actual: number | string | null;
  pass: boolean;
}

export function runSelfTest(): { pass: boolean; checks: Check[] } {
  const res = runEngine(fixture(), "2027-01-29");
  const checks: Check[] = [];
  const num = (name: string, expected: number, actual: number | null | undefined, tol = 0.005) =>
    checks.push({ name, expected, actual: actual ?? null, pass: actual !== null && actual !== undefined && Math.abs(actual - expected) <= tol });
  const str = (name: string, expected: string, actual: string | null | undefined) =>
    checks.push({ name, expected, actual: actual ?? null, pass: actual === expected });
  const nav = (team: string, m: number) => res.navMonthly.find((x) => x.teamId === team && x.monthN === m)?.navEur;
  const sub = (team: string, c: string) => res.subportfolios.find((x) => x.teamId === team && x.currency === c);
  const met = (team: string) => res.metrics.find((x) => x.teamId === team)!;

  num("TEST_A1 NAV 31/12/2026", 998_909.09, nav("A1", 1));
  num("TEST_A1 NAV 29/01/2027", 996_680.0, nav("A1", 2));
  const xyz = res.positions.find((x) => x.teamId === "A1" && x.symbol === "XYZ.MI");
  str("TEST_A1 XYZ.MI exit date", "2027-01-04", xyz?.exitDate);
  num("TEST_A1 XYZ.MI exit price", 15, xyz?.exitPrice);
  str("TEST_A1 XYZ.MI exit reason (15 = stop level, stop has priority)", "stop", xyz?.exitReason);
  str("TEST_A1 close order on stopped position", "rejected", res.orderUpdates.find((x) => x.id === "o3")?.status);
  num("TEST_A1 EUR sub-portfolio", 995_000.0, sub("A1", "EUR")?.totalEur);
  num("TEST_A1 USD sub-portfolio (local)", 2_100.0, sub("A1", "USD")?.totalLocal);
  num("TEST_A1 USD sub-portfolio (EUR)", 1_680.0, sub("A1", "USD")?.totalEur);
  num("TEST_A1 total return %", -0.332, (met("A1").totalReturn ?? NaN) * 100, 1e-4);
  num("TEST_A1 rank in A", 1, met("A1").rankInCompetition);

  const x1 = res.transferUpdates.find((x) => x.id === "x1");
  num("TEST_B1 transfer rate", 1.1, x1?.rate, 1e-9);
  num("TEST_B1 NAV 31/12/2026", 1_000_000.0, nav("B1", 1));
  num("TEST_B1 NAV 29/01/2027", 1_000_300.0, nav("B1", 2));
  num("TEST_B1 EUR sub-portfolio", 991_500.0, sub("B1", "EUR")?.totalEur);
  num("TEST_B1 USD sub-portfolio (local)", 11_000.0, sub("B1", "USD")?.totalLocal);
  num("TEST_B1 USD sub-portfolio (EUR)", 8_800.0, sub("B1", "USD")?.totalEur);
  num("TEST_B1 rank in B", 1, met("B1").rankInCompetition);

  const st = res.positions.find((x) => x.teamId === "ST");
  num("TEST_STOP NAV 31/12/2026", 996_000.0, nav("ST", 1));
  str("TEST_STOP stop date", "2027-01-05", st?.exitDate);
  num("TEST_STOP exit price capped at +50%", 15, st?.exitPrice);
  str("TEST_STOP exit reason", "stop", st?.exitReason);
  num("TEST_STOP NAV 29/01/2027", 995_000.0, nav("ST", 2));
  num("TEST_STOP rank in A", 2, met("ST").rankInCompetition);

  num("Benchmark 31/12/2026", 1_020_000.0, res.benchmarkMonthly.find((x) => x.monthN === 1)?.valueEur);
  num("Benchmark 29/01/2027", 924_000.0, res.benchmarkMonthly.find((x) => x.monthN === 2)?.valueEur);

  // sub-portfolios always reconcile to NAV
  for (const t of ["A1", "B1", "ST"]) {
    const s = res.subportfolios.filter((x) => x.teamId === t).reduce((a, x) => a + (x.totalEur ?? 0), 0);
    num(`${t} sub-portfolios = NAV`, nav(t, 2)!, s);
  }
  // idempotency
  const again = runEngine(fixture(), "2027-01-29");
  str("Idempotent (two runs identical)", "yes", JSON.stringify(again) === JSON.stringify(res) ? "yes" : "no");

  return { pass: checks.every((c) => c.pass), checks };
}
