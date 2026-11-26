-- 114: 시아카드배틀 밸런스 확정 (11-26 사용자 확정) · 관리자 시험 판 시작 엽전
--   (113 은 시아팡팡 113_pang_lives.sql 이 먼저 씀 — 카드 SQL 이 쓰는 함수는 다시 정의하지 않는다)
--   1. _card_const('rules') 5 → 6 (RULES_VERSION 6: 보스 수치 · 강해진 요괴 · 끝없는 모드 배수 더하기 · 남은 보상 자동으로 받기 · 시작 엽전).
--      112 의 정의를 그대로 옮기고 rules 값만 바꾼다. 판본이 바뀌면 진행 중인 판은 이어 할 수 없다 (게임이 아직 닫혀 있다).
--   2. card_runs.start_gold : 판 시작 엽전 (null = 기본 99). 관리자 계정(profiles.is_admin, 102 · 105 와 같은 시험용 규칙)의
--      보통 · 끝없는 판은 card_start 가 10000 으로 정해 저장하고 돌려준다. 오늘의 도전은 모두 같은 조건이라 관리자도 기본.
--      card-finish 는 이 열을 읽어 verifyRun 에 넘긴다 (화면이 보낸 값은 믿지 않는다). 기존 판은 null = 기본.
--   3. card_state : 관리자 계정은 들어올 때마다 시아코인을 10,000 으로 맞춘다 (102 와 같게). 그래서 stable 이 아니다.
--   다시 정의하는 함수 (마지막 정의는 모두 112_card.sql — 권한 · security definer · search_path · 잠금 순서 그대로):
--     _card_const · _card_run_json · card_start · card_state

-- ---------- 1. 상수 ----------

create or replace function public._card_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'rules' then 6            -- RULES_VERSION (run.ts)
    when 'mastery_open' then 5     -- MASTERY_OPEN: 고를 수 있는 가장 높은 숙련 단계 (6~10 잠금)
    when 'coin_acts' then 3        -- COIN_ACTS: 한 판 시아코인 최대
    when 'coin_acts_true' then 4   -- COIN_ACTS_TRUE: 어둑시니까지 깬 판
    when 'max_log' then 30000      -- MAX_LOG: 입력 기록 최대 길이
    when 'score_floor' then 10     -- DAILY_SCORE (오늘의 도전 점수)
    when 'score_elite' then 30
    when 'score_boss' then 100
    when 'cat_need' then 1         -- 고양이: 보통 판 클리어 수
    when 'admin_gold' then 10000   -- ADMIN_START_GOLD (run.ts): 관리자 시험 판 시작 엽전
  end
$$;
revoke all on function public._card_const(text) from public, anon, authenticated;

-- ---------- 2. 판 시작 엽전 ----------

alter table public.card_runs add column if not exists start_gold int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'card_runs_start_gold_check') then
    alter table public.card_runs add constraint card_runs_start_gold_check check (start_gold is null or start_gold between 0 and 100000);
  end if;
end $$;

create or replace function public._card_run_json(r public.card_runs) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'runId', r.id, 'mode', r.mode, 'hero', r.hero, 'mastery', r.mastery, 'seed', r.seed, 'rules', r.rules,
    'day', case when r.day is null then null else to_char(r.day, 'YYYY-MM-DD') end, 'firstOfDay', r.first_of_day,
    'log', r.log, 'acts', r.acts, 'floors', r.floors, 'coins', r.coins, 'startedAt', r.started_at,
    'startGold', r.start_gold)
$$;
revoke all on function public._card_run_json(public.card_runs) from public, anon, authenticated;

-- ---------- 3. 판 시작 (112 그대로, 시작 엽전만) ----------

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
  g int;
  r public.card_runs;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('normal', 'endless', 'daily') then raise exception 'bad mode'; end if;
  -- 잠금 순서는 언제나 지갑 → 판 (card_finish_verified 와 같게 — 시아코인 지급이 지갑을 잠근다)
  perform public._ensure_wallet(me);
  perform 1 from public.wallets where user_id = me for update;
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
    -- 관리자 계정(시험용): 보통 · 끝없는 판은 엽전 1만으로 시작 (오늘의 도전은 모두 같은 조건이라 기본)
    if exists (select 1 from public.profiles where id = me and is_admin) then g := public._card_const('admin_gold'); end if;
  end if;
  update public.card_runs set status = 'abandoned', finished_at = now(), updated_at = now()
    where user_id = me and mode = p_mode and status = 'active';
  insert into public.card_runs (user_id, mode, hero, mastery, seed, rules, day, first_of_day, start_gold)
    values (me, p_mode, p_hero, lv, s, public._card_const('rules'), d, first, g)
    returning * into r;
  -- 앞 판들에서 15초 규칙으로 못 받은 막 코인이 있으면 하나 (끝난 판이어도)
  return public._card_run_json(r) || jsonb_build_object('paidCoins', public._card_pay_owed(me, null));
end $$;
revoke all on function public.card_start(text, text, int, text, bigint) from public, anon;
grant execute on function public.card_start(text, text, int, text, bigint) to authenticated;

-- ---------- 4. 내 상태 (112 그대로, 관리자 갈래만 — 102 와 같게) ----------

create or replace function public.card_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 관리자 계정(시험용): 들어올 때마다 시아코인을 1만으로 맞춘다 (고양이 사기 시험용). 일반 사용자는 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
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
