-- 056: AI 대전도 전적·시아코인에 반영 (시아탱크 · 시아배구)
--   시아탱크: 오프라인 AI 1:1 중 '게임 모드 일반 + AI 보통·어려움' 판 → player_points 의 wins/losses (사람 대전 end_game 과 같은 칸)
--   시아배구: AI 연습 판 → volleyball_rankings 의 wins/losses (사람 대전 _volleyball_finish 와 같은 칸)
--   두 랭킹 화면은 같은 표를 읽으므로 그대로 반영된다. 탱크 포인트는 1,000 고정 그대로 (035).
--
-- AI 판은 기기 안에서만 진행되므로 서버는 실제 플레이를 볼 수 없다. 서버가 아는 것은 '언제 시작했고 언제 끝났다고 했는가'뿐이다.
-- 그래서 결과를 지어내 올리는 것을 막지는 못하고, 아래 두 가지로 양만 묶는다:
--   · 시작(ai_match_start)과 종료(ai_match_finish) 사이가 최소 시간 이상이어야 한다. 한 사람이 게임별로 열어 둘 수 있는 판은 1개
--   · 전적·코인에 반영되는 AI 판은 게임별로 하루(한국 시간) 30판까지. 넘으면 결과는 받되 전적·코인은 그대로
-- 중간에 그만둔 판: 시작 뒤 최소 시간이 지났으면 패배로 기록한다 (지고 있을 때 나가서 승률을 올리지 못하게).
--   · 화면은 [나가기] 때 '지금 나가면 패배로 기록돼요'를 묻고 ai_match_finish(id, false) 를 올린다
--   · 그냥 창을 닫는 등 종료를 부르지 않은 판도, 다음 ai_match_start 때 같은 게임의 미완료 판을 패배로 마감한다
--     (최소 시간 전 판은 그냥 버린다 · 24시간 넘게 방치된 판도 그냥 버린다). 패배로 마감한 판에는 시아코인을 주지 않는다
--   · 최소 시간 전에 나간 판은 화면이 ai_match_cancel 로 지운다 (안 지우면 설정 화면에서 머무는 동안 최소 시간이 지나 패배가 되므로)
-- 표는 함수만 바꾼다 (직접 쓰기 권한 없음).

-- ---------- 1. 표 ----------

create table if not exists public.ai_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null check (game in ('tank', 'volleyball')),
  difficulty text not null,
  -- 시아배구: 내가 고른 캐릭터 (volleyball_rankings.last_character 에 쓴다). 탱크는 null
  character text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  won boolean,
  -- 전적에 반영했는가 (하루 한도를 넘긴 판은 false)
  counted boolean
);
alter table public.ai_matches enable row level security;
-- 정책 없음 + 권한 없음: 함수(security definer)로만 읽고 쓴다
revoke all on public.ai_matches from anon, authenticated;
create index if not exists ai_matches_user_idx on public.ai_matches (user_id, game, finished_at);
-- 한 사람이 게임별로 열어 둘 수 있는 판은 1개
create unique index if not exists ai_matches_open_idx on public.ai_matches (user_id, game) where finished_at is null;

-- ---------- 2. 기준 값 ----------

-- 게임 쪽 값(games/tank/src/net/aiRecord.ts · games/volleyball/src/net/aiRecord.ts )은 시작 답의 min_sec 를 그대로 쓴다.
create or replace function public._ai_match_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'tank_min_sec' then 20        -- 사람 대전(end_game 의 20초)과 같다. 더 빨리 끝난 판은 화면이 이 시각까지 기다렸다가 올린다
    when 'volleyball_min_sec' then 15  -- 사람 대전(_volleyball_const 'min_sec')과 같다
    when 'max_sec' then 86400          -- 시작한 지 24시간이 넘은 판은 받지 않는다
    when 'per_day' then 30             -- 전적·코인에 반영되는 AI 판: 게임별 하루(한국 시간) 이만큼까지
  end
$$;
revoke all on function public._ai_match_const(text) from public, anon, authenticated;

-- 오늘(한국 시간) 전적에 반영된 내 AI 판 수
create or replace function public._ai_match_today(p_user uuid, p_game text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_matches
  where user_id = p_user and game = p_game and counted
    and finished_at >= (public._kst_today()::timestamp at time zone 'Asia/Seoul')
$$;
revoke all on function public._ai_match_today(uuid, text) from public, anon, authenticated;

-- 끝내지 않은 판 m 을 시각 t 에 won 으로 마감한다 (ai_match_finish 와 ai_match_start 의 '버려진 판 패배'가 같이 쓴다).
-- 오늘 반영된 판이 하루 한도 미만이면 전적 +1 (사람 대전과 같은 표·같은 방식) 하고 counted. 시아코인은 부르는 쪽이 준다.
-- 부르는 쪽이 같은 사람·같은 게임의 advisory lock 과 m 의 행 잠금을 쥐고 있어야 한다. → 전적에 반영했는가
create or replace function public._ai_match_close(m public.ai_matches, p_won boolean, t timestamptz) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  ok := public._ai_match_today(m.user_id, m.game) < public._ai_match_const('per_day');
  update public.ai_matches set finished_at = t, won = p_won, counted = ok where id = m.id;
  if not ok then return false; end if;
  if m.game = 'tank' then
    -- end_game (036) 과 같은 방식: 포인트는 1,000 고정, 승·패만 +1
    insert into public.player_points as pp (user_id, points, wins, losses)
    values (m.user_id, 1000, case when p_won then 1 else 0 end, case when p_won then 0 else 1 end)
    on conflict (user_id) do update set
      wins = pp.wins + case when p_won then 1 else 0 end,
      losses = pp.losses + case when p_won then 0 else 1 end,
      updated_at = now();
  else
    -- _volleyball_finish (034) 와 같은 방식: 이기면 승 +1 과 '지금 승수에 도달한 시각' 갱신, 지면 패 +1
    if p_won then
      insert into public.volleyball_rankings as r (user_id, wins, losses, last_character, reached_at, updated_at)
      values (m.user_id, 1, 0, m.character, t, t)
      on conflict (user_id) do update set wins = r.wins + 1, last_character = excluded.last_character, reached_at = excluded.reached_at, updated_at = excluded.updated_at;
    else
      insert into public.volleyball_rankings as r (user_id, wins, losses, last_character, reached_at, updated_at)
      values (m.user_id, 0, 1, m.character, t, t)
      on conflict (user_id) do update set losses = r.losses + 1, last_character = excluded.last_character, updated_at = excluded.updated_at;
    end if;
  end if;
  return true;
end $$;
revoke all on function public._ai_match_close(public.ai_matches, boolean, timestamptz) from public, anon, authenticated;

-- ---------- 3. 판 시작 ----------

-- AI 판을 시작할 때 부른다. 서버가 시작 시각을 적는다.
--   p_game 'tank'       : p_difficulty 'normal' | 'hard' 만 (쉬움은 반영하지 않는다). p_character 는 쓰지 않는다
--   p_game 'volleyball' : p_difficulty 'normal' (AI 난이도가 하나뿐), p_character 는 내 캐릭터
-- 같은 게임의 끝내지 않은 내 예전 판: 시작 뒤 최소 시간이 지났고 24시간 안이면 패배로 마감(전적 패 +1, 코인 없음), 아니면 버린다.
-- → { id, min_sec: 이 시간이 지나야 종료를 받는다, today: 오늘 반영된 판 수, per_day: 하루 한도 }
create or replace function public.ai_match_start(p_game text, p_difficulty text, p_character text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz := clock_timestamp(); new_id uuid; old public.ai_matches; age numeric;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_game is null or p_game not in ('tank', 'volleyball') then raise exception 'bad game'; end if;
  if p_game = 'tank' then
    if p_difficulty is null or p_difficulty not in ('normal', 'hard') then raise exception 'bad difficulty'; end if;
    p_character := null;
  else
    if p_difficulty is distinct from 'normal' then raise exception 'bad difficulty'; end if;
    if p_character is null or p_character not in ('rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig') then raise exception 'bad character'; end if;
  end if;
  -- 같은 사람·같은 게임의 요청은 한 번에 하나씩
  perform pg_advisory_xact_lock(hashtext('ai-match:' || me::text || ':' || p_game));
  -- 끝내지 않은 예전 판 (열린 판은 많아야 1개): 최소 시간이 지났으면 도중에 나간 것으로 보고 패배, 아니면 버린다
  select * into old from public.ai_matches where user_id = me and game = p_game and finished_at is null for update;
  if found then
    age := extract(epoch from (t - old.started_at));
    if age >= public._ai_match_const(p_game || '_min_sec') and age <= public._ai_match_const('max_sec') then
      perform public._ai_match_close(old, false, t);
    else
      delete from public.ai_matches where id = old.id;
    end if;
  end if;
  -- 끝난 판은 30일 뒤 지운다 (하루 한도를 세는 데는 오늘 것만 있으면 된다)
  delete from public.ai_matches where user_id = me and game = p_game and finished_at < t - interval '30 days';
  insert into public.ai_matches (user_id, game, difficulty, character, started_at)
  values (me, p_game, p_difficulty, p_character, t) returning id into new_id;
  return jsonb_build_object(
    'id', new_id,
    'min_sec', public._ai_match_const(p_game || '_min_sec'),
    'today', public._ai_match_today(me, p_game),
    'per_day', public._ai_match_const('per_day'));
end $$;
revoke all on function public.ai_match_start(text, text, text) from public, anon;
grant execute on function public.ai_match_start(text, text, text) to authenticated;

-- ---------- 4. 판 종료 ----------

-- 판이 끝나(승패 확정) 부른다. 도중에 나갈 때(최소 시간이 지난 판)도 p_won = false 로 부른다. 본인의 끝내지 않은 판만, 시작 뒤 최소 시간이 지났고 24시간이 넘지 않았을 때만 받는다.
-- 받으면: 오늘 반영된 판이 30판 미만일 때 전적 +1 (사람 대전과 같은 표·같은 방식)과 시아코인.
-- → { status: 'done', counted: 전적에 반영했는가, coin: 시아코인을 받았는가, wins, losses: 지금 내 전적, today, per_day }
--    counted 가 false 면 하루 한도를 넘긴 판이다.
create or replace function public.ai_match_finish(p_id uuid, p_won boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t timestamptz := clock_timestamp(); m public.ai_matches;
  age numeric; n int; ok boolean; coin boolean := false; w int := 0; l int := 0;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_won is null then raise exception 'bad result'; end if;
  -- 없는 판과 남의 판은 같은 답 (남의 판 번호가 있는지 알려 주지 않는다)
  select * into m from public.ai_matches where id = p_id;
  if not found or m.user_id <> me then raise exception 'no match'; end if;
  -- 같은 사람·같은 게임의 요청은 한 번에 하나씩 (하루 한도를 세는 것이 겹치지 않게). ai_match_start 와 같은 순서(잠금 → 행)로 잡는다
  perform pg_advisory_xact_lock(hashtext('ai-match:' || me::text || ':' || m.game));
  select * into m from public.ai_matches where id = p_id for update;
  if not found then raise exception 'no match'; end if;
  if m.finished_at is not null then raise exception 'already finished'; end if;
  age := extract(epoch from (t - m.started_at));
  if age < public._ai_match_const(m.game || '_min_sec') then raise exception 'too early'; end if;
  if age > public._ai_match_const('max_sec') then raise exception 'too late'; end if;

  ok := public._ai_match_close(m, p_won, t);
  n := public._ai_match_today(me, m.game);
  -- 시아코인: 이미 준 판·15초 안 중복·하루 100개는 _grant_sia_coin 이 알아서 false
  if ok then coin := public._grant_sia_coin(me, m.game, 'ai:' || m.id::text); end if;

  if m.game = 'tank' then
    select pp.wins, pp.losses into w, l from public.player_points pp where pp.user_id = me;
  else
    select r.wins, r.losses into w, l from public.volleyball_rankings r where r.user_id = me;
  end if;
  return jsonb_build_object('status', 'done', 'counted', ok, 'coin', coin,
    'wins', coalesce(w, 0), 'losses', coalesce(l, 0), 'today', n, 'per_day', public._ai_match_const('per_day'));
end $$;
revoke all on function public.ai_match_finish(uuid, boolean) from public, anon;
grant execute on function public.ai_match_finish(uuid, boolean) to authenticated;

-- ---------- 5. 최소 시간 전에 나간 판 지우기 ----------

-- 최소 시간이 지나기 전에 나간 판은 기록 없이 지운다 (그대로 두면 다음 시작 때 최소 시간이 지나 있어 패배가 된다).
-- 화면이 '아직 최소 시간 전'이라고 본 뒤 요청이 닿기까지의 틈을 생각해 10초 여유를 둔다. 그보다 늦으면 지우지 않는다.
-- → { status: 'cancelled' 지웠다 | 'kept' 최소 시간이 지나 그대로 둔다 | 'none' 지울 판이 없다(없는 판·남의 판·끝난 판) }
create or replace function public.ai_match_cancel(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz := clock_timestamp(); m public.ai_matches;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into m from public.ai_matches where id = p_id;
  if not found or m.user_id <> me or m.finished_at is not null then return jsonb_build_object('status', 'none'); end if;
  perform pg_advisory_xact_lock(hashtext('ai-match:' || me::text || ':' || m.game));
  if extract(epoch from (t - m.started_at)) >= public._ai_match_const(m.game || '_min_sec') + 10 then
    return jsonb_build_object('status', 'kept');
  end if;
  delete from public.ai_matches where id = m.id and finished_at is null;
  return jsonb_build_object('status', case when found then 'cancelled' else 'none' end);
end $$;
revoke all on function public.ai_match_cancel(uuid) from public, anon;
grant execute on function public.ai_match_cancel(uuid) to authenticated;
