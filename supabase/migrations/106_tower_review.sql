-- 106: 시아의탑 전체 검사 반영
--   - tower_state(): 'savedAt'(마지막 저장 시각, ms)을 더 돌려준다. 클라이언트는 이 기기의 못 보낸 저장이 그보다 먼저 만들어졌으면
--     (다른 기기에서 그 뒤에 저장했으면) 옛것으로 보고 버린다 — 최고 층이 같을 때 다른 기기의 레벨·엽전을 덮어쓰지 않게.
--     나머지는 105 와 똑같다.
--   - tower_save(): 처음 깬 층 시아코인이 _grant_sia_coin 의 15초 간격에 걸려 빠지면, 다음 저장 때 아직 못 받은 가장 낮은 층을 하나 준다
--     (층마다 평생 한 번 · 하루 100개 한도는 그대로). 나머지 확인은 104 와 똑같다.

create or replace function public.tower_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.tower_profiles;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  r := public._tower_row(me);
  perform public._ensure_wallet(me);
  -- 관리자 계정(시험용): 들어올 때마다 엽전과 시아코인을 1만으로 맞춘다 (102 와 같은 방식). 일반 사용자는 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    if jsonb_typeof(r.data) = 'object' then
      update public.tower_profiles set data = jsonb_set(data, '{coins}', '10000'::jsonb, true) where user_id = me returning * into r;
    end if;
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return jsonb_build_object('look', r.look, 'data', r.data, 'bestFloor', r.best_floor,
    'siaCoins', public._tower_sia(me), 'lookPrice', public._tower_look_price(),
    'savedAt', floor(extract(epoch from r.updated_at) * 1000)::bigint);
end $$;
revoke all on function public.tower_state() from public, anon;
grant execute on function public.tower_state() to authenticated;

create or replace function public.tower_save(p_data jsonb, p_cleared int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.tower_profiles; best int; cp int; got boolean := false; miss int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._tower_row(me);
  select * into r from public.tower_profiles where user_id = me for update;
  if r.look is null then raise exception 'no look'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 32768
    or not public._tower_int_ok(p_data, 'level', 1, 99)
    or not public._tower_int_ok(p_data, 'exp', 0, 1e12)
    or not public._tower_int_ok(p_data, 'coins', 0, 1e12)
    or not public._tower_int_ok(p_data, 'floor', 1, 100)
    or not public._tower_int_ok(p_data, 'checkpoint', 1, 91)
    or not public._tower_int_ok(p_data, 'best', 0, 100) then
    raise exception 'bad save';
  end if;
  -- 서버에 이미 더 높이 오른 기록이 있으면 예전 기기·못 보낸 옛 저장이다: 새 진행을 덮어쓰지 않게 거절
  if (p_data->>'best')::int < r.best_floor then raise exception 'old save'; end if;
  -- 층은 건너뛸 수 없다: 깰 수 있는 층은 지금까지 깬 최고 층 + 1 까지
  if p_cleared is not null and (p_cleared < 1 or p_cleared > 100 or p_cleared > r.best_floor + 1) then raise exception 'bad save'; end if;
  best := greatest(r.best_floor, coalesce(p_cleared, 0));
  cp := (p_data->>'checkpoint')::int;
  if (cp - 1) % 10 <> 0 or cp > best + 1 or (p_data->>'floor')::int > best + 1 then raise exception 'bad save'; end if;

  update public.tower_profiles set
    data = p_data,
    level = (p_data->>'level')::int,
    best_floor = best,
    best_at = case when best > r.best_floor then now() else best_at end,
    updated_at = now()
  where user_id = me;
  -- 시아코인: 층마다 평생 한 번 (예전에 15초·하루 한도로 못 받은 층은 다시 깨면 받는다. 한도는 _grant_sia_coin 안에서)
  if p_cleared is not null then
    got := public._grant_sia_coin(me, 'tower', 'floor:' || p_cleared::text);
  end if;
  -- 106: 15초 간격 때문에 못 받은 층(휴식층을 빨리 지나감 · 못 보낸 저장을 한꺼번에 보냄)은 다음 저장 때 하나씩 받는다
  if not got and best > 0 then
    select f into miss from generate_series(1, best) f
    where not exists (select 1 from public.sia_coin_logs l where l.user_id = me and l.game = 'tower' and l.ref = 'floor:' || f::text)
    order by f limit 1;
    if miss is not null then got := public._grant_sia_coin(me, 'tower', 'floor:' || miss::text); end if;
  end if;
  return jsonb_build_object('bestFloor', best, 'gotCoin', got, 'siaCoins', public._tower_sia(me));
end $$;
revoke all on function public.tower_save(jsonb, int) from public, anon;
grant execute on function public.tower_save(jsonb, int) to authenticated;
