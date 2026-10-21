-- the organiser's LinkedIn (set in their profile) for the "Contact the organiser" button
create or replace function public.organiser_linkedin()
returns text language sql stable security definer set search_path = public as $$
  select p.linkedin_url from public.profiles p
  join public.user_roles r on r.user_id = p.user_id and r.role = 'admin'
  where p.linkedin_url is not null
  order by p.updated_at desc nulls last limit 1;
$$;
revoke execute on function public.organiser_linkedin() from public;
grant execute on function public.organiser_linkedin() to anon, authenticated;
