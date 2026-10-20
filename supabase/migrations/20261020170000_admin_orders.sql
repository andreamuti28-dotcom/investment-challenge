-- The organiser can open any team's portfolio and place or cancel orders on its behalf.
-- Team and organiser share the same rules: the *_for functions hold the logic.

create or replace function public.place_order_for(v_team uuid, p_symbol text, p_action text, p_side text, p_quantity numeric)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_instr public.instruments;
  v_t record;
  v_end date := (select end_date from public.challenge_settings where id = 1);
  v_holds boolean;
  v_row public.orders;
begin
  if v_team is null then raise exception 'You are not a member of any team'; end if;
  select * into v_instr from public.instruments where symbol = p_symbol;
  if v_instr.symbol is null then raise exception 'Unknown instrument %: search and select it first', p_symbol; end if;
  if v_instr.quote_type <> 'EQUITY' then raise exception 'Only listed stocks are allowed'; end if;
  if p_action not in ('open', 'close', 'change') then raise exception 'Invalid action'; end if;
  if p_action in ('open', 'change') then
    if p_side not in ('long', 'short') then raise exception 'Choose Buy (long) or Sell short'; end if;
    if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity) then
      raise exception 'Quantity must be a positive whole number of shares';
    end if;
  else
    p_side := null; p_quantity := null;
  end if;
  select * into v_t from public.order_timing(p_symbol);
  if v_t.exec_date > v_end then raise exception 'The challenge is over: no more orders can be placed'; end if;

  update public.orders set status = 'cancelled', reject_reason = 'replaced by a newer order', updated_at = now()
  where team_id = v_team and symbol = p_symbol and status = 'pending' and cutoff_at > now();

  v_holds := public.team_holds_now(v_team, p_symbol);
  if p_action = 'open' and v_holds then
    raise exception 'The team already holds % : change the quantity or close the position', p_symbol;
  end if;
  if p_action in ('close', 'change') and not v_holds then
    raise exception 'The team does not hold %', p_symbol;
  end if;

  insert into public.orders (team_id, month_n, symbol, action, side, target_quantity, created_by, exec_date, cutoff_at)
  values (v_team, public.month_of(v_t.exec_date), p_symbol, p_action, p_side, p_quantity, auth.uid(), v_t.exec_date, v_t.cutoff_at)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.place_order(p_symbol text, p_action text, p_side text default null, p_quantity numeric default null)
returns public.orders language sql security definer set search_path = public as $$
  select * from public.place_order_for(public.my_team_id(), p_symbol, p_action, p_side, p_quantity);
$$;

create or replace function public.place_order_admin(p_team uuid, p_symbol text, p_action text, p_side text default null, p_quantity numeric default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_row public.orders;
begin
  if not public.is_admin() then raise exception 'Reserved to the organiser'; end if;
  select * into v_row from public.place_order_for(p_team, p_symbol, p_action, p_side, p_quantity);
  return v_row;
end $$;

create or replace function public.cancel_order_admin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Reserved to the organiser'; end if;
  update public.orders set status = 'cancelled', updated_at = now()
  where id = p_id and status = 'pending' and cutoff_at > now();
  if not found then raise exception 'Order not found or already locked: the market has closed'; end if;
end $$;

create or replace function public.place_transfer_admin(p_team uuid, p_currency text, p_eur_amount numeric)
returns public.transfer_orders language plpgsql security definer set search_path = public as $$
declare
  v_t record;
  v_end date := (select end_date from public.challenge_settings where id = 1);
  v_row public.transfer_orders;
begin
  if not public.is_admin() then raise exception 'Reserved to the organiser'; end if;
  p_currency := upper(trim(p_currency));
  if p_currency !~ '^[A-Z]{3}$' or p_currency = 'EUR' then raise exception 'Invalid currency'; end if;
  if p_eur_amount is null or p_eur_amount = 0 then raise exception 'Amount must be different from zero'; end if;
  select * into v_t from public.next_close(now(), 'Europe/Rome', time '14:00');
  if v_t.exec_date > v_end then raise exception 'The challenge is over: no more transfers can be placed'; end if;
  insert into public.transfer_orders (team_id, month_n, currency, eur_amount, created_by, exec_date, cutoff_at)
  values (p_team, public.month_of(v_t.exec_date), p_currency, p_eur_amount, auth.uid(), v_t.exec_date, v_t.cutoff_at)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.cancel_transfer_admin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Reserved to the organiser'; end if;
  update public.transfer_orders set status = 'cancelled' where id = p_id and status = 'pending' and cutoff_at > now();
  if not found then raise exception 'Transfer not found or already locked'; end if;
end $$;

-- members and code of any team, for the organiser
create or replace function public.team_info_admin(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'role', 'organiser',
    'code', (select code from public.team_access where team_id = p_team),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(m.full_name, '–'), 'role', m.role, 'email', u.email, 'joined', m.created_at)
                order by m.role desc, m.created_at), '[]')
      from public.team_members m join auth.users u on u.id = m.user_id where m.team_id = p_team)
  ) end;
$$;

revoke execute on function public.place_order_for(uuid, text, text, text, numeric) from public, anon, authenticated;
revoke execute on function public.place_order_admin(uuid, text, text, text, numeric) from public, anon;
revoke execute on function public.cancel_order_admin(uuid) from public, anon;
revoke execute on function public.place_transfer_admin(uuid, text, numeric) from public, anon;
revoke execute on function public.cancel_transfer_admin(uuid) from public, anon;
revoke execute on function public.team_info_admin(uuid) from public, anon;
grant execute on function public.place_order_admin(uuid, text, text, text, numeric) to authenticated;
grant execute on function public.cancel_order_admin(uuid) to authenticated;
grant execute on function public.place_transfer_admin(uuid, text, numeric) to authenticated;
grant execute on function public.cancel_transfer_admin(uuid) to authenticated;
grant execute on function public.team_info_admin(uuid) to authenticated;
