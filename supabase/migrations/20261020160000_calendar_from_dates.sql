-- The calendar follows the start and end dates set in the admin panel: month 1 is the calendar
-- month of the start date. challenge_months is no longer used by the engine.
alter table public.orders drop constraint if exists orders_month_n_fkey;
alter table public.transfer_orders drop constraint if exists transfer_orders_month_n_fkey;

create or replace function public.month_of(p_date date)
returns int language sql stable set search_path = public as $$
  select greatest(1, ((extract(year from p_date) * 12 + extract(month from p_date))
                    - (extract(year from s.start_date) * 12 + extract(month from s.start_date)) + 1)::int)
  from public.challenge_settings s where s.id = 1;
$$;
revoke execute on function public.month_of(date) from public, anon, authenticated;
