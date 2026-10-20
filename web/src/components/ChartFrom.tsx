import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const yearsAgo = (y: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); return iso(d); };
export const monthsBefore = (date: string, m: number) => { const d = new Date(date + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - m); return iso(d); };

let startPromise: Promise<string> | null = null;
/** Start date of the challenge (admin panel setting), loaded once. */
export function useChallengeStart(): string | null {
  const [start, setStart] = useState<string | null>(null);
  useEffect(() => {
    startPromise ??= Promise.resolve(supabase.from("challenge_settings").select("start_date").eq("id", 1).single())
      .then(({ data }) => (data as any)?.start_date ?? "2026-12-01");
    startPromise.then(setStart).catch(() => setStart("2026-12-01"));
  }, []);
  return start;
}

/** Start-date picker shared by every chart: a date field plus quick choices. */
export function ChartFrom({ value, onChange, min, start, presets = true }: {
  value: string; onChange: (v: string) => void; min: string; start: string; presets?: boolean;
}) {
  const choices: [string, string][] = [["Challenge start", start], ["1Y", yearsAgo(1)], ["2Y", yearsAgo(2)], ["5Y", yearsAgo(5)]];
  return (
    <div className="row chart-from" style={{ gap: 8 }}>
      <label htmlFor={`from-${start}-${min}`} style={{ margin: 0 }}>From</label>
      <input id={`from-${start}-${min}`} type="date" value={value} min={min} max={today()} onChange={(e) => e.target.value && onChange(e.target.value < min ? min : e.target.value)}
        style={{ width: "auto", minHeight: 32, padding: "4px 8px" }} />
      {presets && (
        <div className="seg" role="group" aria-label="Quick periods">
          {choices.filter(([, d]) => d >= min).map(([l, d]) => (
            <button key={l} type="button" className={value === d ? "on" : ""} style={{ minHeight: 30, padding: "4px 10px" }} onClick={() => onChange(d)}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}
