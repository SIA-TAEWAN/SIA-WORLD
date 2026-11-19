-- 061: 시아돌격대 (1인 무리 달리기)
--   charge_profiles : 사용자별 엽전 · 공통 강화 · 누적 별 (본인만 읽기, 쓰기는 함수만)
--   charge_stages   : 사용자·스테이지별 최고 별 (본인만 읽기, 쓰기는 함수만)
--   charge_runs     : 판 한 번 (시작 시각과 결과. 권한 없음: 함수로만 읽고 쓴다)
--   charge_endless  : 끝없는 모드(끝없는 길)의 사용자별 최고 기록 (누구나 읽기 → charge_endless_ranking 뷰)
--   charge_stage_ranking · charge_endless_ranking : 랭킹 뷰 2개 (PRD 11장)
-- 게임 계산은 기기에서만 돌기 때문에 서버는 보고된 값을 그대로 믿지 않는다 (시아디펜스 048 과 같은 방식):
--   · 판은 charge_start() 로 시작 시각을 남긴 뒤에만 charge_finish() 로 끝낼 수 있다 (주인만, 한 번만)
--   · 서버가 잰 경과 시간이 보고한 판 시간보다 짧으면 거절, 이미 끝낸 다른 판과 시간이 겹치면 거절
--   · 클리어는 45초 이상 달린 판에서만. 별은 남은 대원으로 서버가 다시 계산한다
--   · 엽전은 화면이 보내지 않는다: 서버가 스테이지 표와 별·첫 클리어 여부·강화·대장으로 계산한다
-- 게임 쪽 값(games/charge/src/data/*.ts, src/game/progress.ts)과 같아야 하는 표는
-- games/charge/tests/sql.test.ts 가 이 파일을 읽어 비교한다 (npm run sqlrows 로 줄을 만든다).
-- 시간 단위는 모두 초.

-- ---------- 1. 표 ----------

create table if not exists public.charge_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  -- 공통 강화: { "attack": 2, ... } (없는 항목은 0)
  upgrades jsonb not null default '{}'::jsonb,
  -- 스테이지 랭킹용 누적 값 (charge_stage_ranking 이 읽는다): 모은 별 · 클리어한 스테이지 수 · 별이 마지막으로 늘어난 시각
  total_stars int not null default 0 check (total_stars >= 0),
  cleared_stages int not null default 0 check (cleared_stages >= 0),
  stars_updated_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.charge_profiles enable row level security;
drop policy if exists charge_profiles_read_own on public.charge_profiles;
create policy charge_profiles_read_own on public.charge_profiles for select using (auth.uid() = user_id);
revoke all on public.charge_profiles from anon, authenticated;
grant select on public.charge_profiles to authenticated;

create table if not exists public.charge_stages (
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage_id text not null,
  stars int not null check (stars between 1 and 3),
  best_troops int not null default 0,
  cleared_at timestamptz not null default now(),
  primary key (user_id, stage_id)
);
alter table public.charge_stages enable row level security;
drop policy if exists charge_stages_read_own on public.charge_stages;
create policy charge_stages_read_own on public.charge_stages for select using (auth.uid() = user_id);
revoke all on public.charge_stages from anon, authenticated;
grant select on public.charge_stages to authenticated;

create table if not exists public.charge_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage_id text not null,
  leader text not null,
  -- 'normal' 스테이지 / 'endless' 끝없는 모드 (시작할 때 정해진다)
  mode text not null default 'normal' check (mode in ('normal', 'endless')),
  started_at timestamptz not null default now(),
  -- 끝나기 전에는 비어 있다
  finished_at timestamptz,
  time int,
  cleared boolean,
  troops int,
  kills int,
  meters int,
  bosses int,
  coins_earned int
);
alter table public.charge_runs enable row level security;
-- 정책 없음 + 권한 없음: 함수(security definer)로만 읽고 쓴다
revoke all on public.charge_runs from anon, authenticated;
create index if not exists charge_runs_user_idx on public.charge_runs (user_id, started_at desc);

-- 끝없는 모드의 최고 기록: 각자 하나 (달린 거리 m, 그때의 대장, 달성 시각). 누구나 읽기, 쓰기는 charge_finish 만
create table if not exists public.charge_endless (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  best_meters int not null check (best_meters >= 0),
  leader text not null,
  achieved_at timestamptz not null default now()
);
alter table public.charge_endless enable row level security;
drop policy if exists charge_endless_read on public.charge_endless;
create policy charge_endless_read on public.charge_endless for select using (true);
revoke all on public.charge_endless from anon, authenticated;
grant select on public.charge_endless to anon, authenticated;
create index if not exists charge_endless_rank_idx on public.charge_endless (best_meters desc, achieved_at);

-- ---------- 2. 기준 값 ----------

-- 판 검증에 쓰는 값. 게임 쪽 값(games/charge/src/game/progress.ts 의 LIMITS, src/data/balance.ts)과 맞춘다.
create or replace function public._charge_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_time' then 600
    when 'endless_max_time' then 3600
    when 'clear_min_time' then 45
    when 'time_slack' then 3
    when 'max_troops' then 9999
    when 'coin_min_time' then 20
    when 'max_age' then 7200
    when 'run_speed' then 300
    when 'meter' then 50
    when 'endless_seg' then 9000
  end
$$;
revoke all on function public._charge_const(text) from public, anon, authenticated;

-- 스테이지: 지역 · 번호 · 별 2개 기준 · 별 3개 기준 · 상자 엽전 합. games/charge/src/data/stages.ts (npm run sqlrows)
create or replace function public._charge_stages() returns table (stage_id text, region int, no int, stars2 int, stars3 int, crate_coins int)
language sql immutable as $$
  select * from (values
    ('1-1', 1, 1, 55, 115, 0),
    ('1-2', 1, 2, 85, 170, 0),
    ('1-3', 1, 3, 85, 170, 0),
    ('1-4', 1, 4, 115, 230, 0),
    ('1-5', 1, 5, 125, 250, 0),
    ('2-1', 2, 1, 152, 304, 0),
    ('2-2', 2, 2, 186, 372, 0),
    ('2-3', 2, 3, 243, 485, 0),
    ('2-4', 2, 4, 329, 658, 0),
    ('2-5', 2, 5, 120, 241, 5),
    ('3-1', 3, 1, 133, 266, 0),
    ('3-2', 3, 2, 258, 515, 0),
    ('3-3', 3, 3, 90, 180, 0),
    ('3-4', 3, 4, 147, 293, 0),
    ('3-5', 3, 5, 284, 567, 0),
    ('4-1', 4, 1, 105, 210, 0),
    ('4-2', 4, 2, 125, 250, 0),
    ('4-3', 4, 3, 103, 205, 0),
    ('4-4', 4, 4, 228, 456, 0),
    ('4-5', 4, 5, 165, 330, 5),
    ('5-1', 5, 1, 138, 275, 0),
    ('5-2', 5, 2, 219, 439, 0),
    ('5-3', 5, 3, 236, 471, 0),
    ('5-4', 5, 4, 106, 213, 0),
    ('5-5', 5, 5, 201, 402, 5),
    ('6-1', 6, 1, 193, 386, 0),
    ('6-2', 6, 2, 475, 950, 0),
    ('6-3', 6, 3, 304, 608, 0),
    ('6-4', 6, 4, 199, 398, 0),
    ('6-5', 6, 5, 149, 298, 0),
    ('7-1', 7, 1, 360, 720, 0),
    ('7-2', 7, 2, 232, 465, 0),
    ('7-3', 7, 3, 182, 365, 0),
    ('7-4', 7, 4, 248, 497, 5),
    ('7-5', 7, 5, 624, 1247, 0),
    ('8-1', 8, 1, 241, 483, 0),
    ('8-2', 8, 2, 129, 258, 0),
    ('8-3', 8, 3, 272, 543, 0),
    ('8-4', 8, 4, 698, 1396, 0),
    ('8-5', 8, 5, 363, 726, 0),
    ('9-1', 9, 1, 1069, 2138, 0),
    ('9-2', 9, 2, 155, 309, 0),
    ('9-3', 9, 3, 223, 447, 0),
    ('9-4', 9, 4, 387, 775, 0),
    ('9-5', 9, 5, 385, 771, 0),
    ('10-1', 10, 1, 359, 718, 0),
    ('10-2', 10, 2, 181, 361, 0),
    ('10-3', 10, 3, 241, 482, 0),
    ('10-4', 10, 4, 183, 365, 0),
    ('10-5', 10, 5, 377, 753, 0),
    ('11-1', 11, 1, 224, 447, 0),
    ('11-2', 11, 2, 596, 1193, 5),
    ('11-3', 11, 3, 460, 919, 0),
    ('11-4', 11, 4, 257, 515, 0),
    ('11-5', 11, 5, 425, 849, 0),
    ('12-1', 12, 1, 292, 585, 0),
    ('12-2', 12, 2, 225, 450, 0),
    ('12-3', 12, 3, 127, 253, 0),
    ('12-4', 12, 4, 277, 554, 0),
    ('12-5', 12, 5, 638, 1277, 0)
  ) as t(stage_id, region, no, stars2, stars3, crate_coins)
$$;
revoke all on function public._charge_stages() from public, anon, authenticated;

-- 공통 강화: 항목, 최대 레벨, 첫 비용, 레벨마다 더해지는 값. 레벨 n → n+1 의 비용 = base_cost + step × n
-- games/charge/src/data/growth.ts 의 UPGRADES
create or replace function public._charge_upgrades() returns table (key text, max_level int, base_cost int, step int)
language sql immutable as $$
  select * from (values
    ('troops', 20, 60, 30),
    ('attack', 20, 80, 40),
    ('rate', 10, 100, 50),
    ('range', 5, 120, 80),
    ('boss', 10, 100, 50),
    ('coin', 5, 150, 100)
  ) as t(key, max_level, base_cost, step)
$$;
revoke all on function public._charge_upgrades() from public, anon, authenticated;

-- 대장: 여는 지역 (0 = 처음부터, r = r-5 를 클리어하면) · 엽전 배율. games/charge/src/data/balance.ts 의 LEADERS
create or replace function public._charge_leaders() returns table (id text, unlock_region int, coin_mul numeric)
language sql immutable as $$
  select * from (values
    ('rat', 0, 1),
    ('ox', 0, 1),
    ('tiger', 0, 1),
    ('rabbit', 1, 1),
    ('dragon', 2, 1),
    ('snake', 3, 1),
    ('horse', 4, 1),
    ('sheep', 5, 1),
    ('monkey', 6, 1),
    ('rooster', 7, 1),
    ('dog', 8, 1),
    ('pig', 9, 1.1)
  ) as t(id, unlock_region, coin_mul)
$$;
revoke all on function public._charge_leaders() from public, anon, authenticated;

-- ---------- 3. 열림 여부 (games/charge/src/game/progress.ts 와 같은 규칙) ----------

create or replace function public._charge_cleared(p_user uuid, p_stage text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.charge_stages s where s.user_id = p_user and s.stage_id = p_stage)
$$;
revoke all on function public._charge_cleared(uuid, text) from public, anon, authenticated;

-- 지역 r: 1지역은 처음부터, 그 뒤는 앞 지역 5번째 클리어 + 모은 별 (r-1)×9 이상
create or replace function public._charge_region_open(p_user uuid, p_region int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_region <= 1 or (
    public._charge_cleared(p_user, (p_region - 1)::text || '-5')
    and coalesce((select sum(s.stars) from public.charge_stages s where s.user_id = p_user), 0) >= (p_region - 1) * 9
  )
$$;
revoke all on function public._charge_region_open(uuid, int) from public, anon, authenticated;

create or replace function public._charge_stage_open(p_user uuid, p_stage text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public._charge_stages() t
    where t.stage_id = p_stage and public._charge_region_open(p_user, t.region)
      and (t.no = 1 or public._charge_cleared(p_user, t.region::text || '-' || (t.no - 1)::text))
  )
$$;
revoke all on function public._charge_stage_open(uuid, text) from public, anon, authenticated;

-- 열린 대장 (처음 3종 + 여는 지역의 5번째를 클리어한 대장)
create or replace function public._charge_unlocked(p_user uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(l.id order by l.ord), array[]::text[]) from (
    select t.id, row_number() over () as ord, t.unlock_region from public._charge_leaders() t
  ) l
  where l.unlock_region = 0 or public._charge_cleared(p_user, l.unlock_region::text || '-5')
$$;
revoke all on function public._charge_unlocked(uuid) from public, anon, authenticated;

-- ---------- 4. 프로필 ----------

-- 내 프로필 줄 (없으면 만든다). 잠그고 읽는다
create or replace function public._charge_profile_row(p_user uuid) returns public.charge_profiles
language plpgsql security definer set search_path = public as $$
declare r public.charge_profiles;
begin
  insert into public.charge_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.charge_profiles where user_id = p_user for update;
  return r;
end $$;
revoke all on function public._charge_profile_row(uuid) from public, anon, authenticated;

-- 화면에 주는 모양: { coins, stages: { "1-1": 3 }, upgrades, endless: { meters, leader } | null }
create or replace function public._charge_profile_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'coins', coalesce(p.coins, 0),
    'upgrades', coalesce(p.upgrades, '{}'::jsonb),
    'stages', coalesce((select jsonb_object_agg(s.stage_id, s.stars) from public.charge_stages s where s.user_id = p_user), '{}'::jsonb),
    'endless', (select jsonb_build_object('meters', e.best_meters, 'leader', e.leader) from public.charge_endless e where e.user_id = p_user)
  )
  from (select 1) one left join public.charge_profiles p on p.user_id = p_user
$$;
revoke all on function public._charge_profile_json(uuid) from public, anon, authenticated;

create or replace function public.charge_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  return public._charge_profile_json(me);
end $$;
revoke all on function public.charge_profile() from public, anon;
grant execute on function public.charge_profile() to authenticated;

-- ---------- 5. 판 시작 · 끝 ----------

create or replace function public.charge_start(p_stage text, p_leader text, p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('normal', 'endless') then raise exception 'bad mode'; end if;
  if p_leader is null or not exists (select 1 from public._charge_leaders() l where l.id = p_leader) then raise exception 'bad leader'; end if;
  if not (p_leader = any(public._charge_unlocked(me))) then raise exception 'leader locked'; end if;
  if p_mode = 'endless' then
    if p_stage is distinct from 'endless' then raise exception 'bad stage'; end if;
    if not public._charge_cleared(me, '1-5') then raise exception 'endless locked'; end if;
  else
    if p_stage is null or not exists (select 1 from public._charge_stages() t where t.stage_id = p_stage) then raise exception 'bad stage'; end if;
    if not public._charge_stage_open(me, p_stage) then raise exception 'stage locked'; end if;
  end if;
  perform public._charge_profile_row(me);
  insert into public.charge_runs (user_id, stage_id, leader, mode) values (me, p_stage, p_leader, p_mode) returning id into rid;
  return rid;
end $$;
revoke all on function public.charge_start(text, text, text) from public, anon;
grant execute on function public.charge_start(text, text, text) to authenticated;

create or replace function public.charge_finish(
  p_run uuid, p_time int, p_cleared boolean, p_troops int, p_kills int, p_progress numeric, p_meters int, p_bosses int, p_crate int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  rn public.charge_runs;
  pr public.charge_profiles;
  st record;
  endless boolean;
  elapsed numeric;
  n_stars int := 0;
  old_stars int := 0;
  first boolean := false;
  best boolean := false;
  raw numeric := 0;
  crate numeric := 0;
  coin_mul numeric;
  leader_mul numeric;
  n_coins int;
  before_leaders text[];
  after_leaders text[];
  got_coin boolean := false;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into rn from public.charge_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.finished_at is not null then raise exception 'already finished'; end if;
  endless := rn.mode = 'endless';
  if p_time is null or p_cleared is null or p_troops is null or p_kills is null or p_progress is null or p_meters is null or p_bosses is null or p_crate is null then raise exception 'bad result'; end if;
  if p_time < 0 or p_time > (case when endless then public._charge_const('endless_max_time') else public._charge_const('max_time') end) then raise exception 'bad time'; end if;
  if p_troops < 0 or p_troops > public._charge_const('max_troops') or p_kills < 0 or p_crate < 0 or p_progress < 0 or p_progress > 1 or p_meters < 0 or p_bosses < 0 then raise exception 'bad result'; end if;
  if endless then
    if p_cleared then raise exception 'bad result'; end if;
    if p_meters > p_time * public._charge_const('run_speed') / public._charge_const('meter') + 5 then raise exception 'bad result'; end if;
    if p_bosses > floor(p_meters * public._charge_const('meter') / public._charge_const('endless_seg')) + 1 then raise exception 'bad result'; end if;
  elsif p_cleared and (p_time < public._charge_const('clear_min_time') or p_troops < 1) then raise exception 'bad result';
  end if;
  elapsed := extract(epoch from (now() - rn.started_at));
  if elapsed < p_time - public._charge_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._charge_const('max_age') then raise exception 'too late'; end if;
  if exists (
    select 1 from public.charge_runs o
    where o.user_id = me and o.id <> rn.id and o.finished_at is not null
      and o.finished_at > rn.started_at + interval '2 seconds' and o.started_at < now() - interval '2 seconds'
  ) then raise exception 'overlap'; end if;

  pr := public._charge_profile_row(me);
  before_leaders := public._charge_unlocked(me);
  coin_mul := 1 + 0.05 * least(5, greatest(0, coalesce((pr.upgrades ->> 'coin')::int, 0)));
  select l.coin_mul into leader_mul from public._charge_leaders() l where l.id = rn.leader;
  leader_mul := coalesce(leader_mul, 1);

  if endless then
    raw := floor(p_meters / 20.0) + 5 * p_bosses;
    if not exists (select 1 from public.charge_endless e where e.user_id = me and e.best_meters >= p_meters) then
      insert into public.charge_endless (user_id, best_meters, leader, achieved_at) values (me, p_meters, rn.leader, now())
      on conflict (user_id) do update set best_meters = excluded.best_meters, leader = excluded.leader, achieved_at = excluded.achieved_at;
      best := true;
    end if;
  else
    select * into st from public._charge_stages() t where t.stage_id = rn.stage_id;
    if not found then raise exception 'bad stage'; end if;
    crate := least(p_crate, round(st.crate_coins * 1.2));
    if p_cleared then
      n_stars := case when p_troops >= st.stars3 then 3 when p_troops >= st.stars2 then 2 else 1 end;
      select s.stars into old_stars from public.charge_stages s where s.user_id = me and s.stage_id = rn.stage_id;
      first := old_stars is null;
      old_stars := coalesce(old_stars, 0);
      raw := 15 + 5 * st.region + 5 * n_stars + (case when first then 20 + 10 * st.region else 0 end);
      insert into public.charge_stages (user_id, stage_id, stars, best_troops) values (me, rn.stage_id, n_stars, p_troops)
      on conflict (user_id, stage_id) do update set stars = greatest(public.charge_stages.stars, excluded.stars),
        best_troops = greatest(public.charge_stages.best_troops, excluded.best_troops);
      best := n_stars > old_stars;
    else
      raw := floor((15 + 5 * st.region) * 0.3 * least(1, greatest(0, p_progress)));
    end if;
  end if;

  n_coins := floor((raw + crate) * coin_mul * leader_mul);
  update public.charge_profiles set
    coins = coins + n_coins,
    total_stars = coalesce((select sum(s.stars) from public.charge_stages s where s.user_id = me), 0),
    cleared_stages = (select count(*) from public.charge_stages s where s.user_id = me),
    stars_updated_at = case when best and not endless then now() else stars_updated_at end,
    updated_at = now()
  where user_id = me;
  update public.charge_runs set finished_at = now(), time = p_time, cleared = p_cleared, troops = p_troops, kills = p_kills,
    meters = p_meters, bosses = p_bosses, coins_earned = n_coins where id = rn.id;
  after_leaders := public._charge_unlocked(me);
  -- 시아코인: 20초 넘게 한 판마다 1 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if p_time >= public._charge_const('coin_min_time') then
    got_coin := public._grant_sia_coin(me, 'charge', p_run::text);
  end if;
  return jsonb_build_object(
    'profile', public._charge_profile_json(me),
    'result', jsonb_build_object(
      'coins', n_coins, 'stars', n_stars, 'first', first, 'best', best, 'siaCoin', got_coin,
      'newLeaders', to_jsonb(array(select x from unnest(after_leaders) x where not (x = any(before_leaders))))
    )
  );
end $$;
revoke all on function public.charge_finish(uuid, int, boolean, int, int, numeric, int, int, int) from public, anon;
grant execute on function public.charge_finish(uuid, int, boolean, int, int, numeric, int, int, int) to authenticated;

-- ---------- 6. 강화 ----------

create or replace function public.charge_buy_upgrade(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.charge_profiles; u record; lv int; price int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into u from public._charge_upgrades() t where t.key = p_key;
  if not found then raise exception 'bad upgrade'; end if;
  pr := public._charge_profile_row(me);
  lv := coalesce((pr.upgrades ->> p_key)::int, 0);
  if lv >= u.max_level then raise exception 'max level'; end if;
  price := u.base_cost + u.step * lv;
  if pr.coins < price then raise exception 'not enough coins'; end if;
  update public.charge_profiles set coins = coins - price, upgrades = upgrades || jsonb_build_object(p_key, lv + 1), updated_at = now()
  where user_id = me;
  return public._charge_profile_json(me);
end $$;
revoke all on function public.charge_buy_upgrade(text) from public, anon;
grant execute on function public.charge_buy_upgrade(text) to authenticated;

-- ---------- 7. 랭킹 ----------

-- 스테이지 랭킹: 모은 별 → 클리어한 스테이지 수 → 먼저 달성한 순
create or replace view public.charge_stage_ranking as
  select r.user_id, p.nickname, r.total_stars, r.cleared_stages,
    (select d.stage_id from public.charge_stages d where d.user_id = r.user_id
      order by split_part(d.stage_id, '-', 1)::int desc, split_part(d.stage_id, '-', 2)::int desc limit 1) as best_stage,
    r.stars_updated_at as achieved_at,
    (row_number() over (order by r.total_stars desc, r.cleared_stages desc, r.stars_updated_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.charge_profiles r join public.profiles p on p.id = r.user_id
  where r.total_stars > 0;
revoke all on public.charge_stage_ranking from anon, authenticated;
grant select on public.charge_stage_ranking to anon, authenticated;

-- 끝없는 모드 랭킹: 달린 거리 → 먼저 달성한 순. 각자 최고 기록 하나
create or replace view public.charge_endless_ranking as
  select r.user_id, p.nickname, r.best_meters, r.leader, r.achieved_at,
    (row_number() over (order by r.best_meters desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.charge_endless r join public.profiles p on p.id = r.user_id;
revoke all on public.charge_endless_ranking from anon, authenticated;
grant select on public.charge_endless_ranking to anon, authenticated;

-- ---------- 게임 오픈 여부 ----------
-- 처음에는 닫힌 상태로 추가한다 (관리자만 보이고 들어갈 수 있다. 로비의 오픈 설정에서 연다)
insert into public.app_settings (key, value) values ('game_open:charge', 'false'::jsonb) on conflict (key) do nothing;
