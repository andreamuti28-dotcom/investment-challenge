-- Everyone registers with their own account as a member; the organiser marks the presidents.
-- Members join their team with the team code, at registration or later from their account.

create table if not exists public.join_attempts (
  user_id uuid not null,
  at timestamptz not null default now()
);
alter table public.join_attempts enable row level security;
create index if not exists join_attempts_user_at on public.join_attempts (user_id, at);

-- signed-in user without a team: join with the code (max 10 wrong codes per hour)
create or replace function public.join_with_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_team uuid; v_team_name text; v_cur text; v_full text;
begin
  if v_uid is null then return jsonb_build_object('error', 'Sign in first.'); end if;
  select t.name into v_cur from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = v_uid limit 1;
  if v_cur is not null then return jsonb_build_object('error', format('You are already a member of %s.', v_cur)); end if;
  if (select count(*) from public.join_attempts where user_id = v_uid and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('error', 'Too many wrong codes: try again in an hour.');
  end if;
  select f.team_id, f.team_name into v_team, v_team_name from public.team_for_code(p_code) f;
  if v_team is null then
    insert into public.join_attempts (user_id) values (v_uid);
    return jsonb_build_object('error', 'Team code not recognised. Ask your president or the organiser for it.');
  end if;
  select coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''), split_part(email, '@', 1)) into v_full from auth.users where id = v_uid;
  perform public.join_team(v_uid, v_team, 'member', v_full);
  return jsonb_build_object('team', v_team_name);
end $$;
revoke execute on function public.join_with_code(text) from public, anon;
grant execute on function public.join_with_code(text) to authenticated;

-- organiser: put an account in a team and choose its role (one president per team: the
-- previous president becomes a member)
create or replace function public.set_membership_admin(p_user uuid, p_team uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_full text;
begin
  if not public.is_admin() then raise exception 'Reserved to the organiser'; end if;
  if p_role not in ('member', 'president') then raise exception 'Invalid role'; end if;
  if p_team is null or not exists (select 1 from public.teams where id = p_team) then raise exception 'Choose a team'; end if;
  if p_role = 'president' then
    update public.team_members set role = 'member' where team_id = p_team and role = 'president' and user_id <> p_user;
  end if;
  if exists (select 1 from public.team_members where user_id = p_user) then
    update public.team_members set team_id = p_team, role = p_role where user_id = p_user;
  else
    select coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''), split_part(email, '@', 1)) into v_full from auth.users where id = p_user;
    if not found then raise exception 'Account not found'; end if;
    perform public.join_team(p_user, p_team, p_role, v_full);
  end if;
end $$;
revoke execute on function public.set_membership_admin(uuid, uuid, text) from public, anon;
grant execute on function public.set_membership_admin(uuid, uuid, text) to authenticated;
