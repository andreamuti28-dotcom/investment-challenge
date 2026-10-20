import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { calendarMonths, type CalMonth } from "./months";

export interface Settings {
  capital: number;
  risk_free_annual: number;
  stop_threshold: number;
  benchmark_symbol: string;
  benchmark_currency: string;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  regulation_url: string | null;
}
export interface Month {
  n: number;
  label: string;
  start_date: string;
  expected_first_trading_day: string;
  end_date: string;
  order_deadline: string;
}

/** Small data hook: runs the loader, exposes data, error, loading and reload. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loader());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { data, error, loading, reload: run };
}

export async function must<T>(p: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export async function loadCalendar(): Promise<{ settings: Settings; months: CalMonth[] }> {
  const settings = (await must(supabase.from("challenge_settings").select("*").eq("id", 1).single())) as unknown as Settings;
  return { settings, months: calendarMonths(settings.start_date, settings.end_date) };
}
