-- 111: 시아카드배틀 (games/card, PRD [진행·재화] · [기술])
--   한 판 = 씨앗 + 영웅 + 모드(normal 보통 · endless 끝없는 모드 · daily 오늘의 도전) + 숙련 단계. 계정당 모드별 진행 중인 판 1개.
--   · card_start(mode, hero, mastery, day, seed) : 판 시작 → { runId, seed, … }. 같은 모드의 진행 중인 판은 버린 판(abandoned)이 된다.
--       보통·끝없는: 영웅은 _check_character(user, hero, 'card') (고양이는 이 게임에서 산 사람만), 씨앗은 서버가 정한다.
--       보통: 숙련 단계는 0 ~ 그 영웅이 연 단계(card_heroes.mastery, 최대 _card_const('mastery_open')).
--       오늘의 도전: 날짜(서버의 오늘)·씨앗·영웅은 화면이 날짜로 만든 값 (shared/daily.js 와 같은 식) — card-finish 가 다시 계산해 맞는지 본다.
--         그날 처음 시작한 판(first_of_day)만 순위에 넣는다 ('하루 첫 판만 기록'). 시아코인·숙련·클리어 수 없음.
--   · card_state()  : 진행 중인 판들(서버가 확인한 입력 기록 포함 → 다른 기기는 마지막으로 깬 막 다음부터 이어 한다) · 영웅별 숙련·클리어 · 끝없는 최고
--   · card_finish_verified(user, run, result, log) : Edge Function card-finish 가 _shared/card/verify.ts 로 다시 돌린 결과만 받는다 (service_role 만)
--       시아코인: 막 하나 깰 때마다 1 (한 판 최대 3, 어둑시니까지 4 · 끝없는 모드도 3까지 · 오늘의 도전 없음). ref = '<판>:<막>' 이라 같은 막은 한 번만.
--       보통 판 클리어(엔딩): 그 영웅 클리어 +1, 다음 숙련 단계 열림. 끝없는 모드: 올라간 칸 최고 기록. 오늘의 도전: 판이 끝나면 점수 기록.
--   · _cat_progress_card : 고양이 구매 조건 = 보통 판 클리어 1번 ({have: 클리어 수, need: 1})
--   · card_endless_ranking 뷰 : 끝없는 모드 최고 칸 → 먼저 달성한 순. 오늘의 도전 순위는 082 의 daily_ranking('card')
--   상수는 _shared/card/data/modes.ts · run.ts 와 같다 (games/card/tests/sql.test.ts 가 대조).

-- ---------- 1. 상수 ----------

create or replace function public._card_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'rules' then 3            -- RULES_VERSION (run.ts)
    when 'mastery_open' then 5     -- MASTERY_OPEN: 고를 수 있는 가장 높은 숙련 단계 (6~10 잠금)
    when 'coin_acts' then 3        -- COIN_ACTS: 한 판 시아코인 최대
    when 'coin_acts_true' then 4   -- COIN_ACTS_TRUE: 어둑시니까지 깬 판
    when 'max_log' then 30000      -- MAX_LOG: 입력 기록 최대 길이
    when 'score_floor' then 10     -- DAILY_SCORE (오늘의 도전 점수)
    when 'score_elite' then 30
    when 'score_boss' then 100
    when 'cat_need' then 1         -- 고양이: 보통 판 클리어 수
  end
$$;
revoke all on function public._card_const(text) from public, anon, authenticated;

-- ---------- 2. 표 ----------

create table if not exists public.card_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('normal', 'endless', 'daily')),
  hero text not null,
  mastery int not null default 0 check (mastery between 0 and 10),
  seed bigint not null check (seed between 0 and 4294967295),
  rules int not null,
  day date,                                   -- 오늘의 도전 날짜 (그 밖에는 null)
  first_of_day boolean not null default false, -- 그날 처음 시작한 오늘의 도전 판 (이 판만 순위에)
  status text not null default 'active' check (status in ('active', 'over', 'abandoned')),
  log jsonb not null default '[]'::jsonb,     -- 서버가 확인한 입력 기록 (마지막으로 시작한 막의 처음까지, 끝난 판은 전부)
  log_len int not null default 0,
  acts int not null default 0,                -- 깬 막 수 (어둑시니 포함)
  floors int not null default 0,
  elites int not null default 0,
  hp int,
  ending text check (ending in ('normal', 'true')),
  dead boolean not null default false,
  coins int not null default 0,               -- 이 판에서 받은 시아코인
  score bigint,                               -- 오늘의 도전 점수 (기록한 판)
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists card_runs_active_idx on public.card_runs (user_id, mode) where status = 'active';
create index if not exists card_runs_daily_idx on public.card_runs (user_id, day) where mode = 'daily';
alter table public.card_runs enable row level security;
drop policy if exists card_runs_read_own on public.card_runs;
create policy card_runs_read_own on public.card_runs for select using (auth.uid() = user_id);
revoke all on public.card_runs from anon, authenticated;
grant select on public.card_runs to authenticated;

-- 영웅별 숙련 단계(연 단계)·클리어 수 (보통 모드)
create table if not exists public.card_heroes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  hero text not null,
  mastery int not null default 0 check (mastery between 0 and 10),  -- 고를 수 있는 가장 높은 단계
  best int not null default -1,                                     -- 깬 가장 높은 단계 (-1 = 아직)
  clears int not null default 0 check (clears >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, hero)
);
alter table public.card_heroes enable row level security;
drop policy if exists card_heroes_read_own on public.card_heroes;
create policy card_heroes_read_own on public.card_heroes for select using (auth.uid() = user_id);
revoke all on public.card_heroes from anon, authenticated;
grant select on public.card_heroes to authenticated;

-- 끝없는 모드 최고 기록 (올라간 칸)
create table if not exists public.card_endless (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  best_floors int not null check (best_floors > 0),
  acts int not null default 0,
  hero text not null,
  achieved_at timestamptz not null default now()
);
alter table public.card_endless enable row level security;
drop policy if exists card_endless_read_own on public.card_endless;
create policy card_endless_read_own on public.card_endless for select using (auth.uid() = user_id);
revoke all on public.card_endless from anon, authenticated;
grant select on public.card_endless to authenticated;

-- ---------- 3. 고양이 · 캐릭터 게임 · 오늘의 도전 목록 ----------

-- 071 의 목록에 'card' 를 더한다 (shared/characters.js CHARACTER_GAMES 와 같게)
create or replace function public._character_games() returns text[]
language sql immutable as $$
  select array['tank','race','volleyball','survival','defense','charge','finger','village','twelve','card']::text[]
$$;
revoke all on function public._character_games() from public, anon, authenticated;

-- 082 의 목록에 'card' 를 더한다 (shared/daily.js DAILY_GAMES 와 같게)
create or replace function public._daily_games() returns text[]
language sql immutable set search_path = public as $$
  select array['running','survival','charge','finger','defense','card']::text[];
$$;
revoke all on function public._daily_games() from public, anon, authenticated;

-- 고양이 구매 조건: 보통 판 클리어 1번 (영웅 모두 합해서)
create or replace function public._cat_progress_card(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('have', coalesce((select sum(clears)::int from public.card_heroes where user_id = p_user), 0), 'need', public._card_const('cat_need'))
$$;
revoke all on function public._cat_progress_card(uuid) from public, anon, authenticated;

-- ---------- 4. 판 시작 ----------

create or replace function public._card_run_json(r public.card_runs) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'runId', r.id, 'mode', r.mode, 'hero', r.hero, 'mastery', r.mastery, 'seed', r.seed, 'rules', r.rules,
    'day', case when r.day is null then null else to_char(r.day, 'YYYY-MM-DD') end, 'firstOfDay', r.first_of_day,
    'log', r.log, 'acts', r.acts, 'floors', r.floors, 'coins', r.coins, 'startedAt', r.started_at)
$$;
revoke all on function public._card_run_json(public.card_runs) from public, anon, authenticated;

create or replace function public.card_start(p_mode text, p_hero text, p_mastery int default 0, p_day text default null, p_seed bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  d date;
  lv int := coalesce(p_mastery, 0);
  open_lv int;
  s bigint;
  first boolean := false;
  r public.card_runs;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('normal', 'endless', 'daily') then raise exception 'bad mode'; end if;
  -- 같은 사람의 시작은 한 번에 하나씩 (진행 중인 판 1개)
  perform pg_advisory_xact_lock(hashtext('card-start:' || me::text));
  if p_mode = 'daily' then
    -- 오늘의 도전: 십이지 12명 중 그날 영웅 (고양이 없음) · 씨앗은 날짜로 만든 값 (card-finish 가 맞는지 본다)
    if p_hero is null or p_hero = 'cat' or not (p_hero = any(public._character_ids())) then raise exception 'bad character'; end if;
    begin
      d := p_day::date;
    exception when others then raise exception 'bad day';
    end;
    if d is null or d <> public._daily_day() then raise exception 'bad day'; end if;
    if p_seed is null or p_seed < 0 or p_seed > 4294967295 then raise exception 'bad seed'; end if;
    if lv <> 0 then raise exception 'bad mastery'; end if;
    s := p_seed;
    first := not exists (select 1 from public.card_runs where user_id = me and mode = 'daily' and day = d);
  else
    perform public._check_character(me, p_hero, 'card');
    if p_mode = 'endless' then
      if lv <> 0 then raise exception 'bad mastery'; end if;
    else
      open_lv := least(public._card_const('mastery_open'),
        coalesce((select h.mastery from public.card_heroes h where h.user_id = me and h.hero = p_hero), 0));
      if lv < 0 or lv > open_lv then raise exception 'bad mastery'; end if;
    end if;
    s := floor(random() * 4294967296)::bigint;
  end if;
  update public.card_runs set status = 'abandoned', finished_at = now(), updated_at = now()
    where user_id = me and mode = p_mode and status = 'active';
  insert into public.card_runs (user_id, mode, hero, mastery, seed, rules, day, first_of_day)
    values (me, p_mode, p_hero, lv, s, public._card_const('rules'), d, first)
    returning * into r;
  return public._card_run_json(r);
end $$;
revoke all on function public.card_start(text, text, int, text, bigint) from public, anon;
grant execute on function public.card_start(text, text, int, text, bigint) to authenticated;

-- ---------- 5. 내 상태 ----------

create or replace function public.card_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  return jsonb_build_object(
    'rules', public._card_const('rules'),
    'masteryOpen', public._card_const('mastery_open'),
    'runs', coalesce((select jsonb_object_agg(r.mode, public._card_run_json(r)) from public.card_runs r where r.user_id = me and r.status = 'active'), '{}'::jsonb),
    'heroes', coalesce((select jsonb_object_agg(h.hero, jsonb_build_object('mastery', h.mastery, 'best', h.best, 'clears', h.clears))
      from public.card_heroes h where h.user_id = me), '{}'::jsonb),
    'clears', coalesce((select sum(h.clears)::int from public.card_heroes h where h.user_id = me), 0),
    'endless', (select jsonb_build_object('floors', e.best_floors, 'acts', e.acts, 'hero', e.hero) from public.card_endless e where e.user_id = me),
    'today', to_char(public._daily_day(), 'YYYY-MM-DD'),
    'dailyPlayed', exists (select 1 from public.card_runs r where r.user_id = me and r.mode = 'daily' and r.day = public._daily_day())
  );
end $$;
revoke all on function public.card_state() from public, anon;
grant execute on function public.card_state() to authenticated;

-- ---------- 6. 막 끝 · 판 끝 기록 (card-finish 만) ----------

-- p_result: { rules, logLen, acts, floors, elites, bosses, hp, maxHp, over, dead, ending, act } (_shared/card/verify.ts 의 VerifiedResult)
-- p_log   : 기록할 입력 목록 (길이 = logLen). 앞부분은 이미 기록한 입력과 같아야 한다 (같은 판을 다른 갈래로 다시 하지 못하게)
create or replace function public.card_finish_verified(p_user uuid, p_run uuid, p_result jsonb, p_log jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rn public.card_runs;
  v_rules int; v_len int; v_acts int; v_floors int; v_elites int; v_bosses int; v_hp int; v_over boolean; v_dead boolean; v_ending text;
  cap int;
  new_coins int := 0;
  a int;
  v_daily jsonb;
  v_score bigint;
  v_endless jsonb;
  old_best int;
  hero_lv int;
  cleared boolean := false;
begin
  if p_user is null or p_run is null or p_result is null or jsonb_typeof(p_result) <> 'object'
    or p_log is null or jsonb_typeof(p_log) <> 'array' then raise exception 'bad result'; end if;
  begin
    v_rules := (p_result ->> 'rules')::int;
    v_len := (p_result ->> 'logLen')::int;
    v_acts := (p_result ->> 'acts')::int;
    v_floors := (p_result ->> 'floors')::int;
    v_elites := (p_result ->> 'elites')::int;
    v_bosses := (p_result ->> 'bosses')::int;
    v_hp := (p_result ->> 'hp')::int;
    v_over := (p_result ->> 'over')::boolean;
    v_dead := coalesce((p_result ->> 'dead')::boolean, false);
    v_ending := nullif(p_result ->> 'ending', '');
  exception when others then raise exception 'bad result';
  end;
  if v_rules is distinct from public._card_const('rules') then raise exception 'old rules'; end if;
  if v_len is null or v_acts is null or v_floors is null or v_elites is null or v_bosses is null or v_hp is null or v_over is null
    or v_len <> jsonb_array_length(p_log) or v_len > public._card_const('max_log')
    or v_acts < 0 or v_floors < 0 or v_elites < 0 or v_bosses < 0 or v_hp < 0 or v_acts <> v_bosses or v_elites > v_floors
    or (v_ending is not null and v_ending not in ('normal', 'true')) or (v_ending is not null and (not v_over or v_dead))
  then raise exception 'bad result'; end if;

  select * into rn from public.card_runs where id = p_run for update;
  if not found or rn.user_id <> p_user then raise exception 'no run'; end if;
  if rn.status <> 'active' then raise exception 'already finished'; end if;
  if v_ending is not null and rn.mode = 'endless' then raise exception 'bad result'; end if;
  -- 예전 기록(늦게 도착한 앞 막 업로드)은 받지 않는다. 같은 길이(아직 진행 중)는 바뀐 것이 없다
  if v_len < rn.log_len or (v_len = rn.log_len and not v_over) then raise exception 'stale'; end if;
  if v_acts < rn.acts or v_floors < rn.floors then raise exception 'bad result'; end if;
  -- 앞부분이 이미 기록한 입력과 같아야 한다
  if rn.log_len > 0 and (select jsonb_agg(e order by i) from jsonb_array_elements(p_log) with ordinality t(e, i) where i <= rn.log_len) is distinct from rn.log then
    raise exception 'bad log';
  end if;

  update public.card_runs set log = p_log, log_len = v_len, acts = v_acts, floors = v_floors, elites = v_elites, hp = v_hp,
    ending = v_ending, dead = v_dead, updated_at = now() where id = rn.id;

  -- 시아코인: 깬 막마다 1 (오늘의 도전 없음). 같은 막은 ref 가 같아 한 번만 · 15초·하루 한도는 _grant_sia_coin 안에서
  -- (15초 안에 다른 게임에서 받아 못 준 막은 다음 업로드 때 다시 준다)
  if rn.mode <> 'daily' then
    cap := case when v_ending = 'true' then public._card_const('coin_acts_true') else public._card_const('coin_acts') end;
    for a in 1 .. least(v_acts, cap) loop
      if not exists (select 1 from public.sia_coin_logs where user_id = p_user and game = 'card' and ref = rn.id::text || ':' || a) then
        if public._grant_sia_coin(p_user, 'card', rn.id::text || ':' || a) then new_coins := new_coins + 1; end if;
      end if;
    end loop;
    if new_coins > 0 then update public.card_runs set coins = coins + new_coins where id = rn.id; end if;
  end if;

  -- 보통 판 클리어: 그 영웅 클리어 +1, 다음 숙련 단계 열림 (최대 mastery_open)
  if rn.mode = 'normal' and v_over and v_ending is not null then
    cleared := true;
    insert into public.card_heroes as h (user_id, hero, mastery, best, clears)
      values (p_user, rn.hero, least(rn.mastery + 1, public._card_const('mastery_open')), rn.mastery, 1)
    on conflict (user_id, hero) do update set
      clears = h.clears + 1,
      mastery = greatest(h.mastery, least(rn.mastery + 1, public._card_const('mastery_open'))),
      best = greatest(h.best, rn.mastery),
      updated_at = now();
  end if;
  select h.mastery into hero_lv from public.card_heroes h where h.user_id = p_user and h.hero = rn.hero;

  -- 끝없는 모드: 올라간 칸 최고 기록 (막마다 · 판 끝)
  if rn.mode = 'endless' and v_floors > 0 then
    select e.best_floors into old_best from public.card_endless e where e.user_id = p_user for update;
    if old_best is null or v_floors > old_best then
      insert into public.card_endless (user_id, best_floors, acts, hero, achieved_at) values (p_user, v_floors, v_acts, rn.hero, now())
      on conflict (user_id) do update set best_floors = excluded.best_floors, acts = excluded.acts, hero = excluded.hero, achieved_at = excluded.achieved_at;
    end if;
    v_endless := jsonb_build_object('floors', v_floors, 'best', greatest(v_floors, coalesce(old_best, 0)), 'improved', old_best is null or v_floors > old_best);
  end if;

  -- 오늘의 도전: 판이 끝나면 점수 (그날 첫 판만, 그제보다 오래된 판은 넣지 않는다)
  if rn.mode = 'daily' and v_over then
    v_score := v_floors * public._card_const('score_floor') + v_elites * public._card_const('score_elite')
      + v_bosses * public._card_const('score_boss') + greatest(v_hp, 0);
    update public.card_runs set score = v_score where id = rn.id;
    if rn.first_of_day and rn.day >= public._daily_day() - 1 and rn.day <= public._daily_day() then
      v_daily := public._daily_record(p_user, 'card', v_score,
        jsonb_build_object('floors', v_floors, 'elites', v_elites, 'bosses', v_bosses, 'hp', v_hp, 'hero', rn.hero, 'ending', v_ending),
        rn.id::text, rn.day) || jsonb_build_object('recorded', true, 'score', v_score);
    else
      v_daily := jsonb_build_object('day', to_char(rn.day, 'YYYY-MM-DD'), 'recorded', false, 'score', v_score);
    end if;
  end if;

  if v_over then update public.card_runs set status = 'over', finished_at = now() where id = rn.id; end if;
  return jsonb_build_object('result', jsonb_build_object(
    'mode', rn.mode, 'acts', v_acts, 'floors', v_floors, 'over', v_over, 'cleared', cleared,
    'newCoins', new_coins, 'coins', rn.coins + new_coins,
    'mastery', coalesce(hero_lv, 0), 'daily', v_daily, 'endless', v_endless));
end $$;
revoke all on function public.card_finish_verified(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.card_finish_verified(uuid, uuid, jsonb, jsonb) to service_role;

-- ---------- 7. 랭킹 ----------

-- 끝없는 모드: 최고 칸 → 먼저 달성한 순
create or replace view public.card_endless_ranking as
  select e.user_id, p.nickname, e.best_floors, e.acts, e.hero, e.achieved_at,
    (row_number() over (order by e.best_floors desc, e.achieved_at asc, e.user_id))::int as place,
    (count(*) over ())::int as total
  from public.card_endless e join public.profiles p on p.id = e.user_id;
revoke all on public.card_endless_ranking from anon, authenticated;
grant select on public.card_endless_ranking to anon, authenticated;

-- ---------- 8. 게임 오픈 여부 ----------
-- 처음에는 닫힌 상태로 추가한다 (관리자만 보이고 들어갈 수 있다. 로비의 오픈 설정에서 연다)
insert into public.app_settings (key, value) values ('game_open:card', 'false'::jsonb) on conflict (key) do nothing;
