-- 1. Each member manages only their own positions and orders: only the member who opened a
--    position can change it, close it or set its stop loss (the organiser can act on everything;
--    positions opened by the organiser for a team are managed by its president).
-- 2. The president can switch the per-member budget split off: then only the team limit applies
--    (the team cannot invest more than its value). On by default.
-- 3. Stop loss: a member sets a stop price on their position; from the next close, if the stock
--    closes at or beyond the stop (long: at or below, short: at or above), the engine closes the
--    position at that close.

alter table public.teams add column if not exists budget_split boolean not null default true;

-- ---------------------------------------------------------------- ownership helpers
-- who holds a stock of the team: the author of the latest pending open/change order, else the
-- author of the order that opened the open position
create or replace function public.position_owner(p_team uuid, p_symbol text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.created_by from public.orders o
     where o.team_id = p_team and o.symbol = p_symbol and o.status = 'pending' and o.action in ('open', 'change')
     order by o.created_at desc limit 1),
    (select o.created_by from public.positions p join public.orders o on o.id = p.order_id
     where p.team_id = p_team and p.symbol = p_symbol and p.exit_date is null limit 1));
$$;

create or replace function public.member_label(p_team uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then 'another member'
    when exists (select 1 from public.user_roles where user_id = p_user and role = 'admin') then 'the organiser'
    else coalesce((select nullif(full_name, '') from public.team_members where team_id = p_team and user_id = p_user limit 1), 'another member') end;
$$;

-- may p_user manage (change, close, stop loss) the team's position on p_symbol?
create or replace function public.can_manage_position(p_team uuid, p_symbol text, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with o as (select public.position_owner(p_team, p_symbol) as owner)
  select (select owner from o) is null
      or (select owner from o) = p_user
      or (exists (select 1 from public.user_roles where user_id = (select owner from o) and role = 'admin')
          and exists (select 1 from public.team_members where team_id = p_team and user_id = p_user and role = 'president'));
$$;
revoke execute on function public.position_owner(uuid, text) from public, anon, authenticated;
revoke execute on function public.member_label(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_position(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- budget split switch
create or replace function public.set_budget_split(p_team uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (
      select 1 from public.team_members where user_id = auth.uid() and team_id = p_team and role = 'president')) then
    raise exception 'Only the president of the team can change this';
  end if;
  update public.teams set budget_split = coalesce(p_on, true) where id = p_team;
end $$;
revoke execute on function public.set_budget_split(uuid, boolean) from public, anon;
grant execute on function public.set_budget_split(uuid, boolean) to authenticated;

create or replace function public.my_budget(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with t as (
    select public.team_value_eur(p_team) as nav, greatest(1, (select count(*) from public.team_members where team_id = p_team)) as n,
           coalesce((select budget_split from public.teams where id = p_team), true) as split
  )
  select case when exists (select 1 from public.team_members where user_id = auth.uid() and team_id = p_team) then
    jsonb_build_object(
      'used', round(public.exposure_eur(p_team, auth.uid()), 2),
      'limit', round((select case when split then nav / n else nav end from t), 2),
      'nav', round((select nav from t), 2),
      'members', (select n from t),
      'split', (select split from t),
      'teamUsed', round(public.exposure_eur(p_team, null), 2))
  end;
$$;

-- ---------------------------------------------------------------- orders
create or replace function public.place_order_for(v_team uuid, p_symbol text, p_action text, p_side text, p_quantity numeric)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_instr public.instruments;
  v_t record;
  v_end date := (select end_date from public.challenge_settings where id = 1);
  v_holds boolean;
  v_row public.orders;
  v_limit int; v_used int;
  v_nav numeric; v_n int; v_new numeric; v_after numeric; v_before_me numeric; v_before_team numeric;
  v_admin boolean := public.is_admin();
  v_other uuid;
  v_split boolean;
begin
  if v_team is null then raise exception 'You are not a member of any team'; end if;
  select * into v_instr from public.instruments where symbol = p_symbol;
  if v_instr.symbol is null then raise exception 'Unknown instrument %: search and select it first', p_symbol; end if;
  if v_instr.quote_type <> 'EQUITY' then raise exception 'Only listed stocks are allowed'; end if;
  if p_action not in ('open', 'close', 'change') then raise exception 'Invalid action'; end if;
  if p_action in ('open', 'change') then
    if p_side not in ('long', 'short') then raise exception 'Choose Buy (long) or Sell short'; end if;
    if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity) then
      raise exception 'Quantity must be a positive whole number of shares';
    end if;
  else
    p_side := null; p_quantity := null;
  end if;
  select * into v_t from public.order_timing(p_symbol);
  if v_t.exec_date > v_end then raise exception 'The challenge is over: no more orders can be placed'; end if;

  if not v_admin then
    -- each member manages only their own positions and orders
    select o.created_by into v_other from public.orders o
    where o.team_id = v_team and o.symbol = p_symbol and o.status = 'pending' and o.cutoff_at > now()
      and o.created_by is distinct from auth.uid()
    order by o.created_at desc limit 1;
    if found then
      raise exception '% already has an order pending on %: each member manages only their own positions.', public.member_label(v_team, v_other), p_symbol;
    end if;
    if p_action in ('close', 'change') and not public.can_manage_position(v_team, p_symbol, auth.uid()) then
      raise exception 'The position on % belongs to %: each member can change or close only their own positions.',
        p_symbol, public.member_label(v_team, public.position_owner(v_team, p_symbol));
    end if;
  end if;

  -- amounts invested before this order (including the pending order it may replace)
  v_before_me := public.exposure_eur(v_team, auth.uid());
  v_before_team := public.exposure_eur(v_team, null);

  update public.orders set status = 'cancelled', reject_reason = 'replaced by a newer order', updated_at = now()
  where team_id = v_team and symbol = p_symbol and status = 'pending' and cutoff_at > now();

  v_holds := public.team_holds_now(v_team, p_symbol);
  if p_action = 'open' and v_holds then
    if not v_admin and public.position_owner(v_team, p_symbol) is distinct from auth.uid() then
      raise exception 'The team already holds % (opened by %): each member manages only their own positions.', p_symbol, public.member_label(v_team, public.position_owner(v_team, p_symbol));
    end if;
    raise exception 'You already hold % : change the quantity or close the position', p_symbol;
  end if;
  if p_action in ('close', 'change') and not v_holds then
    raise exception 'The team does not hold %', p_symbol;
  end if;

  if not v_admin then
    if p_action = 'open' then
      v_limit := public.stock_limit_of(v_team);
      v_used := public.member_stock_count(v_team, auth.uid());
      if v_used >= v_limit then
        raise exception 'You already hold % different stocks: the limit is % per member. Close one first.', v_used, v_limit;
      end if;
    end if;

    -- budget: an order may not take the member (when the budget is split) or the team above the
    -- limit, unless it reduces the amount already invested
    if p_action in ('open', 'change') then
      v_new := public.order_value_eur(p_symbol, p_quantity);
      if v_new is null then
        raise exception 'No price or exchange rate available yet for %: try again in a few minutes', p_symbol;
      end if;
      v_nav := public.team_value_eur(v_team);
      v_n := greatest(1, (select count(*) from public.team_members where team_id = v_team));
      v_split := coalesce((select budget_split from public.teams where id = v_team), true);
      if v_split then
        v_after := public.exposure_eur(v_team, auth.uid(), p_symbol) + v_new;
        if v_after > v_nav / v_n + 0.01 and v_after > v_before_me + 0.01 then
          raise exception 'Over budget: with this order you would have € % invested, but your budget is € % (team value € % / % members). Lower the quantity or reduce another position first.',
            to_char(round(v_after), 'FM999,999,999,999'), to_char(floor(v_nav / v_n), 'FM999,999,999,999'),
            to_char(round(v_nav), 'FM999,999,999,999'), v_n;
        end if;
      end if;
      v_after := public.exposure_eur(v_team, null, p_symbol) + v_new;
      if v_after > v_nav + 0.01 and v_after > v_before_team + 0.01 then
        raise exception 'Over budget: the team would have € % invested, more than its value of € %. Lower the quantity or reduce another position first.',
          to_char(round(v_after), 'FM999,999,999,999'), to_char(round(v_nav), 'FM999,999,999,999');
      end if;
    end if;
  end if;

  insert into public.orders (team_id, month_n, symbol, action, side, target_quantity, created_by, exec_date, cutoff_at)
  values (v_team, public.month_of(v_t.exec_date), p_symbol, p_action, p_side, p_quantity, auth.uid(), v_t.exec_date, v_t.cutoff_at)
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.place_order_for(uuid, text, text, text, numeric) from public, anon, authenticated;

-- a member cancels only their own pending orders
create or replace function public.cancel_order(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_by uuid; v_team uuid;
begin
  select created_by, team_id into v_by, v_team from public.orders o
  where o.id = p_id and o.team_id in (select public.my_team_ids());
  if v_team is not null and v_by is distinct from auth.uid() then
    raise exception 'This order was placed by %: each member can cancel only their own orders.', public.member_label(v_team, v_by);
  end if;
  update public.orders o set status = 'cancelled', updated_at = now()
  where o.id = p_id and o.team_id in (select public.my_team_ids()) and o.created_by = auth.uid()
    and o.status = 'pending' and o.cutoff_at > now();
  if not found then raise exception 'Order not found or already locked: the market has closed'; end if;
end $$;

-- ---------------------------------------------------------------- stop loss
create table if not exists public.stop_losses (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  symbol text not null,
  stop_price numeric check (stop_price is null or stop_price > 0),
  exec_date date not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists stop_losses_team_symbol on public.stop_losses (team_id, symbol, created_at desc);
alter table public.stop_losses enable row level security;
create policy stop_losses_read on public.stop_losses for select to authenticated using (team_id in (select public.my_team_ids()) or public.is_admin());
grant select on public.stop_losses to authenticated;

-- side of the team's holding on a stock: the latest pending open/change order, else the open position
create or replace function public.holding_side(p_team uuid, p_symbol text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.side from public.orders o
     where o.team_id = p_team and o.symbol = p_symbol and o.status = 'pending' and o.action in ('open', 'change')
     order by o.created_at desc limit 1),
    (select p.side from public.positions p where p.team_id = p_team and p.symbol = p_symbol and p.exit_date is null limit 1));
$$;
revoke execute on function public.holding_side(uuid, text) from public, anon, authenticated;

-- set (or, with p_price null, remove) the stop loss on one of the caller's positions
create or replace function public.set_stop_loss(p_team uuid, p_symbol text, p_price numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.is_admin();
  v_side text; v_last numeric; v_t record;
  v_end date := (select end_date from public.challenge_settings where id = 1);
begin
  if not v_admin and not exists (select 1 from public.team_members where user_id = auth.uid() and team_id = p_team) then
    raise exception 'You are not a member of this team';
  end if;
  if not public.team_holds_now(p_team, p_symbol) then raise exception 'The team does not hold %', p_symbol; end if;
  if not v_admin and not public.can_manage_position(p_team, p_symbol, auth.uid()) then
    raise exception 'The position on % belongs to %: each member can set a stop loss only on their own positions.',
      p_symbol, public.member_label(p_team, public.position_owner(p_team, p_symbol));
  end if;
  if p_price is not null then
    if p_price <= 0 then raise exception 'Enter a stop price above zero'; end if;
    v_side := public.holding_side(p_team, p_symbol);
    v_last := public.last_px(p_symbol);
    if v_last is not null and v_side = 'long' and p_price >= v_last then
      raise exception 'For a long position the stop loss must be below the last price (%)', round(v_last, 4)::float8;
    end if;
    if v_last is not null and v_side = 'short' and p_price <= v_last then
      raise exception 'For a short position the stop loss must be above the last price (%)', round(v_last, 4)::float8;
    end if;
  end if;
  select * into v_t from public.order_timing(p_symbol);
  if v_t.exec_date > v_end then raise exception 'The challenge is over'; end if;
  insert into public.stop_losses (team_id, symbol, stop_price, exec_date, created_by)
  values (p_team, p_symbol, round(p_price, 6), v_t.exec_date, auth.uid());
  return jsonb_build_object('symbol', p_symbol, 'stop', p_price, 'from', v_t.exec_date);
end $$;
revoke execute on function public.set_stop_loss(uuid, text, numeric) from public, anon;
grant execute on function public.set_stop_loss(uuid, text, numeric) to authenticated;

-- stop losses currently set on the team's holdings (the latest one since the position was opened)
create or replace function public.team_stops(p_team uuid)
returns table (symbol text, stop_price numeric, exec_date date, set_by text, set_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.symbol, s.stop_price, s.exec_date, public.member_label(p_team, s.created_by), s.created_at
  from (
    select distinct on (x.symbol) x.* from public.stop_losses x
    where x.team_id = p_team
      and x.created_at >= coalesce((select max(o.created_at) from public.orders o
                                    where o.team_id = p_team and o.symbol = x.symbol and o.action = 'open' and o.status in ('pending', 'executed')), '-infinity')
    order by x.symbol, x.created_at desc
  ) s
  where s.stop_price is not null and public.team_holds_now(p_team, s.symbol)
    and (public.is_admin() or exists (select 1 from public.team_members where user_id = auth.uid() and team_id = p_team));
$$;
revoke execute on function public.team_stops(uuid) from public, anon;
grant execute on function public.team_stops(uuid) to authenticated;

-- the engine reads the stop losses
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
    'stops', (select coalesce(jsonb_agg(jsonb_build_object('team_id', s.team_id, 'symbol', s.symbol, 'stop_price', s.stop_price,
                                                            'exec_date', s.exec_date, 'created_at', s.created_at)), '[]') from public.stop_losses s),
    'last_yahoo', (select coalesce(jsonb_object_agg(symbol, d), '{}') from (select symbol, max(date) d from public.prices where source = 'yahoo' group by symbol) q),
    'last_ecb', (select coalesce(jsonb_object_agg(currency, d), '{}') from (select currency, max(date) d from public.fx_rates where source = 'ecb' group by currency) q)
  );
$$;
revoke execute on function public.engine_input() from public, anon, authenticated;
grant execute on function public.engine_input() to service_role;

-- who holds each stock of the team and who placed each pending order, for the team page
create or replace function public.team_ownership(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin() or exists (select 1 from public.team_members where user_id = auth.uid() and team_id = p_team) then
    jsonb_build_object(
      'holdings', (select coalesce(jsonb_agg(jsonb_build_object(
          'symbol', s.symbol,
          'by', public.member_label(p_team, public.position_owner(p_team, s.symbol)),
          'mine', public.is_admin() or public.can_manage_position(p_team, s.symbol, auth.uid()))), '[]')
        from (select distinct symbol from public.positions where team_id = p_team and exit_date is null
              union select distinct symbol from public.orders where team_id = p_team and status = 'pending') s),
      'orders', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'by', public.member_label(p_team, o.created_by), 'mine', public.is_admin() or o.created_by = auth.uid())), '[]')
        from public.orders o where o.team_id = p_team and o.status = 'pending'),
      'split', (select budget_split from public.teams where id = p_team))
  end;
$$;
revoke execute on function public.team_ownership(uuid) from public, anon;
grant execute on function public.team_ownership(uuid) to authenticated;
