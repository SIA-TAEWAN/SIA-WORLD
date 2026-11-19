-- 시아서바이벌: 헬 모드와 헬 모드 랭킹 (게임 쪽 수치는 games/survival/src/data/balance.ts 의 HELL · data/maps.ts 의 hell, 같은 값은 src/game/progress.ts 의 LIMITS)
--   헬 모드: 기존 맵 4종의 더 강한 판 (배경·요괴·보스는 같다. 요괴가 더 강하고, 보스마다 패턴이 하나 더 있고, 엽전을 2배로 준다).
--   4분 판이고 클리어가 있다. 헬 모드의 무한 모드는 없다. 그 맵을 4분 모드로 클리어하면 **그 맵의** 헬 모드가 열린다.
--   1. survival_runs.mode 에 'hell' 을 더한다. survival_start 의 모드 인자도 'hell' 을 받는다 (두 인자·세 인자 호출은 그대로).
--      잠금은 무한 모드와 같은 기준이다 (045 의 _survival_map_cleared: 그 맵의 클리어 기록이 있거나 그 맵의 다음 맵이 열려 있다).
--   2. survival_finish: 헬 모드는
--        · 가장 긴 판 240초, 클리어는 240초에서만, 'too early' · 'overlap' · 처치 수 하한 · 처치·레벨·떡·보스 상한은 4분 모드와 똑같다
--        · 엽전 상한만 2배 (hell_coin_mul)
--        · 기록은 survival_hell_records 에 따로 (생존 시간 → 클리어 → 처치 수 → 먼저 달성). 4분 모드·무한 모드 기록·랭킹은 건드리지 않는다
--        · 누적 처치·떡·보스·클리어 수·판 수, 도감, 시아코인, 누적 조건 해금(용·뱀·양)은 4분 모드와 같게 반영한다.
--          시간 조건 해금(토끼·말)과 클리어 해금(돼지), 다음 맵 해금, 누적 값의 최고 생존 시간은 4분 모드에서만 (헬 클리어는 해금에 쓰지 않는다)
--   3. 프로필 JSON 에 hellBest(헬 모드 맵별 내 최고 기록)를 더한다. 헬 모드가 열린 맵은 clearedMaps 그대로다 (무한 모드와 같은 조건).
--   4. survival_hell_ranking 뷰 (survival_ranking 과 같은 모양·권한).
--   5. 관리자 계정(profiles.is_admin)은 시험용으로, 시아서바이벌에 들어올 때마다(survival_profile) 엽전과 시아코인이 10,000 으로 맞춰진다.
--      일반 사용자는 영향이 없고, 기록·랭킹·누적 값에도 영향이 없다.
-- _survival_const · _survival_profile_json · survival_start · survival_finish 는 045_survival_review.sql 의 정의 그대로에 위 내용만 바꿨다.
-- 여러 번 올려도 된다.

-- ---------- 1. 표 ----------

-- 모드 칸: 'hell' 을 받게 한다 (044 가 칸을 만들 때 붙은 이름 survival_runs_mode_check)
alter table public.survival_runs drop constraint if exists survival_runs_mode_check;
alter table public.survival_runs add constraint survival_runs_mode_check check (mode in ('normal', 'endless', 'hell'));

-- 헬 모드의 사용자·맵별 최고 기록 (누구나 읽기 → survival_hell_ranking 뷰. 쓰기는 survival_finish 만)
create table if not exists public.survival_hell_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  map_id text not null check (map_id in ('field', 'bamboo', 'palace', 'underworld')),
  best_time int not null check (best_time between 0 and 240),
  best_kills int not null check (best_kills >= 0),
  cleared boolean not null default false,
  character text not null,
  achieved_at timestamptz not null default now(),
  primary key (user_id, map_id)
);
alter table public.survival_hell_records enable row level security;
drop policy if exists survival_hell_records_read on public.survival_hell_records;
create policy survival_hell_records_read on public.survival_hell_records for select using (true);
revoke all on public.survival_hell_records from anon, authenticated;
grant select on public.survival_hell_records to anon, authenticated;
create index if not exists survival_hell_records_rank_idx on public.survival_hell_records (map_id, best_time desc, cleared desc, best_kills desc, achieved_at);

-- ---------- 2. 기준 값 ----------

-- 045 의 값 그대로에 헬 모드의 엽전 배율을 더한다
create or replace function public._survival_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_time' then 240            -- 4분 모드의 한 판은 최대 4분 (초). 무한 모드는 이 시각 뒤로 요괴가 계속 강해진다
    when 'time_slack' then 15           -- 서버가 잰 경과 시간이 판에 걸리는 가장 짧은 시간보다 이만큼까지는 짧아도 된다 (시계·통신 오차 + 판 시작 알림이 늦게 닿은 만큼)
    when 'max_speed' then 2             -- 가장 빠른 배속: 생존 시간 t초인 판은 실제로 적어도 t / max_speed 초가 걸린다
    when 'max_age' then 604800          -- 시작 뒤 7일이 지난 판은 받지 않는다 (일시정지·나중에 다시 보내기 포함)
    when 'kills_base' then 100          -- 처치 수 상한 = kills_base + 생존 시간 × kills_per_sec
    when 'kills_per_sec' then 50
    when 'kills_min_from' then 120      -- 처치 수 하한 = (생존 시간 − kills_min_from) × kills_min_per_sec. 이보다 적게 잡은 판은 세지 않는다
    when 'kills_min_per_sec' then 1     --   (실제 판은 처음 1~2분에는 거의 못 잡고도 살아 있을 수 있어 2분 뒤부터만 본다. 값은 실제 판 최소치의 절반 이하)
    when 'level_base' then 5            -- 레벨 상한 = level_base + 생존 시간 × level_per_sec
    when 'level_per_sec' then 0.5
    when 'coins_base' then 0            -- 엽전 상한 = (coins_base + 생존 시간 × coins_per_sec) × 맵 엽전 배율
    when 'coins_per_sec' then 5
    when 'cakes_base' then 5            -- 떡 상한 = cakes_base + 생존 시간 × cakes_per_sec
    when 'cakes_per_sec' then 0.15
    when 'boss_max' then 3              -- 4분까지의 보스는 셋
    when 'boss1_time' then 80           -- 첫 보스는 1분 20초에 나온다 (그 전에는 보스를 잡을 수 없다)
    when 'coin_min_time' then 60        -- 시아코인은 1분 넘게 버틴 판에만 (생존 시간과 서버가 잰 실제 경과 시간 둘 다)
    when 'count_min_time' then 20       -- 이보다 짧은 판은 엽전·누적·기록·도감에 들어가지 않는다 (시작하자마자 끝내기 반복 방지)
    when 'open_runs' then 5             -- 한 사람이 끝내지 않고 둘 수 있는 판 수 (보류된 결과를 나중에 보낼 수 있게)
    when 'codex_max' then 40            -- 한 번에 보내는 도감 id 수 (종류마다)
    when 'endless_max_time' then 1200   -- 무한 모드의 가장 긴 판 (초). 실제로는 10분 안팎에서 끝난다
    when 'endless_boss_every' then 80   -- 무한 모드: 4분 뒤로 이 간격마다 보스가 하나씩 다시 나온다
    when 'hell_coin_mul' then 2         -- 헬 모드: 엽전 2배 (엽전 상한 = 4분 모드 상한 × 이 값)
  end
$$;
revoke all on function public._survival_const(text) from public, anon, authenticated;

-- ---------- 3. 프로필 ----------

-- 045 와 같다. hellBest (헬 모드의 맵별 내 최고 기록 { 맵: { time, kills, cleared } }) 만 더했다.
-- 헬 모드가 열린 맵은 clearedMaps 다 (무한 모드와 같은 조건)
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
      from public._survival_maps() m
      where public._survival_map_cleared(r.user_id, m.map_id, r.unlocked_maps)), '[]'::jsonb),
    'endlessBest', coalesce((
      select jsonb_object_agg(e.map_id, jsonb_build_object('time', e.best_time, 'kills', e.best_kills))
      from public.survival_endless_records e where e.user_id = r.user_id), '{}'::jsonb),
    'hellBest', coalesce((
      select jsonb_object_agg(h.map_id, jsonb_build_object('time', h.best_time, 'kills', h.best_kills, 'cleared', h.cleared))
      from public.survival_hell_records h where h.user_id = r.user_id), '{}'::jsonb))
$$;
revoke all on function public._survival_profile_json(public.survival_profiles) from public, anon, authenticated;

-- 내 프로필 (없으면 만든다). 038 과 같다. 바뀐 곳: 관리자 계정이면 엽전과 시아코인을 10,000 으로 맞춘다 (시험용)
create or replace function public.survival_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.survival_profiles;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._survival_profile_row(me);
  -- 관리자 계정(시험용): 들어올 때마다 엽전과 시아코인을 1만으로 맞춘다. 일반 사용자는 영향이 없고, 기록·랭킹·누적 값에도 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    update public.survival_profiles set coins = 10000 where user_id = me returning * into pr;
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._survival_profile_json(pr);
end $$;
revoke all on function public.survival_profile() from public, anon;
grant execute on function public.survival_profile() to authenticated;

-- ---------- 4. 판 시작 ----------

-- 045 와 같다. 모드에 'hell' 을 받고, 헬 모드의 잠금을 본다
create or replace function public.survival_start(p_map text, p_character text, p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.survival_profiles; rid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_map is null or not exists (select 1 from public._survival_maps() m where m.map_id = p_map) then raise exception 'bad map'; end if;
  if p_character is null or p_character not in ('rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig') then raise exception 'bad character'; end if;
  if p_mode is null or p_mode not in ('normal', 'endless', 'hell') then raise exception 'bad mode'; end if;
  pr := public._survival_profile_row(me);
  if not (p_map = any(pr.unlocked_maps)) then raise exception 'map locked'; end if;
  if not (p_character = any(pr.unlocked_characters)) then raise exception 'character locked'; end if;
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

-- ---------- 5. 판 끝 ----------

-- 045 와 같다. 바뀐 곳: 헬 모드(hell)의 엽전 상한 2배 · 기록 표 · 해금 제외
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
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._survival_profile_row(me);
  select * into rn from public.survival_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.created_at is not null then raise exception 'already finished'; end if;
  endless := rn.mode = 'endless';
  -- 헬 모드는 4분 판이다 (가장 긴 판·클리어·보스 수는 4분 모드와 같다). 다른 것은 엽전 상한(2배)과 기록·해금뿐
  hell := rn.mode = 'hell';
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

  -- 시아코인: 1분 넘게 버틴 정상 판. 실제로도 1분이 걸렸어야 하고(2배속으로 30초마다 받는 것 방지), 요괴를 너무 적게 잡은 판은 뺀다
  -- (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if ok and enough and p_time >= public._survival_const('coin_min_time') and elapsed >= public._survival_const('coin_min_time') then
    got_coin := public._grant_sia_coin(me, 'survival', p_run::text);
  end if;

  return jsonb_build_object(
    'profile', public._survival_profile_json(pr),
    'result', jsonb_build_object(
      'coins', coins, 'valid', ok, 'lowKills', not enough, 'newRecord', ok and counted and better, 'mode', rn.mode,
      'unlockedCharacters', to_jsonb(new_chars), 'unlockedMaps', to_jsonb(new_maps), 'siaCoin', got_coin));
end $$;
revoke all on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) from public, anon;
grant execute on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) to authenticated;

-- ---------- 6. 헬 모드 랭킹 ----------

-- 맵별 헬 모드 생존 시간 랭킹. 각자 맵별 최고 기록 하나, 누적 운영(초기화 없음). 4분 모드 랭킹(survival_ranking)·무한 모드 랭킹과 따로다.
-- 정렬: 생존 시간(최대 4분) → 클리어한 기록이 위 → 처치 수 → 먼저 달성한 순.
-- 칸은 survival_ranking 과 같다. place·total 은 맵 안에서의 순위와 인원
create or replace view public.survival_hell_ranking as
  select r.user_id, p.nickname, r.map_id, r.best_time, r.best_kills, r.cleared, r.character, r.achieved_at,
    (row_number() over (
      partition by r.map_id
      order by r.best_time desc, r.cleared desc, r.best_kills desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over (partition by r.map_id))::int as total
  from public.survival_hell_records r join public.profiles p on p.id = r.user_id;
revoke all on public.survival_hell_ranking from anon, authenticated;
grant select on public.survival_hell_ranking to anon, authenticated;
