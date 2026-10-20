import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Edition of the challenge, set by the organiser in Admin > Calendar & settings. */
export interface Edition { year: number; short: string; long: string; full: string; publicStart: string | null }

export function editionOf(year: number, publicStart: string | null = null): Edition {
  const y = Math.trunc(year) || 2026;
  const next = (y + 1) % 100;
  return { year: y, short: `${String(y % 100).padStart(2, "0")}/${String(next).padStart(2, "0")}`, long: `${y}/${String(next).padStart(2, "0")}`, full: `${y}/${y + 1}`, publicStart };
}

let cached: Edition = editionOf(2026, "2026-12-01");
let pending: Promise<Edition> | null = null;
const subs = new Set<(e: Edition) => void>();

export function loadEdition(force = false): Promise<Edition> {
  if (!pending || force) {
    pending = Promise.resolve(supabase.from("challenge_settings").select("edition_year,public_start_date").eq("id", 1).maybeSingle())
      .then(({ data }) => {
        if (data) cached = editionOf(Number((data as any).edition_year ?? 2026), (data as any).public_start_date ?? null);
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
