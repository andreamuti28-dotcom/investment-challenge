// Public registration: everyone creates their own account as a member.
// Body: { firstName, lastName, email, password, code? }
// With a valid team code the account joins that team at once; without it, the member joins
// later from their account. The organiser marks the presidents in Admin > Accounts.
// Accounts are confirmed at once. The organiser receives an e-mail for every new registration
// (Resend: RESEND_API_KEY secret or 'resend_api_key' in Vault).
import { cors, env, json, serviceHeaders } from "../_shared/http.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function notifyOrganiser(e: ReturnType<typeof env>, H: Record<string, string>, who: { name: string; email: string; team: string | null }) {
  try {
    const post = (fn: string) => fetch(`${e.supabaseUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: "{}" }).then((x) => (x.ok ? x.json() : null));
    const [info, vaultKey] = await Promise.all([post("registration_notice_info"), Deno.env.get("RESEND_API_KEY") ? null : post("mail_api_key")]);
    const key = Deno.env.get("RESEND_API_KEY") ?? vaultKey;
    const to: string[] = Deno.env.get("ORGANISER_EMAIL")?.split(",").map((x) => x.trim()).filter(Boolean) ?? info?.organisers ?? [];
    if (!key || !to.length) return;
    const site = Deno.env.get("SITE_URL") ?? "https://internationalchallenge.org/";
    const row = (k: string, v: unknown) => `<tr><td style="padding:4px 14px 4px 0;color:#666">${k}</td><td>${esc(v)}</td></tr>`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("MAIL_FROM") ?? "Investment Challenge <onboarding@resend.dev>",
        to,
        subject: `New registration: ${who.name}${who.team ? ` (${who.team})` : ""}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
          <p><b>${esc(who.name)}</b> has just registered on the Investment Challenge.</p>
          <table style="border-collapse:collapse">
            ${row("Name", who.name)}${row("E-mail", who.email)}
            ${row("Team (Competition A)", who.team ?? "none yet: registered without a team code")}
            ${row("When", new Date().toLocaleString("en-GB", { timeZone: "Europe/Rome" }) + " (Rome)")}
            ${info ? row("Registered so far", `${info.total} participants (${info.today} today)`) : ""}
          </table>
          <p><a href="${esc(site)}admin">Open Admin &gt; Accounts</a></p>
        </div>`,
      }),
    });
    if (!r.ok) console.error("resend", r.status, await r.text());
  } catch (err) {
    console.error("notify", String(err));
  }
}

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
  const clean = (x: unknown) => String(x ?? "").trim().replace(/\s+/g, " ");
  const firstName = clean(b.firstName), lastName = clean(b.lastName);
  const name = `${firstName} ${lastName}`.trim();
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const code = String(b.code ?? "").trim();
  if (!firstName || !lastName || firstName.length > 40 || lastName.length > 40) return json({ error: "Enter your first and last name" }, 400);
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
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name, first_name: firstName, last_name: lastName } }),
    });
    const u = await r.json();
    if (!r.ok) {
      const msg = String(u?.msg ?? u?.message ?? "");
      if (r.status === 422 && /already|exists|registered/i.test(msg)) return json({ error: "An account with this e-mail already exists: sign in instead." }, 409);
      if (/password/i.test(msg)) return json({ error: msg }, 400);
      return json({ error: "Registration failed, please try again" }, 500);
    }
    await rpc("create_profile", { p_user: u.id, p_first: firstName, p_last: lastName }).catch((err) => console.error(err));
    if (team) {
      try {
        await rpc("join_team", { p_user: u.id, p_team: team.team_id, p_role: "member", p_name: name });
      } catch (err) {
        await fetch(`${e.supabaseUrl}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
        throw err;
      }
    }
    await notifyOrganiser(e, H, { name, email, team: team?.team_name ?? null });
    return json({ ok: true, team: team?.team_name ?? null });
  } catch (err) {
    console.error(err);
    return json({ error: "Registration is temporarily unavailable" }, 500);
  }
});
