-- The Resend key for organiser notifications is kept encrypted in Vault ('resend_api_key');
-- only the service role (Edge Functions) can read it. Set it with:
--   select vault.create_secret('<key>', 'resend_api_key', 'Resend key for organiser notifications');
create or replace function public.mail_api_key()
returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
$$;
revoke execute on function public.mail_api_key() from public, anon, authenticated;
grant execute on function public.mail_api_key() to service_role;
