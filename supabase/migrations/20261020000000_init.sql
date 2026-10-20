-- Interuniversity Investment Challenge 2026/2027 - database schema
-- Run once in the Supabase SQL editor (or `supabase db push`).

-- =====================================================================
-- 1. Roles and helpers
-- =====================================================================
create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'team')),
  primary key (user_id, role)
);

create or replace function public.has_role(uid uuid, r text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = uid and role = r);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin');
$$;

-- =====================================================================
-- 2. Configuration
-- =====================================================================
create table public.challenge_settings (
  id int primary key default 1 check (id = 1),
  capital numeric not null default 1000000,
  risk_free_annual numeric not null default 0.02,
  stop_threshold numeric not null default 0.5,
  benchmark_symbol text not null default 'SWDA.L',
  benchmark_currency text not null default 'GBP',
  start_date date not null default '2026-12-01',
  end_date date not null default '2027-05-31',
  registration_deadline timestamptz not null default (timestamp '2026-11-15 23:59:59' at time zone 'Europe/Rome'),
  timezone text not null default 'Europe/Rome',
  regulation_url text,
  updated_at timestamptz not null default now()
);
insert into public.challenge_settings (id) values (1);

create table public.challenge_months (
  n int primary key check (n between 1 and 12),
  label text not null,
  start_date date not null,
  expected_first_trading_day date not null,
  end_date date not null,
  order_deadline timestamptz not null
);
insert into public.challenge_months values
  (1, 'December 2026', '2026-12-01', '2026-12-01', '2026-12-31', timestamp '2026-11-29 23:59:59' at time zone 'Europe/Rome'),
  (2, 'January 2027',  '2027-01-01', '2027-01-04', '2027-01-29', timestamp '2026-12-31 23:59:59' at time zone 'Europe/Rome'),
  (3, 'February 2027', '2027-02-01', '2027-02-01', '2027-02-26', timestamp '2027-01-29 23:59:59' at time zone 'Europe/Rome'),
  (4, 'March 2027',    '2027-03-01', '2027-03-01', '2027-03-31', timestamp '2027-02-26 23:59:59' at time zone 'Europe/Rome'),
  (5, 'April 2027',    '2027-04-01', '2027-04-01', '2027-04-30', timestamp '2027-03-31 23:59:59' at time zone 'Europe/Rome'),
  (6, 'May 2027',      '2027-05-01', '2027-05-03', '2027-05-31', timestamp '2027-04-30 23:59:59' at time zone 'Europe/Rome');

-- =====================================================================
-- 3. Teams
-- =====================================================================
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  competition text not null check (competition in ('A', 'B')),
  university text,
  violations int not null default 0,
  created_at timestamptz not null default now()
);

-- private contact data, separated so that teams can be public
create table public.team_contacts (
  team_id uuid primary key references public.teams(id) on delete cascade,
  contact_name text,
  contact_email text,
  notes text
);

create table public.team_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  primary key (user_id, team_id)
);

create or replace function public.my_team_id()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.team_members where user_id = auth.uid() limit 1;
$$;

-- =====================================================================
-- 4. Market data
-- =====================================================================
create table public.instruments (
  symbol text primary key,
  name text,
  exchange text,
  currency text not null,
  price_divisor numeric not null default 1,
  quote_type text not null default 'EQUITY',
  isin text,
  created_at timestamptz not null default now()
);

create table public.prices (
  symbol text not null,
  date date not null,
  close numeric not null check (close > 0),
  source text not null check (source in ('yahoo', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (symbol, date, source)
);

create table public.corporate_events (
  symbol text not null,
  date date not null,
  type text not null check (type in ('dividend', 'split')),
  value numeric not null,
  source text not null check (source in ('yahoo', 'manual')),
  primary key (symbol, date, type, source)
);

create table public.fx_rates (
  currency text not null,
  date date not null,
  rate numeric not null check (rate > 0),
  source text not null check (source in ('ecb', 'manual')),
  primary key (currency, date, source)
);

-- =====================================================================
-- 5. Orders
-- =====================================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  month_n int not null references public.challenge_months(n),
  symbol text not null references public.instruments(symbol),
  action text not null check (action in ('open', 'close', 'change')),
  side text check (side in ('long', 'short')),
  target_quantity numeric,
  status text not null default 'pending' check (status in ('pending', 'executed', 'rejected', 'cancelled')),
  reject_source text check (reject_source in ('engine', 'admin')),
  reject_reason text,
  executed_date date,
  executed_price numeric,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (action = 'close' or (side is not null and target_quantity > 0))
);
create index on public.orders (team_id, month_n);

create table public.transfer_orders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  month_n int not null references public.challenge_months(n),
  currency text not null check (currency <> 'EUR'),
  eur_amount numeric not null check (eur_amount <> 0),
  status text not null default 'pending' check (status in ('pending', 'executed', 'rejected', 'cancelled')),
  reject_source text check (reject_source in ('engine', 'admin')),
  reject_reason text,
  rate numeric,
  executed_date date,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 6. Derived tables (written only by the engine)
-- =====================================================================
create table public.positions (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  symbol text not null,
  currency text not null,
  side text not null,
  quantity numeric not null,
  entry_date date not null,
  entry_price numeric not null,
  exit_date date,
  exit_price numeric,
  exit_reason text,
  open_month int,
  close_month int,
  order_id uuid,
  last_price numeric,
  value_local numeric,
  value_eur numeric,
  pnl_local numeric,
  pnl_eur numeric
);
create index on public.positions (team_id);

create table public.cash_ledger (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  date date not null,
  currency text not null,
  amount numeric not null,
  kind text not null,
  ref text
);
create index on public.cash_ledger (team_id);

create table public.nav_daily (
  team_id uuid not null references public.teams(id) on delete cascade,
  date date not null,
  nav_eur numeric not null,
  primary key (team_id, date)
);
create table public.benchmark_daily (date date primary key, value_eur numeric not null);
create table public.nav_monthly (
  team_id uuid not null references public.teams(id) on delete cascade,
  month_n int not null,
  valuation_date date not null,
  nav_eur numeric not null,
  primary key (team_id, month_n)
);
create table public.benchmark_monthly (month_n int primary key, valuation_date date not null, value_eur numeric not null);

create table public.subportfolios (
  team_id uuid not null references public.teams(id) on delete cascade,
  as_of date not null,
  currency text not null,
  cash_local numeric not null,
  positions_value_local numeric not null,
  total_local numeric not null,
  fx_rate numeric,
  total_eur numeric,
  primary key (team_id, currency)
);

create table public.metrics (
  team_id uuid primary key references public.teams(id) on delete cascade,
  as_of date not null,
  months_completed int not null,
  nav numeric,
  total_return numeric,
  rank_in_competition int,
  benchmark_return numeric,
  excess_return numeric,
  volatility numeric,
  sharpe numeric,
  sortino numeric,
  beta numeric,
  tracking_error numeric,
  max_drawdown numeric,
  calmar numeric,
  operations int not null default 0,
  max_weight numeric,
  hhi numeric,
  currency_exposure jsonb not null default '{}',
  violations int not null default 0
);

create table public.engine_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'ok', 'warning', 'error')),
  as_of date,
  trigger text,
  log text,
  warnings jsonb not null default '[]'
);

-- public views
create view public.leaderboard with (security_invoker = true) as
  select t.id as team_id, t.name, t.competition, t.university,
    m.as_of, m.months_completed, m.nav, m.total_return, m.rank_in_competition, m.benchmark_return, m.excess_return,
    m.volatility, m.sharpe, m.sortino, m.beta, m.tracking_error, m.max_drawdown, m.calmar, m.operations,
    m.max_weight, m.hhi, m.currency_exposure, coalesce(m.violations, t.violations) as violations
  from public.teams t left join public.metrics m on m.team_id = t.id;

create view public.last_engine_run with (security_invoker = true) as
  select finished_at, status, as_of from public.engine_runs
  where status in ('ok', 'warning') order by id desc limit 1;

-- =====================================================================
-- 7. Row level security
-- =====================================================================
alter table public.user_roles enable row level security;
alter table public.challenge_settings enable row level security;
alter table public.challenge_months enable row level security;
alter table public.teams enable row level security;
alter table public.team_contacts enable row level security;
alter table public.team_members enable row level security;
alter table public.instruments enable row level security;
alter table public.prices enable row level security;
alter table public.corporate_events enable row level security;
alter table public.fx_rates enable row level security;
alter table public.orders enable row level security;
alter table public.transfer_orders enable row level security;
alter table public.positions enable row level security;
alter table public.cash_ledger enable row level security;
alter table public.nav_daily enable row level security;
alter table public.benchmark_daily enable row level security;
alter table public.nav_monthly enable row level security;
alter table public.benchmark_monthly enable row level security;
alter table public.subportfolios enable row level security;
alter table public.metrics enable row level security;
alter table public.engine_runs enable row level security;

-- admin: everything
do $$
declare t text;
begin
  foreach t in array array['user_roles','challenge_settings','challenge_months','teams','team_contacts','team_members',
    'instruments','prices','corporate_events','fx_rates','orders','transfer_orders','positions','cash_ledger',
    'nav_daily','benchmark_daily','nav_monthly','benchmark_monthly','subportfolios','metrics','engine_runs']
  loop
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- public read
do $$
declare t text;
begin
  foreach t in array array['challenge_settings','challenge_months','teams','instruments','prices','corporate_events',
    'fx_rates','nav_daily','benchmark_daily','nav_monthly','benchmark_monthly','metrics']
  loop
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;
create policy public_read_runs on public.engine_runs for select to anon, authenticated using (status in ('ok', 'warning'));

-- own rows
create policy own_roles on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy own_membership on public.team_members for select to authenticated using (user_id = auth.uid());
create policy own_contact on public.team_contacts for select to authenticated using (team_id = public.my_team_id());
create policy own_orders on public.orders for select to authenticated using (team_id = public.my_team_id());
create policy own_transfers on public.transfer_orders for select to authenticated using (team_id = public.my_team_id());
create policy own_ledger on public.cash_ledger for select to authenticated using (team_id = public.my_team_id());
create policy own_subportfolios on public.subportfolios for select to authenticated using (team_id = public.my_team_id());
-- positions: own team, or everybody once the challenge is over
create policy own_or_final_positions on public.positions for select to anon, authenticated using (
  team_id = public.my_team_id()
  or (select end_date from public.challenge_settings where id = 1) < (now() at time zone 'Europe/Rome')::date
);
-- Teams never write tables directly: all their writes go through the functions below.

-- =====================================================================
-- 8. Team functions (the only write path for teams)
-- =====================================================================
create or replace function public.open_order_month()
returns public.challenge_months language sql stable security definer set search_path = public as $$
  select * from public.challenge_months where order_deadline > now() order by n limit 1;
$$;

-- symbols the team holds or will hold once pending orders of earlier months execute
create or replace function public.team_holds(p_team uuid, p_symbol text, p_before_month int)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when o.action = 'close' then false else true end
    from public.orders o
    where o.team_id = p_team and o.symbol = p_symbol and o.status = 'pending' and o.month_n < p_before_month
    order by o.month_n desc, o.created_at desc limit 1
  ), exists (
    select 1 from public.positions p where p.team_id = p_team and p.symbol = p_symbol and p.exit_date is null
  ));
$$;

create or replace function public.place_order(p_symbol text, p_action text, p_side text default null, p_quantity numeric default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_team uuid := public.my_team_id();
  v_month public.challenge_months;
  v_instr public.instruments;
  v_holds boolean;
  v_row public.orders;
begin
  if v_team is null then raise exception 'You are not a member of any team'; end if;
  select * into v_month from public.open_order_month();
  if v_month.n is null then raise exception 'The order window is closed'; end if;
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

  v_holds := public.team_holds(v_team, p_symbol, v_month.n);
  if p_action = 'open' and v_holds then
    raise exception 'You already hold % : use Change to modify the quantity or side', p_symbol;
  end if;
  if p_action in ('close', 'change') and not v_holds then
    raise exception 'You do not hold %', p_symbol;
  end if;
  -- one pending order per symbol per month: a new one replaces (cancels) the previous one
  update public.orders set status = 'cancelled', reject_reason = 'replaced by a newer order', updated_at = now()
  where team_id = v_team and symbol = p_symbol and month_n = v_month.n and status = 'pending';

  insert into public.orders (team_id, month_n, symbol, action, side, target_quantity, created_by)
  values (v_team, v_month.n, p_symbol, p_action, p_side, p_quantity, auth.uid())
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.cancel_order(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders o set status = 'cancelled', updated_at = now()
  where o.id = p_id and o.team_id = public.my_team_id() and o.status = 'pending'
    and (select order_deadline from public.challenge_months m where m.n = o.month_n) > now();
  if not found then raise exception 'Order not found or no longer editable'; end if;
end $$;

create or replace function public.place_transfer(p_currency text, p_eur_amount numeric)
returns public.transfer_orders language plpgsql security definer set search_path = public as $$
declare
  v_team uuid := public.my_team_id();
  v_month public.challenge_months;
  v_row public.transfer_orders;
begin
  if v_team is null then raise exception 'You are not a member of any team'; end if;
  select * into v_month from public.open_order_month();
  if v_month.n is null then raise exception 'The order window is closed'; end if;
  p_currency := upper(trim(p_currency));
  if p_currency !~ '^[A-Z]{3}$' or p_currency = 'EUR' then raise exception 'Invalid currency'; end if;
  if p_eur_amount is null or p_eur_amount = 0 then raise exception 'Amount must be different from zero'; end if;
  insert into public.transfer_orders (team_id, month_n, currency, eur_amount, created_by)
  values (v_team, v_month.n, p_currency, p_eur_amount, auth.uid()) returning * into v_row;
  return v_row;
end $$;

create or replace function public.cancel_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.transfer_orders t set status = 'cancelled'
  where t.id = p_id and t.team_id = public.my_team_id() and t.status = 'pending'
    and (select order_deadline from public.challenge_months m where m.n = t.month_n) > now();
  if not found then raise exception 'Transfer not found or no longer editable'; end if;
end $$;

-- =====================================================================
-- 9. Engine functions (service role only)
-- =====================================================================
create or replace function public.engine_input()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) from public.challenge_settings s where id = 1),
    'months', (select coalesce(jsonb_agg(to_jsonb(m) order by m.n), '[]') from public.challenge_months m),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'competition', t.competition, 'violations', t.violations)), '[]') from public.teams t),
    'instruments', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.instruments i),
    'orders', (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.orders o
               where o.status <> 'cancelled' and coalesce(o.reject_source, '') <> 'admin'),
    'transfers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.transfer_orders x
                  where x.status <> 'cancelled' and coalesce(x.reject_source, '') <> 'admin'),
    'prices', (select coalesce(jsonb_agg(jsonb_build_array(p.symbol, p.date, p.close, p.source)), '[]') from public.prices p),
    'events', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.corporate_events e),
    'fx', (select coalesce(jsonb_agg(jsonb_build_array(f.currency, f.date, f.rate, f.source)), '[]') from public.fx_rates f),
    'last_yahoo', (select coalesce(jsonb_object_agg(symbol, d), '{}') from (select symbol, max(date) d from public.prices where source = 'yahoo' group by symbol) q),
    'last_ecb', (select coalesce(jsonb_object_agg(currency, d), '{}') from (select currency, max(date) d from public.fx_rates where source = 'ecb' group by currency) q)
  );
$$;

create or replace function public.upsert_market_data(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_p int; n_e int; n_f int;
begin
  insert into public.prices (symbol, date, close, source, updated_at)
  select x->>0, (x->>1)::date, (x->>2)::numeric, 'yahoo', now() from jsonb_array_elements(coalesce(p->'prices', '[]')) x
  on conflict (symbol, date, source) do update set close = excluded.close, updated_at = now();
  get diagnostics n_p = row_count;
  insert into public.corporate_events (symbol, date, type, value, source)
  select x->>0, (x->>1)::date, x->>2, (x->>3)::numeric, 'yahoo' from jsonb_array_elements(coalesce(p->'events', '[]')) x
  on conflict (symbol, date, type, source) do update set value = excluded.value;
  get diagnostics n_e = row_count;
  insert into public.fx_rates (currency, date, rate, source)
  select x->>0, (x->>1)::date, (x->>2)::numeric, 'ecb' from jsonb_array_elements(coalesce(p->'fx', '[]')) x
  on conflict (currency, date, source) do update set rate = excluded.rate;
  get diagnostics n_f = row_count;
  return jsonb_build_object('prices', n_p, 'events', n_e, 'fx', n_f);
end $$;

create or replace function public.engine_log(p_status text, p_as_of date, p_trigger text, p_log text, p_warnings jsonb)
returns bigint language sql security definer set search_path = public as $$
  insert into public.engine_runs (started_at, finished_at, status, as_of, trigger, log, warnings)
  values (now(), now(), p_status, p_as_of, p_trigger, p_log, coalesce(p_warnings, '[]')) returning id;
$$;

-- replaces every derived table in ONE transaction
create or replace function public.engine_write(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.positions where true;
  insert into public.positions (team_id, symbol, currency, side, quantity, entry_date, entry_price, exit_date, exit_price,
    exit_reason, open_month, close_month, order_id, last_price, value_local, value_eur, pnl_local, pnl_eur)
  select (x->>'teamId')::uuid, x->>'symbol', x->>'currency', x->>'side', (x->>'quantity')::numeric, (x->>'entryDate')::date,
    (x->>'entryPrice')::numeric, (x->>'exitDate')::date, (x->>'exitPrice')::numeric, x->>'exitReason', (x->>'openMonth')::int,
    (x->>'closeMonth')::int, (x->>'orderId')::uuid, (x->>'lastPrice')::numeric, (x->>'valueLocal')::numeric,
    (x->>'valueEur')::numeric, (x->>'pnlLocal')::numeric, (x->>'pnlEur')::numeric
  from jsonb_array_elements(p->'positions') x;

  delete from public.cash_ledger where true;
  insert into public.cash_ledger (team_id, date, currency, amount, kind, ref)
  select (x->>'teamId')::uuid, (x->>'date')::date, x->>'currency', (x->>'amount')::numeric, x->>'kind', x->>'ref'
  from jsonb_array_elements(p->'ledger') x;

  delete from public.nav_daily where true;
  insert into public.nav_daily select (x->>'teamId')::uuid, (x->>'date')::date, (x->>'navEur')::numeric
  from jsonb_array_elements(p->'navDaily') x;

  delete from public.benchmark_daily where true;
  insert into public.benchmark_daily select (x->>'date')::date, (x->>'valueEur')::numeric
  from jsonb_array_elements(p->'benchmarkDaily') x;

  delete from public.nav_monthly where true;
  insert into public.nav_monthly select (x->>'teamId')::uuid, (x->>'monthN')::int, (x->>'valuationDate')::date, (x->>'navEur')::numeric
  from jsonb_array_elements(p->'navMonthly') x;

  delete from public.benchmark_monthly where true;
  insert into public.benchmark_monthly select (x->>'monthN')::int, (x->>'valuationDate')::date, (x->>'valueEur')::numeric
  from jsonb_array_elements(p->'benchmarkMonthly') x;

  delete from public.subportfolios where true;
  insert into public.subportfolios select (x->>'teamId')::uuid, (x->>'asOf')::date, x->>'currency', (x->>'cashLocal')::numeric,
    (x->>'positionsValueLocal')::numeric, (x->>'totalLocal')::numeric, (x->>'fxRate')::numeric, (x->>'totalEur')::numeric
  from jsonb_array_elements(p->'subportfolios') x;

  delete from public.metrics where true;
  insert into public.metrics select (x->>'teamId')::uuid, (x->>'asOf')::date, (x->>'monthsCompleted')::int, (x->>'nav')::numeric,
    (x->>'totalReturn')::numeric, (x->>'rankInCompetition')::int, (x->>'benchmarkReturn')::numeric, (x->>'excessReturn')::numeric,
    (x->>'volatility')::numeric, (x->>'sharpe')::numeric, (x->>'sortino')::numeric, (x->>'beta')::numeric,
    (x->>'trackingError')::numeric, (x->>'maxDrawdown')::numeric, (x->>'calmar')::numeric, (x->>'operations')::int,
    (x->>'maxWeight')::numeric, (x->>'hhi')::numeric, coalesce(x->'currencyExposure', '{}'), (x->>'violations')::int
  from jsonb_array_elements(p->'metrics') x;

  -- order and transfer status (never touches cancelled or admin-rejected rows)
  update public.orders o set
    status = u->>'status',
    executed_date = (u->>'executedDate')::date,
    executed_price = (u->>'executedPrice')::numeric,
    reject_reason = u->>'rejectReason',
    reject_source = case when u->>'status' = 'rejected' then 'engine' else null end,
    updated_at = now()
  from jsonb_array_elements(p->'orderUpdates') u
  where o.id = (u->>'id')::uuid and o.status <> 'cancelled' and coalesce(o.reject_source, '') <> 'admin';

  update public.transfer_orders t set
    status = u->>'status',
    executed_date = (u->>'executedDate')::date,
    rate = (u->>'rate')::numeric,
    reject_reason = u->>'rejectReason',
    reject_source = case when u->>'status' = 'rejected' then 'engine' else null end
  from jsonb_array_elements(p->'transferUpdates') u
  where t.id = (u->>'id')::uuid and t.status <> 'cancelled' and coalesce(t.reject_source, '') <> 'admin';
end $$;

-- admin helper used by the admin edge function
create or replace function public.link_team_user(p_user uuid, p_team uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.user_roles (user_id, role) values (p_user, 'team') on conflict do nothing;
  insert into public.team_members (user_id, team_id) values (p_user, p_team) on conflict do nothing;
$$;

-- =====================================================================
-- 10. Function privileges
-- =====================================================================
revoke execute on function public.engine_input() from public, anon, authenticated;
revoke execute on function public.upsert_market_data(jsonb) from public, anon, authenticated;
revoke execute on function public.engine_write(jsonb) from public, anon, authenticated;
revoke execute on function public.engine_log(text, date, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.link_team_user(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.team_holds(uuid, text, int) from public, anon, authenticated;
grant execute on function public.engine_input() to service_role;
grant execute on function public.upsert_market_data(jsonb) to service_role;
grant execute on function public.engine_write(jsonb) to service_role;
grant execute on function public.engine_log(text, date, text, text, jsonb) to service_role;
grant execute on function public.link_team_user(uuid, uuid) to service_role;
grant execute on function public.team_holds(uuid, text, int) to service_role;

revoke execute on function public.place_order(text, text, text, numeric) from public, anon;
revoke execute on function public.cancel_order(uuid) from public, anon;
revoke execute on function public.place_transfer(text, numeric) from public, anon;
revoke execute on function public.cancel_transfer(uuid) from public, anon;
grant execute on function public.place_order(text, text, text, numeric) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.place_transfer(text, numeric) to authenticated;
grant execute on function public.cancel_transfer(uuid) to authenticated;
