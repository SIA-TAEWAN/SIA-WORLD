-- 027: 룰렛 칩 처리 보강 (전체검사)
--  1) 스핀 결과 기록(roulette_spins) + 스핀 단위 잠금: 결과가 난 스핀에는 더 걸 수 없다 (차감만 되고 지급이 빠지는 일 방지)
--  2) 확정 베팅 검사: 종류·칸 범위·금액(양의 정수)·합계 = p_total, 같은 스핀에 다른 내용으로 다시 오면 거절, 게임 중인 룰렛 방만
--  3) 결과 null 거절
--  4) 게임 중 마지막 사람이 나가도 방을 바로 지우지 않는다 (지급 뒤 판이 멈출 때 정리), 나간 자리는 cron이 바로 처리
--  5) 빈자리와 같은 동물로 들어와도 빈자리 이름 유지

create table if not exists public.roulette_spins (
  room_id uuid not null,
  round_no int not null,
  spin_no int not null,
  result int not null check (result between 0 and 11),
  created_at timestamptz not null default now(),
  primary key (room_id, round_no, spin_no)
);
alter table public.roulette_spins enable row level security;
revoke all on public.roulette_spins from anon, authenticated;

-- 베팅 목록 검사 (roulette.ts normalizeBets와 같은 규칙) → 합계, 잘못되면 예외
create or replace function public._roulette_check_bets(p_bets jsonb, p_base bigint) returns bigint
language plpgsql immutable as $$
declare b jsonb; k text; t int; a numeric; total bigint := 0;
begin
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) = 0 or jsonb_array_length(p_bets) > 60 then
    raise exception 'bad bets';
  end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    if jsonb_typeof(b) <> 'object' or jsonb_typeof(b->'target') <> 'number' or jsonb_typeof(b->'amount') <> 'number' then raise exception 'bad bets'; end if;
    k := b->>'kind';
    t := (b->>'target')::numeric::int;
    a := (b->>'amount')::numeric;
    if (b->>'target')::numeric <> t then raise exception 'bad bets'; end if;
    if k = 'zodiac' or k = 'pair' then if t < 0 or t > 11 then raise exception 'bad bets'; end if;
    elsif k = 'season' then if t < 0 or t > 3 then raise exception 'bad bets'; end if;
    elsif k = 'yinyang' then if t < 0 or t > 1 then raise exception 'bad bets'; end if;
    else raise exception 'bad bets'; end if;
    if a <> trunc(a) or a < p_base or a > 1000000000 or (a::bigint % p_base) <> 0 then raise exception 'bad bets'; end if;
    total := total + a::bigint;
  end loop;
  return total;
end $$;

create or replace function public.roulette_place_bet(p_room uuid, p_round int, p_spin int, p_user uuid, p_bets jsonb, p_total bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; bal bigint; rm public.game_rooms; old jsonb;
begin
  select * into rm from public.game_rooms where id = p_room;
  if not found or rm.game <> 'roulette' or rm.status <> 'playing' or rm.round_no <> p_round then raise exception 'not playing'; end if;
  if p_total is null or p_total <= 0 or p_total > rm.base_unit * 100 then raise exception 'bad total'; end if;
  if public._roulette_check_bets(p_bets, rm.base_unit) <> p_total then raise exception 'bad total'; end if;
  -- 같은 스핀의 지급과 줄 세우기: 결과가 난 스핀에는 걸 수 없다
  perform pg_advisory_xact_lock(hashtext('roulette:' || p_room || ':' || p_round || ':' || p_spin));
  if exists (select 1 from public.roulette_spins where room_id = p_room and round_no = p_round and spin_no = p_spin) then
    raise exception 'spin closed';
  end if;
  insert into public.roulette_bets (room_id, round_no, spin_no, user_id, bets, total)
  values (p_room, p_round, p_spin, p_user, p_bets, p_total) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    -- 다시 보낸 확정: 같은 내용이면 그대로, 다르면 거절
    select bets into old from public.roulette_bets where room_id = p_room and round_no = p_round and spin_no = p_spin and user_id = p_user;
    if old is distinct from p_bets then raise exception 'already bet'; end if;
    return false;
  end if;
  perform public._ensure_wallet(p_user);
  select chips into bal from public.wallets where user_id = p_user for update;
  if bal < p_total then raise exception 'not enough money'; end if;
  update public.wallets set chips = chips - p_total where user_id = p_user;
  insert into public.wallet_logs (user_id, currency, amount, reason, game_id)
  values (p_user, 'chips', -p_total, 'game', 'roulette:' || p_room || ':' || p_round || ':' || p_spin);
  return true;
end $$;

create or replace function public.roulette_pay(p_room uuid, p_round int, p_spin int, p_result int)
returns int language plpgsql security definer set search_path = public as $$
declare b public.roulette_bets; pay bigint; n int := 0;
begin
  if p_result is null or p_result < 0 or p_result > 11 then raise exception 'bad result'; end if;
  perform pg_advisory_xact_lock(hashtext('roulette:' || p_room || ':' || p_round || ':' || p_spin));
  -- 스핀을 닫는다 (이후 확정 베팅은 거절). 이미 닫혔으면 그 결과를 쓴다
  insert into public.roulette_spins (room_id, round_no, spin_no, result) values (p_room, p_round, p_spin, p_result)
  on conflict do nothing;
  select result into p_result from public.roulette_spins where room_id = p_room and round_no = p_round and spin_no = p_spin;
  for b in select * from public.roulette_bets
           where room_id = p_room and round_no = p_round and spin_no = p_spin and payout is null for update loop
    pay := public._roulette_payout(b.bets, p_result);
    update public.roulette_bets set result = p_result, payout = pay
    where room_id = b.room_id and round_no = b.round_no and spin_no = b.spin_no and user_id = b.user_id;
    if pay > 0 then
      perform public._ensure_wallet(b.user_id);
      update public.wallets set chips = chips + pay where user_id = b.user_id;
      insert into public.wallet_logs (user_id, currency, amount, reason, game_id)
      values (b.user_id, 'chips', pay, 'game', 'roulette:' || p_room || ':' || p_round || ':' || p_spin);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.roulette_place_bet(uuid, int, int, uuid, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.roulette_pay(uuid, int, int, int) from public, anon, authenticated;
revoke all on function public._roulette_check_bets(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.roulette_place_bet(uuid, int, int, uuid, jsonb, bigint) to service_role;
grant execute on function public.roulette_pay(uuid, int, int, int) to service_role;

create or replace function public.join_room(p_room uuid, p_password text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); nick text; rm public.game_rooms; s public.room_seats; sec text; other int;
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
  perform public._leave_all(uid, p_room);

  -- 룰렛은 게임 중에도 빈자리에 바로 앉는다 (다음 베팅부터 참여)
  if rm.status = 'waiting' or rm.game = 'roulette' then
    select * into s from public.room_seats where room_id = p_room and user_id is null and pending_user_id is null order by seat_no limit 1 for update;
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

create or replace function public._leave(p_user uuid, p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rm public.game_rooms; s public.room_seats;
begin
  select * into rm from public.game_rooms where id = p_room for update;
  if not found then return; end if;
  update public.room_seats set pending_user_id = null, pending_nickname = null, pending_avatar = null
  where room_id = p_room and pending_user_id = p_user;
  select * into s from public.room_seats where room_id = p_room and user_id = p_user and not left_game;
  if found then
    if rm.status = 'waiting' or rm.game = 'roulette' then
      -- 룰렛: 게임 중이어도 바로 빈자리로 (건 칩은 기록 기준으로 지급된다)
      perform public._make_ai(p_room, s.seat_no);
      if rm.game = 'roulette' then
        update public.room_seats set nickname = '빈자리' where room_id = p_room and seat_no = s.seat_no;
        -- 베팅 시간에 그 자리가 확정 전이었으면 cron이 바로 '안 걸기'로 처리 (남은 사람이 20초 기다리지 않게)
        if rm.status = 'playing' then
          update public.game_states set auto_due = true where room_id = p_room and s.seat_no = any(pending_seats);
        end if;
      end if;
    else
      update public.room_seats set left_game = true, ready = false where room_id = p_room and seat_no = s.seat_no;
      -- 이 사람 차례였으면 cron이 그 자리만 AI로 바로 처리한다
      update public.game_states set auto_due = true where room_id = p_room and s.seat_no = any(pending_seats);
    end if;
  end if;
  if rm.status = 'waiting' then perform public._fix_room(p_room);
  else update public.game_rooms set updated_at = now() where id = p_room; end if;
end $$;
