-- 036: 전체 검사 반영 (승패·시아코인을 조작으로 모으지 못하게)
--   1. 시아탱크 방 함수: 로그인한 본인만 부를 수 있다 (예전에는 로그인 없이도, 남의 id를 넣어서도 부를 수 있었다)
--      · end_game: 그 방의 참가자만. 시작한 지 20초가 안 된 판은 승패·코인 없이 방만 정리
--   2. 시아배구: 한 사람은 한 번에 한 경기만, 같은 두 사람의 경기는 하루 30판까지만 기록, 최소 경기 시간 15초
--   3. 시아코인: 한 사람이 하루(한국 시간)에 받을 수 있는 코인은 100개까지
-- 주의: 아래 탱크 함수들은 예전 함수의 이름을 _..._unchecked 로 바꾸고 같은 이름의 '확인 후 넘기는' 함수를 새로 만든 것이다.
--       나중에 이 함수들의 동작을 바꿀 때는 _..._unchecked 쪽을 고친다 (겉 함수를 create or replace 하면 본인 확인이 사라진다).

-- ---------- 1. 시아탱크 ----------

-- 부른 사람이 로그인한 본인인가 (p_claimed: 화면이 넘긴 플레이어 id)
create or replace function public._tank_me(p_claimed text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or p_claimed is null or auth.uid()::text <> p_claimed then raise exception 'need login'; end if;
end $$;
revoke all on function public._tank_me(text) from public, anon, authenticated;

-- 부른 사람이 그 방의 참가자인가
create or replace function public._tank_in_room(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.rooms r, jsonb_array_elements(r.players) e where r.id = p_id and e->>'id' = auth.uid()::text)
$$;
revoke all on function public._tank_in_room(uuid) from public, anon, authenticated;

alter table public.rooms add column if not exists started_at timestamptz;

alter function public.start_game(uuid, text, bigint) rename to _start_game_unchecked;
alter function public.quit_game(uuid, text) rename to _quit_game_unchecked;
alter function public.touch_room(uuid, text) rename to _touch_room_unchecked;
alter function public.leave_room(uuid, text) rename to _leave_room_unchecked;
alter function public.kick_player(uuid, text, text) rename to _kick_player_unchecked;
alter function public.set_room_options(uuid, text, real, text) rename to _set_room_options_unchecked;
alter function public.set_room_mode(uuid, text, text) rename to _set_room_mode_unchecked;
alter function public.set_room_map(uuid, text, text) rename to _set_room_map_unchecked;
revoke all on function public._start_game_unchecked(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public._quit_game_unchecked(uuid, text) from public, anon, authenticated;
revoke all on function public._touch_room_unchecked(uuid, text) from public, anon, authenticated;
revoke all on function public._leave_room_unchecked(uuid, text) from public, anon, authenticated;
revoke all on function public._kick_player_unchecked(uuid, text, text) from public, anon, authenticated;
revoke all on function public._set_room_options_unchecked(uuid, text, real, text) from public, anon, authenticated;
revoke all on function public._set_room_mode_unchecked(uuid, text, text) from public, anon, authenticated;
revoke all on function public._set_room_map_unchecked(uuid, text, text) from public, anon, authenticated;

create function public.start_game(p_id uuid, p_host text, p_seed bigint) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  perform public._tank_me(p_host);
  r := public._start_game_unchecked(p_id, p_host, p_seed);
  update public.rooms set started_at = now() where id = p_id returning * into r;
  return r;
end $$;

create function public.quit_game(p_id uuid, p_player text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._tank_me(p_player);
  perform public._quit_game_unchecked(p_id, p_player);
end $$;

create function public.touch_room(p_id uuid, p_player text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._tank_me(p_player);
  perform public._touch_room_unchecked(p_id, p_player);
end $$;

-- 나가기: 본인이 나가거나, 같은 방 사람이 연결이 끊긴 사람을 내보낸다 (화면이 그렇게 쓴다)
create function public.leave_room(p_id uuid, p_player_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  if auth.uid()::text <> coalesce(p_player_id, '') and not public._tank_in_room(p_id) then raise exception 'not in room'; end if;
  perform public._leave_room_unchecked(p_id, p_player_id);
end $$;

create function public.kick_player(p_id uuid, p_host text, p_target text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._tank_me(p_host);
  perform public._kick_player_unchecked(p_id, p_host, p_target);
end $$;

create function public.set_room_options(p_id uuid, p_player text, p_speed real, p_wind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._tank_me(p_player);
  perform public._set_room_options_unchecked(p_id, p_player, p_speed, p_wind);
end $$;

create function public.set_room_mode(p_id uuid, p_player text, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._tank_me(p_player);
  perform public._set_room_mode_unchecked(p_id, p_player, p_mode);
end $$;

create function public.set_room_map(p_id uuid, p_player text, p_map text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._tank_me(p_player);
  perform public._set_room_map_unchecked(p_id, p_player, p_map);
end $$;

revoke all on function public.start_game(uuid, text, bigint), public.quit_game(uuid, text), public.touch_room(uuid, text),
  public.leave_room(uuid, text), public.kick_player(uuid, text, text), public.set_room_options(uuid, text, real, text),
  public.set_room_mode(uuid, text, text), public.set_room_map(uuid, text, text) from public, anon;
grant execute on function public.start_game(uuid, text, bigint), public.quit_game(uuid, text), public.touch_room(uuid, text),
  public.leave_room(uuid, text), public.kick_player(uuid, text, text), public.set_room_options(uuid, text, real, text),
  public.set_room_mode(uuid, text, text), public.set_room_map(uuid, text, text) to authenticated;

-- 판 정산 (035와 같고): 그 방의 참가자만 부를 수 있고, 시작한 지 20초가 안 된 판은 승패·코인 없이 방만 정리한다
create or replace function public.end_game(p_id uuid, p_game_no int, p_present text[], p_winner int default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb; e jsonb; won boolean; uid uuid;
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'playing' or r.game_no <> p_game_no then return; end if;
  if not exists (select 1 from jsonb_array_elements(r.players) x where x->>'id' = auth.uid()::text) then raise exception 'not in room'; end if;
  if p_winner in (0, 1) and r.map <> 'target' and r.started_at is not null and r.started_at <= now() - interval '20 seconds' then
    for e in select * from jsonb_array_elements(r.players) loop
      continue when (e->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
      uid := (e->>'id')::uuid;
      continue when not exists (select 1 from public.profiles pr where pr.id = uid);
      won := (e->>'team')::int = p_winner;
      insert into public.player_points as pp (user_id, points, wins, losses)
      values (uid, 1000, case when won then 1 else 0 end, case when won then 0 else 1 end)
      on conflict (user_id) do update set
        wins = pp.wins + case when won then 1 else 0 end,
        losses = pp.losses + case when won then 0 else 1 end,
        updated_at = now();
      if (e->>'id') = any(p_present) and not ((e->>'id') = any(r.gone)) then
        perform public._grant_sia_coin(uid, 'tank', p_id || ':' || p_game_no);
      end if;
    end loop;
  end if;
  select coalesce(jsonb_agg(x || '{"items":[],"ready":false}'::jsonb), '[]'::jsonb) into rest
  from jsonb_array_elements(r.players) x where x->>'id' = any(p_present) and not (x->>'id' = any(r.gone));
  if jsonb_array_length(rest) = 0 then
    delete from public.rooms where id = p_id;
  else
    update public.rooms set status = 'waiting', players = rest, gone = '{}',
      host_id = case when exists (select 1 from jsonb_array_elements(rest) x where x->>'id' = r.host_id) then r.host_id else rest->0->>'id' end,
      updated_at = now()
    where id = p_id;
  end if;
end $$;
revoke all on function public.end_game(uuid, int, text[], int) from public, anon;
grant execute on function public.end_game(uuid, int, text[], int) to authenticated;

-- ---------- 2. 시아배구 ----------

-- 최소 경기 시간 5초 → 15초 (나머지는 034와 같다)
create or replace function public._volleyball_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'win_score' then 3
    when 'min_sec' then 15           -- live 뒤 이보다 빨리 끝난 경기는 받지 않는다
    when 'max_sec' then 1800
    when 'settle_sec' then 10
    when 'dispute_sec' then 1800
    when 'no_window_sec' then 600
    when 'begin_gap_sec' then 3
    when 'pair_per_day' then 30      -- 같은 두 사람의 경기는 하루(한국 시간) 이만큼까지만 기록한다
  end
$$;
revoke all on function public._volleyball_const(text) from public, anon, authenticated;

-- 경기 시작 (034의 함수 앞에 확인 두 가지를 붙였다):
--   · 같은 두 사람이 오늘 이미 30판을 기록했으면 거절 ('daily limit'. 경기는 할 수 있고 기록만 안 된다)
--   · 내가 들어 있는 다른 경기(아직 아무도 결과를 보고하지 않은 pending·live)는 무효로 한다 → 한 사람은 한 번에 한 경기만
alter function public.volleyball_begin(text, bigint, int, uuid, text) rename to _volleyball_begin_unchecked;
revoke all on function public._volleyball_begin_unchecked(text, bigint, int, uuid, text) from public, anon, authenticated;

create function public.volleyball_begin(p_room_key text, p_match_no bigint, p_side int, p_opponent uuid, p_character text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'need login'; end if;
  -- 같은 사람의 시작 요청은 한 번에 하나씩
  perform pg_advisory_xact_lock(hashtext('volley-begin:' || me::text));
  select count(*) into n from public.volleyball_matches
  where status = 'done' and done_at >= (public._kst_today()::timestamp at time zone 'Asia/Seoul')
    and ((left_user_id = me and right_user_id = p_opponent) or (left_user_id = p_opponent and right_user_id = me));
  if n >= public._volleyball_const('pair_per_day') then raise exception 'daily limit'; end if;
  update public.volleyball_matches set status = 'void', done_at = clock_timestamp()
  where status in ('pending', 'live') and (left_user_id = me or right_user_id = me)
    and not (room_key = p_room_key and match_no = p_match_no)
    and left_report is null and right_report is null;
  return public._volleyball_begin_unchecked(p_room_key, p_match_no, p_side, p_opponent, p_character);
end $$;
revoke all on function public.volleyball_begin(text, bigint, int, uuid, text) from public, anon;
grant execute on function public.volleyball_begin(text, bigint, int, uuid, text) to authenticated;

-- ---------- 3. 시아코인: 하루 100개까지 ----------

create or replace function public._grant_sia_coin(p_user uuid, p_game text, p_ref text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_user is null or p_game is null or p_ref is null then return false; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return false; end if;
  perform public._ensure_wallet(p_user);
  -- 같은 사람의 요청은 한 번에 하나씩 (아래 확인이 겹치지 않게)
  perform 1 from public.wallets where user_id = p_user for update;
  if exists (select 1 from public.sia_coin_logs where user_id = p_user and created_at > now() - interval '15 seconds') then return false; end if;
  -- 하루(한국 시간) 100개까지
  select count(*) into n from public.sia_coin_logs
  where user_id = p_user and created_at >= (public._kst_today()::timestamp at time zone 'Asia/Seoul');
  if n >= 100 then return false; end if;
  insert into public.sia_coin_logs (user_id, game, ref) values (p_user, p_game, p_ref) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  update public.wallets set sia_coins = sia_coins + 1 where user_id = p_user;
  return true;
end $$;
revoke all on function public._grant_sia_coin(uuid, text, text) from public, anon, authenticated;
