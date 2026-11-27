-- 시아에이스 (games/ace): 십이지 비행단 세로 슈팅 · 1인용 · 아케이드 12스테이지 · 보스 러시 · 끝없는 모드
--
-- 판은 기기에서 돌아가고, 서버는 판 시작 · 스테이지 클리어 · 판 끝과 기록만 맡는다 (시아팡팡 111 과 비슷한 방식).
--   ace_state()                                                  → { cleared, allClear, best: {easy, normal, hard}, rushBest, endlessBest, siaCoins, admin }
--   ace_start(p_mode, p_difficulty, p_ship, p_stage)             → { run }        'bad mode' · 'locked mode' · 'bad ship' · 'locked ship' · 'locked character' · 'bad stage'
--   ace_clear(p_run, p_stage)                                    → { cleared, unlocked }   아케이드에서 스테이지를 깰 때마다 (기체 해금은 판이 끝나기 전에도 남는다)
--   ace_finish(p_run, p_score, p_rank_score, p_kills, p_seconds, p_stage, p_done)
--                                                                → { gotCoin, siaCoins, best }   'bad run' · 'too fast' · 'bad score'
-- 기체 해금: 쥐·소·용 처음부터, 아케이드 스테이지 n 을 처음 깨면 (호랑이 1 · 토끼 2 · … · 돼지 9), 고양이는 시아코인 100개 (스테이지 5 클리어 뒤, 071 의 buy_character).
-- 모드: 스테이지 연습(서버 없음 · 시아코인 없음) · 보스 러시(아케이드 전체 클리어) · 끝없는 모드(스테이지 6 클리어). 관리자는 모두 열림.
-- 확인 (가볍게 · 친목용): 판 번호가 내 것이고 안 끝났는지, 게임 시간이 실제 지난 시간보다 길지 않은지, 스테이지당 최소 시간,
--   점수 상한(스테이지까지의 합), 초당 격추 수. 값은 games/ace/src/net/api.ts 의 LIMITS 와 같다 (games/ace/tests/sql.test.ts 가 비교).
-- 랭킹: ace_ranking — 아케이드 난이도별 점수(이어하기 전 점수만) · 보스 러시 전체 클리어 시간(짧을수록) · 끝없는 모드 버틴 시간. 관리자 제외.
-- 시아코인: 아케이드 · 보스 러시 · 끝없는 모드 판마다 1개 (_grant_sia_coin 의 15초 · 하루 제한은 그대로).

create table if not exists public.ace_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cleared int not null default 0 check (cleared between 0 and 12),
  all_clear boolean not null default false,
  plays int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.ace_profiles enable row level security;
drop policy if exists ace_profiles_read_own on public.ace_profiles;
create policy ace_profiles_read_own on public.ace_profiles for select using (auth.uid() = user_id);
revoke all on public.ace_profiles from anon, authenticated;
grant select on public.ace_profiles to authenticated;

-- 모드별 최고 기록 (arcade_easy · arcade_normal · arcade_hard: 점수 / rush: 초, 짧을수록 / endless: 초)
create table if not exists public.ace_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('arcade_easy', 'arcade_normal', 'arcade_hard', 'rush', 'endless')),
  value int not null check (value >= 0),
  ship text not null,
  stage int not null default 0,
  achieved_at timestamptz not null default now(),
  primary key (user_id, mode)
);
alter table public.ace_records enable row level security;
drop policy if exists ace_records_read_own on public.ace_records;
create policy ace_records_read_own on public.ace_records for select using (auth.uid() = user_id);
revoke all on public.ace_records from anon, authenticated;
grant select on public.ace_records to authenticated;

create table if not exists public.ace_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('arcade', 'rush', 'endless')),
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  ship text not null,
  first_stage int not null default 1,
  -- 아케이드: 지금 하는 스테이지 (깰 때마다 +1, 12를 깨면 13)
  stage_at int not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int,
  rank_score int,
  kills int,
  seconds int
);
create index if not exists ace_runs_user_idx on public.ace_runs (user_id, started_at desc);
alter table public.ace_runs enable row level security;
revoke all on public.ace_runs from anon, authenticated;

-- 한계 (games/ace/src/net/api.ts 의 LIMITS 와 같다 — games/ace/tests/sql.test.ts 가 비교한다)
create or replace function public._ace_const() returns jsonb language sql immutable as $$
  select '{"minSecPerStage": 100, "scorePerStage": 600000, "bossPerStage": 50000, "killsPerSec": 6, "killsExtra": 60, "rushMinSec": 90, "rushMaxScore": 8000000, "endlessScorePerSec": 4000, "endlessScoreExtra": 100000, "timeSlack": 15, "catNeed": 5}'::jsonb
$$;
revoke all on function public._ace_const() from public, anon, authenticated;

-- 기체를 여는 스테이지 (games/ace/src/data/ships.ts 의 unlock 과 같다). 고양이 = -1 (시아코인 구매), 없는 기체 = null
create or replace function public._ace_ship_unlock(p_ship text) returns int language sql immutable as $$
  select case p_ship
    when 'rat' then 0 when 'ox' then 0 when 'dragon' then 0 when 'tiger' then 1 when 'rabbit' then 2 when 'snake' then 3
    when 'horse' then 4 when 'sheep' then 5 when 'monkey' then 6 when 'rooster' then 7 when 'dog' then 8 when 'pig' then 9
    when 'cat' then -1 else null end
$$;
revoke all on function public._ace_ship_unlock(text) from public, anon, authenticated;

-- 아케이드 스테이지 1 ~ n 까지의 점수 상한 (스테이지마다 scorePerStage + bossPerStage × 번호)
create or replace function public._ace_score_cap(p_stage int) returns bigint language sql immutable as $$
  select (greatest(1, least(12, p_stage)) * ((public._ace_const()->>'scorePerStage')::bigint)
    + (public._ace_const()->>'bossPerStage')::bigint * (greatest(1, least(12, p_stage)) * (greatest(1, least(12, p_stage)) + 1) / 2))
$$;
revoke all on function public._ace_score_cap(int) from public, anon, authenticated;

create or replace function public._ace_row(p_user uuid) returns public.ace_profiles
language plpgsql security definer set search_path = public as $$
declare r public.ace_profiles;
begin
  insert into public.ace_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.ace_profiles where user_id = p_user;
  return r;
end $$;
revoke all on function public._ace_row(uuid) from public, anon, authenticated;

create or replace function public._ace_is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = p_user), false)
$$;
revoke all on function public._ace_is_admin(uuid) from public, anon, authenticated;

create or replace function public.ace_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.ace_profiles;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  r := public._ace_row(me);
  perform public._ensure_wallet(me);
  return jsonb_build_object(
    'cleared', r.cleared, 'allClear', r.all_clear,
    'best', jsonb_build_object(
      'easy', coalesce((select value from public.ace_records where user_id = me and mode = 'arcade_easy'), 0),
      'normal', coalesce((select value from public.ace_records where user_id = me and mode = 'arcade_normal'), 0),
      'hard', coalesce((select value from public.ace_records where user_id = me and mode = 'arcade_hard'), 0)),
    'rushBest', coalesce((select value from public.ace_records where user_id = me and mode = 'rush'), 0),
    'endlessBest', coalesce((select value from public.ace_records where user_id = me and mode = 'endless'), 0),
    'siaCoins', coalesce((select sia_coins from public.wallets where user_id = me), 0),
    'admin', public._ace_is_admin(me));
end $$;
revoke all on function public.ace_state() from public, anon;
grant execute on function public.ace_state() to authenticated;

create or replace function public.ace_start(p_mode text, p_difficulty text, p_ship text, p_stage int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.ace_profiles; adm boolean; u int; rid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('arcade', 'rush', 'endless') or p_difficulty is null or p_difficulty not in ('easy', 'normal', 'hard') then raise exception 'bad mode'; end if;
  r := public._ace_row(me);
  adm := public._ace_is_admin(me);
  -- 모드 열림: 보스 러시 = 아케이드 전체 클리어, 끝없는 모드 = 스테이지 6 클리어
  if not adm and ((p_mode = 'rush' and not r.all_clear) or (p_mode = 'endless' and r.cleared < 6)) then raise exception 'locked mode'; end if;
  -- 기체
  u := public._ace_ship_unlock(p_ship);
  if u is null then raise exception 'bad ship'; end if;
  if u < 0 then perform public._check_character(me, p_ship, 'ace');
  elsif not adm and r.cleared < u then raise exception 'locked ship'; end if;
  -- 아케이드는 1스테이지부터 (관리자는 시험용으로 어디서든)
  if p_mode = 'arcade' and (p_stage is null or p_stage < 1 or p_stage > 12 or (p_stage <> 1 and not adm)) then raise exception 'bad stage'; end if;
  -- 오래된 판 정리 (끝을 보내지 않은 판은 하루가 지나면 지운다)
  delete from public.ace_runs where user_id = me and started_at < now() - interval '1 day';
  insert into public.ace_runs (user_id, mode, difficulty, ship, first_stage, stage_at)
    values (me, p_mode, p_difficulty, p_ship, coalesce(p_stage, 1), coalesce(p_stage, 1))
    returning ace_runs.id into rid;
  return jsonb_build_object('run', rid);
end $$;
revoke all on function public.ace_start(text, text, text, int) from public, anon;
grant execute on function public.ace_start(text, text, text, int) to authenticated;

-- 아케이드 스테이지 클리어: 처음 깬 스테이지면 기체가 열린다 (판이 끝나기 전에 남겨 둔다)
create or replace function public.ace_clear(p_run uuid, p_stage int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); ru public.ace_runs; r public.ace_profiles; k jsonb := public._ace_const();
  newly text := null; done int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into ru from public.ace_runs where id = p_run and user_id = me for update;
  if ru.id is null or ru.finished_at is not null or ru.mode <> 'arcade' or ru.started_at < now() - interval '6 hours' then raise exception 'bad run'; end if;
  -- 앞 스테이지 알림을 통신 오류로 놓쳤어도 받는다 (뒤로 가는 것만 거절). 시간 확인은 깬 스테이지 수로
  if p_stage is null or p_stage < ru.stage_at or p_stage > 12 then raise exception 'bad stage'; end if;
  -- 이 판에서 깬 스테이지 수 × 최소 시간 (멈춘 시간은 실제 시간에 들어가므로 더 짧을 수는 없다)
  done := p_stage - ru.first_stage + 1;
  -- 관리자는 시험용으로 건너뛰기(?at=)를 쓸 수 있어 시간을 보지 않는다
  if not public._ace_is_admin(me) and extract(epoch from (now() - ru.started_at)) + (k->>'timeSlack')::int < done * (k->>'minSecPerStage')::int then raise exception 'too fast'; end if;
  update public.ace_runs set stage_at = p_stage + 1 where id = ru.id;
  r := public._ace_row(me);
  select * into r from public.ace_profiles where user_id = me for update;
  if p_stage > r.cleared then
    newly := (select s from unnest(array['tiger','rabbit','snake','horse','sheep','monkey','rooster','dog','pig']) with ordinality as t(s, i) where i = p_stage);
    update public.ace_profiles set cleared = p_stage, all_clear = all_clear or p_stage >= 12, updated_at = now() where user_id = me;
  elsif p_stage >= 12 and not r.all_clear then
    update public.ace_profiles set all_clear = true, updated_at = now() where user_id = me;
  end if;
  return jsonb_build_object('cleared', greatest(r.cleared, p_stage), 'unlocked', newly);
end $$;
revoke all on function public.ace_clear(uuid, int) from public, anon;
grant execute on function public.ace_clear(uuid, int) to authenticated;

-- 판 끝. p_rank_score = 랭킹에 올릴 점수 (이어하기를 썼으면 이어하기 전 점수), p_stage = 마지막으로 한 스테이지, p_done = 끝까지 깸 (보스 러시 12마리)
create or replace function public.ace_finish(p_run uuid, p_score int, p_rank_score int, p_kills int, p_seconds int, p_stage int, p_done boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); ru public.ace_runs; k jsonb := public._ace_const();
  elapsed numeric; rmode text := null; val int := null; got boolean; best int := 0; old int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into ru from public.ace_runs where id = p_run and user_id = me for update;
  if ru.id is null or ru.finished_at is not null or ru.started_at < now() - interval '6 hours' then raise exception 'bad run'; end if;
  if p_score is null or p_rank_score is null or p_kills is null or p_seconds is null or p_done is null
    or p_score < 0 or p_rank_score < 0 or p_kills < 0 or p_seconds < 0 then raise exception 'bad score'; end if;
  elapsed := extract(epoch from (now() - ru.started_at));
  -- 게임 시간이 실제로 지난 시간보다 길 수 없다
  if p_seconds > elapsed + (k->>'timeSlack')::int then raise exception 'too fast'; end if;
  if p_kills > p_seconds * (k->>'killsPerSec')::int + (k->>'killsExtra')::int then raise exception 'bad score'; end if;

  if ru.mode = 'arcade' then
    -- 서버가 본 스테이지까지만 (클리어 알림을 놓쳤으면 그 앞 스테이지로 줄여서 기록한다)
    if p_stage is null or p_stage < ru.first_stage or p_stage > 12 then raise exception 'bad stage'; end if;
    p_stage := least(p_stage, ru.stage_at, 12);
    if p_score > public._ace_score_cap(p_stage) or p_rank_score > public._ace_score_cap(p_stage) then raise exception 'bad score'; end if;
    rmode := 'arcade_' || ru.difficulty;
    val := p_rank_score;
  elsif ru.mode = 'rush' then
    if p_score > (k->>'rushMaxScore')::int then raise exception 'bad score'; end if;
    if p_done then
      if p_seconds < (k->>'rushMinSec')::int then raise exception 'too fast'; end if;
      rmode := 'rush'; val := p_seconds;
    end if;
  else
    if p_score > p_seconds * (k->>'endlessScorePerSec')::int + (k->>'endlessScoreExtra')::int then raise exception 'bad score'; end if;
    rmode := 'endless'; val := p_seconds;
  end if;

  update public.ace_runs set finished_at = now(), score = p_score, rank_score = p_rank_score, kills = p_kills, seconds = p_seconds where id = ru.id;
  perform public._ace_row(me);
  update public.ace_profiles set plays = plays + 1, updated_at = now() where user_id = me;

  if rmode is not null and val > 0 then
    select value into old from public.ace_records where user_id = me and mode = rmode for update;
    if old is null then
      insert into public.ace_records (user_id, mode, value, ship, stage) values (me, rmode, val, ru.ship, coalesce(p_stage, 0));
    elsif (rmode = 'rush' and val < old) or (rmode <> 'rush' and val > old) then
      update public.ace_records set value = val, ship = ru.ship, stage = coalesce(p_stage, 0), achieved_at = now() where user_id = me and mode = rmode;
    end if;
    best := coalesce((select value from public.ace_records where user_id = me and mode = rmode), 0);
  end if;
  got := public._grant_sia_coin(me, 'ace', 'run:' || ru.id::text);
  return jsonb_build_object('gotCoin', got, 'best', best,
    'siaCoins', coalesce((select sia_coins from public.wallets where user_id = me), 0));
end $$;
revoke all on function public.ace_finish(uuid, int, int, int, int, int, boolean) from public, anon;
grant execute on function public.ace_finish(uuid, int, int, int, int, int, boolean) to authenticated;

-- 랭킹: 모드마다 따로 (보스 러시는 짧은 시간이 위, 나머지는 큰 값이 위, 같으면 먼저 달성한 사람). 관리자 제외
create or replace view public.ace_ranking as
  select r.mode, r.user_id, p.nickname, r.value, r.ship, r.stage, r.achieved_at,
    (row_number() over (
      partition by r.mode
      order by case when r.mode = 'rush' then r.value end asc, case when r.mode <> 'rush' then r.value end desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over (partition by r.mode))::int as total
  from public.ace_records r join public.profiles p on p.id = r.user_id
  where r.value > 0 and not coalesce(p.is_admin, false);
revoke all on public.ace_ranking from anon, authenticated;
grant select on public.ace_ranking to anon, authenticated;

-- 고양이호 구매 조건: 아케이드 스테이지 5 클리어 (071 의 _character_progress 가 찾아 부른다)
create or replace function public._cat_progress_ace(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('have', least(coalesce((select cleared from public.ace_profiles where user_id = p_user), 0), (public._ace_const()->>'catNeed')::int),
    'need', (public._ace_const()->>'catNeed')::int)
$$;
revoke all on function public._cat_progress_ace(uuid) from public, anon, authenticated;

-- 112 의 목록에 'ace' 를 더한다 (shared/characters.js CHARACTER_GAMES 와 같게)
create or replace function public._character_games() returns text[]
language sql immutable as $$
  select array['tank','race','volleyball','survival','defense','charge','finger','village','twelve','card','ace']::text[]
$$;
revoke all on function public._character_games() from public, anon, authenticated;

insert into public.app_settings (key, value) values ('game_open:ace', 'false'::jsonb) on conflict (key) do nothing;
