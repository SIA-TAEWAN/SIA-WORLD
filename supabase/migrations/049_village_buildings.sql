-- 049: 시아마을 4단계 — 나머지 일반 건물 (장터 · 채석장 · 방앗간 · 장독대) · 장식물 · 길 · 보관함
--   047_village.sql 의 함수를 다시 정의한다 (뒤 파일의 정의가 실제 값: games/village/tests/sql.test.ts 가 이 파일도 읽는다).
--   · 건물 값에 돌 · 엽전 칸이 생겼다 (_village_types 의 모양이 바뀌어 지우고 다시 만든다). 업그레이드의 돌은 건물 레벨 stone_from 부터
--   · 장터: 자원을 엽전으로 판다. 시세는 서버 날짜(한국 시간)로 서버가 정하고, 하루에 벌 수 있는 엽전에 한도가 있다 (village_sell)
--   · 방앗간 · 장독대: 재료를 넣고 기다리면 떡 · 특산품이 나온다 (village_craft → 다 끝나면 village_harvest 로 거둔다. 상태 'working')
--   · 장식물 · 길: 엽전으로 바로 놓는다 (건설 슬롯을 쓰지 않는다. 번영도 점수는 값만 정해 두고 계산은 7단계)
--   · 보관함: 건물 · 장식물을 넣었다(village_store) 다시 놓는다(village_place). 상태 'stored', 자리는 비운다
--   · 마을 목표를 마을 레벨 30 까지 이었다 (보상에 돌 · 엽전 칸. 종류 sell · craft · deco 추가)
--   · 특별 건물 3종 · 주민 선물 장식물의 줄도 표에 넣어 두었다 — 사는 함수는 050, 선물은 051 (여기서는 지을 수 없다)
-- 규칙은 047 과 같다: 모든 함수는 먼저 내 마을 줄을 잠그고, 잠근 뒤의 시각으로, 끝난 짓기부터 마무리한 다음 계산한다.

-- ---------- 1. 표 고치기 ----------

-- 보관함에 든 건물은 자리가 없다
alter table public.village_buildings alter column x drop not null;
alter table public.village_buildings alter column y drop not null;
alter table public.village_buildings drop constraint if exists village_buildings_state_check;
alter table public.village_buildings add constraint village_buildings_state_check check (state in ('building', 'upgrading', 'done', 'working', 'stored'));
alter table public.village_buildings drop constraint if exists village_buildings_spot_check;
alter table public.village_buildings add constraint village_buildings_spot_check check (state = 'stored' or (x is not null and y is not null));
alter table public.village_buildings drop constraint if exists village_buildings_user_id_x_y_key;
create unique index if not exists village_buildings_spot_idx on public.village_buildings (user_id, x, y) where state <> 'stored';
-- 가공 중인 개수 (방앗간 · 장독대)
alter table public.village_buildings add column if not exists job_n int not null default 0 check (job_n >= 0);
-- 장터: 마지막으로 판 날(한국 시간 2026-01-01 부터 센 날 수)과 그날 번 엽전
alter table public.village_profiles add column if not exists market_day int not null default 0;
alter table public.village_profiles add column if not exists market_sold int not null default 0 check (market_sold >= 0);
-- 특산품 (resources 의 'special'. 없는 줄은 0 으로 읽는다)
alter table public.village_profiles drop constraint if exists village_profiles_special_ok;
alter table public.village_profiles add constraint village_profiles_special_ok check (coalesce((resources->>'special')::bigint, 0) >= 0);

-- ---------- 2. 수치 (games/village/src/data) ----------

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
  end
$$;
revoke all on function public._village_const(text) from public, anon, authenticated;

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
    when 'market_limit' then array[300, 450, 650, 900, 1200, 1600, 2100, 2700, 3400, 4200]
  end
$$;
revoke all on function public._village_table(text) from public, anon, authenticated;

-- 건물 · 장식물 · 길: 종류, 갈래(main 일반 · special 특별 · deco 장식물 · road 길), 칸(가로·세로), 짓는 값(쌀 · 나무 · 돌 · 엽전 · 시아코인),
-- 업그레이드 돌의 기준, 짓는 시간(초. 0 이면 바로), 만드는 자원('' = 없음), 레벨 1의 시간당 생산량, 다 지었을 때의 경험치,
-- 개수(0 이면 unlock 의 길이가 최대 개수, 아니면 unlock[1] 레벨부터 이 개수까지), 번영도 점수, n번째가 열리는 마을 레벨.
-- games/village/src/data/buildings.ts
drop function if exists public._village_types();
create or replace function public._village_types() returns table (type text, kind text, w int, h int, rice int, wood int, stone int, coin int, sia int, up_stone int, build_sec int, product text, rate int, build_exp int, cap int, points int, unlock int[])
language sql immutable as $$
  values
    ('hall', 'main', 2, 2, 40, 40, 0, 0, 0, 30, 0, '', 0, 0, 0, 0, array[1]),
    ('paddy', 'main', 1, 1, 5, 10, 0, 0, 0, 5, 10, 'rice', 60, 10, 0, 0, array[1, 1, 3, 5, 7, 10, 13, 17]),
    ('house', 'main', 1, 1, 10, 20, 0, 0, 0, 5, 30, '', 0, 15, 0, 0, array[1, 2, 3, 5, 7, 9, 11, 13, 15, 18, 21, 24]),
    ('lumber', 'main', 1, 1, 30, 10, 0, 0, 0, 5, 20, 'wood', 40, 12, 0, 0, array[2, 2, 4, 6, 8, 11, 14, 18]),
    ('storage', 'main', 1, 1, 30, 40, 0, 0, 0, 10, 60, '', 0, 20, 0, 0, array[2, 4, 7, 10, 14, 18]),
    ('market', 'main', 1, 1, 60, 60, 0, 0, 0, 10, 120, '', 0, 30, 0, 0, array[3]),
    ('quarry', 'main', 1, 1, 50, 50, 0, 0, 0, 5, 60, 'stone', 30, 25, 0, 0, array[4, 4, 6, 9, 12, 16, 20]),
    ('mill', 'main', 1, 1, 40, 80, 20, 0, 0, 10, 180, '', 0, 40, 0, 0, array[5, 8, 12, 16]),
    ('jar', 'main', 1, 1, 0, 100, 60, 50, 0, 15, 300, '', 0, 60, 0, 0, array[8, 12, 17]),
    ('pavilion', 'special', 2, 2, 100, 100, 0, 0, 20, 20, 600, '', 0, 150, 0, 20, array[6]),
    ('feast', 'special', 2, 2, 150, 150, 50, 0, 40, 20, 1800, '', 0, 300, 0, 40, array[10]),
    ('shrine', 'special', 2, 2, 200, 200, 100, 0, 60, 30, 3600, '', 0, 600, 0, 80, array[14]),
    ('tree', 'deco', 1, 1, 0, 0, 0, 20, 0, 0, 0, '', 0, 2, 12, 1, array[1]),
    ('haystack', 'deco', 1, 1, 0, 0, 0, 50, 0, 0, 0, '', 0, 4, 6, 2, array[2]),
    ('flower', 'deco', 1, 1, 0, 0, 0, 30, 0, 0, 0, '', 0, 2, 12, 1, array[2]),
    ('scarecrow', 'deco', 1, 1, 0, 0, 0, 60, 0, 0, 0, '', 0, 4, 4, 2, array[3]),
    ('stonewall', 'deco', 1, 1, 0, 0, 0, 40, 0, 0, 0, '', 0, 4, 16, 2, array[3]),
    ('bench', 'deco', 1, 1, 0, 0, 0, 120, 0, 0, 0, '', 0, 8, 4, 4, array[4]),
    ('lantern', 'deco', 1, 1, 0, 0, 0, 80, 0, 0, 0, '', 0, 6, 8, 3, array[5]),
    ('well', 'deco', 1, 1, 0, 0, 0, 200, 0, 0, 0, '', 0, 12, 2, 6, array[6]),
    ('jangseung', 'deco', 1, 1, 0, 0, 0, 150, 0, 0, 0, '', 0, 10, 4, 5, array[7]),
    ('sotdae', 'deco', 1, 1, 0, 0, 0, 250, 0, 0, 0, '', 0, 12, 4, 6, array[8]),
    ('pond', 'deco', 1, 1, 0, 0, 0, 300, 0, 0, 0, '', 0, 16, 2, 8, array[9]),
    ('stonetower', 'deco', 1, 1, 0, 0, 0, 400, 0, 0, 0, '', 0, 20, 2, 10, array[12]),
    ('road', 'road', 1, 1, 0, 0, 0, 5, 0, 0, 0, '', 0, 0, 80, 0, array[1]),
    ('gift_rat', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_ox', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_tiger', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_rabbit', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_dragon', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_snake', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_horse', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_sheep', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_monkey', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_rooster', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_dog', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_pig', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99])
$$;
revoke all on function public._village_types() from public, anon, authenticated;

-- 가공: 건물, 재료 1 · 개수, 재료 2('' = 없음) · 개수, 나오는 것, 하나를 만드는 시간(초, 레벨 1), 하나의 경험치, 한 번에 넣는 개수 = base + per × (레벨 − 1)
-- games/village/src/data/buildings.ts 의 RECIPES
create or replace function public._village_recipes() returns table (type text, in1 text, n1 int, in2 text, n2 int, out_res text, sec int, exp int, base int, per int)
language sql immutable as $$
  values
    ('mill', 'rice', 3, '', 0, 'cake', 120, 1, 10, 10),
    ('jar', 'cake', 3, 'rice', 10, 'special', 3600, 15, 2, 1)
$$;
revoke all on function public._village_recipes() from public, anon, authenticated;

-- 장터에서 파는 자원: 100개의 기준 값(엽전), 시세를 가르는 번호. games/village/src/data/balance.ts 의 PRICES
create or replace function public._village_prices() returns table (res text, base int, idx int)
language sql immutable as $$
  values
    ('rice', 40, 1),
    ('wood', 50, 2),
    ('stone', 90, 3),
    ('cake', 300, 4),
    ('special', 4000, 5)
$$;
revoke all on function public._village_prices() from public, anon, authenticated;

-- 마을 목표: 번호, 종류, 건물, n, 보상(쌀 · 나무 · 돌 · 엽전 · 경험치)
--   build 그 건물 n채 · upgrade 그 건물 레벨 n · level 마을 레벨 n · deco 장식물 n개 (보관함 포함)
--   harvest 수확 n번 · sell 엽전 n닢어치 팔기 · craft 그 건물에서 만든 것 n개 거두기 (이 셋은 그 목표가 시작된 뒤부터 센다)
-- games/village/src/data/goals.ts
drop function if exists public._village_goals();
create or replace function public._village_goals() returns table (idx int, kind text, type text, n int, rice int, wood int, stone int, coin int, exp int)
language sql immutable as $$
  values
    (0, 'build', 'paddy', 1, 35, 35, 0, 0, 10),
    (1, 'build', 'house', 1, 35, 35, 0, 0, 10),
    (2, 'harvest', '', 1, 35, 35, 0, 0, 10),
    (3, 'build', 'paddy', 2, 35, 35, 0, 0, 10),
    (4, 'level', '', 2, 70, 70, 0, 0, 0),
    (5, 'build', 'lumber', 1, 50, 50, 0, 0, 10),
    (6, 'build', 'storage', 1, 50, 50, 0, 0, 10),
    (7, 'upgrade', 'hall', 2, 50, 50, 0, 0, 10),
    (8, 'upgrade', 'paddy', 2, 50, 50, 0, 0, 10),
    (9, 'build', 'house', 2, 50, 50, 0, 0, 10),
    (10, 'harvest', '', 5, 50, 50, 0, 0, 10),
    (11, 'level', '', 3, 100, 100, 0, 0, 0),
    (12, 'build', 'market', 1, 65, 65, 0, 15, 20),
    (13, 'sell', '', 20, 65, 65, 0, 15, 20),
    (14, 'build', 'paddy', 3, 65, 65, 0, 15, 20),
    (15, 'upgrade', 'lumber', 2, 65, 65, 0, 15, 20),
    (16, 'level', '', 4, 130, 130, 0, 30, 0),
    (17, 'build', 'quarry', 1, 80, 80, 0, 20, 30),
    (18, 'build', 'lumber', 3, 80, 80, 0, 20, 30),
    (19, 'upgrade', 'hall', 3, 80, 80, 0, 20, 30),
    (20, 'upgrade', 'storage', 2, 80, 80, 0, 20, 30),
    (21, 'deco', '', 2, 80, 80, 0, 20, 30),
    (22, 'level', '', 5, 160, 160, 0, 40, 0),
    (23, 'build', 'mill', 1, 95, 95, 25, 25, 45),
    (24, 'craft', 'mill', 5, 95, 95, 25, 25, 45),
    (25, 'build', 'paddy', 4, 95, 95, 25, 25, 45),
    (26, 'upgrade', 'paddy', 3, 95, 95, 25, 25, 45),
    (27, 'harvest', '', 20, 95, 95, 25, 25, 45),
    (28, 'level', '', 6, 190, 190, 50, 50, 0),
    (29, 'upgrade', 'hall', 4, 110, 110, 30, 30, 60),
    (30, 'build', 'quarry', 3, 110, 110, 30, 30, 60),
    (31, 'upgrade', 'lumber', 3, 110, 110, 30, 30, 60),
    (32, 'sell', '', 100, 110, 110, 30, 30, 60),
    (33, 'level', '', 7, 220, 220, 60, 60, 0),
    (34, 'build', 'paddy', 5, 125, 125, 35, 35, 80),
    (35, 'build', 'storage', 3, 125, 125, 35, 35, 80),
    (36, 'upgrade', 'paddy', 4, 125, 125, 35, 35, 80),
    (37, 'craft', 'mill', 20, 125, 125, 35, 35, 80),
    (38, 'level', '', 8, 250, 250, 70, 70, 0),
    (39, 'build', 'jar', 1, 140, 140, 40, 40, 100),
    (40, 'craft', 'jar', 2, 140, 140, 40, 40, 100),
    (41, 'build', 'mill', 2, 140, 140, 40, 40, 100),
    (42, 'upgrade', 'quarry', 4, 140, 140, 40, 40, 100),
    (43, 'level', '', 9, 280, 280, 80, 80, 0),
    (44, 'upgrade', 'hall', 5, 155, 155, 45, 45, 125),
    (45, 'upgrade', 'storage', 4, 155, 155, 45, 45, 125),
    (46, 'deco', '', 6, 155, 155, 45, 45, 125),
    (47, 'sell', '', 300, 155, 155, 45, 45, 125),
    (48, 'level', '', 10, 310, 310, 90, 90, 0),
    (49, 'build', 'paddy', 6, 170, 170, 50, 50, 150),
    (50, 'upgrade', 'paddy', 5, 170, 170, 50, 50, 150),
    (51, 'upgrade', 'mill', 3, 170, 170, 50, 50, 150),
    (52, 'craft', 'jar', 5, 170, 170, 50, 50, 150),
    (53, 'level', '', 11, 340, 340, 100, 100, 0),
    (54, 'build', 'lumber', 6, 185, 185, 55, 55, 185),
    (55, 'upgrade', 'lumber', 5, 185, 185, 55, 55, 185),
    (56, 'harvest', '', 40, 185, 185, 55, 55, 185),
    (57, 'level', '', 12, 370, 370, 110, 110, 0),
    (58, 'upgrade', 'hall', 6, 200, 200, 60, 60, 240),
    (59, 'build', 'mill', 3, 200, 200, 60, 60, 240),
    (60, 'build', 'jar', 2, 200, 200, 60, 60, 240),
    (61, 'upgrade', 'quarry', 5, 200, 200, 60, 60, 240),
    (62, 'level', '', 13, 400, 400, 120, 120, 0),
    (63, 'build', 'paddy', 7, 215, 215, 65, 65, 295),
    (64, 'upgrade', 'paddy', 6, 215, 215, 65, 65, 295),
    (65, 'sell', '', 600, 215, 215, 65, 65, 295),
    (66, 'level', '', 14, 430, 430, 130, 130, 0),
    (67, 'build', 'storage', 5, 230, 230, 70, 70, 355),
    (68, 'upgrade', 'storage', 5, 230, 230, 70, 70, 355),
    (69, 'deco', '', 10, 230, 230, 70, 70, 355),
    (70, 'level', '', 15, 460, 460, 140, 140, 0),
    (71, 'upgrade', 'hall', 7, 245, 245, 75, 75, 420),
    (72, 'upgrade', 'lumber', 6, 245, 245, 75, 75, 420),
    (73, 'craft', 'mill', 60, 245, 245, 75, 75, 420),
    (74, 'level', '', 16, 490, 490, 150, 150, 0),
    (75, 'build', 'quarry', 6, 260, 260, 80, 80, 495),
    (76, 'build', 'mill', 4, 260, 260, 80, 80, 495),
    (77, 'upgrade', 'paddy', 7, 260, 260, 80, 80, 495),
    (78, 'level', '', 17, 520, 520, 160, 160, 0),
    (79, 'build', 'paddy', 8, 275, 275, 85, 85, 575),
    (80, 'build', 'jar', 3, 275, 275, 85, 85, 575),
    (81, 'craft', 'jar', 10, 275, 275, 85, 85, 575),
    (82, 'level', '', 18, 550, 550, 170, 170, 0),
    (83, 'build', 'lumber', 8, 290, 290, 90, 90, 660),
    (84, 'build', 'storage', 6, 290, 290, 90, 90, 660),
    (85, 'upgrade', 'quarry', 7, 290, 290, 90, 90, 660),
    (86, 'level', '', 19, 580, 580, 180, 180, 0),
    (87, 'upgrade', 'hall', 8, 305, 305, 95, 95, 755),
    (88, 'upgrade', 'paddy', 8, 305, 305, 95, 95, 755),
    (89, 'sell', '', 1200, 305, 305, 95, 95, 755),
    (90, 'level', '', 20, 610, 610, 190, 190, 0),
    (91, 'build', 'quarry', 7, 320, 320, 100, 100, 860),
    (92, 'upgrade', 'lumber', 8, 320, 320, 100, 100, 860),
    (93, 'deco', '', 14, 320, 320, 100, 100, 860),
    (94, 'level', '', 21, 640, 640, 200, 200, 0),
    (95, 'upgrade', 'storage', 8, 335, 335, 105, 105, 970),
    (96, 'upgrade', 'mill', 8, 335, 335, 105, 105, 970),
    (97, 'harvest', '', 100, 335, 335, 105, 105, 970),
    (98, 'level', '', 22, 670, 670, 210, 210, 0),
    (99, 'upgrade', 'market', 8, 350, 350, 110, 110, 1095),
    (100, 'craft', 'jar', 20, 350, 350, 110, 110, 1095),
    (101, 'sell', '', 2000, 350, 350, 110, 110, 1095),
    (102, 'level', '', 23, 700, 700, 220, 220, 0),
    (103, 'upgrade', 'hall', 9, 365, 365, 115, 115, 1225),
    (104, 'upgrade', 'paddy', 9, 365, 365, 115, 115, 1225),
    (105, 'upgrade', 'lumber', 9, 365, 365, 115, 115, 1225),
    (106, 'level', '', 24, 730, 730, 230, 230, 0),
    (107, 'upgrade', 'quarry', 9, 380, 380, 120, 120, 1360),
    (108, 'upgrade', 'jar', 9, 380, 380, 120, 120, 1360),
    (109, 'craft', 'mill', 150, 380, 380, 120, 120, 1360),
    (110, 'level', '', 25, 760, 760, 240, 240, 0),
    (111, 'upgrade', 'storage', 9, 395, 395, 125, 125, 1510),
    (112, 'upgrade', 'mill', 9, 395, 395, 125, 125, 1510),
    (113, 'sell', '', 3000, 395, 395, 125, 125, 1510),
    (114, 'level', '', 26, 790, 790, 250, 250, 0),
    (115, 'upgrade', 'market', 9, 410, 410, 130, 130, 1670),
    (116, 'deco', '', 18, 410, 410, 130, 130, 1670),
    (117, 'harvest', '', 200, 410, 410, 130, 130, 1670),
    (118, 'level', '', 27, 820, 820, 260, 260, 0),
    (119, 'upgrade', 'hall', 10, 425, 425, 135, 135, 1835),
    (120, 'upgrade', 'paddy', 10, 425, 425, 135, 135, 1835),
    (121, 'upgrade', 'lumber', 10, 425, 425, 135, 135, 1835),
    (122, 'level', '', 28, 850, 850, 270, 270, 0),
    (123, 'upgrade', 'quarry', 10, 440, 440, 140, 140, 2015),
    (124, 'upgrade', 'storage', 10, 440, 440, 140, 140, 2015),
    (125, 'craft', 'jar', 40, 440, 440, 140, 140, 2015),
    (126, 'level', '', 29, 880, 880, 280, 280, 0),
    (127, 'upgrade', 'mill', 10, 455, 455, 145, 145, 2200),
    (128, 'upgrade', 'jar', 10, 455, 455, 145, 145, 2200),
    (129, 'upgrade', 'market', 10, 455, 455, 145, 145, 2200),
    (130, 'level', '', 30, 910, 910, 290, 290, 0)
$$;
revoke all on function public._village_goals() from public, anon, authenticated;

-- ---------- 3. 안에서만 쓰는 도구 ----------

-- 서버 날짜: 한국 시간 2026-01-01 부터 센 날 수
create or replace function public._village_kst_day(p_at timestamptz) returns int
language sql immutable as $$
  select ((p_at at time zone 'Asia/Seoul')::date - date '2026-01-01')::int
$$;
revoke all on function public._village_kst_day(timestamptz) from public, anon, authenticated;

-- 그날의 시세 (%): 날짜와 자원 번호로 정해진다 (화면도 같은 식으로 미리 보여 준다)
create or replace function public._village_price_pct(p_day int, p_idx int) returns int
language sql immutable as $$
  select public._village_const('price_min_pct')::int
    + (((p_day::bigint * 7919 + p_idx * 104729 + 12345) % public._village_const('price_span')::int + public._village_const('price_span')::int) % public._village_const('price_span')::int)::int
$$;
revoke all on function public._village_price_pct(int, int) from public, anon, authenticated;

-- 자원 하나의 양 (없는 칸은 0)
create or replace function public._village_res(p_user uuid, p_res text) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select (resources->>p_res)::bigint from public.village_profiles where user_id = p_user), 0)
$$;
revoke all on function public._village_res(uuid, text) from public, anon, authenticated;

-- 자원을 더한다 (음수면 뺀다. 모자라면 'not enough')
create or replace function public._village_add(p_user uuid, p_res text, p_n bigint) returns void
language plpgsql security definer set search_path = public as $$
declare cur bigint := public._village_res(p_user, p_res);
begin
  if p_n = 0 then return; end if;
  if cur + p_n < 0 then raise exception 'not enough'; end if;
  update public.village_profiles set resources = jsonb_set(resources, array[p_res], to_jsonb(cur + p_n)), updated_at = now() where user_id = p_user;
end $$;
revoke all on function public._village_add(uuid, text, bigint) from public, anon, authenticated;

-- 값을 낸다: 하나라도 모자라면 아무것도 내지 않고 'not enough'
create or replace function public._village_spend(p_user uuid, p_rice bigint, p_wood bigint, p_stone bigint, p_coin bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public._village_res(p_user, 'rice') < p_rice or public._village_res(p_user, 'wood') < p_wood
    or public._village_res(p_user, 'stone') < p_stone or public._village_res(p_user, 'coin') < p_coin then raise exception 'not enough'; end if;
  perform public._village_add(p_user, 'rice', -p_rice);
  perform public._village_add(p_user, 'wood', -p_wood);
  perform public._village_add(p_user, 'stone', -p_stone);
  perform public._village_add(p_user, 'coin', -p_coin);
end $$;
revoke all on function public._village_spend(uuid, bigint, bigint, bigint, bigint) from public, anon, authenticated;

-- 지금 목표가 그 종류를 세고 있으면 횟수를 더한다 (harvest · sell · craft)
create or replace function public._village_progress(p_user uuid, p_kind text, p_type text, p_n bigint) returns void
language sql security definer set search_path = public as $$
  update public.village_profiles p set goal_progress = goal_progress + p_n
  where p.user_id = p_user and p_n > 0
    and exists (select 1 from public._village_goals() g where g.idx = p.goal and g.kind = p_kind and g.kind in ('harvest', 'sell', 'craft') and (g.type = '' or g.type = p_type))
$$;
revoke all on function public._village_progress(uuid, text, text, bigint) from public, anon, authenticated;

-- 끝난 짓기 · 업그레이드를 마무리한다 (가공 중 · 보관함은 건드리지 않는다)
create or replace function public._village_settle(p_user uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; e bigint;
begin
  for b in select * from public.village_buildings where user_id = p_user and state in ('building', 'upgrading') and finish_at <= p_now order by finish_at, created_at, id loop
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

-- 창고 용량: 마을 회관 + 놓여 있는 창고들 (짓는 중 · 보관함은 빼고)
create or replace function public._village_cap(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select (public._village_table('hall_cap'))[public._village_hall_level(p_user)]::bigint
    + coalesce((select sum((public._village_table('storage_cap'))[b.level]) from public.village_buildings b
                where b.user_id = p_user and b.type = 'storage' and b.state not in ('building', 'stored')), 0)::bigint
$$;
revoke all on function public._village_cap(uuid) from public, anon, authenticated;

-- 건설 슬롯이 남았나 (짓는 중 + 업그레이드 중 < 슬롯 수)
create or replace function public._village_slot_free(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.village_buildings where user_id = p_user and state in ('building', 'upgrading'))
    < public._village_const('base_slots')::int
      + case when public._village_hall_level(p_user) >= public._village_const('slots3_hall') then 1 else 0 end
$$;
revoke all on function public._village_slot_free(uuid) from public, anon, authenticated;

-- 그 자리에 놓을 수 있나 (보관함에 든 것은 자리를 차지하지 않는다)
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
    where b.user_id = p_user and b.state <> 'stored' and (p_ignore is null or b.id <> p_ignore)
      and b.x < p_x + ty.w and b.x + o.w > p_x and b.y < p_y + ty.h and b.y + o.h > p_y
  ) then return 'occupied'; end if;
  return null;
end $$;
revoke all on function public._village_place_error(uuid, text, int, int, uuid) from public, anon, authenticated;

-- 건물 하나를 거둔다: 건물은 비워진다. 창고에 들어가는 만큼만 담고 넘친 것은 버린다 (엽전 · 특산품은 용량 제한이 없다)
--   생산 건물: 쌓인 양 = floor(지난 초 × 시간당 ÷ 3600), 최대 12시간 분량
--   가공 건물(상태 'working'): 묶음이 다 끝났으면 그 개수
--   got 창고에 들어간 양 · have 쌓여 있던 양 · product 자원 · job_exp 가공 경험치(생산이면 0) · is_job 가공이었나
drop function if exists public._village_collect(uuid, uuid, timestamptz, bigint);
create or replace function public._village_collect(p_user uuid, p_id uuid, p_now timestamptz, p_cap bigint,
  out got bigint, out have bigint, out product text, out job_exp bigint, out is_job boolean)
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; ty record; rc record; rate bigint; frm timestamptz; cur bigint; room bigint;
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
  rate := ty.rate * (public._village_table('rate_mul'))[b.level] / 10;
  frm := greatest(b.last_collected_at, p_now - make_interval(secs => public._village_const('prod_cap_sec')::double precision));
  have := greatest(0, floor(extract(epoch from (p_now - frm)))::bigint) * rate / 3600;
  if have <= 0 then have := 0; return; end if;
  product := ty.product;
  cur := public._village_res(p_user, product);
  room := case when product in ('rice', 'wood', 'stone', 'cake') then p_cap - cur else have end;
  got := greatest(0, least(have, room));
  perform public._village_add(p_user, product, got);
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
    when 'deco' then (select count(*) from public.village_buildings b join public._village_types() t on t.type = b.type where b.user_id = p_user and t.kind = 'deco')::int
    when 'level' then p.level
    else p.goal_progress
  end;
end $$;
revoke all on function public._village_goal_have(uuid) from public, anon, authenticated;

-- 화면에 보내는 마을 모양 (시각은 ms). now = 서버 시각
create or replace function public._village_state_json(p_user uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', public._village_ms(p_now),
    'profile', jsonb_build_object(
      'name', p.village_name, 'level', p.level, 'exp', p.exp,
      'resources', jsonb_build_object('special', 0) || p.resources, 'landStage', p.land_stage,
      'prosperity', p.prosperity, 'goal', p.goal, 'goalProgress', p.goal_progress,
      'marketDay', p.market_day, 'marketSold', p.market_sold),
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'level', b.level, 'x', coalesce(b.x, 0), 'y', coalesce(b.y, 0), 'state', b.state,
        'finishAt', public._village_ms(b.finish_at), 'startAt', public._village_ms(b.started_at),
        'collectedAt', public._village_ms(b.last_collected_at), 'jobN', b.job_n) order by b.created_at, b.id)
      from public.village_buildings b where b.user_id = p_user), '[]'::jsonb))
  from public.village_profiles p where p.user_id = p_user
$$;
revoke all on function public._village_state_json(uuid, timestamptz) from public, anon, authenticated;

-- ---------- 4. 화면이 부르는 함수 ----------

-- 짓기: 해금 · 개수 제한 · 건설 슬롯(짓는 시간이 0 이면 쓰지 않는다) · 자리 · 값을 확인하고 짓기 시작한다
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
  -- 시아코인으로 사는 특별 건물은 따로 산다 (050)
  if ty.sia > 0 then raise exception 'locked'; end if;
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
  insert into public.village_buildings (user_id, type, x, y, state, started_at, finish_at, last_collected_at)
  values (me, p_type, p_x, p_y, 'building', t, t + make_interval(secs => ty.build_sec), t)
  returning id into new_id;
  -- 0초짜리(장식물 · 길)는 바로 끝난다
  perform public._village_settle(me, t);
  return public._village_state_json(me, t) || jsonb_build_object('id', new_id);
end $$;
revoke all on function public.village_build(text, int, int) from public, anon;
grant execute on function public.village_build(text, int, int) to authenticated;

-- 옮기기 (비용 없음. 보관함에 든 것은 village_place 로 놓는다)
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
  if b.state = 'stored' then raise exception 'stored'; end if;
  why := public._village_place_error(me, b.type, p_x, p_y, b.id);
  if why is not null then raise exception '%', why; end if;
  update public.village_buildings set x = p_x, y = p_y where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_move(uuid, int, int) from public, anon;
grant execute on function public.village_move(uuid, int, int) to authenticated;

-- 수확: 건물 여러 채를 한꺼번에. 생산 건물과 다 끝난 가공을 거둔다
--   답의 harvest = { per: { 건물 id: 창고에 들어간 양 }, gained: { 자원: 양 }, exp, lost: 창고가 가득 차서 버린 양 }
--   경험치 = 생산으로 쌓여 있던 양 ÷ harvest_exp_div + 가공한 개수 × 그 가공의 경험치
create or replace function public.village_harvest(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; cap bigint; bid uuid; c record; btype text;
  per jsonb := '{}'::jsonb; gained jsonb := '{}'::jsonb; total bigint := 0; jexp bigint := 0; lost bigint := 0; e bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > public._village_const('harvest_max') then raise exception 'bad request'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  cap := public._village_cap(me);
  -- 보낸 순서대로 (같은 건물이 여러 번 있어도 한 번만)
  for bid in select u from unnest(p_ids) with ordinality as x(u, n) where u is not null group by u order by min(n) loop
    select type into btype from public.village_buildings where id = bid and user_id = me;
    select * into c from public._village_collect(me, bid, t, cap);
    continue when c.have <= 0;
    per := per || jsonb_build_object(bid::text, c.got);
    if c.got > 0 then gained := gained || jsonb_build_object(c.product, coalesce((gained->>c.product)::bigint, 0) + c.got); end if;
    lost := lost + c.have - c.got;
    if c.is_job then
      jexp := jexp + c.job_exp;
      perform public._village_progress(me, 'craft', btype, c.have);
    else
      total := total + c.have;
    end if;
    perform public._village_progress(me, 'harvest', '', 1);
  end loop;
  e := total / public._village_const('harvest_exp_div')::int + jexp;
  perform public._village_add_exp(me, e);
  return public._village_state_json(me, t) || jsonb_build_object('harvest', jsonb_build_object('per', per, 'gained', gained, 'exp', e, 'lost', lost));
end $$;
revoke all on function public.village_harvest(uuid[]) from public, anon;
grant execute on function public.village_harvest(uuid[]) to authenticated;

-- 업그레이드: 일반 · 특별 건물만, 최대 10레벨. 마을 회관은 마을 레벨(hall_need)이, 다른 건물은 마을 회관 레벨이 상한이다
--   값 = 짓는 값(쌀 · 나무) × cost_mul ÷ 10, 건물 레벨이 stone_from 이상이면 돌(up_stone × cost_mul ÷ 10)도 든다
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
  perform public._village_collect(me, b.id, t, public._village_cap(me));
  perform public._village_spend(me, ty.rice * m / 10, ty.wood * m / 10, st, 0);
  sec := (public._village_table('upgrade_sec'))[b.level] * case when b.type = 'hall' then public._village_const('hall_sec_mul')::int else 1 end;
  update public.village_buildings set state = 'upgrading', started_at = t, finish_at = t + make_interval(secs => sec) where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_upgrade(uuid) from public, anon;
grant execute on function public.village_upgrade(uuid) to authenticated;

-- 가공 시작 (방앗간 · 장독대): 재료를 내고 n개를 만든다. 다 끝나면 수확으로 거둔다
--   한 번에 넣는 개수 = base + per × (레벨 − 1), 하나를 만드는 시간 = sec × 10 ÷ rate_mul[레벨]
create or replace function public.village_craft(p_id uuid, p_n int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; rc record; unit int;
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
  unit := rc.sec * 10 / (public._village_table('rate_mul'))[b.level];
  update public.village_buildings set state = 'working', job_n = p_n, started_at = t, finish_at = t + make_interval(secs => p_n * unit) where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_craft(uuid, int) from public, anon;
grant execute on function public.village_craft(uuid, int) to authenticated;

-- 장터에서 팔기: 받는 엽전 = floor(개수 × 기준 값 × 오늘 시세(%) ÷ 10000). 시세는 서버 날짜로 정해진다
--   하루에 벌 수 있는 엽전은 장터 레벨의 market_limit 까지 (넘으면 'sell limit'). 답의 sold = 받은 엽전
create or replace function public.village_sell(p_res text, p_n int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; m public.village_buildings; pr record; p public.village_profiles; day int; sold bigint; coins bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into m from public.village_buildings where user_id = me and type = 'market' and state = 'done' limit 1;
  if not found then raise exception 'no market'; end if;
  select * into pr from public._village_prices() x where x.res = p_res;
  if not found then raise exception 'bad resource'; end if;
  if p_n is null or p_n < 1 or p_n > 1000000 then raise exception 'bad count'; end if;
  if public._village_res(me, p_res) < p_n then raise exception 'not enough'; end if;
  select * into p from public.village_profiles where user_id = me;
  day := public._village_kst_day(t);
  sold := case when p.market_day = day then p.market_sold else 0 end;
  coins := p_n::bigint * pr.base * public._village_price_pct(day, pr.idx) / 10000;
  if coins < 1 then raise exception 'too few'; end if;
  if sold + coins > (public._village_table('market_limit'))[m.level] then raise exception 'sell limit'; end if;
  perform public._village_add(me, p_res, -p_n);
  perform public._village_add(me, 'coin', coins);
  update public.village_profiles set market_day = day, market_sold = sold + coins where user_id = me;
  perform public._village_progress(me, 'sell', '', coins);
  return public._village_state_json(me, t) || jsonb_build_object('sold', coins);
end $$;
revoke all on function public.village_sell(text, int) from public, anon;
grant execute on function public.village_sell(text, int) to authenticated;

-- 보관함에 넣기 (마을 회관은 안 된다. 쌓여 있던 것은 먼저 거둔다. 자리는 비운다)
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
  perform public._village_collect(me, b.id, t, public._village_cap(me));
  update public.village_buildings set state = 'stored', x = null, y = null where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_store(uuid) from public, anon;
grant execute on function public.village_store(uuid) to authenticated;

-- 보관함에서 꺼내 놓기 (생산은 놓은 순간부터 다시 쌓인다)
create or replace function public.village_place(p_id uuid, p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; why text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  if b.state <> 'stored' then raise exception 'not stored'; end if;
  why := public._village_place_error(me, b.type, p_x, p_y, b.id);
  if why is not null then raise exception '%', why; end if;
  update public.village_buildings set state = 'done', x = p_x, y = p_y, last_collected_at = t where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_place(uuid, int, int) from public, anon;
grant execute on function public.village_place(uuid, int, int) to authenticated;

-- 마을 목표 보상 받기 (보상은 창고 용량을 넘겨도 받는다)
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
  perform public._village_add(me, 'rice', g.rice);
  perform public._village_add(me, 'wood', g.wood);
  perform public._village_add(me, 'stone', g.stone);
  perform public._village_add(me, 'coin', g.coin);
  update public.village_profiles set goal = p.goal + 1, goal_progress = 0, updated_at = now() where user_id = me;
  perform public._village_add_exp(me, g.exp);
  return public._village_state_json(me, t) || jsonb_build_object('claimed', p.goal);
end $$;
revoke all on function public.village_claim_goal() from public, anon;
grant execute on function public.village_claim_goal() to authenticated;
