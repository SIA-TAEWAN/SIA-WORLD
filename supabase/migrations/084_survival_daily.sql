-- 084: 시아서바이벌 "오늘의 도전" (공통 틀은 082_daily.sql)
--   하루(한국 시간) 동안 모두 같은 맵·캐릭터·시드·강화 단계로 4분 판을 하고, 그날 기록만 따로 순위를 매긴다.
--   조건은 기기가 날짜에서 만든다 (games/survival/src/game/daily.ts). 서버는 오늘 조건으로 했는지까지 다시 계산하지 않는다 (친목용).
--   · 판의 모드에 'daily' 를 더한다 (survival_runs.mode). survival_start 의 인자 모양은 그대로다 (p_mode = 'daily').
--   · survival_start (이전 최신 정의: 073_cat_survival.sql): daily 는 맵 잠금을 보지 않는다. 고양이는 받지 않는다. 나머지는 073 그대로.
--   · survival_finish (이전 최신 정의: 055_survival_hell.sql): daily 는 4분 모드와 같은 검증·누적·도감·시아코인. 엽전 배수만 맵과 상관없이 1(들판 기준).
--     맵별 기록(랭킹)·다음 맵 해금·시간/클리어 조건 캐릭터 해금·최고 생존 시간에는 넣지 않고, 정상 판이면 _daily_record 로 그날 순위에 넣는다.
--     답에 'daily' 칸이 생긴다 (오늘의 도전이 아니거나 순위에 넣지 않은 판은 null): { day, improved, best, first }
--     같은 판을 두 번 넣는 것은 지금처럼 'already finished' 가 막고, 남의 판은 'no run'.
--   · 판 검증 상수(_survival_const)는 바꾸지 않는다.
--   순위는 082 의 daily_ranking('survival', 날짜) 로 읽는다. detail = { time, kills, cleared, level, map, character }

alter table public.survival_runs drop constraint if exists survival_runs_mode_check;
alter table public.survival_runs add constraint survival_runs_mode_check check (mode in ('normal', 'endless', 'hell', 'daily'));

-- ---------- 판 시작 (073 의 정의에 daily 만 더했다) ----------

create or replace function public.survival_start(p_map text, p_character text, p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.survival_profiles; rid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_map is null or not exists (select 1 from public._survival_maps() m where m.map_id = p_map) then raise exception 'bad map'; end if;
  -- 071: 고를 수 있는 캐릭터인지는 공용 함수가 본다 (모르는 id 면 'bad character'. 시아코인으로 여는 캐릭터를 이 게임에서 안 열었으면 'locked character')
  perform public._check_character(me, p_character, 'survival');
  if p_mode is null or p_mode not in ('normal', 'endless', 'hell', 'daily') then raise exception 'bad mode'; end if;
  pr := public._survival_profile_row(me);
  -- 084: 오늘의 도전(daily)은 맵 잠금을 보지 않는다 (누구나 그날의 맵으로 한다). 캐릭터는 처음부터 열린 것 가운데서 정해지므로 아래 검사를 그대로 지난다
  if p_mode <> 'daily' and not (p_map = any(pr.unlocked_maps)) then raise exception 'map locked'; end if;
  -- 084: 오늘의 도전에는 시아코인으로 여는 캐릭터(고양이)를 쓰지 않는다
  if p_mode = 'daily' and public._character_price(p_character) is not null then raise exception 'bad character'; end if;
  -- 십이지는 시아서바이벌의 해금 목록으로 본다. 시아코인으로 여는 캐릭터(고양이)는 이 목록에 들어가지 않는다 (위의 _check_character 가 본다)
  if public._character_price(p_character) is null and not (p_character = any(pr.unlocked_characters)) then raise exception 'character locked'; end if;
  -- 무한 모드는 그 맵을 4분 모드로 클리어했어야 열린다 (클리어 기록이 있거나 다음 맵이 열려 있다)
  if p_mode = 'endless' and not public._survival_map_cleared(me, p_map, pr.unlocked_maps) then
    raise exception 'endless locked';
  end if;
  -- 헬 모드도 같은 조건: **그 맵을** 4분 모드로 클리어했어야 열린다 (다른 맵을 깬 것으로는 열리지 않는다)
  if p_mode = 'hell' and not public._survival_map_cleared(me, p_map, pr.unlocked_maps) then
    raise exception 'hell locked';
  end if;
  -- 끝나지 않은 이전 판은 지우지 않는다: 통신이 끊겨 결과를 못 보낸 판을 나중에 다시 보낼 수 있다.
  -- (여러 판을 겹쳐 여는 것은 survival_finish 가 막는다.) 너무 오래됐거나 많이 쌓인 것만 치운다.
  delete from public.survival_runs
    where user_id = me and created_at is null and started_at < clock_timestamp() - make_interval(secs => public._survival_const('max_age')::int);
  delete from public.survival_runs where id in (
    select id from public.survival_runs where user_id = me and created_at is null
    order by started_at desc offset (public._survival_const('open_runs')::int - 1));
  -- 끝난 판은 30일 뒤에 지운다
  delete from public.survival_runs where user_id = me and created_at < clock_timestamp() - interval '30 days';
  insert into public.survival_runs (user_id, map_id, character, mode, started_at) values (me, p_map, p_character, p_mode, clock_timestamp()) returning id into rid;
  return rid;
end $$;
revoke all on function public.survival_start(text, text, text) from public, anon;
grant execute on function public.survival_start(text, text, text) to authenticated;

-- ---------- 판 끝 (055 의 정의에 daily 만 더했다) ----------

create or replace function public.survival_finish(
  p_run uuid, p_time int, p_kills int, p_level int, p_coins int, p_cleared boolean, p_boss_kills int, p_cakes int, p_codex jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t timestamptz := clock_timestamp();
  rn public.survival_runs; pr public.survival_profiles; old public.survival_records; old_e public.survival_endless_records; old_h public.survival_hell_records;
  mul numeric; elapsed numeric; ok boolean := true; coins int; better boolean := false; got_coin boolean := false;
  tot jsonb; new_chars text[] := array[]::text[]; new_maps text[] := array[]::text[]; next_map text; c text;
  n_kills bigint; n_cakes bigint; counted boolean; endless boolean; hell boolean; max_t numeric; boss_cap numeric; fixed_cap int; enough boolean;
  daily boolean; d_day date; d_res jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._survival_profile_row(me);
  select * into rn from public.survival_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.created_at is not null then raise exception 'already finished'; end if;
  endless := rn.mode = 'endless';
  -- 헬 모드는 4분 판이다 (가장 긴 판·클리어·보스 수는 4분 모드와 같다). 다른 것은 엽전 상한(2배)과 기록·해금뿐
  hell := rn.mode = 'hell';
  -- 084: 오늘의 도전도 4분 판이다 (검증은 4분 모드와 같다. 엽전 배수는 아래에서 1로). 다른 것은 기록·해금에 넣지 않고 오늘 순위(daily_scores)에 넣는 것
  daily := rn.mode = 'daily';
  max_t := case when endless then public._survival_const('endless_max_time') else public._survival_const('max_time') end;
  if p_time is null or p_kills is null or p_level is null or p_coins is null or p_cleared is null or p_boss_kills is null or p_cakes is null then raise exception 'bad result'; end if;
  if p_time < 0 or p_time > max_t then raise exception 'bad time'; end if;
  if p_kills < 0 or p_level < 1 or p_coins < 0 or p_boss_kills < 0 or p_cakes < 0 then raise exception 'bad result'; end if;
  -- 무한 모드에는 클리어가 없다. 4분 모드·헬 모드의 클리어는 4분을 채운 판에서만
  if endless and p_cleared then raise exception 'bad result'; end if;
  if p_cleared and p_time <> public._survival_const('max_time') then raise exception 'bad time'; end if;
  -- 서버가 잰 경과 시간: 가장 빠른 배속(2배속)으로 한 것보다 짧을 수 없고(여유 time_slack 초), 7일이 넘은 판은 받지 않는다
  elapsed := extract(epoch from (t - rn.started_at));
  if elapsed < p_time / public._survival_const('max_speed') - public._survival_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._survival_const('max_age') then raise exception 'too late'; end if;
  -- 한 번에 한 판: 이미 끝낸 다른 판과 플레이 시간이 겹치면 받지 않는다 (판을 여러 개 열어 두고 한꺼번에 보고하는 것 방지).
  -- 판 하나가 쓴 시간은 가장 빠른 배속 기준 (생존 시간 / max_speed − 여유). 모드와 상관없이 본다
  if exists (
    select 1 from public.survival_runs o
    where o.user_id = me and o.id <> p_run and o.created_at is not null
      and o.started_at < rn.started_at + make_interval(secs => greatest(0, p_time / public._survival_const('max_speed') - public._survival_const('time_slack')))
      and o.started_at + make_interval(secs => greatest(0, o.time / public._survival_const('max_speed') - public._survival_const('time_slack'))) > rn.started_at
  ) then raise exception 'overlap'; end if;
  -- 요괴를 너무 적게 잡은 판 (기다리기만 한 것처럼 꾸민 보고): 비정상(valid = false)으로 보지는 않지만 세지 않는다.
  -- 엽전 0, 누적·기록(랭킹)·클리어·해금·도감·시아코인에 넣지 않는다 (너무 짧은 판과 같은 취급)
  enough := p_kills >= greatest(0, p_time - public._survival_const('kills_min_from')) * public._survival_const('kills_min_per_sec');
  counted := p_time >= public._survival_const('count_min_time') and enough;

  select m.coin_mul into mul from public._survival_maps() m where m.map_id = rn.map_id;
  mul := coalesce(mul, 1);
  -- 헬 모드: 엽전이 2배라 상한도 2배
  if hell then mul := mul * public._survival_const('hell_coin_mul'); end if;
  -- 084: 오늘의 도전은 맵 잠금 없이 누구나 하는 판이라 엽전 배수를 맵과 상관없이 1(들판 기준)로 본다 (기기도 1배로 줍는다: game/sim.ts 의 createRun)
  if daily then mul := 1; end if;
  -- 보스 수: 4분까지 셋. 무한 모드는 그 뒤로 endless_boss_every 초마다 하나씩 더 나온다
  boss_cap := public._survival_const('boss_max');
  if endless then
    boss_cap := boss_cap + greatest(0, floor((p_time - public._survival_const('max_time')) / public._survival_const('endless_boss_every')));
  end if;
  -- 상한을 넘는 값이 하나라도 있으면 비정상 기록
  if p_kills > public._survival_const('kills_base') + p_time * public._survival_const('kills_per_sec') then ok := false; end if;
  if p_level > public._survival_const('level_base') + p_time * public._survival_const('level_per_sec') then ok := false; end if;
  if p_cakes > public._survival_const('cakes_base') + p_time * public._survival_const('cakes_per_sec') then ok := false; end if;
  if p_boss_kills > boss_cap then ok := false; end if;
  if p_boss_kills > 0 and p_time < public._survival_const('boss1_time') then ok := false; end if;
  if p_cleared and p_boss_kills < 1 then ok := false; end if;
  coins := floor((public._survival_const('coins_base') + p_time * public._survival_const('coins_per_sec')) * mul);
  if endless then
    -- 무한 모드: 맵별 고정 상한도 넘지 못한다 (표에 없는 맵은 0)
    select x.cap into fixed_cap from public._survival_endless_coin_cap() x where x.map_id = rn.map_id;
    coins := least(coins, coalesce(fixed_cap, 0));
  end if;
  if p_coins > coins then ok := false; else coins := p_coins; end if;
  if not counted then coins := 0; end if;

  update public.survival_runs
    set time = p_time, kills = p_kills, level = p_level, coins_earned = coins, cleared = p_cleared and ok and enough, valid = ok, created_at = t
    where id = p_run;

  pr.coins := pr.coins + coins;

  if ok and counted then
    -- 누적 값 (최고 생존 시간은 4분 모드의 값만. 처치·떡·보스·클리어 수·판 수는 모드와 상관없이 쌓인다)
    tot := pr.totals;
    n_kills := coalesce((tot->>'kills')::bigint, 0) + p_kills;
    n_cakes := coalesce((tot->>'cakes')::bigint, 0) + p_cakes;
    tot := jsonb_build_object(
      'kills', n_kills,
      'cakes', n_cakes,
      'bestTime', greatest(coalesce((tot->>'bestTime')::int, 0), case when endless or hell then 0 else p_time end),
      'bossKills', coalesce((tot->>'bossKills')::bigint, 0) + p_boss_kills,
      'clears', coalesce((tot->>'clears')::bigint, 0) + (case when p_cleared then 1 else 0 end),
      'runs', coalesce((tot->>'runs')::bigint, 0) + 1);
    -- 084: 오늘의 도전은 강화가 맞춰진 판이라 최고 생존 시간(누적)에 넣지 않는다
    if daily then tot := jsonb_set(tot, '{bestTime}', to_jsonb(coalesce((pr.totals->>'bestTime')::int, 0))); end if;
    pr.totals := tot;

    if endless then
      -- 무한 모드의 맵별 최고 기록: 생존 시간 → 처치 수 (같으면 먼저 달성한 기록을 그대로 둔다)
      select * into old_e from public.survival_endless_records where user_id = me and map_id = rn.map_id for update;
      if not found then better := true;
      elsif p_time <> old_e.best_time then better := p_time > old_e.best_time;
      else better := p_kills > old_e.best_kills;
      end if;
      if better then
        insert into public.survival_endless_records as r (user_id, map_id, best_time, best_kills, character, achieved_at)
        values (me, rn.map_id, p_time, p_kills, rn.character, t)
        on conflict (user_id, map_id) do update set
          best_time = excluded.best_time, best_kills = excluded.best_kills,
          character = excluded.character, achieved_at = excluded.achieved_at;
      end if;
    elsif hell then
      -- 헬 모드의 맵별 최고 기록: 4분 모드와 같은 순서 (생존 시간 → 클리어 → 처치 수), 표는 따로다.
      -- 4분 모드 기록(survival_records)을 건드리지 않으므로 헬 클리어가 무한·헬 모드의 잠금이나 다음 맵 해금에 쓰이지 않는다
      select * into old_h from public.survival_hell_records where user_id = me and map_id = rn.map_id for update;
      if not found then better := true;
      elsif p_time <> old_h.best_time then better := p_time > old_h.best_time;
      elsif p_cleared <> old_h.cleared then better := p_cleared;
      else better := p_kills > old_h.best_kills;
      end if;
      if better then
        insert into public.survival_hell_records as r (user_id, map_id, best_time, best_kills, cleared, character, achieved_at)
        values (me, rn.map_id, p_time, p_kills, p_cleared, rn.character, t)
        on conflict (user_id, map_id) do update set
          best_time = excluded.best_time, best_kills = excluded.best_kills, cleared = excluded.cleared,
          character = excluded.character, achieved_at = excluded.achieved_at;
      end if;
    elsif daily then
      -- 084: 오늘의 도전은 맵별 기록(랭킹)에 넣지 않는다. 잠긴 맵에서도 하는 판이라 무한·헬 모드의 잠금이나 다음 맵 해금에도 쓰지 않는다
      better := false;
    else
      -- 맵별 최고 기록: 생존 시간 → 클리어 → 처치 수 (같으면 먼저 달성한 기록을 그대로 둔다)
      select * into old from public.survival_records where user_id = me and map_id = rn.map_id for update;
      if not found then better := true;
      elsif p_time <> old.best_time then better := p_time > old.best_time;
      elsif p_cleared <> old.cleared then better := p_cleared;
      else better := p_kills > old.best_kills;
      end if;
      if better then
        insert into public.survival_records as r (user_id, map_id, best_time, best_kills, cleared, character, achieved_at)
        values (me, rn.map_id, p_time, p_kills, p_cleared, rn.character, t)
        on conflict (user_id, map_id) do update set
          best_time = excluded.best_time, best_kills = excluded.best_kills, cleared = excluded.cleared,
          character = excluded.character, achieved_at = excluded.achieved_at;
      end if;
    end if;

    -- 캐릭터 해금 (조건으로 푸는 것만. 원숭이·닭·개는 survival_unlock_character 로 엽전을 내고 푼다)
    foreach c in array array['rabbit', 'dragon', 'snake', 'horse', 'sheep', 'pig'] loop
      continue when c = any(pr.unlocked_characters);
      -- 시간 조건(토끼·말)과 클리어(돼지)는 4분 모드에서만 (무한 모드·헬 모드는 아니다)
      continue when (endless or hell) and c in ('rabbit', 'horse', 'pig');
      -- 084: 오늘의 도전도 마찬가지 (강화가 맞춰진 판이다)
      continue when daily and c in ('rabbit', 'horse', 'pig');
      if (c = 'rabbit' and p_time >= 120)
         or (c = 'dragon' and p_boss_kills >= 1)
         or (c = 'snake' and n_kills >= 1000)
         or (c = 'horse' and p_time >= 200)
         or (c = 'sheep' and n_cakes >= 15)
         or (c = 'pig' and p_cleared) then
        pr.unlocked_characters := pr.unlocked_characters || c;
        new_chars := new_chars || c;
      end if;
    end loop;

    -- 다음 맵 해금: 이 맵을 4분 모드로 클리어했을 때 (무한 모드에는 클리어가 없고, 헬 모드의 클리어는 해금에 쓰지 않는다)
    if p_cleared and not endless and not hell then
      select m2.map_id into next_map from public._survival_maps() m1 join public._survival_maps() m2 on m2.ord = m1.ord + 1 where m1.map_id = rn.map_id;
      if not daily and next_map is not null and not (next_map = any(pr.unlocked_maps)) then
        pr.unlocked_maps := pr.unlocked_maps || next_map;
        new_maps := new_maps || next_map;
      end if;
    end if;

    -- 도감: 허용된 id만 합친다
    if p_codex is not null and jsonb_typeof(p_codex) = 'object' then
      -- 첫 보스가 나오기 전에 끝난 판은 보스 도감을 받지 않는다
      if p_time < public._survival_const('boss1_time') then p_codex := p_codex - 'bosses'; end if;
      pr.codex := jsonb_build_object(
        'enemies', public._survival_codex_merge(pr.codex, p_codex, 'enemies'),
        'bosses', public._survival_codex_merge(pr.codex, p_codex, 'bosses'),
        'weapons', public._survival_codex_merge(pr.codex, p_codex, 'weapons'),
        'passives', public._survival_codex_merge(pr.codex, p_codex, 'passives'));
    end if;
  end if;

  update public.survival_profiles
    set coins = pr.coins, totals = pr.totals, unlocked_characters = pr.unlocked_characters, unlocked_maps = pr.unlocked_maps,
        codex = pr.codex, updated_at = t
    where user_id = me;

  -- 시아코인: 1분 넘게 버틴 정상 판. 실제로도 1분이 걸렸어야 하고(2배속으로 30초마다 받는 것 방지), 요괴를 너무 적게 잡은 판은 뺀다
  -- (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if ok and enough and p_time >= public._survival_const('coin_min_time') and elapsed >= public._survival_const('coin_min_time') then
    got_coin := public._grant_sia_coin(me, 'survival', p_run::text);
  end if;

  -- 084: 오늘의 도전 기록. 서버가 받아들인 정상 판(상한 안 · 처치 수 하한 이상)만, 판을 시작한 날(한국 시간)의 순위에 넣는다.
  -- 점수 = 생존 초 × 100000 + 클리어 50000 + 처치 수 (처치 수 상한은 12,100 이라 자리가 겹치지 않는다. 4분을 채우고도 보스를 못 잡은 판보다 클리어가 위)
  -- 나중에 다시 보낸 판이 그제보다 오래됐으면 순위에는 넣지 않는다 (_daily_record 는 어제·오늘만 받는다)
  if daily and ok and enough then
    d_day := (rn.started_at at time zone 'Asia/Seoul')::date;
    if d_day >= public._daily_day() - 1 and d_day <= public._daily_day() then
      d_res := public._daily_record(me, 'survival',
        p_time::bigint * 100000 + (case when p_cleared then 50000 else 0 end) + p_kills,
        jsonb_build_object('time', p_time, 'kills', p_kills, 'cleared', p_cleared, 'level', p_level, 'map', rn.map_id, 'character', rn.character),
        p_run::text, d_day);
    end if;
  end if;

  return jsonb_build_object(
    'daily', d_res,
    'profile', public._survival_profile_json(pr),
    'result', jsonb_build_object(
      'coins', coins, 'valid', ok, 'lowKills', not enough, 'newRecord', ok and counted and better, 'mode', rn.mode,
      'unlockedCharacters', to_jsonb(new_chars), 'unlockedMaps', to_jsonb(new_maps), 'siaCoin', got_coin));
end $$;
revoke all on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) from public, anon;
grant execute on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) to authenticated;
