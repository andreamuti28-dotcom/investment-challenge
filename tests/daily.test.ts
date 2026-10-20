import { test } from "node:test";
import assert from "node:assert/strict";
import { runEngine, type EngineInput } from "../supabase/functions/_shared/core.ts";
import { MONTHS } from "../supabase/functions/_shared/selftest.ts";

const p = (symbol: string, date: string, close: number) => ({ symbol, date, close, source: "yahoo" });

function input(orders: EngineInput["orders"], transfers: EngineInput["transfers"] = []): EngineInput {
  return {
    settings: {
      capital: 1_000_000, riskFreeAnnual: 0.02, stopThreshold: 0.5, benchmarkSymbol: "SWDA.L", benchmarkCurrency: "GBP",
      startDate: "2026-12-01", endDate: "2027-05-31",
    },
    months: MONTHS,
    teams: [{ id: "T", name: "T", competition: "A", violations: 0 }],
    instruments: [{ symbol: "ENI.MI", currency: "EUR" }, { symbol: "AAPL", currency: "USD" }, { symbol: "SWDA.L", currency: "GBP" }],
    orders,
    transfers,
    prices: [
      p("ENI.MI", "2026-12-01", 10), p("ENI.MI", "2026-12-02", 11), p("ENI.MI", "2026-12-03", 12), p("ENI.MI", "2026-12-04", 13),
      p("ENI.MI", "2026-12-23", 14), p("ENI.MI", "2026-12-28", 15),
      p("AAPL", "2026-12-02", 200),
      p("SWDA.L", "2026-12-01", 100), p("SWDA.L", "2026-12-31", 100),
    ],
    events: [],
    fx: [
      { currency: "GBP", date: "2026-12-01", rate: 0.85, source: "ecb" },
      { currency: "USD", date: "2026-12-01", rate: 1.1, source: "ecb" },
      { currency: "USD", date: "2026-12-02", rate: 1.2, source: "ecb" },
    ],
  };
}
const o = (id: string, execDate: string, createdAt: string, symbol: string, action: "open" | "close" | "change", side: "long" | "short" | null, quantity: number | null) =>
  ({ id, teamId: "T", monthN: 1, symbol, action, side, quantity, createdAt, execDate });

test("an order is executed at the close of its own execution date", () => {
  const r = runEngine(input([
    o("a", "2026-12-02", "2026-12-02T09:00:00Z", "ENI.MI", "open", "long", 100),
    o("b", "2026-12-04", "2026-12-04T10:00:00Z", "ENI.MI", "close", null, null),
  ]), "2026-12-31");
  const a = r.orderUpdates.find((x) => x.id === "a")!, b = r.orderUpdates.find((x) => x.id === "b")!;
  assert.deepEqual([a.status, a.executedDate, a.executedPrice], ["executed", "2026-12-02", 11]);
  assert.deepEqual([b.status, b.executedDate, b.executedPrice], ["executed", "2026-12-04", 13]);
  const pos = r.positions[0];
  assert.equal(pos.pnlLocal, 200); // (13 - 11) x 100
  assert.equal(r.navMonthly.find((x) => x.monthN === 1)!.navEur, 1_000_200);
});

test("a holiday rolls the order to the next close", () => {
  const r = runEngine(input([o("h", "2026-12-25", "2026-12-24T18:00:00Z", "ENI.MI", "open", "short", 10)]), "2026-12-31");
  const h = r.orderUpdates[0];
  assert.deepEqual([h.executedDate, h.executedPrice], ["2026-12-28", 15]);
});

test("orders on the same symbol and day run in the order they were placed", () => {
  const r = runEngine(input([
    o("open", "2026-12-01", "2026-11-20T10:00:00Z", "ENI.MI", "open", "long", 100),
    o("close", "2026-12-03", "2026-12-03T08:00:00Z", "ENI.MI", "close", null, null),
    o("reopen", "2026-12-03", "2026-12-03T09:00:00Z", "ENI.MI", "open", "short", 50),
  ]), "2026-12-31");
  assert.ok(r.orderUpdates.every((x) => x.status === "executed"));
  const short = r.positions.find((x) => x.side === "short")!;
  assert.deepEqual([short.entryDate, short.entryPrice, short.exitDate], ["2026-12-03", 12, null]);
});

test("a transfer uses the ECB rate of its execution date", () => {
  const r = runEngine(input([], [{ id: "x", teamId: "T", monthN: 1, currency: "USD", eurAmount: 1000, createdAt: "2026-12-02T08:00:00Z", execDate: "2026-12-02" }]), "2026-12-31");
  assert.deepEqual([r.transferUpdates[0].executedDate, r.transferUpdates[0].rate], ["2026-12-02", 1.2]);
});

test("an order dated after the valuation date stays pending", () => {
  const r = runEngine(input([o("f", "2026-12-04", "2026-12-03T20:00:00Z", "ENI.MI", "open", "long", 1)]), "2026-12-03");
  assert.equal(r.orderUpdates[0].status, "pending");
});

test("months are derived from the start and end dates", async () => {
  const { generateMonths } = await import("../supabase/functions/_shared/core.ts");
  assert.deepEqual(generateMonths("2026-12-01", "2027-05-31"), MONTHS);
  const early = generateMonths("2026-10-20", "2027-05-31");
  assert.equal(early.length, 8);
  assert.deepEqual(early[0], { n: 1, startDate: "2026-10-20", endDate: "2026-10-30" }); // 31 Oct is a Saturday
  assert.deepEqual(early.at(-1), { n: 8, startDate: "2027-05-01", endDate: "2027-05-31" });
});
