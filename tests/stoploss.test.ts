import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMonths, runChallenge, type EngineInput, type StopRow } from "../supabase/functions/_shared/core.ts";

const p = (symbol: string, date: string, close: number) => ({ symbol, date, close, source: "yahoo" });
const o = (id: string, execDate: string, createdAt: string, symbol: string, action: "open" | "close" | "change", side: "long" | "short" | null, quantity: number | null) =>
  ({ id, teamId: "T", monthN: 1, symbol, action, side, quantity, createdAt, execDate });
const s = (effDate: string, createdAt: string, symbol: string, stopPrice: number | null): StopRow => ({ teamId: "T", symbol, stopPrice, createdAt, effDate });

function input(orders: EngineInput["orders"], stops: StopRow[], practice: string | null = null): EngineInput {
  return {
    settings: { capital: 1_000_000, riskFreeAnnual: 0.02, stopThreshold: 0.5, benchmarkSymbol: "SWDA.L", benchmarkCurrency: "GBP", startDate: "2026-12-01", endDate: "2027-05-31", practiceStartDate: practice },
    months: generateMonths("2026-12-01", "2027-05-31"),
    teams: [{ id: "T", name: "T", competition: "A", violations: 0 }],
    instruments: [{ symbol: "ENI.MI", currency: "EUR" }, { symbol: "SWDA.L", currency: "GBP" }],
    orders,
    transfers: [],
    prices: [
      p("ENI.MI", "2026-11-20", 10), p("ENI.MI", "2026-11-30", 10), p("ENI.MI", "2026-12-01", 10), p("ENI.MI", "2026-12-02", 9.5), p("ENI.MI", "2026-12-03", 8.7), p("ENI.MI", "2026-12-04", 12),
      p("SWDA.L", "2026-11-20", 100), p("SWDA.L", "2026-12-01", 100), p("SWDA.L", "2026-12-04", 100),
    ],
    events: [],
    fx: [{ currency: "GBP", date: "2026-11-01", rate: 0.85, source: "ecb" }],
    stops,
  };
}

test("a long position is closed at the first close at or below its stop loss", () => {
  const r = runChallenge(input([o("a", "2026-12-01", "2026-12-01T09:00:00Z", "ENI.MI", "open", "long", 1000)], [s("2026-12-01", "2026-12-01T09:01:00Z", "ENI.MI", 9)]), "2026-12-04");
  const pos = r.positions[0];
  assert.equal(pos.exitDate, "2026-12-03");
  assert.equal(pos.exitPrice, 8.7); // at the close that crossed the stop (daily close only)
  assert.equal(pos.exitReason, "stop_loss");
  assert.equal(Math.round(r.metrics[0].nav!), 1_000_000 - 1000 * 1.3);
  assert.equal(r.metrics[0].operations, 2);
});

test("a short stop loss triggers at or above the stop; removing it keeps the position", () => {
  const up = runChallenge(input([o("a", "2026-12-01", "2026-12-01T09:00:00Z", "ENI.MI", "open", "short", 100)], [s("2026-12-01", "2026-12-01T09:01:00Z", "ENI.MI", 11)]), "2026-12-04");
  assert.equal(up.positions[0].exitReason, "stop_loss");
  assert.equal(up.positions[0].exitDate, "2026-12-04");
  const removed = runChallenge(input([o("a", "2026-12-01", "2026-12-01T09:00:00Z", "ENI.MI", "open", "long", 1000)], [
    s("2026-12-01", "2026-12-01T09:01:00Z", "ENI.MI", 9), s("2026-12-02", "2026-12-02T09:00:00Z", "ENI.MI", null),
  ]), "2026-12-04");
  assert.equal(removed.positions[0].exitDate, null);
  assert.equal(removed.positions[0].stopLoss, null);
});

test("a stop of a closed position does not pass to a new position on the same stock", () => {
  const r = runChallenge(input([
    o("a", "2026-12-01", "2026-12-01T09:00:00Z", "ENI.MI", "open", "long", 1000),
    o("b", "2026-12-02", "2026-12-02T09:00:00Z", "ENI.MI", "close", null, null),
    o("c", "2026-12-03", "2026-12-03T09:00:00Z", "ENI.MI", "open", "long", 1000),
  ], [s("2026-12-01", "2026-12-01T09:01:00Z", "ENI.MI", 9.6)]), "2026-12-04");
  // 2 Dec close 9.5 <= 9.6: stopped before the close order, which is then rejected
  assert.equal(r.positions[0].exitReason, "stop_loss");
  assert.equal(r.orderUpdates.find((u) => u.id === "b")!.status, "rejected");
  assert.equal(r.positions[1].exitDate, null);
  assert.equal(r.positions[1].stopLoss, null);
});

test("the stop set during the practice stays on the carried position", () => {
  const r = runChallenge(input([o("a", "2026-11-20", "2026-11-20T09:00:00Z", "ENI.MI", "open", "long", 1000)], [s("2026-11-20", "2026-11-20T09:01:00Z", "ENI.MI", 9)], "2026-11-20"), "2026-12-04");
  const pos = r.positions.find((x) => x.entryDate === "2026-12-01")!;
  assert.equal(pos.exitReason, "stop_loss");
  assert.equal(pos.exitDate, "2026-12-03");
});
