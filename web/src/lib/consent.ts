// Cookie consent, modelled on andreamuti.com: technical storage is always on, anonymous visit
// statistics only after consent. The choice is kept for 12 months, then asked again.
import { supabase } from "./supabase";

export const CONSENT_KEY = "ic_cookie_consent";
export const VISITOR_KEY = "ic_visitor";
export const SESSION_KEY = "ic_session";
const MAX_AGE_MS = 365 * 86_400_000;

export interface Consent {
  v: 1;
  stats: boolean;
  at: string;
}

const safe = <T>(f: () => T, fallback: T): T => {
  try {
    return f();
  } catch {
    return fallback;
  }
};

export function readConsent(): Consent | null {
  return safe(() => {
    const c = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null") as Consent | null;
    if (!c || c.v !== 1 || Date.now() - Date.parse(c.at) > MAX_AGE_MS) return null;
    return c;
  }, null);
}

export function saveConsent(stats: boolean): Consent {
  const c: Consent = { v: 1, stats, at: new Date().toISOString() };
  safe(() => localStorage.setItem(CONSENT_KEY, JSON.stringify(c)), undefined);
  if (!stats) {
    // withdrawing consent deletes the statistics identifiers
    safe(() => localStorage.removeItem(VISITOR_KEY), undefined);
    safe(() => sessionStorage.removeItem(SESSION_KEY), undefined);
  }
  window.dispatchEvent(new Event("ic-consent"));
  return c;
}

export const openCookiePreferences = () => window.dispatchEvent(new Event("ic-open-cookies"));

/** Counts one visit per browser session, only with consent. The id is a random token. */
export async function trackVisit(path: string) {
  if (!readConsent()?.stats) return;
  const already = safe(() => sessionStorage.getItem(SESSION_KEY), "1");
  if (already) return;
  let visitor = safe(() => localStorage.getItem(VISITOR_KEY), null);
  if (!visitor) {
    visitor = crypto.randomUUID();
    safe(() => localStorage.setItem(VISITOR_KEY, visitor!), undefined);
  }
  safe(() => sessionStorage.setItem(SESSION_KEY, "1"), undefined);
  await supabase.rpc("track_visit", { p_visitor: visitor, p_path: path.slice(0, 120) });
}
