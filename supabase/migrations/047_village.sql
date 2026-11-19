-- 047: 시아마을 (시간이 지나면 자원이 쌓이는 마을 키우기) — PRD 16장의 1~3단계
--   village_profiles  : 사용자별 마을 (레벨 · 경험치 · 자원 · 땅 단계 · 마을 목표 진행). 본인만 읽기, 쓰기는 함수만
--   village_buildings : 건물 (종류 · 레벨 · 자리 · 짓는 중/업그레이드 중/완료 · 끝나는 시각 · 마지막 수확 시각). 본인만 읽기, 쓰기는 함수만
-- 서버가 진실이다: 자원이 바뀌는 모든 동작(짓기 · 옮기기 · 수확 · 업그레이드 · 목표 보상)은 이 파일의 함수가 서버 시간으로 계산한다.
--   · 모든 함수는 먼저 내 마을 줄(village_profiles)을 잠근다 → 같은 사람의 요청은 한 번에 하나씩
--     (같은 수확 두 번 · 건설 슬롯 초과 · 자원 음수 · 겹치는 칸이 생기지 않는다)
--   · 시각은 잠근 뒤의 clock_timestamp() 를 쓴다 (기다린 요청이 앞 요청보다 이른 시각으로 계산하지 않게)
--   · 끝난 짓기 · 업그레이드는 모든 요청의 처음에 마무리한다 (_village_settle): 경험치를 주고, 그 건물의 생산은 끝난 시각부터 쌓인다
--   · 생산: 쌓인 양 = floor(지난 초 × 시간당 생산량 ÷ 3600), 건물마다 최대 12시간 분량
-- 게임 쪽 값(games/village/src/data/*.ts)과 같아야 하는 표는 games/village/tests/sql.test.ts 가 이 파일을 읽어 비교한다
-- (줄 모양을 바꾸면 그 테스트도 함께 고친다). 같은 식의 화면용 계산은 games/village/src/game/rules.ts.
-- 장터 · 주민 · 부탁 · 기념물 · 칭찬 · 시아코인 차감은 다음 단계의 마이그레이션에서 더한다.

-- ---------- 1. 표 ----------

create table if not exists public.village_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  village_name text not null default '' check (char_length(village_name) <= 12),
  level int not null default 1 check (level between 1 and 30),
  -- 지금 레벨에서 모은 경험치 (레벨이 오르면 0부터 다시)
  exp int not null default 0 check (exp >= 0),
  resources jsonb not null default '{"rice":50,"wood":50,"stone":0,"cake":0,"coin":0}'::jsonb,
  -- 땅 확장 단계 (0 = 8×8 … 6 = 20×20)
  land_stage int not null default 0 check (land_stage between 0 and 6),
  prosperity int not null default 0 check (prosperity >= 0),
  praise_count int not null default 0 check (praise_count >= 0),
  -- 마을 목표: 지금 목표의 번호(_village_goals 의 idx)와, 그 목표가 시작된 뒤의 수확 횟수
  goal int not null default 0 check (goal >= 0),
  goal_progress int not null default 0 check (goal_progress >= 0),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint village_profiles_resources_ok check (
    (resources->>'rice')::bigint >= 0 and (resources->>'wood')::bigint >= 0 and (resources->>'stone')::bigint >= 0
    and (resources->>'cake')::bigint >= 0 and (resources->>'coin')::bigint >= 0)
);
alter table public.village_profiles enable row level security;
drop policy if exists village_profiles_read_own on public.village_profiles;
create policy village_profiles_read_own on public.village_profiles for select using (auth.uid() = user_id);
revoke all on public.village_profiles from anon, authenticated;
grant select on public.village_profiles to authenticated;

create table if not exists public.village_buildings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.village_profiles(user_id) on delete cascade,
  type text not null,
  level int not null default 1 check (level between 1 and 10),
  -- 왼쪽 위 칸. 좌표는 가장 큰 땅(20×20) 기준 (땅을 넓혀도 바뀌지 않는다)
  x int not null check (x between 0 and 19),
  y int not null check (y between 0 and 19),
  state text not null default 'building' check (state in ('building', 'upgrading', 'done')),
  -- 짓기 · 업그레이드의 시작과 끝 (done 이면 null)
  started_at timestamptz,
  finish_at timestamptz,
  last_collected_at timestamptz not null default now(),
  assigned_resident text,
  created_at timestamptz not null default now(),
  unique (user_id, x, y)
);
alter table public.village_buildings enable row level security;
drop policy if exists village_buildings_read_own on public.village_buildings;
create policy village_buildings_read_own on public.village_buildings for select using (auth.uid() = user_id);
revoke all on public.village_buildings from anon, authenticated;
grant select on public.village_buildings to authenticated;
create index if not exists village_buildings_user_idx on public.village_buildings (user_id);

-- ---------- 2. 수치 (games/village/src/data) ----------

-- 기준 값. games/village/src/data/balance.ts 의 CONST
create or replace function public._village_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_level' then 30            -- 마을 레벨 상한
    when 'building_max_level' then 10   -- 건물 레벨 상한
    when 'prod_cap_sec' then 43200      -- 생산 건물이 쌓아 두는 최대 시간 (초): 12시간
    when 'base_slots' then 2            -- 동시에 짓는(업그레이드 포함) 수
    when 'slots3_hall' then 5           -- 마을 회관이 이 레벨이 되면 동시에 3개
    when 'harvest_exp_div' then 20      -- 수확 경험치 = 건물에 쌓여 있던 양 ÷ 이 값 (버림)
    when 'harvest_max' then 64          -- 한 번에 수확을 요청할 수 있는 건물 수
    when 'hall_sec_mul' then 2          -- 마을 회관의 업그레이드 시간 배수
    when 'hall_exp_mul' then 3          -- 마을 회관의 업그레이드 경험치 배수
  end
$$;
revoke all on function public._village_const(text) from public, anon, authenticated;

-- 레벨별 표 (1부터 센다). games/village/src/data/balance.ts 의 같은 이름(대문자) 배열
create or replace function public._village_table(p_name text) returns int[]
language sql immutable as $$
  select case p_name
    when 'land_sizes' then array[8, 10, 12, 14, 16, 18, 20]
    when 'level_exp' then array[80, 160, 300, 500, 760, 1000, 1300, 1650, 2050, 2500, 3050, 4000, 4950, 5930, 7020, 8230, 9560, 11020, 12610, 14340, 16200, 18220, 20380, 22690, 25170, 27800, 30590, 33560, 36700]
    when 'cost_mul' then array[20, 40, 70, 110, 170, 250, 360, 500, 700]
    when 'upgrade_sec' then array[30, 120, 600, 1800, 3600, 7200, 14400, 21600, 28800]
    when 'upgrade_exp' then array[20, 40, 80, 140, 220, 320, 450, 600, 800]
    when 'rate_mul' then array[10, 13, 16, 20, 24, 29, 34, 40, 47, 55]
    when 'hall_cap' then array[300, 450, 650, 900, 1200, 1600, 2100, 2700, 3400, 4200]
    when 'storage_cap' then array[150, 250, 400, 600, 850, 1150, 1500, 1900, 2400, 3000]
    when 'hall_need' then array[2, 4, 6, 9, 12, 15, 19, 23, 27]
  end
$$;
revoke all on function public._village_table(text) from public, anon, authenticated;

-- 건물: 종류, 칸(가로·세로), 짓는 값(쌀·나무), 짓는 시간(초), 만드는 자원('' = 없음), 레벨 1의 시간당 생산량, 다 지었을 때의 경험치,
-- n번째 건물이 열리는 마을 레벨. games/village/src/data/buildings.ts
create or replace function public._village_types() returns table (type text, w int, h int, rice int, wood int, build_sec int, product text, rate int, build_exp int, unlock int[])
language sql immutable as $$
  values
    ('hall', 2, 2, 40, 40, 0, '', 0, 0, array[1]),
    ('paddy', 1, 1, 5, 10, 10, 'rice', 60, 10, array[1, 1, 3, 5, 7, 10, 13, 17]),
    ('house', 1, 1, 10, 20, 30, '', 0, 15, array[1, 2, 3, 5, 7, 9, 11, 13, 15, 18, 21, 24]),
    ('lumber', 1, 1, 30, 10, 20, 'wood', 40, 12, array[2, 2, 4, 6, 8, 11, 14, 18]),
    ('storage', 1, 1, 30, 40, 60, '', 0, 20, array[2, 4, 7, 10, 14, 18])
$$;
revoke all on function public._village_types() from public, anon, authenticated;

-- 마을 목표: 번호, 종류(build 그 건물 n채 · upgrade 그 건물 레벨 n · harvest 수확 n번 · level 마을 레벨 n), 건물, n, 보상(쌀 · 나무 · 경험치)
-- games/village/src/data/goals.ts
create or replace function public._village_goals() returns table (idx int, kind text, type text, n int, rice int, wood int, exp int)
language sql immutable as $$
  values
    (0, 'build', 'paddy', 1, 0, 20, 10),
    (1, 'build', 'house', 1, 20, 0, 10),
    (2, 'harvest', '', 1, 0, 20, 10),
    (3, 'build', 'paddy', 2, 20, 0, 15),
    (4, 'level', '', 2, 30, 30, 0),
    (5, 'build', 'lumber', 1, 30, 0, 20),
    (6, 'build', 'storage', 1, 0, 30, 20),
    (7, 'upgrade', 'hall', 2, 40, 40, 25),
    (8, 'upgrade', 'paddy', 2, 30, 0, 25),
    (9, 'harvest', '', 5, 0, 40, 30),
    (10, 'level', '', 3, 50, 50, 0),
    (11, 'build', 'paddy', 3, 40, 20, 30),
    (12, 'build', 'house', 3, 30, 30, 30),
    (13, 'upgrade', 'lumber', 2, 40, 40, 35),
    (14, 'level', '', 4, 60, 60, 0),
    (15, 'build', 'lumber', 3, 60, 30, 40),
    (16, 'upgrade', 'hall', 3, 80, 80, 50),
    (17, 'upgrade', 'storage', 2, 60, 60, 40),
    (18, 'level', '', 5, 80, 80, 0),
    (19, 'build', 'paddy', 4, 60, 60, 50),
    (20, 'upgrade', 'paddy', 3, 80, 40, 60),
    (21, 'harvest', '', 20, 60, 60, 70),
    (22, 'level', '', 6, 100, 100, 0),
    (23, 'upgrade', 'hall', 4, 150, 150, 90),
    (24, 'upgrade', 'lumber', 3, 100, 100, 80),
    (25, 'level', '', 7, 120, 120, 0),
    (26, 'build', 'paddy', 5, 120, 120, 100),
    (27, 'build', 'storage', 3, 150, 150, 110),
    (28, 'upgrade', 'paddy', 4, 150, 150, 120),
    (29, 'level', '', 8, 150, 150, 0)
$$;
revoke all on function public._village_goals() from public, anon, authenticated;

-- ---------- 3. 안에서만 쓰는 도구 ----------

create or replace function public._village_ms(p_at timestamptz) returns double precision
language sql immutable as $$
  select floor(extract(epoch from p_at) * 1000)::double precision
$$;
revoke all on function public._village_ms(timestamptz) from public, anon, authenticated;

-- 내 마을 줄을 (없으면 만들어서: 자원 조금 + 한가운데에 마을 회관) 잠근 채 돌려준다
create or replace function public._village_profile_row(p_user uuid) returns public.village_profiles
language plpgsql security definer set search_path = public as $$
declare r public.village_profiles; n int;
begin
  insert into public.village_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  select * into r from public.village_profiles where user_id = p_user for update;
  if n = 1 then
    insert into public.village_buildings (user_id, type, x, y, state) values (p_user, 'hall', 9, 9, 'done');
  end if;
  return r;
end $$;
revoke all on function public._village_profile_row(uuid) from public, anon, authenticated;

-- 경험치를 더하고 레벨을 올린다 (레벨 n → n+1 에 level_exp[n])
create or replace function public._village_add_exp(p_user uuid, p_exp bigint) returns void
language plpgsql security definer set search_path = public as $$
declare lv int; ex bigint; need int[] := public._village_table('level_exp'); mx int := public._village_const('max_level');
begin
  if p_exp is null or p_exp <= 0 then return; end if;
  select level, exp into lv, ex from public.village_profiles where user_id = p_user;
  ex := ex + p_exp;
  while lv < mx and ex >= need[lv] loop
    ex := ex - need[lv];
    lv := lv + 1;
  end loop;
  if lv >= mx then ex := 0; end if;
  update public.village_profiles set level = lv, exp = ex, updated_at = now() where user_id = p_user;
end $$;
revoke all on function public._village_add_exp(uuid, bigint) from public, anon, authenticated;

-- 끝난 짓기 · 업그레이드를 마무리한다: 경험치를 주고, 생산은 끝난 시각부터 쌓인다
create or replace function public._village_settle(p_user uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; e bigint;
begin
  for b in select * from public.village_buildings where user_id = p_user and state <> 'done' and finish_at <= p_now order by finish_at, created_at, id loop
    if b.state = 'building' then
      select t.build_exp into e from public._village_types() t where t.type = b.type;
    else
      e := (public._village_table('upgrade_exp'))[b.level] * case when b.type = 'hall' then public._village_const('hall_exp_mul')::int else 1 end;
    end if;
    update public.village_buildings set
      level = level + case when b.state = 'upgrading' then 1 else 0 end,
      state = 'done', last_collected_at = b.finish_at, finish_at = null, started_at = null
    where id = b.id;
    perform public._village_add_exp(p_user, e);
  end loop;
end $$;
revoke all on function public._village_settle(uuid, timestamptz) from public, anon, authenticated;

create or replace function public._village_hall_level(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select level from public.village_buildings where user_id = p_user and type = 'hall' limit 1), 1)
$$;
revoke all on function public._village_hall_level(uuid) from public, anon, authenticated;

-- 창고 용량: 마을 회관 + 다 지은 창고들
create or replace function public._village_cap(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select (public._village_table('hall_cap'))[public._village_hall_level(p_user)]::bigint
    + coalesce((select sum((public._village_table('storage_cap'))[b.level]) from public.village_buildings b
                where b.user_id = p_user and b.type = 'storage' and b.state <> 'building'), 0)::bigint
$$;
revoke all on function public._village_cap(uuid) from public, anon, authenticated;

-- 건설 슬롯이 남았나 (짓는 중 + 업그레이드 중 < 슬롯 수)
create or replace function public._village_slot_free(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.village_buildings where user_id = p_user and state <> 'done')
    < public._village_const('base_slots')::int
      + case when public._village_hall_level(p_user) >= public._village_const('slots3_hall') then 1 else 0 end
$$;
revoke all on function public._village_slot_free(uuid) from public, anon, authenticated;

-- 그 자리에 놓을 수 있나 → 안 되면 까닭 ('out of land' 땅 밖 · 'occupied' 다른 건물과 겹침), 되면 null
create or replace function public._village_place_error(p_user uuid, p_type text, p_x int, p_y int, p_ignore uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare ty record; size int; x0 int;
begin
  select * into ty from public._village_types() t where t.type = p_type;
  select (public._village_table('land_sizes'))[land_stage + 1] into size from public.village_profiles where user_id = p_user;
  x0 := (20 - size) / 2;
  if p_x is null or p_y is null or p_x < x0 or p_y < x0 or p_x + ty.w > x0 + size or p_y + ty.h > x0 + size then return 'out of land'; end if;
  if exists (
    select 1 from public.village_buildings b join public._village_types() o on o.type = b.type
    where b.user_id = p_user and (p_ignore is null or b.id <> p_ignore)
      and b.x < p_x + ty.w and b.x + o.w > p_x and b.y < p_y + ty.h and b.y + o.h > p_y
  ) then return 'occupied'; end if;
  return null;
end $$;
revoke all on function public._village_place_error(uuid, text, int, int, uuid) from public, anon, authenticated;

-- 쌀 · 나무를 낸다 (모자라면 'not enough')
create or replace function public._village_pay(p_user uuid, p_rice bigint, p_wood bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  select resources into r from public.village_profiles where user_id = p_user;
  if (r->>'rice')::bigint < p_rice or (r->>'wood')::bigint < p_wood then raise exception 'not enough'; end if;
  update public.village_profiles set
    resources = r || jsonb_build_object('rice', (r->>'rice')::bigint - p_rice, 'wood', (r->>'wood')::bigint - p_wood), updated_at = now()
  where user_id = p_user;
end $$;
revoke all on function public._village_pay(uuid, bigint, bigint) from public, anon, authenticated;

-- 건물 하나를 거둔다: 건물은 비워진다. 창고에 들어가는 만큼만 담고 넘친 것은 버린다
-- (경험치는 쌓여 있던 양으로 준다 — 창고가 가득 차도 수확 경험치가 끊기지 않아야 마을이 멈추지 않는다)
--   got 창고에 들어간 양 · have 쌓여 있던 양 · product 자원
create or replace function public._village_collect(p_user uuid, p_id uuid, p_now timestamptz, p_cap bigint, out got bigint, out have bigint, out product text)
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; ty record; rate bigint; frm timestamptz; cur bigint;
begin
  got := 0; have := 0; product := '';
  select * into b from public.village_buildings where id = p_id and user_id = p_user for update;
  if not found or b.state <> 'done' then return; end if;
  select * into ty from public._village_types() t where t.type = b.type;
  if ty.product = '' then return; end if;
  product := ty.product;
  rate := ty.rate * (public._village_table('rate_mul'))[b.level] / 10;
  frm := greatest(b.last_collected_at, p_now - make_interval(secs => public._village_const('prod_cap_sec')::double precision));
  have := greatest(0, floor(extract(epoch from (p_now - frm)))::bigint) * rate / 3600;
  select (resources->>ty.product)::bigint into cur from public.village_profiles where user_id = p_user;
  if have <= 0 then return; end if;
  got := greatest(0, least(have, p_cap - cur));
  update public.village_profiles set resources = jsonb_set(resources, array[ty.product], to_jsonb(cur + got)), updated_at = now() where user_id = p_user;
  -- 거둔 만큼의 시간만 쓴다 (1개가 되다 만 시간은 남는다)
  update public.village_buildings set last_collected_at = least(p_now, frm + make_interval(secs => ((have * 3600 + rate - 1) / rate)::double precision)) where id = p_id;
end $$;
revoke all on function public._village_collect(uuid, uuid, timestamptz, bigint) from public, anon, authenticated;

-- 지금 목표를 얼마나 했나 (목표가 없으면 null)
create or replace function public._village_goal_have(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare p public.village_profiles; g record;
begin
  select * into p from public.village_profiles where user_id = p_user;
  select * into g from public._village_goals() t where t.idx = p.goal;
  if not found then return null; end if;
  return case g.kind
    when 'build' then (select count(*) from public.village_buildings b where b.user_id = p_user and b.type = g.type and b.state <> 'building')::int
    when 'upgrade' then coalesce((select max(b.level) from public.village_buildings b where b.user_id = p_user and b.type = g.type and b.state <> 'building'), 0)
    when 'harvest' then p.goal_progress
    else p.level
  end;
end $$;
revoke all on function public._village_goal_have(uuid) from public, anon, authenticated;

-- 화면에 보내는 마을 모양 (시각은 ms). now = 서버 시각: 화면은 이것으로 기기 시계와의 차이를 맞춘다
create or replace function public._village_state_json(p_user uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', public._village_ms(p_now),
    'profile', jsonb_build_object(
      'name', p.village_name, 'level', p.level, 'exp', p.exp, 'resources', p.resources, 'landStage', p.land_stage,
      'prosperity', p.prosperity, 'goal', p.goal, 'goalProgress', p.goal_progress),
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'level', b.level, 'x', b.x, 'y', b.y, 'state', b.state,
        'finishAt', public._village_ms(b.finish_at), 'startAt', public._village_ms(b.started_at),
        'collectedAt', public._village_ms(b.last_collected_at), 'resident', b.assigned_resident) order by b.created_at, b.id)
      from public.village_buildings b where b.user_id = p_user), '[]'::jsonb))
  from public.village_profiles p where p.user_id = p_user
$$;
revoke all on function public._village_state_json(uuid, timestamptz) from public, anon, authenticated;

-- ---------- 4. 화면이 부르는 함수 (모두 새 마을 상태를 돌려준다) ----------

-- 내 마을 (없으면 만든다). 끝난 짓기 · 업그레이드를 마무리하고 돌려준다
create or replace function public.village_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  update public.village_profiles set last_seen_at = t where user_id = me;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_state() from public, anon;
grant execute on function public.village_state() to authenticated;

-- 짓기: 해금 · 개수 제한 · 건설 슬롯 · 자리 · 자원을 확인하고 짓기 시작한다
create or replace function public.village_build(p_type text, p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; ty record; lv int; cnt int; why text; new_id uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into ty from public._village_types() x where x.type = p_type;
  if not found then raise exception 'bad type'; end if;
  select level into lv from public.village_profiles where user_id = me;
  select count(*) into cnt from public.village_buildings where user_id = me and type = p_type;
  -- 아직 하나도 못 짓는 건물은 'locked', 지금 레벨의 개수를 다 지었으면 'limit'
  if cnt >= (select count(*) from unnest(ty.unlock) u where u <= lv) then
    raise exception '%', case when cnt = 0 then 'locked' else 'limit' end;
  end if;
  if not public._village_slot_free(me) then raise exception 'no slot'; end if;
  why := public._village_place_error(me, p_type, p_x, p_y, null);
  if why is not null then raise exception '%', why; end if;
  perform public._village_pay(me, ty.rice, ty.wood);
  insert into public.village_buildings (user_id, type, x, y, state, started_at, finish_at, last_collected_at)
  values (me, p_type, p_x, p_y, 'building', t, t + make_interval(secs => ty.build_sec), t)
  returning id into new_id;
  -- 0초짜리 건물은 바로 끝난다
  perform public._village_settle(me, t);
  return public._village_state_json(me, t) || jsonb_build_object('id', new_id);
end $$;
revoke all on function public.village_build(text, int, int) from public, anon;
grant execute on function public.village_build(text, int, int) to authenticated;

-- 옮기기 (비용 없음. 짓는 중이어도 된다)
create or replace function public.village_move(p_id uuid, p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; why text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  why := public._village_place_error(me, b.type, p_x, p_y, b.id);
  if why is not null then raise exception '%', why; end if;
  update public.village_buildings set x = p_x, y = p_y where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_move(uuid, int, int) from public, anon;
grant execute on function public.village_move(uuid, int, int) to authenticated;

-- 수확: 건물 여러 채를 한꺼번에 (끌어서 수확). 창고 용량까지만 들어가고 넘친 것은 버린다
--   답의 harvest = { per: { 건물 id: 창고에 들어간 양 }, gained: { 자원: 양 }, exp, lost: 창고가 가득 차서 버린 양 }
create or replace function public.village_harvest(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; cap bigint; bid uuid; c record;
  per jsonb := '{}'::jsonb; gained jsonb := '{}'::jsonb; total bigint := 0; cnt int := 0; lost bigint := 0; e bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > public._village_const('harvest_max') then raise exception 'bad request'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  cap := public._village_cap(me);
  -- 보낸 순서대로 (같은 건물이 여러 번 있어도 한 번만)
  for bid in select u from unnest(p_ids) with ordinality as x(u, n) where u is not null group by u order by min(n) loop
    select * into c from public._village_collect(me, bid, t, cap);
    continue when c.have <= 0;
    per := per || jsonb_build_object(bid::text, c.got);
    if c.got > 0 then gained := gained || jsonb_build_object(c.product, coalesce((gained->>c.product)::bigint, 0) + c.got); end if;
    lost := lost + c.have - c.got;
    total := total + c.have;
    cnt := cnt + 1;
  end loop;
  e := total / public._village_const('harvest_exp_div')::int;
  update public.village_profiles p set goal_progress = goal_progress + cnt
  where p.user_id = me and exists (select 1 from public._village_goals() g where g.idx = p.goal and g.kind = 'harvest');
  perform public._village_add_exp(me, e);
  return public._village_state_json(me, t) || jsonb_build_object('harvest', jsonb_build_object('per', per, 'gained', gained, 'exp', e, 'lost', lost));
end $$;
revoke all on function public.village_harvest(uuid[]) from public, anon;
grant execute on function public.village_harvest(uuid[]) to authenticated;

-- 업그레이드: 최대 10레벨. 마을 회관은 마을 레벨(hall_need)이, 다른 건물은 마을 회관 레벨이 상한이다
--   쌓여 있던 생산은 먼저 거둔다 (창고에 들어가는 만큼, 넘친 것은 버린다)
create or replace function public.village_upgrade(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; ty record; lv int; m int; sec int; r jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  if b.state <> 'done' then raise exception 'busy'; end if;
  if b.level >= public._village_const('building_max_level') then raise exception 'max level'; end if;
  if b.type = 'hall' then
    select level into lv from public.village_profiles where user_id = me;
    if lv < (public._village_table('hall_need'))[b.level] then raise exception 'village level'; end if;
  elsif b.level >= public._village_hall_level(me) then
    raise exception 'hall level';
  end if;
  if not public._village_slot_free(me) then raise exception 'no slot'; end if;
  select * into ty from public._village_types() x where x.type = b.type;
  m := (public._village_table('cost_mul'))[b.level];
  select resources into r from public.village_profiles where user_id = me;
  if (r->>'rice')::bigint < ty.rice * m / 10 or (r->>'wood')::bigint < ty.wood * m / 10 then raise exception 'not enough'; end if;
  perform public._village_collect(me, b.id, t, public._village_cap(me));
  perform public._village_pay(me, ty.rice * m / 10, ty.wood * m / 10);
  sec := (public._village_table('upgrade_sec'))[b.level] * case when b.type = 'hall' then public._village_const('hall_sec_mul')::int else 1 end;
  update public.village_buildings set state = 'upgrading', started_at = t, finish_at = t + make_interval(secs => sec) where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_upgrade(uuid) from public, anon;
grant execute on function public.village_upgrade(uuid) to authenticated;

-- 마을 목표 보상 받기: 지금 목표를 다 했으면 보상을 주고 다음 목표로 (보상은 창고 용량을 넘겨도 받는다)
create or replace function public.village_claim_goal() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; p public.village_profiles; g record; have int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into p from public.village_profiles where user_id = me;
  select * into g from public._village_goals() x where x.idx = p.goal;
  if not found then raise exception 'no goal'; end if;
  have := public._village_goal_have(me);
  if have < g.n then raise exception 'not done'; end if;
  update public.village_profiles set
    resources = p.resources || jsonb_build_object('rice', (p.resources->>'rice')::bigint + g.rice, 'wood', (p.resources->>'wood')::bigint + g.wood),
    goal = p.goal + 1, goal_progress = 0, updated_at = now()
  where user_id = me;
  perform public._village_add_exp(me, g.exp);
  return public._village_state_json(me, t) || jsonb_build_object('claimed', p.goal);
end $$;
revoke all on function public.village_claim_goal() from public, anon;
grant execute on function public.village_claim_goal() to authenticated;

-- ---------- 5. 게임 오픈 여부 (닫힌 상태로 시작: 관리자가 로비에서 연다) ----------

insert into public.app_settings (key, value) values ('game_open:village', 'false'::jsonb) on conflict (key) do nothing;
