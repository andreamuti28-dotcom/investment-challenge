import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCurrency, parseChart, parseEcb } from "../supabase/functions/_shared/marketdata.ts";

// Shape of a real Yahoo v8 chart response (London stock quoted in pence)
const vod = {
  chart: { error: null, result: [{
    meta: { currency: "GBp", symbol: "VOD.L", exchangeName: "LSE", fullExchangeName: "LSE", instrumentType: "EQUITY",
      gmtoffset: 0, regularMarketPrice: 7040, longName: "Vodafone Group Public Limited Company",
      currentTradingPeriod: { regular: { start: Date.parse("2026-12-03T08:00:00Z") / 1000, end: Date.parse("2026-12-03T16:30:00Z") / 1000 } } },
    timestamp: [Date.parse("2026-12-01T08:00:00Z") / 1000, Date.parse("2026-12-02T08:00:00Z") / 1000, Date.parse("2026-12-03T08:00:00Z") / 1000],
    events: { dividends: { "1": { amount: 2.25, date: Date.parse("2026-12-02T08:00:00Z") / 1000 } },
              splits: { "2": { numerator: 2, denominator: 1, date: Date.parse("2026-12-02T08:00:00Z") / 1000 } } },
    indicators: { quote: [{ close: [7040, null, 7100] }], adjclose: [{ adjclose: [6900, null, 7000] }] },
  }] },
};

test("Yahoo chart: pence -> pounds, nulls skipped, open session dropped, events parsed", () => {
  const c = parseChart(vod, Date.parse("2026-12-03T12:00:00Z"));
  assert.equal(c.currency, "GBP");
  assert.equal(c.divisor, 100);
  assert.deepEqual(c.prices, [{ date: "2026-12-01", close: 70.4 }]);
  assert.deepEqual(c.dividends, [{ date: "2026-12-02", value: 0.0225 }]);
  assert.deepEqual(c.splits, [{ date: "2026-12-02", value: 2 }]);
  assert.equal(c.lastPrice, 70.4);
  // after the close the last bar is kept
  const after = parseChart(vod, Date.parse("2026-12-03T18:00:00Z"));
  assert.equal(after.prices.at(-1)!.close, 71);
});

test("Tokyo bar dated with the exchange local date (gmtoffset)", () => {
  const j = { chart: { result: [{ meta: { currency: "JPY", gmtoffset: 32400, instrumentType: "EQUITY" },
    timestamp: [Date.parse("2026-12-01T00:00:00Z") / 1000], indicators: { quote: [{ close: [2500] }] } }] } };
  // 00:00 UTC = 09:00 in Tokyo on the same day
  assert.deepEqual(parseChart(j, Date.parse("2026-12-05T00:00:00Z")).prices, [{ date: "2026-12-01", close: 2500 }]);
});

test("currency normalisation", () => {
  assert.deepEqual(normalizeCurrency("GBp"), { currency: "GBP", divisor: 100 });
  assert.deepEqual(normalizeCurrency("ZAc"), { currency: "ZAR", divisor: 100 });
  assert.deepEqual(normalizeCurrency("usd"), { currency: "USD", divisor: 1 });
});

test("ECB csvdata parsing, including quoted titles with commas", () => {
  const csv = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,TITLE\n' +
    'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-12-01,1.0987,"US dollar/Euro, ECB reference"\n' +
    'EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-12-01,0.8512,"UK pound sterling/Euro"\r\n';
  assert.deepEqual(parseEcb(csv), [
    { currency: "USD", date: "2026-12-01", rate: 1.0987 },
    { currency: "GBP", date: "2026-12-01", rate: 0.8512 },
  ]);
});

test("Yahoo chart: exchange time zone and closing time (local)", () => {
  const nyse = { chart: { error: null, result: [{
    meta: { currency: "USD", symbol: "AAPL", instrumentType: "EQUITY", exchangeTimezoneName: "America/New_York", gmtoffset: -18000,
      currentTradingPeriod: { regular: { start: Date.parse("2026-12-03T14:30:00Z") / 1000, end: Date.parse("2026-12-03T21:00:00Z") / 1000, gmtoffset: -18000 } } },
    timestamp: [], indicators: { quote: [{ close: [] }] },
  }] } };
  const c = parseChart(nyse);
  assert.equal(c.timezone, "America/New_York");
  assert.equal(c.closeTime, "16:00");
  assert.equal(parseChart(vod).closeTime, "16:30");
});

test("isolated bad ticks are removed, real moves are kept", async () => {
  const { despike } = await import("../supabase/functions/_shared/marketdata.ts");
  const p = (date: string, close: number) => ({ date, close });
  const r = despike([p("a", 110), p("b", 147), p("c", 111), p("d", 112)]);
  assert.deepEqual(r.dropped, [p("b", 147)]);
  assert.equal(r.prices.length, 3);
  const crash = despike([p("a", 100), p("b", 70), p("c", 72), p("d", 71)]); // a real -30% that persists
  assert.equal(crash.dropped.length, 0);
});
