import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface Team {
  id: string;
  name: string;
  competition: "A" | "B" | "C";
  university: string | null;
  role: "president" | "member";
}
interface AuthState {
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  /** the competition chosen after signing in: every page then refers to it */
  competition: "A" | "B" | "C" | null;
  setCompetition: (c: "A" | "B" | "C" | null) => void;
  /** the user's team in the chosen competition (null when not chosen or not in a team there) */
  team: Team | null;
  /** every team of the user, A first */
  teams: Team[];
  setActiveTeam: (id: string) => void;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthState>({ session: null, loading: true, isAdmin: false, competition: null, setCompetition: () => {}, team: null, teams: [], setActiveTeam: () => {}, refresh: async () => {} });

const KEY = "ic_competition";
type Comp = "A" | "B" | "C";
const remembered = (): Comp | null => { try { const v = sessionStorage.getItem(KEY); return v === "A" || v === "B" || v === "C" ? v : null; } catch { return null; } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setAdmin] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [competition, setComp] = useState<Comp | null>(remembered());

  async function load(s: Session | null) {
    setSession(s);
    if (!s) {
      setAdmin(false);
      setTeams([]);
      setComp(null);
      try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
      setLoading(false);
      return;
    }
    const [{ data: roles }, { data: mem }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", s.user.id),
      supabase.from("team_members").select("team_id,role").eq("user_id", s.user.id),
    ]);
    setAdmin(!!roles?.some((r) => r.role === "admin"));
    const ids = (mem ?? []).map((m: any) => m.team_id);
    if (ids.length) {
      const { data: ts } = await supabase.from("teams").select("id,name,competition,university").in("id", ids);
      const list = ((ts ?? []) as any[]).map((t) => ({ ...t, role: (mem as any[]).find((m) => m.team_id === t.id)?.role ?? "member" }) as Team)
        .sort((a, b) => a.competition.localeCompare(b.competition));
      setTeams(list);
    } else setTeams([]);
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => load(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const team = competition ? teams.find((t) => t.competition === competition) ?? null : null;
  const setCompetition = (c: Comp | null) => {
    setComp(c);
    try { if (c) sessionStorage.setItem(KEY, c); else sessionStorage.removeItem(KEY); } catch { /* convenience only */ }
  };
  const setActiveTeam = (id: string) => { const t = teams.find((x) => x.id === id); if (t) setCompetition(t.competition); };

  return (
    <Ctx.Provider value={{ session, loading, isAdmin, competition, setCompetition, team, teams, setActiveTeam, refresh: async () => load((await supabase.auth.getSession()).data.session) }}>
      {children}
    </Ctx.Provider>
  );
}
export const useAuth = () => useContext(Ctx);
