-- 068: 066 의 '판이 끝나지 않은 다른 카드 방' 검사 보강
--   1) 순서 경쟁: 검사(_card_busy) 뒤, _leave_all 이 그 방을 잠그기 전에 begin_round 가 판을 시작하면 검사를 지나쳤다.
--      → 입장·만들기 겉 함수가 검사 전에 내 자리(앉은·나간·대기)가 있는 방과 들어갈 방을 id 순서로 for update 로 먼저 잠근다.
--        begin_round 도 같은 방 행을 for update 로 잡으므로, 검사가 끝나 _leave_all 로 자리를 정리할 때까지 판이 시작되지 않고,
--        이미 시작 중이었다면 그 커밋을 기다린 뒤 검사가 'playing' 을 본다. (같은 순서로 잠가 입장끼리 교착되지 않게)
--   2) 멈춘 방: 방이 playing 으로 멈춰 풀리지 않으면 그 사람이 모든 카드 방에 영원히 못 들어갔다.
--      → 방(game_rooms.updated_at)과 판 상태(game_states.updated_at)가 모두 10분 넘게 그대로이거나,
--        판을 시작한 지(round_started_at, 없으면 updated_at) 30분이 넘은 방은 바쁨으로 보지 않는다.
--   3) 오류 문구: 다른 방 판에 아직 앉아 있으면 '그 방으로 돌아가거나', 나간 자리면 기존 문구.
--   4) 룰렛 자리 이어받기: 스핀 도중 나간 사람 자리를 새 사람이 받으면 이번 스핀 players 에 그 자리가 있어
--      나간 사람의 확정 베팅·당첨 결과가 새 사람 화면에 보였다(돈은 맞음).
--      → 룰렛 방이 게임 중이면 game_states.public_state->'players' 에 든 자리를 피해서 앉힌다.
--        빈자리가 그것뿐이면 이번 스핀이 끝나고 다시 들어오라고 거절한다.
--   _card_join_room_unchecked 는 027_roulette_hardening.sql 의 join_room 정의 그대로에 표시한 줄만 바꿨다.
--   create_room / join_room 겉 함수는 066 정의에 잠금·문구만 더했다. 여러 번 올려도 된다.

-- 다른 카드 방에서 아직 끝나지 않은 판에 내 자리가 있는가: 'seated'(아직 앉아 있음) · 'left'(나간 자리) · null
create or replace function public._card_busy_state(p_user uuid, p_except uuid default null) returns text
language sql stable security definer set search_path = public as $$
  select case when bool_or(not s.left_game) then 'seated' when count(*) > 0 then 'left' end
  from public.room_seats s
  join public.game_rooms r on r.id = s.room_id
  left join public.game_states gs on gs.room_id = r.id
  where s.user_id = p_user and r.status = 'playing' and r.game <> 'roulette'
    and r.id is distinct from p_except
    -- 멈춘 방은 빼 준다 (10분 넘게 아무 변화 없음, 또는 판 시작 30분 넘음)
    and greatest(r.updated_at, coalesce(gs.updated_at, r.updated_at)) >= now() - interval '10 minutes'
    and coalesce(r.round_started_at, r.updated_at) >= now() - interval '30 minutes'
$$;
revoke all on function public._card_busy_state(uuid, uuid) from public, anon, authenticated;

create or replace function public._card_busy(p_user uuid, p_except uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select public._card_busy_state(p_user, p_except) is not null
$$;
revoke all on function public._card_busy(uuid, uuid) from public, anon, authenticated;

-- 내 자리가 있는 방(+ 들어갈 방)을 id 순서로 잠근다
create or replace function public._card_lock_rooms(p_user uuid, p_room uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.game_rooms
  where id in (select room_id from public.room_seats where user_id = p_user or pending_user_id = p_user)
     or id = p_room
  order by id
  for update;
end $$;
revoke all on function public._card_lock_rooms(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_room(p_game text, p_name text, p_password text, p_base_unit int, p_avatar text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); st text;
begin
  if uid is null then raise exception 'need login'; end if;
  -- 안쪽 함수와 같은 잠금 (같은 사람의 입장·만들기가 겹치지 않게; 같은 트랜잭션에서 다시 잡아도 된다)
  perform pg_advisory_xact_lock(hashtext('sia-user:' || uid::text));
  -- (068) 검사 전에 내 자리가 있는 방을 잠근다: 검사와 _leave_all 사이에 판이 시작되지 않게
  perform public._card_lock_rooms(uid, null);
  st := public._card_busy_state(uid, null);
  if st = 'seated' then raise exception '다른 방에서 판이 진행 중이에요. 그 방으로 돌아가거나 판이 끝난 뒤 다시 해 주세요'; end if;
  if st = 'left' then raise exception '이전 판이 아직 끝나지 않았어요. 잠시 뒤 다시 해 주세요'; end if;
  return public._card_create_room_unchecked(p_game, p_name, p_password, p_base_unit, p_avatar);
end $$;

create or replace function public.join_room(p_room uuid, p_password text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); st text;
begin
  if uid is null then raise exception 'need login'; end if;
  perform pg_advisory_xact_lock(hashtext('sia-user:' || uid::text));
  -- (068) 검사 전에 내 자리가 있는 방과 들어갈 방을 잠근다 (안쪽 함수가 다시 잡아도 된다)
  perform public._card_lock_rooms(uid, p_room);
  st := public._card_busy_state(uid, p_room);
  if st = 'seated' then raise exception '다른 방에서 판이 진행 중이에요. 그 방으로 돌아가거나 판이 끝난 뒤 들어와 주세요'; end if;
  if st = 'left' then raise exception '이전 판이 아직 끝나지 않았어요. 잠시 뒤 다시 들어와 주세요'; end if;
  return public._card_join_room_unchecked(p_room, p_password, p_avatar);
end $$;

revoke all on function public.create_room(text, text, text, int, text), public.join_room(uuid, text, text) from public, anon;
grant execute on function public.create_room(text, text, text, int, text), public.join_room(uuid, text, text) to authenticated;

-- ---------- 안쪽 입장 함수: 룰렛은 이번 스핀 참가 자리를 피해서 앉힌다 ----------
create or replace function public._card_join_room_unchecked(p_room uuid, p_password text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); nick text; rm public.game_rooms; s public.room_seats; sec text; other int;
  busy_seats int[] := '{}';
begin
  if uid is null then raise exception 'need login'; end if;
  perform pg_advisory_xact_lock(hashtext('sia-user:' || uid::text));
  select nickname into nick from public.profiles where id = uid;
  if nick is null then raise exception 'need login'; end if;
  if not (p_avatar = any(public._zodiac())) then raise exception 'bad avatar'; end if;
  if not exists (select 1 from public.game_rooms where id = p_room) then raise exception 'room not found'; end if;

  -- 이미 이 방에 있으면 그대로 (비밀번호 다시 묻지 않음)
  select * into s from public.room_seats where room_id = p_room and user_id = uid and not left_game;
  if found then return jsonb_build_object('seat', s.seat_no, 'pending', false, 'avatar', s.avatar); end if;
  select * into s from public.room_seats where room_id = p_room and pending_user_id = uid;
  if found then return jsonb_build_object('seat', s.seat_no, 'pending', true, 'avatar', s.pending_avatar); end if;

  -- 비밀번호 확인은 방을 잠그기 전에 (틀린 비밀번호 연타로 방이 막히지 않게)
  select password_hash into sec from public.room_secrets where room_id = p_room;
  if sec is not null and (coalesce(p_password, '') = '' or sec <> crypt(p_password, sec)) then
    perform pg_sleep(0.3);
    raise exception 'wrong password';
  end if;

  select * into rm from public.game_rooms where id = p_room for update;
  if not found then raise exception 'room not found'; end if;
  perform public._ensure_wallet(uid);
  if coalesce(public._balance(uid, rm.game), 0) < rm.base_unit * 50 then raise exception 'not enough money'; end if;
  if exists (select 1 from public.room_seats where room_id = p_room
             and ((user_id is not null and not left_game and avatar = p_avatar) or pending_avatar = p_avatar)) then
    raise exception 'avatar taken';
  end if;

  -- (068) 룰렛 게임 중: 이번 스핀에 참가한 자리(나간 사람 자리 포함)는 스핀이 끝날 때까지 비워 둔다
  if rm.game = 'roulette' and rm.status = 'playing' then
    select coalesce(array_agg((p->>'seat')::int), '{}') into busy_seats
    from public.game_states gs, jsonb_array_elements(
      case when jsonb_typeof(gs.public_state->'players') = 'array' then gs.public_state->'players' else '[]'::jsonb end) p
    where gs.room_id = p_room and (p->>'seat') ~ '^[0-9]+$';
    if not exists (select 1 from public.room_seats where room_id = p_room and user_id is null and pending_user_id is null
                   and not (seat_no = any(busy_seats))) then
      if exists (select 1 from public.room_seats where room_id = p_room and user_id is null and pending_user_id is null) then
        raise exception '이번 스핀이 끝나면 자리가 나요. 잠시 뒤 다시 들어와 주세요';
      end if;
      raise exception 'room full';
    end if;
  end if;

  perform public._leave_all(uid, p_room);

  -- 룰렛은 게임 중에도 빈자리에 바로 앉는다 (다음 베팅부터 참여)
  if rm.status = 'waiting' or rm.game = 'roulette' then
    select * into s from public.room_seats where room_id = p_room and user_id is null and pending_user_id is null
      and not (seat_no = any(busy_seats))  -- (068)
    order by seat_no limit 1 for update;
    if not found then raise exception 'room full'; end if;
    select seat_no into other from public.room_seats where room_id = p_room and avatar = p_avatar and seat_no <> s.seat_no;
    if other is not null then
      update public.room_seats set avatar = public._free_animal(p_room, p_avatar) where room_id = p_room and seat_no = other;
      update public.room_seats set nickname = case when rm.game = 'roulette' then '빈자리' else 'AI ' || public._zodiac_name(avatar) end
      where room_id = p_room and seat_no = other;
    end if;
    update public.room_seats set user_id = uid, nickname = nick, avatar = p_avatar, ready = false, left_game = false,
      joined_at = now(), last_seen = now()
    where room_id = p_room and seat_no = s.seat_no;
    update public.game_rooms set updated_at = now() where id = p_room;
    return jsonb_build_object('seat', s.seat_no, 'pending', false, 'avatar', p_avatar);
  end if;

  select * into s from public.room_seats where room_id = p_room and (user_id is null or left_game) and pending_user_id is null
  order by seat_no limit 1 for update;
  if not found then raise exception 'room full'; end if;
  update public.room_seats set pending_user_id = uid, pending_nickname = nick, pending_avatar = p_avatar, last_seen = now()
  where room_id = p_room and seat_no = s.seat_no;
  update public.game_rooms set updated_at = now() where id = p_room;
  return jsonb_build_object('seat', s.seat_no, 'pending', true, 'avatar', p_avatar);
end $$;
revoke all on function public._card_join_room_unchecked(uuid, text, text) from public, anon, authenticated;
