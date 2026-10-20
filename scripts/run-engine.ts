// Runs one engine pass from Node (GitHub Actions fallback or your own computer):
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node --experimental-strip-types scripts/run-engine.ts [YYYY-MM-DD]
import { runOnce } from "../supabase/functions/_shared/runner.ts";

const env = {
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  serviceKey: process.env.SUPABASE_SERVICE_KEY ?? "",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
  telegramChatId: process.env.TELEGRAM_CHAT_ID || undefined,
};
if (!env.supabaseUrl || !env.serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const asOf = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : undefined;
const r = await runOnce(env, { asOf, trigger: "github" });
console.log(r.log.join("\n"));
for (const w of r.warnings) console.log("WARNING", w);
process.exit(r.status === "error" ? 1 : 0);
