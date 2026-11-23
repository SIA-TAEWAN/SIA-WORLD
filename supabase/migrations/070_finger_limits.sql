-- 070: 시아핑거 판 검증 기준 고치기 (067 의 _finger_const · finger_finish_verified 를 다시 정의, 나머지는 067 그대로)
-- 1. 끝없는 탑 판은 200턴까지라 쉬엄쉬엄 하면 2시간을 넘긴다 → 탑 판만 시작 후 6시간(tower_max_age)까지 받는다. 스테이지 판은 2시간(max_age) 그대로.
-- 2. 겹침 검사: 못 보낸 판 A 를 다시 보낸 것이 늦게 도착해 새 판 B 시작 뒤에 저장되면, 예전 검사(A 가 B 시작 뒤에 끝남)는 정상 판 B 를 버렸다.
--    서버가 받은 '끝난 시각' 은 통신이 늦으면 실제보다 늦으므로, 겹침을 이렇게 좁힌다:
--    (가) 이 판보다 늦게 시작해 이미 끝난 판이 있다 — 이 판이 도는 동안 다른 판을 시작해 끝냈다 (예전과 같은 기준)
--    (나) 이 판보다 먼저 시작한 판이 그 판의 최소 판 시간(턴 × 턴 최소 시간 + 스텝 / 2배속 − 여유)만 해도 이 판 시작을 넘긴다 — 실제로 두 판을 함께 돌렸다
--    늦게 도착한 정상 판 A 는 B 시작 전에 이미 다 친 판이라 (나)에 걸리지 않는다.

-- 판 검증에 쓰는 값. games/finger/src/game/progress.ts 의 LIMITS 와 맞춘다.
create or replace function public._finger_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'turn_min_time' then 0.4
    when 'step_rate' then 120
    when 'time_slack' then 2
    when 'max_age' then 7200
    when 'tower_max_age' then 21600
    when 'coin_min_time' then 20
    when 'max_turns' then 40
    when 'tower_turns' then 200
    when 'max_shot_steps' then 360
    when 'pick_cap' then 300
    when 'tower_floor_coins' then 10
    when 'tower_boss_coins' then 20
  end
$$;
revoke all on function public._finger_const(text) from public, anon, authenticated;

-- 판 끝: Edge Function finger-finish 가 스냅숏으로 다시 돌린 결과(RunResult)만 받는다 (service_role 만 부를 수 있다)
-- p_result: { cleared, ended, stars, turns, wave, waves, kills, coins(주운 엽전), fallen, steps }
create or replace function public.finger_finish_verified(p_user uuid, p_run uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rn public.finger_runs;
  pr public.finger_profiles;
  st record;
  elapsed numeric;
  v_cleared boolean;
  v_stars int;
  v_turns int;
  v_wave int;
  v_waves int;
  v_kills int;
  v_picked int;
  v_fallen int;
  v_steps int;
  v_floors int;
  tower boolean;
  old_floor int;
  old_turns int;
  old_stars int;
  first boolean := false;
  best boolean := false;
  raw int := 0;
  coin_lv int;
  n_coins int;
  before_heroes text[];
  after_heroes text[];
  got_coin boolean := false;
begin
  if p_user is null or p_run is null or p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'bad result'; end if;
  select * into rn from public.finger_runs where id = p_run for update;
  if not found or rn.user_id <> p_user then raise exception 'no run'; end if;
  if rn.finished_at is not null then raise exception 'already finished'; end if;
  begin
    v_cleared := (p_result ->> 'cleared')::boolean;
    v_stars := (p_result ->> 'stars')::int;
    v_turns := (p_result ->> 'turns')::int;
    v_wave := (p_result ->> 'wave')::int;
    v_waves := (p_result ->> 'waves')::int;
    v_kills := (p_result ->> 'kills')::int;
    v_picked := (p_result ->> 'coins')::int;
    v_fallen := (p_result ->> 'fallen')::int;
    v_steps := (p_result ->> 'steps')::int;
    v_floors := coalesce((p_result ->> 'floors')::int, 0);
  exception when others then raise exception 'bad result';
  end;
  tower := rn.mode = 'tower';
  if v_cleared is null or v_stars is null or v_turns is null or v_wave is null or v_waves is null
    or v_kills is null or v_picked is null or v_fallen is null or v_steps is null then raise exception 'bad result'; end if;
  -- 끝없는 탑: 200턴까지 · 한 턴에 한 층보다 더 오를 수 없다. 스테이지는 40턴까지 · 층 0
  if v_turns > public._finger_const(case when tower then 'tower_turns' else 'max_turns' end)
    or (tower and (v_floors < 0 or v_floors > v_turns or v_floors > v_waves)) or (not tower and v_floors <> 0)
  then raise exception 'bad result'; end if;
  if v_turns < 0 or v_waves < 1 or v_wave < 0 or v_wave >= v_waves
    or v_kills < 0 or v_picked < 0 or v_fallen < 0 or v_fallen > 4 or v_steps < 0
    or v_steps > v_turns * public._finger_const('max_shot_steps')
    or v_stars < 0 or v_stars > 3 or (v_cleared and (v_stars < 1 or v_turns < 1)) or (not v_cleared and v_stars <> 0)
  then raise exception 'bad result'; end if;
  elapsed := extract(epoch from (now() - rn.started_at));
  if elapsed + public._finger_const('time_slack') < v_turns * public._finger_const('turn_min_time') + v_steps / public._finger_const('step_rate') then
    raise exception 'too early';
  end if;
  -- 끝없는 탑(200턴까지)은 6시간, 스테이지는 2시간
  if elapsed > public._finger_const(case when tower then 'tower_max_age' else 'max_age' end) then raise exception 'too late'; end if;
  -- 겹침: (가) 이 판보다 늦게 시작해 이미 끝난 판 · (나) 먼저 시작한 판의 최소 판 시간이 이 판 시작을 넘김.
  -- 먼저 시작한 판이 늦게 저장된 것(못 보낸 판을 다시 보냄)만으로는 겹침이 아니다
  if exists (
    select 1 from public.finger_runs o
    where o.user_id = p_user and o.id <> rn.id and o.finished_at is not null
      and (
        (o.started_at > rn.started_at
          and o.finished_at > rn.started_at + interval '2 seconds' and o.started_at < now() - interval '2 seconds')
        or (o.started_at <= rn.started_at
          and o.started_at + make_interval(secs => coalesce(o.turns, 0) * public._finger_const('turn_min_time')
            + coalesce(o.steps, 0) / public._finger_const('step_rate') - public._finger_const('time_slack')) > rn.started_at)
      )
  ) then raise exception 'overlap'; end if;

  if not tower then
    select * into st from public._finger_stages() t where t.stage_id = rn.stage_id;
    if not found then raise exception 'bad stage'; end if;
  end if;
  pr := public._finger_profile_row(p_user);
  before_heroes := public._finger_unlocked(p_user);
  -- 엽전 강화는 판 시작 때 값 (스냅숏)
  coin_lv := least(5, greatest(0, coalesce((rn.upgrades ->> 'coin')::int, 0)));

  if tower then
    -- 끝없는 탑: 엽전은 올라간 층으로. 기록은 더 높은 층, 같은 층이면 더 적은 턴일 때만 (그때 데려간 대원 · 달성 시각과 함께)
    v_stars := 0;
    raw := public._finger_tower_coins(v_floors);
    select t.best_floor, t.turns into old_floor, old_turns from public.finger_tower t where t.user_id = p_user for update;
    if v_floors >= 1 and (old_floor is null or v_floors > old_floor or (v_floors = old_floor and v_turns < old_turns)) then
      insert into public.finger_tower (user_id, best_floor, turns, party, achieved_at) values (p_user, v_floors, v_turns, rn.party, now())
      on conflict (user_id) do update set best_floor = excluded.best_floor, turns = excluded.turns, party = excluded.party, achieved_at = excluded.achieved_at;
      best := true;
    end if;
  elsif v_cleared then
    select s.stars into old_stars from public.finger_stages s where s.user_id = p_user and s.stage_id = rn.stage_id;
    first := old_stars is null;
    old_stars := coalesce(old_stars, 0);
    raw := st.clear_coins + st.star_coins * v_stars + (case when first then st.first_coins else 0 end);
    insert into public.finger_stages (user_id, stage_id, stars, best_turns) values (p_user, rn.stage_id, v_stars, v_turns)
    on conflict (user_id, stage_id) do update set stars = greatest(public.finger_stages.stars, excluded.stars),
      best_turns = least(public.finger_stages.best_turns, excluded.best_turns);
    best := v_stars > old_stars;
  else
    raw := floor(st.clear_coins * 3 * least(v_wave, v_waves) / (10.0 * v_waves));
  end if;

  n_coins := floor((raw + least(v_picked, public._finger_const('pick_cap'))) * (100 + 5 * coin_lv) / 100.0);
  update public.finger_profiles set
    coins = coins + n_coins,
    total_stars = coalesce((select sum(s.stars) from public.finger_stages s where s.user_id = p_user), 0),
    cleared_stages = (select count(*) from public.finger_stages s where s.user_id = p_user),
    stars_updated_at = case when best and not tower then now() else stars_updated_at end,
    updated_at = now()
  where user_id = p_user;
  update public.finger_runs set finished_at = now(), cleared = v_cleared, stars = v_stars, turns = v_turns, wave = v_wave,
    kills = v_kills, picked = v_picked, fallen = v_fallen, steps = v_steps, floors = v_floors, coins_earned = n_coins where id = rn.id;
  after_heroes := public._finger_unlocked(p_user);
  -- 시아코인: 서버 경과 20초 넘게 한 판(한 턴 이상)마다 1 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if elapsed >= public._finger_const('coin_min_time') and v_turns >= 1 then
    got_coin := public._grant_sia_coin(p_user, 'finger', p_run::text);
  end if;
  return jsonb_build_object(
    'profile', public._finger_profile_json(p_user),
    'result', jsonb_build_object(
      'coins', n_coins, 'stars', v_stars, 'floors', v_floors, 'first', first, 'best', best, 'siaCoin', got_coin,
      'newHeroes', to_jsonb(array(select x from unnest(after_heroes) x where not (x = any(before_heroes))))
    )
  );
end $$;
revoke all on function public.finger_finish_verified(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finger_finish_verified(uuid, uuid, jsonb) to service_role;
