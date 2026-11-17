-- SIA WORLD 018: 맞고·카지노 공용 방 시스템
-- 방 입장·레디·퇴장은 이 SQL 함수로, 카드 섞기·행동·정산은 Edge Function(game-action)이 service role로 처리한다.
-- 덱과 남의 패는 클라이언트가 읽을 수 없는 테이블에만 있다.

-- ---------- 테이블 ----------

create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('matgo', 'poker', 'blackjack')),
  name text not null check (char_length(name) between 1 and 20),
  has_password boolean not null default false,
  base_unit int not null check (base_unit in (100, 500, 1000)),
  host_id uuid references public.profiles(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'playing')),
  round_no int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists game_rooms_game_idx on public.game_rooms (game, created_at);

-- 방 비밀번호 해시 (아무도 직접 못 읽음)
create table if not exists public.room_secrets (
  room_id uuid primary key references public.game_rooms(id) on delete cascade,
  password_hash text not null
);

create table if not exists public.room_seats (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  seat_no int not null,
  user_id uuid references public.profiles(id) on delete cascade,  -- null = AI
  nickname text not null,                                          -- 사람: 닉네임, AI: 'AI 호랑이'
  avatar text not null,                                            -- 십이지신 id
  ready boolean not null default false,
  left_game boolean not null default false,                        -- 판 도중 나감 → 이번 판은 AI가 대신, 판이 끝나면 AI 자리
  pending_user_id uuid references public.profiles(id) on delete cascade,  -- 게임 중 들어와 다음 판부터 이 자리에 앉을 사람
  pending_nickname text,
  pending_avatar text,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_id, seat_no)
);
-- 한 사람은 한 번에 한 방에만 (판 도중 나간 자리는 제외)
create unique index if not exists room_seats_one_room on public.room_seats (user_id) where user_id is not null and not left_game;
create unique index if not exists room_seats_one_pending on public.room_seats (pending_user_id) where pending_user_id is not null;

-- 방 참가자 모두가 읽는 공개 상태
create table if not exists public.game_states (
  room_id uuid primary key references public.game_rooms(id) on delete cascade,
  round_no int not null default 0,
  public_state jsonb,
  pending_seats int[] not null default '{}',
  turn_deadline timestamptz,
  updated_at timestamptz not null default now()
);

-- 자리별 비공개 패 (본인만 읽음)
create table if not exists public.game_private (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  seat_no int not null,
  user_id uuid references public.profiles(id) on delete cascade,
  round_no int not null default 0,
  hand jsonb,
  primary key (room_id, seat_no)
);

-- 엔진 전체 상태(덱 포함)와 다음 판으로 넘길 값 (클라이언트 접근 불가)
create table if not exists public.game_decks (
  room_id uuid primary key references public.game_rooms(id) on delete cascade,
  version int not null default 0,
  state jsonb,
  carry jsonb
);

-- 판 정산 기록 (같은 판을 두 번 정산하지 않도록)
create table if not exists public.game_results (
  room_id uuid not null,
  round_no int not null,
  game text not null,
  deltas jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, round_no)
);

-- ---------- 권한 ----------

alter table public.game_rooms enable row level security;
alter table public.room_secrets enable row level security;
alter table public.room_seats enable row level security;
alter table public.game_states enable row level security;
alter table public.game_private enable row level security;
alter table public.game_decks enable row level security;
alter table public.game_results enable row level security;

revoke all on public.game_rooms, public.room_secrets, public.room_seats, public.game_states,
  public.game_private, public.game_decks, public.game_results from anon, authenticated;
grant select on public.game_rooms, public.room_seats to authenticated;
grant select on public.game_states, public.game_private to authenticated;

drop policy if exists "rooms_read" on public.game_rooms;
create policy "rooms_read" on public.game_rooms for select to authenticated using (true);
drop policy if exists "seats_read" on public.room_seats;
create policy "seats_read" on public.room_seats for select to authenticated using (true);

-- 이 방에 앉아 있거나 다음 판을 기다리는 사람인가 (RLS 안에서 쓰므로 security definer)
create or replace function public._in_room(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_seats s
    where s.room_id = p_room and (s.user_id = auth.uid() or s.pending_user_id = auth.uid()));
$$;

drop policy if exists "states_read_members" on public.game_states;
create policy "states_read_members" on public.game_states for select to authenticated using (public._in_room(room_id));
drop policy if exists "private_read_own" on public.game_private;
create policy "private_read_own" on public.game_private for select to authenticated using (user_id = auth.uid());
-- room_secrets, game_decks, game_results: 정책 없음 → service role만

-- ---------- 도우미 ----------

create or replace function public._zodiac() returns text[] language sql immutable as $$
  select array['rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig']
$$;
create or replace function public._zodiac_name(p text) returns text language sql immutable as $$
  select case p when 'rat' then '쥐' when 'ox' then '소' when 'tiger' then '호랑이' when 'rabbit' then '토끼'
    when 'dragon' then '용' when 'snake' then '뱀' when 'horse' then '말' when 'sheep' then '양'
    when 'monkey' then '원숭이' when 'rooster' then '닭' when 'dog' then '개' when 'pig' then '돼지' else '?' end
$$;
-- 게임별 자리 수 (맞고 2, 포커 4, 블랙잭 4 — 블랙잭 딜러는 자리가 아니다)
create or replace function public._seat_count(p_game text) returns int language sql immutable as $$
  select case p_game when 'matgo' then 2 else 4 end
$$;
-- 게임별 화폐 잔액
create or replace function public._balance(p_user uuid, p_game text) returns bigint
language sql stable security definer set search_path = public as $$
  select case when p_game = 'matgo' then w.nyang else w.chips end from public.wallets w where w.user_id = p_user
$$;
-- 방에서 아직 안 쓰인 동물 하나 (무작위)
create or replace function public._free_animal(p_room uuid, p_also_taken text default null) returns text
language sql volatile security definer set search_path = public as $$
  select a from unnest(public._zodiac()) a
  where a is distinct from p_also_taken
    and not exists (select 1 from public.room_seats s where s.room_id = p_room and (s.avatar = a or s.pending_avatar = a))
  order by random() limit 1
$$;
-- AI 자리로 바꾸기 (동물은 그대로 쓰되 사람이 쓰는 동물과 안 겹치게)
create or replace function public._make_ai(p_room uuid, p_seat int) returns void
language plpgsql security definer set search_path = public as $$
declare av text;
begin
  select avatar into av from public.room_seats where room_id = p_room and seat_no = p_seat;
  update public.room_seats set user_id = null, nickname = 'AI ' || public._zodiac_name(av), ready = true, left_game = false
  where room_id = p_room and seat_no = p_seat;
end $$;
-- 방장: 먼저 들어온 사람. 사람이 없으면 방 삭제 → 방이 남았으면 true
create or replace function public._fix_room(p_room uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  select user_id into h from public.room_seats
  where room_id = p_room and user_id is not null and not left_game order by joined_at, seat_no limit 1;
  if h is null and not exists (select 1 from public.room_seats where room_id = p_room and pending_user_id is not null) then
    delete from public.game_rooms where id = p_room;
    return false;
  end if;
  update public.game_rooms set host_id = h, updated_at = now() where id = p_room;
  return true;
end $$;

-- 다른 방에 있으면 나온다 (새 방에 들어갈 때)
create or replace function public._leave_all(p_user uuid, p_except uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct room_id from public.room_seats
    where (user_id = p_user and not left_game) or pending_user_id = p_user loop
    if r.room_id is distinct from p_except then perform public._leave(p_user, r.room_id); end if;
  end loop;
end $$;

-- 나가기 (대기 중이면 AI 자리로, 게임 중이면 이번 판은 AI가 대신)
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
      -- 이 사람 차례였으면 바로 시간 초과 처리되게
      update public.game_states set turn_deadline = now()
      where room_id = p_room and s.seat_no = any(pending_seats);
    end if;
  end if;
  -- 게임 중에는 판이 끝날 때 정리한다 (사람이 모두 나가도 AI가 판을 마친다)
  if rm.status = 'waiting' then perform public._fix_room(p_room);
  else update public.game_rooms set updated_at = now() where id = p_room; end if;
end $$;

revoke all on function public._in_room(uuid) from public, anon;
grant execute on function public._in_room(uuid) to authenticated;
revoke all on function public._balance(uuid, text), public._free_animal(uuid, text), public._make_ai(uuid, int),
  public._fix_room(uuid), public._leave_all(uuid, uuid), public._leave(uuid, uuid) from public, anon, authenticated;

-- ---------- 클라이언트용 함수 ----------

-- 방 만들기: 방장 + AI (맞고 1명, 포커·블랙잭 3명) → 방 id
create or replace function public.create_room(p_game text, p_name text, p_password text, p_base_unit int, p_avatar text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); nick text; rid uuid; i int; av text;
begin
  if uid is null then raise exception 'need login'; end if;
  select nickname into nick from public.profiles where id = uid;
  if nick is null then raise exception 'need login'; end if;
  if p_game not in ('matgo', 'poker', 'blackjack') then raise exception 'bad game'; end if;
  if p_base_unit not in (100, 500, 1000) then raise exception 'bad unit'; end if;
  if not (p_avatar = any(public._zodiac())) then raise exception 'bad avatar'; end if;
  p_name := trim(coalesce(p_name, ''));
  if p_name = '' then p_name := nick || '의 방'; end if;
  p_name := left(p_name, 20);
  perform public._ensure_wallet(uid);
  if coalesce(public._balance(uid, p_game), 0) < p_base_unit * 50 then raise exception 'not enough money'; end if;
  perform public._leave_all(uid);

  insert into public.game_rooms (game, name, has_password, base_unit, host_id)
  values (p_game, p_name, coalesce(p_password, '') <> '', p_base_unit, uid) returning id into rid;
  if coalesce(p_password, '') <> '' then
    if char_length(p_password) > 20 then raise exception 'bad password'; end if;
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

-- 입장: AI 자리 하나를 넘겨받는다. 게임 중이면 이번 판은 관전, 다음 판부터 참여.
-- → { seat, pending, avatar }
-- 오류: 'room not found' 'wrong password' 'not enough money' 'room full' 'avatar taken'
create or replace function public.join_room(p_room uuid, p_password text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); nick text; rm public.game_rooms; s public.room_seats; sec text; other int;
begin
  if uid is null then raise exception 'need login'; end if;
  select nickname into nick from public.profiles where id = uid;
  if nick is null then raise exception 'need login'; end if;
  if not (p_avatar = any(public._zodiac())) then raise exception 'bad avatar'; end if;
  select * into rm from public.game_rooms where id = p_room for update;
  if not found then raise exception 'room not found'; end if;

  -- 이미 이 방에 있으면 그대로
  select * into s from public.room_seats where room_id = p_room and user_id = uid and not left_game;
  if found then return jsonb_build_object('seat', s.seat_no, 'pending', false, 'avatar', s.avatar); end if;
  select * into s from public.room_seats where room_id = p_room and pending_user_id = uid;
  if found then return jsonb_build_object('seat', s.seat_no, 'pending', true, 'avatar', s.pending_avatar); end if;

  select password_hash into sec from public.room_secrets where room_id = p_room;
  if sec is not null and (coalesce(p_password, '') = '' or sec <> crypt(p_password, sec)) then
    perform pg_sleep(0.3);
    raise exception 'wrong password';
  end if;
  perform public._ensure_wallet(uid);
  if coalesce(public._balance(uid, rm.game), 0) < rm.base_unit * 50 then raise exception 'not enough money'; end if;
  -- 사람(또는 다음 판 대기자)이 이미 고른 동물이면 다른 동물을 골라야 한다
  if exists (select 1 from public.room_seats where room_id = p_room
             and ((user_id is not null and not left_game and avatar = p_avatar) or pending_avatar = p_avatar)) then
    raise exception 'avatar taken';
  end if;
  perform public._leave_all(uid, p_room);

  if rm.status = 'waiting' then
    select * into s from public.room_seats where room_id = p_room and user_id is null order by seat_no limit 1 for update;
    if not found then raise exception 'room full'; end if;
    -- 원하는 동물을 AI가 쓰고 있으면 그 AI는 남은 동물로 바꾼다
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

  -- 게임 중: AI(또는 나간 사람) 자리를 다음 판부터 받기로 예약
  select * into s from public.room_seats where room_id = p_room and (user_id is null or left_game) and pending_user_id is null
  order by seat_no limit 1 for update;
  if not found then raise exception 'room full'; end if;
  update public.room_seats set pending_user_id = uid, pending_nickname = nick, pending_avatar = p_avatar, last_seen = now()
  where room_id = p_room and seat_no = s.seat_no;
  update public.game_rooms set updated_at = now() where id = p_room;
  return jsonb_build_object('seat', s.seat_no, 'pending', true, 'avatar', p_avatar);
end $$;

-- 레디 (대기 중에만) → 사람이 모두 레디했으면 true (그러면 클라이언트가 game-action 'start'를 부른다)
create or replace function public.set_ready(p_room uuid, p_ready boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); rm public.game_rooms; all_ready boolean;
begin
  if uid is null then raise exception 'need login'; end if;
  select * into rm from public.game_rooms where id = p_room for update;
  if not found then raise exception 'room not found'; end if;
  if rm.status <> 'waiting' then return false; end if;
  update public.room_seats set ready = coalesce(p_ready, false), last_seen = now()
  where room_id = p_room and user_id = uid and not left_game;
  if not found then raise exception 'not in room'; end if;
  select bool_and(ready) into all_ready from public.room_seats where room_id = p_room and user_id is not null and not left_game;
  update public.game_rooms set updated_at = now() where id = p_room;
  return coalesce(all_ready, false);
end $$;

-- 아바타 바꾸기 (대기 중, 사람끼리 겹치지 않게)
create or replace function public.set_avatar(p_room uuid, p_avatar text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); rm public.game_rooms; mine int; other int;
begin
  if uid is null then raise exception 'need login'; end if;
  if not (p_avatar = any(public._zodiac())) then raise exception 'bad avatar'; end if;
  select * into rm from public.game_rooms where id = p_room for update;
  if not found or rm.status <> 'waiting' then return; end if;
  select seat_no into mine from public.room_seats where room_id = p_room and user_id = uid and not left_game;
  if mine is null then raise exception 'not in room'; end if;
  select seat_no into other from public.room_seats where room_id = p_room and avatar = p_avatar and seat_no <> mine;
  if other is not null then
    if exists (select 1 from public.room_seats where room_id = p_room and seat_no = other and user_id is not null) then
      raise exception 'avatar taken';
    end if;
    update public.room_seats set avatar = public._free_animal(p_room, p_avatar) where room_id = p_room and seat_no = other;
    update public.room_seats set nickname = 'AI ' || public._zodiac_name(avatar) where room_id = p_room and seat_no = other;
  end if;
  update public.room_seats set avatar = p_avatar where room_id = p_room and seat_no = mine;
end $$;

create or replace function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  perform public._leave(auth.uid(), p_room);
end $$;

-- 살아 있음 신호 (20초마다). 60초 넘게 없으면 나간 것으로 본다
create or replace function public.touch_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.room_seats set last_seen = now()
  where room_id = p_room and (user_id = auth.uid() or pending_user_id = auth.uid());
end $$;

revoke all on function public.create_room(text, text, text, int, text), public.join_room(uuid, text, text),
  public.set_ready(uuid, boolean), public.set_avatar(uuid, text), public.leave_room(uuid), public.touch_room(uuid) from public, anon;
grant execute on function public.create_room(text, text, text, int, text), public.join_room(uuid, text, text),
  public.set_ready(uuid, boolean), public.set_avatar(uuid, text), public.leave_room(uuid), public.touch_room(uuid) to authenticated;

-- ---------- 서버(Edge Function, service role) 전용 ----------

-- 판 시작: 대기 중이고 사람이 모두 레디면 playing으로 바꾸고 새 판 번호를 돌려준다 (아니면 null)
create or replace function public.begin_round(p_room uuid) returns int
language plpgsql security definer set search_path = public as $$
declare rm public.game_rooms; humans int; not_ready int;
begin
  select * into rm from public.game_rooms where id = p_room for update;
  if not found or rm.status <> 'waiting' then return null; end if;
  select count(*), count(*) filter (where not ready) into humans, not_ready
  from public.room_seats where room_id = p_room and user_id is not null and not left_game;
  if humans = 0 or not_ready > 0 then return null; end if;
  update public.game_rooms set status = 'playing', round_no = round_no + 1, updated_at = now()
  where id = p_room returning round_no into rm.round_no;
  return rm.round_no;
end $$;

-- 판 정산: 사람 자리의 지갑에 반영 (손실은 지금 잔액까지만). 같은 판은 한 번만 → 반영했으면 true
create or replace function public.apply_round_result(p_room uuid, p_round int, p_deltas jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare rm public.game_rooms; s public.room_seats; d bigint; cur text; bal bigint; applied bigint; n int;
begin
  select * into rm from public.game_rooms where id = p_room for update;
  if not found then return false; end if;
  insert into public.game_results (room_id, round_no, game, deltas) values (p_room, p_round, rm.game, p_deltas)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  cur := case when rm.game = 'matgo' then 'nyang' else 'chips' end;
  for s in select * from public.room_seats where room_id = p_room and user_id is not null loop
    d := coalesce((p_deltas ->> s.seat_no::text)::bigint, 0);
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

-- 판 끝: 나간 사람 자리는 AI로, 예약한 사람은 앉히고, 모두 레디 해제 → 대기 상태. 방이 남았으면 true
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
    -- 예약한 동물을 다른 AI가 쓰고 있으면 그 AI는 바꾼다
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
  update public.game_states set pending_seats = '{}', turn_deadline = null where room_id = p_room;
  return public._fix_room(p_room);
end $$;

-- 오래 신호가 없는 사람 정리 (cron에서 부른다)
create or replace function public.sweep_rooms() returns void
language plpgsql security definer set search_path = public as $$
declare x record;
begin
  for x in select room_id, user_id from public.room_seats
    where user_id is not null and not left_game and last_seen < now() - interval '60 seconds' loop
    perform public._leave(x.user_id, x.room_id);
  end loop;
  for x in select room_id, pending_user_id from public.room_seats
    where pending_user_id is not null and last_seen < now() - interval '60 seconds' loop
    perform public._leave(x.pending_user_id, x.room_id);
  end loop;
  -- 사람이 하나도 없는 대기 방
  delete from public.game_rooms r where r.status = 'waiting'
    and not exists (select 1 from public.room_seats s where s.room_id = r.id and (s.user_id is not null or s.pending_user_id is not null));
end $$;

revoke all on function public.begin_round(uuid), public.apply_round_result(uuid, int, jsonb), public.finish_round(uuid), public.sweep_rooms()
  from public, anon, authenticated;
grant execute on function public.begin_round(uuid), public.apply_round_result(uuid, int, jsonb), public.finish_round(uuid), public.sweep_rooms() to service_role;

-- ---------- 실시간 ----------
do $$
begin
  begin alter publication supabase_realtime add table public.game_rooms; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.room_seats; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.game_states; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.game_private; exception when duplicate_object then null; end;
end $$;
