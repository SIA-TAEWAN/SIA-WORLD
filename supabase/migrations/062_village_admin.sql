-- 062: 시아마을 관리자 계정 — 최고 레벨 · 짓기 · 사기 제한 없음 · 값을 내지 않음 · 전시 마을(최종 모습) 꾸미기
-- 047 · 049 ~ 054 · 059 는 운영에 적용됨 — 고치지 않고 여기서 다시 정의한다 (같은 규칙: games/village/src/game/rules.ts).
--
--   · _village_admin(user): profiles.is_admin. 관리자인지 보는 곳은 이 함수 하나 (village_state 의 10,000 맞추기는 059 그대로)
--   · village_state: 관리자면 부를 때마다 마을 레벨을 최고(30, 경험치 0)로, 땅을 끝(6단계 20×20)까지 연다
--   · village_build (051 이 마지막): 관리자는 개수 제한 · 레벨 해금(선물 · 기념물 포함) · 건설 슬롯을 보지 않고,
--     쌀 · 나무 · 돌 · 엽전 · 시아코인을 내지 않는다. 자리(땅 밖 · 겹침) 확인은 그대로, 마을 회관은 하나뿐 그대로
--   · village_upgrade (054 가 마지막): 관리자는 마을 레벨 · 마을 회관 레벨 조건 · 건설 슬롯을 보지 않고 값을 내지 않는다 (최고 레벨 10 은 그대로)
--   · village_expand (050 이 마지막): 관리자는 마을 레벨 조건을 보지 않고 시아코인을 내지 않는다
--   · _village_state_json (059 가 마지막): 답에 admin(관리자인가)이 실린다 — 화면이 값 · 잠금 표시를 관리자용으로 보여 준다
--   · village_admin_set_state(p_state): 관리자만. 내 마을을 주어진 모양(games/village/src/data/showcase.ts 의 makeShowcase)으로 바꾼다
--       - 건물 · 주민을 지우고 새로 넣는다. 건물 id 는 서버가 새로 만든다 (주민의 배치는 보낸 id 로 이어 준다)
--       - 짓는 중 · 가공 중인 것은 없다: 모두 다 지은 상태(또는 보관함). 생산은 지금부터 쌓인다
--       - 자리 확인은 그대로 (땅 밖 · 겹치면 'bad state'). 마을 회관은 땅 위에 꼭 하나
--       - 부탁 · 오늘의 할 일 · 잔치 · 장터 판매 기록은 비우고 서버가 다시 정한다. 받은 칭찬 · 마을 이름(보낸 이름이 맞지 않으면) · 시아코인은 그대로
--       - 기념물: 보낸 목록 + 놓인 기념물 + 이미 열린 것
-- 일반 사용자는 하나도 바뀌지 않는다 (관리자가 아니면 앞 파일과 같은 길로 간다).

-- ---------- 1. 도구 ----------

create or replace function public._village_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = p_user), false)
$$;
revoke all on function public._village_admin(uuid) from public, anon, authenticated;

-- jsonb 의 수 하나 (수가 아니면 d, 범위 밖이면 lo · hi 로)
create or replace function public._village_jnum(p jsonb, p_lo bigint, p_hi bigint, p_d bigint) returns bigint
language sql immutable as $$
  select case when jsonb_typeof(p) = 'number' then greatest(p_lo, least(p_hi, floor((p #>> '{}')::numeric)::bigint)) else p_d end
$$;
revoke all on function public._village_jnum(jsonb, bigint, bigint, bigint) from public, anon, authenticated;

-- ---------- 2. 상태 ----------

-- 화면에 보내는 마을 모양 (059 와 같고, admin 이 더해진다)
create or replace function public._village_state_json(p_user uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  perform public._village_refresh(p_user, p_now);
  select jsonb_build_object(
    'now', public._village_ms(p_now),
    'admin', public._village_admin(p_user),
    'sia', coalesce((select w.sia_coins from public.wallets w where w.user_id = p_user), 0),
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

-- 내 마을 (059 와 같고, 관리자면 부를 때마다 마을 레벨을 최고로 · 땅을 끝까지 연 다음 한 번 더 마무리한다 — 주민 이사 · 부탁)
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

-- ---------- 3. 짓기 · 업그레이드 · 땅 ----------

-- 짓기 (051 과 같고, 관리자는 개수 · 해금 · 건설 슬롯 · 값을 보지 않는다. 마을 회관은 누구나 하나)
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
        else (select count(*) from unnest(ty.unlock) u where u <= lv)::int end;
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

-- 업그레이드 (054 와 같고, 관리자는 마을 레벨 · 마을 회관 레벨 · 건설 슬롯 · 값을 보지 않는다)
create or replace function public.village_upgrade(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; ty record; lv int; m int; sec int; st bigint; cn bigint; adm boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  adm := public._village_admin(me);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  select * into ty from public._village_types() x where x.type = b.type;
  if ty.kind not in ('main', 'special') then raise exception 'no upgrade'; end if;
  if b.state <> 'done' then raise exception 'busy'; end if;
  if b.level >= public._village_const('building_max_level') then raise exception 'max level'; end if;
  if adm then
    null;
  elsif b.type = 'hall' then
    select level into lv from public.village_profiles where user_id = me;
    if lv < (public._village_table('hall_need'))[b.level] then raise exception 'village level'; end if;
  elsif b.level >= public._village_hall_level(me) then
    raise exception 'hall level';
  end if;
  if not adm and not public._village_slot_free(me) then raise exception 'no slot'; end if;
  m := (public._village_table('cost_mul'))[b.level];
  st := case when b.level >= public._village_const('stone_from') then ty.up_stone * m / 10 else 0 end;
  cn := case when b.level >= public._village_const('coin_from') then (ty.rice + ty.wood)::bigint * m * public._village_const('up_coin_pct')::int / 1000 else 0 end;
  if not adm and (public._village_res(me, 'rice') < ty.rice * m / 10 or public._village_res(me, 'wood') < ty.wood * m / 10 or public._village_res(me, 'stone') < st or public._village_res(me, 'coin') < cn) then raise exception 'not enough'; end if;
  perform public._village_collect(me, b.id, t, public._village_cap(me), 0);
  if not adm then
    perform public._village_spend(me, ty.rice * m / 10, ty.wood * m / 10, st, cn);
  end if;
  sec := public._village_time_cut(me, (public._village_table('upgrade_sec'))[b.level] * case when b.type = 'hall' then public._village_const('hall_sec_mul')::int else 1 end);
  update public.village_buildings set state = 'upgrading', started_at = t, finish_at = t + make_interval(secs => sec) where id = b.id;
  perform public._village_progress(me, 'construct', '', 1);
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_upgrade(uuid) from public, anon;
grant execute on function public.village_upgrade(uuid) to authenticated;

-- 땅 넓히기 (050 과 같고, 관리자는 마을 레벨 조건 · 시아코인을 보지 않는다)
create or replace function public.village_expand() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; p public.village_profiles; adm boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  adm := public._village_admin(me);
  select * into p from public.village_profiles where user_id = me;
  if p.land_stage >= 6 then raise exception 'max land'; end if;
  if not adm then
    if p.level < (public._village_table('land_need'))[p.land_stage + 1] then raise exception 'village level'; end if;
    perform public._spend_sia_coin(me, (public._village_table('land_price'))[p.land_stage + 1], 'village', 'land:' || (p.land_stage + 1));
  end if;
  update public.village_profiles set land_stage = p.land_stage + 1, updated_at = now() where user_id = me;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_expand() from public, anon;
grant execute on function public.village_expand() to authenticated;

-- ---------- 4. 전시 마을 (관리자만) ----------

-- 내 마을을 주어진 모양으로 바꾼다. p_state = 화면의 VillageState 모양 (games/village/src/game/rules.ts):
--   profile { name, landStage, goal, resources { rice, wood, stone, cake, coin, special } }   (레벨은 늘 최고, 경험치 0)
--   buildings [ { id(아무 글자, 서로 다르게), type, level, x, y, state('stored' 이면 보관함, 그 밖은 다 지은 것) } ]
--   residents [ { id(주민), affinity, building(위 buildings 의 id 또는 null), gifted } ]
--   monuments [ 기념물 종류 ]
create or replace function public.village_admin_set_state(p_state jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; pr jsonb; rs jsonb; e jsonb; i bigint; ty record; d record;
  ids jsonb := '{}'::jsonb; nid uuid; bid uuid; is_stored boolean; lv int; bx int; by_ int; why text; nm text; rid text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if not public._village_admin(me) then raise exception 'not admin'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or jsonb_typeof(p_state->'buildings') is distinct from 'array'
    or jsonb_array_length(p_state->'buildings') > 500 then raise exception 'bad state'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  pr := case when jsonb_typeof(p_state->'profile') = 'object' then p_state->'profile' else '{}'::jsonb end;
  rs := case when jsonb_typeof(pr->'resources') = 'object' then pr->'resources' else '{}'::jsonb end;
  nm := pr->>'name';

  -- 비운다 (받은 칭찬 · 열린 기념물 · 시아코인은 그대로)
  delete from public.village_residents where user_id = me;
  delete from public.village_requests where user_id = me;
  delete from public.village_buildings where user_id = me;
  update public.village_profiles set
    village_name = case when nm is not null and char_length(nm) between 1 and public._village_const('name_max')::int
                          and nm ~ '^[가-힣a-zA-Z0-9]+( [가-힣a-zA-Z0-9]+)*$' then nm else village_name end,
    level = public._village_const('max_level')::int, exp = 0,
    land_stage = public._village_jnum(pr->'landStage', 0, 6, 6)::int,
    resources = jsonb_build_object(
      'rice', public._village_jnum(rs->'rice', 0, 1000000000, 0), 'wood', public._village_jnum(rs->'wood', 0, 1000000000, 0),
      'stone', public._village_jnum(rs->'stone', 0, 1000000000, 0), 'cake', public._village_jnum(rs->'cake', 0, 1000000000, 0),
      'coin', public._village_jnum(rs->'coin', 0, 1000000000, 0), 'special', public._village_jnum(rs->'special', 0, 1000000000, 0)),
    goal = public._village_jnum(pr->'goal', 0, (select count(*) from public._village_goals()), 0)::int, goal_progress = 0,
    market_day = 0, market_sold = 0, feast_from = null, feast_until = null, feast_pct = 0,
    daily_day = -1, daily_bonus_day = 0, rooster_day = 0, updated_at = now()
  where user_id = me;

  -- 건물: 보낸 순서대로. 짓는 중인 것은 없다 (모두 다 지은 것 · 보관함)
  for e, i in select x.v, x.n from jsonb_array_elements(p_state->'buildings') with ordinality as x(v, n) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'bad state'; end if;
    select * into ty from public._village_types() x where x.type = e->>'type';
    if not found then raise exception 'bad state' using detail = 'type ' || coalesce(e->>'type', 'null'); end if;
    is_stored := coalesce(e->>'state', '') = 'stored' and ty.type <> 'hall';
    lv := case when ty.kind in ('main', 'special') then public._village_jnum(e->'level', 1, public._village_const('building_max_level')::bigint, 1)::int else 1 end;
    bx := null; by_ := null;
    if not is_stored then
      bx := public._village_jnum(e->'x', -1, 99, null)::int;
      by_ := public._village_jnum(e->'y', -1, 99, null)::int;
      why := public._village_place_error(me, ty.type, bx, by_, null);
      if why is not null then raise exception 'bad state' using detail = why || ' ' || ty.type || ' ' || coalesce(bx::text, '?') || ',' || coalesce(by_::text, '?'); end if;
    end if;
    insert into public.village_buildings (user_id, type, level, x, y, state, last_collected_at, created_at)
    values (me, ty.type, lv, bx, by_, case when is_stored then 'stored' else 'done' end, t, t + make_interval(secs => i::double precision / 1000000))
    returning id into nid;
    if e->>'id' is not null then ids := ids || jsonb_build_object(e->>'id', nid); end if;
  end loop;
  if (select count(*) from public.village_buildings where user_id = me and type = 'hall') <> 1 then raise exception 'bad state' using detail = 'one hall'; end if;

  -- 주민: 십이지 중 보낸 것 (같은 주민은 한 번). 배치는 제 일터인 서 있는 건물에만
  if jsonb_typeof(p_state->'residents') = 'array' then
    for e in select v from jsonb_array_elements(p_state->'residents') v loop
      continue when jsonb_typeof(e) <> 'object';
      rid := e->>'id';
      select * into d from public._village_residents() x where x.id = rid;
      continue when not found or exists (select 1 from public.village_residents where user_id = me and resident = rid);
      bid := null;
      if e->>'building' is not null and ids ? (e->>'building') then bid := (ids->>(e->>'building'))::uuid; end if;
      if bid is not null and not exists (select 1 from public.village_buildings b where b.id = bid and b.type = d.work and b.state = 'done') then bid := null; end if;
      insert into public.village_residents (user_id, resident, affinity, building_id, gifted, moved_in_at)
      values (me, rid, public._village_jnum(e->'affinity', 0, 1000000, 0)::int, bid, coalesce((e->'gifted') = 'true'::jsonb, false), t);
    end loop;
  end if;

  -- 기념물: 보낸 목록 + 놓인 기념물 (이미 열린 것은 그대로)
  insert into public.village_monuments (user_id, monument, unlocked_at)
  select me, md.monument, t from public._village_monument_defs() md
  where md.monument in (select jsonb_array_elements_text(case when jsonb_typeof(p_state->'monuments') = 'array' then p_state->'monuments' else '[]'::jsonb end))
     or md.monument in (select b.type from public.village_buildings b where b.user_id = me)
  on conflict (user_id, monument) do nothing;

  -- 부탁 · 오늘의 할 일을 서버가 다시 정한다
  perform public._village_settle(me, t);
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_admin_set_state(jsonb) from public, anon;
grant execute on function public.village_admin_set_state(jsonb) to authenticated;
