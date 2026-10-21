// Market data: Yahoo Finance (public chart/search endpoints) and ECB reference rates.
// Plain fetch, no dependencies: runs in Deno and Node 22.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const YAHOO_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function getText(urls: string[], tries = 3): Promise<string> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json,text/csv,*/*" } });
        if (r.ok) return await r.text();
        last = `${r.status} ${r.statusText} on ${url}`;
        if (r.status === 404) throw new Error(`not found: ${url}`);
      } catch (e) {
        last = String((e as Error).message ?? e);
        if (last.startsWith("not found")) throw e;
      }
    }
    await sleep(500 * 2 ** i);
  }
  throw new Error(`request failed: ${last}`);
}

const yahoo = (path: string) => YAHOO_HOSTS.map((h) => h + path);

/** Yahoo minor units: GBp (pence), ZAc (cents), ILA (agorot) */
export function normalizeCurrency(c: string | undefined | null): { currency: string; divisor: number } {
  const raw = (c ?? "").trim();
  if (raw === "GBp" || raw === "GBX") return { currency: "GBP", divisor: 100 };
  if (raw === "ZAc" || raw === "ZAC") return { currency: "ZAR", divisor: 100 };
  if (raw === "ILA") return { currency: "ILS", divisor: 100 };
  return { currency: raw.toUpperCase(), divisor: 1 };
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  quoteType: string;
}

export async function searchEquities(q: string): Promise<SearchHit[]> {
  const txt = await getText(
    yahoo(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`).reverse(),
  );
  const j = JSON.parse(txt);
  return (j.quotes ?? [])
    .filter((x: any) => x.quoteType === "EQUITY" && x.symbol)
    .map((x: any) => ({
      symbol: x.symbol,
      name: x.longname ?? x.shortname ?? x.symbol,
      exchange: x.exchDisp ?? x.exchange ?? "",
      quoteType: x.quoteType,
    }));
}

export interface ParsedChart {
  currency: string;
  divisor: number;
  instrumentType: string;
  exchange: string;
  name: string;
  lastPrice: number | null;
  /** IANA time zone of the exchange, e.g. America/New_York */
  timezone: string | null;
  /** regular-session closing time in exchange local time, "HH:MM" */
  closeTime: string | null;
  prices: { date: string; close: number }[];
  /** isolated bad ticks removed from prices (see despike) */
  dropped: { date: string; close: number }[];
  dividends: { date: string; value: number }[];
  splits: { date: string; value: number }[];
}

/** Removes isolated bad ticks: a close that jumps more than 20% away from the day before and
 *  comes back the next day (the days around it within 5% of each other). Real moves persist. */
export function despike(prices: { date: string; close: number }[]) {
  const keep: typeof prices = [], dropped: typeof prices = [];
  for (let i = 0; i < prices.length; i++) {
    const a = prices[i - 1]?.close, b = prices[i].close, c = prices[i + 1]?.close;
    const spike = a !== undefined && c !== undefined && Math.abs(b / a - 1) > 0.2 && Math.abs(c / b - 1) > 0.2 &&
      Math.sign(b - a) !== Math.sign(c - b) && Math.abs(c / a - 1) < 0.05;
    (spike ? dropped : keep).push(prices[i]);
  }
  return { prices: keep, dropped };
}

const localDate = (ts: number, gmtoffset: number) => new Date((ts + gmtoffset) * 1000).toISOString().slice(0, 10);

/** Parse a Yahoo v8 chart payload. Closes are NOT dividend-adjusted. Values are divided
 *  by the minor-unit divisor (pence -> pounds). A bar of a session still open is dropped. */
export function parseChart(json: any, nowMs = Date.now()): ParsedChart {
  const res = json?.chart?.result?.[0];
  if (!res) throw new Error(json?.chart?.error?.description ?? "empty chart");
  const meta = res.meta ?? {};
  const { currency, divisor } = normalizeCurrency(meta.currency);
  const off = Number(meta.gmtoffset ?? 0);
  const ts: number[] = res.timestamp ?? [];
  const closes: (number | null)[] = res.indicators?.quote?.[0]?.close ?? [];
  let openSessionDate: string | null = null;
  const reg = meta.currentTradingPeriod?.regular;
  if (reg?.start && reg?.end && nowMs / 1000 >= reg.start && nowMs / 1000 < reg.end) {
    openSessionDate = localDate(reg.start, off);
  }
  const byDate = new Map<string, number>();
  ts.forEach((t, i) => {
    const c = closes[i];
    if (c === null || c === undefined || !isFinite(c) || c <= 0) return;
    const d = localDate(t, off);
    if (d === openSessionDate) return;
    byDate.set(d, c / divisor);
  });
  const dividends = Object.values(res.events?.dividends ?? {}).map((x: any) => ({
    date: localDate(x.date, off),
    value: Number(x.amount) / divisor,
  }));
  const splits = Object.values(res.events?.splits ?? {})
    .map((x: any) => ({ date: localDate(x.date, off), value: Number(x.numerator) / Number(x.denominator) }))
    .filter((s) => isFinite(s.value) && s.value > 0 && s.value !== 1);
  return {
    currency,
    divisor,
    instrumentType: meta.instrumentType ?? "",
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? "",
    name: meta.longName ?? meta.shortName ?? meta.symbol ?? "",
    lastPrice: typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice / divisor : null,
    timezone: typeof meta.exchangeTimezoneName === "string" ? meta.exchangeTimezoneName : null,
    closeTime: reg?.end ? new Date((reg.end + Number(reg.gmtoffset ?? off)) * 1000).toISOString().slice(11, 16) : null,
    ...despike([...byDate].sort().map(([date, close]) => ({ date, close }))),
    dividends,
    splits,
  };
}

export async function fetchChart(symbol: string, fromDate: string, nowMs = Date.now()): Promise<ParsedChart> {
  const p1 = Math.floor(Date.parse(fromDate + "T00:00:00Z") / 1000);
  const p2 = Math.floor(nowMs / 1000) + 86400;
  const txt = await getText(
    yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits&includePrePost=false`),
  );
  return parseChart(JSON.parse(txt), nowMs);
}

export async function validateSymbol(symbol: string) {
  const c = await fetchChart(symbol, new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10));
  return {
    symbol,
    name: c.name,
    exchange: c.exchange,
    currency: c.currency,
    priceDivisor: c.divisor,
    quoteType: c.instrumentType,
    lastPrice: c.lastPrice,
    /** last completed session: the reference price shown before an order */
    lastClose: c.prices.at(-1) ?? null,
    timezone: c.timezone,
    closeTime: c.closeTime,
  };
}

// ------------------------------------------------------------------ ECB
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      cur.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((x) => x !== "")) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  if (field !== "" || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

export function parseEcb(text: string): { currency: string; date: string; rate: number }[] {
  return parseCsv(text)
    .map((r) => ({ currency: r.CURRENCY, date: r.TIME_PERIOD, rate: Number(r.OBS_VALUE) }))
    .filter((r) => r.currency && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isFinite(r.rate) && r.rate > 0);
}

/** ECB reference rates, units of currency per 1 EUR. Currencies the ECB does not publish are returned in `missing`. */
export async function fetchEcb(currencies: string[], fromDate: string) {
  const list = [...new Set(currencies.map((c) => c.toUpperCase()).filter((c) => c && c !== "EUR"))];
  if (!list.length) return { rates: [], missing: [] as string[] };
  const txt = await getText([
    `https://data-api.ecb.europa.eu/service/data/EXR/D.${list.join("+")}.EUR.SP00.A?startPeriod=${fromDate}&format=csvdata`,
  ]);
  const rates = parseEcb(txt);
  const got = new Set(rates.map((r) => r.currency));
  return { rates, missing: list.filter((c) => !got.has(c)) };
}
