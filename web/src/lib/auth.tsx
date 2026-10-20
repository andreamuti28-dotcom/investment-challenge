import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface Team {
  id: string;
  name: string;
  competition: "A" | "B";
  university: string | null;
  role: "president" | "member";
}
interface AuthState {
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  team: Team | null;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthState>({ session: null, loading: true, isAdmin: false, team: null, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setAdmin] = useState(false);
  const [team, setTeam] = useState<Team | null>(null);

  async function load(s: Session | null) {
    setSession(s);
    if (!s) {
      setAdmin(false);
      setTeam(null);
      setLoading(false);
      return;
    }
    const [{ data: roles }, { data: mem }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", s.user.id),
      supabase.from("team_members").select("team_id,role").eq("user_id", s.user.id).limit(1),
    ]);
    setAdmin(!!roles?.some((r) => r.role === "admin"));
    if (mem?.[0]) {
      const { data: t } = await supabase.from("teams").select("id,name,competition,university").eq("id", mem[0].team_id).single();
      setTeam(t ? ({ ...(t as any), role: (mem[0] as any).role ?? "member" } as Team) : null);
    } else setTeam(null);
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => load(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider value={{ session, loading, isAdmin, team, refresh: async () => load((await supabase.auth.getSession()).data.session) }}>
      {children}
    </Ctx.Provider>
  );
}
export const useAuth = () => useContext(Ctx);
