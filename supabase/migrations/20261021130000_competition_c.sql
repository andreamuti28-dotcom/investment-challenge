-- Competition C: individual portfolios. Each participant can open one personal portfolio of the
-- full capital (a team of one), with no limit on the number of stocks and the usual budget (no
-- leverage). A portfolio is ranked only when at least half of its value is invested.
-- Members can copy into C the stocks they chose in their A and B teams.

alter table public.teams drop constraint if exists teams_competition_check;
alter table public.teams add constraint teams_competition_check check (competition in ('A', 'B', 'C'));

-- share of the value invested (long + short), written by the engine
alter table public.metrics add column if not exists invested_share numeric;
do $do$
declare d text; n text;
begin
  select pg_get_functiondef('public.engine_write(jsonb)'::regprocedure) into d;
  if position('investedShare' in d) = 0 then
    n := regexp_replace(d, $r$\(x->>'violations'\)::int(\s+from jsonb_array_elements\(p->'metrics'\))$r$,
                        $s$(x->>'violations')::int, (x->>'investedShare')::numeric\1$s$);
    if n = d then raise exception 'engine_write: metrics insert not found'; end if;
    execute n;
  end if;
end $do$;

create or replace view public.leaderboard with (security_invoker = true) as
  select t.id as team_id, t.name, t.competition, t.university,
    m.as_of, m.months_completed, m.nav, m.total_return, m.rank_in_competition, m.benchmark_return, m.excess_return,
    m.volatility, m.sharpe, m.sortino, m.beta, m.tracking_error, m.max_drawdown, m.calmar, m.operations,
    m.max_weight, m.hhi, m.currency_exposure, coalesce(m.violations, t.violations) as violations, m.invested_share
  from public.teams t left join public.metrics m on m.team_id = t.id;

-- no limit on the number of stocks in Competition C
create or replace function public.stock_limit_of(p_team uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when t.competition = 'B' then 10 when t.competition = 'C' then 1000
    else least(coalesce(t.member_stock_limit, 10), 10) end
  from public.teams t where t.id = p_team;
$$;

-- the caller opens their personal portfolio
create or replace function public.join_competition_c()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text; v_assoc text; v_try text; v_team uuid; i int := 1;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if public.is_admin() then raise exception 'Organisers do not take part in the competitions'; end if;
  if exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = v_uid and t.competition = 'C') then
    raise exception 'You already have your individual portfolio';
  end if;
  select coalesce(
      (select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') from public.profiles p where p.user_id = v_uid),
      (select nullif(trim(raw_user_meta_data->>'full_name'), '') from auth.users where id = v_uid),
      (select split_part(email, '@', 1) from auth.users where id = v_uid))
    into v_name;
  select t.university into v_assoc from public.team_members m join public.teams t on t.id = m.team_id
  where m.user_id = v_uid and t.competition = 'A' limit 1;
  v_try := v_name;
  while exists (select 1 from public.teams where lower(name) = lower(v_try)) loop
    i := i + 1;
    v_try := v_name || ' (' || i || ')';
  end loop;
  insert into public.teams (name, competition, university) values (v_try, 'C', coalesce(v_assoc, 'Individual')) returning id into v_team;
  perform public.join_team(v_uid, v_team, 'member', v_name);
  -- value the new portfolio right away (at most one extra run every two minutes)
  begin
    if not exists (select 1 from public.engine_runs where started_at > now() - interval '2 minutes') then
      perform public.call_engine();
    end if;
  exception when others then null;
  end;
  return jsonb_build_object('teamId', v_team, 'name', v_try);
end $$;
revoke execute on function public.join_competition_c() from public, anon;
grant execute on function public.join_competition_c() to authenticated;

-- the stocks a member chose in a team: open positions they opened or resized, overridden by
-- their pending orders that open or resize a stock
create or replace function public.member_picks(p_team uuid, p_user uuid)
returns table (symbol text, side text, qty numeric) language sql stable security definer set search_path = public as $$
  select distinct on (s.symbol) s.symbol, s.side, s.qty from (
    select o.symbol, o.side, o.target_quantity as qty, 1 as pri, o.created_at as at
    from public.orders o
    where o.team_id = p_team and o.created_by = p_user and o.status = 'pending' and o.action in ('open', 'change')
    union all
    select p.symbol, p.side, p.quantity, 2, p.entry_date::timestamptz
    from public.positions p join public.orders o on o.id = p.order_id
    where p.team_id = p_team and p.exit_date is null and o.created_by = p_user
  ) s
  where s.qty > 0
  order by s.symbol, s.pri, s.at desc;
$$;
revoke execute on function public.member_picks(uuid, uuid) from public, anon, authenticated;

-- copy into the caller's C portfolio the stocks they chose in one of their A/B teams: same side
-- and quantity, scaled down proportionally when they would not fit in the free budget.
-- Stocks already held in C are left as they are.
create or replace function public.copy_to_c(p_source uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_c uuid; v_comp text; rec record;
  v_total numeric := 0; v_free numeric; v_scale numeric := 1; v_q numeric;
  v_done int := 0; v_skipped int := 0; v_held int := 0;
begin
  select m.team_id into v_c from public.team_members m join public.teams t on t.id = m.team_id
  where m.user_id = v_uid and t.competition = 'C';
  if v_c is null then raise exception 'Open your individual portfolio first'; end if;
  if not exists (select 1 from public.team_members where user_id = v_uid and team_id = p_source) then
    raise exception 'You are not a member of that team';
  end if;
  select competition into v_comp from public.teams where id = p_source;
  if v_comp not in ('A', 'B') then raise exception 'Copy from your Competition A or B team'; end if;

  for rec in select * from public.member_picks(p_source, v_uid) loop
    if public.team_holds_now(v_c, rec.symbol) then v_held := v_held + 1; continue; end if;
    v_total := v_total + coalesce(public.order_value_eur(rec.symbol, rec.qty), 0);
  end loop;
  if v_total = 0 then
    return jsonb_build_object('copied', 0, 'skipped', 0, 'alreadyHeld', v_held, 'scale', 1);
  end if;
  v_held := 0;
  v_free := public.team_value_eur(v_c) - public.exposure_eur(v_c, null);
  if v_free <= 0 then raise exception 'Your individual portfolio is fully invested: reduce a position first'; end if;
  if v_total > v_free then v_scale := v_free / v_total; end if;

  for rec in select * from public.member_picks(p_source, v_uid) loop
    if public.team_holds_now(v_c, rec.symbol) then v_held := v_held + 1; continue; end if;
    v_q := floor(rec.qty * v_scale);
    if v_q < 1 or public.order_value_eur(rec.symbol, rec.qty) is null then v_skipped := v_skipped + 1; continue; end if;
    begin
      perform public.place_order_for(v_c, rec.symbol, 'open', rec.side, v_q);
      v_done := v_done + 1;
    exception when others then v_skipped := v_skipped + 1;
    end;
  end loop;
  return jsonb_build_object('copied', v_done, 'skipped', v_skipped, 'alreadyHeld', v_held, 'scale', round(v_scale, 4));
end $$;
revoke execute on function public.copy_to_c(uuid) from public, anon;
grant execute on function public.copy_to_c(uuid) to authenticated;

-- public list: everyone registered (with or without a team), plus their individual portfolio
create or replace function public.participants_list()
returns table (user_id uuid, first_name text, last_name text, linkedin_url text, team_a_id uuid, team_a text, association text,
               role text, team_b_id uuid, team_b text, team_c_id uuid, rank_c int, return_c numeric)
language sql stable security definer set search_path = public as $$
  select x.user_id, x.first_name, x.last_name, x.linkedin_url, ta.id, ta.name, ta.university, ma.role, tb.id, tb.name,
         tc.id, mc.rank_in_competition, mc.total_return
  from (
    select u.user_id,
           coalesce(nullif(p.first_name, ''), split_part(fn.n, ' ', 1)) as first_name,
           coalesce(nullif(p.last_name, ''), trim(substr(fn.n, length(split_part(fn.n, ' ', 1)) + 2))) as last_name,
           p.linkedin_url
    from (select user_id from public.team_members union select user_id from public.profiles) u
    left join public.profiles p on p.user_id = u.user_id
    left join lateral (
      select coalesce((select m.full_name from public.team_members m where m.user_id = u.user_id limit 1),
                      (select coalesce(au.raw_user_meta_data->>'full_name', '') from auth.users au where au.id = u.user_id), '') as n
    ) fn on true
    where not exists (select 1 from public.user_roles r where r.user_id = u.user_id and r.role = 'admin')
  ) x
  left join public.team_members ma on ma.user_id = x.user_id and exists (select 1 from public.teams t where t.id = ma.team_id and t.competition = 'A')
  left join public.teams ta on ta.id = ma.team_id
  left join public.team_members mb on mb.user_id = x.user_id and exists (select 1 from public.teams t where t.id = mb.team_id and t.competition = 'B')
  left join public.teams tb on tb.id = mb.team_id
  left join public.team_members mcm on mcm.user_id = x.user_id and exists (select 1 from public.teams t where t.id = mcm.team_id and t.competition = 'C')
  left join public.teams tc on tc.id = mcm.team_id
  left join public.metrics mc on mc.team_id = tc.id
  order by lower(x.last_name), lower(x.first_name);
$$;
revoke execute on function public.participants_list() from public;
grant execute on function public.participants_list() to anon, authenticated;
