-- 060: 시아디펜스 검토 반영 (048 은 운영에 적용됨 — 바꾸는 함수만 여기서 다시 정의한다. 뒤 파일의 정의가 실제 값이다)
--   1. 별: 화면이 보낸 별(p_stars)이 서버 계산과 달라도 클리어 판을 거절하지 않고 서버 계산 별을 쓴다 (defense_finish)
--      판 시작이 판 설정에 영향을 주는 값(시작 생명 · 공통 강화 · 캐릭터 레벨)을 함께 돌려준다 (defense_start → jsonb).
--      화면은 이 값으로 판을 시작하므로, 기기에 남은 프로필이 서버와 달라도 화면과 서버의 시작 생명이 같다
--   2. defense_now() 가 048 에 두 번 정의돼 있던 것을 하나로: 로그인한 뒤에만 부른다 (접속 인원 채널은 로그인 뒤에 연다)
--   3. 끝나지 않은 판 정리: 7일이 지난 것, 그리고 20개를 넘는 것만 지운다 (보류해 둔 결과를 다시 보낼 판이 지워지지 않게)
-- games/defense/tests/sql.test.ts 가 이 파일도 읽는다 (048 뒤에).

-- ---------- 기준 값: open_runs 5 → 20 ----------

-- 판 검증에 쓰는 값. 게임 쪽 값(games/defense/src/game/progress.ts 의 LIMITS)과 맞춘다.
create or replace function public._defense_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_time' then 900            -- 한 판의 시간 상한: 3분 + 남은 요괴·보스 처리
    when 'clear_min_time' then 180      -- 클리어한 판은 3분 타이머를 채웠다
    when 'max_speed' then 2             -- 가장 빠른 배속
    when 'time_slack' then 15           -- 서버가 잰 경과 시간이 (판 시간 ÷ 배속)보다 이만큼까지는 짧아도 된다
    when 'max_age' then 604800          -- 시작 뒤 7일이 지난 판은 받지 않는다
    when 'count_min_time' then 20       -- 이보다 짧은 판은 아무것도 주지 않는다
    when 'coin_min_time' then 60        -- 시아코인은 60초 넘게 (실제 경과도) 진행한 판에만
    when 'open_runs' then 20            -- 끝내지 않은 판은 20개까지 둔다 (보류했다가 다시 보낼 판이 지워지지 않게 넉넉히. 7일이 지난 것은 따로 지운다)
    when 'kills_base' then 50           -- 처치 수 상한 = kills_base + 판 시간 × kills_per_sec (넘으면 비정상 판)
    when 'kills_per_sec' then 4
    when 'placed_max' then 400          -- 배치 횟수 상한
    when 'cmds_max' then 3000           -- 명령 수 상한
    when 'bonus_max' then 12            -- 3단계 돼지가 벌어 주는 엽전의 한 판 상한
    when 'start_lives' then 20          -- 시작 생명 (공통 강화 '시작 생명' 레벨만큼 더한다)
    when 'star2_lives' then 10          -- 별 2개: 생명을 이만큼 이상 남김
    when 'star_coins' then 20           -- 새로 딴 별 하나마다
    when 'fail_div' then 15             -- 실패·포기: 클리어 보상 × 끝낸 웨이브 수 ÷ 15
    when 'wave_sec' then 30
    when 'waves' then 6
    when 'squad_max' then 5
    when 'char_max_level' then 12
    when 'endless_max_time' then 3600   -- 끝없는 모드의 시간 상한 (웨이브 120)
    when 'endless_coin_per_wave' then 8 -- 끝없는 모드: 넘긴 웨이브 하나마다 엽전
    when 'endless_coin_cap' then 320    -- 끝없는 모드: 한 판의 엽전 상한
    when 'endless_kills_from' then 4    -- 끝없는 모드: 도달 웨이브가 이것을 넘으면 처치 수가 따라와야 한다
    when 'endless_kills_per_wave' then 5 --   (도달 웨이브 − endless_kills_from) × 이 값 이상. 아니면 비정상 판
    when 'codex_max' then 40            -- 한 번에 보내는 도감 id 수 (종류마다)
  end
$$;
revoke all on function public._defense_const(text) from public, anon, authenticated;

-- ---------- 서버 시각 (ms) ----------
-- 접속 인원 채널(defense-lobby)에서 먼저 온 순서를 셀 때 쓴다. 로그인한 뒤에만 부른다 (games/defense/src/main.ts: requireLogin 뒤에 채널을 연다)
create or replace function public.defense_now() returns double precision
language sql volatile set search_path = public as $$
  select extract(epoch from clock_timestamp()) * 1000
$$;
revoke all on function public.defense_now() from public, anon;
grant execute on function public.defense_now() to authenticated;

-- ---------- 판 시작 ----------

-- 잠금·해금을 확인하고 시작 시각을 남긴다 → { run: 판 id, startLives, upgrades, levels }
--   startLives: 이 판의 시작 생명 (별 3개의 기준. 서버가 끝낼 때 이 값으로 별을 계산한다)
--   upgrades · levels: 판 설정에 쓰는 공통 강화와 캐릭터 영구 레벨 (화면은 이 값으로 판을 만든다)
-- p_mode 'endless' 는 끝없는 모드: p_stage 는 'endless', 1지역의 보스 스테이지(1-5)를 클리어했어야 열린다
drop function if exists public.defense_start(text, text[], text);
create or replace function public.defense_start(p_stage text, p_squad text[], p_mode text default 'normal') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.defense_profiles; rid uuid; n int; lives int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('normal', 'endless') then raise exception 'bad mode'; end if;
  if p_mode = 'endless' then
    if p_stage is distinct from 'endless' then raise exception 'bad stage'; end if;
  elsif p_stage is null or not exists (select 1 from public._defense_stages() s where s.stage_id = p_stage) then raise exception 'bad stage';
  end if;
  n := coalesce(array_length(p_squad, 1), 0);
  if n < 1 or n > public._defense_const('squad_max') or array_position(p_squad, null) is not null
     or (select count(distinct c) from unnest(p_squad) c) <> n then raise exception 'bad squad'; end if;
  pr := public._defense_profile_row(me);
  if p_mode = 'endless' then
    if not exists (select 1 from public.defense_stages d where d.user_id = me and d.stage_id = '1-5') then raise exception 'endless locked'; end if;
  elsif not public._defense_stage_open(me, p_stage) then raise exception 'stage locked';
  end if;
  if not (p_squad <@ pr.unlocked_characters) then raise exception 'character locked'; end if;
  -- 끝나지 않은 이전 판은 지우지 않는다: 통신이 끊겨 결과를 못 보낸 판을 나중에 다시 보낼 수 있다.
  -- (여러 판을 겹쳐 여는 것은 defense_finish 가 막는다.) 7일이 지났거나(어차피 받지 않는다) 20개를 넘게 쌓인 것만 치운다.
  delete from public.defense_runs
    where user_id = me and created_at is null and started_at < clock_timestamp() - make_interval(secs => public._defense_const('max_age')::int);
  delete from public.defense_runs where id in (
    select id from public.defense_runs where user_id = me and created_at is null
    order by started_at desc offset (public._defense_const('open_runs')::int - 1));
  -- 끝난 판은 30일 뒤에 지운다
  delete from public.defense_runs where user_id = me and created_at < clock_timestamp() - interval '30 days';
  lives := public._defense_const('start_lives')::int + least(5, greatest(0, coalesce((pr.upgrades->>'lives')::int, 0)));
  insert into public.defense_runs (user_id, stage_id, squad, mode, start_lives, started_at)
  values (me, p_stage, p_squad, p_mode, lives, clock_timestamp())
  returning id into rid;
  return jsonb_build_object('run', rid, 'startLives', lives, 'upgrades', pr.upgrades, 'levels', pr.character_levels);
end $$;
revoke all on function public.defense_start(text, text[], text) from public, anon;
grant execute on function public.defense_start(text, text[], text) to authenticated;

-- ---------- 판 끝 ----------

-- 검증한 뒤 별·엽전·첫 클리어 보상·해금·도감을 반영한다 → { profile, result }
-- p_stars 는 화면이 계산한 별: 참고만 한다. 별은 서버가 판 시작 때 적은 시작 생명(start_lives)과 남은 생명으로 다시 계산한 값을 쓴다
--   (060: 기기의 프로필이 서버와 달라 화면의 별이 다르더라도 클리어 판을 거절하지 않는다)
-- 끝없는 모드: 클리어가 없다. 도달 웨이브 = 판 시간 ÷ 30 + 1 (서버가 판 시간으로 계산한다. 판 시간은 경과 시간 검사를 받는다:
--   도달 웨이브 ≤ 실제 경과 × 2 ÷ 30 + 여유). 엽전은 넘긴 웨이브 × endless_coin_per_wave (상한 endless_coin_cap)
create or replace function public.defense_finish(
  p_run uuid, p_time int, p_cleared boolean, p_lives int, p_stars int, p_kills int, p_placed int, p_cmds int, p_bonus int, p_codex jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t timestamptz := clock_timestamp();
  rn public.defense_runs; pr public.defense_profiles; st record;
  elapsed numeric; ok boolean := true; counted boolean; n_stars int; old int := 0; first_clear boolean := false; new_stars int := 0;
  base int := 0; first int := 0; star_c int := 0; bonus int := 0; coins int := 0; done int; coin_lv int;
  new_chars text[] := array[]::text[]; c text; got_coin boolean := false;
  endless boolean; wave int := 0; old_wave int := 0; new_record boolean := false;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._defense_profile_row(me);
  select * into rn from public.defense_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.created_at is not null then raise exception 'already finished'; end if;
  endless := rn.mode = 'endless';
  if p_time is null or p_cleared is null or p_lives is null or p_kills is null or p_placed is null or p_cmds is null or p_bonus is null then raise exception 'bad result'; end if;
  if p_time < 0 or p_time > (case when endless then public._defense_const('endless_max_time') else public._defense_const('max_time') end) then raise exception 'bad time'; end if;
  if p_lives < 0 or p_lives > rn.start_lives or p_kills < 0 or p_placed < 0 or p_cmds < 0 or p_bonus < 0 then raise exception 'bad result'; end if;
  if p_placed > public._defense_const('placed_max') or p_cmds > public._defense_const('cmds_max') or p_placed > p_cmds then raise exception 'bad result'; end if;
  -- 끝없는 모드에는 클리어가 없다
  if endless and p_cleared then raise exception 'bad result'; end if;
  -- 클리어: 3분을 채웠고, 생명이 남았고, 캐릭터를 하나 이상 놓았다 (시작 명령 + 배치 명령)
  if p_cleared and (p_time < public._defense_const('clear_min_time') or p_lives < 1 or p_placed < 1 or p_cmds < 2) then raise exception 'bad result'; end if;
  -- 별은 남은 생명으로 정해진다: ★ 클리어 · ★★ 생명 10 이상 · ★★★ 생명을 하나도 잃지 않음
  n_stars := case when not p_cleared then 0
                when p_lives >= rn.start_lives then 3
                when p_lives >= public._defense_const('star2_lives') then 2
                else 1 end;
  -- (화면이 보낸 p_stars 와 달라도 거절하지 않는다: 서버 계산 별이 이 판의 별이다)
  -- 서버가 잰 경과 시간: 가장 빠른 배속(2배속)으로 한 것보다 짧을 수 없고(여유 time_slack 초), 7일이 넘은 판은 받지 않는다
  elapsed := extract(epoch from (t - rn.started_at));
  if elapsed < p_time / public._defense_const('max_speed') - public._defense_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._defense_const('max_age') then raise exception 'too late'; end if;
  -- 한 번에 한 판: 이미 끝낸 다른 판과 플레이 시간이 겹치면 받지 않는다 (판을 여러 개 열어 두고 한꺼번에 보고하는 것 방지).
  -- 판 하나가 쓴 시간은 가장 빠른 배속 기준 (판 시간 / max_speed − 여유). 모드와 상관없이 본다
  if exists (
    select 1 from public.defense_runs o
    where o.user_id = me and o.id <> p_run and o.created_at is not null
      and o.started_at < rn.started_at + make_interval(secs => greatest(0, p_time / public._defense_const('max_speed') - public._defense_const('time_slack')))
      and o.started_at + make_interval(secs => greatest(0, o.time / public._defense_const('max_speed') - public._defense_const('time_slack'))) > rn.started_at
  ) then raise exception 'overlap'; end if;

  -- 상한을 넘는 처치 수는 비정상 판: 아무것도 주지 않는다. 너무 짧은 판도 아무것도 주지 않는다
  if p_kills > public._defense_const('kills_base') + p_time * public._defense_const('kills_per_sec') then ok := false; end if;
  done := p_time / public._defense_const('wave_sec')::int;
  coin_lv := least(5, greatest(0, coalesce((pr.upgrades->>'coin')::int, 0)));
  -- 3단계 돼지가 벌어 준 엽전: 돼지를 데려간 판에서만, 상한까지
  if 'pig' = any(rn.squad) then bonus := least(public._defense_const('bonus_max')::int, p_bonus); end if;

  if endless then
    -- 도달 웨이브: 넘긴 웨이브 + 1. 요괴를 거의 잡지 않고 버틴 것처럼 꾸민 보고는 비정상 판
    wave := done + 1;
    if p_kills < greatest(0, wave - public._defense_const('endless_kills_from')::int) * public._defense_const('endless_kills_per_wave') then ok := false; end if;
    counted := ok and p_time >= public._defense_const('count_min_time');
    select e.best_wave into old_wave from public.defense_endless e where e.user_id = me for update;
    old_wave := coalesce(old_wave, 0);
    if counted then
      base := least(public._defense_const('endless_coin_cap')::int, done * public._defense_const('endless_coin_per_wave')::int);
      coins := ((base + bonus) * (100 + 5 * coin_lv)) / 100;
      pr.coins := pr.coins + coins;
      -- 최고 기록: 더 높은 웨이브일 때만 (같으면 먼저 달성한 기록을 그대로 둔다)
      if wave > old_wave then
        new_record := true;
        insert into public.defense_endless as e (user_id, best_wave, characters, achieved_at) values (me, wave, rn.squad, t)
        on conflict (user_id) do update set best_wave = excluded.best_wave, characters = excluded.characters, achieved_at = excluded.achieved_at;
      end if;
    end if;
  else
    select * into st from public._defense_stages() s where s.stage_id = rn.stage_id;
    if not found then raise exception 'bad stage'; end if;
    counted := ok and p_time >= public._defense_const('count_min_time');
    select d.stars into old from public.defense_stages d where d.user_id = me and d.stage_id = rn.stage_id;
    old := coalesce(old, 0);
    if counted then
      first_clear := n_stars > 0 and old = 0;
      new_stars := greatest(0, n_stars - old);
      if n_stars > 0 then
        base := st.coins;
      else
        base := (st.coins * least(public._defense_const('waves')::int, done)) / public._defense_const('fail_div')::int;
      end if;
      if first_clear then first := st.first_coins; end if;
      star_c := new_stars * public._defense_const('star_coins')::int;
      coins := ((base + first + star_c + bonus) * (100 + 5 * coin_lv)) / 100;

      if n_stars > old then
        insert into public.defense_stages as d (user_id, stage_id, stars, cleared_at) values (me, rn.stage_id, n_stars, t)
        on conflict (user_id, stage_id) do update set stars = excluded.stars, cleared_at = excluded.cleared_at;
        pr.total_stars := pr.total_stars + new_stars;
        pr.stars_updated_at := t;
        if first_clear then pr.cleared_stages := pr.cleared_stages + 1; end if;
      end if;
      -- 캐릭터 해금: 그 지역의 보스 스테이지(5번째)를 처음 클리어했을 때
      if first_clear and st.no = 5 then
        select g.unlock_char into c from public._defense_regions() g where g.region = st.region;
        if c is not null and c <> '' and not (c = any(pr.unlocked_characters)) then
          pr.unlocked_characters := pr.unlocked_characters || c;
          new_chars := new_chars || c;
        end if;
      end if;
      pr.coins := pr.coins + coins;
    end if;
  end if;

  -- 도감: 정상 판에서 만난 요괴·보스 (허용된 id 만)
  if counted and p_codex is not null and jsonb_typeof(p_codex) = 'object' then
    pr.codex := jsonb_build_object(
      'enemies', public._defense_codex_merge(pr.codex, p_codex, 'enemies'),
      'bosses', public._defense_codex_merge(pr.codex, p_codex, 'bosses'));
  end if;

  update public.defense_runs
    set time = p_time, cleared = p_cleared and counted, lives = p_lives, stars = case when counted then n_stars else 0 end,
        kills = p_kills, coins_earned = coins, valid = ok, created_at = t
    where id = p_run;
  update public.defense_profiles
    set coins = pr.coins, unlocked_characters = pr.unlocked_characters, total_stars = pr.total_stars,
        cleared_stages = pr.cleared_stages, stars_updated_at = pr.stars_updated_at, codex = pr.codex, updated_at = t
    where user_id = me;

  -- 시아코인: 60초 넘게 진행한 정상 판. 실제로도 60초가 걸렸어야 한다 (2배속으로 30초마다 받는 것 방지)
  -- (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if ok and p_time >= public._defense_const('coin_min_time') and elapsed >= public._defense_const('coin_min_time') then
    got_coin := public._grant_sia_coin(me, 'defense', p_run::text);
  end if;

  return jsonb_build_object(
    'profile', public._defense_profile_json(pr),
    'result', jsonb_build_object(
      'stars', case when counted then n_stars else 0 end, 'bestStars', greatest(old, case when counted then n_stars else 0 end),
      'newStars', new_stars, 'firstClear', first_clear,
      'coins', coins, 'baseCoins', base, 'firstCoins', first, 'starCoins', star_c,
      'unlocked', to_jsonb(new_chars), 'valid', ok, 'siaCoin', got_coin,
      'mode', rn.mode, 'wave', case when endless and counted then wave else 0 end,
      'bestWave', greatest(old_wave, case when endless and counted then wave else 0 end), 'newRecord', new_record));
end $$;
revoke all on function public.defense_finish(uuid, int, boolean, int, int, int, int, int, int, jsonb) from public, anon;
grant execute on function public.defense_finish(uuid, int, boolean, int, int, int, int, int, int, jsonb) to authenticated;
