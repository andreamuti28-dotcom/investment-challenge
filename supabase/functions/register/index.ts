// Public registration.
// Body: { role: "president" | "member", name, email, password, code? }
// A president can register only with the e-mail the organiser saved for a team, and only once.
// A member needs the team code, which the president shares. Accounts are confirmed at once.
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
  const role = b.role === "president" ? "president" : b.role === "member" ? "member" : null;
  const name = String(b.name ?? "").trim().replace(/\s+/g, " ");
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  if (!role) return json({ error: "Choose President or Member" }, 400);
  if (name.length < 2 || name.length > 80) return json({ error: "Enter your full name" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return json({ error: "Enter a valid e-mail address" }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "The password must have at least 8 characters" }, 400);

  try {
    const pres = ((await rpc("team_for_president", { p_email: email })) ?? [])[0];
    let teamId: string;
    let teamName: string;
    if (role === "president") {
      if (!pres) return json({ error: "This e-mail is not on the list of team presidents. Check it with the organiser, or register as a member." }, 403);
      if (pres.taken) return json({ error: `The president of ${pres.team_name} has already registered. Sign in instead.` }, 409);
      teamId = pres.team_id;
      teamName = pres.team_name;
    } else {
      if (pres) return json({ error: "This e-mail belongs to a team president: choose President." }, 400);
      const t = ((await rpc("team_for_code", { p_code: String(b.code ?? "") })) ?? [])[0];
      if (!t) return json({ error: "Team code not recognised. Ask your president for it." }, 400);
      teamId = t.team_id;
      teamName = t.team_name;
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
    try {
      await rpc("join_team", { p_user: u.id, p_team: teamId, p_role: role, p_name: name });
    } catch (err) {
      await fetch(`${e.supabaseUrl}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
      const m = (err as Error).message;
      if (/one_president|duplicate/i.test(m)) return json({ error: `The president of ${teamName} has already registered.` }, 409);
      throw err;
    }
    return json({ ok: true, team: teamName, role });
  } catch (err) {
    console.error(err);
    return json({ error: "Registration is temporarily unavailable" }, 500);
  }
});
