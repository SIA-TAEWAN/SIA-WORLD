-- 099: 시아마을 — 새 게임 연결 (열두길 · 오늘의 도전 · 레이스 주간 랭킹 기념물 7종, 시아코인 특별 건물 '열두 지신 문') · 관리자 기념물 · 정자 보너스 시각
-- 047 · 049 ~ 054 · 059 · 062 ~ 064 · 077 · 081 · 091 위에 얹는다. 앞 파일은 운영에 적용됨 — 고치지 않고 여기서 다시 정의한다 (같은 규칙: games/village/src/game/rules.ts).
-- 표는 새로 만들지 않는다 (함수만). 여러 번 실행해도 안전하다.
--
--   · 기념물 22종에 7종이 더해진다 (차례 23 ~ 29. 앞 22종은 그대로). 다른 게임의 표는 "읽기만" 하고 하나씩 감싼다 (없으면 그 기록만 0):
--       시아열두길   twelve_keys (078)  보통 모드 열쇠 6개                          열쇠 돌기둥     30
--                    twelve_maps (078)  보통 모드 'final' clears > 0                열두길 비석     50
--                    twelve_maps (078)  어려움 모드 'final' clears > 0 (진짜 엔딩)  금빛 열두길 문  70
--                    twelve_tower (078) best_floor 30층                             구름 탑 등불    35
--       오늘의 도전  daily_scores (082) 서로 다른 날 7일 기록 (어느 게임이든)        도전 달력       25
--                    daily_scores (082) 지난 날(오늘 제외) 어느 게임 1위 (rank)      장원 깃발       40
--       시아레이스   race_weekly (096)  끝난 주 3위 안                              주간 시상대     35
--     daily_scores 는 60일, race_weekly 는 4주 지난 줄이 지워진다 — 그 안에 마을에 들어오거나 [기념물] 화면을 열어야 열린다. 한 번 열린 것은 그대로.
--   · 특별 건물 '열두 지신 문'(jisin, 2×2): 시아코인 50 · 마을 레벨 12 · 번영도 60 (정자 20/6 · 잔치 마당 40/10 · 사당 60/14 사이).
--     _village_types 의 sia 칸이라 village_build(077) 가 그대로 시아코인을 쓴다. 특별한 힘은 없고 번영도만 (업그레이드는 다른 특별 건물처럼 일반 자원)
--   · village_state (062 가 마지막): 관리자면 아직 없는 기념물을 모두 연 것으로 하고 보관함(village_buildings state 'stored')에 넣는다. 이미 있는 것은 그대로
--   · _village_settle (077 이 마지막): 정자가 다 지어지거나 레벨이 오를 때 쌓인 양을 "지금"이 아니라 "다 된 시각"까지 적어 둔다
--     ([다 된 시각, 지금] 의 생산이 새 정자 보너스로 쌓인다. 나머지는 077 과 같다)
--
-- 이 파일이 다시 정의하는 함수와 그 앞의 마지막 정의:
--   _village_types()                     081_village_monuments2.sql (줄 8개 추가: jisin · mon_* 7)
--   _village_monument_defs()             081_village_monuments2.sql (줄 7개 추가)
--   _village_game_stats(uuid)            081_village_monuments2.sql (기록 7개 추가)
--   _village_settle(uuid, timestamptz)   077_cat_village.sql        (정자 한 줄)
--   village_state(boolean)               062_village_admin.sql      (관리자 기념물)
-- 화면과 같아야 하는 값: games/village/src/data/monuments.ts · buildings.ts (tests/sql.test.ts 가 본다. 줄은 npm run sqlrows 로 뽑았다)

-- ---------- 1. 종류 ----------

-- 건물 · 장식물 · 길 · 주민 선물 · 기념물 (081 과 같고 열두 지신 문 · 기념물 7종이 더해졌다. games/village/src/data/buildings.ts)
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
    ('jisin', 'special', 2, 2, 180, 180, 80, 0, 50, 25, 2400, '', 0, 450, 0, 60, array[12]),
    ('shrine', 'special', 2, 2, 200, 200, 100, 0, 60, 30, 3600, '', 0, 600, 0, 80, array[14]),
    ('tree', 'deco', 1, 1, 0, 0, 0, 20, 0, 0, 0, '', 0, 2, 12, 1, array[1]),
    ('haystack', 'deco', 1, 1, 0, 0, 0, 50, 0, 0, 0, '', 0, 4, 6, 2, array[2]),
    ('flower', 'deco', 1, 1, 0, 0, 0, 30, 0, 0, 0, '', 0, 2, 12, 1, array[2]),
    ('scarecrow', 'deco', 1, 1, 0, 0, 0, 60, 0, 0, 0, '', 0, 4, 4, 2, array[3]),
    ('stonewall', 'deco', 1, 1, 0, 0, 0, 40, 0, 0, 0, '', 0, 4, 16, 2, array[3]),
    ('bench', 'deco', 1, 1, 0, 0, 0, 300, 0, 0, 0, '', 0, 8, 4, 4, array[4]),
    ('lantern', 'deco', 1, 1, 0, 0, 0, 150, 0, 0, 0, '', 0, 6, 8, 3, array[5]),
    ('well', 'deco', 1, 1, 0, 0, 0, 1000, 0, 0, 0, '', 0, 12, 2, 8, array[6]),
    ('jangseung', 'deco', 1, 1, 0, 0, 0, 600, 0, 0, 0, '', 0, 10, 4, 6, array[7]),
    ('sotdae', 'deco', 1, 1, 0, 0, 0, 2000, 0, 0, 0, '', 0, 12, 4, 10, array[8]),
    ('pond', 'deco', 1, 1, 0, 0, 0, 4000, 0, 0, 0, '', 0, 16, 2, 13, array[9]),
    ('stonetower', 'deco', 1, 1, 0, 0, 0, 8000, 0, 0, 0, '', 0, 20, 2, 18, array[12]),
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
    ('gift_pig', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_cat', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('mon_tank1', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99]),
    ('mon_tank10', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 40, array[99]),
    ('mon_volley1', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99]),
    ('mon_volley10', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 40, array[99]),
    ('mon_race1', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99]),
    ('mon_race2', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 30, array[99]),
    ('mon_surv_field', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 25, array[99]),
    ('mon_surv_bamboo', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 30, array[99]),
    ('mon_surv_palace', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 40, array[99]),
    ('mon_surv_underworld', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 50, array[99]),
    ('mon_def3', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 25, array[99]),
    ('mon_def6', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 35, array[99]),
    ('mon_def9', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 45, array[99]),
    ('mon_def12', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 60, array[99]),
    ('mon_matgo', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99]),
    ('mon_casino', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99]),
    ('mon_charge30', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 25, array[99]),
    ('mon_charge100', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 45, array[99]),
    ('mon_charge_road', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 35, array[99]),
    ('mon_finger30', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 25, array[99]),
    ('mon_finger100', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 45, array[99]),
    ('mon_finger_tower', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 35, array[99]),
    ('mon_twelve_keys', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 30, array[99]),
    ('mon_twelve_final', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 50, array[99]),
    ('mon_twelve_hard', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 70, array[99]),
    ('mon_twelve_tower', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 35, array[99]),
    ('mon_daily7', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 25, array[99]),
    ('mon_daily_first', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 40, array[99]),
    ('mon_race_week', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 35, array[99])
$$;
revoke all on function public._village_types() from public, anon, authenticated;

-- 기념물: 종류, 차례, 보는 기록(_village_game_stats 의 이름), 필요한 값. games/village/src/data/monuments.ts
create or replace function public._village_monument_defs() returns table (monument text, ord int, stat text, need int)
language sql immutable as $$
  values
    ('mon_tank1', 1, 'tank_wins', 1),
    ('mon_tank10', 2, 'tank_wins', 10),
    ('mon_volley1', 3, 'volley_wins', 1),
    ('mon_volley10', 4, 'volley_wins', 10),
    ('mon_race1', 5, 'race_plays', 1),
    ('mon_race2', 6, 'race_plays', 2),
    ('mon_surv_field', 7, 'surv_field', 1),
    ('mon_surv_bamboo', 8, 'surv_bamboo', 1),
    ('mon_surv_palace', 9, 'surv_palace', 1),
    ('mon_surv_underworld', 10, 'surv_underworld', 1),
    ('mon_def3', 11, 'def_3', 1),
    ('mon_def6', 12, 'def_6', 1),
    ('mon_def9', 13, 'def_9', 1),
    ('mon_def12', 14, 'def_12', 1),
    ('mon_matgo', 15, 'matgo_wins', 1),
    ('mon_casino', 16, 'casino_wins', 1),
    ('mon_charge30', 17, 'charge_stars', 30),
    ('mon_charge100', 18, 'charge_stars', 100),
    ('mon_charge_road', 19, 'charge_meters', 1000),
    ('mon_finger30', 20, 'finger_stars', 30),
    ('mon_finger100', 21, 'finger_stars', 100),
    ('mon_finger_tower', 22, 'finger_floor', 20),
    ('mon_twelve_keys', 23, 'twelve_keys', 6),
    ('mon_twelve_final', 24, 'twelve_final', 1),
    ('mon_twelve_hard', 25, 'twelve_hard', 1),
    ('mon_twelve_tower', 26, 'twelve_floor', 30),
    ('mon_daily7', 27, 'daily_days', 7),
    ('mon_daily_first', 28, 'daily_first', 1),
    ('mon_race_week', 29, 'race_week_top', 1)
$$;
revoke all on function public._village_monument_defs() from public, anon, authenticated;

-- ---------- 2. 다른 게임의 기록 읽기 (읽기만 한다) ----------

-- 081 과 같고 열두길 · 오늘의 도전 · 레이스 주간 기록 7개가 더해졌다. 다른 게임의 표 · 함수는 하나씩 감싼다: 없으면 그 기록만 0 (잠긴 채로)
create or replace function public._village_game_stats(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; maps text[] := array[]::text[]; def jsonb; m text; v int;
begin
  res := jsonb_build_object('tank_wins', 0, 'volley_wins', 0, 'race_plays', 0, 'surv_field', 0, 'surv_bamboo', 0, 'surv_palace', 0, 'surv_underworld', 0,
    'matgo_wins', 0, 'casino_wins', 0, 'def_3', 0, 'def_6', 0, 'def_9', 0, 'def_12', 0,
    'charge_stars', 0, 'charge_meters', 0, 'finger_stars', 0, 'finger_floor', 0,
    'twelve_keys', 0, 'twelve_final', 0, 'twelve_hard', 0, 'twelve_floor', 0, 'daily_days', 0, 'daily_first', 0, 'race_week_top', 0);
  begin
    res := res || jsonb_build_object('tank_wins', coalesce((select max(pp.wins) from public.player_points pp where pp.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  begin
    res := res || jsonb_build_object('volley_wins', coalesce((select v.wins from public.volleyball_rankings v where v.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  begin
    res := res || jsonb_build_object('race_plays', coalesce((select r.plays from public.race_records r where r.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  begin
    select s.unlocked_maps into maps from public.survival_profiles s where s.user_id = p_user;
  exception when undefined_table or undefined_column then maps := null;
  end;
  maps := coalesce(maps, array[]::text[]);
  if to_regprocedure('public._survival_map_cleared(uuid, text, text[])') is not null then
    foreach m in array array['field', 'bamboo', 'palace', 'underworld'] loop
      begin
        execute 'select public._survival_map_cleared($1, $2, $3)::int' into v using p_user, m, maps;
        res := res || jsonb_build_object('surv_' || m, coalesce(v, 0));
      exception when undefined_table or undefined_column or undefined_function then null;
      end;
    end loop;
  end if;
  begin
    res := res || jsonb_build_object('matgo_wins', (exists (
      select 1 from public.wallet_logs l where l.user_id = p_user and l.reason = 'game' and l.amount > 0 and l.game_id like 'matgo:%'))::int);
  exception when undefined_table or undefined_column then null;
  end;
  -- 카지노: 포커 · 블랙잭 · 홀덤(지갑 기록) 또는 룰렛 (둘 중 있는 표만 본다)
  begin
    if exists (select 1 from public.wallet_logs l where l.user_id = p_user and l.reason = 'game' and l.amount > 0
               and (l.game_id like 'poker:%' or l.game_id like 'blackjack:%' or l.game_id like 'holdem:%')) then
      res := res || jsonb_build_object('casino_wins', 1);
    end if;
  exception when undefined_table or undefined_column then null;
  end;
  begin
    if exists (select 1 from public.roulette_bets b where b.user_id = p_user and b.payout > b.total) then
      res := res || jsonb_build_object('casino_wins', 1);
    end if;
  exception when undefined_table or undefined_column then null;
  end;
  -- 시아디펜스 표는 아직 없을 수 있다 (없으면 잠긴 채로)
  if to_regclass('public.defense_stages') is not null then
    begin
      execute 'select jsonb_object_agg(''def_'' || g, (exists (select 1 from public.defense_stages d where d.user_id = $1 and d.stage_id = g || ''-5''))::int)
               from unnest(array[3, 6, 9, 12]) g' into def using p_user;
      res := res || coalesce(def, '{}'::jsonb);
    exception when undefined_table or undefined_column then null;
    end;
  end if;
  -- 시아돌격대: 모은 별 (charge_profiles) · 끝없는 길 최고 거리 m (charge_endless)
  begin
    res := res || jsonb_build_object('charge_stars', coalesce((select c.total_stars from public.charge_profiles c where c.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  begin
    res := res || jsonb_build_object('charge_meters', coalesce((select e.best_meters from public.charge_endless e where e.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  -- 시아핑거: 모은 별 (finger_profiles) · 끝없는 탑 최고 층 (finger_tower)
  begin
    res := res || jsonb_build_object('finger_stars', coalesce((select f.total_stars from public.finger_profiles f where f.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  begin
    res := res || jsonb_build_object('finger_floor', coalesce((select t.best_floor from public.finger_tower t where t.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  -- 099 시아열두길: 보통 모드 열쇠 수 (twelve_keys) · 최종보스맵 'final' 을 깬 적 (twelve_maps, 보통 / 어려움) · 끝없는 탑 최고 층 (twelve_tower)
  begin
    res := res || jsonb_build_object('twelve_keys', coalesce((select count(*) from public.twelve_keys k where k.user_id = p_user and k.mode = 'normal'), 0)::int);
  exception when undefined_table or undefined_column then null;
  end;
  begin
    res := res || jsonb_build_object(
      'twelve_final', (exists (select 1 from public.twelve_maps m where m.user_id = p_user and m.mode = 'normal' and m.map_id = 'final' and m.clears > 0))::int,
      'twelve_hard', (exists (select 1 from public.twelve_maps m where m.user_id = p_user and m.mode = 'hard' and m.map_id = 'final' and m.clears > 0))::int);
  exception when undefined_table or undefined_column then null;
  end;
  begin
    res := res || jsonb_build_object('twelve_floor', coalesce((select t.best_floor from public.twelve_tower t where t.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  -- 099 오늘의 도전 (daily_scores, 082): 기록을 남긴 서로 다른 날 수 (어느 게임이든) · 지난 날(오늘 제외) 어느 게임에서 1위를 한 적
  --   daily_ranking 과 같이 점수가 같으면 같은 등수 (rank). 60일 지난 줄은 지워지므로 날 수는 최근 60일 안에서 센다 (한 번 열린 기념물은 그대로)
  begin
    res := res || jsonb_build_object(
      'daily_days', coalesce((select count(distinct d.day) from public.daily_scores d where d.user_id = p_user), 0)::int,
      'daily_first', (exists (
        select 1 from public.daily_scores d
        where d.user_id = p_user and d.day < (now() at time zone 'Asia/Seoul')::date
          and not exists (select 1 from public.daily_scores o where o.game = d.game and o.day = d.day and o.score > d.score)))::int);
  exception when undefined_table or undefined_column then null;
  end;
  -- 099 시아레이스 주간 랭킹 (race_weekly, 096): 끝난 주(이번 주 월요일 앞)에 3위 안. 순서는 race_weekly_last_top 과 같다 (빠른 기록 → 먼저 세운 기록)
  --   race_weekly 는 4주 지난 줄을 지운다 — 그 안에 마을에 들어오거나 [기념물] 화면을 열면 열린다 (한 번 열린 것은 그대로)
  begin
    res := res || jsonb_build_object('race_week_top', (exists (
      select 1 from (
        select w.user_id, row_number() over (partition by w.week order by w.best_ms asc, w.best_at asc, w.user_id) as place
        from public.race_weekly w
        where w.week < date_trunc('week', ((now() at time zone 'Asia/Seoul')::date)::timestamp)::date) r
      where r.user_id = p_user and r.place <= 3))::int);
  exception when undefined_table or undefined_column then null;
  end;
  return res;
end $$;
revoke all on function public._village_game_stats(uuid) from public, anon, authenticated;

-- ---------- 3. 마무리 (077 과 같고 정자의 적어 두는 시각만 다르다) ----------

create or replace function public._village_settle(p_user uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; e bigint; d record; q record; a record; t record; lv int; houses int; cnt int; seq bigint; day int;
  ids text[]; pool int; n bigint; v bigint; need int; start int; i int; cat boolean; cp int;
begin
  for b in select * from public.village_buildings where user_id = p_user and state in ('building', 'upgrading') and finish_at <= p_now order by finish_at, created_at, id loop
    -- 099: 정자가 다 지어지거나(building) 레벨이 오르면(upgrading) 다 된 시각까지 쌓인 양을 적어 둔다
    --      (077 까지는 지금까지 적어서 [다 된 시각, 지금] 동안의 정자 보너스가 빠졌다)
    if b.type = 'pavilion' then perform public._village_bank_all(p_user, b.finish_at); end if;
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

  -- 이사: 십이지 순서대로, 마을 레벨이 되고 빈 집이 있을 때. 고양이(끝)는 레벨 대신 이 마을에서 산 것이 조건
  select level into lv from public.village_profiles where user_id = p_user;
  select count(*) into houses from public.village_buildings where user_id = p_user and type = 'house' and state not in ('building', 'stored');
  select count(*) into cnt from public.village_residents where user_id = p_user;
  cat := public._village_cat_owned(p_user);
  for d in select * from public._village_residents() order by ord loop
    continue when exists (select 1 from public.village_residents where user_id = p_user and resident = d.id);
    continue when case when d.id = 'cat' then not cat else lv < d.level end;
    exit when houses <= cnt;
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
    -- 고양이가 있으면 부탁의 엽전 · 경험치가 늘어난다 (은혜 갚는 고양이)
    cp := public._village_res_pct(p_user, 'cat');
    for q in select * from public.village_requests where user_id = p_user and kind = 'resident' and state = 'wait' and ready_at <= p_now order by slot loop
      update public.village_profiles set req_seq = req_seq + 1 where user_id = p_user returning req_seq into seq;
      select * into a from (select k.*, row_number() over (order by k.ord) - 1 as pos from public._village_asks() k where k.from_level <= lv) z
      where z.pos = public._village_mix(seq, 2) % pool;
      n := greatest(1, a.base::bigint * (2 + public._village_mix(seq, 3) % 4) * (20 + lv * a.grow) / 20);
      v := n * a.worth / 100;
      update public.village_requests set state = 'open', ready_at = null, progress = 0, content = jsonb_build_object(
        'resident', ids[public._village_mix(seq, 1) % cardinality(ids) + 1], 'res', a.res, 'n', n,
        'coin', (v * 3 / 2 + 10) * (100 + cp) / 100, 'exp', (v * public._village_const('req_exp_pct')::int / 100 + 5 + lv * 2) * (100 + cp) / 100,
        'aff', 2 + public._village_mix(seq, 4) % 3)
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

-- ---------- 4. 상태 ----------

-- 내 마을 (062 와 같고, 관리자면 아직 없는 기념물을 모두 보관함으로)
create or replace function public.village_state(p_entry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  update public.village_profiles set last_seen_at = t where user_id = me;
  if public._village_admin(me) then
    update public.village_profiles set level = public._village_const('max_level')::int, exp = 0, land_stage = 6, updated_at = now()
    where user_id = me and (level <> public._village_const('max_level')::int or exp <> 0 or land_stage <> 6);
    perform public._village_settle(me, t);
    -- 099: 관리자는 아직 열지 않은 기념물을 모두 연 것으로 하고 보관함에 넣는다 (이미 열린 것은 그대로 — 두 번 불러도 같은 것이 또 생기지 않는다)
    insert into public.village_buildings (user_id, type, state, last_collected_at, created_at)
    select me, x.monument, 'stored', t, t + make_interval(secs => x.ord::double precision / 1000000) from public._village_monument_defs() x
    where not exists (select 1 from public.village_monuments m where m.user_id = me and m.monument = x.monument)
    order by x.ord;
    insert into public.village_monuments (user_id, monument, unlocked_at)
    select me, x.monument, t from public._village_monument_defs() x
    on conflict (user_id, monument) do nothing;
  end if;
  perform public._village_monument_sync(me, t);
  if coalesce(p_entry, false) and exists (select 1 from public.profiles where id = me and is_admin) then
    update public.village_profiles set resources = jsonb_set(resources, '{coin}', '10000'::jsonb) where user_id = me;
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_state(boolean) from public, anon;
grant execute on function public.village_state(boolean) to authenticated;
