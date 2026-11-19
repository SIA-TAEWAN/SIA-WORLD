-- 시아서바이벌: 무한 모드와 무한 모드 랭킹 (게임 쪽 수치는 games/survival/src/data, 같은 값은 src/game/progress.ts 의 LIMITS · data/maps.ts 의 endlessCoins)
--   무한 모드: 4분까지는 4분 모드와 같고, 최종 보스를 잡아도 끝나지 않고 죽을 때까지 이어진다. 그 맵을 4분 모드로 클리어해야 열린다.
--   1. survival_runs.mode ('normal' | 'endless'). survival_start 에 모드 인자 (없으면 4분 모드: 예전처럼 두 인자로 불러도 된다).
--      무한 모드는 그 맵의 4분 모드 클리어 기록(survival_records.cleared)이 있어야 시작할 수 있다.
--   2. survival_finish 는 판의 mode 를 보고 검증한다. 4분 모드는 043 과 같다. 무한 모드는
--        · 클리어가 없다 (p_cleared = true 는 거절), 생존 시간은 최대 3600초
--        · 'too early' · 'overlap' 은 max_speed 기준 그대로, 처치·레벨·떡 상한도 시간 비례 그대로
--        · 보스는 4분 뒤로 80초마다 하나씩 더 나온다 (보스 처치 상한 = 3 + (생존 시간 − 240) ÷ 80)
--        · 엽전은 시간 비례 상한과 맵별 고정 상한(_survival_endless_coin_cap) 가운데 작은 쪽까지 (오래 버텨도 강화가 빨라지지 않게)
--        · 기록은 survival_endless_records 에 따로 (생존 시간 → 처치 수 → 먼저 달성). 4분 모드 기록·랭킹은 건드리지 않는다
--        · 누적 처치·떡·보스·판 수, 도감, 시아코인(1분 이상), 누적 조건 해금(용·뱀·양)은 그대로 반영한다.
--          시간 조건 해금(토끼·말)과 클리어 해금(돼지), 다음 맵 해금, 누적 값의 최고 생존 시간은 4분 모드에서만.
--   3. 프로필 JSON 에 clearedMaps(4분 모드로 클리어한 맵)와 endlessBest(무한 모드 맵별 내 최고 기록)를 더한다.
--   4. survival_endless_ranking 뷰 (survival_ranking 과 같은 모양·권한).
-- 여러 번 올려도 된다.

-- ---------- 1. 표 ----------

alter table public.survival_runs add column if not exists mode text not null default 'normal' check (mode in ('normal', 'endless'));

-- 무한 모드의 사용자·맵별 최고 기록 (누구나 읽기 → survival_endless_ranking 뷰. 쓰기는 survival_finish 만)
create table if not exists public.survival_endless_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  map_id text not null check (map_id in ('field', 'bamboo', 'palace', 'underworld')),
  best_time int not null check (best_time between 0 and 3600),
  best_kills int not null check (best_kills >= 0),
  character text not null,
  achieved_at timestamptz not null default now(),
  primary key (user_id, map_id)
);
alter table public.survival_endless_records enable row level security;
drop policy if exists survival_endless_records_read on public.survival_endless_records;
create policy survival_endless_records_read on public.survival_endless_records for select using (true);
revoke all on public.survival_endless_records from anon, authenticated;
grant select on public.survival_endless_records to anon, authenticated;
create index if not exists survival_endless_records_rank_idx on public.survival_endless_records (map_id, best_time desc, best_kills desc, achieved_at);

-- ---------- 2. 기준 값 ----------

-- 043 의 값 그대로에 무한 모드 값 둘을 더한다
create or replace function public._survival_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_time' then 240            -- 4분 모드의 한 판은 최대 4분 (초). 무한 모드는 이 시각 뒤로 요괴가 계속 강해진다
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
    when 'boss_max' then 3              -- 4분까지의 보스는 셋
    when 'boss1_time' then 80           -- 첫 보스는 1분 20초에 나온다 (그 전에는 보스를 잡을 수 없다)
    when 'coin_min_time' then 60        -- 시아코인은 1분 넘게 버틴 판에만
    when 'count_min_time' then 20       -- 이보다 짧은 판은 엽전·누적·기록·도감에 들어가지 않는다 (시작하자마자 끝내기 반복 방지)
    when 'open_runs' then 5             -- 한 사람이 끝내지 않고 둘 수 있는 판 수 (보류된 결과를 나중에 보낼 수 있게)
    when 'codex_max' then 40            -- 한 번에 보내는 도감 id 수 (종류마다)
    when 'endless_max_time' then 3600   -- 무한 모드의 가장 긴 판 (초). 실제로는 10분 안팎에서 끝난다
    when 'endless_boss_every' then 80   -- 무한 모드: 4분 뒤로 이 간격마다 보스가 하나씩 다시 나온다
  end
$$;
revoke all on function public._survival_const(text) from public, anon, authenticated;

-- 무한 모드에서 한 판에 받을 수 있는 엽전의 고정 상한 (그 맵을 4분 모드로 클리어한 판이 흔히 받는 양의 약 1.5배).
-- games/survival/src/data/maps.ts 의 endlessCoins
create or replace function public._survival_endless_coin_cap() returns table (map_id text, cap int)
language sql immutable as $$
  values
    ('field', 450),
    ('bamboo', 400),
    ('palace', 600),
    ('underworld', 560)
$$;
revoke all on function public._survival_endless_coin_cap() from public, anon, authenticated;

-- ---------- 3. 프로필 모양 ----------

-- 화면에 보내는 프로필: 038 의 칸에 더해
--   clearedMaps  4분 모드로 클리어한 맵 (맵별 최고 기록의 cleared. 무한 모드가 열렸는지 화면이 이것으로 안다)
--   endlessBest  무한 모드의 맵별 내 최고 기록 { 맵: { time, kills } }
create or replace function public._survival_profile_json(r public.survival_profiles) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'coins', r.coins,
    'upgrades', r.upgrades,
    'unlockedCharacters', to_jsonb(r.unlocked_characters),
    'unlockedMaps', to_jsonb(r.unlocked_maps),
    'codex', r.codex,
    'totals', r.totals,
    'clearedMaps', coalesce((
      select jsonb_agg(m.map_id order by m.ord)
      from public._survival_maps() m join public.survival_records c on c.map_id = m.map_id
      where c.user_id = r.user_id and c.cleared), '[]'::jsonb),
    'endlessBest', coalesce((
      select jsonb_object_agg(e.map_id, jsonb_build_object('time', e.best_time, 'kills', e.best_kills))
      from public.survival_endless_records e where e.user_id = r.user_id), '{}'::jsonb))
$$;
revoke all on function public._survival_profile_json(public.survival_profiles) from public, anon, authenticated;

-- ---------- 4. 판 시작 ----------

-- 모드 인자가 생겼다. 기본값이 있어 예전처럼 두 인자로 불러도 4분 모드로 시작한다.
-- (예전 두 인자 함수를 남겨 두면 두 인자 호출이 어느 쪽인지 정해지지 않으므로 지운다)
drop function if exists public.survival_start(text, text);
create or replace function public.survival_start(p_map text, p_character text, p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.survival_profiles; rid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_map is null or not exists (select 1 from public._survival_maps() m where m.map_id = p_map) then raise exception 'bad map'; end if;
  if p_character is null or p_character not in ('rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig') then raise exception 'bad character'; end if;
  if p_mode is null or p_mode not in ('normal', 'endless') then raise exception 'bad mode'; end if;
  pr := public._survival_profile_row(me);
  if not (p_map = any(pr.unlocked_maps)) then raise exception 'map locked'; end if;
  if not (p_character = any(pr.unlocked_characters)) then raise exception 'character locked'; end if;
  -- 무한 모드는 그 맵을 4분 모드로 클리어한 기록이 있어야 열린다
  if p_mode = 'endless' and not exists (select 1 from public.survival_records c where c.user_id = me and c.map_id = p_map and c.cleared) then
    raise exception 'endless locked';
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

-- ---------- 5. 판 끝 ----------

-- 인자는 그대로다. 모드는 판을 시작할 때 정해진 것(survival_runs.mode)을 쓴다.
create or replace function public.survival_finish(
  p_run uuid, p_time int, p_kills int, p_level int, p_coins int, p_cleared boolean, p_boss_kills int, p_cakes int, p_codex jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t timestamptz := clock_timestamp();
  rn public.survival_runs; pr public.survival_profiles; old public.survival_records; old_e public.survival_endless_records;
  mul numeric; elapsed numeric; ok boolean := true; coins int; better boolean := false; got_coin boolean := false;
  tot jsonb; new_chars text[] := array[]::text[]; new_maps text[] := array[]::text[]; next_map text; c text;
  n_kills bigint; n_cakes bigint; counted boolean; endless boolean; max_t numeric; boss_cap numeric; fixed_cap int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._survival_profile_row(me);
  select * into rn from public.survival_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.created_at is not null then raise exception 'already finished'; end if;
  endless := rn.mode = 'endless';
  max_t := case when endless then public._survival_const('endless_max_time') else public._survival_const('max_time') end;
  if p_time is null or p_kills is null or p_level is null or p_coins is null or p_cleared is null or p_boss_kills is null or p_cakes is null then raise exception 'bad result'; end if;
  if p_time < 0 or p_time > max_t then raise exception 'bad time'; end if;
  if p_kills < 0 or p_level < 1 or p_coins < 0 or p_boss_kills < 0 or p_cakes < 0 then raise exception 'bad result'; end if;
  -- 무한 모드에는 클리어가 없다. 4분 모드의 클리어는 4분을 채운 판에서만
  if endless and p_cleared then raise exception 'bad result'; end if;
  if p_cleared and p_time <> public._survival_const('max_time') then raise exception 'bad time'; end if;
  -- 서버가 잰 경과 시간: 가장 빠른 배속(2배속)으로 한 것보다 짧을 수 없고(여유 5초), 7일이 넘은 판은 받지 않는다
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
  counted := p_time >= public._survival_const('count_min_time');

  select m.coin_mul into mul from public._survival_maps() m where m.map_id = rn.map_id;
  mul := coalesce(mul, 1);
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
    set time = p_time, kills = p_kills, level = p_level, coins_earned = coins, cleared = p_cleared and ok, valid = ok, created_at = t
    where id = p_run;

  pr.coins := pr.coins + coins;

  if ok and counted then
    -- 누적 값 (최고 생존 시간은 4분 모드의 값만)
    tot := pr.totals;
    n_kills := coalesce((tot->>'kills')::bigint, 0) + p_kills;
    n_cakes := coalesce((tot->>'cakes')::bigint, 0) + p_cakes;
    tot := jsonb_build_object(
      'kills', n_kills,
      'cakes', n_cakes,
      'bestTime', greatest(coalesce((tot->>'bestTime')::int, 0), case when endless then 0 else p_time end),
      'bossKills', coalesce((tot->>'bossKills')::bigint, 0) + p_boss_kills,
      'clears', coalesce((tot->>'clears')::bigint, 0) + (case when p_cleared then 1 else 0 end),
      'runs', coalesce((tot->>'runs')::bigint, 0) + 1);
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
      -- 시간 조건(토끼·말)과 클리어(돼지)는 4분 모드에서만
      continue when endless and c in ('rabbit', 'horse', 'pig');
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

    -- 다음 맵 해금: 이 맵을 4분 모드로 클리어했을 때 (무한 모드에는 클리어가 없다)
    if p_cleared and not endless then
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
      'coins', coins, 'valid', ok, 'newRecord', ok and counted and better, 'mode', rn.mode,
      'unlockedCharacters', to_jsonb(new_chars), 'unlockedMaps', to_jsonb(new_maps), 'siaCoin', got_coin));
end $$;
revoke all on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) from public, anon;
grant execute on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) to authenticated;

-- ---------- 6. 무한 모드 랭킹 ----------

-- 맵별 무한 모드 생존 시간 랭킹. 각자 맵별 최고 기록 하나, 누적 운영(초기화 없음). 4분 모드 랭킹(survival_ranking)과 따로다.
-- 정렬: 생존 시간 → 처치 수 → 먼저 달성한 순.
-- 칸은 survival_ranking 과 같다 (무한 모드에는 클리어가 없어 cleared 는 언제나 false). place·total 은 맵 안에서의 순위와 인원
create or replace view public.survival_endless_ranking as
  select r.user_id, p.nickname, r.map_id, r.best_time, r.best_kills, false as cleared, r.character, r.achieved_at,
    (row_number() over (
      partition by r.map_id
      order by r.best_time desc, r.best_kills desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over (partition by r.map_id))::int as total
  from public.survival_endless_records r join public.profiles p on p.id = r.user_id;
revoke all on public.survival_endless_ranking from anon, authenticated;
grant select on public.survival_endless_ranking to anon, authenticated;
