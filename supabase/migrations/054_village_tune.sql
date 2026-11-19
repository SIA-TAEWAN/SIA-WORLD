-- 054: 시아마을 10단계 — 수치 조정 (games/village/PRD.md 6장 · 16장 10단계)
-- 047 · 049 ~ 053 위에 얹는다. 표와 함수만 다시 정의하고 데이터는 건드리지 않는다. 여러 번 실행해도 안전하다.
--
--   · 엽전이 크게 남던 것(60일에 약 40만 닢)을 줄인다 — 쓸 곳을 늘리고 버는 양의 위쪽을 낮춘다.
--       업그레이드: 건물 레벨 coin_from(4) 부터 엽전도 든다 = (짓는 값의 쌀 + 나무) × cost_mul × up_coin_pct(45) ÷ 1000 (버림)
--       장식물 값: 평상 300 · 등불 150 · 우물 1000 · 장승 600 · 솟대 2000 · 연못 4000 · 돌탑 8000 (번영도 점수도 조금 올렸다)
--       장터 하루 판매 한도: 레벨 7 부터 2000 · 2300 · 2600 · 2900
--     성장 속도 시뮬레이션(npm run pace, 하루 4번 × 4분, 시아코인 0): 첫날 레벨 5 · 일주일 12 · 레벨 30 은 55일째, 60일에 남는 엽전 약 1만 5천 닢
--   · 관리자 시험용 엽전 · 시아코인 10,000 은 052 · 053 의 village_state 에 이미 있다 (여기서 다시 정의하지 않는다)
--
-- 화면과 같아야 하는 값: games/village/src/data/balance.ts · buildings.ts, 규칙은 src/game/rules.ts 의 upgradeCost (tests/sql.test.ts 가 본다)

-- ---------- 1. 수치 ----------

-- 기준 값 (052 와 같고 coin_from · up_coin_pct 가 생겼다. 뜻은 games/village/src/data/balance.ts 의 CONST 와 data/residents.ts 의 REQ)
create or replace function public._village_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_level' then 30
    when 'building_max_level' then 10
    when 'prod_cap_sec' then 43200
    when 'base_slots' then 2
    when 'slots3_hall' then 5
    when 'harvest_exp_div' then 20
    when 'harvest_max' then 64
    when 'hall_sec_mul' then 2
    when 'hall_exp_mul' then 3
    when 'stone_from' then 4
    when 'coin_from' then 4
    when 'up_coin_pct' then 45
    when 'price_min_pct' then 80
    when 'price_span' then 51
    when 'pavilion_pct' then 10
    when 'pavilion_pct_per' then 2
    when 'pavilion_range' then 1
    when 'feast_cake' then 60
    when 'feast_sec' then 86400
    when 'feast_pct' then 20
    when 'feast_pct_per' then 2
    when 'feast_exp' then 30
    when 'bonus_room_pct' then 40
    when 'req_exp_pct' then 30
    when 'daily_exp_pct' then 1
    when 'aff_points' then 3
    when 'praise_points' then 2
    when 'praise_per_day' then 5
    when 'praise_coin' then 10
    when 'name_max' then 12
    when 'req_slots' then 3
    when 'req_wait_done' then 1200
    when 'req_wait_skip' then 3600
    when 'shrine_pct' then 50
    when 'dog_cap_sec' then 54000
    when 'sheep_range' then 1
  end
$$;
revoke all on function public._village_const(text) from public, anon, authenticated;

-- 레벨별 표 (051 과 같고 장터 하루 판매 한도의 위쪽을 낮췄다)
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
    when 'market_limit' then array[300, 450, 650, 900, 1200, 1600, 2000, 2300, 2600, 2900]
    when 'land_price' then array[10, 20, 30, 50, 70, 100]
    when 'land_need' then array[3, 6, 9, 13, 17, 22]
    when 'aff_need' then array[0, 10, 30, 60, 100]
    when 'aff_bonus' then array[10, 15, 20, 25, 30]
    when 'dragon_bonus' then array[5, 8, 11, 14, 17]
  end
$$;
revoke all on function public._village_table(text) from public, anon, authenticated;

-- 건물 · 장식물 · 길 · 주민 선물 · 기념물 (053 과 같고 장식물 값 · 번영도 점수를 고쳤다. games/village/src/data/buildings.ts)
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
    ('mon_casino', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99])
$$;
revoke all on function public._village_types() from public, anon, authenticated;

-- ---------- 2. 업그레이드 ----------

-- 업그레이드 (051 과 같고, 건물 레벨 coin_from 부터 엽전도 든다. 용이 있으면 시간이 줄어든다. 오늘의 할 일 'construct')
create or replace function public.village_upgrade(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; ty record; lv int; m int; sec int; st bigint; cn bigint;
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
  cn := case when b.level >= public._village_const('coin_from') then (ty.rice + ty.wood)::bigint * m * public._village_const('up_coin_pct')::int / 1000 else 0 end;
  if public._village_res(me, 'rice') < ty.rice * m / 10 or public._village_res(me, 'wood') < ty.wood * m / 10 or public._village_res(me, 'stone') < st or public._village_res(me, 'coin') < cn then raise exception 'not enough'; end if;
  perform public._village_collect(me, b.id, t, public._village_cap(me), 0);
  perform public._village_spend(me, ty.rice * m / 10, ty.wood * m / 10, st, cn);
  sec := public._village_time_cut(me, (public._village_table('upgrade_sec'))[b.level] * case when b.type = 'hall' then public._village_const('hall_sec_mul')::int else 1 end);
  update public.village_buildings set state = 'upgrading', started_at = t, finish_at = t + make_interval(secs => sec) where id = b.id;
  perform public._village_progress(me, 'construct', '', 1);
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_upgrade(uuid) from public, anon;
grant execute on function public.village_upgrade(uuid) to authenticated;
