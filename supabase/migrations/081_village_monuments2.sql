-- 시아마을: 시아돌격대 · 시아핑거 기념물 6종 (games/village/PRD.md 9장).
-- 047 · 049 ~ 054 · 059 · 062 ~ 064 · 077 위에 얹는다. 여러 번 실행해도 안전하다 (함수만 다시 정의한다. 표는 그대로).
--
--   · 053 의 기념물 16종에 6종이 더해진다 (차례 17 ~ 22. 앞 16종의 차례 · 조건 · 점수는 그대로).
--       시아돌격대  charge_profiles.total_stars (모은 별, 061)        별 30개 / 100개
--                   charge_endless.best_meters (끝없는 길 최고 거리 m)  1,000m
--       시아핑거    finger_profiles.total_stars (모은 별, 067)        별 30개 / 100개
--                   finger_tower.best_floor (끝없는 탑 최고 층)          20층
--   · 다른 게임의 표는 "읽기만" 한다. 059 와 같이 하나씩 감싼다: 표가 없으면(이름이 바뀜) 그 기록만 0 (잠긴 채로).
--   · 여는 곳은 그대로다: 마을에 들어올 때(village_state)와 [기념물] 화면(village_monuments)이 _village_monument_sync 를 부른다.
--     이미 조건을 채운 사람은 다음에 들어올 때 보관함으로 받는다.
--
-- 이 파일이 다시 정의하는 함수와 그 앞의 마지막 정의:
--   _village_types()          077_cat_village.sql      (줄 6개 추가, 나머지는 같다)
--   _village_monument_defs()  053_village_monuments.sql (줄 6개 추가)
--   _village_game_stats(uuid) 059_village_review.sql    (기록 4개 추가)
-- 화면과 같아야 하는 값: games/village/src/data/monuments.ts · buildings.ts (tests/sql.test.ts 가 본다. 줄은 npm run sqlrows 로 뽑았다)

-- ---------- 1. 종류 ----------

-- 건물 · 장식물 · 길 · 주민 선물 · 기념물 (077 과 같고 돌격대 · 핑거 기념물 6종이 더해졌다. games/village/src/data/buildings.ts)
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
    ('mon_finger_tower', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 35, array[99])
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
    ('mon_finger_tower', 22, 'finger_floor', 20)
$$;
revoke all on function public._village_monument_defs() from public, anon, authenticated;

-- ---------- 2. 다른 게임의 기록 읽기 (읽기만 한다) ----------

-- 059 와 같고 돌격대 · 핑거 기록 4개가 더해졌다. 다른 게임의 표 · 함수는 하나씩 감싼다: 없으면 그 기록만 0 (잠긴 채로)
create or replace function public._village_game_stats(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; maps text[] := array[]::text[]; def jsonb; m text; v int;
begin
  res := jsonb_build_object('tank_wins', 0, 'volley_wins', 0, 'race_plays', 0, 'surv_field', 0, 'surv_bamboo', 0, 'surv_palace', 0, 'surv_underworld', 0,
    'matgo_wins', 0, 'casino_wins', 0, 'def_3', 0, 'def_6', 0, 'def_9', 0, 'def_12', 0,
    'charge_stars', 0, 'charge_meters', 0, 'finger_stars', 0, 'finger_floor', 0);
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
  return res;
end $$;
revoke all on function public._village_game_stats(uuid) from public, anon, authenticated;
