const nf = (d: number) => new Intl.NumberFormat("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const n0 = nf(0), n2 = nf(2), n4 = nf(4);

export const num = (x: unknown, d = 2) => {
  if (x === null || x === undefined || x === "") return "–";
  const v = Number(x);
  if (!isFinite(v)) return "–";
  return (d === 0 ? n0 : d === 4 ? n4 : d === 2 ? n2 : nf(d)).format(v);
};
export const eur = (x: unknown, d = 2) => (x === null || x === undefined ? "–" : `€ ${num(x, d)}`);
export const pct = (x: unknown, d = 2) => {
  if (x === null || x === undefined || x === "") return "–";
  const v = Number(x) * 100;
  return `${v > 0 ? "+" : ""}${num(v, d)}%`;
};
export const pctU = (x: unknown, d = 2) => pct(x, d).replace("+", "");
export const plain = (x: unknown, d = 2) => (x === null || x === undefined ? "–" : num(x, d));
export const date = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–";
export const dateTime = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }) + " (Rome)"
    : "–";
export const signClass = (x: unknown) => (x === null || x === undefined ? "" : Number(x) > 0 ? "pos" : Number(x) < 0 ? "neg" : "");

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
export function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
