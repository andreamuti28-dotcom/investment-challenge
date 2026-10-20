// Excel reports (Admin > Export): the whole challenge or a single team.
// Built in the browser with ExcelJS; numbers stay live formulas where the sheet can compute
// them (totals, returns, P&L), with the engine's results cached so previews show values.
import type ExcelJS from "exceljs";
import { supabase } from "./supabase";
import { calendarMonths, type CalMonth } from "./months";

// ------------------------------------------------------------------ data
export interface ExportData {
  scope: "all" | "team";
  settings: any;
  months: CalMonth[];
  teams: any[];
  leaderboard: any[];
  subs: any[];
  positions: any[];
  orders: any[];
  navMonthly: any[];
  benchMonthly: any[];
  navDaily: any[];
  benchDaily: any[];
  ledger: any[];
  instruments: Record<string, { name: string | null; exchange: string | null; currency: string }>;
  members: { name: string; role: string; email: string; joined: string }[];
}

async function all<T = any>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function loadExportData(teamId?: string): Promise<ExportData> {
  const byTeam = <Q extends { eq: (c: string, v: string) => Q }>(q: Q) => (teamId ? q.eq("team_id", teamId) : q);
  const [settings, teams, leaderboard, subs, positions, orders, navMonthly, benchMonthly, navDaily, benchDaily, ledger, instr, info] = await Promise.all([
    supabase.from("challenge_settings").select("*").eq("id", 1).single().then((r) => { if (r.error) throw r.error; return r.data; }),
    all((a, b) => (teamId ? supabase.from("teams").select("*").eq("id", teamId) : supabase.from("teams").select("*")).order("name").range(a, b)),
    all((a, b) => byTeam(supabase.from("leaderboard").select("*")).range(a, b)),
    all((a, b) => byTeam(supabase.from("subportfolios").select("*")).order("currency").range(a, b)),
    all((a, b) => byTeam(supabase.from("positions").select("*")).order("entry_date").order("id").range(a, b)),
    all((a, b) => byTeam(supabase.from("orders").select("*")).order("created_at").range(a, b)),
    all((a, b) => byTeam(supabase.from("nav_monthly").select("*")).order("month_n").range(a, b)),
    all((a, b) => supabase.from("benchmark_monthly").select("*").order("month_n").range(a, b)),
    all((a, b) => byTeam(supabase.from("nav_daily").select("*")).order("date").range(a, b)),
    all((a, b) => supabase.from("benchmark_daily").select("*").order("date").range(a, b)),
    all((a, b) => byTeam(supabase.from("cash_ledger").select("*")).order("date").order("id").range(a, b)),
    all((a, b) => supabase.from("instruments").select("symbol,name,exchange,currency").range(a, b)),
    teamId ? supabase.rpc("team_info_admin", { p_team: teamId }) : Promise.resolve({ data: null, error: null }),
  ]);
  if ((info as any).error) throw (info as any).error;
  return {
    scope: teamId ? "team" : "all",
    settings,
    months: calendarMonths((settings as any).start_date, (settings as any).end_date),
    teams,
    leaderboard,
    subs,
    positions,
    orders,
    navMonthly,
    benchMonthly,
    navDaily,
    benchDaily,
    ledger,
    instruments: Object.fromEntries((instr as any[]).map((i) => [i.symbol, i])),
    members: ((info as any).data?.members ?? []) as any[],
  };
}

// ------------------------------------------------------------------ style
const FONT = "Arial";
const C = {
  navy: "FF1B2540",
  ink: "FF1F2937",
  grey: "FF6B7280",
  line: "FFD9DEE8",
  band: "FFF5F7FB",
  section: "FFE8EDFB",
  accent: "FF3B5BDB",
  white: "FFFFFFFF",
};
const F = {
  money: '#,##0.00;[Red]-#,##0.00;"–"',
  pnl: '[Color10]+#,##0.00;[Red]-#,##0.00;"–"',
  qty: '#,##0;[Red]-#,##0;"–"',
  price: '#,##0.0000',
  rate: "0.0000",
  pct: '0.00%;[Red]-0.00%;"–"',
  ret: '[Color10]+0.00%;[Red]-0.00%;"–"',
  ratio: '0.00;[Red]-0.00;"–"',
  date: "dd/mm/yyyy",
  dateTime: "dd/mm/yyyy hh:mm",
  int: "0",
};
const thin = { style: "thin" as const, color: { argb: C.line } };

const d = (s: string | null | undefined) => (s ? new Date(s.slice(0, 10) + "T00:00:00Z") : null);
const n = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
const romeParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
/** a timestamp as Rome wall-clock time (Excel has no time zones) */
function rome(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const p = Object.fromEntries(romeParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
}
const fmtDate = (s: string) => new Date(s.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const COMP: Record<string, string> = { A: "Competition A · University teams", B: "Competition B · International teams" };
const sign = (side: string) => (side === "long" ? 1 : -1);
const ccyOrder = (a: string, b: string) => (a === "EUR" ? -1 : b === "EUR" ? 1 : a.localeCompare(b));
const sheetSafe = (s: string) => s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);

let EDITION = "2026/27";
function setup(ws: ExcelJS.Worksheet, title: string, subtitle: string, lastCol: number) {
  ws.properties.defaultRowHeight = 16;
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
  ws.headerFooter = { oddFooter: `&L&8Interuniversity Investment Challenge ${EDITION}&R&8Page &P of &N` };
  ws.mergeCells(1, 1, 1, lastCol);
  ws.mergeCells(2, 1, 2, lastCol);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 16, bold: true, color: { argb: C.navy } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 28;
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 10, italic: true, color: { argb: C.grey } };
  ws.getRow(2).height = 18;
  // thin accent rule under the title
  for (let c = 1; c <= lastCol; c++) ws.getCell(2, c).border = { bottom: { style: "medium", color: { argb: C.accent } } };
}

function sectionTitle(ws: ExcelJS.Worksheet, row: number, text: string, lastCol: number, fill = false) {
  ws.mergeCells(row, 1, row, lastCol);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT, size: 11, bold: true, color: { argb: C.navy } };
  c.alignment = { vertical: "middle", indent: fill ? 1 : 0 };
  if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.section } };
  ws.getRow(row).height = 22;
}

function note(ws: ExcelJS.Worksheet, row: number, text: string, lastCol: number) {
  ws.mergeCells(row, 1, row, lastCol);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT, size: 9, italic: true, color: { argb: C.grey } };
  c.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = Math.max(16, Math.ceil(text.length / 110) * 13 + 4);
}

interface Col<T> {
  key: string;
  header: string;
  width?: number;
  fmt?: string;
  value?: (row: T) => unknown;
  formula?: (r: number, c: (key: string) => string) => string;
  bold?: boolean;
}

interface Table { header: number; first: number; last: number; col: (key: string) => string; range: (key: string) => string }

/** Writes a styled table at row r0 (header) and returns the row span and column letters. */
function table<T>(ws: ExcelJS.Worksheet, r0: number, cols: Col<T>[], rows: T[], opts: {
  firstCol?: number; filter?: boolean; widths?: boolean;
  totals?: { label: string; labelKey: string; sum?: string[]; formulas?: Record<string, (t: Table) => { formula: string; result?: unknown }> };
} = {}): Table {
  const c0 = opts.firstCol ?? 1;
  const letter = (k: string) => {
    const i = cols.findIndex((x) => x.key === k);
    if (i < 0) throw new Error(`unknown column ${k}`);
    return ws.getColumn(c0 + i).letter;
  };
  const hr = ws.getRow(r0);
  hr.height = 30;
  cols.forEach((col, i) => {
    const cell = hr.getCell(c0 + i);
    cell.value = col.header;
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: C.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
    cell.alignment = { vertical: "middle", horizontal: col.fmt ? "right" : "left", wrapText: true, indent: col.fmt ? 0 : 1 };
    if (opts.widths !== false && col.width) {
      const w = ws.getColumn(c0 + i);
      w.width = Math.max(w.width ?? 0, col.width);
    }
  });
  rows.forEach((row, k) => {
    const r = r0 + 1 + k;
    const xr = ws.getRow(r);
    cols.forEach((col, i) => {
      const cell = xr.getCell(c0 + i);
      const v = col.value ? col.value(row) : null;
      cell.value = col.formula ? { formula: col.formula(r, letter), result: (v ?? undefined) as any } : (v as any);
      cell.font = { name: FONT, size: 10, color: { argb: C.ink }, bold: col.bold };
      if (col.fmt) cell.numFmt = col.fmt;
      cell.alignment = { vertical: "middle", horizontal: col.fmt ? "right" : "left", indent: col.fmt ? 0 : 1 };
      cell.border = { bottom: thin };
      if (k % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.band } };
    });
  });
  const first = r0 + 1, last = r0 + Math.max(rows.length, 1);
  if (!rows.length) {
    ws.mergeCells(first, c0, first, c0 + cols.length - 1);
    const cell = ws.getCell(first, c0);
    cell.value = "None";
    cell.font = { name: FONT, size: 10, italic: true, color: { argb: C.grey } };
    cell.alignment = { indent: 1 };
  }
  const t: Table = { header: r0, first, last, col: letter, range: (k) => `$${letter(k)}$${first}:$${letter(k)}$${last}` };
  if (opts.totals) {
    const r = last + 1;
    const xr = ws.getRow(r);
    cols.forEach((col, i) => {
      const cell = xr.getCell(c0 + i);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: C.navy } };
      cell.border = { top: { style: "thin", color: { argb: C.navy } }, bottom: { style: "double", color: { argb: C.navy } } };
      cell.alignment = { horizontal: col.fmt ? "right" : "left", indent: col.fmt ? 0 : 1 };
      if (col.fmt) cell.numFmt = col.fmt;
      if (col.key === opts.totals!.labelKey) cell.value = opts.totals!.label;
      else if (opts.totals!.formulas?.[col.key]) cell.value = opts.totals!.formulas[col.key](t) as any;
      else if (opts.totals!.sum?.includes(col.key)) {
        const res = rows.reduce((a, row) => a + (Number(col.value?.(row)) || 0), 0);
        cell.value = rows.length ? { formula: `SUM(${letter(col.key)}${first}:${letter(col.key)}${last})`, result: res } : 0;
      }
    });
  }
  if (rows.length > 25 && !ws.pageSetup.printTitlesRow) ws.pageSetup.printTitlesRow = `${r0}:${r0}`;
  if (opts.filter !== false && rows.length) {
    ws.autoFilter = { from: { row: r0, column: c0 }, to: { row: last, column: c0 + cols.length - 1 } };
  }
  return t;
}

/** label / value pairs, returns the address of each value by key */
function infoBlock(ws: ExcelJS.Worksheet, r0: number, items: { key: string; label: string; value: unknown; fmt?: string; formula?: (a: Record<string, string>) => string }[]) {
  const addr: Record<string, string> = {};
  items.forEach((it, i) => (addr[it.key] = `$C$${r0 + i}`));
  items.forEach((it, i) => {
    const r = r0 + i;
    const l = ws.getCell(r, 2);
    l.value = it.label;
    l.font = { name: FONT, size: 10, color: { argb: C.grey } };
    l.border = { bottom: thin };
    const v = ws.getCell(r, 3);
    v.value = it.formula ? { formula: it.formula(addr), result: it.value as any } : (it.value as any);
    v.font = { name: FONT, size: 10, bold: true, color: { argb: C.ink } };
    v.alignment = { horizontal: it.fmt ? "right" : "left" };
    v.border = { bottom: thin };
    if (it.fmt) v.numFmt = it.fmt;
  });
  return addr;
}

// ------------------------------------------------------------------ workbook
export async function buildWorkbook(x: ExportData, Excel: typeof ExcelJS): Promise<ExcelJS.Workbook> {
  const wb = new Excel.Workbook();
  wb.creator = "Interuniversity Investment Challenge";
  wb.created = new Date();
  const S = x.settings;
  { const y = Number(S.edition_year) || 2026; EDITION = `${y}/${String((y + 1) % 100).padStart(2, "0")}`; }
  const capital = Number(S.capital);
  const teamById = Object.fromEntries(x.teams.map((t) => [t.id, t]));
  const lb = Object.fromEntries(x.leaderboard.map((l) => [l.team_id, l]));
  const asOf: string | null = x.subs[0]?.as_of ?? x.leaderboard.find((l) => l.as_of)?.as_of ?? null;
  const asOfTxt = asOf ? fmtDate(asOf) : "no valuation yet";
  // teams ordered by competition, then rank, then name
  const teams = [...x.teams].sort((a, b) =>
    a.competition.localeCompare(b.competition) || (lb[a.id]?.rank_in_competition ?? 1e9) - (lb[b.id]?.rank_in_competition ?? 1e9) || a.name.localeCompare(b.name));
  const one = x.scope === "team" ? teams[0] : null;
  const teamName = (id: string) => teamById[id]?.name ?? "";
  const name = (sym: string) => x.instruments[sym]?.name ?? "";
  const NOTE_FX = "Each currency is a separate sub-portfolio: stocks are bought and sold in their own currency and cash can be negative (no margin, no interest). Values in euro are indicative, at the ECB reference rate of the valuation date; the official conversion is made by the organiser at the end of the challenge.";
  let capRef = "";

  // ---------------- overview / summary
  if (one) {
    const ws = wb.addWorksheet("Overview", { properties: { tabColor: { argb: C.accent } } });
    ws.getColumn(1).width = 3; ws.getColumn(2).width = 34; ws.getColumn(3).width = 30; ws.getColumn(4).width = 30; ws.getColumn(5).width = 22;
    setup(ws, `${one.name} — Portfolio report`, `${one.university ?? ""}${one.university ? " · " : ""}${COMP[one.competition] ?? one.competition} · valuation as of ${asOfTxt}`, 5);
    const m = lb[one.id] ?? {};
    sectionTitle(ws, 4, "Team", 5);
    const a1 = infoBlock(ws, 5, [
      { key: "team", label: "Team", value: one.name },
      { key: "uni", label: "University", value: one.university ?? "–" },
      { key: "comp", label: "Competition", value: COMP[one.competition] ?? one.competition },
      { key: "asof", label: "Valuation date", value: d(asOf), fmt: F.date },
      { key: "period", label: "Challenge period", value: `${fmtDate(S.start_date)} – ${fmtDate(S.end_date)}` },
      { key: "cap", label: "Initial capital (€)", value: capital, fmt: F.money },
      { key: "bench", label: "Benchmark", value: `MSCI World (${S.benchmark_symbol}, ${S.benchmark_currency})` },
    ]);
    capRef = `Overview!${a1.cap}`;
    sectionTitle(ws, 13, "Performance", 5);
    infoBlock(ws, 14, [
      { key: "nav", label: "Portfolio value (€, indicative)", value: n(m.nav), fmt: F.money },
      { key: "ret", label: "Total return", value: n(m.total_return), fmt: F.ret, formula: (a) => `IF(${a.nav}="","",${a.nav}/${capRef}-1)` },
      { key: "rank", label: "Rank in competition", value: n(m.rank_in_competition), fmt: F.int },
      { key: "bret", label: "Benchmark return", value: n(m.benchmark_return), fmt: F.ret },
      { key: "ex", label: "Excess return", value: n(m.excess_return), fmt: F.ret, formula: (a) => `IF(OR(${a.ret}="",${a.bret}=""),"",${a.ret}-${a.bret})` },
      { key: "vol", label: "Volatility (annualised)", value: n(m.volatility), fmt: F.pct },
      { key: "sharpe", label: "Sharpe ratio", value: n(m.sharpe), fmt: F.ratio },
      { key: "sortino", label: "Sortino ratio", value: n(m.sortino), fmt: F.ratio },
      { key: "beta", label: "Beta vs benchmark", value: n(m.beta), fmt: F.ratio },
      { key: "te", label: "Tracking error", value: n(m.tracking_error), fmt: F.pct },
      { key: "dd", label: "Maximum drawdown", value: n(m.max_drawdown), fmt: F.pct },
      { key: "calmar", label: "Calmar ratio", value: n(m.calmar), fmt: F.ratio },
      { key: "ops", label: "Operations", value: n(m.operations), fmt: F.int },
      { key: "mw", label: "Largest position (% of value)", value: n(m.max_weight), fmt: F.pct },
      { key: "hhi", label: "Concentration (HHI)", value: n(m.hhi), fmt: F.rate },
      { key: "viol", label: "Violations", value: n(m.violations) ?? 0, fmt: F.int },
    ]);
    sectionTitle(ws, 31, "Members", 5);
    table(ws, 32, [
      { key: "pad", header: "", width: 3, value: () => null },
      { key: "name", header: "Name", value: (r: any) => r.name },
      { key: "role", header: "Role", value: (r: any) => (r.role === "president" ? "President" : "Member") },
      { key: "email", header: "E-mail", value: (r: any) => r.email },
      { key: "joined", header: "Joined", fmt: F.date, value: (r: any) => d(r.joined) },
    ], x.members, { filter: false, widths: false });
    note(ws, 34 + Math.max(x.members.length, 1), NOTE_FX + " Returns, risk metrics and ranks are those computed by the challenge engine on the valuation date.", 5);
  } else {
    const ws = wb.addWorksheet("Summary", { properties: { tabColor: { argb: C.accent } } });
    const cols: Col<any>[] = [
      { key: "rank", header: "Rank", width: 7, fmt: F.int, value: (t) => n(lb[t.id]?.rank_in_competition) },
      { key: "team", header: "Team", width: 28, value: (t) => t.name, bold: true },
      { key: "uni", header: "University", width: 28, value: (t) => t.university ?? "" },
      { key: "nav", header: "Value (€)", width: 16, fmt: F.money, value: (t) => n(lb[t.id]?.nav) },
      { key: "ret", header: "Total return", width: 11, fmt: F.ret, value: (t) => n(lb[t.id]?.total_return), formula: (r, c) => `IF(${c("nav")}${r}="","",${c("nav")}${r}/${capRef}-1)` },
      { key: "bret", header: "Benchmark", width: 11, fmt: F.ret, value: (t) => n(lb[t.id]?.benchmark_return) },
      { key: "ex", header: "Excess return", width: 11, fmt: F.ret, value: (t) => n(lb[t.id]?.excess_return), formula: (r, c) => `IF(OR(${c("ret")}${r}="",${c("bret")}${r}=""),"",${c("ret")}${r}-${c("bret")}${r})` },
      { key: "vol", header: "Volatility", width: 10, fmt: F.pct, value: (t) => n(lb[t.id]?.volatility) },
      { key: "sharpe", header: "Sharpe", width: 9, fmt: F.ratio, value: (t) => n(lb[t.id]?.sharpe) },
      { key: "sortino", header: "Sortino", width: 9, fmt: F.ratio, value: (t) => n(lb[t.id]?.sortino) },
      { key: "beta", header: "Beta", width: 8, fmt: F.ratio, value: (t) => n(lb[t.id]?.beta) },
      { key: "te", header: "Tracking error", width: 10, fmt: F.pct, value: (t) => n(lb[t.id]?.tracking_error) },
      { key: "dd", header: "Max drawdown", width: 10, fmt: F.pct, value: (t) => n(lb[t.id]?.max_drawdown) },
      { key: "calmar", header: "Calmar", width: 9, fmt: F.ratio, value: (t) => n(lb[t.id]?.calmar) },
      { key: "ops", header: "Operations", width: 10, fmt: F.int, value: (t) => n(lb[t.id]?.operations) },
      { key: "mw", header: "Largest position", width: 10, fmt: F.pct, value: (t) => n(lb[t.id]?.max_weight) },
      { key: "hhi", header: "HHI", width: 8, fmt: F.rate, value: (t) => n(lb[t.id]?.hhi) },
      { key: "viol", header: "Violations", width: 9, fmt: F.int, value: (t) => n(lb[t.id]?.violations) ?? 0 },
    ];
    setup(ws, `Interuniversity Investment Challenge ${EDITION}`, `Portfolio report · all teams · valuation as of ${asOfTxt}`, cols.length);
    ws.getColumn(1).width = 7; ws.getColumn(2).width = 28; ws.getColumn(3).width = 28;
    sectionTitle(ws, 4, "Challenge", cols.length);
    const a = infoBlock(ws, 5, [
      { key: "asof", label: "Valuation date", value: d(asOf), fmt: F.date },
      { key: "period", label: "Challenge period", value: `${fmtDate(S.start_date)} – ${fmtDate(S.end_date)}` },
      { key: "cap", label: "Initial capital per team (€)", value: capital, fmt: F.money },
      { key: "bench", label: "Benchmark", value: `MSCI World (${S.benchmark_symbol}, ${S.benchmark_currency})` },
      { key: "teams", label: "Teams", value: teams.length, fmt: F.int },
    ]);
    capRef = `Summary!${a.cap}`;
    let r = 11;
    for (const comp of ["A", "B"]) {
      const group = teams.filter((t) => t.competition === comp);
      sectionTitle(ws, r, COMP[comp], cols.length, true);
      const tb = table(ws, r + 1, cols, group, { filter: false, widths: false });
      cols.forEach((c, i) => c.width && (ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width ?? 0, c.width)));
      r = tb.last + 3;
    }
    note(ws, r, NOTE_FX + " Ranking by total return in euro within each competition; risk metrics are annualised from monthly returns.", cols.length);
    ws.views = [{ showGridLines: false, state: "frozen", ySplit: 2 }];
  }

  // ---------------- sub-portfolios
  {
    const ws = wb.addWorksheet("Sub-portfolios");
    if (one) {
      const subs = x.subs.filter((s) => s.team_id === one.id).sort((a, b) => ccyOrder(a.currency, b.currency));
      const open = x.positions.filter((p) => p.team_id === one.id && !p.exit_date);
      const posCols = (ccy: string): Col<any>[] => [
        { key: "sym", header: "Stock", width: 14, value: (p) => p.symbol, bold: true },
        { key: "name", header: "Name", width: 30, value: (p) => name(p.symbol) },
        { key: "side", header: "Side", width: 15, value: (p) => p.side },
        { key: "qty", header: "Quantity", width: 15, fmt: F.qty, value: (p) => n(p.quantity) },
        { key: "ed", header: "Entry date", width: 14, fmt: F.date, value: (p) => d(p.entry_date) },
        { key: "ep", header: `Entry price (${ccy})`, width: 14, fmt: F.price, value: (p) => n(p.entry_price) },
        { key: "lp", header: `Last close (${ccy})`, width: 14, fmt: F.price, value: (p) => n(p.last_price) },
        { key: "mv", header: `Market value (${ccy})`, width: 17, fmt: F.money, value: (p) => n(p.value_local), formula: (r, c) => `IF(${c("side")}${r}="long",1,-1)*${c("qty")}${r}*${c("lp")}${r}` },
        { key: "pl", header: `Unrealised P&L (${ccy})`, width: 17, fmt: F.pnl, value: (p) => n(p.pnl_local), formula: (r, c) => `IF(${c("side")}${r}="long",1,-1)*${c("qty")}${r}*(${c("lp")}${r}-${c("ep")}${r})` },
        { key: "plp", header: "P&L %", width: 10, fmt: F.ret, value: (p) => (n(p.entry_price) ? sign(p.side) * (Number(p.last_price) / Number(p.entry_price) - 1) : null), formula: (r, c) => `IF(${c("ep")}${r}=0,"",IF(${c("side")}${r}="long",1,-1)*(${c("lp")}${r}/${c("ep")}${r}-1))` },
      ];
      const last = 10;
      setup(ws, `${one.name} — Sub-portfolios by currency`, `Valuation as of ${asOfTxt} · each currency is managed and valued in its own currency`, last);
      // summary first (its formulas point at the sections below)
      const sumTop = 4;
      const sumFirst = sumTop + 2;
      let r = sumFirst + subs.length + 4;
      [14, 30, 15, 15, 14, 16, 16, 18, 18, 10].forEach((w, i) => (ws.getColumn(i + 1).width = w));
      const refs: Record<string, { pos: string; cash: string; tot: string; rate: string }> = {};
      for (const s of subs) {
        const ccy = s.currency;
        sectionTitle(ws, r, `${ccy} sub-portfolio`, last, true);
        const rows = open.filter((p) => p.currency === ccy);
        const tb = table(ws, r + 1, posCols(ccy), rows, { filter: false });
        let k = tb.last + 1;
        const line = (label: string, v: ExcelJS.CellValue, fmt: string, strong = false) => {
          const l = ws.getCell(k, 7), c = ws.getCell(k, 8);
          l.value = label; c.value = v; c.numFmt = fmt;
          l.font = { name: FONT, size: 10, bold: strong, color: { argb: strong ? C.navy : C.grey } };
          c.font = { name: FONT, size: 10, bold: strong, color: { argb: strong ? C.navy : C.ink } };
          l.alignment = { horizontal: "right" }; c.alignment = { horizontal: "right" };
          if (strong) { l.border = c.border = { top: { style: "thin", color: { argb: C.navy } }, bottom: { style: "double", color: { argb: C.navy } } }; }
          return `$H$${k++}`;
        };
        const posV = Number(s.positions_value_local);
        const pos = line(`Positions value (${ccy})`, rows.length ? { formula: `SUM(H${tb.first}:H${tb.last})`, result: posV } : 0, F.money);
        const cash = line(`Cash (${ccy})`, n(s.cash_local), F.money);
        const tot = line(`Sub-portfolio total (${ccy})`, { formula: `${pos}+${cash}`, result: n(s.total_local) ?? undefined }, F.money, true);
        const rate = line(ccy === "EUR" ? "ECB rate" : `ECB rate (${ccy} per €)`, n(s.fx_rate), F.rate);
        line("Indicative value (€)", { formula: `IF(${rate}=0,"",${tot}/${rate})`, result: n(s.total_eur) ?? undefined }, F.money);
        refs[ccy] = { pos, cash, tot, rate };
        r = k + 2;
      }
      sectionTitle(ws, sumTop, "Summary", last);
      const sc: Col<any>[] = [
        { key: "ccy", header: "Currency", value: (s) => s.currency, bold: true },
        { key: "cash", header: "Cash (local)", fmt: F.money, value: (s) => n(s.cash_local), formula: (rr, c) => `${refs[ws.getCell(rr, 1).value as string].cash}` },
        { key: "pos", header: "Positions (local)", fmt: F.money, value: (s) => n(s.positions_value_local), formula: (rr) => `${refs[ws.getCell(rr, 1).value as string].pos}` },
        { key: "tot", header: "Total (local)", fmt: F.money, value: (s) => n(s.total_local), formula: (rr, c) => `${c("cash")}${rr}+${c("pos")}${rr}` },
        { key: "rate", header: "ECB rate (per €)", fmt: F.rate, value: (s) => n(s.fx_rate), formula: (rr) => `${refs[ws.getCell(rr, 1).value as string].rate}` },
        { key: "eur", header: "Indicative value (€)", fmt: F.money, value: (s) => n(s.total_eur), formula: (rr, c) => `IF(${c("rate")}${rr}=0,0,${c("tot")}${rr}/${c("rate")}${rr})` },
        { key: "w", header: "Share of total", fmt: F.pct, value: () => null, formula: (rr, c) => `IF($F$${sumFirst + subs.length}=0,"",${c("eur")}${rr}/$F$${sumFirst + subs.length})` },
      ];
      // the currency code must be in column A before the formulas that look it up are built
      subs.forEach((s, i) => (ws.getCell(sumFirst + i, 1).value = s.currency));
      const totalEur = subs.reduce((a, s) => a + (Number(s.total_eur) || 0), 0);
      sc[6].value = (s) => (totalEur ? (Number(s.total_eur) || 0) / totalEur : null);
      table(ws, sumTop + 1, sc, subs, { filter: false, widths: false, totals: { label: "Total (€)", labelKey: "ccy", sum: ["eur"], formulas: { w: () => ({ formula: "IF(F" + (sumFirst + subs.length) + "=0,\"\",1)", result: 1 }) } } });
      note(ws, sumFirst + subs.length + 2, NOTE_FX, last);
      ws.views = [{ showGridLines: false, state: "frozen", ySplit: 2 }];
    } else {
      const cols: Col<any>[] = [
        { key: "team", header: "Team", width: 28, value: (s) => teamName(s.team_id), bold: true },
        { key: "ccy", header: "Currency", width: 11, value: (s) => s.currency },
        { key: "cash", header: "Cash (local)", width: 17, fmt: F.money, value: (s) => n(s.cash_local) },
        { key: "pos", header: "Positions (local)", width: 17, fmt: F.money, value: (s) => n(s.positions_value_local) },
        { key: "tot", header: "Total (local)", width: 17, fmt: F.money, value: (s) => n(s.total_local), formula: (r, c) => `${c("cash")}${r}+${c("pos")}${r}` },
        { key: "rate", header: "ECB rate (per €)", width: 12, fmt: F.rate, value: (s) => n(s.fx_rate) },
        { key: "eur", header: "Indicative value (€)", width: 17, fmt: F.money, value: (s) => n(s.total_eur), formula: (r, c) => `IF(${c("rate")}${r}=0,0,${c("tot")}${r}/${c("rate")}${r})` },
      ];
      const order = new Map(teams.map((t, i) => [t.id, i]));
      const subs = [...x.subs].sort((a, b) => (order.get(a.team_id) ?? 0) - (order.get(b.team_id) ?? 0) || ccyOrder(a.currency, b.currency));
      const ccys = [...new Set(subs.map((s) => s.currency))].sort(ccyOrder);
      const width = Math.max(cols.length, ccys.length + 2);
      setup(ws, "Sub-portfolios by currency", `All teams · valuation as of ${asOfTxt}`, width);
      // matrix: team x currency (local), then total in euro
      sectionTitle(ws, 4, "Overview · total of each sub-portfolio in its own currency", width);
      const mh = 5;
      const listTop = mh + teams.length + 4;
      const list = { first: listTop + 1, last: listTop + Math.max(subs.length, 1) };
      const R = (k: string) => `$${ws.getColumn(cols.findIndex((c) => c.key === k) + 1).letter}$${list.first}:$${ws.getColumn(cols.findIndex((c) => c.key === k) + 1).letter}$${list.last}`;
      const mcols: Col<any>[] = [
        { key: "team", header: "Team", value: (t) => t.name, bold: true },
        ...ccys.map((ccy) => ({
          key: ccy, header: ccy, fmt: F.money,
          value: (t: any) => subs.filter((s) => s.team_id === t.id && s.currency === ccy).reduce((a, s) => a + Number(s.total_local), 0),
          formula: (r: number, c: (k: string) => string) => `SUMIFS(${R("tot")},${R("team")},$A${r},${R("ccy")},${c(ccy)}$${mh})`,
        })),
        { key: "eur", header: "Total (€)", fmt: F.money, bold: true, value: (t: any) => subs.filter((s) => s.team_id === t.id).reduce((a, s) => a + (Number(s.total_eur) || 0), 0), formula: (r: number) => `SUMIFS(${R("eur")},${R("team")},$A${r})` },
      ];
      table(ws, mh, mcols, teams, { filter: false, widths: false });
      for (let i = 2; i <= ccys.length + 2; i++) ws.getColumn(i).width = Math.max(ws.getColumn(i).width ?? 0, 17);
      sectionTitle(ws, listTop - 1, "Detail", width);
      table(ws, listTop, cols, subs);
      note(ws, list.last + 2, NOTE_FX, width);
      ws.views = [{ showGridLines: false, state: "frozen", ySplit: 2 }];
    }
  }

  // ---------------- open positions
  {
    const ws = wb.addWorksheet("Open positions");
    const rows = x.positions.filter((p) => !p.exit_date).sort((a, b) =>
      teamName(a.team_id).localeCompare(teamName(b.team_id)) || ccyOrder(a.currency, b.currency) || a.symbol.localeCompare(b.symbol));
    const cols: Col<any>[] = [
      ...(one ? [] : [{ key: "team", header: "Team", width: 26, value: (p: any) => teamName(p.team_id), bold: true } as Col<any>]),
      { key: "sym", header: "Stock", width: 13, value: (p) => p.symbol, bold: !!one },
      { key: "name", header: "Name", width: 30, value: (p) => name(p.symbol) },
      { key: "exch", header: "Exchange", width: 14, value: (p) => x.instruments[p.symbol]?.exchange ?? "" },
      { key: "ccy", header: "Currency", width: 11, value: (p) => p.currency },
      { key: "side", header: "Side", width: 8, value: (p) => p.side },
      { key: "qty", header: "Quantity", width: 11, fmt: F.qty, value: (p) => n(p.quantity) },
      { key: "ed", header: "Entry date", width: 12, fmt: F.date, value: (p) => d(p.entry_date) },
      { key: "ep", header: "Entry price", width: 13, fmt: F.price, value: (p) => n(p.entry_price) },
      { key: "lp", header: "Last close", width: 13, fmt: F.price, value: (p) => n(p.last_price) },
      { key: "mv", header: "Market value (local)", width: 17, fmt: F.money, value: (p) => n(p.value_local), formula: (r, c) => `IF(${c("side")}${r}="long",1,-1)*${c("qty")}${r}*${c("lp")}${r}` },
      { key: "pl", header: "Unrealised P&L (local)", width: 17, fmt: F.pnl, value: (p) => n(p.pnl_local), formula: (r, c) => `IF(${c("side")}${r}="long",1,-1)*${c("qty")}${r}*(${c("lp")}${r}-${c("ep")}${r})` },
      { key: "plp", header: "P&L %", width: 9, fmt: F.ret, value: (p) => (n(p.entry_price) ? sign(p.side) * (Number(p.last_price) / Number(p.entry_price) - 1) : null), formula: (r, c) => `IF(${c("ep")}${r}=0,"",IF(${c("side")}${r}="long",1,-1)*(${c("lp")}${r}/${c("ep")}${r}-1))` },
      { key: "mve", header: "Market value (€, indicative)", width: 17, fmt: F.money, value: (p) => n(p.value_eur) },
      { key: "ple", header: "P&L (€, indicative)", width: 16, fmt: F.pnl, value: (p) => n(p.pnl_eur) },
    ];
    setup(ws, one ? `${one.name} — Open positions` : "Open positions", `Valuation at the last close available on ${asOfTxt} · local values in the currency of each stock`, cols.length);
    table(ws, 4, cols, rows, { totals: { label: "Total (€, indicative)", labelKey: one ? "sym" : "team", sum: ["mve", "ple"] } });
    ws.views = [{ showGridLines: false, state: "frozen", ySplit: 4, xSplit: one ? 1 : 2 }];
  }

  // ---------------- closed positions
  {
    const ws = wb.addWorksheet("Closed positions");
    const rows = x.positions.filter((p) => p.exit_date).sort((a, b) => teamName(a.team_id).localeCompare(teamName(b.team_id)) || a.exit_date.localeCompare(b.exit_date));
    const reason: Record<string, string> = { order: "Closed by order", change: "Quantity changed", stop: "Stop at +50%" };
    const cols: Col<any>[] = [
      ...(one ? [] : [{ key: "team", header: "Team", width: 26, value: (p: any) => teamName(p.team_id), bold: true } as Col<any>]),
      { key: "sym", header: "Stock", width: 13, value: (p) => p.symbol, bold: !!one },
      { key: "name", header: "Name", width: 30, value: (p) => name(p.symbol) },
      { key: "ccy", header: "Currency", width: 11, value: (p) => p.currency },
      { key: "side", header: "Side", width: 8, value: (p) => p.side },
      { key: "qty", header: "Quantity", width: 11, fmt: F.qty, value: (p) => n(p.quantity) },
      { key: "ed", header: "Entry date", width: 12, fmt: F.date, value: (p) => d(p.entry_date) },
      { key: "ep", header: "Entry price", width: 13, fmt: F.price, value: (p) => n(p.entry_price) },
      { key: "xd", header: "Exit date", width: 12, fmt: F.date, value: (p) => d(p.exit_date) },
      { key: "xp", header: "Exit price", width: 13, fmt: F.price, value: (p) => n(p.exit_price) },
      { key: "why", header: "Reason", width: 17, value: (p) => reason[p.exit_reason] ?? p.exit_reason ?? "" },
      { key: "pl", header: "Realised P&L (local)", width: 17, fmt: F.pnl, value: (p) => n(p.pnl_local), formula: (r, c) => `IF(${c("side")}${r}="long",1,-1)*${c("qty")}${r}*(${c("xp")}${r}-${c("ep")}${r})` },
      { key: "plp", header: "P&L %", width: 9, fmt: F.ret, value: (p) => (n(p.entry_price) ? sign(p.side) * (Number(p.exit_price) / Number(p.entry_price) - 1) : null), formula: (r, c) => `IF(${c("ep")}${r}=0,"",IF(${c("side")}${r}="long",1,-1)*(${c("xp")}${r}/${c("ep")}${r}-1))` },
      { key: "ple", header: "Realised P&L (€, indicative)", width: 17, fmt: F.pnl, value: (p) => n(p.pnl_eur) },
    ];
    setup(ws, one ? `${one.name} — Closed positions` : "Closed positions", "Realised results · euro values at the ECB rate of the exit date", cols.length);
    table(ws, 4, cols, rows, { totals: { label: "Total (€, indicative)", labelKey: one ? "sym" : "team", sum: ["ple"] } });
    ws.views = [{ showGridLines: false, state: "frozen", ySplit: 4, xSplit: one ? 1 : 2 }];
  }

  // ---------------- orders
  {
    const ws = wb.addWorksheet("Orders");
    const action: Record<string, string> = { open: "Open", close: "Close", change: "Change quantity" };
    const cols: Col<any>[] = [
      ...(one ? [] : [{ key: "team", header: "Team", width: 26, value: (o: any) => teamName(o.team_id), bold: true } as Col<any>]),
      { key: "placed", header: "Placed (Rome time)", width: 17, fmt: F.dateTime, value: (o) => rome(o.created_at) },
      { key: "exec", header: "At the close of", width: 13, fmt: F.date, value: (o) => d(o.exec_date) },
      { key: "sym", header: "Stock", width: 13, value: (o) => o.symbol },
      { key: "name", header: "Name", width: 28, value: (o) => name(o.symbol) },
      { key: "act", header: "Action", width: 15, value: (o) => action[o.action] ?? o.action },
      { key: "side", header: "Side", width: 8, value: (o) => o.side ?? "" },
      { key: "qty", header: "Quantity", width: 11, fmt: F.qty, value: (o) => n(o.target_quantity) },
      { key: "st", header: "Status", width: 11, value: (o) => o.status },
      { key: "xd", header: "Executed on", width: 12, fmt: F.date, value: (o) => d(o.executed_date) },
      { key: "xp", header: "Price", width: 13, fmt: F.price, value: (o) => n(o.executed_price) },
      { key: "note", header: "Note", width: 40, value: (o) => o.reject_reason ?? "" },
    ];
    setup(ws, one ? `${one.name} — Orders` : "Orders", "Every order placed, in chronological order · executed at the closing price of the day shown", cols.length);
    table(ws, 4, cols, x.orders);
    ws.views = [{ showGridLines: false, state: "frozen", ySplit: 4 }];
  }

  // ---------------- monthly performance
  {
    const ws = wb.addWorksheet("Monthly performance");
    const bm = new Map(x.benchMonthly.map((b) => [b.month_n, Number(b.value_eur)]));
    const done = [0, ...x.months.filter((m) => bm.has(m.n) || x.navMonthly.some((v) => v.month_n === m.n)).map((m) => m.n)];
    const label = (k: number) => (k === 0 ? "Start" : x.months.find((m) => m.n === k)?.label ?? `Month ${k}`);
    const vdate = (k: number) => (k === 0 ? d(S.start_date) : d(x.months.find((m) => m.n === k)?.end_date));
    const navOf = (team: string, k: number) => { const v = x.navMonthly.find((r) => r.team_id === team && r.month_n === k); return v ? Number(v.nav_eur) : null; };
    if (one) {
      const rows = done.map((k) => ({ k }));
      const cols: Col<any>[] = [
        { key: "m", header: "Month", width: 18, value: (r) => label(r.k), bold: true },
        { key: "vd", header: "Valuation date", width: 13, fmt: F.date, value: (r) => vdate(r.k) },
        { key: "nav", header: "Portfolio (€)", width: 17, fmt: F.money, value: (r) => navOf(one.id, r.k) },
        { key: "mr", header: "Monthly return", width: 12, fmt: F.ret, value: () => null, formula: (r, c) => (r === 5 ? `""` : `IF(OR(${c("nav")}${r}="",${c("nav")}${r - 1}=""),"",${c("nav")}${r}/${c("nav")}${r - 1}-1)`) },
        { key: "cr", header: "Cumulative return", width: 12, fmt: F.ret, value: () => null, formula: (r, c) => `IF(${c("nav")}${r}="","",${c("nav")}${r}/${capRef}-1)` },
        { key: "b", header: "Benchmark (€)", width: 17, fmt: F.money, value: (r) => bm.get(r.k) ?? null },
        { key: "bmr", header: "Benchmark monthly", width: 12, fmt: F.ret, value: () => null, formula: (r, c) => (r === 5 ? `""` : `IF(OR(${c("b")}${r}="",${c("b")}${r - 1}=""),"",${c("b")}${r}/${c("b")}${r - 1}-1)`) },
        { key: "bcr", header: "Benchmark cumulative", width: 12, fmt: F.ret, value: () => null, formula: (r, c) => `IF(${c("b")}${r}="","",${c("b")}${r}/${capRef}-1)` },
        { key: "ex", header: "Excess (cumulative)", width: 12, fmt: F.ret, value: () => null, formula: (r, c) => `IF(OR(${c("cr")}${r}="",${c("bcr")}${r}=""),"",${c("cr")}${r}-${c("bcr")}${r})` },
      ];
      // cached results for the formula columns
      const navs = rows.map((r) => navOf(one.id, r.k)), bs = rows.map((r) => bm.get(r.k) ?? null);
      cols[3].value = (r) => { const i = rows.indexOf(r); return i > 0 && navs[i] && navs[i - 1] ? navs[i]! / navs[i - 1]! - 1 : null; };
      cols[4].value = (r) => { const v = navs[rows.indexOf(r)]; return v ? v / capital - 1 : null; };
      cols[6].value = (r) => { const i = rows.indexOf(r); return i > 0 && bs[i] && bs[i - 1] ? bs[i]! / bs[i - 1]! - 1 : null; };
      cols[7].value = (r) => { const v = bs[rows.indexOf(r)]; return v ? v / capital - 1 : null; };
      cols[8].value = (r) => { const i = rows.indexOf(r); return navs[i] && bs[i] ? navs[i]! / capital - bs[i]! / capital : null; };
      setup(ws, `${one.name} — Monthly performance`, "Month-end valuations in euro (ECB rate of the valuation date) against the MSCI World benchmark", cols.length);
      table(ws, 4, cols, rows, { filter: false });
      ws.views = [{ showGridLines: false, state: "frozen", ySplit: 4 }];
    } else {
      const rows = done.map((k) => ({ k }));
      const width = teams.length + 3;
      setup(ws, "Monthly performance", "Month-end portfolio values in euro and monthly returns · all teams against the MSCI World benchmark", width);
      sectionTitle(ws, 4, "Month-end value (€)", width);
      const vcols: Col<any>[] = [
        { key: "m", header: "Month", width: 18, value: (r) => label(r.k), bold: true },
        { key: "vd", header: "Valuation date", width: 13, fmt: F.date, value: (r) => vdate(r.k) },
        ...teams.map((t) => ({ key: t.id, header: t.name, width: 16, fmt: F.money, value: (r: any) => navOf(t.id, r.k) })),
        { key: "bench", header: "Benchmark", width: 16, fmt: F.money, value: (r) => bm.get(r.k) ?? null },
      ];
      const vt = table(ws, 5, vcols, rows, { filter: false });
      const r2 = vt.last + 3;
      sectionTitle(ws, r2, "Monthly return", width);
      const off = r2 + 1 - 5; // row distance between the two blocks
      const rcols: Col<any>[] = vcols.map((c, i) => i < 2 ? c : ({
        key: c.key, header: c.header, fmt: F.ret,
        value: (r: any) => { const k = rows.indexOf(r); if (k === 0) return null; const a = c.value!(rows[k - 1]) as number | null, b = c.value!(r) as number | null; return a && b ? b / a - 1 : null; },
        formula: (r: number, col: (k: string) => string) => {
          const L = col(c.key), cur = `${L}${r - off}`, prev = `${L}${r - off - 1}`;
          return r - off === vt.first ? `""` : `IF(OR(${cur}="",${prev}=""),"",${cur}/${prev}-1)`;
        },
      }));
      table(ws, r2 + 1, rcols, rows, { filter: false, widths: false });
      ws.views = [{ showGridLines: false, state: "frozen", ySplit: 5, xSplit: 1 }];
    }
  }

  // ---------------- daily value
  {
    const ws = wb.addWorksheet("Daily value");
    const bd = new Map(x.benchDaily.map((b) => [b.date, Number(b.value_eur)]));
    const dates = [...new Set([...x.navDaily.map((v) => v.date), ...x.benchDaily.filter((b) => b.date >= S.start_date).map((b) => b.date)])].sort();
    const nd = new Map(x.navDaily.map((v) => [`${v.team_id}|${v.date}`, Number(v.nav_eur)]));
    const rows = dates.map((dt) => ({ dt }));
    if (one) {
      const cols: Col<any>[] = [
        { key: "dt", header: "Date", width: 13, fmt: F.date, value: (r) => d(r.dt), bold: true },
        { key: "nav", header: "Portfolio (€)", width: 17, fmt: F.money, value: (r) => nd.get(`${one.id}|${r.dt}`) ?? null },
        { key: "ret", header: "Return since start", width: 13, fmt: F.ret, value: (r) => { const v = nd.get(`${one.id}|${r.dt}`); return v ? v / capital - 1 : null; }, formula: (r, c) => `IF(${c("nav")}${r}="","",${c("nav")}${r}/${capRef}-1)` },
        { key: "b", header: "Benchmark (€)", width: 17, fmt: F.money, value: (r) => bd.get(r.dt) ?? null },
        { key: "bret", header: "Benchmark return", width: 13, fmt: F.ret, value: (r) => { const v = bd.get(r.dt); return v ? v / capital - 1 : null; }, formula: (r, c) => `IF(${c("b")}${r}="","",${c("b")}${r}/${capRef}-1)` },
        { key: "ex", header: "Excess return", width: 13, fmt: F.ret, value: (r) => { const v = nd.get(`${one.id}|${r.dt}`), b = bd.get(r.dt); return v && b ? (v - b) / capital : null; }, formula: (r, c) => `IF(OR(${c("ret")}${r}="",${c("bret")}${r}=""),"",${c("ret")}${r}-${c("bret")}${r})` },
      ];
      setup(ws, `${one.name} — Daily value`, "Portfolio value in euro at each close (ECB rate of the day)", cols.length);
      table(ws, 4, cols, rows);
    } else {
      const cols: Col<any>[] = [
        { key: "dt", header: "Date", width: 13, fmt: F.date, value: (r) => d(r.dt), bold: true },
        ...teams.map((t) => ({ key: t.id, header: t.name, width: 16, fmt: F.money, value: (r: any) => nd.get(`${t.id}|${r.dt}`) ?? null })),
        { key: "b", header: "Benchmark", width: 16, fmt: F.money, value: (r) => bd.get(r.dt) ?? null },
      ];
      setup(ws, "Daily value", "Portfolio values in euro at each close (ECB rate of the day) · all teams", cols.length);
      table(ws, 4, cols, rows);
    }
    ws.views = [{ showGridLines: false, state: "frozen", ySplit: 4, xSplit: 1 }];
  }

  // ---------------- cash movements
  {
    const ws = wb.addWorksheet("Cash movements");
    const kind: Record<string, string> = { capital: "Initial capital", trade: "Trade", dividend: "Dividend", transfer: "Currency transfer" };
    const rows = [...x.ledger].sort((a, b) => teamName(a.team_id).localeCompare(teamName(b.team_id)) || a.date.localeCompare(b.date) || Number(a.id) - Number(b.id));
    const run = new Map<string, number>();
    const bal = rows.map((r) => { const k = `${r.team_id}|${r.currency}`; const v = (run.get(k) ?? 0) + Number(r.amount); run.set(k, v); return v; });
    const cols: Col<any>[] = [
      ...(one ? [] : [{ key: "team", header: "Team", width: 26, value: (r: any) => teamName(r.team_id), bold: true } as Col<any>]),
      { key: "dt", header: "Date", width: 12, fmt: F.date, value: (r) => d(r.date) },
      { key: "ccy", header: "Currency", width: 11, value: (r) => r.currency },
      { key: "kind", header: "Type", width: 15, value: (r) => kind[r.kind] ?? r.kind },
      { key: "ref", header: "Description", width: 46, value: (r) => r.ref ?? "" },
      { key: "amt", header: "Amount (local)", width: 17, fmt: F.pnl, value: (r) => n(r.amount) },
      { key: "bal", header: "Cash balance (local)", width: 18, fmt: F.money, value: (r) => bal[rows.indexOf(r)],
        formula: (r, c) => one
          ? `SUMIFS($${c("amt")}$5:${c("amt")}${r},$${c("ccy")}$5:${c("ccy")}${r},${c("ccy")}${r})`
          : `SUMIFS($${c("amt")}$5:${c("amt")}${r},$${c("team")}$5:${c("team")}${r},${c("team")}${r},$${c("ccy")}$5:${c("ccy")}${r},${c("ccy")}${r})` },
    ];
    setup(ws, one ? `${one.name} — Cash movements` : "Cash movements", "Every movement of cash in each currency sub-portfolio, with the running balance", cols.length);
    table(ws, 4, cols, rows);
    ws.views = [{ showGridLines: false, state: "frozen", ySplit: 4 }];
  }

  return wb;
}

export function reportFileName(x: ExportData) {
  const day = new Date().toISOString().slice(0, 10);
  const who = x.scope === "team" ? x.teams[0]?.name ?? "Team" : "All-teams";
  return `Investment-Challenge_${sheetSafe(who).replace(/\s+/g, "-")}_${day}.xlsx`;
}

/** Loads the data, builds the workbook and starts the download. */
export async function downloadReport(teamId?: string) {
  const [{ default: Excel }, data] = await Promise.all([import("exceljs"), loadExportData(teamId)]);
  const wb = await buildWorkbook(data, Excel);
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = reportFileName(data);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
