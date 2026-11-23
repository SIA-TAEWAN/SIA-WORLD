-- 072: 대전 게임 3개(시아탱크·시아레이스·시아배구)에 고양이(cat) 추가
--   캐릭터 검사를 071 의 _check_character(user, character, 게임) 으로 바꾼다 (모르는 id 면 'bad character', 이 게임에서 안 연 고양이면 'locked character').
--   고양이는 게임마다 따로, 각 게임의 캐릭터(탱크) 고르기 화면에서 시아코인으로 연다 (게임 id: 'tank' · 'race' · 'volleyball').
--   능력치는 서버에 없다 (화면 쪽 데이터: 탱크는 tanks.json 의 cat = 어흥이 수치, 레이스·배구는 캐릭터마다 같다).
--   · _valid_player (015)               : 시아탱크 방 create_room·join_room·update_player 가 부른다. 'zodiac'·'random' 밖은 _check_character
--   · race_submit (033)                 : 시아레이스 완주 기록
--   · _volleyball_begin_unchecked (034) : 시아배구 경기 시작 (036 에서 겉 함수 volleyball_begin 이 본인·하루 한도를 보고 이것을 부른다 — 겉 함수는 그대로)
--   · ai_match_start (056)              : 시아배구 AI 대전 (탱크는 캐릭터를 받지 않는다)
-- 각 함수는 가장 마지막 정의를 그대로 옮기고 캐릭터 검사 줄만 바꿨다.
--   5차(구매 조건): 고양이는 그 게임을 30판 한 뒤에 열 수 있다 (탱크·레이스·배구 모두 30판, 배구는 AI전 포함).
--   판 수는 판이 끝날 때 _count_play 로 센다: end_game · submit_target_score · race_submit · _volleyball_finish · ai_match_finish.
--   _cat_progress_tank · _cat_progress_race · _cat_progress_volleyball → {have, need} (맨 아래).

-- ---------- 1. 시아탱크: 방에 들어가는 플레이어 검사 ----------

create or replace function public._valid_player(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  items jsonb := coalesce(p->'items', '[]'::jsonb);
  nick text;
begin
  if auth.uid() is null or coalesce(p->>'id', '') <> auth.uid()::text then raise exception 'need login'; end if;
  select nickname into nick from public.profiles where id = auth.uid();
  if nick is null then raise exception 'need login'; end if;
  -- 'zodiac'(열두빛)·'random' 은 탱크 고르기 전용 값. 나머지는 캐릭터 검사(071)로: 모르는 id 면 'bad character'
  if coalesce(p->>'tank', '') not in ('zodiac', 'random') then
    perform public._check_character(auth.uid(), p->>'tank', 'tank');
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 3 then raise exception 'bad items'; end if;
  if exists (select 1 from jsonb_array_elements_text(items) i where i not in ('double', 'power', 'repair', 'teleport')) then
    raise exception 'bad item';
  end if;
  return jsonb_build_object(
    'id', auth.uid()::text, 'name', nick, 'tank', p->>'tank',
    'team', case when (p->>'team') = '1' then 1 else 0 end,
    'items', items,
    'ready', coalesce((p->>'ready')::boolean, false));
end $$;
revoke all on function public._valid_player(jsonb) from public, anon, authenticated;

-- ---------- 2. 시아레이스: 완주 기록 ----------

create or replace function public.race_submit(p_room_key text, p_round int, p_time_ms int, p_character text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rd public.race_rounds; elapsed numeric; rec public.race_records; old_best int;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'need login'; end if;
  perform public._check_character(auth.uid(), p_character, 'race');
  if p_time_ms is null or p_time_ms < public._race_const('min_ms') or p_time_ms > public._race_const('max_ms') then raise exception 'bad time'; end if;
  select * into rd from public.race_rounds where room_key = p_room_key and round = p_round;
  if not found then raise exception 'no round'; end if;
  -- GO부터 지금까지 흐른 시간과 맞는가
  elapsed := extract(epoch from (clock_timestamp() - rd.go_at)) * 1000;
  if p_time_ms > elapsed + public._race_const('early_ms') or p_time_ms < elapsed - public._race_const('late_ms') then raise exception 'bad time'; end if;
  -- 한 판에 한 번
  begin
    insert into public.race_runs (room_key, round, user_id, time_ms) values (p_room_key, p_round, auth.uid(), p_time_ms);
  exception when unique_violation then raise exception 'already submitted';
  end;
  select best_ms into old_best from public.race_records where user_id = auth.uid();
  insert into public.race_records as r (user_id, best_ms, best_at, character, plays)
  values (auth.uid(), p_time_ms, now(), p_character, 1)
  on conflict (user_id) do update set
    plays = r.plays + 1,
    best_at = case when excluded.best_ms < r.best_ms then excluded.best_at else r.best_at end,
    character = case when excluded.best_ms < r.best_ms then excluded.character else r.character end,
    best_ms = least(r.best_ms, excluded.best_ms)
  returning * into rec;
  perform public._grant_sia_coin(auth.uid(), 'race', p_room_key || ':' || p_round || ':' || extract(epoch from rd.created_at)::bigint);
  -- 고양이 구매 조건(30판): 완주 기록을 올린 판 (race_runs 가 한 판에 한 번만 받는다)
  perform public._count_play(auth.uid(), 'race');
  return jsonb_build_object('accepted', true, 'time_ms', p_time_ms, 'best_ms', rec.best_ms,
    'improved', old_best is null or p_time_ms < old_best, 'plays', rec.plays);
end $$;
revoke all on function public.race_submit(text, int, int, text) from public, anon;
grant execute on function public.race_submit(text, int, int, text) to authenticated;

-- ---------- 3. 시아배구: 경기 시작 (겉 함수 volleyball_begin 은 036 그대로) ----------

create or replace function public._volleyball_begin_unchecked(p_room_key text, p_match_no bigint, p_side int, p_opponent uuid, p_character text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t timestamptz := clock_timestamp(); m public.volleyball_matches;
  other_cur uuid; other_claim uuid; now_ms numeric;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_room_key is null or p_room_key !~ '^[a-z0-9]{4,24}$' then raise exception 'bad room'; end if;
  if p_side is null or p_side not in (0, 1) then raise exception 'bad side'; end if;
  perform public._check_character(me, p_character, 'volleyball');
  if p_opponent is null or p_opponent = me then raise exception 'bad opponent'; end if;
  if not exists (select 1 from public.profiles where id = p_opponent) then raise exception 'bad opponent'; end if;
  -- 경기 번호는 방장이 서버 시각(ms)으로 만든다: 지금과 너무 다르면 거절 (미리 만들어 두거나 옛 번호를 다시 쓰지 못하게)
  now_ms := extract(epoch from t) * 1000;
  if p_match_no is null or abs(p_match_no - now_ms) > public._volleyball_const('no_window_sec') * 1000.0 then raise exception 'bad match no'; end if;

  -- 같은 경기의 요청은 한 번에 하나씩
  perform pg_advisory_xact_lock(hashtext('volley:' || p_room_key || ':' || p_match_no::text));
  -- 오래된 줄 정리: 시작하지 못했거나 무효가 된 줄(1시간), 끝내 확정되지 않은 줄(3시간)
  delete from public.volleyball_matches where status in ('pending', 'void') and created_at < t - interval '1 hour';
  delete from public.volleyball_matches where status = 'live' and created_at < t - interval '3 hours';

  select * into m from public.volleyball_matches where room_key = p_room_key and match_no = p_match_no for update;
  if not found then
    -- 너무 자주 새 경기를 열지 못하게 (같은 사람 기준)
    if exists (
      select 1 from public.volleyball_matches
      where (left_user_id = me or right_user_id = me)
        and created_at > t - make_interval(secs => public._volleyball_const('begin_gap_sec'))
    ) then raise exception 'too soon'; end if;
    insert into public.volleyball_matches (room_key, match_no, created_at) values (p_room_key, p_match_no, t) returning * into m;
  end if;

  -- 이미 시작했거나 끝난 경기: 참가자에게는 그 경기를 그대로 알려 주고(다시 불러도 같은 답), 남은 거절
  if m.status <> 'pending' then
    if me = m.left_user_id or me = m.right_user_id then
      return jsonb_build_object('match', m.id, 'live', m.status = 'live');
    end if;
    raise exception 'closed';
  end if;

  if p_side = 0 then
    other_cur := m.right_user_id; other_claim := m.right_claim;
  else
    other_cur := m.left_user_id; other_claim := m.left_claim;
  end if;
  -- 내가 이미 반대쪽 자리에 앉아 있다 (자기 자신과의 경기)
  if other_cur = me then raise exception 'bad seat'; end if;
  -- 반대쪽에 앉은 사람이 내가 지목한 상대가 아니다: 끼어든 사람이므로 그 자리를 비운다
  if other_cur is not null and other_cur <> p_opponent then
    if p_side = 0 then
      update public.volleyball_matches set right_user_id = null, right_character = null, right_joined_at = null, right_claim = null where id = m.id;
    else
      update public.volleyball_matches set left_user_id = null, left_character = null, left_joined_at = null, left_claim = null where id = m.id;
    end if;
    other_cur := null; other_claim := null;
  end if;
  -- 반대쪽 사람(내가 지목한 상대)이 나를 지목하지 않았다
  if other_cur is not null and other_claim is distinct from me then raise exception 'not your match'; end if;
  -- 내 자리에 다른 사람이 앉아 있으면(아직 시작 전) 내가 앉는다. 진짜 상대가 오면 위 규칙으로 가려진다.
  if p_side = 0 then
    update public.volleyball_matches set left_user_id = me, left_character = p_character, left_joined_at = t, left_claim = p_opponent where id = m.id;
  else
    update public.volleyball_matches set right_user_id = me, right_character = p_character, right_joined_at = t, right_claim = p_opponent where id = m.id;
  end if;
  -- 두 자리가 찼고 서로가 서로를 지목했다 → 경기 시작
  if other_cur is not null then
    update public.volleyball_matches set status = 'live', live_at = t where id = m.id;
    return jsonb_build_object('match', m.id, 'live', true);
  end if;
  return jsonb_build_object('match', m.id, 'live', false);
end $$;
revoke all on function public._volleyball_begin_unchecked(text, bigint, int, uuid, text) from public, anon, authenticated;

-- ---------- 4. AI 대전 시작 (시아배구는 내 캐릭터를 받는다) ----------

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
    perform public._check_character(me, p_character, 'volleyball');
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


-- ========== 5차: 고양이 구매 조건 (게임마다 30판) ==========
-- 판 수는 071 의 character_play_counts 에 _count_play 로 센다 (이 기능을 넣은 뒤부터).
-- 세는 곳 = 시아코인을 주는 곳과 같다. 15초 제한으로 코인을 못 받아도 정상으로 끝난 판은 센다.
-- 아래 함수들은 각 함수의 가장 마지막 정의(036 end_game · 033 submit_target_score · 034 _volleyball_finish · 056 ai_match_finish)를
-- 그대로 옮기고 _count_play 줄만 더했다. race_submit 은 위 2번에 더했다.

-- ---------- 5. 시아탱크 대전 정산 (036) ----------

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
        -- 고양이 구매 조건(30판): 코인을 받는 사람 = 끝까지 남은 사람. 15초 제한으로 코인을 못 받아도 판은 센다.
        -- 이 판은 status = 'playing' · game_no 확인 뒤 한 번만 여기에 온다 (곧바로 waiting 으로 바뀜)
        perform public._count_play(uid, 'tank');
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

-- ---------- 6. 시아탱크 백발백중 (033) ----------

create or replace function public.submit_target_score(p_score int)
returns int language plpgsql security definer set search_path = public as $$
declare b int; n int;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'need login'; end if;
  if p_score is null or p_score < 0 or p_score > 2500 or p_score % 50 <> 0 then raise exception 'bad score'; end if;
  insert into public.target_scores as ts (user_id, best, plays) values (auth.uid(), p_score, 1)
  on conflict (user_id) do update set best = greatest(ts.best, excluded.best), plays = ts.plays + 1, updated_at = now()
  returning best, plays into b, n;
  perform public._grant_sia_coin(auth.uid(), 'target', n::text);
  -- 고양이 구매 조건(시아탱크 30판): 백발백중 한 판도 시아탱크 한 판 (부를 때마다 plays 가 하나씩 늘어나는 한 판)
  perform public._count_play(auth.uid(), 'tank');
  return b;
end $$;
revoke all on function public.submit_target_score(int) from public, anon;
grant execute on function public.submit_target_score(int) to authenticated;

-- ---------- 7. 시아배구 경기 확정 (034) ----------

create or replace function public._volleyball_finish(p_id uuid, p_left int, p_right int, p_winner_side int, p_reason text, p_leaver_side int) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.volleyball_matches; t timestamptz := clock_timestamp();
  w uuid; l uuid; wc text; lc text;          -- normal: 이긴 사람·진 사람
  stayer uuid; sc text; leaver uuid; vc text; -- leave: 남은 사람·나간 사람
  stay_won boolean;
begin
  select * into m from public.volleyball_matches where id = p_id for update;
  if not found or m.status <> 'live' then return; end if;

  if p_reason = 'leave' then
    if p_leaver_side = 0 then
      leaver := m.left_user_id; vc := m.left_character; stayer := m.right_user_id; sc := m.right_character;
    else
      leaver := m.right_user_id; vc := m.right_character; stayer := m.left_user_id; sc := m.left_character;
    end if;
    -- 남은 사람이 AI(나간 사람의 캐릭터)를 이겼는가
    stay_won := p_winner_side <> p_leaver_side;
    update public.volleyball_matches
      set status = 'done', left_score = p_left, right_score = p_right, winner_id = case when stay_won then stayer else null end,
          ended_reason = 'leave', leaver_id = leaver, done_at = t
      where id = p_id;
    -- 남은 사람: AI를 이기면 승 +1, 지면 패 +1
    if stayer is not null then
      if stay_won then
        insert into public.volleyball_rankings as r (user_id, wins, losses, last_character, reached_at, updated_at)
        values (stayer, 1, 0, sc, t, t)
        on conflict (user_id) do update set wins = r.wins + 1, last_character = excluded.last_character, reached_at = excluded.reached_at, updated_at = excluded.updated_at;
      else
        insert into public.volleyball_rankings as r (user_id, wins, losses, last_character, reached_at, updated_at)
        values (stayer, 0, 1, sc, t, t)
        on conflict (user_id) do update set losses = r.losses + 1, last_character = excluded.last_character, updated_at = excluded.updated_at;
      end if;
      -- 시아코인: 끝까지 한 사람(남은 사람)에게만
      perform public._grant_sia_coin(stayer, 'volleyball', m.id::text);
      -- 고양이 구매 조건(30판): 코인을 받는 사람(남은 사람)만. 경기는 status = 'live' 확인 뒤 한 번만 확정된다
      perform public._count_play(stayer, 'volleyball');
    end if;
    -- 나간 사람: 항상 패 +1 (AI가 이겨도 승이 아니다)
    if leaver is not null then
      insert into public.volleyball_rankings as r (user_id, wins, losses, last_character, reached_at, updated_at)
      values (leaver, 0, 1, vc, t, t)
      on conflict (user_id) do update set losses = r.losses + 1, last_character = excluded.last_character, updated_at = excluded.updated_at;
    end if;
    return;
  end if;

  if p_winner_side = 0 then
    w := m.left_user_id; wc := m.left_character; l := m.right_user_id; lc := m.right_character;
  else
    w := m.right_user_id; wc := m.right_character; l := m.left_user_id; lc := m.left_character;
  end if;
  update public.volleyball_matches
    set status = 'done', left_score = p_left, right_score = p_right, winner_id = w, ended_reason = 'normal', leaver_id = null, done_at = t
    where id = p_id;
  -- 이긴 사람: 승 +1, 지금 승수에 도달한 시각 갱신
  if w is not null then
    insert into public.volleyball_rankings as r (user_id, wins, losses, last_character, reached_at, updated_at)
    values (w, 1, 0, wc, t, t)
    on conflict (user_id) do update set wins = r.wins + 1, last_character = excluded.last_character, reached_at = excluded.reached_at, updated_at = excluded.updated_at;
  end if;
  -- 진 사람: 패 +1 (승수는 그대로라 도달 시각도 그대로)
  if l is not null then
    insert into public.volleyball_rankings as r (user_id, wins, losses, last_character, reached_at, updated_at)
    values (l, 0, 1, lc, t, t)
    on conflict (user_id) do update set losses = r.losses + 1, last_character = excluded.last_character, updated_at = excluded.updated_at;
  end if;
  -- 시아코인: 끝까지 한 두 사람 모두. 이미 준 판·15초 안 중복은 _grant_sia_coin 이 알아서 false
  perform public._grant_sia_coin(m.left_user_id, 'volleyball', m.id::text);
  perform public._grant_sia_coin(m.right_user_id, 'volleyball', m.id::text);
  -- 고양이 구매 조건(30판): 끝까지 한 두 사람 모두 (나중에 무효로 되돌려도 코인처럼 그대로 둔다)
  if m.left_user_id is not null then perform public._count_play(m.left_user_id, 'volleyball'); end if;
  if m.right_user_id is not null then perform public._count_play(m.right_user_id, 'volleyball'); end if;
end $$;
revoke all on function public._volleyball_finish(uuid, int, int, int, text, int) from public, anon, authenticated;

-- ---------- 8. AI 대전 끝 (056) ----------

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
  if ok then
    coin := public._grant_sia_coin(me, m.game, 'ai:' || m.id::text);
    -- 고양이 구매 조건(탱크·배구 30판, AI전 포함): 전적에 반영된 판(코인을 주는 판)만. finished_at 확인 뒤 한 번만 온다
    perform public._count_play(me, m.game);
  end if;

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

-- ---------- 9. 구매 조건 진행 (071 의 _character_progress 가 이름으로 찾아 부른다) → {have, need} ----------

-- 시아탱크: 대전(끝까지 남은 판)·AI 대전(보통·어려움, 전적에 반영된 판)·백발백중 — 30판. 클라이언트 상수와 같게 (games/tank/src/game/unlock.ts 의 CAT_NEED, tests/unlock.test.ts 가 대조)
create or replace function public._cat_progress_tank(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('have', public._play_count(p_user, 'tank'), 'need', 30)
$$;
revoke all on function public._cat_progress_tank(uuid) from public, anon, authenticated;

-- 시아레이스: 완주 기록을 올린 판 — 30판. 클라이언트 상수와 같게 (games/running/src/game/unlock.ts 의 CAT_NEED, tests/unlock.test.ts 가 대조)
create or replace function public._cat_progress_race(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('have', public._play_count(p_user, 'race'), 'need', 30)
$$;
revoke all on function public._cat_progress_race(uuid) from public, anon, authenticated;

-- 시아배구: 온라인 확정 경기·AI 대전(전적에 반영된 판) — 30판. 클라이언트 상수와 같게 (games/volleyball/src/game/unlock.ts 의 CAT_NEED, tests/unlock.test.ts 가 대조)
create or replace function public._cat_progress_volleyball(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('have', public._play_count(p_user, 'volleyball'), 'need', 30)
$$;
revoke all on function public._cat_progress_volleyball(uuid) from public, anon, authenticated;
