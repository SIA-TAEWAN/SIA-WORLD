-- 067: 시아핑거 (1인 턴제 튕기기 RPG)
--   finger_profiles : 사용자별 엽전 · 공통 강화 · 누적 별/클리어 수 (본인만 읽기, 쓰기는 함수만)
--   finger_heroes   : 사용자·대원별 레벨 (줄이 없으면 레벨 1. 본인만 읽기, 쓰기는 함수만)
--   finger_stages   : 사용자·스테이지별 최고 별 · 가장 적은 턴 (본인만 읽기, 쓰기는 함수만)
--   finger_runs     : 판 한 번 (시작 때 파티 · 레벨 · 강화 스냅숏과 결과. 권한 없음: 함수와 service_role 만)
--   finger_tower    : 끝없는 탑 최고 기록 자리 (6단계에서 쓴다. 누구나 읽기, 쓰기는 함수만)
-- 검증 방식 (PRD "서버와 검증"): 서버가 조작을 다시 돌려 결과를 직접 계산한다.
--   · finger_start() 가 판 번호와 시작 시각 · 스냅숏을 남긴다
--   · 화면은 조작 목록만 Edge Function finger-finish 로 보낸다. 함수가 스냅숏으로 같은 시뮬레이션
--     (supabase/functions/_shared/finger/verify.ts)을 다시 돌린 결과를 finger_finish_verified() 로 넘긴다 (service_role 만)
--   · 서버 경과 시간이 '턴 수 × 턴 최소 시간 + 날아간 스텝 ÷ 2배속'보다 짧으면 거절, 이미 끝낸 다른 판과 시간이 겹치면 거절
--   · 엽전은 서버가 보상표 + 별 + 첫 클리어 + 판 안에서 주운 엽전 + 엽전 강화(시작 때 값)로 계산한다
-- 게임 쪽 값(games/finger/src/data/growth.ts, src/game/progress.ts 의 LIMITS)과 같아야 하는 표는
-- games/finger/tests/sql.test.ts 가 이 파일을 읽어 비교한다 (npm run sqlrows 로 줄을 만든다).
-- 시간 단위는 모두 초.

-- ---------- 1. 표 ----------

create table if not exists public.finger_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  -- 공통 강화: { "hp": 2, ... } (없는 항목은 0)
  upgrades jsonb not null default '{}'::jsonb,
  -- 스테이지 랭킹용 누적 값: 모은 별 · 클리어한 스테이지 수 · 별이 마지막으로 늘어난 시각
  total_stars int not null default 0 check (total_stars >= 0),
  cleared_stages int not null default 0 check (cleared_stages >= 0),
  stars_updated_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.finger_profiles enable row level security;
drop policy if exists finger_profiles_read_own on public.finger_profiles;
create policy finger_profiles_read_own on public.finger_profiles for select using (auth.uid() = user_id);
revoke all on public.finger_profiles from anon, authenticated;
grant select on public.finger_profiles to authenticated;

create table if not exists public.finger_heroes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  hero text not null,
  level int not null default 1 check (level between 1 and 30),
  updated_at timestamptz not null default now(),
  primary key (user_id, hero)
);
alter table public.finger_heroes enable row level security;
drop policy if exists finger_heroes_read_own on public.finger_heroes;
create policy finger_heroes_read_own on public.finger_heroes for select using (auth.uid() = user_id);
revoke all on public.finger_heroes from anon, authenticated;
grant select on public.finger_heroes to authenticated;

create table if not exists public.finger_stages (
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage_id text not null,
  stars int not null check (stars between 1 and 3),
  best_turns int not null check (best_turns >= 0),
  cleared_at timestamptz not null default now(),
  primary key (user_id, stage_id)
);
alter table public.finger_stages enable row level security;
drop policy if exists finger_stages_read_own on public.finger_stages;
create policy finger_stages_read_own on public.finger_stages for select using (auth.uid() = user_id);
revoke all on public.finger_stages from anon, authenticated;
grant select on public.finger_stages to authenticated;

create table if not exists public.finger_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage_id text not null,
  -- 'normal' 스테이지 / 'tower' 끝없는 탑 (6단계)
  mode text not null default 'normal' check (mode in ('normal', 'tower')),
  -- 쏘는 순서대로 1~4명
  party text[] not null,
  -- 시작 때 스냅숏: 파티 대원 레벨 { "rat": 3 } · 공통 강화 { "hp": 2 }. finger-finish 가 이 값으로 다시 돌린다
  levels jsonb not null default '{}'::jsonb,
  upgrades jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  -- 끝나기 전에는 비어 있다
  finished_at timestamptz,
  cleared boolean,
  stars int,
  turns int,
  wave int,
  kills int,
  picked int,
  fallen int,
  steps int,
  coins_earned int
);
alter table public.finger_runs enable row level security;
-- 정책 없음 + 권한 없음: 함수(security definer)와 Edge Function(service_role)만 읽고 쓴다
revoke all on public.finger_runs from anon, authenticated;
grant select on public.finger_runs to service_role;
create index if not exists finger_runs_user_idx on public.finger_runs (user_id, started_at desc);

-- 끝없는 탑 최고 기록: 각자 하나 (올라간 층 · 쓴 턴 · 데려간 대원 · 달성 시각). 6단계에서 finger_finish_verified 가 쓴다
create table if not exists public.finger_tower (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  best_floor int not null check (best_floor >= 0),
  turns int not null default 0 check (turns >= 0),
  party text[] not null default '{}',
  achieved_at timestamptz not null default now()
);
alter table public.finger_tower enable row level security;
drop policy if exists finger_tower_read on public.finger_tower;
create policy finger_tower_read on public.finger_tower for select using (true);
revoke all on public.finger_tower from anon, authenticated;
grant select on public.finger_tower to anon, authenticated;
create index if not exists finger_tower_rank_idx on public.finger_tower (best_floor desc, turns, achieved_at);

-- ---------- 2. 기준 값 ----------

-- 판 검증에 쓰는 값. games/finger/src/game/progress.ts 의 LIMITS 와 맞춘다.
create or replace function public._finger_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'turn_min_time' then 0.4
    when 'step_rate' then 120
    when 'time_slack' then 2
    when 'max_age' then 7200
    when 'coin_min_time' then 20
    when 'max_turns' then 40
    when 'max_shot_steps' then 360
    when 'pick_cap' then 300
  end
$$;
revoke all on function public._finger_const(text) from public, anon, authenticated;

-- 스테이지 보상: 지역 · 번호 · 별 0개 클리어 엽전 · 별마다 · 첫 클리어 보너스. games/finger/src/data/growth.ts (npm run sqlrows)
create or replace function public._finger_stages() returns table (stage_id text, region int, no int, clear_coins int, star_coins int, first_coins int)
language sql immutable as $$
  select * from (values
    ('1-1', 1, 1, 28, 8, 45),
    ('1-2', 1, 2, 28, 8, 45),
    ('1-3', 1, 3, 28, 8, 45),
    ('1-4', 1, 4, 28, 8, 45),
    ('1-5', 1, 5, 38, 8, 65),
    ('2-1', 2, 1, 36, 8, 60),
    ('2-2', 2, 2, 36, 8, 60),
    ('2-3', 2, 3, 36, 8, 60),
    ('2-4', 2, 4, 36, 8, 60),
    ('2-5', 2, 5, 46, 8, 80),
    ('3-1', 3, 1, 44, 8, 75),
    ('3-2', 3, 2, 44, 8, 75),
    ('3-3', 3, 3, 44, 8, 75),
    ('3-4', 3, 4, 44, 8, 75),
    ('3-5', 3, 5, 54, 8, 95),
    ('4-1', 4, 1, 52, 8, 90),
    ('4-2', 4, 2, 52, 8, 90),
    ('4-3', 4, 3, 52, 8, 90),
    ('4-4', 4, 4, 52, 8, 90),
    ('4-5', 4, 5, 62, 8, 110),
    ('5-1', 5, 1, 60, 8, 105),
    ('5-2', 5, 2, 60, 8, 105),
    ('5-3', 5, 3, 60, 8, 105),
    ('5-4', 5, 4, 60, 8, 105),
    ('5-5', 5, 5, 70, 8, 125),
    ('6-1', 6, 1, 68, 8, 120),
    ('6-2', 6, 2, 68, 8, 120),
    ('6-3', 6, 3, 68, 8, 120),
    ('6-4', 6, 4, 68, 8, 120),
    ('6-5', 6, 5, 78, 8, 140),
    ('7-1', 7, 1, 76, 8, 135),
    ('7-2', 7, 2, 76, 8, 135),
    ('7-3', 7, 3, 76, 8, 135),
    ('7-4', 7, 4, 76, 8, 135),
    ('7-5', 7, 5, 86, 8, 155),
    ('8-1', 8, 1, 84, 8, 150),
    ('8-2', 8, 2, 84, 8, 150),
    ('8-3', 8, 3, 84, 8, 150),
    ('8-4', 8, 4, 84, 8, 150),
    ('8-5', 8, 5, 94, 8, 170),
    ('9-1', 9, 1, 92, 8, 165),
    ('9-2', 9, 2, 92, 8, 165),
    ('9-3', 9, 3, 92, 8, 165),
    ('9-4', 9, 4, 92, 8, 165),
    ('9-5', 9, 5, 102, 8, 185),
    ('10-1', 10, 1, 100, 8, 180),
    ('10-2', 10, 2, 100, 8, 180),
    ('10-3', 10, 3, 100, 8, 180),
    ('10-4', 10, 4, 100, 8, 180),
    ('10-5', 10, 5, 110, 8, 200),
    ('11-1', 11, 1, 108, 8, 195),
    ('11-2', 11, 2, 108, 8, 195),
    ('11-3', 11, 3, 108, 8, 195),
    ('11-4', 11, 4, 108, 8, 195),
    ('11-5', 11, 5, 118, 8, 215),
    ('12-1', 12, 1, 116, 8, 210),
    ('12-2', 12, 2, 116, 8, 210),
    ('12-3', 12, 3, 116, 8, 210),
    ('12-4', 12, 4, 116, 8, 210),
    ('12-5', 12, 5, 126, 8, 230)
  ) as t(stage_id, region, no, clear_coins, star_coins, first_coins)
$$;
revoke all on function public._finger_stages() from public, anon, authenticated;

-- 공통 강화: 항목, 최대 단계, 첫 비용, 단계마다 더해지는 값. 단계 n → n+1 의 비용 = base_cost + step × n
-- games/finger/src/data/growth.ts 의 UPGRADES (효과는 _shared/finger/heroes.ts 의 heroStats)
create or replace function public._finger_upgrades() returns table (key text, max_level int, base_cost int, step int)
language sql immutable as $$
  select * from (values
    ('hp', 20, 60, 30),
    ('charge', 5, 150, 100),
    ('heal', 10, 80, 40),
    ('coin', 5, 150, 100)
  ) as t(key, max_level, base_cost, step)
$$;
revoke all on function public._finger_upgrades() from public, anon, authenticated;

-- 대원 레벨 가격표: 레벨 → 다음 레벨로 가는 비용 (레벨 30 이 최대). games/finger/src/data/growth.ts 의 LEVEL_TABLE
create or replace function public._finger_levels() returns table (level int, cost int)
language sql immutable as $$
  select * from (values
    (1, 30),
    (2, 45),
    (3, 60),
    (4, 75),
    (5, 90),
    (6, 105),
    (7, 120),
    (8, 135),
    (9, 150),
    (10, 165),
    (11, 180),
    (12, 195),
    (13, 210),
    (14, 225),
    (15, 240),
    (16, 255),
    (17, 270),
    (18, 285),
    (19, 300),
    (20, 315),
    (21, 330),
    (22, 345),
    (23, 360),
    (24, 375),
    (25, 390),
    (26, 405),
    (27, 420),
    (28, 435),
    (29, 450)
  ) as t(level, cost)
$$;
revoke all on function public._finger_levels() from public, anon, authenticated;

-- 대원: 합류 지역 (0 = 처음부터, r = r-5 를 클리어하면). _shared/finger/heroes.ts 의 HEROES
create or replace function public._finger_heroes() returns table (id text, unlock_region int)
language sql immutable as $$
  select * from (values
    ('rat', 0),
    ('ox', 0),
    ('tiger', 0),
    ('rabbit', 1),
    ('dragon', 2),
    ('snake', 3),
    ('horse', 4),
    ('sheep', 5),
    ('monkey', 6),
    ('rooster', 7),
    ('dog', 8),
    ('pig', 9)
  ) as t(id, unlock_region)
$$;
revoke all on function public._finger_heroes() from public, anon, authenticated;

-- ---------- 3. 열림 여부 (games/finger/src/game/progress.ts 와 같은 규칙, 돌격대와 같음) ----------

create or replace function public._finger_cleared(p_user uuid, p_stage text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.finger_stages s where s.user_id = p_user and s.stage_id = p_stage)
$$;
revoke all on function public._finger_cleared(uuid, text) from public, anon, authenticated;

-- 지역 r: 1지역은 처음부터, 그 뒤는 앞 지역 5번째 클리어 + 모은 별 (r-1)×9 이상
create or replace function public._finger_region_open(p_user uuid, p_region int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_region <= 1 or (
    public._finger_cleared(p_user, (p_region - 1)::text || '-5')
    and coalesce((select sum(s.stars) from public.finger_stages s where s.user_id = p_user), 0) >= (p_region - 1) * 9
  )
$$;
revoke all on function public._finger_region_open(uuid, int) from public, anon, authenticated;

create or replace function public._finger_stage_open(p_user uuid, p_stage text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public._finger_stages() t
    where t.stage_id = p_stage and public._finger_region_open(p_user, t.region)
      and (t.no = 1 or public._finger_cleared(p_user, t.region::text || '-' || (t.no - 1)::text))
  )
$$;
revoke all on function public._finger_stage_open(uuid, text) from public, anon, authenticated;

-- 합류한 대원 (처음 3종 + 합류 지역의 5번째를 클리어한 대원), 십이지 순서
create or replace function public._finger_unlocked(p_user uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(h.id order by h.ord), array[]::text[]) from (
    select t.id, row_number() over () as ord, t.unlock_region from public._finger_heroes() t
  ) h
  where h.unlock_region = 0 or public._finger_cleared(p_user, h.unlock_region::text || '-5')
$$;
revoke all on function public._finger_unlocked(uuid) from public, anon, authenticated;

-- ---------- 4. 프로필 ----------

-- 내 프로필 줄 (없으면 만든다). 잠그고 읽는다
create or replace function public._finger_profile_row(p_user uuid) returns public.finger_profiles
language plpgsql security definer set search_path = public as $$
declare r public.finger_profiles;
begin
  insert into public.finger_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.finger_profiles where user_id = p_user for update;
  return r;
end $$;
revoke all on function public._finger_profile_row(uuid) from public, anon, authenticated;

-- 화면에 주는 모양: { coins, upgrades, levels: { "rat": 3 }, heroes: [합류한 대원], stages: { "1-1": 3 }, tower: { floor, turns } | null }
create or replace function public._finger_profile_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'coins', coalesce(p.coins, 0),
    'upgrades', coalesce(p.upgrades, '{}'::jsonb),
    'levels', coalesce((select jsonb_object_agg(h.hero, h.level) from public.finger_heroes h where h.user_id = p_user), '{}'::jsonb),
    'heroes', to_jsonb(public._finger_unlocked(p_user)),
    'stages', coalesce((select jsonb_object_agg(s.stage_id, s.stars) from public.finger_stages s where s.user_id = p_user), '{}'::jsonb),
    'tower', (select jsonb_build_object('floor', t.best_floor, 'turns', t.turns) from public.finger_tower t where t.user_id = p_user)
  )
  from (select 1) one left join public.finger_profiles p on p.user_id = p_user
$$;
revoke all on function public._finger_profile_json(uuid) from public, anon, authenticated;

create or replace function public.finger_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  return public._finger_profile_json(me);
end $$;
revoke all on function public.finger_profile() from public, anon;
grant execute on function public.finger_profile() to authenticated;

-- ---------- 5. 판 시작 · 끝 ----------

create or replace function public.finger_start(p_stage text, p_party text[], p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rid uuid; n int; pr public.finger_profiles; lv jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 끝없는 탑('tower')은 6단계에서 연다
  if p_mode is distinct from 'normal' then raise exception 'bad mode'; end if;
  if p_stage is null or not exists (select 1 from public._finger_stages() t where t.stage_id = p_stage) then raise exception 'bad stage'; end if;
  n := coalesce(array_length(p_party, 1), 0);
  if n < 1 or n > 4 or array_position(p_party, null) is not null
    or (select count(distinct x) from unnest(p_party) x) <> n
    or exists (select 1 from unnest(p_party) x where not exists (select 1 from public._finger_heroes() h where h.id = x))
  then raise exception 'bad party'; end if;
  if not public._finger_stage_open(me, p_stage) then raise exception 'stage locked'; end if;
  if not (p_party <@ public._finger_unlocked(me)) then raise exception 'hero locked'; end if;
  pr := public._finger_profile_row(me);
  select jsonb_object_agg(x, coalesce(h.level, 1)) into lv
  from unnest(p_party) x left join public.finger_heroes h on h.user_id = me and h.hero = x;
  insert into public.finger_runs (user_id, stage_id, mode, party, levels, upgrades)
  values (me, p_stage, p_mode, p_party, coalesce(lv, '{}'::jsonb), coalesce(pr.upgrades, '{}'::jsonb))
  returning id into rid;
  return rid;
end $$;
revoke all on function public.finger_start(text, text[], text) from public, anon;
grant execute on function public.finger_start(text, text[], text) to authenticated;

-- 판 끝: Edge Function finger-finish 가 스냅숏으로 다시 돌린 결과(RunResult)만 받는다 (service_role 만 부를 수 있다)
-- p_result: { cleared, ended, stars, turns, wave, waves, kills, coins(주운 엽전), fallen, steps }
create or replace function public.finger_finish_verified(p_user uuid, p_run uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rn public.finger_runs;
  pr public.finger_profiles;
  st record;
  elapsed numeric;
  v_cleared boolean;
  v_stars int;
  v_turns int;
  v_wave int;
  v_waves int;
  v_kills int;
  v_picked int;
  v_fallen int;
  v_steps int;
  old_stars int;
  first boolean := false;
  best boolean := false;
  raw int := 0;
  coin_lv int;
  n_coins int;
  before_heroes text[];
  after_heroes text[];
  got_coin boolean := false;
begin
  if p_user is null or p_run is null or p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'bad result'; end if;
  select * into rn from public.finger_runs where id = p_run for update;
  if not found or rn.user_id <> p_user then raise exception 'no run'; end if;
  if rn.finished_at is not null then raise exception 'already finished'; end if;
  begin
    v_cleared := (p_result ->> 'cleared')::boolean;
    v_stars := (p_result ->> 'stars')::int;
    v_turns := (p_result ->> 'turns')::int;
    v_wave := (p_result ->> 'wave')::int;
    v_waves := (p_result ->> 'waves')::int;
    v_kills := (p_result ->> 'kills')::int;
    v_picked := (p_result ->> 'coins')::int;
    v_fallen := (p_result ->> 'fallen')::int;
    v_steps := (p_result ->> 'steps')::int;
  exception when others then raise exception 'bad result';
  end;
  if v_cleared is null or v_stars is null or v_turns is null or v_wave is null or v_waves is null
    or v_kills is null or v_picked is null or v_fallen is null or v_steps is null then raise exception 'bad result'; end if;
  if v_turns < 0 or v_turns > public._finger_const('max_turns') or v_waves < 1 or v_wave < 0 or v_wave >= v_waves
    or v_kills < 0 or v_picked < 0 or v_fallen < 0 or v_fallen > 4 or v_steps < 0
    or v_steps > v_turns * public._finger_const('max_shot_steps')
    or v_stars < 0 or v_stars > 3 or (v_cleared and (v_stars < 1 or v_turns < 1)) or (not v_cleared and v_stars <> 0)
  then raise exception 'bad result'; end if;
  elapsed := extract(epoch from (now() - rn.started_at));
  if elapsed + public._finger_const('time_slack') < v_turns * public._finger_const('turn_min_time') + v_steps / public._finger_const('step_rate') then
    raise exception 'too early';
  end if;
  if elapsed > public._finger_const('max_age') then raise exception 'too late'; end if;
  if exists (
    select 1 from public.finger_runs o
    where o.user_id = p_user and o.id <> rn.id and o.finished_at is not null
      and o.finished_at > rn.started_at + interval '2 seconds' and o.started_at < now() - interval '2 seconds'
  ) then raise exception 'overlap'; end if;

  select * into st from public._finger_stages() t where t.stage_id = rn.stage_id;
  if not found then raise exception 'bad stage'; end if;
  pr := public._finger_profile_row(p_user);
  before_heroes := public._finger_unlocked(p_user);
  -- 엽전 강화는 판 시작 때 값 (스냅숏)
  coin_lv := least(5, greatest(0, coalesce((rn.upgrades ->> 'coin')::int, 0)));

  if v_cleared then
    select s.stars into old_stars from public.finger_stages s where s.user_id = p_user and s.stage_id = rn.stage_id;
    first := old_stars is null;
    old_stars := coalesce(old_stars, 0);
    raw := st.clear_coins + st.star_coins * v_stars + (case when first then st.first_coins else 0 end);
    insert into public.finger_stages (user_id, stage_id, stars, best_turns) values (p_user, rn.stage_id, v_stars, v_turns)
    on conflict (user_id, stage_id) do update set stars = greatest(public.finger_stages.stars, excluded.stars),
      best_turns = least(public.finger_stages.best_turns, excluded.best_turns);
    best := v_stars > old_stars;
  else
    raw := floor(st.clear_coins * 3 * least(v_wave, v_waves) / (10.0 * v_waves));
  end if;

  n_coins := floor((raw + least(v_picked, public._finger_const('pick_cap'))) * (100 + 5 * coin_lv) / 100.0);
  update public.finger_profiles set
    coins = coins + n_coins,
    total_stars = coalesce((select sum(s.stars) from public.finger_stages s where s.user_id = p_user), 0),
    cleared_stages = (select count(*) from public.finger_stages s where s.user_id = p_user),
    stars_updated_at = case when best then now() else stars_updated_at end,
    updated_at = now()
  where user_id = p_user;
  update public.finger_runs set finished_at = now(), cleared = v_cleared, stars = v_stars, turns = v_turns, wave = v_wave,
    kills = v_kills, picked = v_picked, fallen = v_fallen, steps = v_steps, coins_earned = n_coins where id = rn.id;
  after_heroes := public._finger_unlocked(p_user);
  -- 시아코인: 서버 경과 20초 넘게 한 판(한 턴 이상)마다 1 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if elapsed >= public._finger_const('coin_min_time') and v_turns >= 1 then
    got_coin := public._grant_sia_coin(p_user, 'finger', p_run::text);
  end if;
  return jsonb_build_object(
    'profile', public._finger_profile_json(p_user),
    'result', jsonb_build_object(
      'coins', n_coins, 'stars', v_stars, 'first', first, 'best', best, 'siaCoin', got_coin,
      'newHeroes', to_jsonb(array(select x from unnest(after_heroes) x where not (x = any(before_heroes))))
    )
  );
end $$;
revoke all on function public.finger_finish_verified(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finger_finish_verified(uuid, uuid, jsonb) to service_role;

-- ---------- 6. 강화 · 대원 레벨 ----------

create or replace function public.finger_buy_upgrade(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.finger_profiles; u record; lv int; price int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into u from public._finger_upgrades() t where t.key = p_key;
  if not found then raise exception 'bad upgrade'; end if;
  pr := public._finger_profile_row(me);
  lv := coalesce((pr.upgrades ->> p_key)::int, 0);
  if lv >= u.max_level then raise exception 'max level'; end if;
  price := u.base_cost + u.step * lv;
  if pr.coins < price then raise exception 'not enough coins'; end if;
  update public.finger_profiles set coins = coins - price, upgrades = upgrades || jsonb_build_object(p_key, lv + 1), updated_at = now()
  where user_id = me;
  return public._finger_profile_json(me);
end $$;
revoke all on function public.finger_buy_upgrade(text) from public, anon;
grant execute on function public.finger_buy_upgrade(text) to authenticated;

create or replace function public.finger_level_up(p_hero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.finger_profiles; lv int; price int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_hero is null or not exists (select 1 from public._finger_heroes() h where h.id = p_hero) then raise exception 'bad hero'; end if;
  if not (p_hero = any(public._finger_unlocked(me))) then raise exception 'hero locked'; end if;
  pr := public._finger_profile_row(me);
  select h.level into lv from public.finger_heroes h where h.user_id = me and h.hero = p_hero for update;
  lv := coalesce(lv, 1);
  select l.cost into price from public._finger_levels() l where l.level = lv;
  if price is null then raise exception 'max level'; end if;
  if pr.coins < price then raise exception 'not enough coins'; end if;
  update public.finger_profiles set coins = coins - price, updated_at = now() where user_id = me;
  insert into public.finger_heroes (user_id, hero, level) values (me, p_hero, lv + 1)
  on conflict (user_id, hero) do update set level = excluded.level, updated_at = now();
  return public._finger_profile_json(me);
end $$;
revoke all on function public.finger_level_up(text) from public, anon;
grant execute on function public.finger_level_up(text) to authenticated;

-- ---------- 게임 오픈 여부 ----------
-- 처음에는 닫힌 상태로 추가한다 (관리자만 보이고 들어갈 수 있다. 로비의 오픈 설정에서 연다)
insert into public.app_settings (key, value) values ('game_open:finger', 'false'::jsonb) on conflict (key) do nothing;
