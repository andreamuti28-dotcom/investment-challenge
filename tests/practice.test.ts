import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMonths, runChallenge, type EngineInput } from "../supabase/functions/_shared/core.ts";

const p = (symbol: string, date: string, close: number) => ({ symbol, date, close, source: "yahoo" });
const o = (id: string, execDate: string, createdAt: string, symbol: string, action: "open" | "close" | "change", side: "long" | "short" | null, quantity: number | null) =>
  ({ id, teamId: "T", monthN: 1, symbol, action, side, quantity, createdAt, execDate });

function input(orders: EngineInput["orders"]): EngineInput {
  return {
    settings: {
      capital: 1_000_000, riskFreeAnnual: 0.02, stopThreshold: 0.5, benchmarkSymbol: "SWDA.L", benchmarkCurrency: "GBP",
      startDate: "2026-12-01", endDate: "2027-05-31", practiceStartDate: "2026-10-21",
    },
    months: generateMonths("2026-12-01", "2027-05-31"),
    teams: [{ id: "T", name: "T", competition: "A", violations: 0 }],
    instruments: [{ symbol: "ENI.MI", currency: "EUR" }, { symbol: "AAPL", currency: "USD" }, { symbol: "SWDA.L", currency: "GBP" }],
    orders,
    transfers: [],
    prices: [
      p("ENI.MI", "2026-10-21", 10), p("ENI.MI", "2026-10-22", 11), p("ENI.MI", "2026-11-30", 20), p("ENI.MI", "2026-12-01", 16), p("ENI.MI", "2026-12-02", 18),
      p("AAPL", "2026-10-22", 100), p("AAPL", "2026-11-10", 120), p("AAPL", "2026-12-01", 150),
      p("SWDA.L", "2026-10-21", 90), p("SWDA.L", "2026-11-30", 95), p("SWDA.L", "2026-12-01", 100), p("SWDA.L", "2026-12-02", 101),
    ],
    events: [],
    fx: [
      { currency: "GBP", date: "2026-10-21", rate: 0.85, source: "ecb" },
      { currency: "USD", date: "2026-10-21", rate: 1.1, source: "ecb" },
      { currency: "USD", date: "2026-12-01", rate: 1.2, source: "ecb" },
    ],
  };
}

test("during the practice orders execute at the close and results start from the practice start", () => {
  const r = runChallenge(input([o("a", "2026-10-21", "2026-10-21T09:00:00Z", "ENI.MI", "open", "long", 1000)]), "2026-11-30");
  assert.equal(r.asOf, "2026-11-30");
  const a = r.orderUpdates.find((u) => u.id === "a")!;
  assert.equal(a.status, "executed");
  assert.equal(a.executedDate, "2026-10-21");
  assert.equal(r.metrics[0].nav, 1_000_000 + 1000 * (20 - 10)); // practice gain visible before the start
});

test("from the start, open practice positions are re-entered at the start close on a fresh capital", () => {
  const r = runChallenge(input([
    o("a", "2026-10-21", "2026-10-21T09:00:00Z", "ENI.MI", "open", "long", 1000),
    o("b", "2026-10-22", "2026-10-22T09:00:00Z", "AAPL", "open", "short", 100),
    o("c", "2026-11-10", "2026-11-10T09:00:00Z", "AAPL", "close", null, null), // closed in practice: not carried
    o("d", "2026-12-02", "2026-12-02T09:00:00Z", "ENI.MI", "change", "long", 500),
  ]), "2026-12-02");
  // practice orders keep their own history
  assert.equal(r.orderUpdates.find((u) => u.id === "a")!.executedDate, "2026-10-21");
  assert.equal(r.orderUpdates.find((u) => u.id === "c")!.status, "executed");
  // the ENI position is carried at the 1 Dec close (16), attributed to order a, then changed on 2 Dec
  const eni = r.positions.filter((x) => x.symbol === "ENI.MI");
  assert.equal(eni[0].orderId, "a");
  assert.equal(eni[0].entryDate, "2026-12-01");
  assert.equal(eni[0].entryPrice, 16);
  assert.equal(eni[0].exitDate, "2026-12-02");
  assert.equal(eni[1].orderId, "d");
  assert.equal(eni[1].quantity, 500);
  // AAPL was closed during the practice: nothing carried
  assert.equal(r.positions.filter((x) => x.symbol === "AAPL").length, 0);
  // fresh capital: the practice gain (1000 x 10) is gone; 1 Dec -> 2 Dec gain = 1000 x (18 - 16)
  assert.equal(Math.round(r.metrics[0].nav!), 1_000_000 + 1000 * (18 - 16));
  // the carried open is not an operation; the change counts two
  assert.equal(r.metrics[0].operations, 2);
  // no practice ledger after the start
  assert.ok(r.ledger.every((l) => l.date >= "2026-12-01"));
});

test("a practice order still pending at the start is rejected, not carried", () => {
  const r = runChallenge(input([o("x", "2026-11-27", "2026-11-27T09:00:00Z", "AAPL", "open", "long", 10)]), "2026-12-01");
  const x = r.orderUpdates.find((u) => u.id === "x")!;
  assert.equal(x.status, "rejected");
  assert.match(x.rejectReason!, /before the start/);
});

test("without a practice date the engine behaves as before", () => {
  const i = input([o("a", "2026-12-01", "2026-11-01T09:00:00Z", "ENI.MI", "open", "long", 1000)]);
  i.settings.practiceStartDate = null;
  const r = runChallenge(i, "2026-12-02");
  assert.equal(r.positions[0].entryPrice, 16);
  assert.equal(r.metrics[0].operations, 1);
});
