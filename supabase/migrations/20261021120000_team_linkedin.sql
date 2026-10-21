-- LinkedIn link of each member in the team page (from the member's profile)
create or replace function public.team_info_for(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select team_id, role from public.team_members where user_id = auth.uid() and team_id = p_team)
  select case when (select team_id from me) is null then null else jsonb_build_object(
    'role', (select role from me),
    'code', case when (select role from me) = 'president' then (select code from public.team_access where team_id = p_team) end,
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', coalesce(m.full_name, '–'), 'role', m.role,
        'email', case when (select role from me) = 'president' then u.email end,
        'linkedin', p.linkedin_url,
        'joined', m.created_at) order by m.role desc, m.created_at), '[]')
      from public.team_members m join auth.users u on u.id = m.user_id
      left join public.profiles p on p.user_id = m.user_id where m.team_id = p_team)
  ) end;
$$;
revoke execute on function public.team_info_for(uuid) from public, anon;
grant execute on function public.team_info_for(uuid) to authenticated;

create or replace function public.team_info_admin(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'role', 'organiser',
    'code', (select code from public.team_access where team_id = p_team),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(m.full_name, '–'), 'role', m.role, 'email', u.email,
                'linkedin', p.linkedin_url, 'joined', m.created_at)
                order by m.role desc, m.created_at), '[]')
      from public.team_members m join auth.users u on u.id = m.user_id
      left join public.profiles p on p.user_id = m.user_id where m.team_id = p_team)
  ) end;
$$;
revoke execute on function public.team_info_admin(uuid) from public, anon;
grant execute on function public.team_info_admin(uuid) to authenticated;
