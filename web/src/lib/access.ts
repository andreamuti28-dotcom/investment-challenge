// Team access codes: same derivation as supabase/functions/_shared/access.ts.
// The code is the password of the team account; its e-mail address is derived from the code.
export const ACCESS_DOMAIN = "access.investment-challenge.app";

export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function codeEmail(code: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ic-team:${normalizeCode(code)}`));
  const hex = Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
  return `team-${hex.slice(0, 32)}@${ACCESS_DOMAIN}`;
}

export const isCodeAccount = (email: string | undefined) => !!email?.endsWith(`@${ACCESS_DOMAIN}`);
