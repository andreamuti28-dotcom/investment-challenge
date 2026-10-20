// Shared helpers for the Edge Functions (Deno).
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-engine-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export function env() {
  // SERVICE_KEY can be set as a function secret when the project only has the new
  // "sb_secret_..." keys; otherwise the legacy service_role key provided by Supabase is used.
  const serviceKey = Deno.env.get("SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey,
    telegramToken: Deno.env.get("TELEGRAM_BOT_TOKEN") ?? undefined,
    telegramChatId: Deno.env.get("TELEGRAM_CHAT_ID") ?? undefined,
  };
}

export function serviceHeaders(serviceKey: string): Record<string, string> {
  // new-style secret keys (sb_secret_...) are not JWTs: send them only as apikey
  return serviceKey.startsWith("sb_")
    ? { apikey: serviceKey, "Content-Type": "application/json" }
    : { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
}

/** Returns the calling user (validated by Supabase Auth) and whether it is an admin. */
export async function caller(req: Request): Promise<{ id: string; email: string; admin: boolean } | null> {
  const e = env();
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${e.supabaseUrl}/auth/v1/user`, { headers: { apikey: e.serviceKey, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const roles = await fetch(
    `${e.supabaseUrl}/rest/v1/user_roles?select=role&user_id=eq.${u.id}&role=eq.admin`,
    { headers: serviceHeaders(e.serviceKey) },
  );
  const rows = roles.ok ? await roles.json() : [];
  return { id: u.id, email: u.email, admin: Array.isArray(rows) && rows.length > 0 };
}
