-- Each member can hold at most N different stocks at a time (positions they opened, plus their
-- pending "open" orders). In Competition A the president chooses N between 1 and 10 ("no
-- limit" means 10); in Competition B it is always 10. Teams have no limit on the number of members.

alter table public.teams add column if not exists member_stock_limit int;
alter table public.teams add constraint teams_member_stock_limit_check check (member_stock_limit is null or member_stock_limit between 1 and 10);

create or replace function public.stock_limit_of(p_team uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when t.competition = 'B' then 10 else least(coalesce(t.member_stock_limit, 10), 10) end
  from public.teams t where t.id = p_team;
$$;

-- different stocks held by a member of a team: open positions they opened or resized, plus
-- their pending "open" orders on other stocks
create or replace function public.member_stock_count(p_team uuid, p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct s)::int from (
    select p.symbol as s from public.positions p join public.orders o on o.id = p.order_id
    where p.team_id = p_team and p.exit_date is null and o.created_by = p_user
    union
    select o.symbol from public.orders o
    where o.team_id = p_team and o.created_by = p_user and o.status = 'pending' and o.action = 'open'
  ) x;
$$;

-- the caller's usage in one of their teams
create or replace function public.my_stock_usage(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.team_members where user_id = auth.uid() and team_id = p_team)
    then jsonb_build_object('used', public.member_stock_count(p_team, auth.uid()), 'limit', public.stock_limit_of(p_team),
                            'chosen', (select member_stock_limit from public.teams where id = p_team))
  end;
$$;
revoke execute on function public.my_stock_usage(uuid) from public, anon;
grant execute on function public.my_stock_usage(uuid) to authenticated;

-- the president (Competition A) or the organiser sets the limit; null = no limit (10)
create or replace function public.set_stock_limit(p_team uuid, p_limit int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (
      select 1 from public.team_members m join public.teams t on t.id = m.team_id
      where m.user_id = auth.uid() and m.team_id = p_team and m.role = 'president' and t.competition = 'A')) then
    raise exception 'Only the president of the team can change this';
  end if;
  if p_limit is not null and (p_limit < 1 or p_limit > 10) then raise exception 'Choose between 1 and 10'; end if;
  update public.teams set member_stock_limit = p_limit where id = p_team;
end $$;
revoke execute on function public.set_stock_limit(uuid, int) from public, anon;
grant execute on function public.set_stock_limit(uuid, int) to authenticated;

-- order checks: the limit applies to members opening a new stock (not to the organiser)
create or replace function public.place_order_for(v_team uuid, p_symbol text, p_action text, p_side text, p_quantity numeric)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_instr public.instruments;
  v_t record;
  v_end date := (select end_date from public.challenge_settings where id = 1);
  v_holds boolean;
  v_row public.orders;
  v_limit int; v_used int;
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

  update public.orders set status = 'cancelled', reject_reason = 'replaced by a newer order', updated_at = now()
  where team_id = v_team and symbol = p_symbol and status = 'pending' and cutoff_at > now();

  v_holds := public.team_holds_now(v_team, p_symbol);
  if p_action = 'open' and v_holds then
    raise exception 'The team already holds % : change the quantity or close the position', p_symbol;
  end if;
  if p_action in ('close', 'change') and not v_holds then
    raise exception 'The team does not hold %', p_symbol;
  end if;

  if p_action = 'open' and not public.is_admin() then
    v_limit := public.stock_limit_of(v_team);
    v_used := public.member_stock_count(v_team, auth.uid());
    if v_used >= v_limit then
      raise exception 'You already hold % different stocks: the limit is % per member. Close one first.', v_used, v_limit;
    end if;
  end if;

  insert into public.orders (team_id, month_n, symbol, action, side, target_quantity, created_by, exec_date, cutoff_at)
  values (v_team, public.month_of(v_t.exec_date), p_symbol, p_action, p_side, p_quantity, auth.uid(), v_t.exec_date, v_t.cutoff_at)
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.place_order_for(uuid, text, text, text, numeric) from public, anon, authenticated;
