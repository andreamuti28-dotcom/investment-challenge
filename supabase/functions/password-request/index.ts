// Public: "Forgot password?" from the sign-in box. Records the request (only for existing
// accounts, rate limited in the database) and notifies the organiser by e-mail (Resend, when
// RESEND_API_KEY is set) and on Telegram (when the engine's Telegram bot is configured).
// The answer is always the same, so nobody can find out whether an e-mail is registered.
import { cors, env, json, serviceHeaders } from "../_shared/http.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid e-mail address." }, 400);
  const e = env();
  const r = await fetch(`${e.supabaseUrl}/rest/v1/rpc/request_password_reset`, {
    method: "POST", headers: serviceHeaders(e.serviceKey), body: JSON.stringify({ p_email: email }),
  });
  const res = r.ok ? await r.json() : null;
  if (res?.stored) {
    const who = `${res.name ?? "(no name)"} <${res.email}>${res.team ? ` · ${res.team}` : ""}`;
    const site = Deno.env.get("SITE_URL") ?? "https://andreamuti28-dotcom.github.io/investment-challenge/";
    const key = Deno.env.get("RESEND_API_KEY");
    const to: string[] = (Deno.env.get("ORGANISER_EMAIL")?.split(",").map((x) => x.trim()).filter(Boolean)) ?? res.organisers ?? [];
    if (key && to.length) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("MAIL_FROM") ?? "Investment Challenge <onboarding@resend.dev>",
          to,
          subject: `Password reset requested: ${res.name ?? res.email}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
            <p><b>${esc(res.name ?? "A participant")}</b> asked to reset the password.</p>
            <table style="border-collapse:collapse">
              <tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td>${esc(res.name ?? "–")}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666">E-mail</td><td>${esc(res.email)}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666">Team</td><td>${esc(res.team ?? "–")}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666">Requested</td><td>${esc(new Date().toLocaleString("en-GB", { timeZone: "Europe/Rome" }))} (Rome)</td></tr>
            </table>
            <p>Open <a href="${esc(site)}admin">Admin &gt; Accounts</a> and click <b>Reset password</b>: you get a temporary password to send them privately. Their account, team and portfolio stay as they are.</p>
          </div>`,
        }),
      }).catch(() => {});
    }
    if (e.telegramToken && e.telegramChatId) {
      await fetch(`https://api.telegram.org/bot${e.telegramToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: e.telegramChatId, text: `Investment Challenge: password reset requested by ${who}. Admin > Accounts.` }),
      }).catch(() => {});
    }
  }
  return json({ ok: true });
});
