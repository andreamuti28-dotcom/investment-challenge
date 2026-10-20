import { test } from "node:test";
import assert from "node:assert/strict";
import { runEngine, type EngineInput } from "../supabase/functions/_shared/core.ts";
import { fixture, MONTHS } from "../supabase/functions/_shared/selftest.ts";

const close = (a: number | null | undefined, b: number, tol = 1e-6) =>
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, `${a} != ${b}`);

test("metrics equal the Excel workbook (independent implementation)", () => {
  const m = runEngine(fixture(), "2027-01-29").metrics.find((x) => x.teamId === "A1")!;
  close(m.volatility, 0.00279392770542317, 1e-9);
  close(m.sharpe, -14.2933570793206, 1e-6);
  close(m.sortino, -3.41432746620629, 1e-6);
  close(m.beta, 0.00999509049490557, 1e-9);
  close(m.trackingError, 0.276736078235715, 1e-9);
  close(m.maxDrawdown, -0.00331999999999999, 1e-12);
  close(m.calmar, -5.95041989981305, 1e-6);
  close(m.maxWeight, 0.0176586266404463, 1e-9);
  close(m.hhi, 1, 1e-12);
  assert.equal(m.operations, 3);
  assert.equal(m.monthsCompleted, 2);
});

function base(): EngineInput {
  const f = fixture();
  return { ...f, teams: [{ id: "T", name: "T", competition: "A", violations: 0 }], orders: [], transfers: [], events: [] };
}
const t0 = "2026-11-20T10:00:00Z";

test("partial sale via change: realised P&L on sold part, new basis on the rest", () => {
  const f = base();
  f.instruments.push({ symbol: "ABC.MI", currency: "EUR" });
  f.prices.push(
    { symbol: "ABC.MI", date: "2026-12-01", close: 10, source: "manual" },
    { symbol: "ABC.MI", date: "2027-01-04", close: 12, source: "manual" },
    { symbol: "ABC.MI", date: "2027-01-29", close: 13, source: "manual" },
  );
  f.orders = [
    { id: "a", teamId: "T", monthN: 1, symbol: "ABC.MI", action: "open", side: "long", quantity: 1000, createdAt: t0 },
    { id: "b", teamId: "T", monthN: 2, symbol: "ABC.MI", action: "change", side: "long", quantity: 600, createdAt: t0 },
  ];
  const r = runEngine(f, "2027-01-29");
  // 1000 bought at 10, 400 sold at 12 (+800), 600 held 12 -> 13 (+600) ; plus +1200 on the 600 from 10 to 12
  close(r.navMonthly.find((x) => x.monthN === 2)!.navEur, 1_000_000 + 1000 * 2 + 600 * 1, 1e-6);
  const open = r.positions.filter((p) => !p.exitDate);
  assert.equal(open.length, 1);
  assert.equal(open[0].quantity, 600);
  assert.equal(open[0].entryPrice, 12);
  assert.equal(r.metrics[0].operations, 3);
});

test("split adjusts quantity and basis without changing value", () => {
  const f = base();
  f.instruments.push({ symbol: "SPL", currency: "EUR" });
  f.prices.push(
    { symbol: "SPL", date: "2026-12-01", close: 100, source: "manual" },
    { symbol: "SPL", date: "2026-12-15", close: 52, source: "manual" },
  );
  f.events = [{ symbol: "SPL", date: "2026-12-15", type: "split", value: 2, source: "manual" }];
  f.orders = [{ id: "a", teamId: "T", monthN: 1, symbol: "SPL", action: "open", side: "long", quantity: 10, createdAt: t0 }];
  const r = runEngine(f, "2026-12-31");
  const p = r.positions[0];
  assert.equal(p.quantity, 20);
  assert.equal(p.entryPrice, 50);
  close(r.navMonthly.find((x) => x.monthN === 1)!.navEur, 1_000_000 + 20 * 2, 1e-9);
});

test("close after stop-out is rejected, not executed twice", () => {
  const f = fixture();
  f.orders.push({ id: "late", teamId: "ST", monthN: 2, symbol: "STOPTEST", action: "close", side: null, quantity: null, createdAt: t0 });
  // STOPTEST has no close on 2027-01-04, first close of month 2 is 2027-01-05: stop and order the same day
  const r = runEngine(f, "2027-01-29");
  const u = r.orderUpdates.find((x) => x.id === "late")!;
  // the stop runs first: exit at 15 (loss capped at 50%), the close order is rejected
  assert.equal(u.status, "rejected");
  const pos = r.positions.find((p) => p.teamId === "ST")!;
  assert.equal(pos.exitReason, "stop");
  assert.equal(pos.exitPrice, 15);
});

test("conversion back to EUR, open-before-start and ties", () => {
  const f = base();
  f.teams.push({ id: "U", name: "U", competition: "A", violations: 0 });
  f.transfers = [
    { id: "x", teamId: "T", monthN: 1, currency: "USD", eurAmount: 1000, createdAt: t0 },
    { id: "y", teamId: "T", monthN: 2, currency: "USD", eurAmount: -1000, createdAt: t0 },
  ];
  const before = runEngine(f, "2026-11-25");
  assert.equal(before.metrics[0].totalReturn, 0);
  assert.equal(before.navDaily.length, 0);
  const r = runEngine(f, "2027-01-29");
  // 1000 EUR -> 1100 USD at 1.10, back with -1000 EUR at 1.10 on 2027-01-04: USD 0, no FX effect
  const usd = r.subportfolios.find((s) => s.teamId === "T" && s.currency === "USD");
  assert.ok(!usd || Math.abs(usd.totalLocal) < 1e-9);
  close(r.navMonthly.find((x) => x.teamId === "T" && x.monthN === 2)!.navEur, 1_000_000, 1e-9);
  assert.deepEqual(r.metrics.map((m) => m.rankInCompetition), [1, 1]);
});

test("missing FX rate produces a warning instead of a wrong number", () => {
  const f = base();
  f.instruments.push({ symbol: "SHOP.TO", currency: "CAD" });
  f.prices.push(
    { symbol: "SHOP.TO", date: "2026-12-01", close: 100, source: "manual" },
    { symbol: "SHOP.TO", date: "2026-12-30", close: 110, source: "manual" },
  );
  f.orders = [{ id: "a", teamId: "T", monthN: 1, symbol: "SHOP.TO", action: "open", side: "long", quantity: 1, createdAt: t0 }];
  const r = runEngine(f, "2026-12-31");
  assert.ok(r.warnings.some((w) => w.includes("CAD")));
  assert.equal(r.navMonthly.find((x) => x.monthN === 1), undefined);
  assert.ok(MONTHS.length === 6);
});
