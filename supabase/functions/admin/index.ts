// Organiser-only account management.
// Body: { action: "set_team_code", teamId }   creates the team's access code, or replaces it
//     | { action: "list_users" }               every account with its role and team
//     | { action: "delete_user", userId }      deletes an account (never the caller's own)
//     | { action: "delete_team", teamId }      deletes a team, its accounts, orders and results
// Callable by a signed-in admin, or server-to-server with the engine secret kept in Vault.
import { caller, cors, env, json, serviceHeaders } from "../_shared/http.ts";
import { codeEmail, newCode, normalizeCode } from "../_shared/access.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const e = env();
  let who = await caller(req);
  const secret = req.headers.get("x-engine-secret");
  const secretOk = async (p: string) => {
    const r = await fetch(`${e.supabaseUrl}/rest/v1/rpc/verify_engine_secret`, { method: "POST", headers: serviceHeaders(e.serviceKey), body: JSON.stringify({ p }) });
    return r.ok && (await r.json()) === true;
  };
  if (!who?.admin && secret && (await secretOk(secret))) {
    who = { id: "", email: "automation", admin: true };
  }
  if (!who?.admin) return json({ error: "unauthorized" }, 401);
  const H = serviceHeaders(e.serviceKey);
  const rest = (path: string, init: RequestInit = {}) => fetch(`${e.supabaseUrl}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const authApi = (path: string, init: RequestInit = {}) => fetch(`${e.supabaseUrl}/auth/v1/admin/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const body = await req.json().catch(() => ({}));
  const uuid = (x: unknown) => (typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x) ? x : null);

  try {
    if (body.action === "set_team_code") {
      const teamId = uuid(body.teamId);
      if (!teamId) return json({ error: "Team is required" }, 400);
      const team = await (await rest(`teams?select=id,name&id=eq.${teamId}`)).json();
      if (!team?.[0]) return json({ error: "Team not found" }, 404);
      const existing = (await (await rest(`team_access?select=user_id&team_id=eq.${teamId}`)).json())?.[0];
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = newCode();
        const email = await codeEmail(code);
        const password = normalizeCode(code);
        let userId = existing?.user_id as string | undefined;
        if (userId) {
          const r = await authApi(`users/${userId}`, { method: "PUT", body: JSON.stringify({ email, password, email_confirm: true }) });
          if (!r.ok) {
            if (r.status === 422 && attempt < 2) continue; // e-mail clash: new code
            return json({ error: `Could not update the account: ${await r.text()}` }, 500);
          }
          // sign the team out of the old code everywhere
          await fetch(`${e.supabaseUrl}/rest/v1/rpc/revoke_user_sessions`, { method: "POST", headers: H, body: JSON.stringify({ p_user: userId }) });
          const u = await rest(`team_access?team_id=eq.${teamId}`, { method: "PATCH", body: JSON.stringify({ code, updated_at: new Date().toISOString() }) });
          if (!u.ok) return json({ error: await u.text() }, 500);
        } else {
          const r = await authApi("users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { team: team[0].name } }) });
          const j = await r.json();
          if (!r.ok) {
            if (r.status === 422 && attempt < 2) continue;
            return json({ error: j?.msg ?? j?.message ?? "Could not create the account" }, 500);
          }
          userId = j.id;
          const l = await fetch(`${e.supabaseUrl}/rest/v1/rpc/link_team_user`, { method: "POST", headers: H, body: JSON.stringify({ p_user: userId, p_team: teamId }) });
          const a = await rest("team_access", { method: "POST", body: JSON.stringify({ team_id: teamId, user_id: userId, code }) });
          if (!l.ok || !a.ok) {
            await authApi(`users/${userId}`, { method: "DELETE" });
            return json({ error: `Could not link the account: ${await l.text()} ${await a.text()}` }, 500);
          }
        }
        return json({ code });
      }
      return json({ error: "Could not generate a unique code, try again" }, 500);
    }

    if (body.action === "list_users") {
      const [ur, roles, members, teams, access] = await Promise.all([
        authApi("users?per_page=1000"),
        rest("user_roles?select=user_id,role"),
        rest("team_members?select=user_id,team_id"),
        rest("teams?select=id,name"),
        rest("team_access?select=user_id,team_id"),
      ]);
      const users = ((await ur.json()).users ?? []) as any[];
      const R = (await roles.json()) as any[], M = (await members.json()) as any[], T = (await teams.json()) as any[], A = (await access.json()) as any[];
      const teamName = Object.fromEntries(T.map((t) => [t.id, t.name]));
      const codeUser = new Set(A.map((a) => a.user_id));
      return json({
        users: users.map((u) => {
          const admin = R.some((r) => r.user_id === u.id && r.role === "admin");
          const teamId = M.find((m) => m.user_id === u.id)?.team_id ?? null;
          return {
            id: u.id,
            email: codeUser.has(u.id) ? null : u.email,
            kind: admin ? "admin" : codeUser.has(u.id) ? "team code" : teamId ? "team" : "no role",
            teamId,
            team: teamId ? teamName[teamId] ?? null : null,
            createdAt: u.created_at,
            lastSignIn: u.last_sign_in_at,
            self: u.id === who!.id,
          };
        }).sort((a, b) => a.kind.localeCompare(b.kind) || String(a.team ?? a.email).localeCompare(String(b.team ?? b.email))),
      });
    }

    if (body.action === "delete_user") {
      const userId = uuid(body.userId);
      if (!userId) return json({ error: "User is required" }, 400);
      if (userId === who.id) return json({ error: "You cannot delete your own account" }, 400);
      const r = await authApi(`users/${userId}`, { method: "DELETE" });
      if (!r.ok) return json({ error: await r.text() }, 400);
      return json({ ok: true });
    }

    if (body.action === "delete_team") {
      const teamId = uuid(body.teamId);
      if (!teamId) return json({ error: "Team is required" }, 400);
      const [members, admins] = await Promise.all([
        (await rest(`team_members?select=user_id&team_id=eq.${teamId}`)).json(),
        (await rest("user_roles?select=user_id&role=eq.admin")).json(),
      ]);
      const adminIds = new Set((admins as any[]).map((a) => a.user_id));
      let deletedAccounts = 0;
      for (const m of members as any[]) {
        if (adminIds.has(m.user_id) || m.user_id === who.id) continue; // never delete an organiser
        const r = await authApi(`users/${m.user_id}`, { method: "DELETE" });
        if (r.ok) deletedAccounts++;
      }
      const d = await rest(`teams?id=eq.${teamId}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      if (!d.ok) return json({ error: await d.text() }, 500);
      const gone = await d.json();
      if (!gone.length) return json({ error: "Team not found" }, 404);
      return json({ ok: true, deletedAccounts });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
