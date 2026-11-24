-- 100: 시아핑거 판 끝 겹침 검사 고치기 (086_finger_daily.sql 의 finger_finish_verified 를 다시 정의, 다른 곳은 086 그대로)
--   086(과 070)의 겹침 조건 (가) "이 판보다 늦게 시작해서 이미 끝난 판이 있으면 겹침" 은
--   판 A 를 끝내고 결과를 못 보내 보관해 둔 사이 판 B 를 하고 B 를 먼저 저장하면, 나중에 다시 보낸 정상 판 A 를 'overlap' 으로 거절했다.
--   (가)를 (나)와 같은 꼴로 바꾼다: 늦게 시작한 판 B 가 있어도, 이 판 A 의 최소 판 시간
--   (턴 × turn_min_time + 걸음 / step_rate − time_slack, 'too early' 검사와 같은 값)이 B 의 시작을 넘길 때만 겹침이다.
--   즉 두 판을 실제로 동시에 친 경우만 거절한다.
--   판 하나의 조작 상한: 스테이지 40턴(max_turns), 끝없는 탑 200턴(tower_turns) — finger-finish 의 checkInputs 와 같다.
--   권한 · search_path 는 086 과 같다 (service_role 만).

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
  v_daily jsonb;
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
  -- 겹침: 두 판의 최소 판 시간이 실제로 겹칠 때만 (100).
  --   (가) 이 판보다 늦게 시작한 판: 이 판의 최소 판 시간(받은 턴·걸음)이 그 판 시작을 넘김
  --   (나) 먼저 시작한 판: 그 판의 최소 판 시간이 이 판 시작을 넘김
  -- 먼저 시작한 판이 늦게 저장된 것(못 보낸 판을 다시 보냄)만으로는 겹침이 아니다
  if exists (
    select 1 from public.finger_runs o
    where o.user_id = p_user and o.id <> rn.id and o.finished_at is not null
      and (
        (o.started_at > rn.started_at
          and rn.started_at + make_interval(secs => v_turns * public._finger_const('turn_min_time')
            + v_steps / public._finger_const('step_rate') - public._finger_const('time_slack')) > o.started_at)
        or (o.started_at <= rn.started_at
          and o.started_at + make_interval(secs => coalesce(o.turns, 0) * public._finger_const('turn_min_time')
            + coalesce(o.steps, 0) / public._finger_const('step_rate') - public._finger_const('time_slack')) > rn.started_at)
      )
  ) then raise exception 'overlap'; end if;

  -- 오늘의 도전: 엽전 · 별 · 스테이지 기록 · 대원 합류는 그대로 두고, 깬 판만 그날 순위에 넣는다 (점수 = −턴 수)
  if rn.daily is not null then
    if tower then raise exception 'bad result'; end if;
    perform public._finger_profile_row(p_user);
    update public.finger_runs set finished_at = now(), cleared = v_cleared, stars = v_stars, turns = v_turns, wave = v_wave,
      kills = v_kills, picked = v_picked, fallen = v_fallen, steps = v_steps, floors = 0, coins_earned = 0 where id = rn.id;
    -- 그제보다 오래된 판(못 보낸 판을 며칠 뒤에 다시 보냄)은 순위에 넣지 않는다 (_daily_record 의 'bad day' 를 피한다)
    if v_cleared and rn.daily >= public._daily_day() - 1 and rn.daily <= public._daily_day() then
      v_daily := public._daily_record(p_user, 'finger', (-v_turns)::bigint,
        jsonb_build_object('turns', v_turns, 'fallen', v_fallen, 'stage', rn.stage_id), p_run::text, rn.daily)
        || jsonb_build_object('recorded', true);
    else
      v_daily := jsonb_build_object('day', to_char(rn.daily, 'YYYY-MM-DD'), 'recorded', false);
    end if;
    -- 시아코인은 보통 판과 같은 규칙
    if elapsed >= public._finger_const('coin_min_time') and v_turns >= 1 then
      got_coin := public._grant_sia_coin(p_user, 'finger', p_run::text);
    end if;
    return jsonb_build_object(
      'profile', public._finger_profile_json(p_user),
      'result', jsonb_build_object(
        'coins', 0, 'stars', v_stars, 'floors', 0, 'first', false, 'best', false, 'siaCoin', got_coin,
        'newHeroes', '[]'::jsonb, 'daily', v_daily
      )
    );
  end if;

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
