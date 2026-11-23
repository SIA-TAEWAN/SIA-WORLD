-- 078: 시아열두길 (1인 실시간 액션 RPG) — games/twelve/PRD.md '저장과 서버'
--   twelve_profiles : 레벨·경험치·엽전·강화석·모드·대표 대원·가방 칸·물약·착용 장비 (본인만 읽기, 쓰기는 함수만)
--   twelve_items    : 가진 장비 (가방 + 보관함. box = 가방이 꽉 차서 보관함에 있다)
--   twelve_maps     : 모드·맵별 별(비트: 1 시간 · 2 안 쓰러짐 · 4 숨은 상자)·클리어 수·최고 시간
--   twelve_keys     : 모드별로 열쇠를 얻은 지형
--   twelve_pity     : 확정 보정 카운터 (모드·지형별: 레어 없이 잡은 정예 수·보스 수, 열쇠 없이 잡은 보스 수)
--   twelve_codex    : 얻어 본 레어·별 보상 ('아직 없는 것부터', 지형 화면의 레어 목록)
--   twelve_tower    : 끝없는 탑 최고 기록 (층 · 그 층까지 걸린 시간 · 그때 레벨·대원 · 날짜 · 체크포인트. 누구나 읽기 → twelve_tower_ranking)
--   twelve_runs     : 진행 중인 판 (시작 시각·드랍 씨앗·결과. 권한 없음: 함수로만 읽고 쓴다)
--   twelve_tower_runs : 진행 중인 끝없는 탑 판 (마지막으로 깬 층 · 논 시간 · 마지막 보고 시각. 권한 없음)
-- 대원은 따로 저장하지 않는다: 처음 3종 + 지형 보스(1~9지형)를 처음 잡은 기록(twelve_maps)에서 나온다. 고양이는 071 의 owned_characters.
--
-- 전투는 기기에서만 돌기 때문에 서버는 보고된 값을 그대로 믿지 않는다 (시아돌격대 061 과 같은 방식):
--   · 판은 twelve_start() 로 시작 시각·드랍 씨앗을 남긴 뒤에만 twelve_finish() 로 끝낼 수 있다 (주인만, 한 번만)
--   · 화면은 종류별로 잡은 요괴 수 · 시간 · 상자 · 쓰러진 횟수 · 쓴 물약만 보낸다. 맵별 최대치를 넘으면 거절
--   · 경험치·엽전은 서버가 맵 표(_twelve_maps)로 계산하고, 드랍은 판 씨앗으로 서버가 판정한다 (확정 보정·열쇠 포함)
--   · 서버가 잰 경과 시간이 보고한 판 시간보다 짧으면 거절, 이미 끝낸 다른 판과 시간이 겹치면 거절
--   · 맵 도중에 앱을 닫으면 그 판은 끝나지 않은 채로 남는다 = 쓰러진 것과 같다 (아무것도 받지 않는다)
-- 게임 쪽(games/twelve/src)과 같아야 하는 것:
--   · 표와 기준 값: `-- <gen:이름>` ~ `-- </gen:이름>` 사이는 games/twelve 의 `npm run sqlgen` 이 src/data 에서 만들어 넣는다.
--     손으로 고치지 말 것. tests/sql.test.ts 가 대조한다.
--   · 규칙: twelve_finish = src/game/progress.ts 의 checkReport · applyReport, 드랍 = src/game/drops.ts,
--     상점·대장간·착용 = src/game/rules.ts, 끝없는 탑(twelve_tower_start · _floor · _end) = src/game/tower.ts.
--     한쪽을 바꾸면 다른 쪽도 바꾼다 (scripts/pg-check.mjs 가 두 쪽 결과를 맞춰 본다).
-- 끝없는 탑: 층을 깰 때마다 twelve_tower_floor 로 보고한다. 앞 보고부터 서버가 잰 시간이 층에서 논 시간보다 짧거나
--   층 최소 시간보다 빨리 올라간 기록은 받지 않는다. 보상(엽전·강화석·장비)은 판 씨앗과 층 번호로 서버가 계산한다.
-- 시간 단위는 모두 초.

-- ---------- 1. 표 ----------

create table if not exists public.twelve_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  level int not null default 1 check (level between 1 and 99),
  exp bigint not null default 0 check (exp >= 0),
  coins bigint not null default 0 check (coins >= 0),
  stones int not null default 0 check (stones >= 0),
  mode text not null default 'normal' check (mode in ('normal', 'hard')),
  hero text not null default 'rat',
  bag int not null default 40,
  -- [[체력 소, 중, 대], [마력 소, 중, 대]]
  potions jsonb not null default '[[0,0,0],[0,0,0]]'::jsonb,
  eq_weapon bigint,
  eq_armor bigint,
  eq_acc bigint,
  -- 레벨 랭킹용: 깬 맵 수(다시 깬 것 제외) · 지금 레벨에 도달한 시각
  cleared_maps int not null default 0,
  level_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.twelve_profiles enable row level security;
drop policy if exists twelve_profiles_read_own on public.twelve_profiles;
create policy twelve_profiles_read_own on public.twelve_profiles for select using (auth.uid() = user_id);
revoke all on public.twelve_profiles from anon, authenticated;
grant select on public.twelve_profiles to authenticated;

create table if not exists public.twelve_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  base text not null,
  plus int not null default 0 check (plus between 0 and 9),
  locked boolean not null default false,
  box boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.twelve_items enable row level security;
drop policy if exists twelve_items_read_own on public.twelve_items;
create policy twelve_items_read_own on public.twelve_items for select using (auth.uid() = user_id);
revoke all on public.twelve_items from anon, authenticated;
grant select on public.twelve_items to authenticated;
create index if not exists twelve_items_user_idx on public.twelve_items (user_id, id);

create table if not exists public.twelve_maps (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('normal', 'hard')),
  map_id text not null,
  stars int not null default 0 check (stars between 0 and 7),
  clears int not null default 0,
  best int not null default 0,
  cleared_at timestamptz not null default now(),
  primary key (user_id, mode, map_id)
);
alter table public.twelve_maps enable row level security;
drop policy if exists twelve_maps_read_own on public.twelve_maps;
create policy twelve_maps_read_own on public.twelve_maps for select using (auth.uid() = user_id);
revoke all on public.twelve_maps from anon, authenticated;
grant select on public.twelve_maps to authenticated;

create table if not exists public.twelve_keys (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('normal', 'hard')),
  region int not null check (region between 1 and 12),
  got_at timestamptz not null default now(),
  primary key (user_id, mode, region)
);
alter table public.twelve_keys enable row level security;
drop policy if exists twelve_keys_read_own on public.twelve_keys;
create policy twelve_keys_read_own on public.twelve_keys for select using (auth.uid() = user_id);
revoke all on public.twelve_keys from anon, authenticated;
grant select on public.twelve_keys to authenticated;

create table if not exists public.twelve_pity (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('normal', 'hard')),
  region int not null check (region between 1 and 12),
  elite int not null default 0,
  boss int not null default 0,
  key int not null default 0,
  primary key (user_id, mode, region)
);
alter table public.twelve_pity enable row level security;
drop policy if exists twelve_pity_read_own on public.twelve_pity;
create policy twelve_pity_read_own on public.twelve_pity for select using (auth.uid() = user_id);
revoke all on public.twelve_pity from anon, authenticated;
grant select on public.twelve_pity to authenticated;

create table if not exists public.twelve_codex (
  user_id uuid not null references public.profiles(id) on delete cascade,
  base text not null,
  got_at timestamptz not null default now(),
  primary key (user_id, base)
);
alter table public.twelve_codex enable row level security;
drop policy if exists twelve_codex_read_own on public.twelve_codex;
create policy twelve_codex_read_own on public.twelve_codex for select using (auth.uid() = user_id);
revoke all on public.twelve_codex from anon, authenticated;
grant select on public.twelve_codex to authenticated;

-- 끝없는 탑: 각자 최고 기록 하나 (층 · 그 층까지 걸린 시간 · 그때 레벨·대원). 누구나 읽기, 쓰기는 함수만
-- 한 번 들어가면 1층을 못 깨도 줄이 생긴다 (best_floor 0). cps = 체크포인트: { "10": 보스 층을 깬 가장 빠른 누적 시간, "20": … }
create table if not exists public.twelve_tower (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  best_floor int not null default 0 check (best_floor >= 0),
  best_time int not null default 0 check (best_time >= 0),
  level int not null default 1,
  hero text not null default 'rat',
  achieved_at timestamptz not null default now(),
  cps jsonb not null default '{}'::jsonb
);
alter table public.twelve_tower enable row level security;
drop policy if exists twelve_tower_read on public.twelve_tower;
create policy twelve_tower_read on public.twelve_tower for select using (true);
revoke all on public.twelve_tower from anon, authenticated;
grant select on public.twelve_tower to anon, authenticated;
create index if not exists twelve_tower_rank_idx on public.twelve_tower (best_floor desc, best_time, achieved_at);

create table if not exists public.twelve_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  map_id text not null,
  mode text not null check (mode in ('normal', 'hard')),
  hero text not null,
  -- 드랍 씨앗 (0 ~ 2³¹-1) · 시작할 때의 레벨 · 엽전 획득 장신구 (%)
  seed int not null,
  level int not null,
  coin_pct int not null default 0,
  started_at timestamptz not null default now(),
  -- 끝나기 전에는 비어 있다
  finished_at timestamptz,
  time int,
  cleared boolean,
  exp int,
  coins int,
  report jsonb
);
alter table public.twelve_runs enable row level security;
-- 정책 없음 + 권한 없음: 함수(security definer)로만 읽고 쓴다
revoke all on public.twelve_runs from anon, authenticated;
create index if not exists twelve_runs_user_idx on public.twelve_runs (user_id, started_at desc);

-- 진행 중인 끝없는 탑 판. floor = 마지막으로 깬 층, played = 이 판에서 논 시간, base_time = 체크포인트에서 시작했을 때 더하는 시간
create table if not exists public.twelve_tower_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  hero text not null,
  seed int not null,
  coin_pct int not null default 0,
  start_floor int not null,
  floor int not null,
  base_time int not null default 0,
  played int not null default 0,
  started_at timestamptz not null default now(),
  -- 마지막 보고(처음에는 시작) 시각
  floor_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.twelve_tower_runs enable row level security;
-- 정책 없음 + 권한 없음: 함수(security definer)로만 읽고 쓴다
revoke all on public.twelve_tower_runs from anon, authenticated;
create index if not exists twelve_tower_runs_user_idx on public.twelve_tower_runs (user_id, started_at desc);

-- ---------- 2. 기준 값 · 표 (npm run sqlgen 이 채운다) ----------

create or replace function public._twelve_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
-- <gen:const>
    when 'max_level' then 99
    when 'max_time' then 3600
    when 'clear_min_time' then 20
    when 'time_slack' then 3
    when 'max_age' then 7200
    when 'coin_min_time' then 60
    when 'coin_level_gap' then 15
    when 'exit_pct' then 70
    when 'drop_potion' then 250
    when 'drop_gear' then 120
    when 'drop_elite_stone' then 3000
    when 'drop_elite_acc' then 500
    when 'drop_elite_rare' then 100
    when 'drop_boss_acc' then 3000
    when 'drop_boss_rare' then 1000
    when 'drop_key' then 4000
    when 'pity_elite' then 100
    when 'pity_boss' then 8
    when 'pity_key' then 3
    when 'bag_size' then 40
    when 'bag_step' then 8
    when 'bag_max' then 80
    when 'potion_max' then 20
    when 'max_plus' then 9
    when 'tower_cp' then 10
    when 'tower_elite_every' then 5
    when 'tower_min_time' then 4
    when 'tower_boss_min_time' then 8
    when 'tower_coin_base' then 20
    when 'tower_coin_step' then 6
    when 'tower_coin_elite' then 2
    when 'tower_coin_boss' then 5
    when 'tower_stone_rate' then 1000
    when 'tower_stone_elite' then 1
    when 'tower_stone_elite_step' then 50
    when 'tower_stone_boss' then 2
    when 'tower_stone_boss_step' then 10
    when 'tower_stone_max' then 12
    when 'tower_gear' then 400
    when 'tower_acc_elite' then 1500
    when 'tower_acc_boss' then 4000
    when 'tower_rare_elite' then 100
    when 'tower_rare_elite_step' then 2
    when 'tower_rare_elite_max' then 500
    when 'tower_rare_boss' then 800
    when 'tower_rare_boss_step' then 10
    when 'tower_rare_boss_max' then 3000
-- </gen:const>
  end
$$;
revoke all on function public._twelve_const(text) from public, anon, authenticated;

-- 맵: 권장 레벨 · 별 시간 · 보스 맵 · 셀 수 있는 요괴 수 · 정예 수 · 정예/보스 경험치·엽전 · 상자 엽전 · 종류별 [최대 수, 경험치, 엽전]
-- 준비된 맵만 들어 있다 (없는 맵은 시작할 수 없다)
create or replace function public._twelve_maps() returns table (
  map_id text, mode text, region int, no int, level int, par int, boss boolean, total int, elites int,
  elite_exp int, elite_coin int, boss_exp int, boss_coin int, chest_coin int, kinds jsonb
)
language sql immutable as $$
  select * from (values
-- <gen:maps>
    ('1-1', 'normal', 1, 1, 1, 260, false, 81, 0, 0, 0, 0, 0, 30, '{"imp":[81,4,2]}'::jsonb),
    ('1-2', 'normal', 1, 2, 2, 270, false, 95, 0, 0, 0, 0, 0, 35, '{"imp":[57,5,2],"wisp":[38,6,2]}'::jsonb),
    ('1-3', 'normal', 1, 3, 2, 270, false, 82, 1, 35, 21, 0, 0, 35, '{"imp":[40,5,2],"wisp":[20,6,2],"water":[21,6,3]}'::jsonb),
    ('1-4', 'normal', 1, 4, 3, 300, false, 97, 1, 47, 23, 0, 0, 39, '{"imp":[48,5,3],"wisp":[19,7,3],"water":[9,7,4],"fox":[20,8,4]}'::jsonb),
    ('1-5', 'normal', 1, 5, 4, 400, false, 115, 1, 87, 44, 0, 0, 44, '{"imp":[52,6,3],"wisp":[16,7,3],"club":[17,15,7],"water":[19,7,4],"fox":[10,9,4]}'::jsonb),
    ('1-6', 'normal', 1, 6, 4, 440, false, 130, 2, 87, 44, 0, 0, 44, '{"imp":[52,6,3],"wisp":[18,7,3],"club":[17,15,7],"water":[21,7,4],"fox":[20,9,4]}'::jsonb),
    ('1-7', 'normal', 1, 7, 5, 490, false, 155, 2, 96, 48, 0, 0, 48, '{"imp":[71,6,3],"wisp":[23,8,3],"club":[21,16,8],"water":[20,8,5],"fox":[18,10,5]}'::jsonb),
    ('1-8', 'normal', 1, 8, 6, 390, true, 69, 1, 105, 53, 263, 140, 53, '{"imp":[31,7,4],"wisp":[13,9,4],"club":[11,18,9],"water":[8,9,5],"fox":[5,11,5]}'::jsonb),
    ('2-1', 'normal', 2, 1, 6, 310, false, 98, 0, 0, 0, 0, 0, 53, '{"imp":[98,7,4]}'::jsonb),
    ('2-2', 'normal', 2, 2, 7, 350, false, 81, 0, 0, 0, 0, 0, 57, '{"imp":[39,8,4],"mud":[42,13,6]}'::jsonb),
    ('2-3', 'normal', 2, 3, 8, 340, false, 96, 1, 74, 37, 0, 0, 61, '{"imp":[47,8,4],"fox":[28,12,6],"mud":[20,14,6]}'::jsonb),
    ('2-4', 'normal', 2, 4, 8, 550, false, 143, 1, 123, 61, 0, 0, 61, '{"imp":[59,8,4],"club":[29,21,10],"fox":[22,12,6],"mud":[32,14,6]}'::jsonb),
    ('2-5', 'normal', 2, 5, 9, 550, false, 144, 1, 106, 53, 0, 0, 66, '{"imp":[63,9,4],"club":[21,22,11],"fox":[22,13,7],"bamboo":[17,18,9],"mud":[20,15,7]}'::jsonb),
    ('2-6', 'normal', 2, 6, 10, 580, false, 140, 2, 113, 56, 0, 0, 70, '{"imp":[69,9,5],"club":[26,23,12],"fox":[12,14,7],"bamboo":[18,19,9],"mud":[13,16,7]}'::jsonb),
    ('2-7', 'normal', 2, 7, 10, 630, false, 172, 2, 113, 56, 0, 0, 70, '{"imp":[79,9,5],"club":[25,23,12],"fox":[22,14,7],"bamboo":[23,19,9],"mud":[21,16,7]}'::jsonb),
    ('2-8', 'normal', 2, 8, 11, 450, true, 67, 1, 120, 60, 375, 200, 75, '{"imp":[33,10,5],"club":[6,25,13],"fox":[8,15,8],"bamboo":[11,20,10],"mud":[8,18,8]}'::jsonb),
    ('3-1', 'normal', 3, 1, 12, 480, false, 102, 0, 0, 0, 0, 0, 80, '{"guard":[102,27,13]}'::jsonb),
    ('3-2', 'normal', 3, 2, 12, 400, false, 97, 0, 0, 0, 0, 0, 80, '{"wisp":[38,13,5],"guard":[59,27,13]}'::jsonb),
    ('3-3', 'normal', 3, 3, 13, 400, false, 95, 1, 134, 67, 0, 0, 84, '{"wisp":[24,14,6],"guard":[53,28,14],"lynx":[17,22,11]}'::jsonb),
    ('3-4', 'normal', 3, 4, 14, 470, false, 125, 1, 159, 71, 0, 0, 89, '{"wisp":[21,15,6],"guard":[64,30,15],"spirit":[19,27,12],"lynx":[20,24,12]}'::jsonb),
    ('3-5', 'normal', 3, 5, 14, 560, false, 153, 1, 142, 71, 0, 0, 89, '{"wisp":[22,15,6],"bamboo":[12,24,12],"guard":[70,30,15],"spirit":[28,27,12],"lynx":[20,24,12]}'::jsonb),
    ('3-6', 'normal', 3, 6, 15, 590, false, 145, 2, 149, 74, 0, 0, 93, '{"wisp":[16,16,6],"bamboo":[24,25,12],"guard":[67,31,16],"spirit":[21,28,12],"lynx":[15,25,12]}'::jsonb),
    ('3-7', 'normal', 3, 7, 16, 570, false, 138, 2, 156, 78, 0, 0, 98, '{"wisp":[17,16,7],"bamboo":[17,26,13],"guard":[65,33,16],"spirit":[18,29,13],"lynx":[19,26,13]}'::jsonb),
    ('3-8', 'normal', 3, 8, 16, 450, true, 77, 1, 156, 78, 488, 260, 98, '{"wisp":[11,16,7],"bamboo":[7,26,13],"guard":[36,33,16],"spirit":[10,29,13],"lynx":[12,26,13]}'::jsonb)
-- </gen:maps>
  ) as t(map_id, mode, region, no, level, par, boss, total, elites, elite_exp, elite_coin, boss_exp, boss_coin, chest_coin, kinds)
$$;
revoke all on function public._twelve_maps() from public, anon, authenticated;

-- 레벨 n → n+1 에 필요한 경험치
create or replace function public._twelve_levels() returns table (level int, need bigint)
language sql immutable as $$
  select * from (values
-- <gen:levels>
    (1, 154),
    (2, 406),
    (3, 717),
    (4, 1073),
    (5, 1466),
    (6, 1892),
    (7, 2348),
    (8, 2830),
    (9, 3338),
    (10, 3868),
    (11, 4420),
    (12, 4993),
    (13, 5585),
    (14, 6196),
    (15, 6824),
    (16, 7469),
    (17, 8131),
    (18, 8809),
    (19, 9501),
    (20, 10209),
    (21, 10930),
    (22, 11666),
    (23, 12415),
    (24, 13177),
    (25, 13952),
    (26, 14740),
    (27, 15539),
    (28, 16351),
    (29, 17174),
    (30, 18009),
    (31, 18855),
    (32, 19712),
    (33, 20580),
    (34, 21458),
    (35, 22347),
    (36, 23246),
    (37, 24155),
    (38, 25074),
    (39, 26002),
    (40, 26940),
    (41, 27888),
    (42, 28845),
    (43, 29811),
    (44, 30786),
    (45, 31770),
    (46, 32763),
    (47, 33764),
    (48, 34774),
    (49, 35793),
    (50, 36820),
    (51, 37855),
    (52, 38898),
    (53, 39949),
    (54, 41008),
    (55, 42075),
    (56, 43150),
    (57, 44233),
    (58, 45323),
    (59, 46421),
    (60, 47526),
    (61, 48639),
    (62, 49759),
    (63, 50886),
    (64, 52020),
    (65, 53162),
    (66, 54310),
    (67, 55466),
    (68, 56628),
    (69, 57798),
    (70, 58974),
    (71, 60156),
    (72, 61346),
    (73, 62542),
    (74, 63745),
    (75, 64954),
    (76, 66170),
    (77, 67392),
    (78, 68620),
    (79, 69855),
    (80, 71096),
    (81, 72344),
    (82, 73597),
    (83, 74857),
    (84, 76122),
    (85, 77394),
    (86, 78672),
    (87, 79955),
    (88, 81245),
    (89, 82540),
    (90, 83842),
    (91, 85149),
    (92, 86462),
    (93, 87780),
    (94, 89105),
    (95, 90434),
    (96, 91770),
    (97, 93111),
    (98, 94458)
-- </gen:levels>
  ) as t(level, need)
$$;
revoke all on function public._twelve_levels() from public, anon, authenticated;

-- 맵 레벨 차이 보정: 내 레벨 − 맵 권장 레벨이 gap 이상이면 경험치 pct%
create or replace function public._twelve_exp_penalty() returns table (gap int, pct int)
language sql immutable as $$
  select * from (values
-- <gen:penalty>
    (20, 5),
    (10, 25)
-- </gen:penalty>
  ) as t(gap, pct)
$$;
revoke all on function public._twelve_exp_penalty() from public, anon, authenticated;

-- 장비: 칸 · 등급(0~11) · 레어 · 강화 가능 · 상점 값(0 = 안 판다) · 파는 값 · 분해 강화석 · 엽전 획득 %
create or replace function public._twelve_items() returns table (base text, slot text, tier int, rare boolean, enhance boolean, buy int, sell int, scrap int, coin_pct int)
language sql immutable as $$
  select * from (values
-- <gen:items>
    ('w-sword-0', 'weapon', 0, false, true, 300, 30, 1, 0),
    ('w-spear-0', 'weapon', 0, false, true, 300, 30, 1, 0),
    ('w-bow-0', 'weapon', 0, false, true, 300, 30, 1, 0),
    ('w-fan-0', 'weapon', 0, false, true, 300, 30, 1, 0),
    ('a-0', 'armor', 0, false, true, 300, 30, 1, 0),
    ('c-mp-0', 'acc', 0, false, false, 0, 45, 1, 0),
    ('c-speed-0', 'acc', 0, false, false, 0, 45, 1, 0),
    ('c-crit-0', 'acc', 0, false, false, 0, 45, 1, 0),
    ('c-potion-0', 'acc', 0, false, false, 0, 45, 1, 0),
    ('c-coin-0', 'acc', 0, false, false, 0, 45, 1, 5),
    ('w-sword-1', 'weapon', 1, false, true, 1200, 120, 1, 0),
    ('w-spear-1', 'weapon', 1, false, true, 1200, 120, 1, 0),
    ('w-bow-1', 'weapon', 1, false, true, 1200, 120, 1, 0),
    ('w-fan-1', 'weapon', 1, false, true, 1200, 120, 1, 0),
    ('a-1', 'armor', 1, false, true, 1200, 120, 1, 0),
    ('c-mp-1', 'acc', 1, false, false, 0, 180, 1, 0),
    ('c-speed-1', 'acc', 1, false, false, 0, 180, 1, 0),
    ('c-crit-1', 'acc', 1, false, false, 0, 180, 1, 0),
    ('c-potion-1', 'acc', 1, false, false, 0, 180, 1, 0),
    ('c-coin-1', 'acc', 1, false, false, 0, 180, 1, 6),
    ('w-sword-2', 'weapon', 2, false, true, 2700, 270, 2, 0),
    ('w-spear-2', 'weapon', 2, false, true, 2700, 270, 2, 0),
    ('w-bow-2', 'weapon', 2, false, true, 2700, 270, 2, 0),
    ('w-fan-2', 'weapon', 2, false, true, 2700, 270, 2, 0),
    ('a-2', 'armor', 2, false, true, 2700, 270, 2, 0),
    ('c-mp-2', 'acc', 2, false, false, 0, 405, 2, 0),
    ('c-speed-2', 'acc', 2, false, false, 0, 405, 2, 0),
    ('c-crit-2', 'acc', 2, false, false, 0, 405, 2, 0),
    ('c-potion-2', 'acc', 2, false, false, 0, 405, 2, 0),
    ('c-coin-2', 'acc', 2, false, false, 0, 405, 2, 8),
    ('w-sword-3', 'weapon', 3, false, true, 4800, 480, 2, 0),
    ('w-spear-3', 'weapon', 3, false, true, 4800, 480, 2, 0),
    ('w-bow-3', 'weapon', 3, false, true, 4800, 480, 2, 0),
    ('w-fan-3', 'weapon', 3, false, true, 4800, 480, 2, 0),
    ('a-3', 'armor', 3, false, true, 4800, 480, 2, 0),
    ('c-mp-3', 'acc', 3, false, false, 0, 720, 2, 0),
    ('c-speed-3', 'acc', 3, false, false, 0, 720, 2, 0),
    ('c-crit-3', 'acc', 3, false, false, 0, 720, 2, 0),
    ('c-potion-3', 'acc', 3, false, false, 0, 720, 2, 0),
    ('c-coin-3', 'acc', 3, false, false, 0, 720, 2, 9),
    ('w-sword-4', 'weapon', 4, false, true, 7500, 750, 3, 0),
    ('w-spear-4', 'weapon', 4, false, true, 7500, 750, 3, 0),
    ('w-bow-4', 'weapon', 4, false, true, 7500, 750, 3, 0),
    ('w-fan-4', 'weapon', 4, false, true, 7500, 750, 3, 0),
    ('a-4', 'armor', 4, false, true, 7500, 750, 3, 0),
    ('c-mp-4', 'acc', 4, false, false, 0, 1125, 3, 0),
    ('c-speed-4', 'acc', 4, false, false, 0, 1125, 3, 0),
    ('c-crit-4', 'acc', 4, false, false, 0, 1125, 3, 0),
    ('c-potion-4', 'acc', 4, false, false, 0, 1125, 3, 0),
    ('c-coin-4', 'acc', 4, false, false, 0, 1125, 3, 11),
    ('w-sword-5', 'weapon', 5, false, true, 10800, 1080, 3, 0),
    ('w-spear-5', 'weapon', 5, false, true, 10800, 1080, 3, 0),
    ('w-bow-5', 'weapon', 5, false, true, 10800, 1080, 3, 0),
    ('w-fan-5', 'weapon', 5, false, true, 10800, 1080, 3, 0),
    ('a-5', 'armor', 5, false, true, 10800, 1080, 3, 0),
    ('c-mp-5', 'acc', 5, false, false, 0, 1620, 3, 0),
    ('c-speed-5', 'acc', 5, false, false, 0, 1620, 3, 0),
    ('c-crit-5', 'acc', 5, false, false, 0, 1620, 3, 0),
    ('c-potion-5', 'acc', 5, false, false, 0, 1620, 3, 0),
    ('c-coin-5', 'acc', 5, false, false, 0, 1620, 3, 12),
    ('w-sword-6', 'weapon', 6, false, true, 14700, 1470, 4, 0),
    ('w-spear-6', 'weapon', 6, false, true, 14700, 1470, 4, 0),
    ('w-bow-6', 'weapon', 6, false, true, 14700, 1470, 4, 0),
    ('w-fan-6', 'weapon', 6, false, true, 14700, 1470, 4, 0),
    ('a-6', 'armor', 6, false, true, 14700, 1470, 4, 0),
    ('c-mp-6', 'acc', 6, false, false, 0, 2205, 4, 0),
    ('c-speed-6', 'acc', 6, false, false, 0, 2205, 4, 0),
    ('c-crit-6', 'acc', 6, false, false, 0, 2205, 4, 0),
    ('c-potion-6', 'acc', 6, false, false, 0, 2205, 4, 0),
    ('c-coin-6', 'acc', 6, false, false, 0, 2205, 4, 14),
    ('w-sword-7', 'weapon', 7, false, true, 19200, 1920, 4, 0),
    ('w-spear-7', 'weapon', 7, false, true, 19200, 1920, 4, 0),
    ('w-bow-7', 'weapon', 7, false, true, 19200, 1920, 4, 0),
    ('w-fan-7', 'weapon', 7, false, true, 19200, 1920, 4, 0),
    ('a-7', 'armor', 7, false, true, 19200, 1920, 4, 0),
    ('c-mp-7', 'acc', 7, false, false, 0, 2880, 4, 0),
    ('c-speed-7', 'acc', 7, false, false, 0, 2880, 4, 0),
    ('c-crit-7', 'acc', 7, false, false, 0, 2880, 4, 0),
    ('c-potion-7', 'acc', 7, false, false, 0, 2880, 4, 0),
    ('c-coin-7', 'acc', 7, false, false, 0, 2880, 4, 15),
    ('w-sword-8', 'weapon', 8, false, true, 24300, 2430, 5, 0),
    ('w-spear-8', 'weapon', 8, false, true, 24300, 2430, 5, 0),
    ('w-bow-8', 'weapon', 8, false, true, 24300, 2430, 5, 0),
    ('w-fan-8', 'weapon', 8, false, true, 24300, 2430, 5, 0),
    ('a-8', 'armor', 8, false, true, 24300, 2430, 5, 0),
    ('c-mp-8', 'acc', 8, false, false, 0, 3645, 5, 0),
    ('c-speed-8', 'acc', 8, false, false, 0, 3645, 5, 0),
    ('c-crit-8', 'acc', 8, false, false, 0, 3645, 5, 0),
    ('c-potion-8', 'acc', 8, false, false, 0, 3645, 5, 0),
    ('c-coin-8', 'acc', 8, false, false, 0, 3645, 5, 17),
    ('w-sword-9', 'weapon', 9, false, true, 30000, 3000, 5, 0),
    ('w-spear-9', 'weapon', 9, false, true, 30000, 3000, 5, 0),
    ('w-bow-9', 'weapon', 9, false, true, 30000, 3000, 5, 0),
    ('w-fan-9', 'weapon', 9, false, true, 30000, 3000, 5, 0),
    ('a-9', 'armor', 9, false, true, 30000, 3000, 5, 0),
    ('c-mp-9', 'acc', 9, false, false, 0, 4500, 5, 0),
    ('c-speed-9', 'acc', 9, false, false, 0, 4500, 5, 0),
    ('c-crit-9', 'acc', 9, false, false, 0, 4500, 5, 0),
    ('c-potion-9', 'acc', 9, false, false, 0, 4500, 5, 0),
    ('c-coin-9', 'acc', 9, false, false, 0, 4500, 5, 18),
    ('w-sword-10', 'weapon', 10, false, true, 36300, 3630, 6, 0),
    ('w-spear-10', 'weapon', 10, false, true, 36300, 3630, 6, 0),
    ('w-bow-10', 'weapon', 10, false, true, 36300, 3630, 6, 0),
    ('w-fan-10', 'weapon', 10, false, true, 36300, 3630, 6, 0),
    ('a-10', 'armor', 10, false, true, 36300, 3630, 6, 0),
    ('c-mp-10', 'acc', 10, false, false, 0, 5445, 6, 0),
    ('c-speed-10', 'acc', 10, false, false, 0, 5445, 6, 0),
    ('c-crit-10', 'acc', 10, false, false, 0, 5445, 6, 0),
    ('c-potion-10', 'acc', 10, false, false, 0, 5445, 6, 0),
    ('c-coin-10', 'acc', 10, false, false, 0, 5445, 6, 20),
    ('w-sword-11', 'weapon', 11, false, true, 43200, 4320, 6, 0),
    ('w-spear-11', 'weapon', 11, false, true, 43200, 4320, 6, 0),
    ('w-bow-11', 'weapon', 11, false, true, 43200, 4320, 6, 0),
    ('w-fan-11', 'weapon', 11, false, true, 43200, 4320, 6, 0),
    ('a-11', 'armor', 11, false, true, 43200, 4320, 6, 0),
    ('c-mp-11', 'acc', 11, false, false, 0, 6480, 6, 0),
    ('c-speed-11', 'acc', 11, false, false, 0, 6480, 6, 0),
    ('c-crit-11', 'acc', 11, false, false, 0, 6480, 6, 0),
    ('c-potion-11', 'acc', 11, false, false, 0, 6480, 6, 0),
    ('c-coin-11', 'acc', 11, false, false, 0, 6480, 6, 21),
    ('r-n1-1', 'weapon', 0, true, true, 0, 120, 4, 0),
    ('r-n1-2', 'weapon', 0, true, true, 0, 120, 4, 0),
    ('r-n1-3', 'armor', 0, true, true, 0, 120, 4, 0),
    ('s-n1', 'acc', 0, true, false, 0, 45, 1, 0),
    ('r-n2-1', 'weapon', 0, true, true, 0, 120, 4, 0),
    ('r-n2-2', 'weapon', 0, true, true, 0, 120, 4, 0),
    ('r-n2-3', 'armor', 0, true, true, 0, 120, 4, 0),
    ('s-n2', 'acc', 0, true, false, 0, 45, 1, 0),
    ('r-n3-1', 'weapon', 1, true, true, 0, 480, 4, 0),
    ('r-n3-2', 'weapon', 1, true, true, 0, 480, 4, 0),
    ('r-n3-3', 'armor', 1, true, true, 0, 480, 4, 0),
    ('s-n3', 'acc', 1, true, false, 0, 180, 1, 0),
    ('r-n4-1', 'weapon', 2, true, true, 0, 1080, 6, 0),
    ('r-n4-2', 'weapon', 2, true, true, 0, 1080, 6, 0),
    ('r-n4-3', 'armor', 2, true, true, 0, 1080, 6, 0),
    ('s-n4', 'acc', 2, true, false, 0, 405, 2, 0),
    ('r-n5-1', 'weapon', 3, true, true, 0, 1920, 6, 0),
    ('r-n5-2', 'weapon', 3, true, true, 0, 1920, 6, 0),
    ('r-n5-3', 'armor', 3, true, true, 0, 1920, 6, 0),
    ('s-n5', 'acc', 3, true, false, 0, 720, 2, 14),
    ('r-n6-1', 'weapon', 3, true, true, 0, 1920, 6, 0),
    ('r-n6-2', 'weapon', 3, true, true, 0, 1920, 6, 0),
    ('r-n6-3', 'armor', 3, true, true, 0, 1920, 6, 0),
    ('s-n6', 'acc', 3, true, false, 0, 720, 2, 0),
    ('r-n7-1', 'weapon', 4, true, true, 0, 3000, 8, 0),
    ('r-n7-2', 'weapon', 4, true, true, 0, 3000, 8, 0),
    ('r-n7-3', 'armor', 4, true, true, 0, 3000, 8, 0),
    ('s-n7', 'acc', 4, true, false, 0, 1125, 3, 0),
    ('r-n8-1', 'weapon', 5, true, true, 0, 4320, 8, 0),
    ('r-n8-2', 'weapon', 5, true, true, 0, 4320, 8, 0),
    ('r-n8-3', 'armor', 5, true, true, 0, 4320, 8, 0),
    ('s-n8', 'acc', 5, true, false, 0, 1620, 3, 0),
    ('r-n9-1', 'weapon', 6, true, true, 0, 5880, 10, 0),
    ('r-n9-2', 'weapon', 6, true, true, 0, 5880, 10, 0),
    ('r-n9-3', 'armor', 6, true, true, 0, 5880, 10, 0),
    ('s-n9', 'acc', 6, true, false, 0, 2205, 4, 0),
    ('r-n10-1', 'weapon', 6, true, true, 0, 5880, 10, 0),
    ('r-n10-2', 'weapon', 6, true, true, 0, 5880, 10, 0),
    ('r-n10-3', 'armor', 6, true, true, 0, 5880, 10, 0),
    ('s-n10', 'acc', 6, true, false, 0, 2205, 4, 21),
    ('r-n11-1', 'weapon', 7, true, true, 0, 7680, 10, 0),
    ('r-n11-2', 'weapon', 7, true, true, 0, 7680, 10, 0),
    ('r-n11-3', 'armor', 7, true, true, 0, 7680, 10, 0),
    ('s-n11', 'acc', 7, true, false, 0, 2880, 4, 0),
    ('r-n12-1', 'weapon', 7, true, true, 0, 7680, 10, 0),
    ('r-n12-2', 'weapon', 7, true, true, 0, 7680, 10, 0),
    ('r-n12-3', 'armor', 7, true, true, 0, 7680, 10, 0),
    ('s-n12', 'acc', 7, true, false, 0, 2880, 4, 0),
    ('r-h1-1', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h1-2', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h1-3', 'armor', 8, true, true, 0, 9720, 12, 0),
    ('s-h1', 'acc', 8, true, false, 0, 3645, 5, 0),
    ('r-h2-1', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h2-2', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h2-3', 'armor', 8, true, true, 0, 9720, 12, 0),
    ('s-h2', 'acc', 8, true, false, 0, 3645, 5, 0),
    ('r-h3-1', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h3-2', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h3-3', 'armor', 8, true, true, 0, 9720, 12, 0),
    ('s-h3', 'acc', 8, true, false, 0, 3645, 5, 0),
    ('r-h4-1', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h4-2', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h4-3', 'armor', 9, true, true, 0, 12000, 12, 0),
    ('s-h4', 'acc', 9, true, false, 0, 4500, 5, 0),
    ('r-h5-1', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h5-2', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h5-3', 'armor', 9, true, true, 0, 12000, 12, 0),
    ('s-h5', 'acc', 9, true, false, 0, 4500, 5, 27),
    ('r-h6-1', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h6-2', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h6-3', 'armor', 9, true, true, 0, 12000, 12, 0),
    ('s-h6', 'acc', 9, true, false, 0, 4500, 5, 0),
    ('r-h7-1', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h7-2', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h7-3', 'armor', 10, true, true, 0, 14520, 14, 0),
    ('s-h7', 'acc', 10, true, false, 0, 5445, 6, 0),
    ('r-h8-1', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h8-2', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h8-3', 'armor', 10, true, true, 0, 14520, 14, 0),
    ('s-h8', 'acc', 10, true, false, 0, 5445, 6, 0),
    ('r-h9-1', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h9-2', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h9-3', 'armor', 10, true, true, 0, 14520, 14, 0),
    ('s-h9', 'acc', 10, true, false, 0, 5445, 6, 0),
    ('r-h10-1', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h10-2', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h10-3', 'armor', 11, true, true, 0, 17280, 14, 0),
    ('s-h10', 'acc', 11, true, false, 0, 6480, 6, 32),
    ('r-h11-1', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h11-2', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h11-3', 'armor', 11, true, true, 0, 17280, 14, 0),
    ('s-h11', 'acc', 11, true, false, 0, 6480, 6, 0),
    ('r-h12-1', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h12-2', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h12-3', 'armor', 11, true, true, 0, 17280, 14, 0),
    ('s-h12', 'acc', 11, true, false, 0, 6480, 6, 0)
-- </gen:items>
  ) as t(base, slot, tier, rare, enhance, buy, sell, scrap, coin_pct)
$$;
revoke all on function public._twelve_items() from public, anon, authenticated;

-- 착용 레벨: 등급 0~11 → Lv1, 9, 18, …, 99 (9단위)
create or replace function public._twelve_tier_level(p_tier int) returns int
language sql immutable as $$ select greatest(1, 9 * p_tier) $$;
revoke all on function public._twelve_tier_level(int) from public, anon, authenticated;

-- 지형(모드별): 드랍 등급 · 정예/보스 강화석 · 드랍 물약 크기 · 별 24개 보상 · 그 지형의 레어
create or replace function public._twelve_regions() returns table (mode text, region int, tier int, elite_stones int, boss_stones int, potion_size int, star_item text, rares text[])
language sql immutable as $$
  select * from (values
-- <gen:regions>
    ('normal', 1, 0, 1, 3, 0, 's-n1', array['r-n1-1', 'r-n1-2', 'r-n1-3']),
    ('normal', 2, 0, 1, 3, 0, 's-n2', array['r-n2-1', 'r-n2-2', 'r-n2-3']),
    ('normal', 3, 1, 1, 3, 0, 's-n3', array['r-n3-1', 'r-n3-2', 'r-n3-3']),
    ('normal', 4, 2, 1, 4, 0, 's-n4', array['r-n4-1', 'r-n4-2', 'r-n4-3']),
    ('normal', 5, 3, 1, 4, 1, 's-n5', array['r-n5-1', 'r-n5-2', 'r-n5-3']),
    ('normal', 6, 3, 1, 4, 1, 's-n6', array['r-n6-1', 'r-n6-2', 'r-n6-3']),
    ('normal', 7, 4, 1, 5, 1, 's-n7', array['r-n7-1', 'r-n7-2', 'r-n7-3']),
    ('normal', 8, 5, 1, 5, 1, 's-n8', array['r-n8-1', 'r-n8-2', 'r-n8-3']),
    ('normal', 9, 6, 1, 6, 2, 's-n9', array['r-n9-1', 'r-n9-2', 'r-n9-3']),
    ('normal', 10, 6, 1, 6, 2, 's-n10', array['r-n10-1', 'r-n10-2', 'r-n10-3']),
    ('normal', 11, 7, 1, 6, 2, 's-n11', array['r-n11-1', 'r-n11-2', 'r-n11-3']),
    ('normal', 12, 7, 1, 6, 2, 's-n12', array['r-n12-1', 'r-n12-2', 'r-n12-3']),
    ('hard', 1, 8, 1, 7, 2, 's-h1', array['r-h1-1', 'r-h1-2', 'r-h1-3']),
    ('hard', 2, 8, 1, 7, 2, 's-h2', array['r-h2-1', 'r-h2-2', 'r-h2-3']),
    ('hard', 3, 8, 1, 7, 2, 's-h3', array['r-h3-1', 'r-h3-2', 'r-h3-3']),
    ('hard', 4, 9, 1, 7, 2, 's-h4', array['r-h4-1', 'r-h4-2', 'r-h4-3']),
    ('hard', 5, 9, 1, 7, 2, 's-h5', array['r-h5-1', 'r-h5-2', 'r-h5-3']),
    ('hard', 6, 9, 1, 7, 2, 's-h6', array['r-h6-1', 'r-h6-2', 'r-h6-3']),
    ('hard', 7, 10, 1, 8, 2, 's-h7', array['r-h7-1', 'r-h7-2', 'r-h7-3']),
    ('hard', 8, 10, 1, 8, 2, 's-h8', array['r-h8-1', 'r-h8-2', 'r-h8-3']),
    ('hard', 9, 10, 1, 8, 2, 's-h9', array['r-h9-1', 'r-h9-2', 'r-h9-3']),
    ('hard', 10, 11, 1, 8, 2, 's-h10', array['r-h10-1', 'r-h10-2', 'r-h10-3']),
    ('hard', 11, 11, 1, 8, 2, 's-h11', array['r-h11-1', 'r-h11-2', 'r-h11-3']),
    ('hard', 12, 11, 1, 8, 2, 's-h12', array['r-h12-1', 'r-h12-2', 'r-h12-3'])
-- </gen:regions>
  ) as t(mode, region, tier, elite_stones, boss_stones, potion_size, star_item, rares)
$$;
revoke all on function public._twelve_regions() from public, anon, authenticated;

-- 강화: 등급 · 올라갈 단계 · 엽전 · 강화석
create or replace function public._twelve_enhance() returns table (tier int, plus int, coins int, stones int)
language sql immutable as $$
  select * from (values
-- <gen:enhance>
    (0, 1, 60, 1),
    (0, 2, 120, 1),
    (0, 3, 180, 2),
    (0, 4, 240, 2),
    (0, 5, 300, 3),
    (0, 6, 360, 3),
    (0, 7, 420, 4),
    (0, 8, 480, 4),
    (0, 9, 540, 5),
    (1, 1, 120, 1),
    (1, 2, 240, 1),
    (1, 3, 360, 2),
    (1, 4, 480, 2),
    (1, 5, 600, 3),
    (1, 6, 720, 3),
    (1, 7, 840, 4),
    (1, 8, 960, 4),
    (1, 9, 1080, 5),
    (2, 1, 180, 1),
    (2, 2, 360, 1),
    (2, 3, 540, 2),
    (2, 4, 720, 2),
    (2, 5, 900, 3),
    (2, 6, 1080, 3),
    (2, 7, 1260, 4),
    (2, 8, 1440, 4),
    (2, 9, 1620, 5),
    (3, 1, 240, 2),
    (3, 2, 480, 2),
    (3, 3, 720, 3),
    (3, 4, 960, 3),
    (3, 5, 1200, 4),
    (3, 6, 1440, 4),
    (3, 7, 1680, 5),
    (3, 8, 1920, 5),
    (3, 9, 2160, 6),
    (4, 1, 300, 2),
    (4, 2, 600, 2),
    (4, 3, 900, 3),
    (4, 4, 1200, 3),
    (4, 5, 1500, 4),
    (4, 6, 1800, 4),
    (4, 7, 2100, 5),
    (4, 8, 2400, 5),
    (4, 9, 2700, 6),
    (5, 1, 360, 2),
    (5, 2, 720, 2),
    (5, 3, 1080, 3),
    (5, 4, 1440, 3),
    (5, 5, 1800, 4),
    (5, 6, 2160, 4),
    (5, 7, 2520, 5),
    (5, 8, 2880, 5),
    (5, 9, 3240, 6),
    (6, 1, 420, 3),
    (6, 2, 840, 3),
    (6, 3, 1260, 4),
    (6, 4, 1680, 4),
    (6, 5, 2100, 5),
    (6, 6, 2520, 5),
    (6, 7, 2940, 6),
    (6, 8, 3360, 6),
    (6, 9, 3780, 7),
    (7, 1, 480, 3),
    (7, 2, 960, 3),
    (7, 3, 1440, 4),
    (7, 4, 1920, 4),
    (7, 5, 2400, 5),
    (7, 6, 2880, 5),
    (7, 7, 3360, 6),
    (7, 8, 3840, 6),
    (7, 9, 4320, 7),
    (8, 1, 540, 3),
    (8, 2, 1080, 3),
    (8, 3, 1620, 4),
    (8, 4, 2160, 4),
    (8, 5, 2700, 5),
    (8, 6, 3240, 5),
    (8, 7, 3780, 6),
    (8, 8, 4320, 6),
    (8, 9, 4860, 7),
    (9, 1, 600, 4),
    (9, 2, 1200, 4),
    (9, 3, 1800, 5),
    (9, 4, 2400, 5),
    (9, 5, 3000, 6),
    (9, 6, 3600, 6),
    (9, 7, 4200, 7),
    (9, 8, 4800, 7),
    (9, 9, 5400, 8),
    (10, 1, 660, 4),
    (10, 2, 1320, 4),
    (10, 3, 1980, 5),
    (10, 4, 2640, 5),
    (10, 5, 3300, 6),
    (10, 6, 3960, 6),
    (10, 7, 4620, 7),
    (10, 8, 5280, 7),
    (10, 9, 5940, 8),
    (11, 1, 720, 4),
    (11, 2, 1440, 4),
    (11, 3, 2160, 5),
    (11, 4, 2880, 5),
    (11, 5, 3600, 6),
    (11, 6, 4320, 6),
    (11, 7, 5040, 7),
    (11, 8, 5760, 7),
    (11, 9, 6480, 8)
-- </gen:enhance>
  ) as t(tier, plus, coins, stones)
$$;
revoke all on function public._twelve_enhance() from public, anon, authenticated;

-- 가방 늘리기: 지금 칸 수 → 값
create or replace function public._twelve_bag_prices() returns table (size int, price int)
language sql immutable as $$
  select * from (values
-- <gen:bag>
    (40, 300),
    (48, 1200),
    (56, 2700),
    (64, 4800),
    (72, 7500)
-- </gen:bag>
  ) as t(size, price)
$$;
revoke all on function public._twelve_bag_prices() from public, anon, authenticated;

-- 물약: 종류(0 체력 · 1 마력) · 크기(0 소 · 1 중 · 2 대) · 값
create or replace function public._twelve_potions() returns table (slot int, size int, price int)
language sql immutable as $$
  select * from (values
-- <gen:potions>
    (0, 0, 20),
    (0, 1, 80),
    (0, 2, 240),
    (1, 0, 20),
    (1, 1, 80),
    (1, 2, 240)
-- </gen:potions>
  ) as t(slot, size, price)
$$;
revoke all on function public._twelve_potions() from public, anon, authenticated;

-- 대원: 합류 지형 (0 = 처음부터, 1~9 = 그 지형 보스를 처음 잡으면, -1 = 시아코인으로 여는 추가 캐릭터)
create or replace function public._twelve_heroes() returns table (id text, join_region int)
language sql immutable as $$
  select * from (values
-- <gen:heroes>
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
    ('pig', 9),
    ('cat', -1)
-- </gen:heroes>
  ) as t(id, join_region)
$$;
revoke all on function public._twelve_heroes() from public, anon, authenticated;

-- 처음 받는 장비 (첫 번째 = 드는 무기, 마지막 = 입는 갑옷) · 처음 받는 물약
create or replace function public._twelve_starter() returns text[]
language sql immutable as $$
-- <gen:starter>
  select array['w-sword-0', 'w-spear-0', 'w-bow-0', 'w-fan-0', 'a-0']::text[]
-- </gen:starter>
$$;
revoke all on function public._twelve_starter() from public, anon, authenticated;

create or replace function public._twelve_starter_potions() returns jsonb
language sql immutable as $$
-- <gen:starter_potions>
  select '[[5,0,0],[3,0,0]]'::jsonb
-- </gen:starter_potions>
$$;
revoke all on function public._twelve_starter_potions() from public, anon, authenticated;

-- 일반 장비 드랍 후보의 앞 글자 (뒤에 등급을 붙인다) · 장신구 능력. 순서가 드랍 판정에 쓰인다
create or replace function public._twelve_gear() returns text[]
language sql immutable as $$
-- <gen:gear>
  select array['w-sword-', 'w-spear-', 'w-bow-', 'w-fan-', 'a-']::text[]
-- </gen:gear>
$$;
revoke all on function public._twelve_gear() from public, anon, authenticated;

create or replace function public._twelve_acc() returns text[]
language sql immutable as $$
-- <gen:acc>
  select array['mp', 'speed', 'crit', 'potion', 'coin']::text[]
-- </gen:acc>
$$;
revoke all on function public._twelve_acc() from public, anon, authenticated;

-- ---------- 3. 드랍 판정의 무작위 (games/twelve/src/game/drops.ts 의 roll 과 같은 계산) ----------

-- 씨앗 · 판정 종류 · 순번 → 0 ~ 2³²-1
create or replace function public._twelve_roll(p_seed bigint, p_tag int, p_n int) returns bigint
language sql immutable as $$
  select c.y # (c.y >> 16) from (
    select ((b.x # (b.x >> 16)) * 73244475) & 4294967295 as y from (
      select ((a.x # (a.x >> 16)) * 73244475) & 4294967295 as x from (
        select (p_seed # ((p_tag::bigint * 2654435761) & 4294967295) # ((p_n::bigint * 2246822507) & 4294967295)) & 4294967295 as x
      ) a
    ) b
  ) c
$$;
revoke all on function public._twelve_roll(bigint, int, int) from public, anon, authenticated;

-- ---------- 4. 열림 여부 (games/twelve/src/game/progress.ts 와 같은 규칙) ----------

create or replace function public._twelve_cleared(p_user uuid, p_mode text, p_map text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.twelve_maps m where m.user_id = p_user and m.mode = p_mode and m.map_id = p_map and m.clears > 0)
$$;
revoke all on function public._twelve_cleared(uuid, text, text) from public, anon, authenticated;

-- 지형: 1지형은 처음부터, 그 뒤는 앞 지형 보스(8번째 맵)를 잡으면
create or replace function public._twelve_region_open(p_user uuid, p_mode text, p_region int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_region <= 1 or public._twelve_cleared(p_user, p_mode, (p_region - 1)::text || '-8')
$$;
revoke all on function public._twelve_region_open(uuid, text, int) from public, anon, authenticated;

-- 맵: 지형의 1번은 지형이 열리면, 그 뒤는 앞 맵을 깨면
create or replace function public._twelve_map_open(p_user uuid, p_mode text, p_region int, p_no int) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_no <= 1 then public._twelve_region_open(p_user, p_mode, p_region)
    else public._twelve_cleared(p_user, p_mode, p_region::text || '-' || (p_no - 1)::text) end
$$;
revoke all on function public._twelve_map_open(uuid, text, int, int) from public, anon, authenticated;

-- 대원 합류: 그 지형 보스를 보통·어려움 어느 쪽에서든 잡았다
create or replace function public._twelve_joined(p_user uuid, p_region int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_region = 0 or (p_region > 0 and exists (
    select 1 from public.twelve_maps m where m.user_id = p_user and m.map_id = p_region::text || '-8' and m.clears > 0
  ))
$$;
revoke all on function public._twelve_joined(uuid, int) from public, anon, authenticated;

-- 보통 모드를 끝냈는지 (최종보스맵 'final' 클리어 — 맵은 7단계에서 생긴다)
create or replace function public._twelve_normal_done(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public._twelve_cleared(p_user, 'normal', 'final')
$$;
revoke all on function public._twelve_normal_done(uuid) from public, anon, authenticated;

-- 고를 수 있는 대원인지 검사 (판 시작 · 대표 대원 바꾸기). 고양이는 071 의 _check_character 가 본다
create or replace function public._twelve_check_hero(p_user uuid, p_hero text) returns void
language plpgsql stable security definer set search_path = public as $$
declare j int;
begin
  select h.join_region into j from public._twelve_heroes() h where h.id = p_hero;
  if not found then raise exception 'bad hero'; end if;
  perform public._check_character(p_user, p_hero, 'twelve');
  if j > 0 and not public._twelve_joined(p_user, j) then raise exception 'hero locked'; end if;
end $$;
revoke all on function public._twelve_check_hero(uuid, text) from public, anon, authenticated;

-- 상점이 파는 가장 높은 등급: 준비된(맵이 있는) 지형 중 열린 지형까지
create or replace function public._twelve_shop_tier(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(r.tier), 0) from public._twelve_regions() r
  where exists (select 1 from public._twelve_maps() m where m.mode = r.mode and m.region = r.region)
    and public._twelve_region_open(p_user, r.mode, r.region)
$$;
revoke all on function public._twelve_shop_tier(uuid) from public, anon, authenticated;

-- 고양이 구매 조건 (071 의 buy_character · character_progress 가 찾아 부른다): 보통 모드 최종보스 처치 = 1/1
create or replace function public._cat_progress_twelve(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('have', case when public._twelve_normal_done(p_user) then 1 else 0 end, 'need', 1)
$$;
revoke all on function public._cat_progress_twelve(uuid) from public, anon, authenticated;

-- ---------- 5. 프로필 ----------

-- 내 프로필 줄 (없으면 처음 장비·물약과 함께 만든다). 잠그고 읽는다
create or replace function public._twelve_profile_row(p_user uuid) returns public.twelve_profiles
language plpgsql security definer set search_path = public as $$
declare r public.twelve_profiles; n int; b text; first_id bigint; last_id bigint; new_id bigint;
begin
  insert into public.twelve_profiles (user_id, bag, potions)
  values (p_user, public._twelve_const('bag_size')::int, public._twelve_starter_potions())
  on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    foreach b in array public._twelve_starter() loop
      insert into public.twelve_items (user_id, base) values (p_user, b) returning id into new_id;
      first_id := coalesce(first_id, new_id);
      last_id := new_id;
    end loop;
    update public.twelve_profiles set eq_weapon = first_id, eq_armor = last_id where user_id = p_user;
  end if;
  select * into r from public.twelve_profiles where user_id = p_user for update;
  return r;
end $$;
revoke all on function public._twelve_profile_row(uuid) from public, anon, authenticated;

-- 화면에 주는 모양 (games/twelve/src/game/progress.ts 의 TwelveProfile)
create or replace function public._twelve_state_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'level', p.level, 'exp', p.exp, 'coins', p.coins, 'stones', p.stones, 'mode', p.mode, 'hero', p.hero, 'bag', p.bag, 'potions', p.potions,
    'eq', jsonb_build_object('weapon', p.eq_weapon::text, 'armor', p.eq_armor::text, 'acc', p.eq_acc::text),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id::text, 'base', i.base, 'plus', i.plus, 'lock', i.locked, 'box', i.box) order by i.id)
      from public.twelve_items i where i.user_id = p_user), '[]'::jsonb),
    'maps', jsonb_build_object(
      'normal', coalesce((select jsonb_object_agg(m.map_id, jsonb_build_object('stars', m.stars, 'clears', m.clears, 'best', m.best))
        from public.twelve_maps m where m.user_id = p_user and m.mode = 'normal'), '{}'::jsonb),
      'hard', coalesce((select jsonb_object_agg(m.map_id, jsonb_build_object('stars', m.stars, 'clears', m.clears, 'best', m.best))
        from public.twelve_maps m where m.user_id = p_user and m.mode = 'hard'), '{}'::jsonb)),
    'keys', jsonb_build_object(
      'normal', coalesce((select jsonb_agg(k.region order by k.region) from public.twelve_keys k where k.user_id = p_user and k.mode = 'normal'), '[]'::jsonb),
      'hard', coalesce((select jsonb_agg(k.region order by k.region) from public.twelve_keys k where k.user_id = p_user and k.mode = 'hard'), '[]'::jsonb)),
    'pity', jsonb_build_object(
      'normal', coalesce((select jsonb_object_agg(t.region::text, jsonb_build_object('elite', t.elite, 'boss', t.boss, 'key', t.key))
        from public.twelve_pity t where t.user_id = p_user and t.mode = 'normal' and t.elite + t.boss + t.key > 0), '{}'::jsonb),
      'hard', coalesce((select jsonb_object_agg(t.region::text, jsonb_build_object('elite', t.elite, 'boss', t.boss, 'key', t.key))
        from public.twelve_pity t where t.user_id = p_user and t.mode = 'hard' and t.elite + t.boss + t.key > 0), '{}'::jsonb)),
    'codex', coalesce((select jsonb_agg(c.base order by c.got_at, c.base) from public.twelve_codex c where c.user_id = p_user), '[]'::jsonb),
    'tower', (select jsonb_build_object('floor', t.best_floor, 'time', t.best_time, 'level', t.level, 'hero', t.hero, 'at', t.achieved_at, 'cps', t.cps)
      from public.twelve_tower t where t.user_id = p_user)
  )
  from public.twelve_profiles p where p.user_id = p_user
$$;
revoke all on function public._twelve_state_json(uuid) from public, anon, authenticated;

-- 내 상태 읽기 (처음이면 프로필을 만든다)
create or replace function public.twelve_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._twelve_profile_row(me);
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_state() from public, anon;
grant execute on function public.twelve_state() to authenticated;

-- 가방에 든 수 (착용한 것도 가방 칸을 쓴다. 보관함은 따로)
create or replace function public._twelve_bag_count(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.twelve_items i where i.user_id = p_user and not i.box
$$;
revoke all on function public._twelve_bag_count(uuid) from public, anon, authenticated;

-- 장비를 받는다: 가방이 꽉 찼으면 보관함으로 (레어를 놓치지 않게) → { id, base, box }
create or replace function public._twelve_grant(p_user uuid, p_base text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare is_full boolean; new_id bigint;
begin
  select public._twelve_bag_count(p_user) >= p.bag into is_full from public.twelve_profiles p where p.user_id = p_user;
  insert into public.twelve_items (user_id, base, box) values (p_user, p_base, coalesce(is_full, false)) returning id into new_id;
  return jsonb_build_object('id', new_id::text, 'base', p_base, 'box', coalesce(is_full, false));
end $$;
revoke all on function public._twelve_grant(uuid, text) from public, anon, authenticated;

-- ---------- 6. 판 시작 · 끝 ----------

-- → { run, seed }. seed = 그 판의 드랍 씨앗 (화면이 무엇이 떨어질지 미리 그린다. 판정은 twelve_finish 가 다시 한다)
create or replace function public.twelve_start(p_map text, p_mode text, p_hero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  mp record;
  pr public.twelve_profiles;
  rid uuid;
  v_seed int;
  v_pct int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('normal', 'hard') then raise exception 'bad mode'; end if;
  select * into mp from public._twelve_maps() t where t.map_id = p_map and t.mode = p_mode;
  if not found then raise exception 'bad map'; end if;
  pr := public._twelve_profile_row(me);
  if not public._twelve_map_open(me, p_mode, mp.region, mp.no) then raise exception 'map locked'; end if;
  perform public._twelve_check_hero(me, p_hero);
  if pr.eq_weapon is null then raise exception 'no weapon'; end if;
  select coalesce(max(t.coin_pct), 0) into v_pct from public.twelve_items i join public._twelve_items() t on t.base = i.base
  where i.user_id = me and i.id = pr.eq_acc;
  v_seed := floor(random() * 2147483647)::int;
  insert into public.twelve_runs (user_id, map_id, mode, hero, seed, level, coin_pct)
  values (me, p_map, p_mode, p_hero, v_seed, pr.level, v_pct) returning id into rid;
  return jsonb_build_object('run', rid, 'seed', v_seed);
end $$;
revoke all on function public.twelve_start(text, text, text) from public, anon;
grant execute on function public.twelve_start(text, text, text) to authenticated;

-- p_report = { time, cleared, kills: { 종류: 수 }, elites, boss, chest, deaths, potions: [[소,중,대],[소,중,대]] | null }
-- → { state, result: { exp, coins, ups, level, stars, newStars, first, joined, siaCoin, items: [{id, base, box}], stones, potions, key, starItem } }
create or replace function public.twelve_finish(p_run uuid, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  rn public.twelve_runs;
  pr public.twelve_profiles;
  mp record;
  rg record;
  v_time int; v_cleared boolean; v_elites int; v_boss boolean; v_chest boolean; v_deaths int;
  v_kills jsonb; v_used jsonb;
  k text; v jsonb; n numeric;
  normals int := 0;
  raw_exp bigint := 0; raw_coin bigint := 0;
  pct int; n_exp bigint; n_coins bigint;
  lv int; ex bigint; nd bigint; ups int := 0;
  elapsed numeric;
  pots int[]; used int[]; got_pots int[] := array[0, 0, 0, 0, 0, 0];
  n_stars int := 0; old_stars int := 0; new_stars int := 0; first boolean := false;
  pe int := 0; pb int := 0; pk int := 0; has_key boolean := false; got_key boolean := false;
  codex text[]; rare_list text[]; gear text[]; accs text[];
  base text; items jsonb := '[]'::jsonb; n_stones int := 0;
  star_item text; joined text; got_coin boolean := false;
  seed bigint; r bigint; i int; idx int; cap int; pity boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into rn from public.twelve_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.finished_at is not null then raise exception 'already finished'; end if;
  select * into mp from public._twelve_maps() t where t.map_id = rn.map_id and t.mode = rn.mode;
  if not found then raise exception 'bad map'; end if;

  -- 1) 보고 읽기 · 검사 (src/game/progress.ts 의 checkReport)
  begin
    v_time := (p_report ->> 'time')::int;
    v_cleared := (p_report ->> 'cleared')::boolean;
    v_elites := (p_report ->> 'elites')::int;
    v_boss := (p_report ->> 'boss')::boolean;
    v_chest := (p_report ->> 'chest')::boolean;
    v_deaths := (p_report ->> 'deaths')::int;
  exception when others then raise exception 'bad result';
  end;
  if v_time is null or v_cleared is null or v_elites is null or v_boss is null or v_chest is null or v_deaths is null then raise exception 'bad result'; end if;
  if v_time < 0 or v_time > public._twelve_const('max_time') then raise exception 'bad time'; end if;
  v_kills := coalesce(p_report -> 'kills', '{}'::jsonb);
  if jsonb_typeof(v_kills) <> 'object' then raise exception 'bad kills'; end if;
  for k, v in select key, value from jsonb_each(v_kills) loop
    if not (mp.kinds ? k) or jsonb_typeof(v) <> 'number' then raise exception 'bad kills'; end if;
    n := v::text::numeric;
    if n <> floor(n) or n < 0 or n > (mp.kinds -> k ->> 0)::int then raise exception 'bad kills'; end if;
    normals := normals + n::int;
    raw_exp := raw_exp + n::int * (mp.kinds -> k ->> 1)::int;
    raw_coin := raw_coin + n::int * (mp.kinds -> k ->> 2)::int;
  end loop;
  if v_elites < 0 or v_elites > mp.elites then raise exception 'bad kills'; end if;
  if v_boss and not mp.boss then raise exception 'bad kills'; end if;
  if v_deaths < 0 then raise exception 'bad result'; end if;
  cap := public._twelve_const('potion_max')::int;
  v_used := p_report -> 'potions';
  if v_used is null or jsonb_typeof(v_used) = 'null' then
    used := array[0, 0, 0, 0, 0, 0];
  else
    if jsonb_typeof(v_used) <> 'array' or jsonb_array_length(v_used) <> 2
      or jsonb_typeof(v_used -> 0) <> 'array' or jsonb_array_length(v_used -> 0) <> 3
      or jsonb_typeof(v_used -> 1) <> 'array' or jsonb_array_length(v_used -> 1) <> 3 then raise exception 'bad potions'; end if;
    if exists (
      select 1 from jsonb_array_elements(v_used) a, jsonb_array_elements(a) e
      where jsonb_typeof(e) <> 'number' or e::text::numeric <> floor(e::text::numeric) or e::text::numeric < 0 or e::text::numeric > cap
    ) then raise exception 'bad potions'; end if;
    select array_agg((e.value)::text::int order by a.ord, e.ord) into used
    from jsonb_array_elements(v_used) with ordinality a(value, ord), jsonb_array_elements(a.value) with ordinality e(value, ord);
  end if;
  if v_cleared then
    if v_time < public._twelve_const('clear_min_time') then raise exception 'too early'; end if;
    -- 출구가 열리는 조건: 보스 맵은 보스, 그 밖에는 요괴의 exit_pct%
    if (mp.boss and not v_boss) or (not mp.boss and normals + v_elites < ceil(mp.total * public._twelve_const('exit_pct') / 100.0)) then raise exception 'bad result'; end if;
  end if;
  elapsed := extract(epoch from (now() - rn.started_at));
  if elapsed < v_time - public._twelve_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._twelve_const('max_age') then raise exception 'too late'; end if;
  if exists (
    select 1 from public.twelve_runs o
    where o.user_id = me and o.id <> rn.id and o.finished_at is not null
      and o.finished_at > rn.started_at + interval '2 seconds' and o.started_at < now() - interval '2 seconds'
  ) then raise exception 'overlap'; end if;

  -- 2) 경험치 · 엽전 (맵 표로 계산. src/game/progress.ts 의 rewardOf · applyReport)
  raw_exp := raw_exp + v_elites * mp.elite_exp + (case when v_boss then mp.boss_exp else 0 end);
  raw_coin := raw_coin + v_elites * mp.elite_coin + (case when v_boss then mp.boss_coin else 0 end) + (case when v_chest then mp.chest_coin else 0 end);
  pr := public._twelve_profile_row(me);
  select e.pct into pct from public._twelve_exp_penalty() e where pr.level - mp.level >= e.gap order by e.gap desc limit 1;
  n_exp := floor(raw_exp * coalesce(pct, 100) / 100.0);
  n_coins := case when v_cleared then floor(raw_coin * (100 + rn.coin_pct) / 100.0) else 0 end;
  lv := pr.level;
  ex := pr.exp + n_exp;
  while lv < public._twelve_const('max_level') loop
    select t.need into nd from public._twelve_levels() t where t.level = lv;
    exit when nd is null or ex < nd;
    ex := ex - nd;
    lv := lv + 1;
    ups := ups + 1;
  end loop;
  if lv >= public._twelve_const('max_level') then ex := 0; end if;
  -- 쓴 물약은 깨든 쓰러지든 빠진다
  select array_agg((e.value)::text::int order by a.ord, e.ord) into pots
  from jsonb_array_elements(pr.potions) with ordinality a(value, ord), jsonb_array_elements(a.value) with ordinality e(value, ord);
  for i in 1..6 loop pots[i] := greatest(0, pots[i] - used[i]); end loop;

  -- 3) 깬 판만: 맵 기록 · 드랍 · 확정 보정 · 열쇠 · 별 보상 · 대원 합류 (쓰러지면 그 맵의 엽전·아이템을 잃는다)
  if v_cleared then
    n_stars := (case when v_time <= mp.par then 1 else 0 end) | (case when v_deaths = 0 then 2 else 0 end) | (case when v_chest then 4 else 0 end);
    select m.stars into old_stars from public.twelve_maps m where m.user_id = me and m.mode = rn.mode and m.map_id = rn.map_id;
    first := old_stars is null;
    old_stars := coalesce(old_stars, 0);
    new_stars := n_stars & ~old_stars;
    -- 대원 합류: 이 지형 보스를 어느 모드에서든 처음 잡았다
    if mp.boss and first and not public._twelve_joined(me, mp.region) then
      select h.id into joined from public._twelve_heroes() h where h.join_region = mp.region;
    end if;
    insert into public.twelve_maps (user_id, mode, map_id, stars, clears, best) values (me, rn.mode, rn.map_id, n_stars, 1, v_time)
    on conflict (user_id, mode, map_id) do update set stars = public.twelve_maps.stars | excluded.stars, clears = public.twelve_maps.clears + 1,
      best = case when public.twelve_maps.best > 0 then least(public.twelve_maps.best, excluded.best) else excluded.best end;

    -- 드랍 (src/game/drops.ts 의 rollRun): 일반 요괴 → 정예 → 보스. 판정 종류 번호는 drops.ts 의 TAG 와 같다
    select * into rg from public._twelve_regions() t where t.mode = rn.mode and t.region = mp.region;
    seed := rn.seed;
    gear := public._twelve_gear();
    accs := public._twelve_acc();
    rare_list := rg.rares;
    select t.elite, t.boss, t.key into pe, pb, pk from public.twelve_pity t where t.user_id = me and t.mode = rn.mode and t.region = mp.region;
    pe := coalesce(pe, 0); pb := coalesce(pb, 0); pk := coalesce(pk, 0);
    select coalesce(array_agg(c.base), array[]::text[]) into codex from public.twelve_codex c where c.user_id = me;
    has_key := exists (select 1 from public.twelve_keys t where t.user_id = me and t.mode = rn.mode and t.region = mp.region);

    for i in 1..normals loop
      r := public._twelve_roll(seed, 1, i) % 10000;
      if r < public._twelve_const('drop_potion') then
        idx := (public._twelve_roll(seed, 2, i) % 2)::int * 3 + rg.potion_size + 1;
        if pots[idx] < cap then
          pots[idx] := pots[idx] + 1;
          got_pots[idx] := got_pots[idx] + 1;
        end if;
      elsif r < public._twelve_const('drop_potion') + public._twelve_const('drop_gear') then
        base := gear[(public._twelve_roll(seed, 2, i) % array_length(gear, 1))::int + 1] || rg.tier::text;
        items := items || public._twelve_grant(me, base);
      end if;
    end loop;

    for i in 1..v_elites loop
      if public._twelve_roll(seed, 3, i) % 10000 < public._twelve_const('drop_elite_stone') then n_stones := n_stones + rg.elite_stones; end if;
      if public._twelve_roll(seed, 4, i) % 10000 < public._twelve_const('drop_elite_acc') then
        base := 'c-' || accs[(public._twelve_roll(seed, 5, i) % array_length(accs, 1))::int + 1] || '-' || rg.tier::text;
        items := items || public._twelve_grant(me, base);
      end if;
      pe := pe + 1;
      base := null;
      if public._twelve_roll(seed, 6, i) % 10000 < public._twelve_const('drop_elite_rare') then pity := false;
      elsif pe >= public._twelve_const('pity_elite') then pity := true;
      else pity := null;
      end if;
      if pity is not null then
        -- 확정 보정은 아직 없는 것부터, 확률로 나온 것(또는 다 가졌으면)은 목록에서 아무거나
        if pity then select x into base from unnest(rare_list) with ordinality u(x, ord) where not (x = any(codex)) order by ord limit 1; end if;
        base := coalesce(base, rare_list[(public._twelve_roll(seed, 7, i) % array_length(rare_list, 1))::int + 1]);
        if not (base = any(codex)) then codex := codex || base; end if;
        pe := 0; pb := 0;
        items := items || public._twelve_grant(me, base);
      end if;
    end loop;

    if v_boss then
      n_stones := n_stones + rg.boss_stones;
      if public._twelve_roll(seed, 8, 1) % 10000 < public._twelve_const('drop_boss_acc') then
        base := 'c-' || accs[(public._twelve_roll(seed, 9, 1) % array_length(accs, 1))::int + 1] || '-' || rg.tier::text;
        items := items || public._twelve_grant(me, base);
      end if;
      pb := pb + 1;
      base := null;
      if public._twelve_roll(seed, 10, 1) % 10000 < public._twelve_const('drop_boss_rare') then pity := false;
      elsif pb >= public._twelve_const('pity_boss') then pity := true;
      else pity := null;
      end if;
      if pity is not null then
        if pity then select x into base from unnest(rare_list) with ordinality u(x, ord) where not (x = any(codex)) order by ord limit 1; end if;
        base := coalesce(base, rare_list[(public._twelve_roll(seed, 11, 1) % array_length(rare_list, 1))::int + 1]);
        if not (base = any(codex)) then codex := codex || base; end if;
        pe := 0; pb := 0;
        items := items || public._twelve_grant(me, base);
      end if;
      -- 열쇠: 확률, 같은 보스 pity_key 번째에는 확정. 이미 있으면 떨어지지 않는다
      if not has_key then
        pk := pk + 1;
        if public._twelve_roll(seed, 12, 1) % 10000 < public._twelve_const('drop_key') or pk >= public._twelve_const('pity_key') then
          got_key := true;
          pk := 0;
          insert into public.twelve_keys (user_id, mode, region) values (me, rn.mode, mp.region) on conflict do nothing;
        end if;
      end if;
    end if;

    insert into public.twelve_pity (user_id, mode, region, elite, boss, key) values (me, rn.mode, mp.region, pe, pb, pk)
    on conflict (user_id, mode, region) do update set elite = excluded.elite, boss = excluded.boss, key = excluded.key;

    -- 지형의 별 24개를 모두 모으면 그 지형 장신구 (모드마다 한 번)
    if not (rg.star_item = any(codex)) and (
      select coalesce(sum((m.stars & 1) + ((m.stars >> 1) & 1) + ((m.stars >> 2) & 1)), 0) from public.twelve_maps m
      where m.user_id = me and m.mode = rn.mode and m.map_id like mp.region::text || '-%'
    ) >= 24 then
      star_item := rg.star_item;
      codex := codex || star_item;
      items := items || public._twelve_grant(me, star_item);
    end if;
    insert into public.twelve_codex (user_id, base) select me, x from unnest(codex) x on conflict do nothing;

    -- 시아코인: 깬 맵마다 1. 너무 짧은 판, 내 레벨이 권장 레벨보다 coin_level_gap 이상 높은 맵은 없음 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
    if v_time >= public._twelve_const('coin_min_time') and pr.level - mp.level < public._twelve_const('coin_level_gap') then
      got_coin := public._grant_sia_coin(me, 'twelve', p_run::text);
    end if;
  end if;

  update public.twelve_profiles set
    level = lv, exp = ex, coins = coins + n_coins, stones = stones + n_stones,
    potions = jsonb_build_array(jsonb_build_array(pots[1], pots[2], pots[3]), jsonb_build_array(pots[4], pots[5], pots[6])),
    cleared_maps = (select count(*) from public.twelve_maps m where m.user_id = me),
    level_at = case when lv <> pr.level then now() else level_at end,
    updated_at = now()
  where user_id = me;
  update public.twelve_runs set finished_at = now(), time = v_time, cleared = v_cleared, exp = n_exp, coins = n_coins, report = p_report where id = rn.id;

  return jsonb_build_object(
    'state', public._twelve_state_json(me),
    'result', jsonb_build_object(
      'exp', n_exp, 'coins', n_coins, 'ups', ups, 'level', lv, 'stars', n_stars, 'newStars', new_stars, 'first', first,
      'joined', joined, 'siaCoin', got_coin, 'items', items, 'stones', n_stones,
      'potions', jsonb_build_array(jsonb_build_array(got_pots[1], got_pots[2], got_pots[3]), jsonb_build_array(got_pots[4], got_pots[5], got_pots[6])),
      'key', got_key, 'starItem', star_item
    )
  );
end $$;
revoke all on function public.twelve_finish(uuid, jsonb) from public, anon;
grant execute on function public.twelve_finish(uuid, jsonb) to authenticated;

-- ---------- 7. 대원 · 착용 · 잠금 · 보관함 (src/game/rules.ts) ----------

create or replace function public.twelve_set_hero(p_hero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._twelve_profile_row(me);
  perform public._twelve_check_hero(me, p_hero);
  update public.twelve_profiles set hero = p_hero, updated_at = now() where user_id = me;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_set_hero(text) from public, anon;
grant execute on function public.twelve_set_hero(text) to authenticated;

create or replace function public.twelve_equip(p_item bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.twelve_profiles; it public.twelve_items; d record;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._twelve_profile_row(me);
  select * into it from public.twelve_items i where i.id = p_item and i.user_id = me;
  if not found then raise exception 'no item'; end if;
  select * into d from public._twelve_items() t where t.base = it.base;
  if not found then raise exception 'no item'; end if;
  if it.box then raise exception 'bad item'; end if;
  if pr.level < public._twelve_tier_level(d.tier) then raise exception 'low level'; end if;
  update public.twelve_profiles set
    eq_weapon = case when d.slot = 'weapon' then it.id else eq_weapon end,
    eq_armor = case when d.slot = 'armor' then it.id else eq_armor end,
    eq_acc = case when d.slot = 'acc' then it.id else eq_acc end,
    updated_at = now()
  where user_id = me;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_equip(bigint) from public, anon;
grant execute on function public.twelve_equip(bigint) to authenticated;

-- 벗기 (무기는 벗을 수 없다 — 다른 무기로 바꾼다)
create or replace function public.twelve_unequip(p_slot text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_slot is null or p_slot not in ('armor', 'acc') then raise exception 'bad slot'; end if;
  perform public._twelve_profile_row(me);
  update public.twelve_profiles set
    eq_armor = case when p_slot = 'armor' then null else eq_armor end,
    eq_acc = case when p_slot = 'acc' then null else eq_acc end,
    updated_at = now()
  where user_id = me;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_unequip(text) from public, anon;
grant execute on function public.twelve_unequip(text) to authenticated;

create or replace function public.twelve_lock(p_item bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._twelve_profile_row(me);
  update public.twelve_items set locked = coalesce(p_on, false) where id = p_item and user_id = me;
  if not found then raise exception 'no item'; end if;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_lock(bigint, boolean) from public, anon;
grant execute on function public.twelve_lock(bigint, boolean) to authenticated;

-- 보관함 → 가방 (p_items 가 비었으면 들어가는 만큼 전부). 하나도 못 옮기면 'bag full'
create or replace function public.twelve_claim(p_items bigint[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.twelve_profiles; ids bigint[]; x bigint; cnt int; moved int := 0;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._twelve_profile_row(me);
  if p_items is null or coalesce(array_length(p_items, 1), 0) = 0 then
    select coalesce(array_agg(i.id order by i.id), array[]::bigint[]) into ids from public.twelve_items i where i.user_id = me and i.box;
  else
    ids := p_items;
    if exists (select 1 from unnest(ids) u(id) where u.id is null or not exists (select 1 from public.twelve_items i where i.id = u.id and i.user_id = me and i.box)) then
      raise exception 'no item';
    end if;
  end if;
  cnt := public._twelve_bag_count(me);
  foreach x in array ids loop
    exit when cnt >= pr.bag;
    update public.twelve_items set box = false where id = x and user_id = me and box;
    if found then
      cnt := cnt + 1;
      moved := moved + 1;
    end if;
  end loop;
  if moved = 0 and coalesce(array_length(ids, 1), 0) > 0 then raise exception 'bag full'; end if;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_claim(bigint[]) from public, anon;
grant execute on function public.twelve_claim(bigint[]) to authenticated;

-- ---------- 8. 상점 · 대장간 (src/game/rules.ts) ----------

-- 팔거나 분해할 수 있는지: 내 것 · 착용 중이 아님 · 잠그지 않음 (목록 순서대로 본다)
create or replace function public._twelve_check_loose(p_user uuid, p_items bigint[]) returns void
language plpgsql stable security definer set search_path = public as $$
declare pr public.twelve_profiles; x bigint; it public.twelve_items;
begin
  if p_items is null or coalesce(array_length(p_items, 1), 0) = 0
    or (select count(distinct u.id) from unnest(p_items) u(id)) <> array_length(p_items, 1) then raise exception 'bad item'; end if;
  select * into pr from public.twelve_profiles where user_id = p_user;
  foreach x in array p_items loop
    select * into it from public.twelve_items i where i.id = x and i.user_id = p_user;
    if not found or not exists (select 1 from public._twelve_items() t where t.base = it.base) then raise exception 'no item'; end if;
    if x in (pr.eq_weapon, pr.eq_armor, pr.eq_acc) then raise exception 'equipped'; end if;
    if it.locked then raise exception 'locked item'; end if;
  end loop;
end $$;
revoke all on function public._twelve_check_loose(uuid, bigint[]) from public, anon, authenticated;

create or replace function public.twelve_sell(p_items bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); gain bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._twelve_profile_row(me);
  perform public._twelve_check_loose(me, p_items);
  select coalesce(sum(t.sell), 0) into gain from public.twelve_items i join public._twelve_items() t on t.base = i.base
  where i.user_id = me and i.id = any(p_items);
  delete from public.twelve_items where user_id = me and id = any(p_items);
  update public.twelve_profiles set coins = coins + gain, updated_at = now() where user_id = me;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_sell(bigint[]) from public, anon;
grant execute on function public.twelve_sell(bigint[]) to authenticated;

-- 분해 → 강화석 (강화한 단계마다 +1)
create or replace function public.twelve_scrap(p_items bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); gain int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._twelve_profile_row(me);
  perform public._twelve_check_loose(me, p_items);
  select coalesce(sum(t.scrap + i.plus), 0) into gain from public.twelve_items i join public._twelve_items() t on t.base = i.base
  where i.user_id = me and i.id = any(p_items);
  delete from public.twelve_items where user_id = me and id = any(p_items);
  update public.twelve_profiles set stones = stones + gain, updated_at = now() where user_id = me;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_scrap(bigint[]) from public, anon;
grant execute on function public.twelve_scrap(bigint[]) to authenticated;

-- 강화 +1 (항상 성공)
create or replace function public.twelve_enhance(p_item bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.twelve_profiles; it public.twelve_items; d record; c record;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._twelve_profile_row(me);
  select * into it from public.twelve_items i where i.id = p_item and i.user_id = me for update;
  if not found then raise exception 'no item'; end if;
  select * into d from public._twelve_items() t where t.base = it.base;
  if not found then raise exception 'no item'; end if;
  if not d.enhance then raise exception 'bad item'; end if;
  if it.plus >= public._twelve_const('max_plus') then raise exception 'max plus'; end if;
  select * into c from public._twelve_enhance() t where t.tier = d.tier and t.plus = it.plus + 1;
  if not found then raise exception 'max plus'; end if;
  if pr.coins < c.coins then raise exception 'not enough coins'; end if;
  if pr.stones < c.stones then raise exception 'not enough stones'; end if;
  update public.twelve_items set plus = plus + 1 where id = it.id;
  update public.twelve_profiles set coins = coins - c.coins, stones = stones - c.stones, updated_at = now() where user_id = me;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_enhance(bigint) from public, anon;
grant execute on function public.twelve_enhance(bigint) to authenticated;

-- 사기. p_what = 장비 id('w-sword-1') · 물약('potion:<0 체력|1 마력>:<0 소|1 중|2 대>') · 가방 늘리기('bag'). p_n = 물약 수
create or replace function public.twelve_buy(p_what text, p_n int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); pr public.twelve_profiles; d record;
  price bigint; v_slot int; v_size int; idx int; pots int[]; cap int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  cap := public._twelve_const('potion_max')::int;
  if p_what is null then raise exception 'bad item'; end if;
  if p_n is null or p_n < 1 or p_n > cap then raise exception 'bad count'; end if;
  pr := public._twelve_profile_row(me);
  if p_what = 'bag' then
    select b.price into price from public._twelve_bag_prices() b where b.size = pr.bag;
    if pr.bag >= public._twelve_const('bag_max') or price is null then raise exception 'max bag'; end if;
    if pr.coins < price then raise exception 'not enough coins'; end if;
    update public.twelve_profiles set coins = coins - price, bag = bag + public._twelve_const('bag_step')::int, updated_at = now() where user_id = me;
  elsif p_what ~ '^potion:[01]:[0-9]$' then
    v_slot := split_part(p_what, ':', 2)::int;
    v_size := split_part(p_what, ':', 3)::int;
    select t.price into price from public._twelve_potions() t where t.slot = v_slot and t.size = v_size;
    if price is null then raise exception 'bad item'; end if;
    select array_agg((e.value)::text::int order by a.ord, e.ord) into pots
    from jsonb_array_elements(pr.potions) with ordinality a(value, ord), jsonb_array_elements(a.value) with ordinality e(value, ord);
    idx := v_slot * 3 + v_size + 1;
    if pots[idx] + p_n > cap then raise exception 'max potions'; end if;
    price := price * p_n;
    if pr.coins < price then raise exception 'not enough coins'; end if;
    pots[idx] := pots[idx] + p_n;
    update public.twelve_profiles set coins = coins - price,
      potions = jsonb_build_array(jsonb_build_array(pots[1], pots[2], pots[3]), jsonb_build_array(pots[4], pots[5], pots[6])), updated_at = now()
    where user_id = me;
  else
    select * into d from public._twelve_items() t where t.base = p_what;
    if not found then raise exception 'bad item'; end if;
    if p_n <> 1 then raise exception 'bad count'; end if;
    -- 일반 무기·방어구만, 열린 지형까지의 등급
    if d.buy <= 0 or d.tier > public._twelve_shop_tier(me) then raise exception 'not for sale'; end if;
    if public._twelve_bag_count(me) >= pr.bag then raise exception 'bag full'; end if;
    if pr.coins < d.buy then raise exception 'not enough coins'; end if;
    insert into public.twelve_items (user_id, base) values (me, p_what);
    update public.twelve_profiles set coins = coins - d.buy, updated_at = now() where user_id = me;
  end if;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_buy(text, int) from public, anon;
grant execute on function public.twelve_buy(text, int) to authenticated;

-- ---------- 9. 끝없는 탑 (src/game/tower.ts · src/data/tower.ts) ----------

-- 층의 종류: 보스 층(tower_cp 마다) · 정예 층(tower_elite_every 마다) · 보통 층
create or replace function public._twelve_tower_kind(p_floor int) returns text
language sql immutable as $$
  select case when p_floor % public._twelve_const('tower_cp')::int = 0 then 'boss'
    when p_floor % public._twelve_const('tower_elite_every')::int = 0 then 'elite' else 'normal' end
$$;
revoke all on function public._twelve_tower_kind(int) from public, anon, authenticated;

-- 쓴 물약 [[소,중,대],[소,중,대]] → 수 6개 (없으면 모두 0). 모양이 틀리면 'bad potions'
create or replace function public._twelve_potion_grid(p_used jsonb) returns int[]
language plpgsql immutable as $$
declare cap int := public._twelve_const('potion_max')::int; used int[];
begin
  if p_used is null or jsonb_typeof(p_used) = 'null' then return array[0, 0, 0, 0, 0, 0]; end if;
  if jsonb_typeof(p_used) <> 'array' or jsonb_array_length(p_used) <> 2
    or jsonb_typeof(p_used -> 0) <> 'array' or jsonb_array_length(p_used -> 0) <> 3
    or jsonb_typeof(p_used -> 1) <> 'array' or jsonb_array_length(p_used -> 1) <> 3 then raise exception 'bad potions'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_used) a, jsonb_array_elements(a) e
    where jsonb_typeof(e) <> 'number' or e::text::numeric <> floor(e::text::numeric) or e::text::numeric < 0 or e::text::numeric > cap
  ) then raise exception 'bad potions'; end if;
  select array_agg((e.value)::text::int order by a.ord, e.ord) into used
  from jsonb_array_elements(p_used) with ordinality a(value, ord), jsonb_array_elements(a.value) with ordinality e(value, ord);
  return used;
end $$;
revoke all on function public._twelve_potion_grid(jsonb) from public, anon, authenticated;

-- 쓴 물약을 뺀다
create or replace function public._twelve_use_potions(p_user uuid, p_used int[]) returns void
language plpgsql security definer set search_path = public as $$
declare pots int[]; i int;
begin
  select array_agg((e.value)::text::int order by a.ord, e.ord) into pots
  from public.twelve_profiles p, jsonb_array_elements(p.potions) with ordinality a(value, ord), jsonb_array_elements(a.value) with ordinality e(value, ord)
  where p.user_id = p_user;
  for i in 1..6 loop pots[i] := greatest(0, pots[i] - p_used[i]); end loop;
  update public.twelve_profiles set
    potions = jsonb_build_array(jsonb_build_array(pots[1], pots[2], pots[3]), jsonb_build_array(pots[4], pots[5], pots[6])), updated_at = now()
  where user_id = p_user;
end $$;
revoke all on function public._twelve_use_potions(uuid, int[]) from public, anon, authenticated;

-- 탑에 들어간다. p_floor = 1 또는 깬 보스 층의 다음 층(11 · 21 · …) → { run, seed, base }
-- 처음부터 누구나 들어갈 수 있고, 들어가면 1층을 못 깨도 기록(0층)이 생겨 랭킹에 보인다. 한 번에 한 판 (앞 판은 여기서 끝난다)
create or replace function public.twelve_tower_start(p_floor int, p_hero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pr public.twelve_profiles;
  cp int := public._twelve_const('tower_cp')::int;
  v_cps jsonb;
  v_base int := 0;
  v_seed int;
  v_pct int;
  rid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_floor is null or p_floor < 1 or (p_floor - 1) % cp <> 0 then raise exception 'bad floor'; end if;
  pr := public._twelve_profile_row(me);
  if p_floor > 1 then
    select t.cps into v_cps from public.twelve_tower t where t.user_id = me;
    if v_cps is null or not (v_cps ? (p_floor - 1)::text) then raise exception 'floor locked'; end if;
    v_base := (v_cps ->> (p_floor - 1)::text)::int;
  end if;
  perform public._twelve_check_hero(me, p_hero);
  if pr.eq_weapon is null then raise exception 'no weapon'; end if;
  insert into public.twelve_tower (user_id, level, hero) values (me, pr.level, p_hero) on conflict (user_id) do nothing;
  select coalesce(max(t.coin_pct), 0) into v_pct from public.twelve_items i join public._twelve_items() t on t.base = i.base
  where i.user_id = me and i.id = pr.eq_acc;
  update public.twelve_tower_runs set finished_at = now() where user_id = me and finished_at is null;
  v_seed := floor(random() * 2147483647)::int;
  insert into public.twelve_tower_runs (user_id, hero, seed, coin_pct, start_floor, floor, base_time)
  values (me, p_hero, v_seed, v_pct, p_floor, p_floor - 1, v_base) returning id into rid;
  return jsonb_build_object('run', rid, 'seed', v_seed, 'base', v_base);
end $$;
revoke all on function public.twelve_tower_start(int, text) from public, anon;
grant execute on function public.twelve_tower_start(int, text) to authenticated;

-- 깬 층 보고. p_time = 이 판에서 지금까지 논 시간(초), p_potions = 그 층에서 쓴 물약
-- → { state, result: { floor, coins, stones, items: [{id, base, box}], siaCoin, time, best } }
-- 보상은 그 자리에서 받는다 (쓰러져도 남는다). 경험치는 없다. 판정 종류 번호는 src/game/tower.ts 의 TOWER_TAG, 순번은 층
create or replace function public.twelve_tower_floor(p_run uuid, p_floor int, p_time int, p_potions jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  rn public.twelve_tower_runs;
  pr public.twelve_profiles;
  tw public.twelve_tower;
  kind text; ft int; elapsed numeric; used int[];
  tier int; seed bigint;
  n_coins bigint; n_stones int := 0; items jsonb := '[]'::jsonb;
  gear text[]; accs text[]; rare_list text[]; n_reg int; rate numeric; base text;
  total int; best boolean; got_coin boolean := false;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into rn from public.twelve_tower_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.finished_at is not null then raise exception 'already finished'; end if;

  -- 1) 검사 (src/game/tower.ts 의 checkTowerFloor)
  if p_floor is null or p_floor <> rn.floor + 1 then raise exception 'bad floor'; end if;
  if p_time is null then raise exception 'bad time'; end if;
  ft := p_time - rn.played;
  if ft > public._twelve_const('max_time') then raise exception 'bad time'; end if;
  used := public._twelve_potion_grid(p_potions);
  kind := public._twelve_tower_kind(p_floor);
  if ft < public._twelve_const(case when kind = 'boss' then 'tower_boss_min_time' else 'tower_min_time' end) then raise exception 'too early'; end if;
  elapsed := extract(epoch from (now() - rn.floor_at));
  if elapsed < ft - public._twelve_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._twelve_const('max_age') then raise exception 'too late'; end if;

  -- 2) 보상 (applyTowerFloor): 쓴 물약 → 강화석 → 일반 장비 → 장신구 → 레어 → 엽전
  pr := public._twelve_profile_row(me);
  perform public._twelve_use_potions(me, used);
  tier := public._twelve_shop_tier(me);
  seed := rn.seed;
  n_coins := (public._twelve_const('tower_coin_base') + public._twelve_const('tower_coin_step') * p_floor)
    * (case kind when 'boss' then public._twelve_const('tower_coin_boss') when 'elite' then public._twelve_const('tower_coin_elite') else 1 end);
  n_coins := floor(n_coins * (100 + rn.coin_pct) / 100.0);
  if kind = 'boss' then
    n_stones := least(public._twelve_const('tower_stone_max'), public._twelve_const('tower_stone_boss') + p_floor / public._twelve_const('tower_stone_boss_step')::int)::int;
    rate := least(public._twelve_const('tower_rare_boss_max'), public._twelve_const('tower_rare_boss') + public._twelve_const('tower_rare_boss_step') * p_floor);
  elsif kind = 'elite' then
    n_stones := least(public._twelve_const('tower_stone_max'), public._twelve_const('tower_stone_elite') + p_floor / public._twelve_const('tower_stone_elite_step')::int)::int;
    rate := least(public._twelve_const('tower_rare_elite_max'), public._twelve_const('tower_rare_elite') + public._twelve_const('tower_rare_elite_step') * p_floor);
  else
    rate := 0;
  end if;
  if kind = 'normal' then
    if public._twelve_roll(seed, 20, p_floor) % 10000 < public._twelve_const('tower_stone_rate') then n_stones := n_stones + 1; end if;
    if public._twelve_roll(seed, 21, p_floor) % 10000 < public._twelve_const('tower_gear') then
      gear := public._twelve_gear();
      base := gear[(public._twelve_roll(seed, 22, p_floor) % array_length(gear, 1))::int + 1] || tier::text;
      items := items || public._twelve_grant(me, base);
    end if;
  elsif public._twelve_roll(seed, 23, p_floor) % 10000 < public._twelve_const(case when kind = 'boss' then 'tower_acc_boss' else 'tower_acc_elite' end) then
    accs := public._twelve_acc();
    base := 'c-' || accs[(public._twelve_roll(seed, 24, p_floor) % array_length(accs, 1))::int + 1] || '-' || tier::text;
    items := items || public._twelve_grant(me, base);
  end if;
  if public._twelve_roll(seed, 25, p_floor) % 10000 < rate then
    -- 레어: 연 지형(보통 → 어려움, 지형 번호 순서) 가운데 하나의 레어 목록에서
    select count(*) into n_reg from public._twelve_regions() r
    where exists (select 1 from public._twelve_maps() m where m.mode = r.mode and m.region = r.region) and public._twelve_region_open(me, r.mode, r.region);
    select t.rares into rare_list from (
      select r.rares, row_number() over (order by (r.mode = 'hard'), r.region) as ord from public._twelve_regions() r
      where exists (select 1 from public._twelve_maps() m where m.mode = r.mode and m.region = r.region) and public._twelve_region_open(me, r.mode, r.region)
    ) t where t.ord = (public._twelve_roll(seed, 26, p_floor) % n_reg) + 1;
    base := rare_list[(public._twelve_roll(seed, 27, p_floor) % array_length(rare_list, 1))::int + 1];
    insert into public.twelve_codex (user_id, base) values (me, base) on conflict do nothing;
    items := items || public._twelve_grant(me, base);
  end if;
  update public.twelve_profiles set coins = coins + n_coins, stones = stones + n_stones, updated_at = now() where user_id = me;
  update public.twelve_tower_runs set floor = p_floor, played = p_time, floor_at = now() where id = rn.id;

  -- 3) 기록: 최고 층 → 그 층까지 걸린 시간. 보스 층은 체크포인트(가장 빠른 누적 시간)
  total := rn.base_time + p_time;
  insert into public.twelve_tower (user_id, level, hero) values (me, pr.level, rn.hero) on conflict (user_id) do nothing;
  select * into tw from public.twelve_tower where user_id = me for update;
  best := p_floor > tw.best_floor or (p_floor = tw.best_floor and total < tw.best_time);
  update public.twelve_tower set
    best_floor = case when best then p_floor else best_floor end,
    best_time = case when best then total else best_time end,
    level = case when best then pr.level else level end,
    hero = case when best then rn.hero else hero end,
    achieved_at = case when best then now() else achieved_at end,
    cps = case when kind = 'boss' then jsonb_set(cps, array[p_floor::text], to_jsonb(least(coalesce((cps ->> p_floor::text)::int, total), total))) else cps end
  where user_id = me;

  -- 시아코인: 보스 층(10층마다)을 깰 때 1개 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if kind = 'boss' then
    got_coin := public._grant_sia_coin(me, 'twelve', p_run::text || ':' || p_floor::text);
  end if;

  return jsonb_build_object(
    'state', public._twelve_state_json(me),
    'result', jsonb_build_object('floor', p_floor, 'coins', n_coins, 'stones', n_stones, 'items', items, 'siaCoin', got_coin, 'time', total, 'best', best)
  );
end $$;
revoke all on function public.twelve_tower_floor(uuid, int, int, jsonb) from public, anon;
grant execute on function public.twelve_tower_floor(uuid, int, int, jsonb) to authenticated;

-- 탑 판 끝 (쓰러졌거나 그만뒀다): 마지막 층에서 쓴 물약만 빠진다 → 새 상태
create or replace function public.twelve_tower_end(p_run uuid, p_potions jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rn public.twelve_tower_runs; used int[];
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into rn from public.twelve_tower_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.finished_at is not null then raise exception 'already finished'; end if;
  used := public._twelve_potion_grid(p_potions);
  perform public._twelve_profile_row(me);
  perform public._twelve_use_potions(me, used);
  update public.twelve_tower_runs set finished_at = now() where id = rn.id;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_tower_end(uuid, jsonb) from public, anon;
grant execute on function public.twelve_tower_end(uuid, jsonb) to authenticated;

-- ---------- 10. 랭킹 (PRD '랭킹과 시아코인') ----------

-- 레벨 랭킹: 레벨 → 경험치 → 먼저 달성한 순 (Lv99 는 먼저 도달한 사람이 위). 한 맵이라도 깬 사람만
create or replace view public.twelve_level_ranking as
  select r.user_id, p.nickname, r.level, r.exp, r.mode, r.hero,
    coalesce((select max(split_part(m.map_id, '-', 1)::int) from public.twelve_maps m
      where m.user_id = r.user_id and m.mode = r.mode and m.map_id ~ '^[0-9]+-[0-9]+$'), 1) as region,
    exists (select 1 from public.twelve_maps m where m.user_id = r.user_id and m.mode = 'hard' and m.map_id = 'final') as hard_done,
    r.level_at as achieved_at,
    (row_number() over (order by r.level desc, r.exp desc, r.level_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.twelve_profiles r join public.profiles p on p.id = r.user_id
  where r.cleared_maps > 0;
revoke all on public.twelve_level_ranking from anon, authenticated;
grant select on public.twelve_level_ranking to anon, authenticated;

-- 끝없는 탑 랭킹: 최고 층 → 그 층까지 걸린 시간 → 먼저 달성한 순. 한 번이라도 들어가 본 사람 (1층을 못 깼으면 0층)
create or replace view public.twelve_tower_ranking as
  select r.user_id, p.nickname, r.best_floor, r.best_time, r.level, r.hero, r.achieved_at,
    (row_number() over (order by r.best_floor desc, r.best_time asc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.twelve_tower r join public.profiles p on p.id = r.user_id;
revoke all on public.twelve_tower_ranking from anon, authenticated;
grant select on public.twelve_tower_ranking to anon, authenticated;

-- ---------- 게임 오픈 여부 ----------
-- 처음에는 닫힌 상태로 추가한다 (관리자만 보이고 들어갈 수 있다. 로비의 오픈 설정에서 연다)
insert into public.app_settings (key, value) values ('game_open:twelve', 'false'::jsonb) on conflict (key) do nothing;
