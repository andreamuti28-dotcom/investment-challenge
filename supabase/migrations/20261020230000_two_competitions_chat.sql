-- A person can be in one Competition A team (their association) AND one Competition B team.
-- Competition B teams are drawn at random by the organiser. Every team has a chat.

-- ---------------------------------------------------------------- one team per competition
create or replace function public.team_members_one_per_competition()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_comp text;
begin
  select competition into v_comp from public.teams where id = new.team_id;
  if exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id
             where m.user_id = new.user_id and t.competition = v_comp and m.team_id <> new.team_id) then
    raise exception 'Already in a Competition % team', v_comp;
  end if;
  return new;
end $$;
drop trigger if exists team_members_one_per_competition on public.team_members;
create trigger team_members_one_per_competition before insert or update on public.team_members
  for each row execute function public.team_members_one_per_competition();

-- every team of the caller
create or replace function public.my_team_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select team_id from public.team_members where user_id = auth.uid();
$$;
revoke execute on function public.my_team_ids() from public, anon;
grant execute on function public.my_team_ids() to authenticated;

-- read access to all of the caller's teams (added next to the single-team policies)
create policy own_orders_any on public.orders for select to authenticated using (team_id in (select public.my_team_ids()));
create policy own_ledger_any on public.cash_ledger for select to authenticated using (team_id in (select public.my_team_ids()));
create policy own_subportfolios_any on public.subportfolios for select to authenticated using (team_id in (select public.my_team_ids()));
create policy own_contact_any on public.team_contacts for select to authenticated using (team_id in (select public.my_team_ids()));
create policy own_transfers_any on public.transfer_orders for select to authenticated using (team_id in (select public.my_team_ids()));

-- orders for a chosen team of the caller
create or replace function public.place_order_in(p_team uuid, p_symbol text, p_action text, p_side text default null, p_quantity numeric default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_row public.orders;
begin
  if p_team is null or not exists (select 1 from public.team_members where user_id = auth.uid() and team_id = p_team) then
    raise exception 'You are not a member of this team';
  end if;
  select * into v_row from public.place_order_for(p_team, p_symbol, p_action, p_side, p_quantity);
  return v_row;
end $$;
revoke execute on function public.place_order_in(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.place_order_in(uuid, text, text, text, numeric) to authenticated;

create or replace function public.cancel_order(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders o set status = 'cancelled', updated_at = now()
  where o.id = p_id and o.team_id in (select public.my_team_ids()) and o.status = 'pending' and o.cutoff_at > now();
  if not found then raise exception 'Order not found or already locked: the market has closed'; end if;
end $$;

-- members (and, for the president, the code) of one of the caller's teams
create or replace function public.team_info_for(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select team_id, role from public.team_members where user_id = auth.uid() and team_id = p_team)
  select case when (select team_id from me) is null then null else jsonb_build_object(
    'role', (select role from me),
    'code', case when (select role from me) = 'president' then (select code from public.team_access where team_id = p_team) end,
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', coalesce(m.full_name, '–'), 'role', m.role,
        'email', case when (select role from me) = 'president' then u.email end,
        'joined', m.created_at) order by m.role desc, m.created_at), '[]')
      from public.team_members m join auth.users u on u.id = m.user_id where m.team_id = p_team)
  ) end;
$$;
revoke execute on function public.team_info_for(uuid) from public, anon;
grant execute on function public.team_info_for(uuid) to authenticated;

-- joining with a code: blocked only if already in a team of the same competition
create or replace function public.join_with_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_team uuid; v_team_name text; v_comp text; v_cur text; v_full text;
begin
  if v_uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  if (select count(*) from public.join_attempts where user_id = v_uid and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('error', 'Too many wrong codes: try again in an hour.');
  end if;
  select f.team_id, f.team_name into v_team, v_team_name from public.team_for_code(p_code) f;
  if v_team is null then
    insert into public.join_attempts (user_id) values (v_uid);
    return jsonb_build_object('error', 'Team code not recognised. Ask your president or the organiser for it.');
  end if;
  select competition into v_comp from public.teams where id = v_team;
  select t.name into v_cur from public.team_members m join public.teams t on t.id = m.team_id
  where m.user_id = v_uid and t.competition = v_comp limit 1;
  if v_cur is not null then return jsonb_build_object('error', format('You are already in a Competition %s team: %s.', v_comp, v_cur)); end if;
  select coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''), split_part(email, '@', 1)) into v_full from auth.users where id = v_uid;
  perform public.join_team(v_uid, v_team, 'member', v_full);
  return jsonb_build_object('team', v_team_name, 'competition', v_comp);
end $$;

-- organiser: team and role of an account within the team's competition
create or replace function public.set_membership_admin(p_user uuid, p_team uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_full text; v_comp text;
begin
  if not public.is_admin() then raise exception 'Reserved to the organiser'; end if;
  if p_role not in ('member', 'president') then raise exception 'Invalid role'; end if;
  select competition into v_comp from public.teams where id = p_team;
  if v_comp is null then raise exception 'Choose a team'; end if;
  if p_role = 'president' then
    update public.team_members set role = 'member' where team_id = p_team and role = 'president' and user_id <> p_user;
  end if;
  if exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = p_user and t.competition = v_comp) then
    update public.team_members m set team_id = p_team, role = p_role
    from public.teams t where t.id = m.team_id and m.user_id = p_user and t.competition = v_comp;
  else
    select coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''), split_part(email, '@', 1)) into v_full from auth.users where id = p_user;
    if not found then raise exception 'Account not found'; end if;
    perform public.join_team(p_user, p_team, p_role, v_full);
  end if;
end $$;

-- ---------------------------------------------------------------- Competition B draw
-- Everybody registered (except organisers) who is not in a B team yet is drawn into new
-- teams of p_size people (some get one more when the numbers do not divide exactly).
-- People of the same association are spread over different teams. Nobody is president.
create or replace function public.generate_b_teams(p_size int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int; k int; i int; v_first int; v_ids uuid[] := '{}'; v_id uuid; rec record;
begin
  if not public.is_admin() then raise exception 'Reserved to the organiser'; end if;
  if p_size is null or p_size < 2 or p_size > 20 then raise exception 'Team size must be between 2 and 20'; end if;
  create temp table _pool on commit drop as
    select u.id as user_id,
           coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)) as full_name,
           coalesce((select m.team_id::text from public.team_members m join public.teams t on t.id = m.team_id
                     where m.user_id = u.id and t.competition = 'A' limit 1), u.id::text) as grp,
           random() as rnd
    from auth.users u
    where not exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin')
      and not exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = u.id and t.competition = 'B');
  select count(*) into n from _pool;
  if n < p_size then raise exception 'Only % people without a Competition B team: at least % are needed', n, p_size; end if;
  k := n / p_size;
  select coalesce(max((regexp_match(name, '^B Team (\d+)$'))[1]::int), 0) + 1 into v_first from public.teams where competition = 'B';
  for i in 0 .. k - 1 loop
    insert into public.teams (name, competition, university) values (format('B Team %s', lpad((v_first + i)::text, 2, '0')), 'B', 'Mixed team')
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  -- groups in random order, people of a group one after the other, dealt round-robin:
  -- consecutive people of the same association end up in different teams
  for rec in
    select p.user_id, p.full_name, (row_number() over (order by g.gkey, p.rnd) - 1) as rn
    from _pool p join (select grp, random() as gkey from _pool group by grp) g using (grp)
  loop
    perform public.join_team(rec.user_id, v_ids[(rec.rn % k) + 1], 'member', rec.full_name);
  end loop;
  return jsonb_build_object('teams', k, 'people', n);
end $$;
revoke execute on function public.generate_b_teams(int) from public, anon;
grant execute on function public.generate_b_teams(int) to authenticated;

-- ---------------------------------------------------------------- team chat
create table if not exists public.team_messages (
  id bigserial primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  author text not null default '',
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists team_messages_team_time on public.team_messages (team_id, created_at);
alter table public.team_messages enable row level security;
create policy team_read on public.team_messages for select to authenticated using (team_id in (select public.my_team_ids()) or public.is_admin());
create policy team_write on public.team_messages for insert to authenticated with check (team_id in (select public.my_team_ids()) or public.is_admin());
create policy admin_delete on public.team_messages for delete to authenticated using (public.is_admin());

-- author and time are set by the server, never by the browser
create or replace function public.team_messages_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  new.body := trim(new.body);
  new.author := coalesce(
    (select m.full_name from public.team_members m where m.user_id = auth.uid() and m.team_id = new.team_id),
    case when public.is_admin() then 'Organiser' end,
    (select coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''), split_part(email, '@', 1)) from auth.users where id = auth.uid()),
    '');
  -- at most 20 messages per minute per person
  if (select count(*) from public.team_messages where user_id = auth.uid() and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Too many messages: wait a moment';
  end if;
  return new;
end $$;
drop trigger if exists team_messages_stamp on public.team_messages;
create trigger team_messages_stamp before insert on public.team_messages for each row execute function public.team_messages_stamp();

do $$ begin
  alter publication supabase_realtime add table public.team_messages;
exception when undefined_object then null; when duplicate_object then null; end $$;
