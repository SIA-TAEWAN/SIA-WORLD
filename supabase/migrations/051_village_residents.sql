-- 051: 시아마을 6단계 — 주민(십이지 12명) · 배치 보너스 · 친밀도와 선물 · 주민 부탁 · 오늘의 할 일
--   village_residents : 이사 온 주민 (친밀도 · 배치한 건물 · 선물을 받았나). 본인만 읽기, 쓰기는 함수만
--   village_requests  : 주민 부탁 칸 셋(kind 'resident') + 오늘의 할 일 셋(kind 'daily'). 본인만 읽기, 쓰기는 함수만
--   (마을 목표의 진행은 047 의 village_profiles.goal · goal_progress 그대로다)
-- 서버가 모든 요청의 처음에 하는 일(_village_settle)에 세 가지가 더해졌다:
--   · 마을 레벨이 되고 빈 주민 집이 있으면 주민이 십이지 순서대로 한 명씩 이사 온다
--   · 기다림이 끝난 부탁 칸에 새 부탁을 넣는다 — 부탁은 서버가 만든다 (번호 · 마을 레벨 · 이사 온 주민으로 정해지는 식)
--   · 서버 날짜(한국 시간)가 바뀌었으면 오늘의 할 일 셋을 새로 정한다
-- 주민의 보너스 (친밀도 1 … 5단계에 10 · 15 · 20 · 25 · 30 %, 용은 5 · 8 · 11 · 14 · 17 %):
--   쥐 창고 용량 · 소 논 · 호랑이 벌목장 · 원숭이 채석장 생산량 · 토끼 방앗간 · 뱀 장독대 가공 속도 · 용 짓는 시간 · 말 장터 한도 · 돼지 파는 값
--   양 정자의 둘레 +1칸 · 닭 날마다 첫 수확 · 개 12 → 15시간 (닭 · 개는 배치하지 않는다)
--   생산량이 바뀌는 배치 · 친밀도 단계 변화 앞에서는 그때까지 쌓인 양을 건물에 적어 둔다 (050 의 banked)
-- 마을 목표에 주민 · 부탁 · 배치가 들어가 목록이 바뀌었다 (게임이 아직 열리지 않아 번호를 새로 매겼다).
-- 마을 레벨 표(level_exp)도 4 ~ 6단계 내용에 맞춰 다시 정했다.

-- ---------- 1. 표 ----------

create table if not exists public.village_residents (
  user_id uuid not null references public.village_profiles(user_id) on delete cascade,
  resident text not null,
  affinity int not null default 0 check (affinity >= 0),
  -- 배치한 건물 (보관함에 넣으면 비운다)
  building_id uuid references public.village_buildings(id) on delete set null,
  gifted boolean not null default false,
  moved_in_at timestamptz not null default now(),
  primary key (user_id, resident)
);
alter table public.village_residents enable row level security;
drop policy if exists village_residents_read_own on public.village_residents;
create policy village_residents_read_own on public.village_residents for select using (auth.uid() = user_id);
revoke all on public.village_residents from anon, authenticated;
grant select on public.village_residents to authenticated;

create table if not exists public.village_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.village_profiles(user_id) on delete cascade,
  kind text not null check (kind in ('resident', 'daily')),
  slot int not null check (slot between 0 and 2),
  -- resident: open 부탁이 있다 · wait ready_at 에 새 부탁이 온다 / daily: open 하는 중 · claimed 보상을 받았다
  state text not null check (state in ('open', 'wait', 'claimed')),
  -- resident: { resident, res, n, coin, exp, aff } / daily: { task, n, coin, exp }
  content jsonb not null default '{}'::jsonb,
  progress int not null default 0 check (progress >= 0),
  ready_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, kind, slot)
);
alter table public.village_requests enable row level security;
drop policy if exists village_requests_read_own on public.village_requests;
create policy village_requests_read_own on public.village_requests for select using (auth.uid() = user_id);
revoke all on public.village_requests from anon, authenticated;
grant select on public.village_requests to authenticated;

-- 지금까지 만든 부탁의 수 · 오늘의 할 일을 정한 날 · 다 끝낸 보상을 받은 날 · 닭의 첫 수확 보너스를 받은 날
alter table public.village_profiles add column if not exists req_seq int not null default 0;
alter table public.village_profiles add column if not exists daily_day int not null default 0;
alter table public.village_profiles add column if not exists daily_bonus_day int not null default 0;
alter table public.village_profiles add column if not exists rooster_day int not null default 0;

-- ---------- 2. 수치 ----------

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
    when 'stone_from' then 4            -- 건물 레벨이 이 값 이상이면 업그레이드에 돌이 든다
    when 'price_min_pct' then 80        -- 장터 시세: 기준 값의 80 % 부터
    when 'price_span' then 51           -- … 51 가지 (80 ~ 130 %)
    when 'pavilion_pct' then 10         -- 정자: 둘레의 생산 건물 + 10 %
    when 'pavilion_pct_per' then 2      -- … 정자 레벨마다 + 2
    when 'pavilion_range' then 1        -- … 둘레 한 칸
    when 'feast_cake' then 60           -- 잔치를 여는 데 드는 떡
    when 'feast_sec' then 86400         -- 잔치는 하루 (초)
    when 'feast_pct' then 20            -- 잔치: 마을 전체 생산 + 20 %
    when 'feast_pct_per' then 2         -- … 잔치 마당 레벨마다 + 2
    when 'feast_exp' then 30            -- 잔치를 열면 받는 경험치
    when 'bonus_room_pct' then 40       -- 건물에 쌓이는 양의 상한 = 최대 시간 분량 × 140 %
    when 'req_exp_pct' then 30          -- 부탁의 경험치 = 값어치(엽전) × 이 % + 5 + 마을 레벨 × 2
    when 'daily_exp_pct' then 1         -- 오늘의 할 일 하나의 경험치 = 그 레벨에 필요한 경험치 × 이 % + 10 (다 끝낸 보상은 두 배 + 20)
    when 'req_slots' then 3             -- 주민 부탁 칸 수
    when 'req_wait_done' then 1200      -- 들어준 뒤 새 부탁이 올 때까지 (초)
    when 'req_wait_skip' then 3600      -- 넘긴 뒤 새 부탁이 올 때까지 (초)
    when 'shrine_pct' then 50           -- 사당이 서 있으면 친밀도 + 50 %
    when 'dog_cap_sec' then 54000       -- 개가 있으면 건물이 15시간 분량까지 쌓아 둔다
    when 'sheep_range' then 1           -- 양이 정자에 있으면 정자의 둘레 + 1칸
  end
$$;
revoke all on function public._village_const(text) from public, anon, authenticated;

create or replace function public._village_table(p_name text) returns int[]
language sql immutable as $$
  select case p_name
    when 'land_sizes' then array[8, 10, 12, 14, 16, 18, 20]
    when 'level_exp' then array[80, 160, 300, 500, 900, 1400, 2000, 2700, 3600, 4800, 6400, 9000, 12000, 15500, 19000, 22600, 26300, 30000, 33800, 38000, 43000, 48000, 53000, 58500, 64000, 69500, 75000, 81000, 87000]
    when 'cost_mul' then array[20, 40, 70, 110, 170, 250, 360, 500, 700]
    when 'upgrade_sec' then array[30, 120, 600, 1800, 3600, 7200, 14400, 21600, 28800]
    when 'upgrade_exp' then array[20, 40, 80, 140, 220, 320, 450, 600, 800]
    when 'rate_mul' then array[10, 13, 16, 20, 24, 29, 34, 40, 47, 55]
    when 'hall_cap' then array[300, 450, 650, 900, 1200, 1600, 2100, 2700, 3400, 4200]
    when 'storage_cap' then array[150, 250, 400, 600, 850, 1150, 1500, 1900, 2400, 3000]
    when 'hall_need' then array[2, 4, 6, 9, 12, 15, 19, 23, 27]
    when 'market_limit' then array[300, 450, 650, 900, 1200, 1600, 2100, 2700, 3400, 4200]
    when 'land_price' then array[10, 20, 30, 50, 70, 100]
    when 'land_need' then array[3, 6, 9, 13, 17, 22]
    when 'aff_need' then array[0, 10, 30, 60, 100]
    when 'aff_bonus' then array[10, 15, 20, 25, 30]
    when 'dragon_bonus' then array[5, 8, 11, 14, 17]
  end
$$;
revoke all on function public._village_table(text) from public, anon, authenticated;

-- 주민: id, 순서, 이사 오는 마을 레벨, 일터('' = 배치하지 않는다). games/village/src/data/residents.ts
create or replace function public._village_residents() returns table (id text, ord int, level int, work text)
language sql immutable as $$
  values
    ('rat', 1, 1, 'storage'),
    ('ox', 2, 2, 'paddy'),
    ('tiger', 3, 3, 'lumber'),
    ('rabbit', 4, 5, 'mill'),
    ('dragon', 5, 7, 'hall'),
    ('snake', 6, 9, 'jar'),
    ('horse', 7, 11, 'market'),
    ('sheep', 8, 13, 'pavilion'),
    ('monkey', 9, 15, 'quarry'),
    ('rooster', 10, 18, ''),
    ('dog', 11, 21, ''),
    ('pig', 12, 24, 'market')
$$;
revoke all on function public._village_residents() from public, anon, authenticated;

-- 부탁에 나오는 자원: 순서, 자원, 기준 개수, 마을 레벨에 따라 늘어나는 정도(÷20), 나오기 시작하는 마을 레벨, 100개의 값어치(엽전)
create or replace function public._village_asks() returns table (ord int, res text, base int, grow int, from_level int, worth int)
language sql immutable as $$
  values
    (1, 'rice', 20, 2, 1, 40),
    (2, 'wood', 16, 2, 2, 50),
    (3, 'stone', 14, 2, 4, 90),
    (4, 'cake', 5, 1, 5, 300),
    (5, 'special', 1, 0, 8, 4000)
$$;
revoke all on function public._village_asks() from public, anon, authenticated;

-- 오늘의 할 일: 순서, 종류, 나오기 시작하는 마을 레벨, 횟수 = base + per × 마을 레벨
create or replace function public._village_tasks() returns table (ord int, task text, from_level int, base int, per int)
language sql immutable as $$
  values
    (1, 'harvest', 1, 6, 1),
    (2, 'construct', 1, 1, 0),
    (3, 'request', 1, 2, 0),
    (4, 'sell', 3, 40, 10),
    (5, 'craft', 5, 5, 1)
$$;
revoke all on function public._village_tasks() from public, anon, authenticated;

-- 마을 목표 (049 와 같은 모양. 종류 resident 주민 n명 · request 부탁 n번 · assign 배치 n번 이 더해졌다)
create or replace function public._village_goals() returns table (idx int, kind text, type text, n int, rice int, wood int, stone int, coin int, exp int)
language sql immutable as $$
  values
    (0, 'build', 'paddy', 1, 35, 35, 0, 0, 10),
    (1, 'build', 'house', 1, 35, 35, 0, 0, 10),
    (2, 'resident', '', 1, 35, 35, 0, 0, 10),
    (3, 'harvest', '', 1, 35, 35, 0, 0, 10),
    (4, 'build', 'paddy', 2, 35, 35, 0, 0, 10),
    (5, 'level', '', 2, 70, 70, 0, 0, 0),
    (6, 'build', 'lumber', 1, 50, 50, 0, 0, 10),
    (7, 'build', 'storage', 1, 50, 50, 0, 0, 10),
    (8, 'upgrade', 'hall', 2, 50, 50, 0, 0, 10),
    (9, 'upgrade', 'paddy', 2, 50, 50, 0, 0, 10),
    (10, 'build', 'house', 2, 50, 50, 0, 0, 10),
    (11, 'request', '', 1, 50, 50, 0, 0, 10),
    (12, 'harvest', '', 5, 50, 50, 0, 0, 10),
    (13, 'level', '', 3, 100, 100, 0, 0, 0),
    (14, 'build', 'market', 1, 65, 65, 0, 15, 10),
    (15, 'sell', '', 20, 65, 65, 0, 15, 10),
    (16, 'build', 'paddy', 3, 65, 65, 0, 15, 10),
    (17, 'upgrade', 'lumber', 2, 65, 65, 0, 15, 10),
    (18, 'assign', '', 1, 65, 65, 0, 15, 10),
    (19, 'level', '', 4, 130, 130, 0, 30, 0),
    (20, 'build', 'quarry', 1, 80, 80, 0, 20, 20),
    (21, 'build', 'lumber', 3, 80, 80, 0, 20, 20),
    (22, 'upgrade', 'hall', 3, 80, 80, 0, 20, 20),
    (23, 'upgrade', 'storage', 2, 80, 80, 0, 20, 20),
    (24, 'deco', '', 2, 80, 80, 0, 20, 20),
    (25, 'level', '', 5, 160, 160, 0, 40, 0),
    (26, 'build', 'mill', 1, 95, 95, 25, 25, 35),
    (27, 'craft', 'mill', 5, 95, 95, 25, 25, 35),
    (28, 'build', 'paddy', 4, 95, 95, 25, 25, 35),
    (29, 'upgrade', 'paddy', 3, 95, 95, 25, 25, 35),
    (30, 'request', '', 3, 95, 95, 25, 25, 35),
    (31, 'harvest', '', 20, 95, 95, 25, 25, 35),
    (32, 'level', '', 6, 190, 190, 50, 50, 0),
    (33, 'upgrade', 'hall', 4, 110, 110, 30, 30, 55),
    (34, 'build', 'quarry', 3, 110, 110, 30, 30, 55),
    (35, 'upgrade', 'lumber', 3, 110, 110, 30, 30, 55),
    (36, 'sell', '', 100, 110, 110, 30, 30, 55),
    (37, 'level', '', 7, 220, 220, 60, 60, 0),
    (38, 'build', 'paddy', 5, 125, 125, 35, 35, 80),
    (39, 'build', 'storage', 3, 125, 125, 35, 35, 80),
    (40, 'upgrade', 'paddy', 4, 125, 125, 35, 35, 80),
    (41, 'craft', 'mill', 20, 125, 125, 35, 35, 80),
    (42, 'resident', '', 5, 125, 125, 35, 35, 80),
    (43, 'level', '', 8, 250, 250, 70, 70, 0),
    (44, 'build', 'jar', 1, 140, 140, 40, 40, 110),
    (45, 'craft', 'jar', 2, 140, 140, 40, 40, 110),
    (46, 'build', 'mill', 2, 140, 140, 40, 40, 110),
    (47, 'upgrade', 'quarry', 4, 140, 140, 40, 40, 110),
    (48, 'level', '', 9, 280, 280, 80, 80, 0),
    (49, 'upgrade', 'hall', 5, 155, 155, 45, 45, 145),
    (50, 'upgrade', 'storage', 4, 155, 155, 45, 45, 145),
    (51, 'deco', '', 6, 155, 155, 45, 45, 145),
    (52, 'sell', '', 300, 155, 155, 45, 45, 145),
    (53, 'request', '', 5, 155, 155, 45, 45, 145),
    (54, 'level', '', 10, 310, 310, 90, 90, 0),
    (55, 'build', 'paddy', 6, 170, 170, 50, 50, 190),
    (56, 'upgrade', 'paddy', 5, 170, 170, 50, 50, 190),
    (57, 'upgrade', 'mill', 3, 170, 170, 50, 50, 190),
    (58, 'craft', 'jar', 5, 170, 170, 50, 50, 190),
    (59, 'level', '', 11, 340, 340, 100, 100, 0),
    (60, 'build', 'lumber', 6, 185, 185, 55, 55, 255),
    (61, 'upgrade', 'lumber', 5, 185, 185, 55, 55, 255),
    (62, 'resident', '', 7, 185, 185, 55, 55, 255),
    (63, 'harvest', '', 40, 185, 185, 55, 55, 255),
    (64, 'level', '', 12, 370, 370, 110, 110, 0),
    (65, 'upgrade', 'hall', 6, 200, 200, 60, 60, 360),
    (66, 'build', 'mill', 3, 200, 200, 60, 60, 360),
    (67, 'build', 'jar', 2, 200, 200, 60, 60, 360),
    (68, 'upgrade', 'quarry', 5, 200, 200, 60, 60, 360),
    (69, 'level', '', 13, 400, 400, 120, 120, 0),
    (70, 'build', 'paddy', 7, 215, 215, 65, 65, 480),
    (71, 'upgrade', 'paddy', 6, 215, 215, 65, 65, 480),
    (72, 'sell', '', 600, 215, 215, 65, 65, 480),
    (73, 'request', '', 8, 215, 215, 65, 65, 480),
    (74, 'level', '', 14, 430, 430, 130, 130, 0),
    (75, 'build', 'storage', 5, 230, 230, 70, 70, 620),
    (76, 'upgrade', 'storage', 5, 230, 230, 70, 70, 620),
    (77, 'deco', '', 10, 230, 230, 70, 70, 620),
    (78, 'level', '', 15, 460, 460, 140, 140, 0),
    (79, 'upgrade', 'hall', 7, 245, 245, 75, 75, 760),
    (80, 'upgrade', 'lumber', 6, 245, 245, 75, 75, 760),
    (81, 'craft', 'mill', 60, 245, 245, 75, 75, 760),
    (82, 'resident', '', 9, 245, 245, 75, 75, 760),
    (83, 'level', '', 16, 490, 490, 150, 150, 0),
    (84, 'build', 'quarry', 6, 260, 260, 80, 80, 905),
    (85, 'build', 'mill', 4, 260, 260, 80, 80, 905),
    (86, 'upgrade', 'paddy', 7, 260, 260, 80, 80, 905),
    (87, 'level', '', 17, 520, 520, 160, 160, 0),
    (88, 'build', 'paddy', 8, 275, 275, 85, 85, 1050),
    (89, 'build', 'jar', 3, 275, 275, 85, 85, 1050),
    (90, 'craft', 'jar', 10, 275, 275, 85, 85, 1050),
    (91, 'request', '', 10, 275, 275, 85, 85, 1050),
    (92, 'level', '', 18, 550, 550, 170, 170, 0),
    (93, 'build', 'lumber', 8, 290, 290, 90, 90, 1200),
    (94, 'build', 'storage', 6, 290, 290, 90, 90, 1200),
    (95, 'upgrade', 'quarry', 7, 290, 290, 90, 90, 1200),
    (96, 'resident', '', 10, 290, 290, 90, 90, 1200),
    (97, 'level', '', 19, 580, 580, 180, 180, 0),
    (98, 'upgrade', 'hall', 8, 305, 305, 95, 95, 1350),
    (99, 'upgrade', 'paddy', 8, 305, 305, 95, 95, 1350),
    (100, 'sell', '', 1200, 305, 305, 95, 95, 1350),
    (101, 'level', '', 20, 610, 610, 190, 190, 0),
    (102, 'build', 'quarry', 7, 320, 320, 100, 100, 1520),
    (103, 'upgrade', 'lumber', 8, 320, 320, 100, 100, 1520),
    (104, 'deco', '', 14, 320, 320, 100, 100, 1520),
    (105, 'level', '', 21, 640, 640, 200, 200, 0),
    (106, 'upgrade', 'storage', 8, 335, 335, 105, 105, 1720),
    (107, 'upgrade', 'mill', 8, 335, 335, 105, 105, 1720),
    (108, 'resident', '', 11, 335, 335, 105, 105, 1720),
    (109, 'harvest', '', 100, 335, 335, 105, 105, 1720),
    (110, 'level', '', 22, 670, 670, 210, 210, 0),
    (111, 'upgrade', 'market', 8, 350, 350, 110, 110, 1920),
    (112, 'craft', 'jar', 20, 350, 350, 110, 110, 1920),
    (113, 'sell', '', 2000, 350, 350, 110, 110, 1920),
    (114, 'request', '', 12, 350, 350, 110, 110, 1920),
    (115, 'level', '', 23, 700, 700, 220, 220, 0),
    (116, 'upgrade', 'hall', 9, 365, 365, 115, 115, 2120),
    (117, 'upgrade', 'paddy', 9, 365, 365, 115, 115, 2120),
    (118, 'upgrade', 'lumber', 9, 365, 365, 115, 115, 2120),
    (119, 'level', '', 24, 730, 730, 230, 230, 0),
    (120, 'upgrade', 'quarry', 9, 380, 380, 120, 120, 2340),
    (121, 'upgrade', 'jar', 9, 380, 380, 120, 120, 2340),
    (122, 'resident', '', 12, 380, 380, 120, 120, 2340),
    (123, 'craft', 'mill', 150, 380, 380, 120, 120, 2340),
    (124, 'level', '', 25, 760, 760, 240, 240, 0),
    (125, 'upgrade', 'storage', 9, 395, 395, 125, 125, 2560),
    (126, 'upgrade', 'mill', 9, 395, 395, 125, 125, 2560),
    (127, 'sell', '', 3000, 395, 395, 125, 125, 2560),
    (128, 'level', '', 26, 790, 790, 250, 250, 0),
    (129, 'upgrade', 'market', 9, 410, 410, 130, 130, 2780),
    (130, 'deco', '', 18, 410, 410, 130, 130, 2780),
    (131, 'harvest', '', 200, 410, 410, 130, 130, 2780),
    (132, 'request', '', 15, 410, 410, 130, 130, 2780),
    (133, 'level', '', 27, 820, 820, 260, 260, 0),
    (134, 'upgrade', 'hall', 10, 425, 425, 135, 135, 3000),
    (135, 'upgrade', 'paddy', 10, 425, 425, 135, 135, 3000),
    (136, 'upgrade', 'lumber', 10, 425, 425, 135, 135, 3000),
    (137, 'level', '', 28, 850, 850, 270, 270, 0),
    (138, 'upgrade', 'quarry', 10, 440, 440, 140, 140, 3240),
    (139, 'upgrade', 'storage', 10, 440, 440, 140, 140, 3240),
    (140, 'craft', 'jar', 40, 440, 440, 140, 140, 3240),
    (141, 'level', '', 29, 880, 880, 280, 280, 0),
    (142, 'upgrade', 'mill', 10, 455, 455, 145, 145, 3480),
    (143, 'upgrade', 'jar', 10, 455, 455, 145, 145, 3480),
    (144, 'upgrade', 'market', 10, 455, 455, 145, 145, 3480),
    (145, 'level', '', 30, 910, 910, 290, 290, 0)
$$;
revoke all on function public._village_goals() from public, anon, authenticated;

-- ---------- 3. 주민의 보너스 ----------

-- 무작위처럼 보이지만 정해진 수 (화면도 같은 식을 쓴다): 부탁 · 오늘의 할 일을 고를 때
create or replace function public._village_mix(p_seq bigint, p_k int) returns int
language sql immutable as $$
  select (((p_seq * 7919 + p_k * 104729 + 12345) % 1000003 + 1000003) % 1000003)::int
$$;
revoke all on function public._village_mix(bigint, int) from public, anon, authenticated;

-- 친밀도 점수 → 단계 (1 … 5)
create or replace function public._village_aff_level(p_points int) returns int
language sql immutable as $$
  select (select count(*) from unnest(public._village_table('aff_need')) n where p_points >= n)::int
$$;
revoke all on function public._village_aff_level(int) from public, anon, authenticated;

-- 그 주민이 일하고 있는 건물 (제 일터에 배치되어 있고 그 건물이 서 있을 때). 아니면 null
create or replace function public._village_workplace(p_user uuid, p_resident text) returns uuid
language sql stable security definer set search_path = public as $$
  select b.id from public.village_residents r
  join public._village_residents() d on d.id = r.resident
  join public.village_buildings b on b.id = r.building_id and b.user_id = r.user_id
  where r.user_id = p_user and r.resident = p_resident and d.work <> '' and b.type = d.work and b.state not in ('building', 'stored')
$$;
revoke all on function public._village_workplace(uuid, text) from public, anon, authenticated;

-- 그 주민의 보너스 (%): 일터가 있는 주민은 일하고 있을 때, 닭 · 개는 이사 와 있을 때. 아니면 0
create or replace function public._village_res_pct(p_user uuid, p_resident text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (public._village_table(case when r.resident = 'dragon' then 'dragon_bonus' else 'aff_bonus' end))[public._village_aff_level(r.affinity)]
    from public.village_residents r join public._village_residents() d on d.id = r.resident
    where r.user_id = p_user and r.resident = p_resident and (d.work = '' or public._village_workplace(p_user, p_resident) is not null)), 0)
$$;
revoke all on function public._village_res_pct(uuid, text) from public, anon, authenticated;

-- 짓기 · 업그레이드에 걸리는 시간: 용이 마을 회관에 있으면 줄어든다
create or replace function public._village_time_cut(p_user uuid, p_sec int) returns int
language sql stable security definer set search_path = public as $$
  select p_sec * (100 - public._village_res_pct(p_user, 'dragon')) / 100
$$;
revoke all on function public._village_time_cut(uuid, int) from public, anon, authenticated;

-- 창고 용량: 마을 회관 + 놓여 있는 창고들 (쥐가 있는 창고는 더 크다)
create or replace function public._village_cap(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select (public._village_table('hall_cap'))[public._village_hall_level(p_user)]::bigint
    + coalesce((
      select sum(case when b.id = public._village_workplace(p_user, 'rat')
                      then (public._village_table('storage_cap'))[b.level] * (100 + public._village_res_pct(p_user, 'rat')) / 100
                      else (public._village_table('storage_cap'))[b.level] end)
      from public.village_buildings b where b.user_id = p_user and b.type = 'storage' and b.state not in ('building', 'stored')), 0)::bigint
$$;
revoke all on function public._village_cap(uuid) from public, anon, authenticated;

-- 정자의 둘레 (양이 정자에 있으면 한 칸 더) · 쌓아 두는 최대 시간 (개가 있으면 15시간)
create or replace function public._village_pavilion_range(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select public._village_const('pavilion_range')::int
    + case when public._village_workplace(p_user, 'sheep') is not null then public._village_const('sheep_range')::int else 0 end
$$;
revoke all on function public._village_pavilion_range(uuid) from public, anon, authenticated;

create or replace function public._village_cap_sec(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.village_residents where user_id = p_user and resident = 'dog')
    then public._village_const('dog_cap_sec')::int else public._village_const('prod_cap_sec')::int end
$$;
revoke all on function public._village_cap_sec(uuid) from public, anon, authenticated;

-- 그 건물의 생산 보너스 (%): 정자 둘레 + 그 건물에서 일하는 주민(소 · 호랑이 · 원숭이)
create or replace function public._village_rate_pct(p_user uuid, p_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when not exists (
      select 1 from public.village_buildings b join public._village_types() d on d.type = b.type
      where b.id = p_id and b.user_id = p_user and d.product <> '' and b.state <> 'stored') then 0
    else coalesce((
      select public._village_const('pavilion_pct')::int + public._village_const('pavilion_pct_per')::int * (pv.level - 1)
      from public.village_buildings b
      join public._village_types() d on d.type = b.type
      join public.village_buildings pv on pv.user_id = b.user_id and pv.type = 'pavilion' and pv.state in ('done', 'upgrading')
      join public._village_types() p on p.type = 'pavilion'
      where b.id = p_id and b.user_id = p_user
        and b.x < pv.x + p.w + public._village_pavilion_range(p_user) and b.x + d.w > pv.x - public._village_pavilion_range(p_user)
        and b.y < pv.y + p.h + public._village_pavilion_range(p_user) and b.y + d.h > pv.y - public._village_pavilion_range(p_user)
      limit 1), 0)
      + coalesce((select sum(public._village_res_pct(p_user, w)) from unnest(array['ox', 'tiger', 'monkey']) w
                  where public._village_workplace(p_user, w) = p_id), 0)::int
    end
$$;
revoke all on function public._village_rate_pct(uuid, uuid) from public, anon, authenticated;

-- 장터의 하루 한도 (말이 있으면 더)
create or replace function public._village_market_limit(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (public._village_table('market_limit'))[m.level]::bigint * (100 + public._village_res_pct(p_user, 'horse')) / 100
    from public.village_buildings m where m.user_id = p_user and m.type = 'market' and m.state = 'done' limit 1), 0)
$$;
revoke all on function public._village_market_limit(uuid) from public, anon, authenticated;

-- ---------- 4. 안에서만 쓰는 도구 ----------

-- 한 일을 센다: 지금 마을 목표가 그 종류를 세고 있으면 그 횟수에, 오늘의 할 일에 그 종류가 있으면 거기에
create or replace function public._village_progress(p_user uuid, p_kind text, p_type text, p_n bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_n is null or p_n <= 0 then return; end if;
  update public.village_profiles p set goal_progress = goal_progress + p_n
  where p.user_id = p_user
    and exists (select 1 from public._village_goals() g where g.idx = p.goal and g.kind = p_kind and g.kind in ('harvest', 'sell', 'craft', 'request', 'assign') and (g.type = '' or g.type = p_type));
  update public.village_requests set progress = least((content->>'n')::bigint, progress + p_n)::int
  where user_id = p_user and kind = 'daily' and state = 'open' and content->>'task' = p_kind;
end $$;
revoke all on function public._village_progress(uuid, text, text, bigint) from public, anon, authenticated;

-- 서버가 모든 요청의 처음에 하는 일:
--   1. 끝난 짓기 · 업그레이드를 마무리한다  2. 주민 이사  3. 기다림이 끝난 부탁 칸에 새 부탁  4. 날이 바뀌었으면 오늘의 할 일
create or replace function public._village_settle(p_user uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; e bigint; d record; q record; a record; t record; lv int; houses int; cnt int; seq bigint; day int;
  ids text[]; pool int; n bigint; v bigint; need int; start int; i int;
begin
  for b in select * from public.village_buildings where user_id = p_user and state in ('building', 'upgrading') and finish_at <= p_now order by finish_at, created_at, id loop
    if b.type = 'pavilion' then perform public._village_bank_all(p_user, p_now); end if;
    if b.state = 'building' then
      select x.build_exp into e from public._village_types() x where x.type = b.type;
    else
      e := (public._village_table('upgrade_exp'))[b.level] * case when b.type = 'hall' then public._village_const('hall_exp_mul')::int else 1 end;
    end if;
    update public.village_buildings set
      level = level + case when b.state = 'upgrading' then 1 else 0 end,
      state = 'done', last_collected_at = b.finish_at, finish_at = null, started_at = null
    where id = b.id;
    perform public._village_add_exp(p_user, e);
  end loop;

  -- 이사: 십이지 순서대로, 마을 레벨이 되고 빈 집이 있을 때
  select level into lv from public.village_profiles where user_id = p_user;
  select count(*) into houses from public.village_buildings where user_id = p_user and type = 'house' and state not in ('building', 'stored');
  select count(*) into cnt from public.village_residents where user_id = p_user;
  for d in select * from public._village_residents() order by ord loop
    continue when exists (select 1 from public.village_residents where user_id = p_user and resident = d.id);
    exit when lv < d.level or houses <= cnt;
    insert into public.village_residents (user_id, resident, moved_in_at) values (p_user, d.id, p_now);
    cnt := cnt + 1;
  end loop;

  -- 부탁: 주민이 있으면 칸 셋. 기다림이 끝난 칸에 새 부탁을 넣는다
  if cnt > 0 then
    insert into public.village_requests (user_id, kind, slot, state, ready_at)
    select p_user, 'resident', s, 'wait', p_now from generate_series(0, public._village_const('req_slots')::int - 1) s
    on conflict (user_id, kind, slot) do nothing;
    ids := array(select r.resident from public.village_residents r join public._village_residents() x on x.id = r.resident where r.user_id = p_user order by x.ord);
    select count(*) into pool from public._village_asks() k where k.from_level <= lv;
    for q in select * from public.village_requests where user_id = p_user and kind = 'resident' and state = 'wait' and ready_at <= p_now order by slot loop
      update public.village_profiles set req_seq = req_seq + 1 where user_id = p_user returning req_seq into seq;
      select * into a from (select k.*, row_number() over (order by k.ord) - 1 as pos from public._village_asks() k where k.from_level <= lv) z
      where z.pos = public._village_mix(seq, 2) % pool;
      n := greatest(1, a.base::bigint * (2 + public._village_mix(seq, 3) % 4) * (20 + lv * a.grow) / 20);
      v := n * a.worth / 100;
      update public.village_requests set state = 'open', ready_at = null, progress = 0, content = jsonb_build_object(
        'resident', ids[public._village_mix(seq, 1) % cardinality(ids) + 1], 'res', a.res, 'n', n,
        'coin', v * 3 / 2 + 10, 'exp', v * public._village_const('req_exp_pct')::int / 100 + 5 + lv * 2, 'aff', 2 + public._village_mix(seq, 4) % 3)
      where id = q.id;
    end loop;
  end if;

  -- 오늘의 할 일: 서버 날짜가 바뀌었으면 셋을 새로 정한다 (날짜 · 마을 레벨로 정해진다)
  day := public._village_kst_day(p_now);
  if (select daily_day from public.village_profiles where user_id = p_user) <> day then
    delete from public.village_requests where user_id = p_user and kind = 'daily';
    select count(*) into pool from public._village_tasks() k where k.from_level <= lv;
    start := public._village_mix(day, 5) % pool;
    need := (public._village_table('level_exp'))[least(lv, 29)];
    for i in 0..2 loop
      select * into t from (select k.*, row_number() over (order by k.ord) - 1 as pos from public._village_tasks() k where k.from_level <= lv) z
      where z.pos = (start + i) % pool;
      insert into public.village_requests (user_id, kind, slot, state, content, expires_at)
      values (p_user, 'daily', i, 'open', jsonb_build_object('task', t.task, 'n', t.base + t.per * lv, 'coin', 20 + lv * 5,
        'exp', need * public._village_const('daily_exp_pct')::int / 100 + 10), p_now + interval '1 day');
    end loop;
    update public.village_profiles set daily_day = day where user_id = p_user;
  end if;
end $$;
revoke all on function public._village_settle(uuid, timestamptz) from public, anon, authenticated;

-- 건물 하나를 거둔다 (050 과 같고, p_bonus = 닭의 첫 수확 보너스 %: 생산 건물의 쌓인 양에 더한다)
drop function if exists public._village_collect(uuid, uuid, timestamptz, bigint);
create or replace function public._village_collect(p_user uuid, p_id uuid, p_now timestamptz, p_cap bigint, p_bonus int,
  out got bigint, out have bigint, out product text, out job_exp bigint, out is_job boolean)
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; ty record; rc record; u record; cur bigint; room bigint;
begin
  got := 0; have := 0; product := ''; job_exp := 0; is_job := false;
  select * into b from public.village_buildings where id = p_id and user_id = p_user for update;
  if not found then return; end if;
  if b.state = 'working' then
    select * into rc from public._village_recipes() r where r.type = b.type;
    if not found or b.finish_at is null or b.finish_at > p_now then return; end if;
    product := rc.out_res; have := b.job_n; is_job := true; job_exp := have * rc.exp;
    cur := public._village_res(p_user, product);
    room := case when product in ('rice', 'wood', 'stone', 'cake') then p_cap - cur else have end;
    got := greatest(0, least(have, room));
    perform public._village_add(p_user, product, got);
    update public.village_buildings set state = 'done', finish_at = null, started_at = null, job_n = 0, last_collected_at = p_now where id = p_id;
    return;
  end if;
  if b.state <> 'done' then return; end if;
  select * into ty from public._village_types() t where t.type = b.type;
  if ty.product = '' then return; end if;
  select * into u from public._village_units(p_user, p_id, p_now);
  if u.units <= 0 then return; end if;
  have := u.units + u.units * coalesce(p_bonus, 0) / 100;
  product := ty.product;
  cur := public._village_res(p_user, product);
  room := case when product in ('rice', 'wood', 'stone', 'cake') then p_cap - cur else have end;
  got := greatest(0, least(have, room));
  perform public._village_add(p_user, product, got);
  -- 거둔 만큼의 시간만 쓴다 (1개가 되다 만 시간은 남는다)
  update public.village_buildings set banked = 0,
    last_collected_at = least(p_now, u.frm + make_interval(secs => ((u.base * 3600 + u.rate - 1) / u.rate)::double precision))
  where id = p_id;
end $$;
revoke all on function public._village_collect(uuid, uuid, timestamptz, bigint, int) from public, anon, authenticated;

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
    when 'deco' then (select count(*) from public.village_buildings b join public._village_types() t on t.type = b.type where b.user_id = p_user and t.kind = 'deco')::int
    when 'resident' then (select count(*) from public.village_residents r where r.user_id = p_user)::int
    when 'level' then p.level
    else p.goal_progress
  end;
end $$;
revoke all on function public._village_goal_have(uuid) from public, anon, authenticated;

-- 화면에 보내는 마을 모양 (시각은 ms)
create or replace function public._village_state_json(p_user uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', public._village_ms(p_now),
    'sia', coalesce((select w.sia_coins from public.wallets w where w.user_id = p_user), 0),
    'profile', jsonb_build_object(
      'name', p.village_name, 'level', p.level, 'exp', p.exp,
      'resources', jsonb_build_object('special', 0) || p.resources, 'landStage', p.land_stage,
      'prosperity', p.prosperity, 'goal', p.goal, 'goalProgress', p.goal_progress,
      'marketDay', p.market_day, 'marketSold', p.market_sold,
      'feastFrom', coalesce(public._village_ms(p.feast_from), 0), 'feastUntil', coalesce(public._village_ms(p.feast_until), 0), 'feastPct', p.feast_pct,
      'reqSeq', p.req_seq, 'dailyDay', p.daily_day, 'dailyBonusDay', p.daily_bonus_day, 'roosterDay', p.rooster_day),
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'level', b.level, 'x', coalesce(b.x, 0), 'y', coalesce(b.y, 0), 'state', b.state,
        'finishAt', public._village_ms(b.finish_at), 'startAt', public._village_ms(b.started_at),
        'collectedAt', public._village_ms(b.last_collected_at), 'jobN', b.job_n, 'banked', b.banked) order by b.created_at, b.id)
      from public.village_buildings b where b.user_id = p_user), '[]'::jsonb),
    'residents', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.resident, 'affinity', r.affinity, 'building', r.building_id, 'gifted', r.gifted) order by d.ord)
      from public.village_residents r join public._village_residents() d on d.id = r.resident where r.user_id = p_user), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(q.content || jsonb_build_object('slot', q.slot, 'state', q.state, 'readyAt', coalesce(public._village_ms(q.ready_at), 0)) order by q.slot)
      from public.village_requests q where q.user_id = p_user and q.kind = 'resident'), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(q.content || jsonb_build_object('slot', q.slot, 'progress', q.progress, 'claimed', q.state = 'claimed') order by q.slot)
      from public.village_requests q where q.user_id = p_user and q.kind = 'daily'), '[]'::jsonb))
  from public.village_profiles p where p.user_id = p_user
$$;
revoke all on function public._village_state_json(uuid, timestamptz) from public, anon, authenticated;

-- ---------- 5. 화면이 부르는 함수 (앞 파일의 것을 다시 정의) ----------

-- 짓기 (050 과 같고, 용이 마을 회관에 있으면 짓는 시간이 줄어든다. 오늘의 할 일 'construct')
create or replace function public.village_build(p_type text, p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; ty record; lv int; cnt int; mx int; why text; new_id uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into ty from public._village_types() x where x.type = p_type;
  if not found then raise exception 'bad type'; end if;
  select level into lv from public.village_profiles where user_id = me;
  select count(*) into cnt from public.village_buildings where user_id = me and type = p_type;
  mx := case when ty.cap > 0 then case when lv >= ty.unlock[1] then ty.cap else 0 end
        else (select count(*) from unnest(ty.unlock) u where u <= lv)::int end;
  -- 아직 하나도 못 가지는 것은 'locked', 지금 레벨의 개수를 다 가졌으면 'limit'
  if cnt >= mx then raise exception '%', case when cnt = 0 then 'locked' else 'limit' end; end if;
  if ty.build_sec > 0 and not public._village_slot_free(me) then raise exception 'no slot'; end if;
  why := public._village_place_error(me, p_type, p_x, p_y, null);
  if why is not null then raise exception '%', why; end if;
  perform public._village_spend(me, ty.rice, ty.wood, ty.stone, ty.coin);
  -- 마을 줄을 잠근 채로 지갑 줄을 잠근다 (순서: 마을 → 지갑)
  if ty.sia > 0 then perform public._spend_sia_coin(me, ty.sia, 'village', 'special:' || p_type); end if;
  insert into public.village_buildings (user_id, type, x, y, state, started_at, finish_at, last_collected_at)
  values (me, p_type, p_x, p_y, 'building', t, t + make_interval(secs => public._village_time_cut(me, ty.build_sec)), t)
  returning id into new_id;
  if ty.build_sec > 0 then perform public._village_progress(me, 'construct', '', 1); end if;
  -- 0초짜리(장식물 · 길)는 바로 끝난다
  perform public._village_settle(me, t);
  return public._village_state_json(me, t) || jsonb_build_object('id', new_id);
end $$;
revoke all on function public.village_build(text, int, int) from public, anon;
grant execute on function public.village_build(text, int, int) to authenticated;

-- 수확 (049 와 같고, 닭이 있으면 그날의 첫 수확에 보너스. 답의 harvest.rooster = 받은 보너스 %)
create or replace function public.village_harvest(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; cap bigint; bid uuid; c record; btype text; day int; bonus int; cnt int := 0;
  per jsonb := '{}'::jsonb; gained jsonb := '{}'::jsonb; total bigint := 0; jexp bigint := 0; lost bigint := 0; e bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > public._village_const('harvest_max') then raise exception 'bad request'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  cap := public._village_cap(me);
  day := public._village_kst_day(t);
  bonus := case when (select rooster_day from public.village_profiles where user_id = me) <> day then public._village_res_pct(me, 'rooster') else 0 end;
  -- 보낸 순서대로 (같은 건물이 여러 번 있어도 한 번만)
  for bid in select u from unnest(p_ids) with ordinality as x(u, n) where u is not null group by u order by min(n) loop
    select type into btype from public.village_buildings where id = bid and user_id = me;
    select * into c from public._village_collect(me, bid, t, cap, bonus);
    continue when c.have <= 0;
    per := per || jsonb_build_object(bid::text, c.got);
    if c.got > 0 then gained := gained || jsonb_build_object(c.product, coalesce((gained->>c.product)::bigint, 0) + c.got); end if;
    lost := lost + c.have - c.got;
    if c.is_job then
      jexp := jexp + c.job_exp;
      perform public._village_progress(me, 'craft', btype, c.have);
    else
      total := total + c.have;
      cnt := cnt + 1;
    end if;
    perform public._village_progress(me, 'harvest', '', 1);
  end loop;
  -- 생산 건물을 하나라도 거뒀을 때만 그날의 보너스를 쓴 것으로 친다 (가공만 거둔 것은 아니다)
  if bonus > 0 and cnt > 0 then update public.village_profiles set rooster_day = day where user_id = me; else bonus := 0; end if;
  e := total / public._village_const('harvest_exp_div')::int + jexp;
  perform public._village_add_exp(me, e);
  return public._village_state_json(me, t) || jsonb_build_object('harvest', jsonb_build_object('per', per, 'gained', gained, 'exp', e, 'lost', lost, 'rooster', bonus));
end $$;
revoke all on function public.village_harvest(uuid[]) from public, anon;
grant execute on function public.village_harvest(uuid[]) to authenticated;

-- 업그레이드 (049 와 같고, 용이 있으면 시간이 줄어든다. 오늘의 할 일 'construct')
create or replace function public.village_upgrade(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; ty record; lv int; m int; sec int; st bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  select * into ty from public._village_types() x where x.type = b.type;
  if ty.kind not in ('main', 'special') then raise exception 'no upgrade'; end if;
  if b.state <> 'done' then raise exception 'busy'; end if;
  if b.level >= public._village_const('building_max_level') then raise exception 'max level'; end if;
  if b.type = 'hall' then
    select level into lv from public.village_profiles where user_id = me;
    if lv < (public._village_table('hall_need'))[b.level] then raise exception 'village level'; end if;
  elsif b.level >= public._village_hall_level(me) then
    raise exception 'hall level';
  end if;
  if not public._village_slot_free(me) then raise exception 'no slot'; end if;
  m := (public._village_table('cost_mul'))[b.level];
  st := case when b.level >= public._village_const('stone_from') then ty.up_stone * m / 10 else 0 end;
  if public._village_res(me, 'rice') < ty.rice * m / 10 or public._village_res(me, 'wood') < ty.wood * m / 10 or public._village_res(me, 'stone') < st then raise exception 'not enough'; end if;
  perform public._village_collect(me, b.id, t, public._village_cap(me), 0);
  perform public._village_spend(me, ty.rice * m / 10, ty.wood * m / 10, st, 0);
  sec := public._village_time_cut(me, (public._village_table('upgrade_sec'))[b.level] * case when b.type = 'hall' then public._village_const('hall_sec_mul')::int else 1 end);
  update public.village_buildings set state = 'upgrading', started_at = t, finish_at = t + make_interval(secs => sec) where id = b.id;
  perform public._village_progress(me, 'construct', '', 1);
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_upgrade(uuid) from public, anon;
grant execute on function public.village_upgrade(uuid) to authenticated;

-- 가공 시작 (049 와 같고, 토끼가 방앗간에 · 뱀이 장독대에 있으면 더 빨리: 하나의 시간 × 100 ÷ (100 + 보너스 %))
create or replace function public.village_craft(p_id uuid, p_n int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; rc record; unit int; worker text; pct int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  select * into rc from public._village_recipes() r where r.type = b.type;
  if not found then raise exception 'no recipe'; end if;
  if b.state <> 'done' then raise exception 'busy'; end if;
  if p_n is null or p_n < 1 or p_n > rc.base + rc.per * (b.level - 1) then raise exception 'bad count'; end if;
  if public._village_res(me, rc.in1) < rc.n1 * p_n or (rc.in2 <> '' and public._village_res(me, rc.in2) < rc.n2 * p_n) then raise exception 'not enough'; end if;
  perform public._village_add(me, rc.in1, -rc.n1 * p_n);
  if rc.in2 <> '' then perform public._village_add(me, rc.in2, -rc.n2 * p_n); end if;
  worker := case when b.type = 'mill' then 'rabbit' else 'snake' end;
  pct := case when public._village_workplace(me, worker) = b.id then public._village_res_pct(me, worker) else 0 end;
  unit := (rc.sec * 10 / (public._village_table('rate_mul'))[b.level]) * 100 / (100 + pct);
  update public.village_buildings set state = 'working', job_n = p_n, started_at = t, finish_at = t + make_interval(secs => p_n * unit) where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_craft(uuid, int) from public, anon;
grant execute on function public.village_craft(uuid, int) to authenticated;

-- 장터에서 팔기 (049 와 같고, 돼지가 있으면 값이 · 말이 있으면 하루 한도가 늘어난다)
--   받는 엽전 = floor(개수 × 기준 값 × 오늘 시세(%) × (100 + 돼지 %) ÷ 1000000)
create or replace function public.village_sell(p_res text, p_n int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; pr record; p public.village_profiles; day int; sold bigint; coins bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  if not exists (select 1 from public.village_buildings where user_id = me and type = 'market' and state = 'done') then raise exception 'no market'; end if;
  select * into pr from public._village_prices() x where x.res = p_res;
  if not found then raise exception 'bad resource'; end if;
  if p_n is null or p_n < 1 or p_n > 1000000 then raise exception 'bad count'; end if;
  if public._village_res(me, p_res) < p_n then raise exception 'not enough'; end if;
  select * into p from public.village_profiles where user_id = me;
  day := public._village_kst_day(t);
  sold := case when p.market_day = day then p.market_sold else 0 end;
  coins := p_n::bigint * pr.base * public._village_price_pct(day, pr.idx) * (100 + public._village_res_pct(me, 'pig')) / 1000000;
  if coins < 1 then raise exception 'too few'; end if;
  if sold + coins > public._village_market_limit(me) then raise exception 'sell limit'; end if;
  perform public._village_add(me, p_res, -p_n);
  perform public._village_add(me, 'coin', coins);
  update public.village_profiles set market_day = day, market_sold = sold + coins where user_id = me;
  perform public._village_progress(me, 'sell', '', coins);
  return public._village_state_json(me, t) || jsonb_build_object('sold', coins);
end $$;
revoke all on function public.village_sell(text, int) from public, anon;
grant execute on function public.village_sell(text, int) to authenticated;

-- 보관함에 넣기 (050 과 같고, 거기서 일하던 주민은 쉰다)
create or replace function public.village_store(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  if b.type = 'hall' then raise exception 'cannot store'; end if;
  if b.state <> 'done' then raise exception '%', case when b.state = 'stored' then 'stored' else 'busy' end; end if;
  if b.type = 'pavilion' then perform public._village_bank_all(me, t); end if;
  perform public._village_collect(me, b.id, t, public._village_cap(me), 0);
  update public.village_buildings set state = 'stored', x = null, y = null, banked = 0 where id = b.id;
  update public.village_residents set building_id = null where user_id = me and building_id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_store(uuid) from public, anon;
grant execute on function public.village_store(uuid) to authenticated;

-- ---------- 6. 주민 · 부탁 · 오늘의 할 일 ----------

-- 주민 배치: 제 일터인 서 있는 건물에만. p_building 이 null 이면 쉬게 한다
--   생산량이 바뀌는 주민(소 · 호랑이 · 원숭이 · 양)은 그때까지 쌓인 양을 먼저 적어 둔다
create or replace function public.village_assign(p_resident text, p_building uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; r public.village_residents; d record; b public.village_buildings;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into r from public.village_residents where user_id = me and resident = p_resident for update;
  if not found then raise exception 'no resident'; end if;
  select * into d from public._village_residents() x where x.id = p_resident;
  if d.work = '' then raise exception 'no work'; end if;
  if p_building is not null then
    select * into b from public.village_buildings where id = p_building and user_id = me for update;
    if not found then raise exception 'no building'; end if;
    if b.type <> d.work or b.state in ('building', 'stored') then raise exception 'wrong building'; end if;
  end if;
  if p_resident = 'sheep' then
    perform public._village_bank_all(me, t);
  elsif p_resident in ('ox', 'tiger', 'monkey') then
    perform public._village_bank(me, public._village_workplace(me, p_resident), t);
    perform public._village_bank(me, p_building, t);
  end if;
  update public.village_residents set building_id = p_building where user_id = me and resident = p_resident;
  if p_building is not null then perform public._village_progress(me, 'assign', '', 1); end if;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_assign(text, uuid) from public, anon;
grant execute on function public.village_assign(text, uuid) to authenticated;

-- 부탁 들어주기: 자원을 내고 엽전 · 경험치 · 친밀도를 받는다. 그 칸은 req_wait_done 초 뒤에 새 부탁이 온다
--   사당이 서 있으면 친밀도 + shrine_pct %. 친밀도가 5단계가 되면 전용 장식물이 보관함으로 들어온다 (답의 gift = 그 건물 id)
create or replace function public.village_request_done(p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; q public.village_requests; r public.village_residents;
  res text; n bigint; add int; lv0 int; lv1 int; gift uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into q from public.village_requests where user_id = me and kind = 'resident' and slot = p_slot for update;
  if not found or q.state <> 'open' then raise exception 'no request'; end if;
  res := q.content->>'res'; n := (q.content->>'n')::bigint;
  if public._village_res(me, res) < n then raise exception 'not enough'; end if;
  perform public._village_add(me, res, -n);
  perform public._village_add(me, 'coin', (q.content->>'coin')::bigint);
  select * into r from public.village_residents where user_id = me and resident = q.content->>'resident' for update;
  if found then
    add := (q.content->>'aff')::int;
    if exists (select 1 from public.village_buildings where user_id = me and type = 'shrine' and state not in ('building', 'stored')) then
      add := add * (100 + public._village_const('shrine_pct')::int) / 100;
    end if;
    lv0 := public._village_aff_level(r.affinity); lv1 := public._village_aff_level(r.affinity + add);
    -- 생산량을 올리는 주민의 단계가 오르면 그때까지 쌓인 양을 먼저 적어 둔다
    if lv1 > lv0 and r.resident in ('ox', 'tiger', 'monkey') then perform public._village_bank(me, public._village_workplace(me, r.resident), t); end if;
    update public.village_residents set affinity = affinity + add where user_id = me and resident = r.resident;
    if lv1 >= 5 and not r.gifted then
      insert into public.village_buildings (user_id, type, state, last_collected_at) values (me, 'gift_' || r.resident, 'stored', t) returning id into gift;
      update public.village_residents set gifted = true where user_id = me and resident = r.resident;
    end if;
  end if;
  update public.village_requests set state = 'wait', content = '{}'::jsonb, ready_at = t + make_interval(secs => public._village_const('req_wait_done')::int) where id = q.id;
  perform public._village_progress(me, 'request', '', 1);
  perform public._village_add_exp(me, (q.content->>'exp')::bigint);
  return public._village_state_json(me, t) || jsonb_build_object('gift', gift);
end $$;
revoke all on function public.village_request_done(int) from public, anon;
grant execute on function public.village_request_done(int) to authenticated;

-- 부탁 넘기기: 그 칸은 req_wait_skip 초 뒤에 새 부탁이 온다
create or replace function public.village_request_skip(p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; q public.village_requests;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into q from public.village_requests where user_id = me and kind = 'resident' and slot = p_slot for update;
  if not found or q.state <> 'open' then raise exception 'no request'; end if;
  update public.village_requests set state = 'wait', content = '{}'::jsonb, ready_at = t + make_interval(secs => public._village_const('req_wait_skip')::int) where id = q.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_request_skip(int) from public, anon;
grant execute on function public.village_request_skip(int) to authenticated;

-- 오늘의 할 일 보상: p_slot 0 … 2 는 그 일, 3 은 셋을 다 끝낸 추가 보상 (하루 한 번)
create or replace function public.village_daily_claim(p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; q public.village_requests; p public.village_profiles; need int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into p from public.village_profiles where user_id = me;
  if p_slot = 3 then
    if (select count(*) from public.village_requests where user_id = me and kind = 'daily' and state = 'claimed') < 3 then raise exception 'not done'; end if;
    if p.daily_bonus_day = p.daily_day then raise exception 'claimed'; end if;
    need := (public._village_table('level_exp'))[least(p.level, 29)];
    update public.village_profiles set daily_bonus_day = daily_day where user_id = me;
    perform public._village_add(me, 'coin', 50 + p.level * 10);
    perform public._village_add_exp(me, need * public._village_const('daily_exp_pct')::int * 2 / 100 + 20);
    return public._village_state_json(me, t);
  end if;
  select * into q from public.village_requests where user_id = me and kind = 'daily' and slot = p_slot for update;
  if not found then raise exception 'no task'; end if;
  if q.state = 'claimed' then raise exception 'claimed'; end if;
  if q.progress < (q.content->>'n')::int then raise exception 'not done'; end if;
  update public.village_requests set state = 'claimed' where id = q.id;
  perform public._village_add(me, 'coin', (q.content->>'coin')::bigint);
  perform public._village_add_exp(me, (q.content->>'exp')::bigint);
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_daily_claim(int) from public, anon;
grant execute on function public.village_daily_claim(int) to authenticated;
