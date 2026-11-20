-- 066: 카드 방(맞고·포커·블랙잭·홀덤) 판 도중 나간 사람은 그 판이 끝날 때까지 다른 카드 방에 들어가지 못한다
--   칩은 판이 끝날 때(apply_round_result) 지갑에서 빠진다. 올인한 채 나가서(left_game) 곧바로 룰렛처럼 바로 앉아 거는 방에 들어가
--   칩을 써 버리면, 정산 때 진 금액이 남은 잔액만큼으로 깎이고(greatest(d, -bal)) 이긴 사람은 다 받아 칩이 생겨났다.
--   그래서 방에 들어가거나 방을 만들 때, 다른 카드 방이 게임 중이고 그 방에 내 자리가 남아 있으면(나간 자리든 앉은 자리든) 막는다.
--   (앉은 자리도 보는 이유: join_room 은 들어가면서 _leave_all 로 그 자리를 '나간 자리'로 바꾸므로 같은 구멍이다)
--   - 룰렛 방은 빼고 본다: 나가면 바로 빈자리가 되고, 베팅은 걸 때 이미 빠진다
--   - 들어가려는 방 자체는 빼고 본다: 같은 방에 다시 들어오면 판이 끝날 때까지 대기(pending)일 뿐 걸 수 없다
--   - 대기 자리 → 자리 승격(finish_round)은 이미 '다른 방에 앉은 자리가 있으면 취소'하고, 대기에 들어갈 때 이 검사를 거친다
--   - set_ready 는 이미 앉은 방에서만 쓰이므로 따로 막지 않는다
--   036/065 와 같은 방식: 예전 함수 이름을 _card_..._unchecked 로 바꾸고 같은 이름·인자의 '검사 후 넘기는' 함수를 새로 만든다.
--   (065 의 탱크 create_room(text, text, jsonb) · join_room(uuid, jsonb) 는 인자가 다른 별개 함수다 — 건드리지 않는다)
-- 주의: 나중에 카드 방 입장·만들기 동작을 바꿀 때는 _card_..._unchecked 쪽을 고친다 (겉 함수를 create or replace 하면 이 검사가 사라진다).

-- 다른 카드 방에서 아직 끝나지 않은 판에 내 자리가 있는가
create or replace function public._card_busy(p_user uuid, p_except uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.room_seats s join public.game_rooms r on r.id = s.room_id
    where s.user_id = p_user and r.status = 'playing' and r.game <> 'roulette'
      and r.id is distinct from p_except)
$$;
revoke all on function public._card_busy(uuid, uuid) from public, anon, authenticated;

alter function public.create_room(text, text, text, int, text) rename to _card_create_room_unchecked;
alter function public.join_room(uuid, text, text) rename to _card_join_room_unchecked;
revoke all on function public._card_create_room_unchecked(text, text, text, int, text) from public, anon, authenticated;
revoke all on function public._card_join_room_unchecked(uuid, text, text) from public, anon, authenticated;

create function public.create_room(p_game text, p_name text, p_password text, p_base_unit int, p_avatar text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'need login'; end if;
  -- 안쪽 함수와 같은 잠금 (같은 사람의 입장·만들기가 겹치지 않게; 같은 트랜잭션에서 다시 잡아도 된다)
  perform pg_advisory_xact_lock(hashtext('sia-user:' || uid::text));
  if public._card_busy(uid) then raise exception '이전 판이 아직 끝나지 않았어요. 잠시 뒤 다시 해 주세요'; end if;
  return public._card_create_room_unchecked(p_game, p_name, p_password, p_base_unit, p_avatar);
end $$;

create function public.join_room(p_room uuid, p_password text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'need login'; end if;
  perform pg_advisory_xact_lock(hashtext('sia-user:' || uid::text));
  if public._card_busy(uid, p_room) then raise exception '이전 판이 아직 끝나지 않았어요. 잠시 뒤 다시 들어와 주세요'; end if;
  return public._card_join_room_unchecked(p_room, p_password, p_avatar);
end $$;

revoke all on function public.create_room(text, text, text, int, text), public.join_room(uuid, text, text) from public, anon;
grant execute on function public.create_room(text, text, text, int, text), public.join_room(uuid, text, text) to authenticated;
