// Admin-only account management.
// Body: { action: "create_team_user", teamId, email }
//     | { action: "reset_password", userId }
//     | { action: "list_team_users", teamId }
// Supabase's built-in mailer only delivers to the project's own members, so accounts are
// created with a temporary password that the admin forwards to the team.
import { caller, cors, env, json, serviceHeaders } from "../_shared/http.ts";

function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const b = new Uint8Array(14);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => chars[x % chars.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const who = await caller(req);
  if (!who?.admin) return json({ error: "unauthorized" }, 401);
  const e = env();
  const H = serviceHeaders(e.serviceKey);
  const body = await req.json().catch(() => ({}));

  if (body.action === "create_team_user") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const teamId = String(body.teamId ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !teamId) return json({ error: "Email and team are required" }, 400);
    const password = tempPassword();
    const r = await fetch(`${e.supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const u = await r.json();
    if (!r.ok) return json({ error: u?.msg ?? u?.message ?? "Could not create user" }, 400);
    const l = await fetch(`${e.supabaseUrl}/rest/v1/rpc/link_team_user`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ p_user: u.id, p_team: teamId }),
    });
    if (!l.ok) return json({ error: `User created but not linked: ${await l.text()}` }, 500);
    return json({ userId: u.id, email, password });
  }

  if (body.action === "reset_password") {
    const userId = String(body.userId ?? "");
    const password = tempPassword();
    const r = await fetch(`${e.supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ password }),
    });
    if (!r.ok) return json({ error: await r.text() }, 400);
    return json({ password });
  }

  if (body.action === "list_team_users") {
    const teamId = String(body.teamId ?? "");
    const m = await fetch(`${e.supabaseUrl}/rest/v1/team_members?select=user_id&team_id=eq.${teamId}`, { headers: H });
    const members: { user_id: string }[] = m.ok ? await m.json() : [];
    const users = [];
    for (const x of members) {
      const r = await fetch(`${e.supabaseUrl}/auth/v1/admin/users/${x.user_id}`, { headers: H });
      if (r.ok) {
        const u = await r.json();
        users.push({ id: u.id, email: u.email, lastSignIn: u.last_sign_in_at });
      }
    }
    return json({ users });
  }

  return json({ error: "Unknown action" }, 400);
});
