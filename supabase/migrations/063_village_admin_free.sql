-- 063: 시아마을 관리자 계정 — 가공 · 장터 판매 · 잔치 · 부탁 들어주기도 무료, 번영도 랭킹에서 뺀다
-- 062 는 운영에 적용됨 — 고치지 않고 여기서 다시 정의한다 (같은 규칙: games/village/src/game/rules.ts).
--
--   · village_craft (051 이 마지막): 관리자는 재료를 내지 않는다 (만드는 것은 그대로. 한 번에 넣는 개수 · 시간은 그대로)
--   · village_sell (051 이 마지막): 관리자는 판 자원이 줄지 않고(가진 것보다 많이 팔 수도 있다) 하루 한도가 없다. 엽전은 그대로 받는다
--   · village_feast (050 이 마지막): 관리자는 떡을 내지 않는다 (잔치 마당 · 잔치 중이 아닐 것은 그대로)
--   · village_request_done (051 이 마지막): 관리자는 부탁한 자원을 내지 않는다 (엽전 · 경험치 · 친밀도 · 선물은 그대로)
--   · village_ranking (052 가 마지막): 관리자 계정은 랭킹에 나오지 않고 순위 번호도 차지하지 않는다 (다음 사람이 올라간다. total 도 관리자를 뺀 수)
-- 일반 사용자는 하나도 바뀌지 않는다 (관리자가 아니면 앞 파일과 같은 길로 간다).

-- ---------- 1. 가공 ----------

-- 가공 시작 (051 과 같고, 관리자는 재료를 내지 않는다)
create or replace function public.village_craft(p_id uuid, p_n int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; rc record; unit int; worker text; pct int; adm boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  adm := public._village_admin(me);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  select * into rc from public._village_recipes() r where r.type = b.type;
  if not found then raise exception 'no recipe'; end if;
  if b.state <> 'done' then raise exception 'busy'; end if;
  if p_n is null or p_n < 1 or p_n > rc.base + rc.per * (b.level - 1) then raise exception 'bad count'; end if;
  if not adm then
    if public._village_res(me, rc.in1) < rc.n1 * p_n or (rc.in2 <> '' and public._village_res(me, rc.in2) < rc.n2 * p_n) then raise exception 'not enough'; end if;
    perform public._village_add(me, rc.in1, -rc.n1 * p_n);
    if rc.in2 <> '' then perform public._village_add(me, rc.in2, -rc.n2 * p_n); end if;
  end if;
  worker := case when b.type = 'mill' then 'rabbit' else 'snake' end;
  pct := case when public._village_workplace(me, worker) = b.id then public._village_res_pct(me, worker) else 0 end;
  unit := (rc.sec * 10 / (public._village_table('rate_mul'))[b.level]) * 100 / (100 + pct);
  update public.village_buildings set state = 'working', job_n = p_n, started_at = t, finish_at = t + make_interval(secs => p_n * unit) where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_craft(uuid, int) from public, anon;
grant execute on function public.village_craft(uuid, int) to authenticated;

-- ---------- 2. 장터 ----------

-- 장터에서 팔기 (051 과 같고, 관리자는 판 자원이 줄지 않고 하루 한도가 없다)
create or replace function public.village_sell(p_res text, p_n int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; pr record; p public.village_profiles; day int; sold bigint; coins bigint; adm boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  adm := public._village_admin(me);
  if not exists (select 1 from public.village_buildings where user_id = me and type = 'market' and state = 'done') then raise exception 'no market'; end if;
  select * into pr from public._village_prices() x where x.res = p_res;
  if not found then raise exception 'bad resource'; end if;
  if p_n is null or p_n < 1 or p_n > 1000000 then raise exception 'bad count'; end if;
  if not adm and public._village_res(me, p_res) < p_n then raise exception 'not enough'; end if;
  select * into p from public.village_profiles where user_id = me;
  day := public._village_kst_day(t);
  sold := case when p.market_day = day then p.market_sold else 0 end;
  coins := p_n::bigint * pr.base * public._village_price_pct(day, pr.idx) * (100 + public._village_res_pct(me, 'pig')) / 1000000;
  if coins < 1 then raise exception 'too few'; end if;
  if not adm and sold + coins > public._village_market_limit(me) then raise exception 'sell limit'; end if;
  if not adm then perform public._village_add(me, p_res, -p_n); end if;
  perform public._village_add(me, 'coin', coins);
  update public.village_profiles set market_day = day, market_sold = least(sold + coins, 2000000000) where user_id = me;
  perform public._village_progress(me, 'sell', '', coins);
  return public._village_state_json(me, t) || jsonb_build_object('sold', coins);
end $$;
revoke all on function public.village_sell(text, int) from public, anon;
grant execute on function public.village_sell(text, int) to authenticated;

-- ---------- 3. 잔치 ----------

-- 잔치 열기 (050 과 같고, 관리자는 떡을 내지 않는다)
create or replace function public.village_feast() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; f public.village_buildings; p public.village_profiles; adm boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  adm := public._village_admin(me);
  select * into f from public.village_buildings where user_id = me and type = 'feast' and state = 'done' limit 1;
  if not found then raise exception 'no feast'; end if;
  select * into p from public.village_profiles where user_id = me;
  if p.feast_until is not null and t < p.feast_until then raise exception 'feast active'; end if;
  if not adm and public._village_res(me, 'cake') < public._village_const('feast_cake') then raise exception 'not enough'; end if;
  -- 지난 잔치의 몫까지 쌓인 양을 적어 둔 다음에 새 잔치를 연다
  perform public._village_bank_all(me, t);
  if not adm then perform public._village_add(me, 'cake', -public._village_const('feast_cake')::bigint); end if;
  update public.village_profiles set feast_from = t, feast_until = t + make_interval(secs => public._village_const('feast_sec')::int),
    feast_pct = public._village_const('feast_pct')::int + public._village_const('feast_pct_per')::int * (f.level - 1), updated_at = now()
  where user_id = me;
  perform public._village_add_exp(me, public._village_const('feast_exp')::bigint);
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_feast() from public, anon;
grant execute on function public.village_feast() to authenticated;

-- ---------- 4. 부탁 ----------

-- 부탁 들어주기 (051 과 같고, 관리자는 부탁한 자원을 내지 않는다)
create or replace function public.village_request_done(p_slot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; q public.village_requests; r public.village_residents;
  res text; n bigint; add int; lv0 int; lv1 int; gift uuid; adm boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  adm := public._village_admin(me);
  select * into q from public.village_requests where user_id = me and kind = 'resident' and slot = p_slot for update;
  if not found or q.state <> 'open' then raise exception 'no request'; end if;
  res := q.content->>'res'; n := (q.content->>'n')::bigint;
  if not adm then
    if public._village_res(me, res) < n then raise exception 'not enough'; end if;
    perform public._village_add(me, res, -n);
  end if;
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

-- ---------- 5. 랭킹: 관리자 계정은 빼고 센다 ----------

-- 번영도 랭킹 (052 와 같은 모양 · 같은 권한. 관리자 계정은 줄도 순위 번호도 없다)
create or replace view public.village_ranking as
  select v.user_id, p.nickname, v.village_name, v.level, v.prosperity, v.prosperity_at as achieved_at,
    (row_number() over (order by v.prosperity desc, v.prosperity_at asc, v.user_id))::int as place,
    (count(*) over ())::int as total
  from public.village_profiles v join public.profiles p on p.id = v.user_id
  where not coalesce(p.is_admin, false);
revoke all on public.village_ranking from anon, authenticated;
grant select on public.village_ranking to anon, authenticated;
