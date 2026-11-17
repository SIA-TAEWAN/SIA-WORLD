-- 026: 십이지신 룰렛 (시아카지노)
--  - 방 종류 roulette: 자리 8개, AI 없음 (빈자리 줄은 user_id null, 이름 '빈자리')
--  - 게임 중에도 빈자리에 바로 앉고(다음 베팅부터), 나가면 바로 빈자리로
--  - 확정 베팅은 칩을 먼저 빼고 roulette_bets에 기록, 결과가 나오면 기록 기준으로 지급 (같은 스핀·사람은 한 번만)

alter table public.game_rooms drop constraint if exists game_rooms_game_check;
alter table public.game_rooms add constraint game_rooms_game_check check (game in ('matgo', 'poker', 'blackjack', 'holdem', 'roulette'));

create or replace function public._seat_count(p_game text) returns int language sql immutable as $$
  select case p_game when 'matgo' then 2 when 'roulette' then 8 else 4 end
$$;

create or replace function public.create_room(p_game text, p_name text, p_password text, p_base_unit int, p_avatar text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); nick text; rid uuid; i int; av text;
begin
  if uid is null then raise exception 'need login'; end if;
  perform pg_advisory_xact_lock(hashtext('sia-user:' || uid::text));
  select nickname into nick from public.profiles where id = uid;
  if nick is null then raise exception 'need login'; end if;
  if p_game not in ('matgo', 'poker', 'blackjack', 'holdem', 'roulette') then raise exception 'bad game'; end if;
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
    -- 룰렛은 AI가 없다: 빈자리 (화면에서 숨긴다)
    insert into public.room_seats (room_id, seat_no, user_id, nickname, avatar, ready)
    values (rid, i, null, case when p_game = 'roulette' then '빈자리' else 'AI ' || public._zodiac_name(av) end, av, true);
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

  -- 룰렛은 게임 중에도 빈자리에 바로 앉는다 (다음 베팅부터 참여)
  if rm.status = 'waiting' or rm.game = 'roulette' then
    select * into s from public.room_seats where room_id = p_room and user_id is null and pending_user_id is null order by seat_no limit 1 for update;
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
      end if;
    else
      update public.room_seats set left_game = true, ready = false where room_id = p_room and seat_no = s.seat_no;
      -- 이 사람 차례였으면 cron이 그 자리만 AI로 바로 처리한다
      update public.game_states set auto_due = true where room_id = p_room and s.seat_no = any(pending_seats);
    end if;
  end if;
  if rm.status = 'waiting' or rm.game = 'roulette' then perform public._fix_room(p_room);
  else update public.game_rooms set updated_at = now() where id = p_room; end if;
end $$;

-- ---------- 베팅 기록 ----------
create table if not exists public.roulette_bets (
  room_id uuid not null,
  round_no int not null,
  spin_no int not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  bets jsonb not null,
  total bigint not null check (total > 0),
  result int,
  payout bigint,
  created_at timestamptz not null default now(),
  primary key (room_id, round_no, spin_no, user_id)
);
create index if not exists roulette_bets_user on public.roulette_bets (user_id, created_at desc);
alter table public.roulette_bets enable row level security;
drop policy if exists roulette_bets_own on public.roulette_bets;
create policy roulette_bets_own on public.roulette_bets for select using (user_id = auth.uid());
revoke all on public.roulette_bets from anon, authenticated;
grant select on public.roulette_bets to authenticated;

-- 이 베팅이 결과 칸에 맞는가 (roulette.ts의 hits와 같다)
create or replace function public._roulette_hit(p_kind text, p_target int, p_result int) returns boolean
language sql immutable as $$
  select case p_kind
    when 'zodiac' then p_result = p_target
    when 'pair' then p_result = p_target or p_result = (p_target + 1) % 12
    when 'season' then p_result in ((2 + 3 * p_target) % 12, (3 + 3 * p_target) % 12, (4 + 3 * p_target) % 12)
    when 'yinyang' then p_result % 2 = p_target
    else false end
$$;

-- 받는 돈 (건 금액 포함): 띠 ×12 · 이웃 두 칸 ×6 · 계절 ×4 · 음양 ×2
create or replace function public._roulette_payout(p_bets jsonb, p_result int) returns bigint
language sql immutable as $$
  select coalesce(sum((b->>'amount')::bigint * case b->>'kind' when 'zodiac' then 12 when 'pair' then 6 when 'season' then 4 when 'yinyang' then 2 else 0 end)
    filter (where public._roulette_hit(b->>'kind', (b->>'target')::int, p_result)), 0)::bigint
  from jsonb_array_elements(p_bets) b
$$;

-- 확정 베팅: 칩을 먼저 뺀다. 같은 (방, 판, 스핀, 사람)은 한 번만 (다시 불러도 그대로)
create or replace function public.roulette_place_bet(p_room uuid, p_round int, p_spin int, p_user uuid, p_bets jsonb, p_total bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; bal bigint;
begin
  if p_total is null or p_total <= 0 then raise exception 'bad total'; end if;
  insert into public.roulette_bets (room_id, round_no, spin_no, user_id, bets, total)
  values (p_room, p_round, p_spin, p_user, p_bets, p_total) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  perform public._ensure_wallet(p_user);
  select chips into bal from public.wallets where user_id = p_user for update;
  if bal < p_total then raise exception 'not enough money'; end if;
  update public.wallets set chips = chips - p_total where user_id = p_user;
  insert into public.wallet_logs (user_id, currency, amount, reason, game_id)
  values (p_user, 'chips', -p_total, 'game', 'roulette:' || p_room || ':' || p_round || ':' || p_spin);
  return true;
end $$;

-- 결과 지급: 아직 지급하지 않은 그 스핀의 기록마다 한 번
create or replace function public.roulette_pay(p_room uuid, p_round int, p_spin int, p_result int)
returns int language plpgsql security definer set search_path = public as $$
declare b public.roulette_bets; pay bigint; n int := 0;
begin
  if p_result < 0 or p_result > 11 then raise exception 'bad result'; end if;
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
grant execute on function public.roulette_place_bet(uuid, int, int, uuid, jsonb, bigint) to service_role;
grant execute on function public.roulette_pay(uuid, int, int, int) to service_role;
