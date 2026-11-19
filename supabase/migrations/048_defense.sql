-- 048: 시아디펜스 (1인 타워 디펜스)
--   defense_profiles : 사용자별 엽전 · 캐릭터 영구 레벨 · 공통 강화 · 해금 · 누적 별 (본인만 읽기, 쓰기는 함수만)
--   defense_stages   : 사용자·스테이지별 최고 별 (본인만 읽기, 쓰기는 함수만)
--   defense_runs     : 판 한 번 (시작 시각과 결과. 권한 없음: 함수로만 읽고 쓴다)
--   defense_endless  : 끝없는 모드(끝없는 고개)의 사용자별 최고 기록 (누구나 읽기 → defense_endless_ranking 뷰)
--   defense_stage_ranking · defense_endless_ranking : 랭킹 뷰 2개 (PRD 10장)
-- 게임 계산은 기기에서만 돌기 때문에 서버는 보고된 값을 그대로 믿지 않는다:
--   · 판은 defense_start() 로 시작 시각을 남긴 뒤에만 defense_finish() 로 끝낼 수 있다 (주인만, 한 번만)
--   · 서버가 잰 경과 시간이 (보고한 판 시간 ÷ 2배속 − 여유)보다 짧으면 거절, 이미 끝낸 다른 판과 시간이 겹치면 거절
--   · 클리어는 3분(180초)을 채운 판에서만, 별은 남은 생명으로 서버가 다시 계산한 값과 같아야 한다
--   · 엽전은 화면이 보내지 않는다: 서버가 스테이지 표(_defense_stages)와 별·첫 클리어 여부로 계산한다
--   · 명령 기록을 다시 돌려 보는 검증은 하지 않는다 (SQL 로는 할 수 없다). 배치 횟수·명령 수 같은 싼 정합성만 본다
-- 게임 쪽 값(games/defense/src/data/*.ts, src/game/progress.ts)과 같아야 하는 표는
-- games/defense/tests/sql.test.ts 가 이 파일을 읽어 비교한다 (줄 모양을 바꾸면 그 테스트도 함께 고친다).
-- 시간 단위는 모두 초.

-- ---------- 1. 표 ----------

create table if not exists public.defense_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  -- 캐릭터 영구 레벨: { "rat": 3, ... } (없는 캐릭터는 1)
  character_levels jsonb not null default '{}'::jsonb,
  -- 공통 강화: { "energy": 2, ... } (없는 항목은 0)
  upgrades jsonb not null default '{}'::jsonb,
  unlocked_characters text[] not null default array['rat', 'ox', 'tiger', 'rabbit'],
  -- 도감: 만난 요괴와 보스 { "enemies": [...], "bosses": [...] } (캐릭터는 unlocked_characters 가 곧 도감이다)
  codex jsonb not null default '{"enemies":[],"bosses":[]}'::jsonb,
  -- 스테이지 랭킹용 누적 값 (defense_stage_ranking 이 읽는다): 모은 별 · 클리어한 스테이지 수 · 별이 마지막으로 늘어난 시각
  total_stars int not null default 0 check (total_stars >= 0),
  cleared_stages int not null default 0 check (cleared_stages >= 0),
  stars_updated_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.defense_profiles enable row level security;
drop policy if exists defense_profiles_read_own on public.defense_profiles;
create policy defense_profiles_read_own on public.defense_profiles for select using (auth.uid() = user_id);
revoke all on public.defense_profiles from anon, authenticated;
grant select on public.defense_profiles to authenticated;

create table if not exists public.defense_stages (
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage_id text not null,
  stars int not null check (stars between 1 and 3),
  cleared_at timestamptz not null default now(),
  primary key (user_id, stage_id)
);
alter table public.defense_stages enable row level security;
drop policy if exists defense_stages_read_own on public.defense_stages;
create policy defense_stages_read_own on public.defense_stages for select using (auth.uid() = user_id);
revoke all on public.defense_stages from anon, authenticated;
grant select on public.defense_stages to authenticated;

create table if not exists public.defense_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage_id text not null,
  squad text[] not null,
  -- 'normal' 스테이지 / 'endless' 끝없는 모드 (판을 시작할 때 정해진다. 끝낼 때 화면이 보낸 값은 보지 않는다)
  mode text not null default 'normal' check (mode in ('normal', 'endless')),
  -- 시작할 때의 시작 생명 (공통 강화 포함). 별 3개의 기준
  start_lives int not null,
  started_at timestamptz not null default now(),
  -- 끝나기 전에는 비어 있다
  time int,
  cleared boolean,
  lives int,
  stars int,
  kills int,
  coins_earned int,
  valid boolean,
  -- 끝난 시각 (끝나지 않은 판은 null)
  created_at timestamptz
);
alter table public.defense_runs enable row level security;
-- 정책 없음 + 권한 없음: 함수(security definer)로만 읽고 쓴다
revoke all on public.defense_runs from anon, authenticated;
create index if not exists defense_runs_user_idx on public.defense_runs (user_id, started_at desc);

-- 끝없는 모드의 최고 기록: 각자 하나 (도달 웨이브, 그때 데려간 캐릭터, 달성 시각). 누구나 읽기, 쓰기는 defense_finish 만
create table if not exists public.defense_endless (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  best_wave int not null check (best_wave >= 1),
  characters text[] not null,
  achieved_at timestamptz not null default now()
);
alter table public.defense_endless enable row level security;
drop policy if exists defense_endless_read on public.defense_endless;
create policy defense_endless_read on public.defense_endless for select using (true);
revoke all on public.defense_endless from anon, authenticated;
grant select on public.defense_endless to anon, authenticated;
create index if not exists defense_endless_rank_idx on public.defense_endless (best_wave desc, achieved_at);

-- ---------- 2. 기준 값 ----------

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
    when 'open_runs' then 5             -- 끝내지 않은 판은 5개까지 둔다
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

-- 스테이지: 지역 · 번호 · 클리어 보상 · 첫 클리어 보상. games/defense/src/data/stages.ts
create or replace function public._defense_stages() returns table (stage_id text, region int, no int, coins int, first_coins int)
language sql immutable as $$
  values
    ('1-1', 1, 1, 40, 60),
    ('1-2', 1, 2, 45, 65),
    ('1-3', 1, 3, 50, 70),
    ('1-4', 1, 4, 55, 75),
    ('1-5', 1, 5, 70, 120),
    ('2-1', 2, 1, 50, 70),
    ('2-2', 2, 2, 55, 75),
    ('2-3', 2, 3, 60, 80),
    ('2-4', 2, 4, 65, 85),
    ('2-5', 2, 5, 85, 135),
    ('3-1', 3, 1, 60, 80),
    ('3-2', 3, 2, 65, 85),
    ('3-3', 3, 3, 70, 90),
    ('3-4', 3, 4, 75, 95),
    ('3-5', 3, 5, 95, 145),
    ('4-1', 4, 1, 70, 90),
    ('4-2', 4, 2, 75, 95),
    ('4-3', 4, 3, 80, 100),
    ('4-4', 4, 4, 85, 105),
    ('4-5', 4, 5, 105, 155),
    ('5-1', 5, 1, 80, 100),
    ('5-2', 5, 2, 85, 105),
    ('5-3', 5, 3, 90, 110),
    ('5-4', 5, 4, 95, 115),
    ('5-5', 5, 5, 115, 165),
    ('6-1', 6, 1, 90, 110),
    ('6-2', 6, 2, 95, 115),
    ('6-3', 6, 3, 100, 120),
    ('6-4', 6, 4, 105, 125),
    ('6-5', 6, 5, 125, 175),
    ('7-1', 7, 1, 100, 120),
    ('7-2', 7, 2, 105, 125),
    ('7-3', 7, 3, 110, 130),
    ('7-4', 7, 4, 115, 135),
    ('7-5', 7, 5, 135, 185),
    ('8-1', 8, 1, 110, 130),
    ('8-2', 8, 2, 115, 135),
    ('8-3', 8, 3, 120, 140),
    ('8-4', 8, 4, 125, 145),
    ('8-5', 8, 5, 145, 195),
    ('9-1', 9, 1, 120, 140),
    ('9-2', 9, 2, 125, 145),
    ('9-3', 9, 3, 130, 150),
    ('9-4', 9, 4, 135, 155),
    ('9-5', 9, 5, 155, 205),
    ('10-1', 10, 1, 130, 150),
    ('10-2', 10, 2, 135, 155),
    ('10-3', 10, 3, 140, 160),
    ('10-4', 10, 4, 145, 165),
    ('10-5', 10, 5, 165, 215),
    ('11-1', 11, 1, 140, 160),
    ('11-2', 11, 2, 145, 165),
    ('11-3', 11, 3, 150, 170),
    ('11-4', 11, 4, 155, 175),
    ('11-5', 11, 5, 175, 225),
    ('12-1', 12, 1, 150, 170),
    ('12-2', 12, 2, 155, 175),
    ('12-3', 12, 3, 160, 180),
    ('12-4', 12, 4, 165, 185),
    ('12-5', 12, 5, 185, 235)
$$;
revoke all on function public._defense_stages() from public, anon, authenticated;

-- 지역: 여는 데 필요한 별 (+ 앞 지역 보스 클리어) · 이 지역을 클리어하면 해금되는 캐릭터 ('' = 없음).
-- games/defense/src/data/regions.ts · characters.ts 의 ROSTER
create or replace function public._defense_regions() returns table (region int, stars int, unlock_char text)
language sql immutable as $$
  values
    (1, 0, 'dragon'),
    (2, 9, 'snake'),
    (3, 18, 'horse'),
    (4, 27, 'sheep'),
    (5, 36, 'monkey'),
    (6, 45, 'rooster'),
    (7, 54, 'dog'),
    (8, 63, 'pig'),
    (9, 72, ''),
    (10, 81, ''),
    (11, 90, ''),
    (12, 99, '')
$$;
revoke all on function public._defense_regions() from public, anon, authenticated;

-- 캐릭터 레벨업 비용: 레벨 lv → lv + 1. games/defense/src/data/growth.ts 의 LEVEL_COSTS
create or replace function public._defense_level_costs() returns table (lv int, cost int)
language sql immutable as $$
  values
    (1, 110),
    (2, 130),
    (3, 150),
    (4, 175),
    (5, 200),
    (6, 230),
    (7, 260),
    (8, 300),
    (9, 340),
    (10, 390),
    (11, 450)
$$;
revoke all on function public._defense_level_costs() from public, anon, authenticated;

-- 공통 강화: 항목, 최대 레벨, 첫 비용, 레벨마다 더해지는 값. 레벨 n → n+1 의 비용 = base_cost + step × n
-- games/defense/src/data/growth.ts 의 UPGRADES
create or replace function public._defense_upgrades() returns table (key text, max_level int, base_cost int, step int)
language sql immutable as $$
  values
    ('energy', 5, 80, 60),
    ('lives', 5, 60, 50),
    ('gain', 5, 80, 60),
    ('coin', 5, 100, 80),
    ('sell', 3, 80, 80)
$$;
revoke all on function public._defense_upgrades() from public, anon, authenticated;

-- 도감에 들어갈 수 있는 id (요괴·보스). games/defense/src/data/enemies.ts · bosses.ts 와 같은 순서
create or replace function public._defense_codex_ids() returns table (kind text, id text, ord int)
language sql immutable as $$
  values
    ('enemies', 'imp', 1),
    ('enemies', 'wisp', 2),
    ('enemies', 'club', 3),
    ('enemies', 'water', 4),
    ('enemies', 'fox', 5),
    ('enemies', 'bamboo', 6),
    ('enemies', 'guard', 7),
    ('enemies', 'skeleton', 8),
    ('enemies', 'spirit', 9),
    ('bosses', 'bigDokkaebi', 1),
    ('bosses', 'dueoksini', 2),
    ('bosses', 'bulgasal', 3),
    ('bosses', 'jangsanbeom', 4),
    ('bosses', 'centipede', 5),
    ('bosses', 'gumiho', 6),
    ('bosses', 'guardCaptain', 7),
    ('bosses', 'yagwanggwi', 8),
    ('bosses', 'imugi', 9),
    ('bosses', 'reaper', 10),
    ('bosses', 'gangcheori', 11),
    ('bosses', 'yeomra', 12)
$$;
revoke all on function public._defense_codex_ids() from public, anon, authenticated;

-- 도감 합치기: 이미 있는 것 + 이번 판에 만난 것 가운데 허용된 id 만 (너무 긴 목록은 받지 않는다)
create or replace function public._defense_codex_merge(p_old jsonb, p_new jsonb, p_kind text) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(c.id order by c.ord), '[]'::jsonb)
  from public._defense_codex_ids() c
  where c.kind = p_kind and (
    (jsonb_typeof(p_old->p_kind) = 'array' and p_old->p_kind ? c.id)
    or (jsonb_typeof(p_new->p_kind) = 'array' and jsonb_array_length(p_new->p_kind) <= public._defense_const('codex_max') and p_new->p_kind ? c.id))
$$;
revoke all on function public._defense_codex_merge(jsonb, jsonb, text) from public, anon, authenticated;

-- ---------- 3. 프로필 ----------

-- 내 프로필 줄 (없으면 만든다). 잠그고 읽는다
create or replace function public._defense_profile_row(p_user uuid) returns public.defense_profiles
language plpgsql security definer set search_path = public as $$
declare pr public.defense_profiles;
begin
  insert into public.defense_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into pr from public.defense_profiles where user_id = p_user for update;
  return pr;
end $$;
revoke all on function public._defense_profile_row(uuid) from public, anon, authenticated;

-- 화면에 주는 모양: { coins, stages: { "1-1": 3 }, levels, upgrades, unlocked, codex, endless: { wave, squad } | null }
create or replace function public._defense_profile_json(r public.defense_profiles) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'coins', r.coins,
    'stages', coalesce((select jsonb_object_agg(d.stage_id, d.stars) from public.defense_stages d where d.user_id = r.user_id), '{}'::jsonb),
    'levels', r.character_levels,
    'upgrades', r.upgrades,
    'unlocked', to_jsonb(r.unlocked_characters),
    'codex', jsonb_build_object('enemies', public._defense_codex_merge(r.codex, null, 'enemies'), 'bosses', public._defense_codex_merge(r.codex, null, 'bosses')),
    'endless', (select jsonb_build_object('wave', e.best_wave, 'squad', to_jsonb(e.characters)) from public.defense_endless e where e.user_id = r.user_id))
$$;
revoke all on function public._defense_profile_json(public.defense_profiles) from public, anon, authenticated;

create or replace function public.defense_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.defense_profiles;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._defense_profile_row(me);
  -- 관리자 계정(시험용): 들어올 때마다 엽전과 시아코인을 1만으로 맞춘다. 일반 사용자는 영향이 없고, 별·랭킹에도 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    update public.defense_profiles set coins = 10000 where user_id = me returning * into pr;
    perform public.ensure_wallet();
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._defense_profile_json(pr);
end $$;
revoke all on function public.defense_profile() from public, anon;
grant execute on function public.defense_profile() to authenticated;

-- 서버 시각 (ms)
create or replace function public.defense_now() returns double precision
language sql stable as $$ select extract(epoch from clock_timestamp()) * 1000 $$;
revoke all on function public.defense_now() from public, anon;
grant execute on function public.defense_now() to authenticated;

-- 지역이 열렸나: 1지역은 처음부터, 그 뒤는 앞 지역의 보스 스테이지 클리어 + 필요 별
create or replace function public._defense_region_open(p_user uuid, p_region int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_region = 1 or (
    exists (select 1 from public.defense_stages d where d.user_id = p_user and d.stage_id = (p_region - 1) || '-5')
    and coalesce((select sum(d.stars) from public.defense_stages d where d.user_id = p_user), 0)
        >= (select g.stars from public._defense_regions() g where g.region = p_region))
$$;
revoke all on function public._defense_region_open(uuid, int) from public, anon, authenticated;

-- 스테이지가 열렸나: 지역이 열려 있고, 그 지역의 앞 스테이지를 클리어했다
create or replace function public._defense_stage_open(p_user uuid, p_stage text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select public._defense_region_open(p_user, s.region)
      and (s.no = 1 or exists (select 1 from public.defense_stages d where d.user_id = p_user and d.stage_id = s.region || '-' || (s.no - 1)))
    from public._defense_stages() s where s.stage_id = p_stage), false)
$$;
revoke all on function public._defense_stage_open(uuid, text) from public, anon, authenticated;

-- ---------- 4. 판 시작 ----------

-- 잠금·해금을 확인하고 시작 시각을 남긴다 → 판 id
-- p_mode 'endless' 는 끝없는 모드: p_stage 는 'endless', 1지역의 보스 스테이지(1-5)를 클리어했어야 열린다
drop function if exists public.defense_start(text, text[]);
create or replace function public.defense_start(p_stage text, p_squad text[], p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.defense_profiles; rid uuid; n int;
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
  -- (여러 판을 겹쳐 여는 것은 defense_finish 가 막는다.) 너무 오래됐거나 많이 쌓인 것만 치운다.
  delete from public.defense_runs
    where user_id = me and created_at is null and started_at < clock_timestamp() - make_interval(secs => public._defense_const('max_age')::int);
  delete from public.defense_runs where id in (
    select id from public.defense_runs where user_id = me and created_at is null
    order by started_at desc offset (public._defense_const('open_runs')::int - 1));
  -- 끝난 판은 30일 뒤에 지운다
  delete from public.defense_runs where user_id = me and created_at < clock_timestamp() - interval '30 days';
  insert into public.defense_runs (user_id, stage_id, squad, mode, start_lives, started_at)
  values (me, p_stage, p_squad, p_mode,
    public._defense_const('start_lives')::int + least(5, greatest(0, coalesce((pr.upgrades->>'lives')::int, 0))),
    clock_timestamp())
  returning id into rid;
  return rid;
end $$;
revoke all on function public.defense_start(text, text[], text) from public, anon;
grant execute on function public.defense_start(text, text[], text) to authenticated;

-- ---------- 5. 판 끝 ----------

-- 검증한 뒤 별·엽전·첫 클리어 보상·해금·도감을 반영한다 → { profile, result }
-- p_stars 는 화면이 계산한 별: 서버가 남은 생명으로 다시 계산한 값과 다르면 거절한다
-- 끝없는 모드: 클리어가 없다. 도달 웨이브 = 판 시간 ÷ 30 + 1 (서버가 판 시간으로 계산한다. 판 시간은 경과 시간 검사를 받는다:
--   도달 웨이브 ≤ 실제 경과 × 2 ÷ 30 + 여유). 엽전은 넘긴 웨이브 × endless_coin_per_wave (상한 endless_coin_cap)
drop function if exists public.defense_finish(uuid, int, boolean, int, int, int, int, int, int);
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
  if p_time is null or p_cleared is null or p_lives is null or p_stars is null or p_kills is null or p_placed is null or p_cmds is null or p_bonus is null then raise exception 'bad result'; end if;
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
  if p_stars <> n_stars then raise exception 'bad result'; end if;
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

-- ---------- 6. 캐릭터 레벨업 ----------

-- 해금한 캐릭터를 한 레벨 올린다 (최대 12). 엽전이 모자라면 거절. → 새 프로필
create or replace function public.defense_level_up(p_character text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.defense_profiles; cur int; price int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_character is null or p_character not in ('rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig') then raise exception 'bad character'; end if;
  pr := public._defense_profile_row(me);
  if not (p_character = any(pr.unlocked_characters)) then raise exception 'character locked'; end if;
  cur := greatest(1, coalesce((pr.character_levels->>p_character)::int, 1));
  if cur >= public._defense_const('char_max_level') then raise exception 'max level'; end if;
  select x.cost into price from public._defense_level_costs() x where x.lv = cur;
  if price is null then raise exception 'max level'; end if;
  if pr.coins < price then raise exception 'not enough coins'; end if;
  update public.defense_profiles
    set coins = coins - price, character_levels = character_levels || jsonb_build_object(p_character, cur + 1), updated_at = now()
    where user_id = me returning * into pr;
  return public._defense_profile_json(pr);
end $$;
revoke all on function public.defense_level_up(text) from public, anon;
grant execute on function public.defense_level_up(text) to authenticated;

-- ---------- 7. 공통 강화 ----------

-- 한 단계 올린다. 최대 레벨이거나 엽전이 모자라면 거절. → 새 프로필
create or replace function public.defense_buy_upgrade(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.defense_profiles; u record; lv int; price int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into u from public._defense_upgrades() x where x.key = p_key;
  if not found then raise exception 'bad upgrade'; end if;
  pr := public._defense_profile_row(me);
  lv := greatest(0, coalesce((pr.upgrades->>p_key)::int, 0));
  if lv >= u.max_level then raise exception 'max level'; end if;
  price := u.base_cost + u.step * lv;
  if pr.coins < price then raise exception 'not enough coins'; end if;
  update public.defense_profiles
    set coins = coins - price, upgrades = upgrades || jsonb_build_object(p_key, lv + 1), updated_at = now()
    where user_id = me returning * into pr;
  return public._defense_profile_json(pr);
end $$;
revoke all on function public.defense_buy_upgrade(text) from public, anon;
grant execute on function public.defense_buy_upgrade(text) to authenticated;

-- ---------- 8. 랭킹 (PRD 10장) ----------

-- 스테이지 랭킹: 모은 별 → 클리어한 스테이지 수 → 먼저 달성한 순. 누적 운영(초기화 없음).
-- best_stage: 가장 멀리 클리어한 스테이지 (예: '7-3'). place·total 은 순위와 인원 (상위 100명은 place <= 100, 내 순위는 user_id 로 조회)
-- 비정상 판은 defense_stages 에 들어가지 않으므로 여기에도 없다
create or replace view public.defense_stage_ranking as
  select r.user_id, p.nickname, r.total_stars, r.cleared_stages,
    (select d.stage_id from public.defense_stages d where d.user_id = r.user_id
      order by split_part(d.stage_id, '-', 1)::int desc, split_part(d.stage_id, '-', 2)::int desc limit 1) as best_stage,
    r.stars_updated_at as achieved_at,
    (row_number() over (order by r.total_stars desc, r.cleared_stages desc, r.stars_updated_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.defense_profiles r join public.profiles p on p.id = r.user_id
  where r.total_stars > 0;
revoke all on public.defense_stage_ranking from anon, authenticated;
grant select on public.defense_stage_ranking to anon, authenticated;

-- 끝없는 모드 랭킹: 도달 웨이브 → 먼저 달성한 순. 각자 최고 기록 하나
create or replace view public.defense_endless_ranking as
  select r.user_id, p.nickname, r.best_wave, r.characters, r.achieved_at,
    (row_number() over (order by r.best_wave desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.defense_endless r join public.profiles p on p.id = r.user_id;
revoke all on public.defense_endless_ranking from anon, authenticated;
grant select on public.defense_endless_ranking to anon, authenticated;

-- ---------- 게임 오픈 여부 ----------
-- 처음에는 닫힌 상태로 추가한다 (관리자만 보이고 들어갈 수 있다. 로비의 오픈 설정에서 연다)
insert into public.app_settings (key, value) values ('game_open:defense', 'false'::jsonb) on conflict (key) do nothing;
