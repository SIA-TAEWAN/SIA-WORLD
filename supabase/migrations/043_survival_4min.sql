-- 시아서바이벌: 한 판을 3분에서 4분으로 (게임 쪽 수치는 games/survival/src/data, 같은 값은 src/game/progress.ts 의 LIMITS)
--   2배속(042)이 생겨 판을 늘린다: 4분 판이 2배속이면 실제 2분.
--   1. 판 검증 상수를 4분 기준으로: 최대 240초, 첫 보스 1분 20초(80초). max_speed 2 · 시아코인 1분 · 20초 미만 판 제외는 그대로.
--      상한은 4분 기준 100판(맵 4 × 강화 6단계) 실제 최대치에 여유를 둔다: 엽전 초당 7 → 5 (실제 최대 1.95의 약 2.5배. 엽전 드롭을 낮췄다),
--      레벨 초당 0.6 → 0.5 (실제 최대 0.19), 처치 초당 50 (실제 최대 21) · 떡 초당 0.15 (실제 최대 0.05) 는 그대로.
--   2. survival_finish: 본문은 042 와 같고, 캐릭터 해금 조건만 4분 기준으로 (토끼 2분 = 120초, 말 3분 20초 = 200초. 양은 떡 누적 15개 그대로).
--   3. 3분 기준 기록이 4분 랭킹 위에 남지 않게 맵별 최고 기록을 비우고, 누적 값의 최고 생존 시간을 240초 이하로 자른다.

create or replace function public._survival_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_time' then 240            -- 한 판은 최대 4분 (초)
    when 'time_slack' then 5            -- 서버가 잰 경과 시간이 판에 걸리는 가장 짧은 시간보다 이만큼까지는 짧아도 된다 (시계·통신 오차)
    when 'max_speed' then 2             -- 가장 빠른 배속: 생존 시간 t초인 판은 실제로 적어도 t / max_speed 초가 걸린다
    when 'max_age' then 604800          -- 시작 뒤 7일이 지난 판은 받지 않는다 (일시정지·나중에 다시 보내기 포함)
    when 'kills_base' then 100          -- 처치 수 상한 = kills_base + 생존 시간 × kills_per_sec
    when 'kills_per_sec' then 50
    when 'level_base' then 5            -- 레벨 상한 = level_base + 생존 시간 × level_per_sec
    when 'level_per_sec' then 0.5
    when 'coins_base' then 0            -- 엽전 상한 = (coins_base + 생존 시간 × coins_per_sec) × 맵 엽전 배율
    when 'coins_per_sec' then 5
    when 'cakes_base' then 5            -- 떡 상한 = cakes_base + 생존 시간 × cakes_per_sec
    when 'cakes_per_sec' then 0.15
    when 'boss_max' then 3              -- 한 판의 보스는 셋
    when 'boss1_time' then 80           -- 첫 보스는 1분 20초에 나온다 (그 전에는 보스를 잡을 수 없다)
    when 'coin_min_time' then 60        -- 시아코인은 1분 넘게 버틴 판에만
    when 'count_min_time' then 20       -- 이보다 짧은 판은 엽전·누적·기록·도감에 들어가지 않는다 (시작하자마자 끝내기 반복 방지)
    when 'open_runs' then 5             -- 한 사람이 끝내지 않고 둘 수 있는 판 수 (보류된 결과를 나중에 보낼 수 있게)
    when 'codex_max' then 40            -- 한 번에 보내는 도감 id 수 (종류마다)
  end
$$;
revoke all on function public._survival_const(text) from public, anon, authenticated;

create or replace function public.survival_finish(
  p_run uuid, p_time int, p_kills int, p_level int, p_coins int, p_cleared boolean, p_boss_kills int, p_cakes int, p_codex jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t timestamptz := clock_timestamp();
  rn public.survival_runs; pr public.survival_profiles; old public.survival_records;
  mul numeric; elapsed numeric; ok boolean := true; coins int; better boolean := false; got_coin boolean := false;
  tot jsonb; new_chars text[] := array[]::text[]; new_maps text[] := array[]::text[]; next_map text; c text;
  n_kills bigint; n_cakes bigint; counted boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._survival_profile_row(me);
  select * into rn from public.survival_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.created_at is not null then raise exception 'already finished'; end if;
  if p_time is null or p_kills is null or p_level is null or p_coins is null or p_cleared is null or p_boss_kills is null or p_cakes is null then raise exception 'bad result'; end if;
  if p_time < 0 or p_time > public._survival_const('max_time') then raise exception 'bad time'; end if;
  if p_kills < 0 or p_level < 1 or p_coins < 0 or p_boss_kills < 0 or p_cakes < 0 then raise exception 'bad result'; end if;
  -- 클리어는 4분을 채운 판에서만
  if p_cleared and p_time <> public._survival_const('max_time') then raise exception 'bad time'; end if;
  -- 서버가 잰 경과 시간: 가장 빠른 배속(2배속)으로 한 것보다 짧을 수 없고(여유 5초), 7일이 넘은 판은 받지 않는다
  elapsed := extract(epoch from (t - rn.started_at));
  if elapsed < p_time / public._survival_const('max_speed') - public._survival_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._survival_const('max_age') then raise exception 'too late'; end if;
  -- 한 번에 한 판: 이미 끝낸 다른 판과 플레이 시간이 겹치면 받지 않는다 (판을 여러 개 열어 두고 한꺼번에 보고하는 것 방지).
  -- 판 하나가 쓴 시간은 가장 빠른 배속 기준 (생존 시간 / max_speed − 여유)
  if exists (
    select 1 from public.survival_runs o
    where o.user_id = me and o.id <> p_run and o.created_at is not null
      and o.started_at < rn.started_at + make_interval(secs => greatest(0, p_time / public._survival_const('max_speed') - public._survival_const('time_slack')))
      and o.started_at + make_interval(secs => greatest(0, o.time / public._survival_const('max_speed') - public._survival_const('time_slack'))) > rn.started_at
  ) then raise exception 'overlap'; end if;
  counted := p_time >= public._survival_const('count_min_time');

  select m.coin_mul into mul from public._survival_maps() m where m.map_id = rn.map_id;
  mul := coalesce(mul, 1);
  -- 상한을 넘는 값이 하나라도 있으면 비정상 기록
  if p_kills > public._survival_const('kills_base') + p_time * public._survival_const('kills_per_sec') then ok := false; end if;
  if p_level > public._survival_const('level_base') + p_time * public._survival_const('level_per_sec') then ok := false; end if;
  if p_cakes > public._survival_const('cakes_base') + p_time * public._survival_const('cakes_per_sec') then ok := false; end if;
  if p_boss_kills > public._survival_const('boss_max') then ok := false; end if;
  if p_boss_kills > 0 and p_time < public._survival_const('boss1_time') then ok := false; end if;
  if p_cleared and p_boss_kills < 1 then ok := false; end if;
  coins := floor((public._survival_const('coins_base') + p_time * public._survival_const('coins_per_sec')) * mul);
  if p_coins > coins then ok := false; else coins := p_coins; end if;
  if not counted then coins := 0; end if;

  update public.survival_runs
    set time = p_time, kills = p_kills, level = p_level, coins_earned = coins, cleared = p_cleared and ok, valid = ok, created_at = t
    where id = p_run;

  pr.coins := pr.coins + coins;

  if ok and counted then
    -- 누적 값
    tot := pr.totals;
    n_kills := coalesce((tot->>'kills')::bigint, 0) + p_kills;
    n_cakes := coalesce((tot->>'cakes')::bigint, 0) + p_cakes;
    tot := jsonb_build_object(
      'kills', n_kills,
      'cakes', n_cakes,
      'bestTime', greatest(coalesce((tot->>'bestTime')::int, 0), p_time),
      'bossKills', coalesce((tot->>'bossKills')::bigint, 0) + p_boss_kills,
      'clears', coalesce((tot->>'clears')::bigint, 0) + (case when p_cleared then 1 else 0 end),
      'runs', coalesce((tot->>'runs')::bigint, 0) + 1);
    pr.totals := tot;

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

    -- 캐릭터 해금 (조건으로 푸는 것만. 원숭이·닭·개는 survival_unlock_character 로 엽전을 내고 푼다)
    foreach c in array array['rabbit', 'dragon', 'snake', 'horse', 'sheep', 'pig'] loop
      continue when c = any(pr.unlocked_characters);
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

    -- 다음 맵 해금: 이 맵을 클리어했을 때
    if p_cleared then
      select m2.map_id into next_map from public._survival_maps() m1 join public._survival_maps() m2 on m2.ord = m1.ord + 1 where m1.map_id = rn.map_id;
      if next_map is not null and not (next_map = any(pr.unlocked_maps)) then
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

  -- 시아코인: 1분 넘게 버틴 정상 판 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if ok and p_time >= public._survival_const('coin_min_time') then
    got_coin := public._grant_sia_coin(me, 'survival', p_run::text);
  end if;

  return jsonb_build_object(
    'profile', public._survival_profile_json(pr),
    'result', jsonb_build_object(
      'coins', coins, 'valid', ok, 'newRecord', ok and counted and better,
      'unlockedCharacters', to_jsonb(new_chars), 'unlockedMaps', to_jsonb(new_maps), 'siaCoin', got_coin));
end $$;
revoke all on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) from public, anon;
grant execute on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) to authenticated;

-- 3분 기준 기록 정리: 맵별 최고 기록(랭킹)을 비우고, 누적 값의 최고 생존 시간을 4분 이하로 자른다
delete from public.survival_records;
update public.survival_profiles
  set totals = jsonb_set(totals, '{bestTime}', to_jsonb(240))
  where coalesce((totals->>'bestTime')::numeric, 0) > 240;
