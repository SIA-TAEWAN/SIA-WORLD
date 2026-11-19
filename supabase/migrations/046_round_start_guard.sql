-- SIA WORLD 046: 판이 막 시작된 방을 '멈춘 방'으로 보지 않는다
--  문제: cron_tick 은 "진행 중인데 마감이 없고 game_states.updated_at 이 60초 넘게 그대로인 방"을 멈춘 방으로 보고 game-timeout 을 부른다.
--        그런데 finish_round · begin_round 는 game_states.updated_at 을 건드리지 않는다. 그래서 대기실에서 60초 넘게 있다가 시작하면,
--        begin_round 가 끝난 뒤 판 상태가 저장되기 전(수백 ms)에 cron 이 오면 그 방이 멈춘 방으로 잡히고,
--        game-timeout 이 "엔진 상태의 판 번호가 방과 다르다"며 방을 대기로 되돌려 그 판은 정산되지 않는다.
--  고침: begin_round 가 판을 시작한 시각을 game_rooms.round_started_at 에 남기고,
--        cron_tick 의 '멈춘 방' 조건에 "판을 시작한 지 60초가 넘었다"를 더한다.
--        (game_states.updated_at 을 begin_round 에서 갱신하지 않는 까닭: 그 행이 Realtime 으로 화면에 가서 지난 판 상태가 새로 도착한다)
--  begin_round · cron_tick 은 020_rooms_hardening.sql 의 정의 그대로에 표시한 줄만 바꿨다. 여러 번 올려도 된다.

-- 이번 판을 시작한 시각 (begin_round 가 적는다. 이 칸이 생기기 전에 시작한 판은 null → 예전과 같이 본다)
alter table public.game_rooms add column if not exists round_started_at timestamptz;

-- ---------- 판 시작: 시작 시각을 남긴다 ----------
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
  -- (046) round_started_at: cron_tick 이 막 시작한 판을 멈춘 방으로 보지 않게
  update public.game_rooms set status = 'playing', round_no = round_no + 1, updated_at = now(), round_started_at = now()
  where id = p_room returning round_no into rm.round_no;
  return rm.round_no;
end $$;
revoke all on function public.begin_round(uuid) from public, anon, authenticated;
grant execute on function public.begin_round(uuid) to service_role;

-- ---------- cron: 마감 지남 / 나간 자리 처리 / 멈춘 방 ----------
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
    -- (046) 판을 시작한 지 1분이 안 된 방은 빼 준다: 판 상태가 아직 저장되지 않았을 뿐이다
    or (gs.turn_deadline is null and gs.updated_at < now() - interval '60 seconds'
        and (r.round_started_at is null or r.round_started_at < now() - interval '60 seconds'))
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
