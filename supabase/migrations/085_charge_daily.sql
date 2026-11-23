-- 시아돌격대 오늘의 도전: 오늘의 길 (공통 틀 082_daily.sql)
--   날짜 씨앗으로 만든 끝없는 길 코스를 모두 같이 달린다 (코스는 기기가 날짜에서 만든다: games/charge/src/game/daily.ts).
--   점수 = 달린 거리(m). detail = { meters, kills, bosses, leader }.
--   판 종류 'daily' 를 더한다: 검사·엽전은 끝없는 길과 같고, 끝없는 길 최고 기록(charge_endless)·랭킹과는 따로다.
--   기록은 charge_finish 가 검사를 마친 결과로 _daily_record 를 부른다 (기기가 점수를 따로 보내지 않는다).
--   다시 정의: charge_start (이전 최신 075_cat_charge.sql), charge_finish (이전 최신 061_charge.sql). 달라진 곳은 'daily' 갈래뿐.

alter table public.charge_runs drop constraint if exists charge_runs_mode_check;
alter table public.charge_runs add constraint charge_runs_mode_check check (mode in ('normal', 'endless', 'daily'));

-- 판 시작: 'daily' 는 스테이지 'daily', 잠금 없음 (누구나 오늘의 길을 달린다. 대장 검사는 그대로)
create or replace function public.charge_start(p_stage text, p_leader text, p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rid uuid; extra boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('normal', 'endless', 'daily') then raise exception 'bad mode'; end if;
  if p_leader is null or not exists (select 1 from public._charge_leaders() l where l.id = p_leader) then raise exception 'bad leader'; end if;
  perform public._check_character(me, p_leader, 'charge');
  select l.unlock_region < 0 into extra from public._charge_leaders() l where l.id = p_leader;
  if not extra and not (p_leader = any(public._charge_unlocked(me))) then raise exception 'leader locked'; end if;
  if p_mode = 'daily' then
    if p_stage is distinct from 'daily' then raise exception 'bad stage'; end if;
  elsif p_mode = 'endless' then
    if p_stage is distinct from 'endless' then raise exception 'bad stage'; end if;
    if not public._charge_cleared(me, '1-5') then raise exception 'endless locked'; end if;
  else
    if p_stage is null or not exists (select 1 from public._charge_stages() t where t.stage_id = p_stage) then raise exception 'bad stage'; end if;
    if not public._charge_stage_open(me, p_stage) then raise exception 'stage locked'; end if;
  end if;
  perform public._charge_profile_row(me);
  insert into public.charge_runs (user_id, stage_id, leader, mode) values (me, p_stage, p_leader, p_mode) returning id into rid;
  return rid;
end $$;
revoke all on function public.charge_start(text, text, text) from public, anon;
grant execute on function public.charge_start(text, text, text) to authenticated;

-- 판 끝: 061 의 정의 그대로 + 'daily' 갈래 (오늘 순위 기록, 결과에 daily = { day, improved, best, first })
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
  if exists (
    select 1 from public.charge_runs o
    where o.user_id = me and o.id <> rn.id and o.finished_at is not null
      and o.finished_at > rn.started_at + interval '2 seconds' and o.started_at < now() - interval '2 seconds'
  ) then raise exception 'overlap'; end if;

  pr := public._charge_profile_row(me);
  before_leaders := public._charge_unlocked(me);
  coin_mul := 1 + 0.05 * least(5, greatest(0, coalesce((pr.upgrades ->> 'coin')::int, 0)));
  select l.coin_mul into leader_mul from public._charge_leaders() l where l.id = rn.leader;
  leader_mul := coalesce(leader_mul, 1);

  if daily then
    raw := floor(p_meters / 20.0) + 5 * p_bosses;
    -- 끝없는 길 최고 기록(charge_endless)은 건드리지 않고, 판을 시작한 날(한국 시간)의 오늘 순위에만 넣는다.
    -- 판마다 한 번만 끝낼 수 있으니(already finished) 같은 판이 두 번 들어가지 않는다.
    d_day := (rn.started_at at time zone 'Asia/Seoul')::date;
    if p_meters > 0 and d_day >= public._daily_day() - 1 and d_day <= public._daily_day() then
      d_out := public._daily_record(me, 'charge', p_meters::bigint,
        jsonb_build_object('meters', p_meters, 'kills', p_kills, 'bosses', p_bosses, 'leader', rn.leader), p_run::text, d_day);
      best := coalesce((d_out ->> 'improved')::boolean, false);
    end if;
  elsif endless then
    raw := floor(p_meters / 20.0) + 5 * p_bosses;
    if not exists (select 1 from public.charge_endless e where e.user_id = me and e.best_meters >= p_meters) then
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
revoke all on function public.charge_finish(uuid, int, boolean, int, int, numeric, int, int, int) from public, anon;
grant execute on function public.charge_finish(uuid, int, boolean, int, int, numeric, int, int, int) to authenticated;
