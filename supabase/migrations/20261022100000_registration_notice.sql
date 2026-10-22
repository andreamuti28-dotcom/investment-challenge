-- organiser e-mails and registration counters, for the "new registration" notice sent by the
-- register Edge Function (service role only)
create or replace function public.registration_notice_info()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'organisers', (select coalesce(jsonb_agg(u.email), '[]') from public.user_roles r join auth.users u on u.id = r.user_id where r.role = 'admin'),
    'total', (select count(*) from auth.users u where not exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin')),
    'today', (select count(*) from auth.users u where u.created_at >= date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome'
              and not exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin')));
$$;
revoke execute on function public.registration_notice_info() from public, anon, authenticated;
grant execute on function public.registration_notice_info() to service_role;
