-- Paste into Supabase > SQL Editor and press Run.
-- Creates the function the engine uses to rewrite its results (positions, NAV, metrics...)
-- in a single transaction. Only the service role can call it.

-- replaces every derived table in ONE transaction
create or replace function public.engine_write(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.positions where true;
  insert into public.positions (team_id, symbol, currency, side, quantity, entry_date, entry_price, exit_date, exit_price,
    exit_reason, open_month, close_month, order_id, last_price, value_local, value_eur, pnl_local, pnl_eur)
  select (x->>'teamId')::uuid, x->>'symbol', x->>'currency', x->>'side', (x->>'quantity')::numeric, (x->>'entryDate')::date,
    (x->>'entryPrice')::numeric, (x->>'exitDate')::date, (x->>'exitPrice')::numeric, x->>'exitReason', (x->>'openMonth')::int,
    (x->>'closeMonth')::int, (x->>'orderId')::uuid, (x->>'lastPrice')::numeric, (x->>'valueLocal')::numeric,
    (x->>'valueEur')::numeric, (x->>'pnlLocal')::numeric, (x->>'pnlEur')::numeric
  from jsonb_array_elements(p->'positions') x;

  delete from public.cash_ledger where true;
  insert into public.cash_ledger (team_id, date, currency, amount, kind, ref)
  select (x->>'teamId')::uuid, (x->>'date')::date, x->>'currency', (x->>'amount')::numeric, x->>'kind', x->>'ref'
  from jsonb_array_elements(p->'ledger') x;

  delete from public.nav_daily where true;
  insert into public.nav_daily select (x->>'teamId')::uuid, (x->>'date')::date, (x->>'navEur')::numeric
  from jsonb_array_elements(p->'navDaily') x;

  delete from public.benchmark_daily where true;
  insert into public.benchmark_daily select (x->>'date')::date, (x->>'valueEur')::numeric
  from jsonb_array_elements(p->'benchmarkDaily') x;

  delete from public.nav_monthly where true;
  insert into public.nav_monthly select (x->>'teamId')::uuid, (x->>'monthN')::int, (x->>'valuationDate')::date, (x->>'navEur')::numeric
  from jsonb_array_elements(p->'navMonthly') x;

  delete from public.benchmark_monthly where true;
  insert into public.benchmark_monthly select (x->>'monthN')::int, (x->>'valuationDate')::date, (x->>'valueEur')::numeric
  from jsonb_array_elements(p->'benchmarkMonthly') x;

  delete from public.subportfolios where true;
  insert into public.subportfolios select (x->>'teamId')::uuid, (x->>'asOf')::date, x->>'currency', (x->>'cashLocal')::numeric,
    (x->>'positionsValueLocal')::numeric, (x->>'totalLocal')::numeric, (x->>'fxRate')::numeric, (x->>'totalEur')::numeric
  from jsonb_array_elements(p->'subportfolios') x;

  delete from public.metrics where true;
  insert into public.metrics select (x->>'teamId')::uuid, (x->>'asOf')::date, (x->>'monthsCompleted')::int, (x->>'nav')::numeric,
    (x->>'totalReturn')::numeric, (x->>'rankInCompetition')::int, (x->>'benchmarkReturn')::numeric, (x->>'excessReturn')::numeric,
    (x->>'volatility')::numeric, (x->>'sharpe')::numeric, (x->>'sortino')::numeric, (x->>'beta')::numeric,
    (x->>'trackingError')::numeric, (x->>'maxDrawdown')::numeric, (x->>'calmar')::numeric, (x->>'operations')::int,
    (x->>'maxWeight')::numeric, (x->>'hhi')::numeric, coalesce(x->'currencyExposure', '{}'), (x->>'violations')::int
  from jsonb_array_elements(p->'metrics') x;

  -- order and transfer status (never touches cancelled or admin-rejected rows)
  update public.orders o set
    status = u->>'status',
    executed_date = (u->>'executedDate')::date,
    executed_price = (u->>'executedPrice')::numeric,
    reject_reason = u->>'rejectReason',
    reject_source = case when u->>'status' = 'rejected' then 'engine' else null end,
    updated_at = now()
  from jsonb_array_elements(p->'orderUpdates') u
  where o.id = (u->>'id')::uuid and o.status <> 'cancelled' and coalesce(o.reject_source, '') <> 'admin';

  update public.transfer_orders t set
    status = u->>'status',
    executed_date = (u->>'executedDate')::date,
    rate = (u->>'rate')::numeric,
    reject_reason = u->>'rejectReason',
    reject_source = case when u->>'status' = 'rejected' then 'engine' else null end
  from jsonb_array_elements(p->'transferUpdates') u
  where t.id = (u->>'id')::uuid and t.status <> 'cancelled' and coalesce(t.reject_source, '') <> 'admin';
end $$;

revoke execute on function public.engine_write(jsonb) from public, anon, authenticated;
grant execute on function public.engine_write(jsonb) to service_role;
