-- 087: 시아디펜스 "오늘의 고개" (오늘의 도전, 공통 틀은 082_daily.sql)
--   날짜로 스테이지 하나와 조건 하나를 정해(기기가 날짜 문자열에서 만든다: games/defense/src/game/daily.ts) 그날 기록만 따로 겨룬다.
--   · defense_runs.daily (새 열): 오늘의 고개 판이면 시작한 날 (한국 시간). 보통 판은 null
--   · defense_daily_start(p_stage, p_squad, p_day): 판 시작. defense_start(074 가 최신 정의)와 같되
--       - 스테이지 잠금을 보지 않는다 (모두가 같은 스테이지를 한다. 캐릭터 해금·고양이 검사는 그대로)
--       - p_day 가 서버의 오늘이 아니면 'bad day' (자정을 넘긴 화면)
--   · defense_finish (060 이 이전 최신 정의 — 074 는 다시 정의하지 않았다): 그대로 이어받고, 오늘의 고개 판이면
--       - 별·첫 클리어·캐릭터 해금·스테이지 기록(defense_stages)에 반영하지 않는다 (잠긴 스테이지일 수 있다)
--       - 엽전은 스테이지를 다시 한 판과 같다 (클리어 보상 또는 버틴 만큼 + 돼지. 첫 판 보너스 같은 것은 없다)
--       - 검사를 통과한 판이면 _daily_record('defense', 점수, …) 를 부르고 result.daily 로 돌려준다
--       검사(시간·생명·처치 수·겹침)는 보통 판과 똑같다: 오늘의 조건(출전 제한·요괴 체력·시작 기운)은 3분 타이머를 바꾸지 않으므로
--       clear_min_time 등과 부딪히지 않는다. 오늘 조건으로 했는지는 서버가 다시 계산하지 않는다 (친목용)
--   점수(클수록 좋음) = 클리어 1000000 + 남은 생명 × 1000 + 처치 수(999 까지). detail = { cleared, lives, kills, time, stage }
-- games/defense/tests/sql.test.ts 가 이 파일도 읽는다 (074 뒤에).

alter table public.defense_runs add column if not exists daily date;

-- ---------- 오늘의 고개: 판 시작 ----------
create or replace function public.defense_daily_start(p_stage text, p_squad text[], p_day text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.defense_profiles; rid uuid; n int; lives int; c text; d date := public._daily_day();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_day is null or p_day <> to_char(d, 'YYYY-MM-DD') then raise exception 'bad day'; end if;
  if p_stage is null or not exists (select 1 from public._defense_stages() s where s.stage_id = p_stage) then raise exception 'bad stage'; end if;
  n := coalesce(array_length(p_squad, 1), 0);
  if n < 1 or n > public._defense_const('squad_max') or array_position(p_squad, null) is not null
     or (select count(distinct x) from unnest(p_squad) x) <> n then raise exception 'bad squad'; end if;
  foreach c in array p_squad loop
    perform public._check_character(me, c, 'defense');
  end loop;
  pr := public._defense_profile_row(me);
  -- 스테이지로 여는 캐릭터는 해금했어야 한다 (고양이는 _check_character 가 본다). 스테이지 잠금은 보지 않는다
  if exists (select 1 from unnest(p_squad) x where not (x = any(pr.unlocked_characters)) and not (x = any(public._defense_extra_ids()))) then
    raise exception 'character locked';
  end if;
  -- 끝나지 않은 판·오래된 판 정리는 defense_start 와 같다
  delete from public.defense_runs
    where user_id = me and created_at is null and started_at < clock_timestamp() - make_interval(secs => public._defense_const('max_age')::int);
  delete from public.defense_runs where id in (
    select id from public.defense_runs where user_id = me and created_at is null
    order by started_at desc offset (public._defense_const('open_runs')::int - 1));
  delete from public.defense_runs where user_id = me and created_at < clock_timestamp() - interval '30 days';
  lives := public._defense_const('start_lives')::int + least(5, greatest(0, coalesce((pr.upgrades->>'lives')::int, 0)));
  insert into public.defense_runs (user_id, stage_id, squad, mode, start_lives, started_at, daily)
  values (me, p_stage, p_squad, 'normal', lives, clock_timestamp(), d)
  returning id into rid;
  return jsonb_build_object('run', rid, 'startLives', lives, 'upgrades', pr.upgrades, 'levels', pr.character_levels, 'day', to_char(d, 'YYYY-MM-DD'));
end $$;
revoke all on function public.defense_daily_start(text, text[], text) from public, anon;
grant execute on function public.defense_daily_start(text, text[], text) to authenticated;

-- ---------- 판 끝 (060 과 같고, 오늘의 고개 판의 처리만 더한다) ----------
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
  daily boolean; d_score bigint; d_out jsonb := null;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._defense_profile_row(me);
  select * into rn from public.defense_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.created_at is not null then raise exception 'already finished'; end if;
  endless := rn.mode = 'endless';
  -- 오늘의 고개 판 (defense_daily_start 가 날짜를 적어 둔 판): 스테이지 진행(별·첫 클리어·해금)에는 반영하지 않는다
  daily := rn.daily is not null;
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
    if not daily then
      select d.stars into old from public.defense_stages d where d.user_id = me and d.stage_id = rn.stage_id;
    end if;
    old := coalesce(old, 0);
    if daily then
      -- 오늘의 고개: 엽전은 스테이지 판을 다시 했을 때와 같게 (클리어 보상 또는 버틴 만큼 + 돼지). 별·첫 클리어·해금은 없다
      if counted then
        if n_stars > 0 then
          base := st.coins;
        else
          base := (st.coins * least(public._defense_const('waves')::int, done)) / public._defense_const('fail_div')::int;
        end if;
        coins := ((base + bonus) * (100 + 5 * coin_lv)) / 100;
        pr.coins := pr.coins + coins;
      end if;
    elsif counted then
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

  -- 오늘의 고개 기록 (082 _daily_record): 정상 판만. 점수 = 클리어 1000000 + 남은 생명 × 1000 + 처치 수(999 까지)
  --   남은 생명은 클리어한 판에서만 센다 (포기한 판이 생명으로 앞서지 않게). 날짜는 판을 시작한 날.
  --   보류했다가 이틀 넘게 지나서 올린 판은 기록하지 않는다 (_daily_record 가 받지 않는 날짜). 기록에 실패해도 판 저장은 그대로 끝낸다
  if daily and counted and rn.daily >= public._daily_day() - 1 then
    d_score := (case when p_cleared then 1000000 + p_lives::bigint * 1000 else 0 end) + least(p_kills, 999);
    begin
      d_out := public._daily_record(me, 'defense', d_score,
        jsonb_build_object('cleared', p_cleared, 'lives', case when p_cleared then p_lives else 0 end, 'kills', p_kills, 'time', p_time, 'stage', rn.stage_id),
        p_run::text, rn.daily);
      d_out := d_out || jsonb_build_object('score', d_score);
    exception when others then
      d_out := null;
    end;
  end if;

  -- 시아코인: 60초 넘게 진행한 정상 판. 실제로도 60초가 걸렸어야 한다 (2배속으로 30초마다 받는 것 방지)
  -- (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if ok and p_time >= public._defense_const('coin_min_time') and elapsed >= public._defense_const('coin_min_time') then
    got_coin := public._grant_sia_coin(me, 'defense', p_run::text);
  end if;

  return jsonb_build_object(
    'profile', public._defense_profile_json(pr),
    'result', jsonb_build_object(
      'stars', case when counted then n_stars else 0 end, 'bestStars', case when daily then 0 else greatest(old, case when counted then n_stars else 0 end) end,
      'newStars', new_stars, 'firstClear', first_clear,
      'coins', coins, 'baseCoins', base, 'firstCoins', first, 'starCoins', star_c,
      'unlocked', to_jsonb(new_chars), 'valid', ok, 'siaCoin', got_coin,
      'mode', rn.mode, 'wave', case when endless and counted then wave else 0 end,
      'bestWave', greatest(old_wave, case when endless and counted then wave else 0 end), 'newRecord', new_record,
      'daily', d_out));
end $$;
revoke all on function public.defense_finish(uuid, int, boolean, int, int, int, int, int, int, jsonb) from public, anon;
grant execute on function public.defense_finish(uuid, int, boolean, int, int, int, int, int, int, jsonb) to authenticated;
