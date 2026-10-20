// Team access codes. A team signs in with its code only: the code is the password of a
// dedicated account whose e-mail address is derived from the code itself, so the website can
// sign in without asking for an e-mail. The same derivation lives in web/src/lib/access.ts.
export const ACCESS_DOMAIN = "access.investment-challenge.app";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O/1/I

export function newCode(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  const s = Array.from(b, (x) => ALPHABET[x % 32]).join(""); // 256 % 32 = 0: no bias
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function codeEmail(code: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ic-team:${normalizeCode(code)}`));
  const hex = Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
  return `team-${hex.slice(0, 32)}@${ACCESS_DOMAIN}`;
}
