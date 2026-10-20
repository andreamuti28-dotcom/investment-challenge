// Public registration: everyone creates their own account as a member.
// Body: { name, email, password, code? }
// With a valid team code the account joins that team at once; without it, the member joins
// later from their account. The organiser marks the presidents in Admin > Accounts.
// Accounts are confirmed at once.
import { cors, env, json, serviceHeaders } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const e = env();
  const H = serviceHeaders(e.serviceKey);
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const r = await fetch(`${e.supabaseUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`${fn}: ${await r.text()}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().replace(/\s+/g, " ");
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const code = String(b.code ?? "").trim();
  if (name.length < 2 || name.length > 80) return json({ error: "Enter your full name" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return json({ error: "Enter a valid e-mail address" }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "The password must have at least 8 characters" }, 400);

  try {
    let team: { team_id: string; team_name: string } | null = null;
    if (code) {
      team = ((await rpc("team_for_code", { p_code: code })) ?? [])[0] ?? null;
      if (!team) return json({ error: "Team code not recognised. Check it, or leave it empty and join your team later." }, 400);
    }

    const r = await fetch(`${e.supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }),
    });
    const u = await r.json();
    if (!r.ok) {
      const msg = String(u?.msg ?? u?.message ?? "");
      if (r.status === 422 && /already|exists|registered/i.test(msg)) return json({ error: "An account with this e-mail already exists: sign in instead." }, 409);
      if (/password/i.test(msg)) return json({ error: msg }, 400);
      return json({ error: "Registration failed, please try again" }, 500);
    }
    if (team) {
      try {
        await rpc("join_team", { p_user: u.id, p_team: team.team_id, p_role: "member", p_name: name });
      } catch (err) {
        await fetch(`${e.supabaseUrl}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
        throw err;
      }
    }
    return json({ ok: true, team: team?.team_name ?? null });
  } catch (err) {
    console.error(err);
    return json({ error: "Registration is temporarily unavailable" }, 500);
  }
});
