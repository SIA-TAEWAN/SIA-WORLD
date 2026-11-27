-- 120: 11-27 3차 전체검사 반영
-- 1. 랭킹 뷰에서 관리자(profiles.is_admin) 빼기 — 관리자 혜택(엽전·시아코인 1만)이 있는 게임 중 117·119 에서 빠진 것.
--    열·순서는 이전 정의 그대로 (create or replace view), 권한도 그대로 다시 적는다.

-- tower_ranking: 최신 정의 104_tower.sql
create or replace view public.tower_ranking as
  select r.user_id, p.nickname, r.best_floor, r.level, r.best_at as achieved_at,
    (row_number() over (order by r.best_floor desc, r.level desc, r.best_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.tower_profiles r join public.profiles p on p.id = r.user_id
  where r.best_floor > 0 and not coalesce(p.is_admin, false);
revoke all on public.tower_ranking from anon, authenticated;
grant select on public.tower_ranking to anon, authenticated;

-- survival_ranking: 최신 정의 038_survival.sql
create or replace view public.survival_ranking as
  select r.user_id, p.nickname, r.map_id, r.best_time, r.best_kills, r.cleared, r.character, r.achieved_at,
    (row_number() over (
      partition by r.map_id
      order by r.best_time desc, r.cleared desc, r.best_kills desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over (partition by r.map_id))::int as total
  from public.survival_records r join public.profiles p on p.id = r.user_id
  where not coalesce(p.is_admin, false);
revoke all on public.survival_ranking from anon, authenticated;
grant select on public.survival_ranking to anon, authenticated;

-- survival_endless_ranking: 최신 정의 044_survival_endless.sql
create or replace view public.survival_endless_ranking as
  select r.user_id, p.nickname, r.map_id, r.best_time, r.best_kills, false as cleared, r.character, r.achieved_at,
    (row_number() over (
      partition by r.map_id
      order by r.best_time desc, r.best_kills desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over (partition by r.map_id))::int as total
  from public.survival_endless_records r join public.profiles p on p.id = r.user_id
  where not coalesce(p.is_admin, false);
revoke all on public.survival_endless_ranking from anon, authenticated;
grant select on public.survival_endless_ranking to anon, authenticated;

-- survival_hell_ranking: 최신 정의 055_survival_hell.sql
create or replace view public.survival_hell_ranking as
  select r.user_id, p.nickname, r.map_id, r.best_time, r.best_kills, r.cleared, r.character, r.achieved_at,
    (row_number() over (
      partition by r.map_id
      order by r.best_time desc, r.cleared desc, r.best_kills desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over (partition by r.map_id))::int as total
  from public.survival_hell_records r join public.profiles p on p.id = r.user_id
  where not coalesce(p.is_admin, false);
revoke all on public.survival_hell_ranking from anon, authenticated;
grant select on public.survival_hell_ranking to anon, authenticated;

-- charge_stage_ranking: 최신 정의 061_charge.sql
create or replace view public.charge_stage_ranking as
  select r.user_id, p.nickname, r.total_stars, r.cleared_stages,
    (select d.stage_id from public.charge_stages d where d.user_id = r.user_id
      order by split_part(d.stage_id, '-', 1)::int desc, split_part(d.stage_id, '-', 2)::int desc limit 1) as best_stage,
    r.stars_updated_at as achieved_at,
    (row_number() over (order by r.total_stars desc, r.cleared_stages desc, r.stars_updated_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.charge_profiles r join public.profiles p on p.id = r.user_id
  where r.total_stars > 0 and not coalesce(p.is_admin, false);
revoke all on public.charge_stage_ranking from anon, authenticated;
grant select on public.charge_stage_ranking to anon, authenticated;

-- charge_endless_ranking: 최신 정의 061_charge.sql
create or replace view public.charge_endless_ranking as
  select r.user_id, p.nickname, r.best_meters, r.leader, r.achieved_at,
    (row_number() over (order by r.best_meters desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.charge_endless r join public.profiles p on p.id = r.user_id
  where not coalesce(p.is_admin, false);
revoke all on public.charge_endless_ranking from anon, authenticated;
grant select on public.charge_endless_ranking to anon, authenticated;

-- finger_stage_ranking: 최신 정의 067_finger.sql
create or replace view public.finger_stage_ranking as
  select r.user_id, p.nickname, r.total_stars, r.cleared_stages,
    (select d.stage_id from public.finger_stages d where d.user_id = r.user_id
      order by split_part(d.stage_id, '-', 1)::int desc, split_part(d.stage_id, '-', 2)::int desc limit 1) as best_stage,
    r.stars_updated_at as achieved_at,
    (row_number() over (order by r.total_stars desc, r.cleared_stages desc, r.stars_updated_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.finger_profiles r join public.profiles p on p.id = r.user_id
  where r.total_stars > 0 and not coalesce(p.is_admin, false);
revoke all on public.finger_stage_ranking from anon, authenticated;
grant select on public.finger_stage_ranking to anon, authenticated;

-- finger_tower_ranking: 최신 정의 067_finger.sql
create or replace view public.finger_tower_ranking as
  select r.user_id, p.nickname, r.best_floor, r.turns, r.party, r.achieved_at,
    (row_number() over (order by r.best_floor desc, r.turns asc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.finger_tower r join public.profiles p on p.id = r.user_id
  where r.best_floor > 0 and not coalesce(p.is_admin, false);
revoke all on public.finger_tower_ranking from anon, authenticated;
grant select on public.finger_tower_ranking to anon, authenticated;

-- 2. 돌격대 스테이지 판 최대 시간 600 → 1800초 (games/charge/src/game/progress.ts LIMITS.maxTime 과 같게, tests/sql.test.ts 가 대조)
create or replace function public._charge_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_time' then 1800  -- 120: 600 → 1800 (대원이 적으면 보스전이 10분을 넘겨 클리어가 'bad time' 으로 버려졌다)
    when 'endless_max_time' then 3600
    when 'clear_min_time' then 45
    when 'time_slack' then 3
    when 'max_troops' then 9999
    when 'coin_min_time' then 20
    when 'max_age' then 7200
    when 'run_speed' then 300
    when 'meter' then 50
    when 'endless_seg' then 9000
  end
$$;
revoke all on function public._charge_const(text) from public, anon, authenticated;

-- 3. 끝없는 길을 0m 로 끝내면 최고 기록(0m 줄 · '새 기록!')을 만들지 않는다. 나머지는 107 그대로.
create or replace function public.charge_finish(
  p_run uuid, p_time int, p_cleared boolean, p_troops int, p_kills int, p_progress numeric, p_meters int, p_bosses int, p_crate int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  rn public.charge_runs;
  pr public.charge_profiles;
  st record;
  endless boolean;
  elapsed numeric;
  n_stars int := 0;
  old_stars int := 0;
  first boolean := false;
  best boolean := false;
  raw numeric := 0;
  crate numeric := 0;
  coin_mul numeric;
  leader_mul numeric;
  n_coins int;
  before_leaders text[];
  after_leaders text[];
  got_coin boolean := false;
  daily boolean;
  d_day date;
  d_out jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into rn from public.charge_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.finished_at is not null then raise exception 'already finished'; end if;
  daily := rn.mode = 'daily';
  -- 오늘의 길은 끝없는 길과 같은 검사·엽전 식을 쓴다
  endless := rn.mode in ('endless', 'daily');
  if p_time is null or p_cleared is null or p_troops is null or p_kills is null or p_progress is null or p_meters is null or p_bosses is null or p_crate is null then raise exception 'bad result'; end if;
  if p_time < 0 or p_time > (case when endless then public._charge_const('endless_max_time') else public._charge_const('max_time') end) then raise exception 'bad time'; end if;
  if p_troops < 0 or p_troops > public._charge_const('max_troops') or p_kills < 0 or p_crate < 0 or p_progress < 0 or p_progress > 1 or p_meters < 0 or p_bosses < 0 then raise exception 'bad result'; end if;
  if endless then
    if p_cleared then raise exception 'bad result'; end if;
    if p_meters > p_time * public._charge_const('run_speed') / public._charge_const('meter') + 5 then raise exception 'bad result'; end if;
    if p_bosses > floor(p_meters * public._charge_const('meter') / public._charge_const('endless_seg')) + 1 then raise exception 'bad result'; end if;
  elsif p_cleared and (p_time < public._charge_const('clear_min_time') or p_troops < 1) then raise exception 'bad result';
  end if;
  elapsed := extract(epoch from (now() - rn.started_at));
  if elapsed < p_time - public._charge_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._charge_const('max_age') then raise exception 'too late'; end if;
  -- 107: 프로필 행 잠금을 겹침 검사 앞으로 — 같은 사람의 판 끝내기를 한 번에 하나씩 (두 판이 동시에 끝나 서로의 끝을 못 보고 둘 다 지나가지 않게)
  pr := public._charge_profile_row(me);
  -- 겹침: 두 판의 최소 판 시간이 실제로 겹칠 때만 (101).
  --   (가) 이 판보다 늦게 시작한 판: 이 판의 최소 판 시간(받은 시간 − time_slack, 'too early' 검사와 같은 값)이 그 판 시작을 넘김
  --   (나) 먼저 시작한 판: 그 판의 최소 판 시간(적힌 시간 − time_slack)이 이 판 시작을 넘김
  -- 먼저 시작한 판이 늦게 저장된 것(못 보낸 판을 다시 보냄)만으로는 겹침이 아니다
  if exists (
    select 1 from public.charge_runs o
    where o.user_id = me and o.id <> rn.id and o.finished_at is not null
      and (
        (o.started_at > rn.started_at
          and rn.started_at + make_interval(secs => p_time - public._charge_const('time_slack')) > o.started_at)
        or (o.started_at <= rn.started_at
          and o.started_at + make_interval(secs => coalesce(o.time, 0) - public._charge_const('time_slack')) > rn.started_at)
      )
  ) then raise exception 'overlap'; end if;

  before_leaders := public._charge_unlocked(me);
  coin_mul := 1 + 0.05 * least(5, greatest(0, coalesce((pr.upgrades ->> 'coin')::int, 0)));
  select l.coin_mul into leader_mul from public._charge_leaders() l where l.id = rn.leader;
  leader_mul := coalesce(leader_mul, 1);

  if daily then
    raw := floor(p_meters / 20.0) + 5 * p_bosses;
    -- 끝없는 길 최고 기록(charge_endless)은 건드리지 않고, 그 판이 달린 코스의 날짜(daily_day) 순위에만 넣는다.
    -- 판마다 한 번만 끝낼 수 있으니(already finished) 같은 판이 두 번 들어가지 않는다.
    d_day := coalesce(rn.daily_day, (rn.started_at at time zone 'Asia/Seoul')::date);
    if p_meters > 0 and d_day >= public._daily_day() - 1 and d_day <= public._daily_day() then
      d_out := public._daily_record(me, 'charge', p_meters::bigint,
        jsonb_build_object('meters', p_meters, 'kills', p_kills, 'bosses', p_bosses, 'leader', rn.leader), p_run::text, d_day);
      best := coalesce((d_out ->> 'improved')::boolean, false);
    end if;
  elsif endless then
    raw := floor(p_meters / 20.0) + 5 * p_bosses;
    if p_meters > 0 and not exists (select 1 from public.charge_endless e where e.user_id = me and e.best_meters >= p_meters) then
      insert into public.charge_endless (user_id, best_meters, leader, achieved_at) values (me, p_meters, rn.leader, now())
      on conflict (user_id) do update set best_meters = excluded.best_meters, leader = excluded.leader, achieved_at = excluded.achieved_at;
      best := true;
    end if;
  else
    select * into st from public._charge_stages() t where t.stage_id = rn.stage_id;
    if not found then raise exception 'bad stage'; end if;
    crate := least(p_crate, round(st.crate_coins * 1.2));
    if p_cleared then
      n_stars := case when p_troops >= st.stars3 then 3 when p_troops >= st.stars2 then 2 else 1 end;
      select s.stars into old_stars from public.charge_stages s where s.user_id = me and s.stage_id = rn.stage_id;
      first := old_stars is null;
      old_stars := coalesce(old_stars, 0);
      raw := 15 + 5 * st.region + 5 * n_stars + (case when first then 20 + 10 * st.region else 0 end);
      insert into public.charge_stages (user_id, stage_id, stars, best_troops) values (me, rn.stage_id, n_stars, p_troops)
      on conflict (user_id, stage_id) do update set stars = greatest(public.charge_stages.stars, excluded.stars),
        best_troops = greatest(public.charge_stages.best_troops, excluded.best_troops);
      best := n_stars > old_stars;
    else
      raw := floor((15 + 5 * st.region) * 0.3 * least(1, greatest(0, p_progress)));
    end if;
  end if;

  n_coins := floor((raw + crate) * coin_mul * leader_mul);
  update public.charge_profiles set
    coins = coins + n_coins,
    total_stars = coalesce((select sum(s.stars) from public.charge_stages s where s.user_id = me), 0),
    cleared_stages = (select count(*) from public.charge_stages s where s.user_id = me),
    stars_updated_at = case when best and not endless then now() else stars_updated_at end,
    updated_at = now()
  where user_id = me;
  update public.charge_runs set finished_at = now(), time = p_time, cleared = p_cleared, troops = p_troops, kills = p_kills,
    meters = p_meters, bosses = p_bosses, coins_earned = n_coins where id = rn.id;
  after_leaders := public._charge_unlocked(me);
  -- 시아코인: 20초 넘게 한 판마다 1 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if p_time >= public._charge_const('coin_min_time') then
    got_coin := public._grant_sia_coin(me, 'charge', p_run::text);
  end if;
  return jsonb_build_object(
    'profile', public._charge_profile_json(me),
    'result', jsonb_build_object(
      'coins', n_coins, 'stars', n_stars, 'first', first, 'best', best, 'siaCoin', got_coin, 'daily', d_out,
      'newLeaders', to_jsonb(array(select x from unnest(after_leaders) x where not (x = any(before_leaders))))
    )
  );
end $$;

-- 이미 생긴 0m 기록 줄은 지운다
delete from public.charge_endless where best_meters <= 0;
