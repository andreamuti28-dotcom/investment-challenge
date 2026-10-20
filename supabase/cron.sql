-- Run ONCE in the Supabase SQL editor AFTER deploying the edge functions (already done on the
-- live project). Replace <PROJECT_REF> with the id in your project URL first.
-- The engine secret is random and lives only in Supabase Vault: the scheduled job sends it, the
-- engine and admin functions check it with verify_engine_secret().
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'challenge_engine_secret',
  'Header x-engine-secret used by pg_cron to call the engine function');
select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'challenge_project_url', 'Project URL for pg_cron');

create or replace function public.verify_engine_secret(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'challenge_engine_secret' and decrypted_secret = p);
$$;
revoke execute on function public.verify_engine_secret(text) from public, anon, authenticated;
grant execute on function public.verify_engine_secret(text) to service_role;

create or replace function public.call_engine()
returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'challenge_project_url') || '/functions/v1/engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'challenge_engine_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  );
$$;
revoke execute on function public.call_engine() from public, anon, authenticated;

-- 22:30 UTC: after European and US closes. 05:30 UTC: late data and Asian markets.
select cron.schedule('challenge-engine-evening', '30 22 * * *', $$ select public.call_engine(); $$);
select cron.schedule('challenge-engine-morning', '30 5 * * *', $$ select public.call_engine(); $$);

-- check: select * from cron.job;   history: select * from cron.job_run_details order by start_time desc limit 10;
-- to stop: select cron.unschedule('challenge-engine-evening'); select cron.unschedule('challenge-engine-morning');
