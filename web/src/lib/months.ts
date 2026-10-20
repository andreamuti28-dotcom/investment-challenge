// Same calendar as the engine (generateMonths in supabase/functions/_shared/core.ts): month 1 is
// the calendar month of the start date, each month is valued on its last weekday.
export interface CalMonth { n: number; label: string; start_date: string; end_date: string }

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const weekend = (d: string) => [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay());

export function calendarMonths(startDate: string, endDate: string): CalMonth[] {
  const out: CalMonth[] = [];
  if (!startDate || !endDate || startDate > endDate) return out;
  let y = Number(startDate.slice(0, 4)), m = Number(startDate.slice(5, 7));
  for (let n = 1; n <= 36; n++) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    if (first > endDate) break;
    let last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (last >= endDate) last = endDate;
    else while (weekend(last)) last = addDays(last, -1);
    const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    out.push({ n, label, start_date: n === 1 ? startDate : first, end_date: last });
    m++;
    if (m === 13) { m = 1; y++; }
  }
  return out;
}
