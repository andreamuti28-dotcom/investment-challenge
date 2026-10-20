-- Currency transfers are disabled: each currency is a separate sub-portfolio and the
-- organiser converts the results at the end of the challenge.
update public.transfer_orders set status = 'cancelled', reject_reason = 'currency transfers disabled'
where status = 'pending';

create or replace function public.place_transfer(p_currency text, p_eur_amount numeric)
returns public.transfer_orders language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Currency transfers are not available: each currency is a separate sub-portfolio';
end $$;

create or replace function public.place_transfer_admin(p_team uuid, p_currency text, p_eur_amount numeric)
returns public.transfer_orders language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Currency transfers are not available: each currency is a separate sub-portfolio';
end $$;
