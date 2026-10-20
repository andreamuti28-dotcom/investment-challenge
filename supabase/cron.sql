-- Run ONCE in the Supabase SQL editor AFTER deploying the edge functions.
-- Replace the two placeholders first:
--   <PROJECT_REF>    the id in your project URL (https://<PROJECT_REF>.supabase.co)
--   <ENGINE_SECRET>  the same random string you saved as the ENGINE_SECRET function secret
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'challenge_project_url');
select vault.create_secret('<ENGINE_SECRET>', 'challenge_engine_secret');

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
