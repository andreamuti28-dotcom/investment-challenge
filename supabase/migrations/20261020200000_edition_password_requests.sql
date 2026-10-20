-- Edition year and the start date shown on the website (the engine start date can differ while testing).
alter table public.challenge_settings add column if not exists edition_year int not null default 2026;
alter table public.challenge_settings add column if not exists public_start_date date;
update public.challenge_settings set public_start_date = date '2026-12-01' where id = 1 and public_start_date is null;
alter table public.challenge_settings drop constraint if exists challenge_settings_edition_year_check;
alter table public.challenge_settings add constraint challenge_settings_edition_year_check check (edition_year between 2000 and 2100);

-- "Forgot password": the user asks, the organiser is notified and resets it from the admin panel.
create table if not exists public.password_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  name text,
  team text,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  handled_at timestamptz
);
alter table public.password_requests enable row level security;
drop policy if exists admin_all on public.password_requests;
create policy admin_all on public.password_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Called only by the password-request Edge Function (service role): records the request when the
-- account exists, at most one open request per account every 30 minutes and 60 per hour overall.
create or replace function public.request_password_reset(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid; v_name text; v_team text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('stored', false); end if;
  if (select count(*) from public.password_requests where created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('stored', false, 'reason', 'busy');
  end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then return jsonb_build_object('stored', false); end if;
  if exists (select 1 from public.password_requests where user_id = v_user and status = 'open' and created_at > now() - interval '30 minutes') then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end if;
  select m.full_name, t.name into v_name, v_team
  from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = v_user limit 1;
  insert into public.password_requests (user_id, email, name, team) values (v_user, v_email, v_name, v_team);
  return jsonb_build_object('stored', true, 'email', v_email, 'name', v_name, 'team', v_team,
    'organisers', (select coalesce(jsonb_agg(u.email), '[]') from public.user_roles r join auth.users u on u.id = r.user_id where r.role = 'admin'));
end $$;
revoke execute on function public.request_password_reset(text) from public, anon, authenticated;
grant execute on function public.request_password_reset(text) to service_role;
