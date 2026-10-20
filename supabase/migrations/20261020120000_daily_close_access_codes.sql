-- Daily execution at the closing price, team access codes, anonymous visit statistics.
--
-- Orders: an order is executed at the close of the trading day on which it is placed, on the
-- stock's own exchange. An order placed after that exchange's close, or on a weekend, goes to the
-- close of the next trading day (a holiday rolls forward to the first day with a price). Orders
-- placed before the start of the challenge are executed at the close of the start date.
-- Until the close the order can be cancelled; afterwards it is locked.
-- Currency transfers follow the same rule with the ECB reference rate (cutoff 14:00 Rome, before
-- the rate is fixed).

-- =====================================================================
-- 1. Exchange time zone and closing time of each instrument
-- =====================================================================
alter table public.instruments add column if not exists exchange_tz text;
alter table public.instruments add column if not exists close_time time;

-- =====================================================================
-- 2. Execution date and cutoff on orders and transfers
-- =====================================================================
alter table public.orders add column if not exists exec_date date;
alter table public.orders add column if not exists cutoff_at timestamptz;
alter table public.transfer_orders add column if not exists exec_date date;
alter table public.transfer_orders add column if not exists cutoff_at timestamptz;

-- month that contains a date (month 1 for dates before the start)
create or replace function public.month_of(p_date date)
returns int language sql stable set search_path = public as $$
  select coalesce((select n from public.challenge_months where start_date <= p_date order by n desc limit 1),
                  (select min(n) from public.challenge_months));
$$;

-- first trading date whose close comes after p_at, for a market in time zone p_tz closing at p_close
create or replace function public.next_close(p_at timestamptz, p_tz text, p_close time)
returns table (exec_date date, cutoff_at timestamptz) language plpgsql stable set search_path = public as $$
declare
  v_local timestamp := p_at at time zone p_tz;
  v_d date := v_local::date;
  v_start date := (select start_date from public.challenge_settings where id = 1);
begin
  if extract(isodow from v_d) >= 6 or v_local::time >= p_close then
    v_d := v_d + 1;
  end if;
  while extract(isodow from v_d) >= 6 loop v_d := v_d + 1; end loop;
  if v_d < v_start then
    v_d := v_start;
    while extract(isodow from v_d) >= 6 loop v_d := v_d + 1; end loop;
  end if;
  exec_date := v_d;
  cutoff_at := (v_d + p_close) at time zone p_tz;
  return next;
end $$;

create or replace function public.order_timing(p_symbol text, p_at timestamptz default now())
returns table (exec_date date, cutoff_at timestamptz) language sql stable security definer set search_path = public as $$
  select n.exec_date, n.cutoff_at
  from public.instruments i,
       lateral public.next_close(p_at, coalesce(i.exchange_tz, 'Europe/Rome'), coalesce(i.close_time, time '17:30')) n
  where i.symbol = p_symbol;
$$;

-- symbol held now or after the pending orders already placed (latest pending order wins)
create or replace function public.team_holds_now(p_team uuid, p_symbol text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select o.action <> 'close'
    from public.orders o
    where o.team_id = p_team and o.symbol = p_symbol and o.status = 'pending'
    order by o.created_at desc limit 1
  ), exists (
    select 1 from public.positions p where p.team_id = p_team and p.symbol = p_symbol and p.exit_date is null
  ));
$$;

create or replace function public.place_order(p_symbol text, p_action text, p_side text default null, p_quantity numeric default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_team uuid := public.my_team_id();
  v_instr public.instruments;
  v_t record;
  v_end date := (select end_date from public.challenge_settings where id = 1);
  v_holds boolean;
  v_row public.orders;
begin
  if v_team is null then raise exception 'You are not a member of any team'; end if;
  select * into v_instr from public.instruments where symbol = p_symbol;
  if v_instr.symbol is null then raise exception 'Unknown instrument %: search and select it first', p_symbol; end if;
  if v_instr.quote_type <> 'EQUITY' then raise exception 'Only listed stocks are allowed'; end if;
  if p_action not in ('open', 'close', 'change') then raise exception 'Invalid action'; end if;
  if p_action in ('open', 'change') then
    if p_side not in ('long', 'short') then raise exception 'Choose Long or Short'; end if;
    if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity) then
      raise exception 'Quantity must be a positive whole number of shares';
    end if;
  else
    p_side := null; p_quantity := null;
  end if;
  select * into v_t from public.order_timing(p_symbol);
  if v_t.exec_date > v_end then raise exception 'The challenge is over: no more orders can be placed'; end if;

  -- a pending order on the same symbol that can still be changed is replaced by the new one
  update public.orders set status = 'cancelled', reject_reason = 'replaced by a newer order', updated_at = now()
  where team_id = v_team and symbol = p_symbol and status = 'pending' and cutoff_at > now();

  v_holds := public.team_holds_now(v_team, p_symbol);
  if p_action = 'open' and v_holds then
    raise exception 'You already hold % : use Change to modify the quantity or side', p_symbol;
  end if;
  if p_action in ('close', 'change') and not v_holds then
    raise exception 'You do not hold %', p_symbol;
  end if;

  insert into public.orders (team_id, month_n, symbol, action, side, target_quantity, created_by, exec_date, cutoff_at)
  values (v_team, public.month_of(v_t.exec_date), p_symbol, p_action, p_side, p_quantity, auth.uid(), v_t.exec_date, v_t.cutoff_at)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.cancel_order(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders o set status = 'cancelled', updated_at = now()
  where o.id = p_id and o.team_id = public.my_team_id() and o.status = 'pending' and o.cutoff_at > now();
  if not found then raise exception 'Order not found or already locked: the market has closed'; end if;
end $$;

create or replace function public.place_transfer(p_currency text, p_eur_amount numeric)
returns public.transfer_orders language plpgsql security definer set search_path = public as $$
declare
  v_team uuid := public.my_team_id();
  v_t record;
  v_end date := (select end_date from public.challenge_settings where id = 1);
  v_row public.transfer_orders;
begin
  if v_team is null then raise exception 'You are not a member of any team'; end if;
  p_currency := upper(trim(p_currency));
  if p_currency !~ '^[A-Z]{3}$' or p_currency = 'EUR' then raise exception 'Invalid currency'; end if;
  if p_eur_amount is null or p_eur_amount = 0 then raise exception 'Amount must be different from zero'; end if;
  select * into v_t from public.next_close(now(), 'Europe/Rome', time '14:00');
  if v_t.exec_date > v_end then raise exception 'The challenge is over: no more transfers can be placed'; end if;
  insert into public.transfer_orders (team_id, month_n, currency, eur_amount, created_by, exec_date, cutoff_at)
  values (v_team, public.month_of(v_t.exec_date), p_currency, p_eur_amount, auth.uid(), v_t.exec_date, v_t.cutoff_at)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.cancel_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.transfer_orders t set status = 'cancelled'
  where t.id = p_id and t.team_id = public.my_team_id() and t.status = 'pending' and t.cutoff_at > now();
  if not found then raise exception 'Transfer not found or already locked'; end if;
end $$;

-- =====================================================================
-- 3. Team access codes (visible to the organiser only)
-- =====================================================================
create table if not exists public.team_access (
  team_id uuid primary key references public.teams(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  code text not null unique,
  updated_at timestamptz not null default now()
);
alter table public.team_access enable row level security;
drop policy if exists admin_all on public.team_access;
create policy admin_all on public.team_access for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- 4. Anonymous visit statistics (only with the visitor's consent)
-- =====================================================================
create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  visitor uuid not null,
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists site_visits_visitor_idx on public.site_visits (visitor, created_at);
alter table public.site_visits enable row level security;
drop policy if exists admin_read on public.site_visits;
create policy admin_read on public.site_visits for select to authenticated using (public.is_admin());

-- one visit per visitor every 30 minutes; the visitor id is a random token, not personal data
create or replace function public.track_visit(p_visitor uuid, p_path text)
returns void language sql security definer set search_path = public as $$
  insert into public.site_visits (visitor, path)
  select p_visitor, left(coalesce(p_path, '/'), 120)
  where p_visitor is not null and not exists (
    select 1 from public.site_visits v where v.visitor = p_visitor and v.created_at > now() - interval '30 minutes'
  );
$$;

create or replace function public.visit_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'visits', (select count(*) from public.site_visits),
    'visitors', (select count(distinct visitor) from public.site_visits),
    'last30', (select count(*) from public.site_visits where created_at > now() - interval '30 days'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'visits', n, 'visitors', u) order by d), '[]') from (
      select (created_at at time zone 'Europe/Rome')::date d, count(*) n, count(distinct visitor) u
      from public.site_visits where created_at > now() - interval '60 days' group by 1) q),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('path', path, 'visits', n) order by n desc), '[]') from (
      select path, count(*) n from public.site_visits group by path order by n desc limit 10) q)
  ) end;
$$;

-- =====================================================================
-- 5. Privileges
-- =====================================================================
revoke execute on function public.month_of(date) from public, anon, authenticated;
revoke execute on function public.next_close(timestamptz, text, time) from public, anon, authenticated;
revoke execute on function public.team_holds_now(uuid, text) from public, anon, authenticated;
grant execute on function public.order_timing(text, timestamptz) to authenticated;
revoke execute on function public.order_timing(text, timestamptz) from public, anon;
revoke execute on function public.track_visit(uuid, text) from public;
grant execute on function public.track_visit(uuid, text) to anon, authenticated;
revoke execute on function public.visit_stats() from public, anon;
grant execute on function public.visit_stats() to authenticated;
