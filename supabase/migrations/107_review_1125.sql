-- 107: 11-25 전체 검사 반영 (배구 · 시아의탑 · 돌격대 · 열두길)
--   다시 정의하는 함수와 그 앞의 마지막 정의 (함수 전체를 그대로 옮기고 아래만 바꾼다. 권한 · search_path 도 같다):
--     volleyball_begin(text, bigint, int, uuid, text)                       036_hardening.sql (겉 함수. 속 _volleyball_begin_unchecked 는 072 그대로)
--     tower_save(jsonb, int)                                                106_tower_review.sql
--     tower_set_look(jsonb)                                                 104_tower.sql
--     charge_finish(uuid, int, boolean, int, int, numeric, int, int, int)   101_overlap_village_fix.sql
--     twelve_finish(uuid, jsonb)                                            101_overlap_village_fix.sql
--
--   1. 배구: 새 경기를 열 때 무효로 하는 내 다른 경기를 'pending'(아직 시작 전)으로만 줄인다.
--      예전에는 보고가 없는 'live' 도 무효로 해서, 경기 중 나간 사람이 곧바로 새 경기를 열면
--      남아서 AI 와 끝까지 한 사람의 승리 · 시아코인이 사라졌다.
--   2. 시아의탑: tower_save 가 저장 시각 'savedAt'(updated_at, ms — tower_state 와 같은 값)을 더 돌려준다 (다른 칸은 그대로).
--      기기는 마지막으로 받은 savedAt 을 적어 두고, tower_state 의 savedAt 이 그보다 클 때(다른 기기의 저장)만 못 보낸 저장을 버린다.
--      tower_set_look 은 updated_at 을 더 이상 바꾸지 않는다 (외형 바꾸기가 '다른 기기 저장' 으로 보이지 않게).
--   3. 돌격대 · 열두길 판 끝: 프로필 행 잠금(_charge_profile_row / _twelve_profile_row, for update)을 겹침 검사 앞으로 옮겨
--      같은 사람의 판 끝내기를 한 번에 하나씩 한다. 나머지는 101 과 한 글자도 다르지 않다.
--   표는 만들지 않는다 (함수만). 여러 번 실행해도 안전하다.

-- ---------- 1. 시아배구 경기 시작 (036 그대로, 무효 대상만) ----------
create or replace function public.volleyball_begin(p_room_key text, p_match_no bigint, p_side int, p_opponent uuid, p_character text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; old uuid;
begin
  if me is null then raise exception 'need login'; end if;
  -- 같은 사람의 시작 요청은 한 번에 하나씩
  perform pg_advisory_xact_lock(hashtext('volley-begin:' || me::text));
  -- 내 예전 경기 중 보고 하나만 올라온 채 남은 것(결과 화면을 일찍 떠난 경우)은 여기서 확정한다
  for old in select id from public.volleyball_matches
    where status = 'live' and (left_user_id = me or right_user_id = me)
      and (left_report is null) <> (right_report is null)
      and first_report_at <= clock_timestamp() - make_interval(secs => public._volleyball_const('settle_sec'))
  loop
    perform public.volleyball_settle(old);
  end loop;
  select count(*) into n from public.volleyball_matches
  where status = 'done' and done_at >= (public._kst_today()::timestamp at time zone 'Asia/Seoul')
    and ((left_user_id = me and right_user_id = p_opponent) or (left_user_id = p_opponent and right_user_id = me));
  if n >= public._volleyball_const('pair_per_day') then raise exception 'daily limit'; end if;
  -- 107: 아직 시작하지 않은(pending) 내 다른 경기만 무효로 한다. 시작한(live) 경기는 나간 사람이 새 경기를 열어도 그대로 두어
  --      남아서 AI 와 끝까지 한 사람의 'leave' 보고 → settle 로 확정된다 (끝내 보고가 없으면 034 의 3시간 정리)
  update public.volleyball_matches set status = 'void', done_at = clock_timestamp()
  where status = 'pending' and (left_user_id = me or right_user_id = me)
    and not (room_key = p_room_key and match_no = p_match_no)
    and left_report is null and right_report is null;
  return public._volleyball_begin_unchecked(p_room_key, p_match_no, p_side, p_opponent, p_character);
end $$;
revoke all on function public.volleyball_begin(text, bigint, int, uuid, text) from public, anon;
grant execute on function public.volleyball_begin(text, bigint, int, uuid, text) to authenticated;

-- ---------- 2. 시아의탑 저장 · 외형 (106 · 104 그대로, savedAt · updated_at 만) ----------
create or replace function public.tower_save(p_data jsonb, p_cleared int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.tower_profiles; best int; cp int; got boolean := false; miss int; saved_at timestamptz;
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
  where user_id = me
  returning updated_at into saved_at;
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
  -- 107: 이 저장이 남긴 시각(tower_state 의 savedAt 과 같은 값, ms). 기기는 이것을 '내가 마지막으로 넣은 저장' 으로 적어 둔다
  return jsonb_build_object('bestFloor', best, 'gotCoin', got, 'siaCoins', public._tower_sia(me),
    'savedAt', floor(extract(epoch from saved_at) * 1000)::bigint);
end $$;
revoke all on function public.tower_save(jsonb, int) from public, anon;
grant execute on function public.tower_save(jsonb, int) to authenticated;

create or replace function public.tower_set_look(p_look jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.tower_profiles; paid boolean := false;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if not public._tower_look_ok(p_look) then raise exception 'bad look'; end if;
  perform public._tower_row(me);
  perform public._ensure_wallet(me);
  -- 같은 사람이 동시에 두 번 눌러도 한 번만 빠지게 행을 잠근다
  select * into r from public.tower_profiles where user_id = me for update;
  if r.look is not null and r.look <> p_look then
    if public._tower_sia(me) < public._tower_look_price() then raise exception 'not enough sia coins'; end if;
    perform public._spend_sia_coin(me, public._tower_look_price(), 'tower', 'look:' || (r.look_changes + 1)::text);
    paid := true;
  end if;
  -- 107: 외형은 진행 저장이 아니다 — updated_at(= tower_state 의 savedAt)을 건드리지 않는다
  update public.tower_profiles set look = p_look, look_changes = look_changes + case when paid then 1 else 0 end
  where user_id = me;
  return jsonb_build_object('look', p_look, 'siaCoins', public._tower_sia(me), 'paid', paid);
end $$;
revoke all on function public.tower_set_look(jsonb) from public, anon;
grant execute on function public.tower_set_look(jsonb) to authenticated;

-- ---------- 3. 시아돌격대 판 끝 (101 그대로, 잠금 순서만) ----------
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

-- ---------- 4. 시아열두길 맵 끝내기 (101 그대로, 잠금 순서만) ----------
create or replace function public.twelve_finish(p_run uuid, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  rn public.twelve_runs;
  pr public.twelve_profiles;
  mp record;
  rg record;
  v_time int; v_cleared boolean; v_elites int; v_boss boolean; v_chest boolean; v_deaths int;
  v_kills jsonb; v_used jsonb;
  k text; v jsonb; n numeric;
  normals int := 0;
  raw_exp bigint := 0; raw_coin bigint := 0;
  pct int; n_exp bigint; n_coins bigint;
  lv int; ex bigint; nd bigint; ups int := 0;
  elapsed numeric;
  pots int[]; used int[]; got_pots int[] := array[0, 0, 0, 0, 0, 0];
  n_stars int := 0; old_stars int := 0; new_stars int := 0; first boolean := false;
  pe int := 0; pb int := 0; pk int := 0; has_key boolean := false; got_key boolean := false;
  codex text[]; rare_list text[]; gear text[]; accs text[];
  base text; items jsonb := '[]'::jsonb; n_stones int := 0;
  star_item text; joined text; got_coin boolean := false; n_gift int := 0;
  seed bigint; r bigint; i int; idx int; cap int; pity boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into rn from public.twelve_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.finished_at is not null then raise exception 'already finished'; end if;
  select * into mp from public._twelve_maps() t where t.map_id = rn.map_id and t.mode = rn.mode;
  if not found then raise exception 'bad map'; end if;

  -- 1) 보고 읽기 · 검사 (src/game/progress.ts 의 checkReport)
  begin
    v_time := (p_report ->> 'time')::int;
    v_cleared := (p_report ->> 'cleared')::boolean;
    v_elites := (p_report ->> 'elites')::int;
    v_boss := (p_report ->> 'boss')::boolean;
    v_chest := (p_report ->> 'chest')::boolean;
    v_deaths := (p_report ->> 'deaths')::int;
  exception when others then raise exception 'bad result';
  end;
  if v_time is null or v_cleared is null or v_elites is null or v_boss is null or v_chest is null or v_deaths is null then raise exception 'bad result'; end if;
  if v_time < 0 or v_time > public._twelve_const('max_time') then raise exception 'bad time'; end if;
  v_kills := coalesce(p_report -> 'kills', '{}'::jsonb);
  if jsonb_typeof(v_kills) <> 'object' then raise exception 'bad kills'; end if;
  for k, v in select key, value from jsonb_each(v_kills) loop
    if not (mp.kinds ? k) or jsonb_typeof(v) <> 'number' then raise exception 'bad kills'; end if;
    n := v::text::numeric;
    if n <> floor(n) or n < 0 or n > (mp.kinds -> k ->> 0)::int then raise exception 'bad kills'; end if;
    normals := normals + n::int;
    raw_exp := raw_exp + n::int * (mp.kinds -> k ->> 1)::int;
    raw_coin := raw_coin + n::int * (mp.kinds -> k ->> 2)::int;
  end loop;
  if v_elites < 0 or v_elites > mp.elites then raise exception 'bad kills'; end if;
  if v_boss and not mp.boss then raise exception 'bad kills'; end if;
  if v_deaths < 0 then raise exception 'bad result'; end if;
  cap := public._twelve_const('potion_max')::int;
  v_used := p_report -> 'potions';
  if v_used is null or jsonb_typeof(v_used) = 'null' then
    used := array[0, 0, 0, 0, 0, 0];
  else
    if jsonb_typeof(v_used) <> 'array' or jsonb_array_length(v_used) <> 2
      or jsonb_typeof(v_used -> 0) <> 'array' or jsonb_array_length(v_used -> 0) <> 3
      or jsonb_typeof(v_used -> 1) <> 'array' or jsonb_array_length(v_used -> 1) <> 3 then raise exception 'bad potions'; end if;
    if exists (
      select 1 from jsonb_array_elements(v_used) a, jsonb_array_elements(a) e
      where jsonb_typeof(e) <> 'number' or e::text::numeric <> floor(e::text::numeric) or e::text::numeric < 0 or e::text::numeric > cap
    ) then raise exception 'bad potions'; end if;
    select array_agg((e.value)::text::int order by a.ord, e.ord) into used
    from jsonb_array_elements(v_used) with ordinality a(value, ord), jsonb_array_elements(a.value) with ordinality e(value, ord);
  end if;
  if v_cleared then
    if v_time < public._twelve_const('clear_min_time') then raise exception 'too early'; end if;
    -- 출구가 열리는 조건: 보스 맵은 보스, 그 밖에는 요괴의 exit_pct%
    if (mp.boss and not v_boss) or (not mp.boss and normals + v_elites < ceil(mp.total * public._twelve_const('exit_pct') / 100.0)) then raise exception 'bad result'; end if;
  end if;
  elapsed := extract(epoch from (now() - rn.started_at));
  if elapsed < v_time - public._twelve_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._twelve_const('max_age') then raise exception 'too late'; end if;
  -- 107: 프로필 행 잠금을 겹침 검사 앞으로 — 같은 사람의 판 끝내기를 한 번에 하나씩 (두 판이 동시에 끝나 서로의 끝을 못 보고 둘 다 지나가지 않게)
  pr := public._twelve_profile_row(me);
  -- 겹침: 두 판의 최소 판 시간이 실제로 겹칠 때만 (101).
  --   (가) 이 판보다 늦게 시작한 판: 이 판의 최소 판 시간(받은 시간 − time_slack, 'too early' 검사와 같은 값)이 그 판 시작을 넘김
  --   (나) 먼저 시작한 판: 그 판의 최소 판 시간(적힌 시간 − time_slack)이 이 판 시작을 넘김
  -- 먼저 시작한 판이 늦게 저장된 것(못 보낸 판을 다시 보냄)만으로는 겹침이 아니다
  if exists (
    select 1 from public.twelve_runs o
    where o.user_id = me and o.id <> rn.id and o.finished_at is not null
      and (
        (o.started_at > rn.started_at
          and rn.started_at + make_interval(secs => v_time - public._twelve_const('time_slack')) > o.started_at)
        or (o.started_at <= rn.started_at
          and o.started_at + make_interval(secs => coalesce(o.time, 0) - public._twelve_const('time_slack')) > rn.started_at)
      )
  ) then raise exception 'overlap'; end if;

  -- 2) 경험치 · 엽전 (맵 표로 계산. src/game/progress.ts 의 rewardOf · applyReport)
  raw_exp := raw_exp + v_elites * mp.elite_exp + (case when v_boss then mp.boss_exp else 0 end);
  raw_coin := raw_coin + v_elites * mp.elite_coin + (case when v_boss then mp.boss_coin else 0 end) + (case when v_chest then mp.chest_coin else 0 end);
  select e.pct into pct from public._twelve_exp_penalty() e where pr.level - mp.level >= e.gap order by e.gap desc limit 1;
  n_exp := floor(raw_exp * coalesce(pct, 100) / 100.0);
  n_coins := case when v_cleared then floor(raw_coin * (100 + rn.coin_pct) / 100.0) else 0 end;
  lv := pr.level;
  ex := pr.exp + n_exp;
  while lv < public._twelve_const('max_level') loop
    select t.need into nd from public._twelve_levels() t where t.level = lv;
    exit when nd is null or ex < nd;
    ex := ex - nd;
    lv := lv + 1;
    ups := ups + 1;
  end loop;
  if lv >= public._twelve_const('max_level') then ex := 0; end if;
  -- 쓴 물약은 깨든 쓰러지든 빠진다
  select array_agg((e.value)::text::int order by a.ord, e.ord) into pots
  from jsonb_array_elements(pr.potions) with ordinality a(value, ord), jsonb_array_elements(a.value) with ordinality e(value, ord);
  for i in 1..6 loop pots[i] := greatest(0, pots[i] - used[i]); end loop;

  -- 3) 깬 판만: 맵 기록 · 드랍 · 확정 보정 · 열쇠 · 별 보상 · 대원 합류 (쓰러지면 그 맵의 엽전·아이템을 잃는다)
  if v_cleared then
    n_stars := (case when v_time <= mp.par then 1 else 0 end) | (case when v_deaths = 0 then 2 else 0 end) | (case when v_chest then 4 else 0 end);
    select m.stars into old_stars from public.twelve_maps m where m.user_id = me and m.mode = rn.mode and m.map_id = rn.map_id;
    first := old_stars is null;
    old_stars := coalesce(old_stars, 0);
    new_stars := n_stars & ~old_stars;
    -- 대원 합류: 이 지형 보스를 어느 모드에서든 처음 잡았다
    if mp.boss and first and not public._twelve_joined(me, mp.region) then
      select h.id into joined from public._twelve_heroes() h where h.join_region = mp.region;
    end if;
    -- 보스의 선물 (094): 대원이 합류하지 않는 지형(10~12)의 보스 · 최종보스를 이 모드에서 처음 잡으면 강화석 꾸러미 (src/data/economy.ts 의 BOSS_GIFT · FINAL_GIFT)
    if mp.boss and v_boss and first then
      n_gift := coalesce(public._twelve_const('boss_gift_' || case when mp.no > 8 then 'final' else mp.region::text end), 0)::int;
      n_stones := n_stones + n_gift;
    end if;
    insert into public.twelve_maps (user_id, mode, map_id, stars, clears, best) values (me, rn.mode, rn.map_id, n_stars, 1, v_time)
    on conflict (user_id, mode, map_id) do update set stars = public.twelve_maps.stars | excluded.stars, clears = public.twelve_maps.clears + 1,
      best = case when public.twelve_maps.best > 0 then least(public.twelve_maps.best, excluded.best) else excluded.best end;

    -- 드랍 (src/game/drops.ts 의 rollRun): 일반 요괴 → 정예 → 보스. 판정 종류 번호는 drops.ts 의 TAG 와 같다
    select * into rg from public._twelve_regions() t where t.mode = rn.mode and t.region = mp.region;
    seed := rn.seed;
    gear := public._twelve_gear();
    accs := public._twelve_acc();
    rare_list := rg.rares;
    select t.elite, t.boss, t.key into pe, pb, pk from public.twelve_pity t where t.user_id = me and t.mode = rn.mode and t.region = mp.region;
    pe := coalesce(pe, 0); pb := coalesce(pb, 0); pk := coalesce(pk, 0);
    select coalesce(array_agg(c.base), array[]::text[]) into codex from public.twelve_codex c where c.user_id = me;
    has_key := exists (select 1 from public.twelve_keys t where t.user_id = me and t.mode = rn.mode and t.region = mp.region);

    for i in 1..normals loop
      r := public._twelve_roll(seed, 1, i) % 10000;
      if r < public._twelve_const('drop_potion') then
        idx := (public._twelve_roll(seed, 2, i) % 2)::int * 3 + rg.potion_size + 1;
        if pots[idx] < cap then
          pots[idx] := pots[idx] + 1;
          got_pots[idx] := got_pots[idx] + 1;
        end if;
      elsif r < public._twelve_const('drop_potion') + public._twelve_const('drop_gear') then
        base := gear[(public._twelve_roll(seed, 2, i) % array_length(gear, 1))::int + 1] || rg.tier::text;
        items := items || public._twelve_grant(me, base);
      end if;
    end loop;

    for i in 1..v_elites loop
      if public._twelve_roll(seed, 3, i) % 10000 < public._twelve_const('drop_elite_stone') then n_stones := n_stones + rg.elite_stones; end if;
      if public._twelve_roll(seed, 4, i) % 10000 < public._twelve_const('drop_elite_acc') then
        base := 'c-' || accs[(public._twelve_roll(seed, 5, i) % array_length(accs, 1))::int + 1] || '-' || rg.tier::text;
        items := items || public._twelve_grant(me, base);
      end if;
      pe := pe + 1;
      base := null;
      if public._twelve_roll(seed, 6, i) % 10000 < public._twelve_const('drop_elite_rare') then pity := false;
      elsif pe >= public._twelve_const('pity_elite') then pity := true;
      else pity := null;
      end if;
      if pity is not null then
        -- 확정 보정은 아직 없는 것부터, 확률로 나온 것(또는 다 가졌으면)은 목록에서 아무거나
        if pity then select x into base from unnest(rare_list) with ordinality u(x, ord) where not (x = any(codex)) order by ord limit 1; end if;
        base := coalesce(base, rare_list[(public._twelve_roll(seed, 7, i) % array_length(rare_list, 1))::int + 1]);
        if not (base = any(codex)) then codex := codex || base; end if;
        pe := 0; pb := 0;
        items := items || public._twelve_grant(me, base);
      end if;
    end loop;

    if v_boss then
      n_stones := n_stones + rg.boss_stones;
      if public._twelve_roll(seed, 8, 1) % 10000 < public._twelve_const('drop_boss_acc') then
        base := 'c-' || accs[(public._twelve_roll(seed, 9, 1) % array_length(accs, 1))::int + 1] || '-' || rg.tier::text;
        items := items || public._twelve_grant(me, base);
      end if;
      pb := pb + 1;
      base := null;
      if public._twelve_roll(seed, 10, 1) % 10000 < public._twelve_const('drop_boss_rare') then pity := false;
      elsif pb >= public._twelve_const('pity_boss') then pity := true;
      else pity := null;
      end if;
      if pity is not null then
        if pity then select x into base from unnest(rare_list) with ordinality u(x, ord) where not (x = any(codex)) order by ord limit 1; end if;
        base := coalesce(base, rare_list[(public._twelve_roll(seed, 11, 1) % array_length(rare_list, 1))::int + 1]);
        if not (base = any(codex)) then codex := codex || base; end if;
        pe := 0; pb := 0;
        items := items || public._twelve_grant(me, base);
      end if;
      -- 열쇠: 확률, 같은 보스 pity_key 번째에는 확정. 이미 있으면 떨어지지 않는다
      if not has_key then
        pk := pk + 1;
        if public._twelve_roll(seed, 12, 1) % 10000 < public._twelve_const('drop_key') or pk >= public._twelve_const('pity_key') then
          got_key := true;
          pk := 0;
          insert into public.twelve_keys (user_id, mode, region) values (me, rn.mode, mp.region) on conflict do nothing;
        end if;
      end if;
    end if;

    insert into public.twelve_pity (user_id, mode, region, elite, boss, key) values (me, rn.mode, mp.region, pe, pb, pk)
    on conflict (user_id, mode, region) do update set elite = excluded.elite, boss = excluded.boss, key = excluded.key;

    -- 지형의 별 24개를 모두 모으면 그 지형 장신구 (모드마다 한 번)
    if not (rg.star_item = any(codex)) and (
      select coalesce(sum((m.stars & 1) + ((m.stars >> 1) & 1) + ((m.stars >> 2) & 1)), 0) from public.twelve_maps m
      where m.user_id = me and m.mode = rn.mode and m.map_id like mp.region::text || '-%'
    ) >= 24 then
      star_item := rg.star_item;
      codex := codex || star_item;
      items := items || public._twelve_grant(me, star_item);
    end if;
    insert into public.twelve_codex (user_id, base) select me, x from unnest(codex) x on conflict do nothing;

    -- 시아코인: 깬 맵마다 1. 너무 짧은 판, 내 레벨이 권장 레벨보다 coin_level_gap 이상 높은 맵은 없음 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
    if v_time >= public._twelve_const('coin_min_time') and pr.level - mp.level < public._twelve_const('coin_level_gap') then
      got_coin := public._grant_sia_coin(me, 'twelve', p_run::text);
    end if;
  end if;

  update public.twelve_profiles set
    level = lv, exp = ex, coins = coins + n_coins, stones = stones + n_stones,
    potions = jsonb_build_array(jsonb_build_array(pots[1], pots[2], pots[3]), jsonb_build_array(pots[4], pots[5], pots[6])),
    cleared_maps = (select count(*) from public.twelve_maps m where m.user_id = me),
    level_at = case when lv <> pr.level then now() else level_at end,
    updated_at = now()
  where user_id = me;
  update public.twelve_runs set finished_at = now(), time = v_time, cleared = v_cleared, exp = n_exp, coins = n_coins, report = p_report where id = rn.id;

  return jsonb_build_object(
    'state', public._twelve_state_json(me),
    'result', jsonb_build_object(
      'exp', n_exp, 'coins', n_coins, 'ups', ups, 'level', lv, 'stars', n_stars, 'newStars', new_stars, 'first', first,
      'joined', joined, 'gift', n_gift, 'siaCoin', got_coin, 'items', items, 'stones', n_stones,
      'potions', jsonb_build_array(jsonb_build_array(got_pots[1], got_pots[2], got_pots[3]), jsonb_build_array(got_pots[4], got_pots[5], got_pots[6])),
      'key', got_key, 'starItem', star_item
    )
  );
end $$;
revoke all on function public.twelve_finish(uuid, jsonb) from public, anon;
grant execute on function public.twelve_finish(uuid, jsonb) to authenticated;
