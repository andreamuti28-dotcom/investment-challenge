-- 1. Practice period: orders can be executed from practice_start_date; at the official start
--    the engine carries the open positions into the challenge at the start's closing prices.
-- 2. Budget per member: the amount invested by each member (long + short, in euro) cannot
--    exceed the team value divided by the number of members, and the team as a whole cannot
--    invest more than its value (no leverage). Orders that reduce the amount are always allowed.

alter table public.challenge_settings add column if not exists practice_start_date date;
alter table public.instruments add column if not exists last_price numeric;
alter table public.instruments add column if not exists last_price_at timestamptz;

-- first day on which orders are executed: the practice start if set before the start
create or replace function public.first_trading_date()
returns date language sql stable security definer set search_path = public as $$
  select case when practice_start_date is not null and practice_start_date < start_date then practice_start_date else start_date end
  from public.challenge_settings where id = 1;
$$;

create or replace function public.next_close(p_at timestamptz, p_tz text, p_close time)
returns table (exec_date date, cutoff_at timestamptz) language plpgsql stable set search_path = public as $$
declare
  v_local timestamp := p_at at time zone p_tz;
  v_d date := v_local::date;
  v_start date := public.first_trading_date();
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

-- ---------------------------------------------------------------- valuation helpers
-- latest known price of a stock in its currency: last close (manual first), else the live price
-- saved when the stock was selected
create or replace function public.last_px(p_symbol text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select close from public.prices where symbol = p_symbol order by date desc, (source = 'manual') desc limit 1),
    (select last_price from public.instruments where symbol = p_symbol));
$$;

-- latest ECB (or manual) rate: units of currency per euro
create or replace function public.fx_now(p_ccy text)
returns numeric language sql stable security definer set search_path = public as $$
  select case when upper(p_ccy) = 'EUR' then 1::numeric
    else (select rate from public.fx_rates where currency = upper(p_ccy) order by date desc, (source = 'manual') desc limit 1) end;
$$;

-- euro value of p_qty shares (absolute)
create or replace function public.order_value_eur(p_symbol text, p_qty numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select abs(p_qty) * public.last_px(p_symbol) / public.fx_now((select currency from public.instruments where symbol = p_symbol));
$$;

-- amount invested (long + short, euro) by one member (p_user) or by the whole team (p_user null):
-- open positions at their last valuation plus pending orders that open or resize a position,
-- leaving out one stock (the one being traded)
create or replace function public.exposure_eur(p_team uuid, p_user uuid, p_exclude text default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(v), 0) from (
    select abs(coalesce(p.value_eur, public.order_value_eur(p.symbol, p.quantity), 0)) as v
    from public.positions p left join public.orders o on o.id = p.order_id
    where p.team_id = p_team and p.exit_date is null and p.symbol is distinct from p_exclude
      and (p_user is null or o.created_by = p_user)
    union all
    select coalesce(public.order_value_eur(o.symbol, o.target_quantity), 0)
    from public.orders o
    where o.team_id = p_team and o.status = 'pending' and o.action in ('open', 'change')
      and o.symbol is distinct from p_exclude and (p_user is null or o.created_by = p_user)
  ) x;
$$;

create or replace function public.team_value_eur(p_team uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select nav from public.metrics where team_id = p_team), (select capital from public.challenge_settings where id = 1));
$$;

revoke execute on function public.first_trading_date() from public, anon, authenticated;
revoke execute on function public.last_px(text) from public, anon, authenticated;
revoke execute on function public.fx_now(text) from public, anon, authenticated;
revoke execute on function public.order_value_eur(text, numeric) from public, anon, authenticated;
revoke execute on function public.exposure_eur(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.team_value_eur(uuid) from public, anon, authenticated;

-- the caller's budget in one of their teams
create or replace function public.my_budget(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with t as (
    select public.team_value_eur(p_team) as nav, greatest(1, (select count(*) from public.team_members where team_id = p_team)) as n
  )
  select case when exists (select 1 from public.team_members where user_id = auth.uid() and team_id = p_team) then
    jsonb_build_object(
      'used', round(public.exposure_eur(p_team, auth.uid()), 2),
      'limit', round((select nav / n from t), 2),
      'nav', round((select nav from t), 2),
      'members', (select n from t),
      'teamUsed', round(public.exposure_eur(p_team, null), 2))
  end;
$$;
revoke execute on function public.my_budget(uuid) from public, anon;
grant execute on function public.my_budget(uuid) to authenticated;

-- ---------------------------------------------------------------- order checks
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

  -- amounts invested before this order (including the pending order it may replace)
  v_before_me := public.exposure_eur(v_team, auth.uid());
  v_before_team := public.exposure_eur(v_team, null);

  update public.orders set status = 'cancelled', reject_reason = 'replaced by a newer order', updated_at = now()
  where team_id = v_team and symbol = p_symbol and status = 'pending' and cutoff_at > now();

  v_holds := public.team_holds_now(v_team, p_symbol);
  if p_action = 'open' and v_holds then
    raise exception 'The team already holds % : change the quantity or close the position', p_symbol;
  end if;
  if p_action in ('close', 'change') and not v_holds then
    raise exception 'The team does not hold %', p_symbol;
  end if;

  if not public.is_admin() then
    if p_action = 'open' then
      v_limit := public.stock_limit_of(v_team);
      v_used := public.member_stock_count(v_team, auth.uid());
      if v_used >= v_limit then
        raise exception 'You already hold % different stocks: the limit is % per member. Close one first.', v_used, v_limit;
      end if;
    end if;

    -- budget: an order may not take the member (or the team) above the limit, unless it
    -- reduces the amount already invested
    if p_action in ('open', 'change') then
      v_new := public.order_value_eur(p_symbol, p_quantity);
      if v_new is null then
        raise exception 'No price or exchange rate available yet for %: try again in a few minutes', p_symbol;
      end if;
      v_nav := public.team_value_eur(v_team);
      v_n := greatest(1, (select count(*) from public.team_members where team_id = v_team));
      v_after := public.exposure_eur(v_team, auth.uid(), p_symbol) + v_new;
      if v_after > v_nav / v_n + 0.01 and v_after > v_before_me + 0.01 then
        raise exception 'Over budget: with this order you would have € % invested, but your budget is € % (team value € % / % members). Lower the quantity or reduce another position first.',
          to_char(round(v_after), 'FM999,999,999,999'), to_char(floor(v_nav / v_n), 'FM999,999,999,999'),
          to_char(round(v_nav), 'FM999,999,999,999'), v_n;
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
