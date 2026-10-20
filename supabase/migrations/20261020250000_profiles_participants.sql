-- Personal profiles (first and last name, LinkedIn), public list of participants with everyone's
-- executed moves, Competition B team names chosen unanimously, organisers out of both competitions.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  linkedin_url text,
  updated_at timestamptz not null default now(),
  constraint profiles_linkedin_check check (linkedin_url is null or linkedin_url ~* '^https://([a-z0-9-]+\.)?linkedin\.com/[^\s]{1,200}$')
);
alter table public.profiles enable row level security;
create policy own_profile_read on public.profiles for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- existing accounts: split the registration name into first and last name
insert into public.profiles (user_id, first_name, last_name)
select x.id, split_part(x.n, ' ', 1), trim(substr(x.n, length(split_part(x.n, ' ', 1)) + 2))
from (select u.id, coalesce(nullif(regexp_replace(trim(u.raw_user_meta_data->>'full_name'), '\s+', ' ', 'g'), ''), split_part(u.email, '@', 1)) as n
      from auth.users u) x
on conflict (user_id) do nothing;

-- registration (service role): profile with first and last name
create or replace function public.create_profile(p_user uuid, p_first text, p_last text)
returns void language sql security definer set search_path = public as $$
  insert into public.profiles (user_id, first_name, last_name) values (p_user, trim(p_first), trim(p_last))
  on conflict (user_id) do update set first_name = excluded.first_name, last_name = excluded.last_name, updated_at = now();
$$;
revoke execute on function public.create_profile(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_profile(uuid, text, text) to service_role;

-- the user edits their own profile; the name shown in the teams follows
create or replace function public.update_my_profile(p_first text, p_last text, p_linkedin text)
returns void language plpgsql security definer set search_path = public as $$
declare v_first text := trim(coalesce(p_first, '')); v_last text := trim(coalesce(p_last, '')); v_li text := nullif(trim(coalesce(p_linkedin, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if length(v_first) < 1 or length(v_first) > 40 or length(v_last) < 1 or length(v_last) > 40 then raise exception 'Enter your first and last name'; end if;
  if v_li is not null and v_li !~* '^https?://' then v_li := 'https://' || v_li; end if;
  if v_li is not null then v_li := regexp_replace(v_li, '^http://', 'https://', 'i'); end if;
  if v_li is not null and v_li !~* '^https://([a-z0-9-]+\.)?linkedin\.com/[^\s]{1,200}$' then
    raise exception 'Enter the link to your LinkedIn profile (linkedin.com/in/...)';
  end if;
  insert into public.profiles (user_id, first_name, last_name, linkedin_url) values (auth.uid(), v_first, v_last, v_li)
  on conflict (user_id) do update set first_name = v_first, last_name = v_last, linkedin_url = v_li, updated_at = now();
  update public.team_members set full_name = v_first || ' ' || v_last where user_id = auth.uid();
end $$;
revoke execute on function public.update_my_profile(text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text) to authenticated;

-- ---------------------------------------------------------------- organisers do not play
create or replace function public.team_members_no_organisers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.user_roles where user_id = new.user_id and role = 'admin') then
    raise exception 'Organisers do not take part in the competitions';
  end if;
  return new;
end $$;
create trigger team_members_no_organisers before insert or update on public.team_members
  for each row execute function public.team_members_no_organisers();

-- ---------------------------------------------------------------- public list of participants
create or replace function public.participants()
returns table (user_id uuid, first_name text, last_name text, linkedin_url text,
               team_a_id uuid, team_a text, association text, role text, team_b_id uuid, team_b text)
language sql stable security definer set search_path = public as $$
  select x.user_id, x.first_name, x.last_name, x.linkedin_url, ta.id, ta.name, ta.university, ma.role, tb.id, tb.name
  from (
    select u.user_id,
           coalesce(nullif(p.first_name, ''), split_part(fn.n, ' ', 1)) as first_name,
           coalesce(nullif(p.last_name, ''), trim(substr(fn.n, length(split_part(fn.n, ' ', 1)) + 2))) as last_name,
           p.linkedin_url
    from (select distinct user_id from public.team_members) u
    left join public.profiles p on p.user_id = u.user_id
    left join lateral (select coalesce(m.full_name, '') as n from public.team_members m where m.user_id = u.user_id limit 1) fn on true
    where not exists (select 1 from public.user_roles r where r.user_id = u.user_id and r.role = 'admin')
  ) x
  left join public.team_members ma on ma.user_id = x.user_id and exists (select 1 from public.teams t where t.id = ma.team_id and t.competition = 'A')
  left join public.teams ta on ta.id = ma.team_id
  left join public.team_members mb on mb.user_id = x.user_id and exists (select 1 from public.teams t where t.id = mb.team_id and t.competition = 'B')
  left join public.teams tb on tb.id = mb.team_id
  order by lower(x.last_name), lower(x.first_name);
$$;
grant execute on function public.participants() to anon, authenticated;

-- everyone's moves: executed orders placed by a participant (pending ones only to themselves,
-- their team-mates and the organiser), with the team they were placed for
create or replace function public.participant_moves(p_user uuid)
returns table (id uuid, team text, competition text, symbol text, action text, side text, quantity numeric,
               status text, placed_at timestamptz, exec_date date, executed_date date, executed_price numeric, reject_reason text)
language sql stable security definer set search_path = public as $$
  select o.id, t.name, t.competition, o.symbol, o.action, o.side, o.target_quantity,
         o.status, o.created_at, o.exec_date, o.executed_date, o.executed_price, o.reject_reason
  from public.orders o join public.teams t on t.id = o.team_id
  where o.created_by = p_user
    and not exists (select 1 from public.user_roles r where r.user_id = p_user and r.role = 'admin')
    and (o.status = 'executed' or p_user = auth.uid() or public.is_admin() or o.team_id in (select public.my_team_ids()))
  order by o.created_at desc;
$$;
grant execute on function public.participant_moves(uuid) to anon, authenticated;

-- the stocks a participant bought or sold short (positions opened by their orders)
create or replace function public.participant_stocks(p_user uuid)
returns table (team text, competition text, symbol text, currency text, side text, quantity numeric,
               entry_date date, entry_price numeric, exit_date date, exit_price numeric, exit_reason text,
               last_price numeric, pnl_local numeric)
language sql stable security definer set search_path = public as $$
  select t.name, t.competition, p.symbol, p.currency, p.side, p.quantity, p.entry_date, p.entry_price,
         p.exit_date, p.exit_price, p.exit_reason, p.last_price, p.pnl_local
  from public.positions p join public.orders o on o.id = p.order_id join public.teams t on t.id = p.team_id
  where o.created_by = p_user
    and not exists (select 1 from public.user_roles r where r.user_id = p_user and r.role = 'admin')
  order by p.exit_date nulls first, p.entry_date desc;
$$;
grant execute on function public.participant_stocks(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- Competition B names: unanimity
create table if not exists public.team_name_votes (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal text not null check (length(proposal) between 2 and 40),
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
alter table public.team_name_votes enable row level security;
create policy team_votes_read on public.team_name_votes for select to authenticated using (team_id in (select public.my_team_ids()) or public.is_admin());

-- a member proposes a name for their B team; it becomes the team name when every member has
-- proposed exactly the same name (and no other team uses it)
create or replace function public.propose_team_name(p_team uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'); v_members int; v_same int;
begin
  if not exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id
                 where m.user_id = auth.uid() and m.team_id = p_team and t.competition = 'B') then
    raise exception 'Only members of a Competition B team can propose its name';
  end if;
  if length(v_name) < 2 or length(v_name) > 40 then raise exception 'The name must have 2 to 40 characters'; end if;
  insert into public.team_name_votes (team_id, user_id, proposal) values (p_team, auth.uid(), v_name)
  on conflict (team_id, user_id) do update set proposal = v_name, updated_at = now();
  select count(*) into v_members from public.team_members where team_id = p_team;
  select count(*) into v_same from public.team_name_votes v
  where v.team_id = p_team and v.proposal = v_name and v.user_id in (select user_id from public.team_members where team_id = p_team);
  if v_same = v_members then
    if exists (select 1 from public.teams where lower(name) = lower(v_name) and id <> p_team) then
      return jsonb_build_object('renamed', false, 'agreed', v_same, 'members', v_members, 'error', 'Everyone agrees, but another team already uses this name: choose a different one.');
    end if;
    update public.teams set name = v_name where id = p_team;
    return jsonb_build_object('renamed', true, 'name', v_name, 'agreed', v_same, 'members', v_members);
  end if;
  return jsonb_build_object('renamed', false, 'agreed', v_same, 'members', v_members);
end $$;
revoke execute on function public.propose_team_name(uuid, text) from public, anon;
grant execute on function public.propose_team_name(uuid, text) to authenticated;

-- the proposals of every member of one of the caller's teams
create or replace function public.team_name_status(p_team uuid)
returns table (user_id uuid, name text, proposal text) language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(m.full_name, '–'), v.proposal
  from public.team_members m left join public.team_name_votes v on v.team_id = m.team_id and v.user_id = m.user_id
  where m.team_id = p_team and (p_team in (select public.my_team_ids()) or public.is_admin())
  order by m.full_name;
$$;
revoke execute on function public.team_name_status(uuid) from public, anon;
grant execute on function public.team_name_status(uuid) to authenticated;

-- ---------------------------------------------------------------- B draw: names "Team 1", "Team 2"…
create or replace function public.generate_b_teams(p_size int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n int; k int; i int; v_first int; v_ids uuid[] := '{}'; v_id uuid; rec record;
begin
  if not public.is_admin() then raise exception 'Reserved to the organiser'; end if;
  if p_size is null or p_size < 2 or p_size > 20 then raise exception 'Team size must be between 2 and 20'; end if;
  create temp table _pool on commit drop as
    select u.id as user_id,
           coalesce(nullif(trim(pr.first_name || ' ' || pr.last_name), ''), nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)) as full_name,
           coalesce((select m.team_id::text from public.team_members m join public.teams t on t.id = m.team_id
                     where m.user_id = u.id and t.competition = 'A' limit 1), u.id::text) as grp,
           random() as rnd
    from auth.users u left join public.profiles pr on pr.user_id = u.id
    where not exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin')
      and not exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = u.id and t.competition = 'B');
  select count(*) into n from _pool;
  if n < p_size then raise exception 'Only % people without a Competition B team: at least % are needed', n, p_size; end if;
  k := n / p_size;
  select coalesce(max((regexp_match(name, '^Team (\d+)$'))[1]::int), 0) + 1 into v_first from public.teams where competition = 'B';
  for i in 0 .. k - 1 loop
    insert into public.teams (name, competition, university) values (format('Team %s', v_first + i), 'B', 'Mixed team')
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  for rec in
    select p.user_id, p.full_name, (row_number() over (order by g.gkey, p.rnd) - 1) as rn
    from _pool p join (select grp, random() as gkey from _pool group by grp) g using (grp)
  loop
    perform public.join_team(rec.user_id, v_ids[(rec.rn % k) + 1], 'member', rec.full_name);
  end loop;
  return jsonb_build_object('teams', k, 'people', n);
end $$;
