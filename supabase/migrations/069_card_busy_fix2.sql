-- 069: 068 의 '판이 끝나지 않은 다른 카드 방' 검사 다시 보강
--   1) 멈춘 방 10분 기준이 동작하지 않았다.
--      068 은 game_rooms.updated_at · game_states.updated_at 을 봤는데,
--        · 마감 없는 멈춘 방은 cron_tick(046)이 매분 game-timeout 을 보내며 game_states.updated_at = now() 로 바꾸고,
--        · _leave(020)·입장은 game_rooms.updated_at 을 바꿔서, 누가 들어가고 나가도 10분이 다시 시작됐다.
--      → 판 상태가 실제로 바뀐 시각 game_states.published_at 을 새로 두고 publish_state 에서만 적는다.
--        같은 상태를 다시 공개하면(정산이 실패해 game-timeout 이 끝난 판을 매분 다시 저장하는 경우 등) 바꾸지 않는다.
--        10분 기준 = published_at 과 판 시작 시각(round_started_at) 중 늦은 것. 둘 다 없으면 예전처럼 game_rooms.updated_at.
--        30분 기준(round_started_at)은 그대로.
--   2) 비밀번호 연타: 068 겉 join_room 이 방을 for update 로 잠근 뒤 안쪽 함수가 비밀번호를 검사하고 틀리면 0.3초 쉬어서,
--      틀린 비밀번호를 연타하면 방이 잡혔다(027 이 일부러 피한 것).
--      → 겉 join_room 이 잠그기 전에 같은 검사를 한다 (이미 그 방에 앉았거나 대기 중이면 건너뜀). 잠금 순서는 그대로.
--   publish_state 는 020_rooms_hardening.sql, join_room 은 068 정의 그대로에 표시한 줄만 바꿨다. 여러 번 올려도 된다.

-- 판 상태가 실제로 바뀐 시각 (publish_state 만 적는다). 기존 행은 updated_at 으로 채운다
alter table public.game_states add column if not exists published_at timestamptz;
update public.game_states set published_at = updated_at where published_at is null;
alter table public.game_states alter column published_at set default now();

-- ---------- 판 상태 공개: 내용이 바뀌었을 때만 published_at ----------
create or replace function public.publish_state(p_room uuid, p_version int, p_round int, p_pub jsonb, p_pending int[],
  p_deadline timestamptz, p_privates jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.game_states set round_no = p_round, public_state = p_pub, pending_seats = p_pending,
    turn_deadline = p_deadline, auto_due = false, version = p_version, updated_at = now(),
    -- (069) 같은 상태를 다시 공개한 것은 진행이 아니다
    published_at = case
      when round_no is distinct from p_round or public_state is distinct from p_pub
        or pending_seats is distinct from p_pending then now()
      else published_at end
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

-- ---------- 바쁨 검사: cron·입퇴장이 건드리지 않는 시각으로 ----------
create or replace function public._card_busy_state(p_user uuid, p_except uuid default null) returns text
language sql stable security definer set search_path = public as $$
  select case when bool_or(not s.left_game) then 'seated' when count(*) > 0 then 'left' end
  from public.room_seats s
  join public.game_rooms r on r.id = s.room_id
  left join public.game_states gs on gs.room_id = r.id
  where s.user_id = p_user and r.status = 'playing' and r.game <> 'roulette'
    and r.id is distinct from p_except
    -- 멈춘 방은 빼 준다 (10분 넘게 판 진행 없음, 또는 판 시작 30분 넘음)
    -- (069) 판 상태가 실제로 바뀐 시각 / 판 시작 시각 (greatest 는 null 을 건너뛴다)
    and coalesce(greatest(gs.published_at, r.round_started_at), r.updated_at) >= now() - interval '10 minutes'
    and coalesce(r.round_started_at, r.updated_at) >= now() - interval '30 minutes'
$$;
revoke all on function public._card_busy_state(uuid, uuid) from public, anon, authenticated;

-- ---------- 입장 겉 함수: 비밀번호는 방을 잠그기 전에 ----------
create or replace function public.join_room(p_room uuid, p_password text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); st text; sec text;
begin
  if uid is null then raise exception 'need login'; end if;
  perform pg_advisory_xact_lock(hashtext('sia-user:' || uid::text));
  -- (069) 비밀번호 확인은 방을 잠그기 전에 (틀린 비밀번호 연타로 방이 막히지 않게). 이미 이 방에 있으면 묻지 않는다
  if not exists (select 1 from public.room_seats where room_id = p_room
                 and ((user_id = uid and not left_game) or pending_user_id = uid)) then
    select password_hash into sec from public.room_secrets where room_id = p_room;
    if sec is not null and (coalesce(p_password, '') = '' or sec <> crypt(p_password, sec)) then
      perform pg_sleep(0.3);
      raise exception 'wrong password';
    end if;
  end if;
  -- (068) 검사 전에 내 자리가 있는 방과 들어갈 방을 잠근다 (안쪽 함수가 다시 잡아도 된다)
  perform public._card_lock_rooms(uid, p_room);
  st := public._card_busy_state(uid, p_room);
  if st = 'seated' then raise exception '다른 방에서 판이 진행 중이에요. 그 방으로 돌아가거나 판이 끝난 뒤 들어와 주세요'; end if;
  if st = 'left' then raise exception '이전 판이 아직 끝나지 않았어요. 잠시 뒤 다시 들어와 주세요'; end if;
  return public._card_join_room_unchecked(p_room, p_password, p_avatar);
end $$;
revoke all on function public.join_room(uuid, text, text) from public, anon;
grant execute on function public.join_room(uuid, text, text) to authenticated;
