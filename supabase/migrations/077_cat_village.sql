-- 077: 시아마을 — 고양이(야옹이)가 13번째 주민 (071_characters.sql 의 buy_character('village', 'cat') 로 시아코인 100개에 산다)
--   · 살 수 있는 조건: 땅 넓히기 3단계(14×14) — _cat_progress_village (071 의 _character_progress 가 찾아 부른다)
--   · 이사: 마을 레벨 대신 '산 것'이 조건. 다른 주민처럼 빈 주민 집이 있어야 이사 오고, 산 마을은 주민 집을 한 채 더(13채째) 지을 수 있다
--   · 보너스 (은혜 갚는 고양이): 이사 와 있으면 새로 오는 주민 부탁의 엽전 · 경험치 + cat_bonus % (친밀도 1 … 5단계 4 · 6 · 8 · 10 · 12)
--       배치하지 않는다 (닭 · 개처럼). 가장 힘센 주민(말 · 닭)보다 조금 약하게 맞췄다 (games/village 의 npm run pace, PACE_CAT · PACE_SKIP)
--   · 친밀도 · 부탁 · 선물(gift_cat, 5단계)은 다른 주민과 같다
--   · buy_character 는 지갑 줄만 잠그고 마을 줄은 잠그지 않는다 (마을 함수의 잠금 순서 마을 → 지갑 과 엇갈리지 않는다).
--     산 뒤 이사는 다음 마을 요청의 _village_settle 에서 (화면은 사고 나서 village_state 를 다시 부른다)
-- 다시 정의하는 함수 (가장 마지막 정의 위에서, 다른 동작은 그대로):
--   _village_table (054) · _village_residents (051) · _village_types (054) · _village_res_pct (051) · _village_settle (051)
--   village_build (062) · _village_state_json (062). 새로: _village_cat_owned · _cat_progress_village

-- 레벨별 표 (054 와 같고 cat_bonus 가 더해졌다: 고양이의 친밀도 단계별 보너스 %. games/village/src/data/residents.ts 의 CAT_BONUS)
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
    when 'cat_bonus' then array[4, 6, 8, 10, 12]
  end
$$;
revoke all on function public._village_table(text) from public, anon, authenticated;

-- 주민 (051 과 같고 13번째 고양이가 더해졌다). 고양이의 레벨 0 은 '마을 레벨 대신 산 것이 조건' (_village_settle)
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
    ('pig', 12, 24, 'market'),
    ('cat', 13, 0, '')
$$;
revoke all on function public._village_residents() from public, anon, authenticated;

-- 건물 · 장식물 · 길 · 주민 선물 · 기념물 (054 와 같고 고양이의 선물 gift_cat 이 더해졌다. games/village/src/data/buildings.ts)
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
    ('mon_casino', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99])
$$;
revoke all on function public._village_types() from public, anon, authenticated;

-- 그 주민의 보너스 (%) (051 과 같고 고양이는 cat_bonus 표): 일터가 있는 주민은 일하고 있을 때, 닭 · 개 · 고양이는 이사 와 있을 때. 아니면 0
create or replace function public._village_res_pct(p_user uuid, p_resident text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (public._village_table(case r.resident when 'dragon' then 'dragon_bonus' when 'cat' then 'cat_bonus' else 'aff_bonus' end))[public._village_aff_level(r.affinity)]
    from public.village_residents r join public._village_residents() d on d.id = r.resident
    where r.user_id = p_user and r.resident = p_resident and (d.work = '' or public._village_workplace(p_user, p_resident) is not null)), 0)
$$;
revoke all on function public._village_res_pct(uuid, text) from public, anon, authenticated;

-- 이 마을에서 고양이를 샀나 (071 의 owned_characters: game 'village', 'cat')
create or replace function public._village_cat_owned(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.owned_characters where user_id = p_user and game = 'village' and character_id = 'cat')
$$;
revoke all on function public._village_cat_owned(uuid) from public, anon, authenticated;

-- 서버가 모든 요청의 처음에 하는 일 (051 과 같고 고양이가 더해졌다):
--   1. 끝난 짓기 · 업그레이드를 마무리한다  2. 주민 이사 (고양이는 산 뒤 빈 집이 있으면)  3. 기다림이 끝난 부탁 칸에 새 부탁 (고양이가 있으면 엽전 · 경험치 +)
--   4. 날이 바뀌었으면 오늘의 할 일
create or replace function public._village_settle(p_user uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; e bigint; d record; q record; a record; t record; lv int; houses int; cnt int; seq bigint; day int;
  ids text[]; pool int; n bigint; v bigint; need int; start int; i int; cat boolean; cp int;
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

-- 짓기 (062 와 같고, 고양이를 산 마을은 주민 집을 한 채 더 가질 수 있다)
create or replace function public.village_build(p_type text, p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; ty record; lv int; cnt int; mx int; why text; new_id uuid; adm boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  adm := public._village_admin(me);
  select * into ty from public._village_types() x where x.type = p_type;
  if not found then raise exception 'bad type'; end if;
  select level into lv from public.village_profiles where user_id = me;
  select count(*) into cnt from public.village_buildings where user_id = me and type = p_type;
  mx := case when ty.cap > 0 then case when lv >= ty.unlock[1] then ty.cap else 0 end
        else (select count(*) from unnest(ty.unlock) u where u <= lv)::int end
        -- 고양이를 샀으면 주민 집을 한 채 더 (13번째 주민의 집. 마을 레벨 해금과 따로)
        + case when p_type = 'house' and public._village_cat_owned(me) then 1 else 0 end;
  -- 아직 하나도 못 가지는 것은 'locked', 지금 레벨의 개수를 다 가졌으면 'limit' (관리자는 마을 회관만)
  if (not adm or p_type = 'hall') and cnt >= mx then raise exception '%', case when cnt = 0 then 'locked' else 'limit' end; end if;
  if not adm and ty.build_sec > 0 and not public._village_slot_free(me) then raise exception 'no slot'; end if;
  why := public._village_place_error(me, p_type, p_x, p_y, null);
  if why is not null then raise exception '%', why; end if;
  if not adm then
    perform public._village_spend(me, ty.rice, ty.wood, ty.stone, ty.coin);
    -- 마을 줄을 잠근 채로 지갑 줄을 잠근다 (순서: 마을 → 지갑)
    if ty.sia > 0 then perform public._spend_sia_coin(me, ty.sia, 'village', 'special:' || p_type); end if;
  end if;
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

-- 화면에 보내는 마을 모양 (062 와 같고 catOwned: 이 마을에서 고양이를 샀나)
create or replace function public._village_state_json(p_user uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  perform public._village_refresh(p_user, p_now);
  select jsonb_build_object(
    'now', public._village_ms(p_now),
    'admin', public._village_admin(p_user),
    'sia', coalesce((select w.sia_coins from public.wallets w where w.user_id = p_user), 0),
    'catOwned', public._village_cat_owned(p_user),
    'profile', jsonb_build_object(
      'name', p.village_name, 'level', p.level, 'exp', p.exp,
      'resources', jsonb_build_object('special', 0) || p.resources, 'landStage', p.land_stage,
      'prosperity', p.prosperity, 'prosperityAt', public._village_ms(p.prosperity_at), 'praiseCount', p.praise_count,
      'praised', coalesce((select jsonb_agg(x.to_user_id order by x.created_at, x.to_user_id) from public.village_praises x
                           where x.from_user_id = p_user and x.day = public._village_kst_day(p_now)), '[]'::jsonb),
      'goal', p.goal, 'goalProgress', p.goal_progress,
      'marketDay', p.market_day, 'marketSold', p.market_sold,
      'feastFrom', coalesce(public._village_ms(p.feast_from), 0), 'feastUntil', coalesce(public._village_ms(p.feast_until), 0), 'feastPct', p.feast_pct,
      'reqSeq', p.req_seq, 'dailyDay', p.daily_day, 'dailyBonusDay', p.daily_bonus_day, 'roosterDay', p.rooster_day),
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'level', b.level, 'x', coalesce(b.x, 0), 'y', coalesce(b.y, 0), 'state', b.state,
        'finishAt', public._village_ms(b.finish_at), 'startAt', public._village_ms(b.started_at),
        'collectedAt', public._village_ms(b.last_collected_at), 'jobN', b.job_n, 'banked', b.banked,
        'accFrom', case when b.banked > 0 then coalesce(public._village_ms(b.acc_from), 0) else 0 end) order by b.created_at, b.id)
      from public.village_buildings b where b.user_id = p_user), '[]'::jsonb),
    'residents', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.resident, 'affinity', r.affinity, 'building', r.building_id, 'gifted', r.gifted) order by d.ord)
      from public.village_residents r join public._village_residents() d on d.id = r.resident where r.user_id = p_user), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(q.content || jsonb_build_object('slot', q.slot, 'state', q.state, 'readyAt', coalesce(public._village_ms(q.ready_at), 0)) order by q.slot)
      from public.village_requests q where q.user_id = p_user and q.kind = 'resident'), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(q.content || jsonb_build_object('slot', q.slot, 'progress', q.progress, 'claimed', q.state = 'claimed') order by q.slot)
      from public.village_requests q where q.user_id = p_user and q.kind = 'daily'), '[]'::jsonb),
    'monuments', coalesce((
      select jsonb_agg(m.monument order by d.ord)
      from public.village_monuments m join public._village_monument_defs() d on d.monument = m.monument where m.user_id = p_user), '[]'::jsonb))
  into res
  from public.village_profiles p where p.user_id = p_user;
  return res;
end $$;
revoke all on function public._village_state_json(uuid, timestamptz) from public, anon, authenticated;

-- ---------- 고양이 구매 조건 (071 의 _character_progress 가 이름으로 찾아 부른다) ----------

-- 땅 넓히기 3단계(14×14). need 는 games/village/src/data/residents.ts 의 CAT_LAND_STAGE 와 같아야 한다 (tests/sql.test.ts)
create or replace function public._cat_progress_village(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('have', coalesce((select p.land_stage from public.village_profiles p where p.user_id = p_user), 0), 'need', 3)
$$;
revoke all on function public._cat_progress_village(uuid) from public, anon, authenticated;
