-- 118: 11-27 전체검사에서 남긴 낮은 것 (카지노 정산)
--   apply_round_result 를 033 정의 그대로 두고 아래 두 군데만 바꿨다. 여러 번 올려도 된다.
--
--   1) 블랙잭: 판에 건 자리가 모두 무승부(push)면 deltas 가 전부 0 이라 '취소된 판'으로 보고 시아코인을 주지 않았다.
--      블랙잭 settle 은 건 자리만 deltas 에 넣으므로(쉰 자리 out 은 빠진다), deltas 에 자리가 하나라도 있으면 실제로 한 판이다.
--      → 블랙잭은 deltas 가 비어 있지 않으면 played. 다른 게임은 그대로 (0 만 있는 판 = 아무 돈도 오가지 않은 판).
--
--   2) 포커·홀덤: 칩은 판이 끝날 때 지갑에서 빠지고, 진 사람은 남은 잔액까지만 빠진다 (greatest(d, -bal)).
--      판 도중 나간 사람이 정산 전에 칩을 써 버리면(066/068 이 다른 카드 방 입장을 막지만, 멈춘 방은 10분·30분 뒤 그 검사에서 빠진다)
--      진 금액이 깎이는데 이긴 사람은 팟을 다 받아 그 차이만큼 칩이 생겨났다.
--      → 먼저 진 사람들의 지갑을 잠그고 모자란 액수(short)를 센 뒤, 이긴 자리의 몫에서 이긴 금액 비율대로(올림) 덜어 준다.
--        정상적인 판(판 시작 잔액 = 지금 잔액)은 short = 0 이라 결과가 바뀌지 않는다.
--        블랙잭은 딜러(하우스)와의 승부라 이긴 사람이 진 사람 돈을 받는 게 아니므로 덜지 않는다. 맞고는 냥이 다른 데 쓰이지 않아 그대로.
--      game_results.deltas 에는 엔진이 낸 원래 값을 남긴다 (실제로 오간 금액은 wallet_logs).

create or replace function public.apply_round_result(p_room uuid, p_round int, p_deltas jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare rm public.game_rooms; s public.room_seats; d bigint; cur text; bal bigint; applied bigint; n int; played boolean;
  pool boolean; short numeric := 0; won numeric := 0;
begin
  select * into rm from public.game_rooms where id = p_room for update;
  if not found then return false; end if;
  insert into public.game_results (room_id, round_no, game, deltas) values (p_room, p_round, rm.game, p_deltas)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  cur := case when rm.game = 'matgo' then 'nyang' else 'chips' end;
  -- 취소된 판(아무 돈도 오가지 않음)은 코인을 주지 않는다
  select exists (select 1 from jsonb_each_text(coalesce(p_deltas, '{}'::jsonb)) x where x.value::numeric <> 0) into played;
  -- (118) 블랙잭은 건 자리만 deltas 에 있다: 모두 무승부여도 한 판
  if rm.game = 'blackjack' and not played then
    played := exists (select 1 from jsonb_object_keys(coalesce(p_deltas, '{}'::jsonb)));
  end if;

  -- (118) 포커·홀덤: 진 사람 잔액이 모자란 만큼 이긴 몫을 덜 준다 (칩이 생기지 않게)
  pool := rm.game in ('poker', 'holdem');
  if pool then
    for s in select * from public.room_seats where room_id = p_room and user_id is not null order by user_id loop
      d := coalesce((p_deltas ->> s.seat_no::text)::bigint, 0);
      if d >= 0 then continue; end if;
      perform public._ensure_wallet(s.user_id);
      select chips into bal from public.wallets where user_id = s.user_id for update;
      if -d > greatest(bal, 0) then short := short + (-d - greatest(bal, 0)); end if;
    end loop;
    select coalesce(sum(greatest(x.value::numeric, 0)), 0) into won from jsonb_each_text(coalesce(p_deltas, '{}'::jsonb)) x;
  end if;

  for s in select * from public.room_seats where room_id = p_room and user_id is not null loop
    if played and rm.game <> 'roulette' and not s.left_game and p_deltas ? s.seat_no::text then
      perform public._grant_sia_coin(s.user_id, rm.game, p_room || ':' || p_round);
    end if;
    d := coalesce((p_deltas ->> s.seat_no::text)::bigint, 0);
    if pool and short > 0 and won > 0 and d > 0 then
      d := d - least(d, ceil(short * d / won)::bigint);
    end if;
    if d = 0 then continue; end if;
    perform public._ensure_wallet(s.user_id);
    select case when cur = 'nyang' then nyang else chips end into bal from public.wallets where user_id = s.user_id for update;
    applied := greatest(d, -bal);
    if cur = 'nyang' then update public.wallets set nyang = nyang + applied where user_id = s.user_id;
    else update public.wallets set chips = chips + applied where user_id = s.user_id; end if;
    insert into public.wallet_logs (user_id, currency, amount, reason, game_id)
    values (s.user_id, cur, applied, 'game', rm.game || ':' || p_room || ':' || p_round);
  end loop;
  return true;
end $$;
revoke all on function public.apply_round_result(uuid, int, jsonb) from public, anon, authenticated;
grant execute on function public.apply_round_result(uuid, int, jsonb) to service_role;
