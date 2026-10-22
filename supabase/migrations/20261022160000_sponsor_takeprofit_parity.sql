-- 1. Sponsor link editable in Admin > Calendar & settings.
-- 2. Take profit: like the stop loss, a member sets a target price on their position; from the
--    next close, if the stock closes at or beyond it (long: at or above, short: at or below), the
--    position is closed at that close.
-- 3. FX parity: the organiser can force every currency to 1:1 with the euro (valuation, budget).

alter table public.challenge_settings add column if not exists sponsor_url text default 'https://wefocusbuddy.com/v';
update public.challenge_settings set sponsor_url = 'https://wefocusbuddy.com/v' where id = 1;
alter table public.challenge_settings add column if not exists fx_parity boolean not null default false;

alter table public.stop_losses add column if not exists kind text not null default 'stop';
alter table public.stop_losses add constraint stop_losses_kind_check check (kind in ('stop', 'take'));

-- latest rate: 1 for every currency when the organiser forces parity
create or replace function public.fx_now(p_ccy text)
returns numeric language sql stable security definer set search_path = public as $$
  select case when upper(p_ccy) = 'EUR' or coalesce((select fx_parity from public.challenge_settings where id = 1), false) then 1::numeric
    else (select rate from public.fx_rates where currency = upper(p_ccy) order by date desc, (source = 'manual') desc limit 1) end;
$$;

-- set (or, with p_price null, remove) the take profit on one of the caller's positions
create or replace function public.set_take_profit(p_team uuid, p_symbol text, p_price numeric)
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
    raise exception 'The position on % belongs to %: each member can set a take profit only on their own positions.',
      p_symbol, public.member_label(p_team, public.position_owner(p_team, p_symbol));
  end if;
  if p_price is not null then
    if p_price <= 0 then raise exception 'Enter a take profit price above zero'; end if;
    v_side := public.holding_side(p_team, p_symbol);
    v_last := public.last_px(p_symbol);
    if v_last is not null and v_side = 'long' and p_price <= v_last then
      raise exception 'For a long position the take profit must be above the last price (%)', round(v_last, 4)::float8;
    end if;
    if v_last is not null and v_side = 'short' and p_price >= v_last then
      raise exception 'For a short position the take profit must be below the last price (%)', round(v_last, 4)::float8;
    end if;
  end if;
  select * into v_t from public.order_timing(p_symbol);
  if v_t.exec_date > v_end then raise exception 'The challenge is over'; end if;
  insert into public.stop_losses (team_id, symbol, stop_price, exec_date, created_by, kind)
  values (p_team, p_symbol, round(p_price, 6), v_t.exec_date, auth.uid(), 'take');
  return jsonb_build_object('symbol', p_symbol, 'takeProfit', p_price, 'from', v_t.exec_date);
end $$;
revoke execute on function public.set_take_profit(uuid, text, numeric) from public, anon;
grant execute on function public.set_take_profit(uuid, text, numeric) to authenticated;

-- stop losses and take profits currently set on the team's holdings
create or replace function public.team_exits(p_team uuid)
returns table (symbol text, kind text, price numeric, exec_date date, set_by text, set_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.symbol, s.kind, s.stop_price, s.exec_date, public.member_label(p_team, s.created_by), s.created_at
  from (
    select distinct on (x.symbol, x.kind) x.* from public.stop_losses x
    where x.team_id = p_team
      and x.created_at >= coalesce((select max(o.created_at) from public.orders o
                                    where o.team_id = p_team and o.symbol = x.symbol and o.action = 'open' and o.status in ('pending', 'executed')), '-infinity')
    order by x.symbol, x.kind, x.created_at desc
  ) s
  where s.stop_price is not null and public.team_holds_now(p_team, s.symbol)
    and (public.is_admin() or exists (select 1 from public.team_members where user_id = auth.uid() and team_id = p_team));
$$;
revoke execute on function public.team_exits(uuid) from public, anon;
grant execute on function public.team_exits(uuid) to authenticated;

-- team_stops keeps returning the stop losses only
create or replace function public.team_stops(p_team uuid)
returns table (symbol text, stop_price numeric, exec_date date, set_by text, set_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.symbol, e.price, e.exec_date, e.set_by, e.set_at from public.team_exits(p_team) e where e.kind = 'stop';
$$;

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
                                                            'exec_date', s.exec_date, 'created_at', s.created_at, 'kind', s.kind)), '[]') from public.stop_losses s),
    'last_yahoo', (select coalesce(jsonb_object_agg(symbol, d), '{}') from (select symbol, max(date) d from public.prices where source = 'yahoo' group by symbol) q),
    'last_ecb', (select coalesce(jsonb_object_agg(currency, d), '{}') from (select currency, max(date) d from public.fx_rates where source = 'ecb' group by currency) q)
  );
$$;
revoke execute on function public.engine_input() from public, anon, authenticated;
grant execute on function public.engine_input() to service_role;
