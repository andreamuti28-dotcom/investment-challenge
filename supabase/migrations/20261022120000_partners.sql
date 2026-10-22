-- Participating associations shown on the home page, managed by the organiser in Admin > Partners.
-- The logo is a path to a file of the website (partners/xxx.png) or an image uploaded from the
-- admin panel, stored as a data URL (resized in the browser, at most ~400 KB).
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  subtitle text check (subtitle is null or length(subtitle) <= 80),
  url text check (url is null or url ~* '^https?://'),
  logo text not null check (length(logo) <= 600000 and (logo like 'data:image/%' or logo ~ '^(partners/|https://)')),
  sort_order int not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.partners enable row level security;
create policy partners_read on public.partners for select to anon, authenticated using (visible or public.is_admin());
create policy partners_admin on public.partners for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.partners to anon, authenticated;
grant insert, update, delete on public.partners to authenticated;

insert into public.partners (name, subtitle, logo, sort_order)
select * from (values
  ('EFDS Society', 'Imperial College London', 'partners/imperial.png', 1),
  ('Financial Study Association Amsterdam', null, 'partners/amsterdam.png', 2),
  ('Starting Finance Club Bicocca', 'Milano Bicocca', 'partners/bicocca.png', 3)
) v(name, subtitle, logo, sort_order)
where not exists (select 1 from public.partners);
