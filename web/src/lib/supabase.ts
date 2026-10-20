import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const configured = Boolean(url && key);
export const supabase = createClient(url || "https://example.supabase.co", key || "public-anon-key");

/** Calls an Edge Function and returns its JSON, throwing the server error message. */
export async function callFunction<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === "function") msg = (await ctx.json()).error ?? msg;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data as T;
}

export function errText(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  const m = (e as any).message ?? String(e);
  return m.replace(/^.*?ERROR:\s*/, "");
}
