-- Registration with roles. The organiser creates each team together with the e-mail of its
-- president. A president can register only with that e-mail; everybody else registers as a
-- member with the team code, which the president receives and shares. All members can trade.

alter table public.teams add column if not exists president_email text;
create unique index if not exists teams_president_email_key on public.teams (lower(president_email));

alter table public.team_members add column if not exists role text not null default 'member';
alter table public.team_members add column if not exists full_name text;
alter table public.team_members add column if not exists created_at timestamptz not null default now();
do $$ begin
  alter table public.team_members add constraint team_members_role_check check (role in ('president', 'member'));
exception when duplicate_object then null; end $$;
create unique index if not exists team_members_one_president on public.team_members (team_id) where role = 'president';

-- the team code is now a join code: it no longer belongs to a dedicated account
alter table public.team_access alter column user_id drop not null;
alter table public.team_access drop constraint if exists team_access_user_id_fkey;
alter table public.team_access add constraint team_access_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------- service-only helpers
create or replace function public.team_for_president(p_email text)
returns table (team_id uuid, team_name text, taken boolean) language sql stable security definer set search_path = public as $$
  select t.id, t.name, exists (select 1 from public.team_members m where m.team_id = t.id and m.role = 'president')
  from public.teams t where lower(t.president_email) = lower(trim(p_email));
$$;

create or replace function public.team_for_code(p_code text)
returns table (team_id uuid, team_name text) language sql stable security definer set search_path = public as $$
  select t.id, t.name from public.team_access a join public.teams t on t.id = a.team_id
  where regexp_replace(upper(a.code), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g')
    and length(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g')) = 12;
$$;

create or replace function public.join_team(p_user uuid, p_team uuid, p_role text, p_name text)
returns void language sql security definer set search_path = public as $$
  insert into public.user_roles (user_id, role) values (p_user, 'team') on conflict do nothing;
  insert into public.team_members (user_id, team_id, role, full_name) values (p_user, p_team, p_role, nullif(trim(p_name), ''));
$$;

-- ---------------------------------------------------------------- team area
-- role of the caller, members of the team, and the join code (president only)
create or replace function public.my_team_info()
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select team_id, role from public.team_members where user_id = auth.uid() limit 1)
  select case when (select team_id from me) is null then null else jsonb_build_object(
    'role', (select role from me),
    'code', case when (select role from me) = 'president'
                 then (select code from public.team_access where team_id = (select team_id from me)) end,
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', coalesce(m.full_name, '–'),
        'role', m.role,
        'email', case when (select role from me) = 'president' then u.email end,
        'joined', m.created_at) order by m.role desc, m.created_at), '[]')
      from public.team_members m join auth.users u on u.id = m.user_id
      where m.team_id = (select team_id from me))
  ) end;
$$;

revoke execute on function public.team_for_president(text) from public, anon, authenticated;
revoke execute on function public.team_for_code(text) from public, anon, authenticated;
revoke execute on function public.join_team(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.team_for_president(text) to service_role;
grant execute on function public.team_for_code(text) to service_role;
grant execute on function public.join_team(uuid, uuid, text, text) to service_role;
revoke execute on function public.my_team_info() from public, anon;
grant execute on function public.my_team_info() to authenticated;
