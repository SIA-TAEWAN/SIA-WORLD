-- 029: 시아레이스 (100m 달리기)
--   race_records : 사용자별 최고 기록 (사람의 완주 기록만)
--   race_rounds  : 방·판마다 서버가 정한 '준비' 시각과 GO 시각 (모든 기기가 같은 서버 시각에 GO를 본다)
--   race_runs    : 한 판에 한 사람이 한 번만 기록을 올리게 하는 표시
-- 방 자체는 실시간 채널(Presence)만 쓰고 DB에 두지 않는다. 방 열쇠(room_key)는 주소의 방 코드.
-- 기록은 race_submit()만 바꾼다. 달리기 계산은 각자 기기에서 하므로 서버는 시각만 맞춰 본다:
--   · 19초 미만(방해물 없이도 20초가 걸린다)이거나 60초를 넘으면 거절
--   · GO 시각부터 지금까지 흐른 시간과 기록이 맞지 않으면 거절 (기록보다 일찍 올리면 거절, 너무 늦게 올려도 거절)

-- ---------- 1. 표 ----------

create table if not exists public.race_records (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  best_ms int not null check (best_ms >= 19000),
  best_at timestamptz not null default now(),
  character text not null,
  plays int not null default 1 check (plays >= 0)
);
alter table public.race_records enable row level security;
drop policy if exists race_records_read on public.race_records;
create policy race_records_read on public.race_records for select using (true);
revoke all on public.race_records from anon, authenticated;
grant select on public.race_records to anon, authenticated;
create index if not exists race_records_rank_idx on public.race_records (best_ms, best_at);

create table if not exists public.race_rounds (
  room_key text not null,
  round int not null,
  ready_at timestamptz not null,
  go_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_key, round)
);
alter table public.race_rounds enable row level security;
revoke all on public.race_rounds from anon, authenticated;
create index if not exists race_rounds_created_idx on public.race_rounds (created_at);

create table if not exists public.race_runs (
  room_key text not null,
  round int not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  time_ms int not null,
  created_at timestamptz not null default now(),
  primary key (room_key, round, user_id),
  foreign key (room_key, round) references public.race_rounds(room_key, round) on delete cascade
);
alter table public.race_runs enable row level security;
revoke all on public.race_runs from anon, authenticated;

-- ---------- 2. 기준 값 ----------

-- 기록 검증에 쓰는 값 (ms). 게임 쪽 값(games/running/src/game/constants.ts)과 맞춘다.
create or replace function public._race_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'min_ms' then 19000        -- 이보다 빠른 기록은 없다
    when 'max_ms' then 60000        -- 출발 60초 뒤에는 경기가 끝난다
    when 'early_ms' then 400        -- 기기 시계 오차: 기록이 (지금 - GO)보다 이만큼까지는 커도 된다
    when 'late_ms' then 6000        -- 도착 뒤 이 시간 안에 올려야 한다 (통신 지연)
    when 'lead_ms' then 1200        -- GO 요청부터 '준비' 표시까지 (모든 기기에 전달될 시간)
    when 'gap_ms' then 4000         -- 같은 방에서 다음 판을 열 수 있는 최소 간격
  end
$$;

-- ---------- 3. 서버 시각 ----------

-- 기기 시계를 서버 시각에 맞추는 용도 (epoch ms)
create or replace function public.race_now() returns double precision
language sql volatile security definer set search_path = public as $$
  select extract(epoch from clock_timestamp()) * 1000
$$;
revoke all on function public.race_now() from public;
grant execute on function public.race_now() to anon, authenticated;

-- ---------- 4. GO 시각 정하기 ----------

-- 방장이 부른다. '준비'는 lead 뒤, GO는 그로부터 1~3초 사이 무작위.
-- → { round, ready_at, go_at, now } (모두 epoch ms)
create or replace function public.race_go(p_room_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; last_at timestamptz; t timestamptz := clock_timestamp(); r_at timestamptz; g_at timestamptz;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'need login'; end if;
  if p_room_key is null or p_room_key !~ '^[a-z0-9]{4,24}$' then raise exception 'bad room'; end if;
  -- 같은 방의 요청은 한 번에 하나씩
  perform pg_advisory_xact_lock(hashtext('race:' || p_room_key));
  -- 오래된 판 정리 (기록 올릴 시간이 지난 것)
  delete from public.race_rounds where created_at < t - interval '1 hour';
  select max(round), max(created_at) into n, last_at from public.race_rounds where room_key = p_room_key;
  if last_at is not null and last_at > t - make_interval(secs => public._race_const('gap_ms') / 1000.0) then raise exception 'too soon'; end if;
  n := coalesce(n, 0) + 1;
  r_at := t + make_interval(secs => public._race_const('lead_ms') / 1000.0);
  g_at := r_at + make_interval(secs => 1 + random() * 2);
  insert into public.race_rounds (room_key, round, ready_at, go_at, created_by, created_at) values (p_room_key, n, r_at, g_at, auth.uid(), t);
  return jsonb_build_object(
    'round', n,
    'ready_at', round(extract(epoch from r_at) * 1000),
    'go_at', round(extract(epoch from g_at) * 1000),
    'now', round(extract(epoch from clock_timestamp()) * 1000));
end $$;
revoke all on function public.race_go(text) from public, anon;
grant execute on function public.race_go(text) to authenticated;

-- ---------- 5. 기록 올리기 ----------

-- 완주한 사람이 자기 기록을 올린다 (AI·미완주·실격은 올리지 않는다).
-- → { accepted, time_ms, best_ms, improved, plays }
create or replace function public.race_submit(p_room_key text, p_round int, p_time_ms int, p_character text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rd public.race_rounds; elapsed numeric; rec public.race_records; old_best int;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'need login'; end if;
  if p_character is null or p_character not in ('rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig') then raise exception 'bad character'; end if;
  if p_time_ms is null or p_time_ms < public._race_const('min_ms') or p_time_ms > public._race_const('max_ms') then raise exception 'bad time'; end if;
  select * into rd from public.race_rounds where room_key = p_room_key and round = p_round;
  if not found then raise exception 'no round'; end if;
  -- GO부터 지금까지 흐른 시간과 맞는가
  elapsed := extract(epoch from (clock_timestamp() - rd.go_at)) * 1000;
  if p_time_ms > elapsed + public._race_const('early_ms') or p_time_ms < elapsed - public._race_const('late_ms') then raise exception 'bad time'; end if;
  -- 한 판에 한 번
  begin
    insert into public.race_runs (room_key, round, user_id, time_ms) values (p_room_key, p_round, auth.uid(), p_time_ms);
  exception when unique_violation then raise exception 'already submitted';
  end;
  select best_ms into old_best from public.race_records where user_id = auth.uid();
  insert into public.race_records as r (user_id, best_ms, best_at, character, plays)
  values (auth.uid(), p_time_ms, now(), p_character, 1)
  on conflict (user_id) do update set
    plays = r.plays + 1,
    best_at = case when excluded.best_ms < r.best_ms then excluded.best_at else r.best_at end,
    character = case when excluded.best_ms < r.best_ms then excluded.character else r.character end,
    best_ms = least(r.best_ms, excluded.best_ms)
  returning * into rec;
  return jsonb_build_object('accepted', true, 'time_ms', p_time_ms, 'best_ms', rec.best_ms,
    'improved', old_best is null or p_time_ms < old_best, 'plays', rec.plays);
end $$;
revoke all on function public.race_submit(text, int, int, text) from public, anon;
grant execute on function public.race_submit(text, int, int, text) to authenticated;

-- ---------- 6. 랭킹 ----------

-- 최고 기록 빠른 순, 같으면 먼저 세운 사람이 위. place는 전체 순위 (상위 100명은 place <= 100, 내 순위는 user_id로 조회)
create or replace view public.race_ranking as
  select r.user_id, p.nickname, r.best_ms, r.best_at, r.character, r.plays,
    (row_number() over (order by r.best_ms asc, r.best_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.race_records r join public.profiles p on p.id = r.user_id;
revoke all on public.race_ranking from anon, authenticated;
grant select on public.race_ranking to anon, authenticated;
