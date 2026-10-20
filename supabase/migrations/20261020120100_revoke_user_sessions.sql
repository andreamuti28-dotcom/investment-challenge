-- signs a team out everywhere when the organiser replaces its access code
create or replace function public.revoke_user_sessions(p_user uuid)
returns void language sql security definer set search_path = public as $$
  delete from auth.sessions where user_id = p_user;
$$;
revoke execute on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
