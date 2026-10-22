import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Edition of the challenge, set by the organiser in Admin > Calendar & settings. */
export interface Edition { year: number; short: string; long: string; full: string; publicStart: string | null; start: string | null; practiceStart: string | null; sponsorUrl: string }

export const DEFAULT_SPONSOR_URL = "https://wefocusbuddy.com/v";

export function editionOf(year: number, publicStart: string | null = null, start: string | null = null, practiceStart: string | null = null, sponsorUrl: string | null = null): Edition {
  const y = Math.trunc(year) || 2026;
  const next = (y + 1) % 100;
  return { year: y, short: `${String(y % 100).padStart(2, "0")}/${String(next).padStart(2, "0")}`, long: `${y}/${String(next).padStart(2, "0")}`, full: `${y}/${y + 1}`, publicStart, start, practiceStart: practiceStart && start && practiceStart < start ? practiceStart : null, sponsorUrl: sponsorUrl && /^https?:\/\//i.test(sponsorUrl) ? sponsorUrl : DEFAULT_SPONSOR_URL };
}

let cached: Edition = editionOf(2026, "2026-12-01", "2026-12-01");
let pending: Promise<Edition> | null = null;
const subs = new Set<(e: Edition) => void>();

export function loadEdition(force = false): Promise<Edition> {
  if (!pending || force) {
    pending = Promise.resolve(supabase.from("challenge_settings").select("edition_year,public_start_date,start_date,practice_start_date,sponsor_url").eq("id", 1).maybeSingle())
      .then(({ data }) => {
        if (data) cached = editionOf(Number((data as any).edition_year ?? 2026), (data as any).public_start_date ?? null, (data as any).start_date ?? null, (data as any).practice_start_date ?? null, (data as any).sponsor_url ?? null);
        subs.forEach((f) => f(cached));
        if (typeof document !== "undefined") document.title = `Interuniversity Investment Challenge ${cached.full}`;
        return cached;
      })
      .catch(() => cached);
  }
  return pending;
}

export function useEdition(): Edition {
  const [e, setE] = useState(cached);
  useEffect(() => {
    subs.add(setE);
    loadEdition().then(setE);
    return () => { subs.delete(setE); };
  }, []);
  return e;
}

/** today (Rome) before the official start, with a practice period set */
export function inPractice(e: Edition, today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date())): boolean {
  return !!(e.practiceStart && e.start && today < e.start);
}
