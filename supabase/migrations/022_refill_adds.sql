-- 무료 충전: 10,000으로 "채우기" → 기존 금액에 10,000 "더하기"
-- (충전할 수 있는 조건은 그대로: 잔액이 최소 입장 금액보다 적고 10,000 미만, 하루 3번)
create or replace function public.refill(p_currency text, p_min_required bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.wallets; today date := public._kst_today(); bal bigint; used int; added bigint := 10000; need bigint;
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  if p_currency not in ('chips', 'nyang') then raise exception 'bad currency'; end if;
  select r.base_unit * 50 into need from public.room_seats s join public.game_rooms r on r.id = s.room_id
  where s.user_id = auth.uid() and not s.left_game
    and (case when r.game = 'matgo' then 'nyang' else 'chips' end) = p_currency
  limit 1;
  need := coalesce(need, 5000);
  perform public._ensure_wallet(auth.uid());
  select * into w from public.wallets where user_id = auth.uid() for update;
  if w.refill_date is distinct from today then
    update public.wallets set chips_refills_today = 0, nyang_refills_today = 0, refill_date = today
    where user_id = auth.uid() returning * into w;
  end if;
  bal := case when p_currency = 'chips' then w.chips else w.nyang end;
  used := case when p_currency = 'chips' then w.chips_refills_today else w.nyang_refills_today end;
  if bal >= need or bal >= 10000 then
    return public._wallet_json(w) || jsonb_build_object('ok', false, 'reason', 'enough');
  end if;
  if used >= 3 then
    return public._wallet_json(w) || jsonb_build_object('ok', false, 'reason', 'limit');
  end if;
  if p_currency = 'chips' then
    update public.wallets set chips = chips + added, chips_refills_today = chips_refills_today + 1 where user_id = auth.uid() returning * into w;
  else
    update public.wallets set nyang = nyang + added, nyang_refills_today = nyang_refills_today + 1 where user_id = auth.uid() returning * into w;
  end if;
  insert into public.wallet_logs (user_id, currency, amount, reason) values (auth.uid(), p_currency, added, 'refill');
  return public._wallet_json(w) || jsonb_build_object('ok', true, 'added', added);
end $$;
revoke all on function public.refill(text, bigint) from public, anon;
grant execute on function public.refill(text, bigint) to authenticated;
