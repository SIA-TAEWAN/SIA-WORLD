-- 123: 시아집사 (games/nyang) — 서버 규칙 (1~6단계: 돌보기 · 놀이 · 츄르 · 선물 · 베란다 정원 · 상점 · 꾸미기 · 앨범 · 집사 랭킹)
--
-- 랜선 고양이 집사 게임. 고양이 상태 · 친밀도 · 감기는 모두 서버 시각으로 계산한다 (시아마을과 같은 방식).
-- 같은 규칙이 games/nyang/src/game/rules.ts 에 있고 (로컬 모드 · 화면 미리 보기), 값 · 표는 games/nyang/src/data/balance.ts 와 같다
-- (tests/sql.test.ts 가 두 곳을 맞춰 본다). 시각은 1970 부터의 초(bigint)로 저장한다 — 정수 계산만 써서 기기 규칙과 똑같이 나오게.
--
-- 상태 4가지는 '마지막으로 돌본 때'의 기록으로부터 바로 계산한다 (쌓아 두지 않는다):
--   배부름 = fed_amount 에서 fed_at 부터 성격의 full_sec 동안 0 까지 · 목마름 = water_at 에 가득, water_sec 동안 0 까지 (12시간이면 물이 상함)
--   청결 = 똥 개수 (poop_base 개였던 때가 poop_at, poop_sec 마다 하나, 최대 4개) · 기분 = mood_val 에서 mood_at 부터 mood_sec 동안 0 까지
-- 친밀도(1초 = 1점, 네 상태가 모두 절반 이상이고 아프지 않을 때)와 감기(상태 하나가 바닥인 채 24시간)는 _nyang_settle 이 calc_at 부터 지금까지를 반영한다.
-- 친밀도는 절대 내려가지 않는다. 고양이는 떠나거나 죽지 않는다.
--
-- 화면이 부르는 함수 (모두 { state, … } 를 돌려준다. state = { now, profile, cats }):
--   nyang_state(p_entry)                       들어올 때 entry = true → away(떠나 있던 초)
--   nyang_adopt(p_color, p_personality, p_name) → slot      'bad color' · 'bad personality' · 'bad name' · 'no room'
--   nyang_feed(p_slot, p_food)                 'bowl full' · 'bad food' · 'no cat'
--   nyang_water(p_slot)                        'water fresh'
--   nyang_clean(p_slot)  → gift(엽전), poops   'no poop'
--   nyang_pet(p_slot, p_spot) → kind(like · ok · hate), love   'too soon' · 'bad spot'
--   nyang_cure(p_slot, p_kind)                 'not sick' · 'already curing' · 'need care' · 'bad cure' · 'no medicine'
--   nyang_play_start(p_slot, p_toy)            'bad toy' · 'no toy'           (3단계: 놀아 주기 시작)
--   nyang_play(p_slot, p_catches) → catches, love, liked   'no play'   (잡은 수는 15개 · 2초에 하나까지만 센다)
--   nyang_brush(p_slot) → fur, love            'brushed today'
--   nyang_churu(p_slot, p_flavor) → love, liked, cured     'bad flavor' · 'churu full' · 'no churu'
--   nyang_gift(p_slot) → present               'no present'   (선물은 nyang_state(true) 가 고양이마다 굴린다)
--   nyang_seen(p_slot, p_behavior) → added     'bad behavior' · 'too early'   (행동 도감)
--   4단계 (베란다 정원 · 상점):
--   nyang_plant(p_pot, p_seed)                 'bad seed' · 'bad pot' · 'pot busy' · 'no seed'
--   nyang_water_pot(p_pot)                     'no plant' · 'pot ready' · 'pot wet'   (물을 준 뒤 water_sec 동안만 자란다. 마르면 멈출 뿐 시들지 않는다)
--   nyang_harvest(p_pot) → plant               'no plant' · 'not ready'
--   nyang_expand_pots() → price                'max pots' · 'no coins'
--   nyang_buy(p_item, p_n)                     'bad item' · 'bad amount' · 'locked' · 'have it' · 'no coins' · 'not enough coin'(시아코인, _spend_sia_coin)
--   nyang_sell(p_item, p_n) → coins            'bad item' · 'bad amount' · 'no item'
--   nyang_exchange(p_id)                       'bad item' · 'have it' · 'no item'   (보름달꽃 3송이 → 보름달 등)
--   nyang_treat(p_slot, p_kind) → love         'bad treat' · 'treat full' · 'no item'   (캣그라스 · 캣닢을 고양이에게)
--   5단계 (꾸미기 · 앨범):
--   nyang_place(p_layout)                      'bad layout' · 'not owned'   (방 배치 { items: [{id, x, y}], wall, floor, window } 를 한 번에 — 격자 안 · 안 겹침 · 가진 것)
--   nyang_vase(p_flower)                       'bad flower' · 'no vase' · 'no item'   (꽃병에 해바라기 · 장미, 빈 글자 = 빼기)
--   nyang_photo(p_slot, p_behavior, p_pose, p_face, p_mate, p_mate_pose) → id, added   'no cat' · 'bad behavior' · 'too early' · 'bad pose' · 'album full'
--   nyang_photo_delete(p_id)                   'no photo'
-- 돌보기 결과에는 bonus(하루 첫 돌보기 엽전)와 sia(시아코인을 받게 됐는지)가 붙는다.
-- 시아코인: 필요한 돌보기(상태가 절반 아래 → 절반 이상으로 돌아오게 한 것) 한 번에 1개, 하루(한국 시간) 최대 5개.
--   _grant_sia_coin 은 15초 간격을 지키느라 바로 못 줄 때가 있어, 못 준 것은 nyang_profiles.sia_due 에 두고 다음 요청 때 준다
--   (sia_coin_logs 의 game = 'nyang', ref = 'care:<번호>').
--
-- 6단계: 집사 랭킹 뷰 nyang_ranking (친밀도 합 → 돌본 날 수 → 먼저 달성한 순, 관리자 빼고). 아직 올리지 않았다.
-- 보관함 nyang_profiles.items = { 'toy:laser' · 'churu:tuna' · 'seed:daisy' · 'fur' · 'medicine' … : 개수 } (0 개는 지운다).
-- 표는 미리 만들어 둔다: nyang_pots · nyang_album · nyang_profiles 의 items · furniture · layout, nyang_cats 의 pattern · seen.

-- ---------- 1. 표 ----------

create table if not exists public.nyang_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),          -- 엽전 (시아집사 전용 지갑)
  items jsonb not null default '{}'::jsonb,                     -- 보관함: 사료 · 간식 · 씨앗 · 꽃 … (4단계)
  furniture jsonb not null default '[]'::jsonb,                 -- 가진 가구 (5단계)
  layout jsonb not null default '{}'::jsonb,                    -- 방 배치 · 바닥 · 벽지 · 창문 (5단계)
  seq int not null default 0 check (seq >= 0),                  -- 똥을 퍼낸 수 (모래 속 선물 번호)
  visit_at bigint not null default 0,                           -- 마지막으로 들어온 때 (0 = 처음)
  bonus_day int not null default -1,                            -- 하루 첫 돌보기 보너스를 받은 날 (한국 날짜 번호)
  care_days int not null default 0 check (care_days >= 0),      -- 돌본 날 수 (집사 랭킹)
  sia_day int not null default -1,                              -- 시아코인을 센 날
  sia_today int not null default 0 check (sia_today >= 0),      -- 그날 받기로 한 시아코인 (최대 5)
  sia_due int not null default 0 check (sia_due >= 0),          -- 아직 못 받은 시아코인
  sia_paid int not null default 0 check (sia_paid >= 0),        -- 받은 시아코인 수 (기록 번호)
  pseq int not null default 0 check (pseq >= 0),                -- 고양이 선물을 굴린 수 (선물을 정하는 번호)
  pots smallint not null default 4 check (pots between 4 and 12), -- 베란다 화분 칸 수 (4단계)
  buy_seq int not null default 0 check (buy_seq >= 0),          -- 시아코인으로 산 수 (sia_coin_spends 의 ref = 'buy:<번호>')
  photo_seq int not null default 0 check (photo_seq >= 0),      -- 찍은 사진 수 (사진 번호, 5단계)
  created_at timestamptz not null default now()
);
alter table public.nyang_profiles enable row level security;
revoke all on public.nyang_profiles from anon, authenticated;

create table if not exists public.nyang_cats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 4),          -- 입양 순서
  name text not null check (char_length(name) between 1 and 8),
  color text not null,                                          -- 털 색 (흰 그림의 털 픽셀만 바꾼다)
  pattern text,                                                 -- 털 색 위에 겹치는 무늬 (나중 단계, 지금은 null)
  personality text not null,
  adopted_at bigint not null,
  calc_at bigint not null,                                      -- 친밀도 · 감기를 마지막으로 계산한 때
  fed_at bigint not null,
  fed_amount int not null check (fed_amount between 0 and 10000),
  water_at bigint not null,
  poop_base int not null check (poop_base between 0 and 4),
  poop_at bigint not null,
  mood_val int not null check (mood_val between 0 and 10000),
  mood_at bigint not null,
  love bigint not null default 0 check (love >= 0),
  love_at bigint,                                               -- 랭킹 '먼저 달성한 순' (6단계)
  sick_at bigint,
  cure_at bigint,
  pet_day int not null default -1,
  pet_love int not null default 0,
  pet_at bigint not null default 0,
  play_at bigint not null default 0,                            -- 놀아 주기를 시작한 때 (0 = 놀고 있지 않음)
  play_toy text,
  play_day int not null default -1,
  play_love int not null default 0,                             -- 그날 놀아 주기로 오른 친밀도 (하루 상한)
  brush_day int not null default -1,                            -- 빗질한 날 (하루 한 번)
  churu_day int not null default -1,
  churu_n int not null default 0,                               -- 그날 먹은 츄르 (하루 2개)
  present_at bigint not null default 0,                         -- 선물을 마지막으로 굴린 때
  present jsonb,                                                -- 바닥에 놓인 선물 { kind, id, n } (없으면 null)
  seen jsonb not null default '[]'::jsonb,                      -- 처음 본 행동 id (행동 도감 — 화면은 5단계)
  treat_day int not null default -1,                            -- 캣그라스 · 캣닢을 먹은 날 (4단계)
  treat_n int not null default 0,                               -- 그날 먹은 수 (하루 treat_day_max)
  nip_at bigint not null default 0,                             -- 캣닢을 먹은 때 (화면은 10분 동안 우다다)
  primary key (user_id, slot)
);
alter table public.nyang_cats enable row level security;
revoke all on public.nyang_cats from anon, authenticated;

-- 베란다 화분 (4단계): 심은 화분만 줄이 있다 (빈 화분 = 줄 없음, 수확하면 지운다). 칸 수는 nyang_profiles.pots
create table if not exists public.nyang_pots (
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 12),
  plant text not null,
  planted_at bigint not null,
  grown int not null default 0 check (grown >= 0),              -- 마지막으로 물을 준 때까지 자란 초
  water_at bigint,                                              -- 마지막으로 물을 준 때 (null = 아직 안 줌)
  primary key (user_id, slot)
);
alter table public.nyang_pots enable row level security;
revoke all on public.nyang_pots from anon, authenticated;

-- 앨범 (5단계): 찍은 사진. 그림은 저장하지 않고 고양이 · 행동 · 자세 · 방향 · 털 색 · 시각만 — 화면이 다시 그린다 (사람마다 album_max 장)
create table if not exists public.nyang_album (
  user_id uuid not null references public.profiles(id) on delete cascade,
  id int not null,                                              -- 사진 번호 (nyang_profiles.photo_seq)
  slot smallint not null,
  name text not null,                                           -- 찍을 때의 이름 · 털 색
  color text not null,
  behavior text not null,
  pose text not null,
  face smallint not null check (face in (-1, 1)),
  mate_slot smallint,                                           -- 같이 찍힌 고양이 (없으면 null)
  mate_color text,
  mate_pose text,
  shot_at bigint not null,
  primary key (user_id, id)
);
alter table public.nyang_album enable row level security;
revoke all on public.nyang_album from anon, authenticated;

-- ---------- 2. 수치 (games/nyang/src/data/balance.ts 와 같다) ----------

create or replace function public._nyang_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'max' then 10000
    when 'half' then 5000
    when 'feed_full' then 9000
    when 'water_fresh' then 9000
    when 'poop_max' then 4
    when 'spoil_sec' then 43200
    when 'sick_sec' then 100800
    when 'cure_sec' then 7200
    when 'cure_need' then 7000
    when 'start_mood' then 8000
    when 'pet_gap_sec' then 8
    when 'pet_mood_like' then 2500
    when 'pet_mood' then 1500
    when 'pet_love_like' then 1000
    when 'pet_love' then 500
    when 'pet_love_day' then 6000
    when 'belly_ok_level' then 9
    when 'hate_ok_level' then 5
    when 'like_all_level' then 6
    when 'day_bonus' then 20
    when 'gift_pct' then 20
    when 'gift_min' then 3
    when 'gift_span' then 8
    when 'sia_day_max' then 5
    when 'name_max' then 8
    when 'play_sec' then 30
    when 'play_max_sec' then 180
    when 'play_catch_max' then 15
    when 'play_catch_sec' then 2
    when 'play_mood' then 700
    when 'play_mood_like' then 1000
    when 'play_love' then 1200
    when 'play_love_like' then 1600
    when 'play_love_day' then 24000
    when 'brush_mood' then 3000
    when 'brush_love' then 12000
    when 'fur_min' then 2
    when 'fur_span' then 3
    when 'churu_day_max' then 2
    when 'churu_mood' then 6000
    when 'churu_mood_like' then 8000
    when 'churu_love' then 2500
    when 'churu_love_like' then 3500
    when 'start_churu' then 3
    when 'present_gap_sec' then 14400
    when 'present_pct' then 20
    when 'present_pct_level' then 6
    when 'present_coin_pct' then 55
    when 'present_seed_pct' then 25
    when 'present_toy_pct' then 15
    when 'present_coin_min' then 5
    when 'present_coin_span' then 11
    when 'treat_day_max' then 2
    when 'nip_sec' then 600
    when 'buy_max' then 99
    when 'sell_max' then 999
    when 'pot_start' then 4
    when 'pot_max' then 12
    when 'grid_cols' then 8
    when 'grid_rows' then 5
    when 'wall_cols' then 8
    when 'wall_rows' then 2
    when 'album_max' then 60
  end
$$;
revoke all on function public._nyang_const(text) from public, anon, authenticated;

create or replace function public._nyang_table(p_name text) returns int[]
language sql immutable as $$
  select case p_name
    when 'love_need' then array[30000, 135000, 230000, 310000, 380000, 490000, 620000, 810000, 1135000]
    when 'cat_need' then array[4, 7, 10]
    when 'pot_prices' then array[100, 150, 220, 300, 400, 500, 650, 800]
  end
$$;
revoke all on function public._nyang_table(text) from public, anon, authenticated;

create or replace function public._nyang_ids(p_name text) returns text[]
language sql immutable as $$
  select case p_name
    when 'colors' then array['white', 'cream', 'cheese', 'gray', 'choco', 'black']
    when 'spots' then array['head', 'chin', 'back', 'belly']
    when 'toys' then array['rod', 'laser', 'ball', 'box']
    when 'free_toys' then array['rod']
    when 'churus' then array['tuna', 'salmon', 'chicken']
    when 'present_seeds' then array['daisy', 'catgrass', 'sunflower']
    when 'present_toys' then array['laser', 'ball', 'box']
    when 'present_furniture' then array['paw_rug', 'fish_pillow', 'yarn_basket']
    when 'poses' then array['sit', 'blink', 'walk1', 'walk2', 'loaf', 'sleep', 'eat', 'drink', 'stretch', 'pounce', 'jump', 'beg', 'knead', 'belly', 'lick0', 'lick1', 'lick2', 'lick3', 'lick4', 'lick5', 'lick6', 'lick7']
    when 'base_furniture' then array['desk', 'cushion']
    when 'base_styles' then array['wall_cream', 'floor_wood', 'window_basic']
    when 'blocked' then array['f0_2', 'f1_2', 'f2_2', 'f0_3', 'f1_3', 'f2_3', 'f4_0', 'f5_0', 'w2_0', 'w2_1', 'w3_0', 'w3_1', 'w4_0', 'w4_1', 'w5_0', 'w5_1', 'w6_0', 'w6_1', 'w7_0', 'w7_1']
    when 'vase_flowers' then array['sunflower', 'rose']
  end
$$;
revoke all on function public._nyang_ids(text) from public, anon, authenticated;

-- 성격 5종: 상태가 낮아지는 시간(초) · 쓰다듬기 좋아하는 곳 · 싫어하는 곳 · 좋아하는 장난감 · 츄르 맛
create or replace function public._nyang_personalities()
returns table (id text, full_sec int, water_sec int, poop_sec int, mood_sec int, likes text, dislikes text, toy text, churu text)
language sql immutable as $$
  select * from (values
    ('playful', 28800, 21600, 18000, 36000, 'head,back', 'belly', 'laser', 'tuna'),
    ('calm', 30600, 23400, 19800, 50400, 'chin,back', 'belly', 'rod', 'chicken'),
    ('glutton', 23400, 21600, 14400, 43200, 'chin,head', 'belly', 'ball', 'salmon'),
    ('timid', 28800, 21600, 18000, 39600, 'head', 'belly,back', 'box', 'chicken'),
    ('lazy', 34200, 25200, 21600, 46800, 'back,chin', 'belly', 'rod', 'tuna')
  ) v (id, full_sec, water_sec, poop_sec, mood_sec, likes, dislikes, toy, churu)
$$;
revoke all on function public._nyang_personalities() from public, anon, authenticated;

-- 사료: 한 번에 채우는 배부름 · 함께 오르는 기분 · 상점 한 묶음의 그릇 수 · 값(엽전). 값이 0 이면 공짜 · 무제한 (보관함을 쓰지 않는다)
create or replace function public._nyang_foods()
returns table (id text, add int, mood int, pack int, price int)
language sql immutable as $$
  select * from (values
    ('basic', 10000, 0, 0, 0),
    ('tasty', 10000, 1500, 5, 10),
    ('premium', 10000, 3000, 5, 30)
  ) v (id, add, mood, pack, price)
$$;
revoke all on function public._nyang_foods() from public, anon, authenticated;

-- 행동 도감: 행동 id · 이 친밀도 단계부터 (balance.ts 의 BEHAVIORS)
create or replace function public._nyang_behaviors()
returns table (id text, level int)
language sql immutable as $$
  select * from (values
    ('loaf', 1),
    ('window', 1),
    ('zoomies', 1),
    ('stretch', 1),
    ('knock', 1),
    ('rub', 1),
    ('box', 1),
    ('sleep', 1),
    ('eat', 1),
    ('greet', 1),
    ('present', 1),
    ('hunt', 1),
    ('churu', 1),
    ('brush', 1),
    ('sneeze', 1),
    ('lap', 3),
    ('follow', 4),
    ('belly', 6),
    ('knead', 8),
    ('together', 10),
    ('sit', 1),
    ('walk', 1),
    ('tower', 1),
    ('hide', 1),
    ('scratch', 1),
    ('groom', 1),
    ('cuddle', 1),
    ('chase', 1)
  ) v (id, level)
$$;
revoke all on function public._nyang_behaviors() from public, anon, authenticated;

-- 식물 6종 (4단계, balance.ts 의 PLANTS): 다 자라는 시간 · 물 한 번에 자라는 시간 · 씨앗이 열리는 친밀도 단계 · 씨앗 값 · 팔 때 값(0 = 안 팜)
create or replace function public._nyang_plants()
returns table (id text, grow_sec int, water_sec int, level int, seed int, sell int)
language sql immutable as $$
  select * from (values
    ('daisy', 3600, 3600, 1, 4, 8),
    ('catgrass', 7200, 7200, 1, 5, 7),
    ('sunflower', 14400, 7200, 2, 10, 24),
    ('catnip', 21600, 10800, 3, 15, 32),
    ('rose', 28800, 14400, 5, 25, 50),
    ('moonflower', 43200, 21600, 7, 50, 0)
  ) v (id, grow_sec, water_sec, level, seed, sell)
$$;
revoke all on function public._nyang_plants() from public, anon, authenticated;

-- 상점 (balance.ts 의 SHOP): 보관함 열쇠 · 탭 · 엽전 · 시아코인 · 하나 사면 받는 수 · 하나만(1) · 열리는 친밀도 단계
create or replace function public._nyang_shop()
returns table (id text, tab text, price int, sia int, give int, once int, level int)
language sql immutable as $$
  select * from (values
    ('food:tasty', 'food', 10, 0, 5, 0, 1),
    ('food:premium', 'food', 30, 0, 5, 0, 1),
    ('medicine', 'snack', 8, 0, 1, 0, 1),
    ('churu:tuna', 'churu', 0, 5, 1, 0, 1),
    ('churu:salmon', 'churu', 0, 5, 1, 0, 1),
    ('churu:chicken', 'churu', 0, 5, 1, 0, 1),
    ('seed:daisy', 'seed', 4, 0, 1, 0, 1),
    ('seed:catgrass', 'seed', 5, 0, 1, 0, 1),
    ('seed:sunflower', 'seed', 10, 0, 1, 0, 2),
    ('seed:catnip', 'seed', 15, 0, 1, 0, 3),
    ('seed:rose', 'seed', 25, 0, 1, 0, 5),
    ('seed:moonflower', 'seed', 50, 0, 1, 0, 7),
    ('toy:laser', 'toy', 60, 0, 1, 1, 1),
    ('toy:ball', 'toy', 40, 0, 1, 1, 1),
    ('toy:box', 'toy', 30, 0, 1, 1, 1),
    ('furniture:vase', 'furniture', 40, 0, 1, 1, 1),
    ('furniture:scratcher', 'furniture', 150, 0, 1, 1, 1),
    ('furniture:hideaway', 'furniture', 200, 0, 1, 1, 1),
    ('furniture:cat_tower', 'furniture', 400, 0, 1, 1, 1),
    ('furniture:zodiac_shelf', 'furniture', 0, 60, 1, 1, 1),
    ('style:wall_mint', 'style', 600, 0, 1, 1, 1),
    ('style:wall_pink', 'style', 800, 0, 1, 1, 1),
    ('style:wall_sky', 'style', 1200, 0, 1, 1, 1),
    ('style:wall_night', 'style', 2000, 0, 1, 1, 1),
    ('style:floor_maple', 'style', 600, 0, 1, 1, 1),
    ('style:floor_walnut', 'style', 900, 0, 1, 1, 1),
    ('style:floor_mint', 'style', 1200, 0, 1, 1, 1),
    ('style:floor_pink', 'style', 1800, 0, 1, 1, 1),
    ('style:window_pink', 'style', 400, 0, 1, 1, 1),
    ('style:window_mint', 'style', 600, 0, 1, 1, 1),
    ('style:window_lace', 'style', 900, 0, 1, 1, 1),
    ('style:window_star', 'style', 1500, 0, 1, 1, 1)
  ) v (id, tab, price, sia, give, once, level)
$$;
revoke all on function public._nyang_shop() from public, anon, authenticated;

-- 방에 놓을 수 있는 가구 (5단계, balance.ts 의 FURNITURE): id · 바닥(floor) / 벽(wall) 격자 · 차지하는 칸 (가로 · 세로)
create or replace function public._nyang_furniture()
returns table (id text, kind text, w int, h int)
language sql immutable as $$
  select * from (values
    ('desk', 'floor', 2, 1),
    ('cushion', 'floor', 2, 1),
    ('box', 'floor', 2, 1),
    ('vase', 'floor', 1, 1),
    ('scratcher', 'floor', 1, 1),
    ('hideaway', 'floor', 2, 1),
    ('cat_tower', 'floor', 2, 1),
    ('moon_lamp', 'floor', 1, 1),
    ('paw_rug', 'floor', 2, 1),
    ('fish_pillow', 'floor', 1, 1),
    ('yarn_basket', 'floor', 1, 1),
    ('zodiac_shelf', 'wall', 2, 1)
  ) v (id, kind, w, h)
$$;
revoke all on function public._nyang_furniture() from public, anon, authenticated;

-- 벽지 · 바닥 · 창문 (5단계, balance.ts 의 STYLES): id · 종류 · 엽전 (0 = 처음부터)
create or replace function public._nyang_styles()
returns table (id text, kind text, price int)
language sql immutable as $$
  select * from (values
    ('wall_cream', 'wall', 0),
    ('wall_mint', 'wall', 600),
    ('wall_pink', 'wall', 800),
    ('wall_sky', 'wall', 1200),
    ('wall_night', 'wall', 2000),
    ('floor_wood', 'floor', 0),
    ('floor_maple', 'floor', 600),
    ('floor_walnut', 'floor', 900),
    ('floor_mint', 'floor', 1200),
    ('floor_pink', 'floor', 1800),
    ('window_basic', 'window', 0),
    ('window_pink', 'window', 400),
    ('window_mint', 'window', 600),
    ('window_lace', 'window', 900),
    ('window_star', 'window', 1500)
  ) v (id, kind, price)
$$;
revoke all on function public._nyang_styles() from public, anon, authenticated;

-- 팔 수 있는 것 (balance.ts 의 SELL): 보관함 열쇠 · 하나에 엽전
create or replace function public._nyang_sell()
returns table (id text, price int)
language sql immutable as $$
  select * from (values
    ('plant:daisy', 8),
    ('plant:catgrass', 7),
    ('plant:sunflower', 24),
    ('plant:catnip', 32),
    ('plant:rose', 50),
    ('fur', 2)
  ) v (id, price)
$$;
revoke all on function public._nyang_sell() from public, anon, authenticated;

-- 수확물과 바꾸는 특별 가구 (balance.ts 의 EXCHANGES): 가구 id · 필요한 보관함 열쇠 · 개수
create or replace function public._nyang_exchanges()
returns table (id text, need text, n int)
language sql immutable as $$
  select * from (values
    ('moon_lamp', 'plant:moonflower', 3)
  ) v (id, need, n)
$$;
revoke all on function public._nyang_exchanges() from public, anon, authenticated;

-- 고양이에게 주는 풀 (balance.ts 의 TREAT): 기분 · 친밀도
create or replace function public._nyang_treats()
returns table (id text, mood int, love int)
language sql immutable as $$
  select * from (values
    ('catgrass', 5000, 1000),
    ('catnip', 8000, 2000)
  ) v (id, mood, love)
$$;
revoke all on function public._nyang_treats() from public, anon, authenticated;

-- ---------- 3. 계산 (games/nyang/src/game/rules.ts 와 같다) ----------

-- 서버 시각 (초). 모든 함수가 이것만 쓴다
create or replace function public._nyang_now() returns bigint
language sql stable as $$ select floor(extract(epoch from now()))::bigint $$;
revoke all on function public._nyang_now() from public, anon, authenticated;

-- 한국 날짜 번호 (2026-01-01 = 0) — balance.ts 의 kstDay
create or replace function public._nyang_day(p_t bigint) returns int
language sql immutable as $$ select floor((p_t - 1767193200)::numeric / 86400)::int $$;
revoke all on function public._nyang_day(bigint) from public, anon, authenticated;

-- 정해진 수 (시아마을 _village_mix 와 같은 식)
create or replace function public._nyang_mix(p_seq bigint, p_k int) returns int
language sql immutable as $$ select (((p_seq * 7919 + p_k * 104729 + 12345) % 1000003 + 1000003) % 1000003)::int $$;
revoke all on function public._nyang_mix(bigint, int) from public, anon, authenticated;

-- amount 에서 at 부터 dur 동안 0 까지 일정하게 줄어드는 값 · 절반 이상인 마지막 때의 다음 초 · 0 이 되는 때
create or replace function public._nyang_lin(p_amount int, p_at bigint, p_dur int, p_t bigint) returns int
language sql immutable as $$ select greatest(0, p_amount - (greatest(0, p_t - p_at) * 10000 / p_dur))::int $$;
create or replace function public._nyang_half_at(p_amount int, p_at bigint, p_dur int) returns bigint
language sql immutable as $$ select case when p_amount >= 5000 then p_at + ((p_amount - 5000 + 1)::bigint * p_dur + 10000 - 1) / 10000 else p_at end $$;
create or replace function public._nyang_zero_at(p_amount int, p_at bigint, p_dur int) returns bigint
language sql immutable as $$ select p_at + (p_amount::bigint * p_dur + 10000 - 1) / 10000 $$;
revoke all on function public._nyang_lin(int, bigint, int, bigint) from public, anon, authenticated;
revoke all on function public._nyang_half_at(int, bigint, int) from public, anon, authenticated;
revoke all on function public._nyang_zero_at(int, bigint, int) from public, anon, authenticated;

-- 고양이의 상태 4가지 · 똥 개수 · 물 상함 (rules.ts 의 fullOf · waterOf · poopsOf · cleanOf · moodOf · spoiledOf)
create or replace function public._nyang_levels(c public.nyang_cats, p_t bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare p record; poops int;
begin
  select * into p from public._nyang_personalities() x where x.id = c.personality;
  poops := least(4, c.poop_base + (greatest(0, p_t - c.poop_at) / p.poop_sec)::int);
  return jsonb_build_object(
    'full', public._nyang_lin(c.fed_amount, c.fed_at, p.full_sec, p_t),
    'water', public._nyang_lin(10000, c.water_at, p.water_sec, p_t),
    'clean', (4 - poops) * 10000 / 4,
    'mood', public._nyang_lin(c.mood_val, c.mood_at, p.mood_sec, p_t),
    'poops', poops,
    'spoiled', p_t - c.water_at >= public._nyang_const('spoil_sec'));
end $$;
revoke all on function public._nyang_levels(public.nyang_cats, bigint) from public, anon, authenticated;

-- calc_at 부터 p_t 까지를 반영한다: 친밀도 · 감기 걸림 · 나음 (rules.ts 의 settle). 표에 쓰지 않고 바뀐 줄을 돌려준다
create or replace function public._nyang_settle(c public.nyang_cats, p_t bigint) returns public.nyang_cats
language plpgsql stable set search_path = public as $$
declare p record; v_from bigint; good boolean := true; v_to bigint; fl bigint; z bigint;
begin
  if p_t <= c.calc_at then return c; end if;
  select * into p from public._nyang_personalities() x where x.id = c.personality;
  v_from := c.calc_at;
  if c.sick_at is not null then
    if c.cure_at is not null and c.cure_at <= p_t then
      v_from := greatest(v_from, c.cure_at);
      c.sick_at := null;
      c.cure_at := null;
    else
      good := false;
    end if;
  end if;
  if good then
    -- 네 상태가 모두 절반 이상인 동안 (goodUntil)
    v_to := least(
      public._nyang_half_at(c.fed_amount, c.fed_at, p.full_sec),
      public._nyang_half_at(10000, c.water_at, p.water_sec),
      case when c.poop_base <= 2 then c.poop_at + (3 - c.poop_base)::bigint * p.poop_sec else c.poop_at end,
      public._nyang_half_at(c.mood_val, c.mood_at, p.mood_sec));
    v_to := least(p_t, greatest(v_from, v_to));
    if v_to > v_from then c.love := c.love + (v_to - v_from); end if;
    -- 바닥인 상태 중 가장 먼저 바닥이 된 때 (floorSince)
    fl := null;
    foreach z in array array[
      public._nyang_zero_at(c.fed_amount, c.fed_at, p.full_sec),
      public._nyang_zero_at(10000, c.water_at, p.water_sec),
      c.poop_at + greatest(0, 4 - c.poop_base)::bigint * p.poop_sec,
      public._nyang_zero_at(c.mood_val, c.mood_at, p.mood_sec)] loop
      if z <= p_t and (fl is null or z < fl) then fl := z; end if;
    end loop;
    if fl is not null and fl + public._nyang_const('sick_sec') <= p_t then
      c.sick_at := greatest(fl + public._nyang_const('sick_sec'), v_from);
    end if;
  end if;
  c.calc_at := p_t;
  return c;
end $$;
revoke all on function public._nyang_settle(public.nyang_cats, bigint) from public, anon, authenticated;

-- 친밀도 점수 → 단계 (1 ~ 10)
create or replace function public._nyang_level(p_love bigint) returns int
language plpgsql immutable as $$
declare rest bigint := greatest(0, p_love); need int; lv int := 1;
begin
  foreach need in array public._nyang_table('love_need') loop
    if rest < need then return lv; end if;
    rest := rest - need;
    lv := lv + 1;
  end loop;
  return lv;
end $$;
revoke all on function public._nyang_level(bigint) from public, anon, authenticated;

-- 쓰다듬는 곳: like · ok · hate (rules.ts 의 spotKind)
create or replace function public._nyang_spot_kind(c public.nyang_cats, p_spot text) returns text
language plpgsql stable set search_path = public as $$
declare p record; lv int := public._nyang_level(c.love); likes text[]; dislikes text[]; ok_lv int;
begin
  select * into p from public._nyang_personalities() x where x.id = c.personality;
  likes := string_to_array(p.likes, ',');
  dislikes := string_to_array(p.dislikes, ',');
  ok_lv := public._nyang_const(case when p_spot = 'belly' then 'belly_ok_level' else 'hate_ok_level' end);
  if p_spot = any(dislikes) and lv < ok_lv then return 'hate'; end if;
  if p_spot = any(likes) then return 'like'; end if;
  if lv >= public._nyang_const('like_all_level') and not (p_spot = any(dislikes)) then return 'like'; end if;
  return 'ok';
end $$;
revoke all on function public._nyang_spot_kind(public.nyang_cats, text) from public, anon, authenticated;

-- ---------- 4. 내부 도우미 ----------

-- 로그인한 사람 (프로필 줄을 만들고 잠근다 — 잠금 순서는 늘 nyang_profiles → nyang_cats → wallets)
create or replace function public._nyang_me() returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._ensure_wallet(me);
  insert into public.nyang_profiles (user_id) values (me) on conflict (user_id) do nothing;
  perform 1 from public.nyang_profiles where user_id = me for update;
  return me;
end $$;
revoke all on function public._nyang_me() from public, anon, authenticated;

-- 내 고양이 한 마리를 잠그고 지금까지 반영한 줄
create or replace function public._nyang_cat(p_user uuid, p_slot int, p_t bigint) returns public.nyang_cats
language plpgsql security definer set search_path = public as $$
declare c public.nyang_cats;
begin
  select * into c from public.nyang_cats where user_id = p_user and slot = p_slot for update;
  if not found then raise exception 'no cat'; end if;
  return public._nyang_settle(c, p_t);
end $$;
revoke all on function public._nyang_cat(uuid, int, bigint) from public, anon, authenticated;

-- 고양이 줄 저장 (돌보기 기록 · 친밀도 · 감기 · 쓰다듬기). love_at 은 여기서만 정한다 (기기 규칙에는 없다 — 랭킹용)
create or replace function public._nyang_save(c public.nyang_cats) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.nyang_cats set
    calc_at = c.calc_at, fed_at = c.fed_at, fed_amount = c.fed_amount, water_at = c.water_at, poop_base = c.poop_base, poop_at = c.poop_at,
    mood_val = c.mood_val, mood_at = c.mood_at, love = c.love,
    -- 친밀도가 오른 때 = 지금 친밀도에 닿은 때 (집사 랭킹의 '먼저 달성한 순')
    love_at = case when c.love > nyang_cats.love then public._nyang_now() else nyang_cats.love_at end, sick_at = c.sick_at, cure_at = c.cure_at,
    pet_day = c.pet_day, pet_love = c.pet_love, pet_at = c.pet_at,
    play_at = c.play_at, play_toy = c.play_toy, play_day = c.play_day, play_love = c.play_love, brush_day = c.brush_day,
    churu_day = c.churu_day, churu_n = c.churu_n, present_at = c.present_at, present = c.present, seen = c.seen,
    treat_day = c.treat_day, treat_n = c.treat_n, nip_at = c.nip_at
  where user_id = c.user_id and slot = c.slot;
end $$;
revoke all on function public._nyang_save(public.nyang_cats) from public, anon, authenticated;

-- 못 받은 시아코인 주기 (15초 간격 때문에 못 주면 다음 요청 때)
create or replace function public._nyang_pay(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.nyang_profiles;
begin
  select * into pr from public.nyang_profiles where user_id = p_user;
  while pr.sia_due > 0 loop
    exit when not public._grant_sia_coin(p_user, 'nyang', 'care:' || (pr.sia_paid + 1));
    pr.sia_due := pr.sia_due - 1;
    pr.sia_paid := pr.sia_paid + 1;
  end loop;
  update public.nyang_profiles set sia_due = pr.sia_due, sia_paid = pr.sia_paid where user_id = p_user;
end $$;
revoke all on function public._nyang_pay(uuid) from public, anon, authenticated;

-- 돌보기 한 번의 공통 처리: 하루 첫 돌보기 엽전 · 필요한 돌보기면 시아코인 (rules.ts 의 care) → { bonus, sia }
create or replace function public._nyang_care(p_user uuid, p_needed boolean, p_t bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr public.nyang_profiles; day int := public._nyang_day(p_t); bonus int := 0; sia boolean := false;
begin
  select * into pr from public.nyang_profiles where user_id = p_user;
  if pr.bonus_day <> day then
    pr.bonus_day := day;
    pr.care_days := pr.care_days + 1;
    pr.coins := pr.coins + public._nyang_const('day_bonus');
    bonus := public._nyang_const('day_bonus');
  end if;
  if p_needed then
    if pr.sia_day <> day then
      pr.sia_day := day;
      pr.sia_today := 0;
    end if;
    if pr.sia_today < public._nyang_const('sia_day_max') then
      pr.sia_today := pr.sia_today + 1;
      pr.sia_due := pr.sia_due + 1;
      sia := true;
    end if;
  end if;
  update public.nyang_profiles set bonus_day = pr.bonus_day, care_days = pr.care_days, coins = pr.coins,
    sia_day = pr.sia_day, sia_today = pr.sia_today, sia_due = pr.sia_due where user_id = p_user;
  return jsonb_build_object('bonus', bonus, 'sia', sia);
end $$;
revoke all on function public._nyang_care(uuid, boolean, bigint) from public, anon, authenticated;

-- 보관함 개수 (rules.ts 의 itemCount)
create or replace function public._nyang_item(p_user uuid, p_key text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (pr.items->>p_key)::int from public.nyang_profiles pr where pr.user_id = p_user), 0)
$$;
revoke all on function public._nyang_item(uuid, text) from public, anon, authenticated;

-- 보관함에 n 개 더하기 · 0 개 이하면 열쇠를 지운다 (rules.ts 의 addItem)
create or replace function public._nyang_add_item(p_user uuid, p_key text, p_n int) returns void
language plpgsql security definer set search_path = public as $$
declare v int := public._nyang_item(p_user, p_key) + p_n;
begin
  update public.nyang_profiles set items = case when v <= 0 then items - p_key else items || jsonb_build_object(p_key, v) end
  where user_id = p_user;
end $$;
revoke all on function public._nyang_add_item(uuid, text, int) from public, anon, authenticated;

-- 장난감을 가지고 있는지 (낚싯대는 처음부터 — rules.ts 의 hasToy)
create or replace function public._nyang_has_toy(p_user uuid, p_toy text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_toy = any(public._nyang_ids('free_toys')) or public._nyang_item(p_user, 'toy:' || p_toy) > 0
$$;
revoke all on function public._nyang_has_toy(uuid, text) from public, anon, authenticated;

-- 들어올 때 고양이 한 마리의 선물 굴리기 (rules.ts 의 rollPresent). 굴렸으면 nyang_profiles.pseq 를 올리고 바뀐 고양이 줄을 돌려준다
create or replace function public._nyang_roll_present(p_user uuid, c public.nyang_cats, p_t bigint) returns public.nyang_cats
language plpgsql security definer set search_path = public as $$
declare q int; lv int; k int; pct int; coin jsonb; missing text[];
begin
  if c.present is not null or c.sick_at is not null or p_t - c.present_at < public._nyang_const('present_gap_sec') then return c; end if;
  c.present_at := p_t;
  update public.nyang_profiles set pseq = pseq + 1 where user_id = p_user returning pseq into q;
  lv := public._nyang_level(c.love);
  pct := public._nyang_const('present_pct') + lv * public._nyang_const('present_pct_level');
  if public._nyang_mix(q, 1) % 100 >= pct then return c; end if;
  k := public._nyang_mix(q, 2) % 100;
  coin := jsonb_build_object('kind', 'coin', 'id', 'coin',
    'n', public._nyang_const('present_coin_min') + lv * 2 + public._nyang_mix(q, 3) % public._nyang_const('present_coin_span'));
  if k < public._nyang_const('present_coin_pct') then
    c.present := coin;
  elsif k < public._nyang_const('present_coin_pct') + public._nyang_const('present_seed_pct') then
    c.present := jsonb_build_object('kind', 'seed',
      'id', (public._nyang_ids('present_seeds'))[1 + public._nyang_mix(q, 3) % cardinality(public._nyang_ids('present_seeds'))],
      'n', 1 + public._nyang_mix(q, 4) % 2);
  elsif k < public._nyang_const('present_coin_pct') + public._nyang_const('present_seed_pct') + public._nyang_const('present_toy_pct') then
    select array_agg(x order by o) into missing
      from unnest(public._nyang_ids('present_toys')) with ordinality u(x, o) where not public._nyang_has_toy(p_user, x);
    if coalesce(cardinality(missing), 0) = 0 then
      c.present := coin;
    else
      c.present := jsonb_build_object('kind', 'toy', 'id', missing[1 + public._nyang_mix(q, 3) % cardinality(missing)], 'n', 1);
    end if;
  else
    c.present := jsonb_build_object('kind', 'furniture',
      'id', (public._nyang_ids('present_furniture'))[1 + public._nyang_mix(q, 3) % cardinality(public._nyang_ids('present_furniture'))], 'n', 1);
  end if;
  return c;
end $$;
revoke all on function public._nyang_roll_present(uuid, public.nyang_cats, bigint) from public, anon, authenticated;

-- 화면에 보내는 상태 (rules.ts 의 NyangState 와 같은 모양)
create or replace function public._nyang_json(p_user uuid, p_t bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', p_t,
    'profile', (select jsonb_build_object('coins', pr.coins, 'seq', pr.seq, 'visitAt', pr.visit_at, 'bonusDay', pr.bonus_day, 'careDays', pr.care_days,
        'siaDay', pr.sia_day, 'siaToday', pr.sia_today, 'siaDue', pr.sia_due, 'siaPaid', pr.sia_paid,
        'sia', coalesce((select w.sia_coins from public.wallets w where w.user_id = p_user), 0),
        'items', pr.items, 'furniture', pr.furniture, 'pseq', pr.pseq, 'pots', pr.pots, 'buySeq', pr.buy_seq,
        'layout', pr.layout, 'photoSeq', pr.photo_seq)
      from public.nyang_profiles pr where pr.user_id = p_user),
    'cats', coalesce((select jsonb_agg(jsonb_build_object('slot', c.slot, 'name', c.name, 'color', c.color, 'pattern', c.pattern, 'personality', c.personality,
        'adoptedAt', c.adopted_at, 'calcAt', c.calc_at, 'fedAt', c.fed_at, 'fedAmount', c.fed_amount, 'waterAt', c.water_at,
        'poopBase', c.poop_base, 'poopAt', c.poop_at, 'moodVal', c.mood_val, 'moodAt', c.mood_at, 'love', c.love,
        'sickAt', c.sick_at, 'cureAt', c.cure_at, 'petDay', c.pet_day, 'petLove', c.pet_love, 'petAt', c.pet_at,
        'playAt', c.play_at, 'playToy', c.play_toy, 'playDay', c.play_day, 'playLove', c.play_love, 'brushDay', c.brush_day,
        'churuDay', c.churu_day, 'churuN', c.churu_n, 'presentAt', c.present_at, 'present', c.present, 'seen', c.seen,
        'treatDay', c.treat_day, 'treatN', c.treat_n, 'nipAt', c.nip_at) order by c.slot)
      from public.nyang_cats c where c.user_id = p_user), '[]'::jsonb),
    'pots', coalesce((select jsonb_agg(jsonb_build_object('slot', p.slot, 'plant', p.plant, 'plantedAt', p.planted_at, 'grown', p.grown, 'waterAt', p.water_at)
        order by p.slot) from public.nyang_pots p where p.user_id = p_user), '[]'::jsonb),
    'album', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'slot', a.slot, 'name', a.name, 'color', a.color, 'behavior', a.behavior, 'pose', a.pose,
        'face', a.face, 'mate', case when a.mate_slot is null then null else jsonb_build_object('slot', a.mate_slot, 'color', a.mate_color, 'pose', a.mate_pose) end,
        'at', a.shot_at) order by a.id) from public.nyang_album a where a.user_id = p_user), '[]'::jsonb))
$$;
revoke all on function public._nyang_json(uuid, bigint) from public, anon, authenticated;

-- ---------- 5. 화면이 부르는 함수 ----------

-- 내 상태 (모든 고양이를 지금까지 반영해 저장한다). entry: 게임에 들어올 때만 true → 마지막 방문 시각을 바꾸고 away(초)
create or replace function public.nyang_state(p_entry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; v_away bigint := 0; va bigint;
begin
  for c in select * from public.nyang_cats where user_id = me order by slot for update loop
    c := public._nyang_settle(c, t);
    -- 고양이마다 선물을 물어 왔는지 (rules.ts 의 rollPresent)
    if p_entry then c := public._nyang_roll_present(me, c, t); end if;
    perform public._nyang_save(c);
  end loop;
  if p_entry then
    select visit_at into va from public.nyang_profiles where user_id = me;
    v_away := case when va > 0 then greatest(0, t - va) else 0 end;
    update public.nyang_profiles set visit_at = t where user_id = me;
  end if;
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t), 'away', v_away);
end $$;
revoke all on function public.nyang_state(boolean) from public;
grant execute on function public.nyang_state(boolean) to authenticated;

-- 입양 (rules.ts 의 adopt): 첫 고양이는 그냥, 둘째부터는 첫 고양이의 친밀도 단계 4 · 7 · 10
create or replace function public.nyang_adopt(p_color text, p_personality text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); nm text; n int; room int := 1; lv int; c public.nyang_cats; need int;
begin
  for c in select * from public.nyang_cats where user_id = me order by slot for update loop
    perform public._nyang_save(public._nyang_settle(c, t));
  end loop;
  if p_color is null or not (p_color = any(public._nyang_ids('colors'))) then raise exception 'bad color'; end if;
  if p_personality is null or not exists (select 1 from public._nyang_personalities() x where x.id = p_personality) then raise exception 'bad personality'; end if;
  nm := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if char_length(nm) < 1 or char_length(nm) > public._nyang_const('name_max') or nm !~ '^[가-힣a-zA-Z0-9]+( [가-힣a-zA-Z0-9]+)*$' then raise exception 'bad name'; end if;
  select count(*) into n from public.nyang_cats where user_id = me;
  select public._nyang_level(love) into lv from public.nyang_cats where user_id = me and slot = 1;
  foreach need in array public._nyang_table('cat_need') loop
    if coalesce(lv, 0) >= need then room := room + 1; end if;
  end loop;
  if n >= least(4, room) then raise exception 'no room'; end if;
  insert into public.nyang_cats (user_id, slot, name, color, pattern, personality, adopted_at, calc_at, fed_at, fed_amount, water_at, poop_base, poop_at, mood_val, mood_at)
    values (me, n + 1, nm, p_color, null, p_personality, t, t, t, 10000, t, 0, t, public._nyang_const('start_mood'), t);
  update public.nyang_cats set present_at = t where user_id = me and slot = n + 1;
  if n = 0 then
    perform public._nyang_add_item(me, 'churu:' || (select x.churu from public._nyang_personalities() x where x.id = p_personality), public._nyang_const('start_churu'));
  end if;
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t), 'slot', n + 1);
end $$;
revoke all on function public.nyang_adopt(text, text, text) from public;
grant execute on function public.nyang_adopt(text, text, text) to authenticated;

-- 밥 주기 (rules.ts 의 feed)
create or replace function public.nyang_feed(p_slot int, p_food text default 'basic') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; f record; before int; after int; m int; r jsonb;
begin
  select * into f from public._nyang_foods() x where x.id = p_food;
  if not found then raise exception 'bad food'; end if;
  c := public._nyang_cat(me, p_slot, t);
  before := (public._nyang_levels(c, t)->>'full')::int;
  if before >= public._nyang_const('feed_full') then raise exception 'bowl full'; end if;
  -- 상점 사료는 보관함에서 하나 (기본 사료는 공짜)
  if f.price > 0 then
    if public._nyang_item(me, 'food:' || f.id) < 1 then raise exception 'no food'; end if;
    perform public._nyang_add_item(me, 'food:' || f.id, -1);
  end if;
  after := least(10000, before + f.add);
  c.fed_amount := after;
  c.fed_at := t;
  if f.mood > 0 then
    m := (public._nyang_levels(c, t)->>'mood')::int;
    c.mood_val := least(10000, m + f.mood);
    c.mood_at := t;
  end if;
  perform public._nyang_save(c);
  r := public._nyang_care(me, before < 5000 and after >= 5000, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_feed(int, text) from public;
grant execute on function public.nyang_feed(int, text) to authenticated;

-- 물 갈기 (rules.ts 의 water)
create or replace function public.nyang_water(p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; lv jsonb; before int; spoiled boolean; r jsonb;
begin
  c := public._nyang_cat(me, p_slot, t);
  lv := public._nyang_levels(c, t);
  before := (lv->>'water')::int;
  spoiled := (lv->>'spoiled')::boolean;
  if before >= public._nyang_const('water_fresh') and not spoiled then raise exception 'water fresh'; end if;
  c.water_at := t;
  perform public._nyang_save(c);
  r := public._nyang_care(me, before < 5000 or spoiled, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_water(int) from public;
grant execute on function public.nyang_water(int) to authenticated;

-- 똥 하나 퍼내기 (rules.ts 의 clean) → gift(모래 속 엽전, 없으면 0) · poops(남은 똥)
create or replace function public.nyang_clean(p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; iv int; n int; before int; v_seq int; gift int := 0; r jsonb;
begin
  c := public._nyang_cat(me, p_slot, t);
  select x.poop_sec into iv from public._nyang_personalities() x where x.id = c.personality;
  n := (greatest(0, t - c.poop_at) / iv)::int;
  if c.poop_base + n >= 4 then
    c.poop_at := c.poop_at + greatest(0, 4 - c.poop_base)::bigint * iv;
    c.poop_base := 4;
  else
    c.poop_base := c.poop_base + n;
    c.poop_at := c.poop_at + n::bigint * iv;
  end if;
  before := c.poop_base;
  if before <= 0 then raise exception 'no poop'; end if;
  if before >= 4 then c.poop_at := t; end if;
  c.poop_base := before - 1;
  perform public._nyang_save(c);
  update public.nyang_profiles set seq = nyang_profiles.seq + 1 where user_id = me returning nyang_profiles.seq into v_seq;
  if public._nyang_mix(v_seq, 1) % 100 < public._nyang_const('gift_pct') then
    gift := public._nyang_const('gift_min') + public._nyang_mix(v_seq, 2) % public._nyang_const('gift_span');
    update public.nyang_profiles set coins = coins + gift where user_id = me;
  end if;
  r := public._nyang_care(me, before = 3, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t), 'gift', gift, 'poops', c.poop_base);
end $$;
revoke all on function public.nyang_clean(int) from public;
grant execute on function public.nyang_clean(int) to authenticated;

-- 쓰다듬기 (rules.ts 의 pet) → kind(like · ok · hate = 냥펀치) · love(오른 친밀도)
create or replace function public.nyang_pet(p_slot int, p_spot text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; kind text; before int; after int; day int; add int; r jsonb;
begin
  if p_spot is null or not (p_spot = any(public._nyang_ids('spots'))) then raise exception 'bad spot'; end if;
  c := public._nyang_cat(me, p_slot, t);
  if t - c.pet_at < public._nyang_const('pet_gap_sec') then raise exception 'too soon'; end if;
  kind := public._nyang_spot_kind(c, p_spot);
  c.pet_at := t;
  if kind = 'hate' then
    perform public._nyang_save(c);
    perform public._nyang_pay(me);
    return jsonb_build_object('state', public._nyang_json(me, t), 'kind', kind, 'love', 0, 'bonus', 0, 'sia', false);
  end if;
  before := (public._nyang_levels(c, t)->>'mood')::int;
  after := least(10000, before + case when kind = 'like' then public._nyang_const('pet_mood_like') else public._nyang_const('pet_mood') end);
  c.mood_val := after;
  c.mood_at := t;
  day := public._nyang_day(t);
  if c.pet_day <> day then
    c.pet_day := day;
    c.pet_love := 0;
  end if;
  add := case when c.sick_at is not null then 0 else greatest(0, least(
    case when kind = 'like' then public._nyang_const('pet_love_like') else public._nyang_const('pet_love') end,
    public._nyang_const('pet_love_day') - c.pet_love)) end;
  c.love := c.love + add;
  c.pet_love := c.pet_love + add;
  perform public._nyang_save(c);
  r := public._nyang_care(me, before < 5000 and after >= 5000, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t), 'kind', kind, 'love', add);
end $$;
revoke all on function public.nyang_pet(int, text) from public;
grant execute on function public.nyang_pet(int, text) to authenticated;

-- 감기 낫게 하기 (rules.ts 의 cure): 담요(네 상태를 모두 채운 뒤) · 약 간식(보관함의 medicine 하나). cure_sec 뒤에 낫는다
create or replace function public.nyang_cure(p_slot int, p_kind text default 'blanket') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; lv jsonb; need int := public._nyang_const('cure_need');
begin
  if p_kind is null or p_kind not in ('blanket', 'medicine') then raise exception 'bad cure'; end if;
  c := public._nyang_cat(me, p_slot, t);
  if c.sick_at is null then raise exception 'not sick'; end if;
  if c.cure_at is not null then raise exception 'already curing'; end if;
  if p_kind = 'medicine' then
    if public._nyang_item(me, 'medicine') < 1 then raise exception 'no medicine'; end if;
    perform public._nyang_add_item(me, 'medicine', -1);
  else
    lv := public._nyang_levels(c, t);
    if (lv->>'full')::int < need or (lv->>'water')::int < need or (lv->>'clean')::int < need or (lv->>'mood')::int < need or (lv->>'spoiled')::boolean then
      raise exception 'need care';
    end if;
  end if;
  c.cure_at := t + public._nyang_const('cure_sec');
  perform public._nyang_save(c);
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_cure(int, text) from public;
grant execute on function public.nyang_cure(int, text) to authenticated;

-- ---------- 5-2. 놀아 주기 · 빗질 · 츄르 · 선물 · 행동 도감 (3단계) ----------

-- 놀아 주기 시작 (rules.ts 의 playStart): 장난감을 가지고 있어야 한다
create or replace function public.nyang_play_start(p_slot int, p_toy text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats;
begin
  if p_toy is null or not (p_toy = any(public._nyang_ids('toys'))) then raise exception 'bad toy'; end if;
  c := public._nyang_cat(me, p_slot, t);
  if not public._nyang_has_toy(me, p_toy) then raise exception 'no toy'; end if;
  c.play_at := t;
  c.play_toy := p_toy;
  perform public._nyang_save(c);
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_play_start(int, text) from public;
grant execute on function public.nyang_play_start(int, text) to authenticated;

-- 놀아 주기 끝 (rules.ts 의 play) → catches(센 수) · love · liked. 잡은 수는 play_catch_max 개, 시작부터 play_catch_sec 초에 하나까지만
create or replace function public.nyang_play(p_slot int, p_catches int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; p record; n int; liked boolean; sick boolean;
  mood int; before int; after int; day int; add int; r jsonb;
begin
  c := public._nyang_cat(me, p_slot, t);
  if c.play_at = 0 or c.play_toy is null or t - c.play_at > public._nyang_const('play_max_sec') then raise exception 'no play'; end if;
  select * into p from public._nyang_personalities() x where x.id = c.personality;
  n := greatest(0, least(coalesce(p_catches, 0), public._nyang_const('play_catch_max'), ((t - c.play_at) / public._nyang_const('play_catch_sec'))::int));
  liked := p.toy = c.play_toy;
  sick := c.sick_at is not null;
  mood := n * public._nyang_const(case when liked then 'play_mood_like' else 'play_mood' end);
  if sick then mood := mood / 2; end if;
  before := (public._nyang_levels(c, t)->>'mood')::int;
  after := least(10000, before + mood);
  c.mood_val := after;
  c.mood_at := t;
  day := public._nyang_day(t);
  if c.play_day <> day then
    c.play_day := day;
    c.play_love := 0;
  end if;
  add := case when sick then 0 else greatest(0, least(n * public._nyang_const(case when liked then 'play_love_like' else 'play_love' end),
    public._nyang_const('play_love_day') - c.play_love)) end;
  c.love := c.love + add;
  c.play_love := c.play_love + add;
  c.play_at := 0;
  c.play_toy := null;
  perform public._nyang_save(c);
  r := public._nyang_care(me, before < 5000 and after >= 5000, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t), 'catches', n, 'love', add, 'liked', liked);
end $$;
revoke all on function public.nyang_play(int, int) from public;
grant execute on function public.nyang_play(int, int) to authenticated;

-- 빗질 (rules.ts 의 brush): 고양이마다 하루 한 번 → fur(털 뭉치) · love
create or replace function public.nyang_brush(p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; day int := public._nyang_day(t);
  before int; after int; add int; fur int; r jsonb;
begin
  c := public._nyang_cat(me, p_slot, t);
  if c.brush_day = day then raise exception 'brushed today'; end if;
  c.brush_day := day;
  before := (public._nyang_levels(c, t)->>'mood')::int;
  after := least(10000, before + public._nyang_const('brush_mood'));
  c.mood_val := after;
  c.mood_at := t;
  add := case when c.sick_at is not null then 0 else public._nyang_const('brush_love') end;
  c.love := c.love + add;
  fur := public._nyang_const('fur_min') + public._nyang_mix(day * 4 + c.slot, 5) % public._nyang_const('fur_span');
  perform public._nyang_save(c);
  perform public._nyang_add_item(me, 'fur', fur);
  r := public._nyang_care(me, before < 5000 and after >= 5000, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t), 'fur', fur, 'love', add);
end $$;
revoke all on function public.nyang_brush(int) from public;
grant execute on function public.nyang_brush(int) to authenticated;

-- 츄르 (rules.ts 의 churu): 고양이마다 하루 churu_day_max 개, 보관함의 'churu:<맛>' 하나 → love · liked · cured(아파서 낫기 시작)
create or replace function public.nyang_churu(p_slot int, p_flavor text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; day int := public._nyang_day(t);
  liked boolean; before int; after int; add int := 0; cured boolean := false; r jsonb;
begin
  if p_flavor is null or not (p_flavor = any(public._nyang_ids('churus'))) then raise exception 'bad flavor'; end if;
  c := public._nyang_cat(me, p_slot, t);
  if c.churu_day <> day then
    c.churu_day := day;
    c.churu_n := 0;
  end if;
  if c.churu_n >= public._nyang_const('churu_day_max') then raise exception 'churu full'; end if;
  if public._nyang_item(me, 'churu:' || p_flavor) < 1 then raise exception 'no churu'; end if;
  perform public._nyang_add_item(me, 'churu:' || p_flavor, -1);
  c.churu_n := c.churu_n + 1;
  liked := (select x.churu from public._nyang_personalities() x where x.id = c.personality) = p_flavor;
  before := (public._nyang_levels(c, t)->>'mood')::int;
  after := least(10000, before + public._nyang_const(case when liked then 'churu_mood_like' else 'churu_mood' end));
  c.mood_val := after;
  c.mood_at := t;
  if c.sick_at is not null then
    if c.cure_at is null then
      c.cure_at := t + public._nyang_const('cure_sec');
      cured := true;
    end if;
  else
    add := public._nyang_const(case when liked then 'churu_love_like' else 'churu_love' end);
  end if;
  c.love := c.love + add;
  perform public._nyang_save(c);
  r := public._nyang_care(me, before < 5000 and after >= 5000, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t), 'love', add, 'liked', liked, 'cured', cured);
end $$;
revoke all on function public.nyang_churu(int, text) from public;
grant execute on function public.nyang_churu(int, text) to authenticated;

-- 선물 줍기 (rules.ts 의 gift) → present { kind, id, n }: 엽전 · 보관함(씨앗 · 장난감) · 가구
create or replace function public.nyang_gift(p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; g jsonb;
begin
  c := public._nyang_cat(me, p_slot, t);
  g := c.present;
  if g is null then raise exception 'no present'; end if;
  if g->>'kind' = 'coin' then
    update public.nyang_profiles set coins = coins + (g->>'n')::int where user_id = me;
  elsif g->>'kind' = 'furniture' then
    update public.nyang_profiles set furniture = furniture || jsonb_build_array(g->>'id') where user_id = me;
  else
    perform public._nyang_add_item(me, case when g->>'kind' = 'seed' then 'seed:' else 'toy:' end || (g->>'id'), (g->>'n')::int);
  end if;
  c.present := null;
  perform public._nyang_save(c);
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t), 'present', g);
end $$;
revoke all on function public.nyang_gift(int) from public;
grant execute on function public.nyang_gift(int) to authenticated;

-- 처음 본 행동을 도감에 (rules.ts 의 seen) → added
create or replace function public.nyang_seen(p_slot int, p_behavior text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; need int; added boolean;
begin
  select b.level into need from public._nyang_behaviors() b where b.id = p_behavior;
  if not found then raise exception 'bad behavior'; end if;
  c := public._nyang_cat(me, p_slot, t);
  if public._nyang_level(c.love) < need then raise exception 'too early'; end if;
  added := not (c.seen ? p_behavior);
  if added then c.seen := c.seen || jsonb_build_array(p_behavior); end if;
  perform public._nyang_save(c);
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t), 'added', added);
end $$;
revoke all on function public.nyang_seen(int, text) from public;
grant execute on function public.nyang_seen(int, text) to authenticated;

-- ---------- 5-3. 베란다 정원 · 상점 (4단계) ----------

-- 내 고양이 중 가장 높은 친밀도 단계 (씨앗이 열리는 기준 — rules.ts 의 topLevel)
create or replace function public._nyang_top_level(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select greatest(1, coalesce((select max(public._nyang_level(c.love)) from public.nyang_cats c where c.user_id = p_user), 1))
$$;
revoke all on function public._nyang_top_level(uuid) from public, anon, authenticated;

-- 화분이 p_t 까지 자란 초 (rules.ts 의 potGrown): 물을 준 뒤 water_sec 동안만 자라고, 다 자라면 멈춘다
create or replace function public._nyang_pot_grown(p public.nyang_pots, p_t bigint) returns int
language sql stable set search_path = public as $$
  select least(pl.grow_sec, p.grown + case when p.water_at is null then 0 else greatest(0, least(p_t - p.water_at, pl.water_sec::bigint))::int end)
  from public._nyang_plants() pl where pl.id = p.plant
$$;
revoke all on function public._nyang_pot_grown(public.nyang_pots, bigint) from public, anon, authenticated;

-- 심기 (rules.ts 의 plant): 빈 화분에 보관함의 씨앗 하나
create or replace function public.nyang_plant(p_pot int, p_seed text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); n int; r jsonb;
begin
  if p_seed is null or not exists (select 1 from public._nyang_plants() x where x.id = p_seed) then raise exception 'bad seed'; end if;
  select pots into n from public.nyang_profiles where user_id = me;
  if p_pot is null or p_pot < 1 or p_pot > n then raise exception 'bad pot'; end if;
  if exists (select 1 from public.nyang_pots where user_id = me and slot = p_pot) then raise exception 'pot busy'; end if;
  if public._nyang_item(me, 'seed:' || p_seed) < 1 then raise exception 'no seed'; end if;
  perform public._nyang_add_item(me, 'seed:' || p_seed, -1);
  insert into public.nyang_pots (user_id, slot, plant, planted_at, grown, water_at) values (me, p_pot, p_seed, t, 0, null);
  r := public._nyang_care(me, false, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_plant(int, text) from public;
grant execute on function public.nyang_plant(int, text) to authenticated;

-- 물 주기 (rules.ts 의 waterPot): 지금까지 자란 것을 적고 물을 새로. 물이 남아 있으면 'pot wet'
create or replace function public.nyang_water_pot(p_pot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); p public.nyang_pots; pl record; g int; r jsonb;
begin
  select * into p from public.nyang_pots where user_id = me and slot = p_pot for update;
  if not found then raise exception 'no plant'; end if;
  select * into pl from public._nyang_plants() x where x.id = p.plant;
  g := public._nyang_pot_grown(p, t);
  if g >= pl.grow_sec then raise exception 'pot ready'; end if;
  if p.water_at is not null and t < p.water_at + pl.water_sec then raise exception 'pot wet'; end if;
  update public.nyang_pots set grown = g, water_at = t where user_id = me and slot = p_pot;
  r := public._nyang_care(me, false, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_water_pot(int) from public;
grant execute on function public.nyang_water_pot(int) to authenticated;

-- 수확 (rules.ts 의 harvest): 다 자란 것을 보관함 'plant:<id>' 에, 화분은 빈 칸으로 → plant
create or replace function public.nyang_harvest(p_pot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); p public.nyang_pots; r jsonb;
begin
  select * into p from public.nyang_pots where user_id = me and slot = p_pot for update;
  if not found then raise exception 'no plant'; end if;
  if public._nyang_pot_grown(p, t) < (select x.grow_sec from public._nyang_plants() x where x.id = p.plant) then raise exception 'not ready'; end if;
  delete from public.nyang_pots where user_id = me and slot = p_pot;
  perform public._nyang_add_item(me, 'plant:' || p.plant, 1);
  r := public._nyang_care(me, false, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t), 'plant', p.plant);
end $$;
revoke all on function public.nyang_harvest(int) from public;
grant execute on function public.nyang_harvest(int) to authenticated;

-- 화분 칸 늘리기 (rules.ts 의 expandPots) → price
create or replace function public.nyang_expand_pots() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); pr public.nyang_profiles; price int;
begin
  select * into pr from public.nyang_profiles where user_id = me;
  if pr.pots >= public._nyang_const('pot_max') then raise exception 'max pots'; end if;
  price := (public._nyang_table('pot_prices'))[pr.pots - public._nyang_const('pot_start') + 1];
  if pr.coins < price then raise exception 'no coins'; end if;
  update public.nyang_profiles set coins = coins - price, pots = pots + 1 where user_id = me;
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t), 'price', price);
end $$;
revoke all on function public.nyang_expand_pots() from public;
grant execute on function public.nyang_expand_pots() to authenticated;

-- 상점에서 사기 (rules.ts 의 buy): 엽전 price × n · 시아코인 sia × n (지갑에서 _spend_sia_coin 으로 한 번에) → 보관함 give × n · 가구는 furniture 에
create or replace function public.nyang_buy(p_item text, p_n int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); it record; pr public.nyang_profiles; owned boolean; fid text;
begin
  select * into it from public._nyang_shop() x where x.id = p_item;
  if not found then raise exception 'bad item'; end if;
  if p_n is null or p_n < 1 or p_n > public._nyang_const('buy_max') or (it.once = 1 and p_n <> 1) then raise exception 'bad amount'; end if;
  if public._nyang_top_level(me) < it.level then raise exception 'locked'; end if;
  select * into pr from public.nyang_profiles where user_id = me;
  fid := case when p_item like 'furniture:%' then substr(p_item, 11) else null end;
  owned := case when fid is not null then pr.furniture ? fid else public._nyang_item(me, p_item) > 0 end;
  if it.once = 1 and owned then raise exception 'have it'; end if;
  if pr.coins < it.price * p_n then raise exception 'no coins'; end if;
  if it.sia > 0 then
    perform public._spend_sia_coin(me, it.sia * p_n, 'nyang', 'buy:' || (pr.buy_seq + 1));
    update public.nyang_profiles set buy_seq = buy_seq + 1 where user_id = me;
  end if;
  update public.nyang_profiles set coins = coins - it.price * p_n where user_id = me;
  if fid is not null then
    update public.nyang_profiles set furniture = furniture || jsonb_build_array(fid) where user_id = me;
  else
    perform public._nyang_add_item(me, p_item, it.give * p_n);
  end if;
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t), 'id', p_item, 'n', p_n);
end $$;
revoke all on function public.nyang_buy(text, int) from public;
grant execute on function public.nyang_buy(text, int) to authenticated;

-- 팔기 (rules.ts 의 sell): 수확한 꽃 · 털 뭉치 → coins (받은 엽전)
create or replace function public.nyang_sell(p_item text, p_n int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); price int;
begin
  select x.price into price from public._nyang_sell() x where x.id = p_item;
  if price is null or price <= 0 then raise exception 'bad item'; end if;
  if p_n is null or p_n < 1 or p_n > public._nyang_const('sell_max') then raise exception 'bad amount'; end if;
  if public._nyang_item(me, p_item) < p_n then raise exception 'no item'; end if;
  perform public._nyang_add_item(me, p_item, -p_n);
  update public.nyang_profiles set coins = coins + price * p_n where user_id = me;
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t), 'coins', price * p_n);
end $$;
revoke all on function public.nyang_sell(text, int) from public;
grant execute on function public.nyang_sell(text, int) to authenticated;

-- 수확물과 특별 가구 바꾸기 (rules.ts 의 exchange)
create or replace function public.nyang_exchange(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); ex record;
begin
  select * into ex from public._nyang_exchanges() x where x.id = p_id;
  if not found then raise exception 'bad item'; end if;
  if (select furniture ? ex.id from public.nyang_profiles where user_id = me) then raise exception 'have it'; end if;
  if public._nyang_item(me, ex.need) < ex.n then raise exception 'no item'; end if;
  perform public._nyang_add_item(me, ex.need, -ex.n);
  update public.nyang_profiles set furniture = furniture || jsonb_build_array(ex.id) where user_id = me;
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_exchange(text) from public;
grant execute on function public.nyang_exchange(text) to authenticated;

-- 캣그라스 · 캣닢을 고양이에게 (rules.ts 의 treat): 고양이마다 하루 treat_day_max 번 → love
create or replace function public.nyang_treat(p_slot int, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; tr record; day int := public._nyang_day(t);
  before int; after int; add int; r jsonb;
begin
  select * into tr from public._nyang_treats() x where x.id = p_kind;
  if not found then raise exception 'bad treat'; end if;
  c := public._nyang_cat(me, p_slot, t);
  if c.treat_day <> day then
    c.treat_day := day;
    c.treat_n := 0;
  end if;
  if c.treat_n >= public._nyang_const('treat_day_max') then raise exception 'treat full'; end if;
  if public._nyang_item(me, 'plant:' || p_kind) < 1 then raise exception 'no item'; end if;
  perform public._nyang_add_item(me, 'plant:' || p_kind, -1);
  c.treat_n := c.treat_n + 1;
  before := (public._nyang_levels(c, t)->>'mood')::int;
  after := least(10000, before + tr.mood);
  c.mood_val := after;
  c.mood_at := t;
  add := case when c.sick_at is not null then 0 else tr.love end;
  c.love := c.love + add;
  if p_kind = 'catnip' then c.nip_at := t; end if;
  perform public._nyang_save(c);
  r := public._nyang_care(me, before < 5000 and after >= 5000, t);
  perform public._nyang_pay(me);
  return r || jsonb_build_object('state', public._nyang_json(me, t), 'love', add);
end $$;
revoke all on function public.nyang_treat(int, text) from public;
grant execute on function public.nyang_treat(int, text) to authenticated;

-- ---------- 5-4. 꾸미기 · 앨범 (5단계) ----------

-- 가지고 있는 가구인지 (rules.ts 의 ownsFurniture): 책상 · 방석은 처음부터, 상자는 장난감 상자가 있으면
create or replace function public._nyang_owns_furniture(p_user uuid, p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_id = any(public._nyang_ids('base_furniture'))
    or (p_id = 'box' and public._nyang_has_toy(p_user, 'box'))
    or coalesce((select pr.furniture ? p_id from public.nyang_profiles pr where pr.user_id = p_user), false)
$$;
revoke all on function public._nyang_owns_furniture(uuid, text) from public, anon, authenticated;

-- 가지고 있는 벽지 · 바닥 · 창문인지 (rules.ts 의 ownsStyle): 기본은 처음부터, 나머지는 보관함 'style:<id>'
create or replace function public._nyang_owns_style(p_user uuid, p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public._nyang_styles() x where x.id = p_id and x.price = 0) or public._nyang_item(p_user, 'style:' || p_id) > 0
$$;
revoke all on function public._nyang_owns_style(uuid, text) from public, anon, authenticated;

-- 꾸미기 저장 (rules.ts 의 place): { items: [{ id, x, y }], wall, floor, window } — 가진 것 · 격자 안 · 막힌 칸이나 다른 가구와 안 겹침. 꽃병의 꽃은 그대로
create or replace function public.nyang_place(p_layout jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); items jsonb; it jsonb; f record; st record; used text[]; ids text[] := '{}';
  px numeric; py numeric; ncols int; nrows int; k text; dx int; dy int; cell text; placed jsonb := '[]'::jsonb; res jsonb; knd text; v jsonb; old jsonb;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then raise exception 'bad layout'; end if;
  items := p_layout->'items';
  if items is null or items = 'null'::jsonb then items := '[]'::jsonb; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > (select count(*) from public._nyang_furniture()) then raise exception 'bad layout'; end if;
  used := public._nyang_ids('blocked');
  for it in select e from jsonb_array_elements(items) with ordinality a(e, o) order by o loop
    if jsonb_typeof(it) <> 'object' or jsonb_typeof(it->'id') is distinct from 'string' or jsonb_typeof(it->'x') is distinct from 'number'
      or jsonb_typeof(it->'y') is distinct from 'number' then raise exception 'bad layout'; end if;
    select * into f from public._nyang_furniture() z where z.id = it->>'id';
    if not found or f.id = any(ids) then raise exception 'bad layout'; end if;
    ids := ids || f.id;
    if not public._nyang_owns_furniture(me, f.id) then raise exception 'not owned'; end if;
    px := (it->>'x')::numeric;
    py := (it->>'y')::numeric;
    ncols := case when f.kind = 'wall' then public._nyang_const('wall_cols') else public._nyang_const('grid_cols') end;
    nrows := case when f.kind = 'wall' then public._nyang_const('wall_rows') else public._nyang_const('grid_rows') end;
    if px <> trunc(px) or py <> trunc(py) or px < 0 or py < 0 or px + f.w > ncols or py + f.h > nrows then raise exception 'bad layout'; end if;
    k := case when f.kind = 'wall' then 'w' else 'f' end;
    for dx in 0 .. f.w - 1 loop
      for dy in 0 .. f.h - 1 loop
        cell := k || (px::int + dx) || '_' || (py::int + dy);
        if cell = any(used) then raise exception 'bad layout'; end if;
        used := used || cell;
      end loop;
    end loop;
    placed := placed || jsonb_build_array(jsonb_build_object('id', f.id, 'x', px::int, 'y', py::int));
  end loop;
  res := jsonb_build_object('items', placed);
  foreach knd in array array['wall', 'floor', 'window'] loop
    v := p_layout->knd;
    if v is null or v = 'null'::jsonb then
      v := to_jsonb((select x.id from public._nyang_styles() x where x.kind = knd and x.price = 0 limit 1));
    end if;
    if jsonb_typeof(v) <> 'string' then raise exception 'bad layout'; end if;
    select * into st from public._nyang_styles() x where x.id = v #>> '{}';
    if not found or st.kind <> knd then raise exception 'bad layout'; end if;
    if not public._nyang_owns_style(me, st.id) then raise exception 'not owned'; end if;
    res := res || jsonb_build_object(knd, st.id);
  end loop;
  select layout into old from public.nyang_profiles where user_id = me;
  if old ? 'vase' then res := res || jsonb_build_object('vase', old->'vase'); end if;
  update public.nyang_profiles set layout = res where user_id = me;
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_place(jsonb) from public;
grant execute on function public.nyang_place(jsonb) to authenticated;

-- 꽃병에 꽃 꽂기 (rules.ts 의 vase): 보관함의 꽃 하나를 쓴다 · 빈 글자면 꽃을 뺀다
create or replace function public.nyang_vase(p_flower text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now();
begin
  if p_flower is null or (p_flower <> '' and not (p_flower = any(public._nyang_ids('vase_flowers')))) then raise exception 'bad flower'; end if;
  if not public._nyang_owns_furniture(me, 'vase') then raise exception 'no vase'; end if;
  if p_flower = '' then
    update public.nyang_profiles set layout = layout - 'vase' where user_id = me;
  else
    if public._nyang_item(me, 'plant:' || p_flower) < 1 then raise exception 'no item'; end if;
    perform public._nyang_add_item(me, 'plant:' || p_flower, -1);
    update public.nyang_profiles set layout = layout || jsonb_build_object('vase', p_flower) where user_id = me;
  end if;
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_vase(text) from public;
grant execute on function public.nyang_vase(text) to authenticated;

-- 사진 찍기 (rules.ts 의 photo) → id, added: 행동 · 자세 · 방향 · 같이 찍힌 고양이를 앨범에 (그림은 저장하지 않는다). 처음 본 행동이면 도감에도
create or replace function public.nyang_photo(p_slot int, p_behavior text, p_pose text, p_face int, p_mate int, p_mate_pose text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now(); c public.nyang_cats; mc public.nyang_cats; need int; n int; added boolean; sq int;
begin
  c := public._nyang_cat(me, p_slot, t);
  select b.level into need from public._nyang_behaviors() b where b.id = p_behavior;
  if not found then raise exception 'bad behavior'; end if;
  if public._nyang_level(c.love) < need then raise exception 'too early'; end if;
  if p_pose is null or not (p_pose = any(public._nyang_ids('poses'))) then raise exception 'bad pose'; end if;
  if coalesce(p_mate, 0) <> 0 then
    select * into mc from public.nyang_cats where user_id = me and slot = p_mate;
    if not found or p_mate = p_slot then raise exception 'no cat'; end if;
    if p_mate_pose is null or not (p_mate_pose = any(public._nyang_ids('poses'))) then raise exception 'bad pose'; end if;
  end if;
  select count(*) into n from public.nyang_album where user_id = me;
  if n >= public._nyang_const('album_max') then raise exception 'album full'; end if;
  added := not (c.seen ? p_behavior);
  if added then c.seen := c.seen || jsonb_build_array(p_behavior); end if;
  perform public._nyang_save(c);
  update public.nyang_profiles set photo_seq = photo_seq + 1 where user_id = me returning photo_seq into sq;
  insert into public.nyang_album (user_id, id, slot, name, color, behavior, pose, face, mate_slot, mate_color, mate_pose, shot_at)
    values (me, sq, p_slot, c.name, c.color, p_behavior, p_pose, case when coalesce(p_face, 1) < 0 then -1 else 1 end,
      case when coalesce(p_mate, 0) <> 0 then p_mate end, case when coalesce(p_mate, 0) <> 0 then mc.color end,
      case when coalesce(p_mate, 0) <> 0 then p_mate_pose end, t);
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t), 'id', sq, 'added', added);
end $$;
revoke all on function public.nyang_photo(int, text, text, int, int, text) from public;
grant execute on function public.nyang_photo(int, text, text, int, int, text) to authenticated;

-- 사진 지우기 (rules.ts 의 deletePhoto)
create or replace function public.nyang_photo_delete(p_id int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._nyang_me(); t bigint := public._nyang_now();
begin
  delete from public.nyang_album a where a.user_id = me and a.id = p_id;
  if not found then raise exception 'no photo'; end if;
  perform public._nyang_pay(me);
  return jsonb_build_object('state', public._nyang_json(me, t));
end $$;
revoke all on function public.nyang_photo_delete(int) from public;
grant execute on function public.nyang_photo_delete(int) to authenticated;

-- ---------- 6. 집사 랭킹 ----------
-- 고양이들의 친밀도 합 → 돌본 날 수(care_days, 하루 첫 돌보기를 한 날) → 먼저 달성한 순(친밀도가 마지막으로 오른 때 = 고양이들 love_at 의 최댓값).
-- 친밀도는 들러서 계산(_nyang_settle)된 만큼만 저장되므로 '마지막으로 들른 때까지'의 값이다. 친밀도 합이 0 인 사람 · 관리자(120 과 같다)는 뺀다.
-- 다른 게임 랭킹 뷰와 같이 상위 100명은 place 순으로 읽고, 내 줄은 user_id 로 따로 읽는다 (shared/ranking-dialog.js 의 getNyangRanking).
create or replace view public.nyang_ranking as
  select r.user_id, p.nickname, r.love, r.cats, r.care_days, r.achieved_at,
    (row_number() over (order by r.love desc, r.care_days desc, r.achieved_at asc nulls last, r.user_id))::int as place,
    (count(*) over ())::int as total
  from (
    select pr.user_id, sum(c.love)::bigint as love, count(*)::int as cats, pr.care_days,
      to_timestamp(max(c.love_at)) as achieved_at
    from public.nyang_profiles pr join public.nyang_cats c on c.user_id = pr.user_id
    group by pr.user_id, pr.care_days
  ) r join public.profiles p on p.id = r.user_id
  where r.love > 0 and not coalesce(p.is_admin, false);
revoke all on public.nyang_ranking from anon, authenticated;
grant select on public.nyang_ranking to anon, authenticated;

-- ---------- 7. 게임 열기 (처음에는 닫힘 — 관리자만 들어간다) ----------

insert into public.app_settings (key, value) values ('game_open:nyang', 'false'::jsonb) on conflict (key) do nothing;
