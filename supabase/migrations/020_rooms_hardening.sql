-- SIA WORLD 020: 방·판 진행 보강 (전체 검사에서 찾은 문제)
--  1) 판 시작 때 잔액 확인 (맞고 0냥으로 위험 없이 하는 것 방지)
--  2) 판 번호를 엔진 상태와 함께 저장 → 지난 판 상태로 진행·정산 불가
--  3) 공개 상태는 버전이 더 새로울 때만 저장 (늦게 온 옛 상태가 덮어쓰지 않게)
--  4) 누가 나가도 남은 사람의 차례 시간은 그대로 (나간 자리만 AI가 바로 대신)
--  5) 'playing'에서 멈춘 방 자동 복구 (cron)
--  6) 같은 사람의 동시 입장 직렬화, 비밀번호 확인은 방 잠금 전에
--  7) 무료 충전 기준 금액은 서버가 정함
--  8) TRUNCATE 권한 정리

alter table public.game_decks add column if not exists round_no int not null default 0;
alter table public.game_states add column if not exists version int not null default 0;
alter table public.game_states add column if not exists auto_due boolean not null default false;
alter table public.game_private add column if not exists version int not null default 0;

-- ---------- 1) 판 시작: 돈이 모자란 사람은 레디를 풀고 시작하지 않는다 ----------
create or replace function public.begin_round(p_room uuid) returns int
language plpgsql security definer set search_path = public as $$
declare rm public.game_rooms; humans int; not_ready int;
begin
  select * into rm from public.game_rooms where id = p_room for update;
  if not found or rm.status <> 'waiting' then return null; end if;
  update public.room_seats set ready = false
  where room_id = p_room and user_id is not null and not left_game and ready
    and coalesce(public._balance(user_id, rm.game), 0) < rm.base_unit * 50;
  if found then
    update public.game_rooms set updated_at = now() where id = p_room;
    return null;
  end if;
  select count(*), count(*) filter (where not ready) into humans, not_ready
  from public.room_seats where room_id = p_room and user_id is not null and not left_game;
  if humans = 0 or not_ready > 0 then return null; end if;
  update public.game_rooms set status = 'playing', round_no = round_no + 1, updated_at = now()
  where id = p_room returning round_no into rm.round_no;
  return rm.round_no;
end $$;

-- ---------- 3) 공개 상태 저장 (버전이 더 새로울 때만) ----------
-- p_privates: [{ seat, userId, hand }]
create or replace function public.publish_state(p_room uuid, p_version int, p_round int, p_pub jsonb, p_pending int[],
  p_deadline timestamptz, p_privates jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.game_states set round_no = p_round, public_state = p_pub, pending_seats = p_pending,
    turn_deadline = p_deadline, auto_due = false, version = p_version, updated_at = now()
  where room_id = p_room and version < p_version;
  if not found then return false; end if;
  insert into public.game_private as gp (room_id, seat_no, user_id, round_no, hand, version)
  select p_room, (x->>'seat')::int, (x->>'userId')::uuid, p_round, x->'hand', p_version
  from jsonb_array_elements(coalesce(p_privates, '[]'::jsonb)) x
  on conflict (room_id, seat_no) do update set user_id = excluded.user_id, round_no = excluded.round_no,
    hand = excluded.hand, version = excluded.version
  where gp.version < excluded.version;
  return true;
end $$;
revoke all on function public.publish_state(uuid, int, int, jsonb, int[], timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.publish_state(uuid, int, int, jsonb, int[], timestamptz, jsonb) to service_role;
revoke all on function public.begin_round(uuid) from public, anon, authenticated;
grant execute on function public.begin_round(uuid) to service_role;

-- ---------- 4) 나가기: 남의 마감은 건드리지 않고 '나간 자리 처리 필요'만 표시 ----------
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
    if rm.status = 'waiting' then
      perform public._make_ai(p_room, s.seat_no);
    else
      update public.room_seats set left_game = true, ready = false where room_id = p_room and seat_no = s.seat_no;
      -- 이 사람 차례였으면 cron이 그 자리만 AI로 바로 처리한다
      update public.game_states set auto_due = true where room_id = p_room and s.seat_no = any(pending_seats);
    end if;
  end if;
  if rm.status = 'waiting' then perform public._fix_room(p_room);
  else update public.game_rooms set updated_at = now() where id = p_room; end if;
end $$;
revoke all on function public._leave(uuid, uuid) from public, anon, authenticated;

-- ---------- 6) 방 만들기·입장: 사용자 단위로 한 줄로 세운다 ----------
create or replace function public.create_room(p_game text, p_name text, p_password text, p_base_unit int, p_avatar text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); nick text; rid uuid; i int; av text;
begin
  if uid is null then raise exception 'need login'; end if;
  perform pg_advisory_xact_lock(hashtext('sia-user:' || uid::text));
  select nickname into nick from public.profiles where id = uid;
  if nick is null then raise exception 'need login'; end if;
  if p_game not in ('matgo', 'poker', 'blackjack') then raise exception 'bad game'; end if;
  if p_base_unit not in (100, 500, 1000) then raise exception 'bad unit'; end if;
  if not (p_avatar = any(public._zodiac())) then raise exception 'bad avatar'; end if;
  if char_length(coalesce(p_password, '')) > 20 then raise exception 'bad password'; end if;
  p_name := trim(coalesce(p_name, ''));
  if p_name = '' then p_name := nick || '의 방'; end if;
  p_name := left(p_name, 20);
  perform public._ensure_wallet(uid);
  if coalesce(public._balance(uid, p_game), 0) < p_base_unit * 50 then raise exception 'not enough money'; end if;
  perform public._leave_all(uid);

  insert into public.game_rooms (game, name, has_password, base_unit, host_id)
  values (p_game, p_name, coalesce(p_password, '') <> '', p_base_unit, uid) returning id into rid;
  if coalesce(p_password, '') <> '' then
    insert into public.room_secrets (room_id, password_hash) values (rid, crypt(p_password, gen_salt('bf', 8)));
  end if;
  insert into public.room_seats (room_id, seat_no, user_id, nickname, avatar, ready)
  values (rid, 0, uid, nick, p_avatar, false);
  for i in 1 .. public._seat_count(p_game) - 1 loop
    av := public._free_animal(rid);
    insert into public.room_seats (room_id, seat_no, user_id, nickname, avatar, ready)
    values (rid, i, null, 'AI ' || public._zodiac_name(av), av, true);
  end loop;
  insert into public.game_states (room_id) values (rid);
  insert into public.game_decks (room_id) values (rid);
  return rid;
end $$;

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

  if rm.status = 'waiting' then
    select * into s from public.room_seats where room_id = p_room and user_id is null order by seat_no limit 1 for update;
    if not found then raise exception 'room full'; end if;
    select seat_no into other from public.room_seats where room_id = p_room and avatar = p_avatar and seat_no <> s.seat_no;
    if other is not null then
      update public.room_seats set avatar = public._free_animal(p_room, p_avatar) where room_id = p_room and seat_no = other;
      update public.room_seats set nickname = 'AI ' || public._zodiac_name(avatar) where room_id = p_room and seat_no = other;
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

-- 판 끝: 이미 다른 방에 앉은 예약자는 건너뛴다 (판이 끝나지 못하고 멈추지 않게)
create or replace function public.finish_round(p_room uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare s public.room_seats; other int;
begin
  perform 1 from public.game_rooms where id = p_room for update;
  if not found then return false; end if;
  for s in select * from public.room_seats where room_id = p_room and left_game loop
    perform public._make_ai(p_room, s.seat_no);
  end loop;
  for s in select * from public.room_seats where room_id = p_room and pending_user_id is not null loop
    if exists (select 1 from public.room_seats o where o.user_id = s.pending_user_id and not o.left_game) then
      update public.room_seats set pending_user_id = null, pending_nickname = null, pending_avatar = null
      where room_id = p_room and seat_no = s.seat_no;
      continue;
    end if;
    select seat_no into other from public.room_seats where room_id = p_room and avatar = s.pending_avatar and seat_no <> s.seat_no;
    if other is not null then
      update public.room_seats set avatar = public._free_animal(p_room, s.pending_avatar) where room_id = p_room and seat_no = other;
      update public.room_seats set nickname = 'AI ' || public._zodiac_name(avatar) where room_id = p_room and seat_no = other and user_id is null;
    end if;
    update public.room_seats set user_id = s.pending_user_id, nickname = s.pending_nickname, avatar = s.pending_avatar,
      pending_user_id = null, pending_nickname = null, pending_avatar = null, left_game = false,
      joined_at = now(), last_seen = now()
    where room_id = p_room and seat_no = s.seat_no;
  end loop;
  update public.room_seats set ready = (user_id is null) where room_id = p_room;
  update public.game_rooms set status = 'waiting', updated_at = now() where id = p_room;
  update public.game_states set pending_seats = '{}', turn_deadline = null, auto_due = false where room_id = p_room;
  return public._fix_room(p_room);
end $$;
revoke all on function public.finish_round(uuid) from public, anon, authenticated;
grant execute on function public.finish_round(uuid) to service_role;

-- ---------- 5) cron: 마감 지남 / 나간 자리 처리 / 멈춘 방 ----------
create or replace function public.cron_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare due jsonb; sec text; url text;
begin
  perform public.sweep_rooms();
  select jsonb_agg(jsonb_build_object(
      'id', gs.room_id, 'version', d.version,
      -- 마감 전인데 나간 자리만 처리할 때: 남은 사람은 건드리지 않는다
      'autoOnly', gs.auto_due and gs.turn_deadline is not null and gs.turn_deadline > now()
    )) into due
  from public.game_states gs
  join public.game_rooms r on r.id = gs.room_id
  join public.game_decks d on d.room_id = gs.room_id
  where r.status = 'playing' and (
    (gs.turn_deadline is not null and gs.turn_deadline <= now())
    or gs.auto_due
    -- 시작·정산 도중 오류로 멈춘 방 (마감 없음 + 1분 넘게 변화 없음)
    or (gs.turn_deadline is null and gs.updated_at < now() - interval '60 seconds')
  );
  if due is null then return; end if;
  -- 처리하는 동안 다시 보내지 않도록
  update public.game_states set
    turn_deadline = case when turn_deadline is not null and turn_deadline <= now() then now() + interval '15 seconds' else turn_deadline end,
    auto_due = false,
    updated_at = case when turn_deadline is null then now() else updated_at end
  where room_id in (select (x->>'id')::uuid from jsonb_array_elements(due) x);
  select value into sec from public.app_config where key = 'cron_secret';
  select value into url from public.app_config where key = 'functions_url';
  perform net.http_post(
    url := url || '/game-timeout',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', sec),
    body := jsonb_build_object('rooms', due)
  );
end $$;
revoke all on function public.cron_tick() from public, anon, authenticated;

-- ---------- 7) 무료 충전: 기준 금액은 서버가 정한다 ----------
-- 그 화폐를 쓰는 방에 앉아 있으면 그 방의 최소 입장 금액, 아니면 가장 작은 방(5,000) 기준.
-- (p_min_required는 예전 호출과 맞추려고 남겨 두지만 쓰지 않는다)
create or replace function public.refill(p_currency text, p_min_required bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.wallets; today date := public._kst_today(); bal bigint; used int; added bigint; need bigint;
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
  added := 10000 - bal;
  if p_currency = 'chips' then
    update public.wallets set chips = 10000, chips_refills_today = chips_refills_today + 1 where user_id = auth.uid() returning * into w;
  else
    update public.wallets set nyang = 10000, nyang_refills_today = nyang_refills_today + 1 where user_id = auth.uid() returning * into w;
  end if;
  insert into public.wallet_logs (user_id, currency, amount, reason) values (auth.uid(), p_currency, added, 'refill');
  return public._wallet_json(w) || jsonb_build_object('ok', true);
end $$;

-- ---------- 8) 권한 정리 ----------
revoke truncate, references, trigger on public.profiles, public.wallets, public.wallet_logs, public.game_rooms,
  public.room_seats, public.game_states, public.game_private from anon, authenticated;
