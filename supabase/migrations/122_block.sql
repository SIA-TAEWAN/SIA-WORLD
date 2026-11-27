-- 시아블록 (games/block): 8×8 정령 블록 퍼즐 · 1인용 · 죽을 때까지 점수 쌓기
--
-- 판은 기기에서 돌아가고, 서버는 시작 · 끝 · 기록을 맡는다.
--   block_state()  → { best, bestAt, weekBest, siaCoins, weekTop: { name, score } | null }
--   block_start()  → { run, seed }   (시드는 서버가 고른다)
--   block_finish_verified(user, run, result, claimed, log) : Edge Function block-finish 가
--       supabase/functions/_shared/block 로 시드부터 놓기 기록을 다시 돌려 얻은 결과만 받는다 (service_role 만).
--       → { score, verified, best, weekBest, newBest, rank, weekRank, gotCoin, siaCoins }
--       'no run' · 'already finished' · 'too fast' · 'too late' · 'bad result'
-- 확인: 내 판이고, 안 끝났고, 시작한 지 24시간 안이고, 놓은 횟수 × 0.3초보다 빨리 끝나지 않음
--       (games/block/src/net/api.ts 의 LIMITS 와 같이 고친다 — tests/sql.test.ts).
-- 기기가 보낸 점수가 서버 계산과 다르면 판은 끝내되 기록 · 랭킹 · 시아코인에 넣지 않는다 (verified false).
-- 시아코인: 끝낸 판마다 1개 (_grant_sia_coin 의 15초 · 하루 100개 제한은 그대로). 멈춤에서 나간 판은 끝을 보내지 않아 없다.
-- 랭킹 (관리자는 빼고, 120 과 같다): block_ranking (각자 최고 점수 → 먼저 달성한 순), block_weekly_ranking (이번 주, 한국 시간 월요일 시작),
--       block_weekly_last_top() (지난주 1~3등).

create table if not exists public.block_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  seed bigint not null check (seed >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int,
  lines int,
  max_combo int,
  moves int,
  verified boolean,
  log jsonb
);
create index if not exists block_runs_user_idx on public.block_runs (user_id, started_at desc);
alter table public.block_runs enable row level security;
revoke all on public.block_runs from anon, authenticated;

-- 각자 최고 기록 하나
create table if not exists public.block_bests (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  best int not null default 0 check (best >= 0),
  best_at timestamptz,
  lines int not null default 0,
  max_combo int not null default 0,
  plays int not null default 0
);
alter table public.block_bests enable row level security;
revoke all on public.block_bests from anon, authenticated;

-- (주, 사람)마다 그 주 최고 점수 하나. 주 = 한국 시간 월요일
create table if not exists public.block_weekly (
  week date not null check (extract(isodow from week) = 1),
  user_id uuid not null references public.profiles(id) on delete cascade,
  best int not null check (best >= 0),
  best_at timestamptz not null default now(),
  plays int not null default 1,
  primary key (week, user_id)
);
create index if not exists block_weekly_rank_idx on public.block_weekly (week, best desc, best_at);
alter table public.block_weekly enable row level security;
revoke all on public.block_weekly from anon, authenticated;

-- 한계 (games/block/src/net/api.ts 의 LIMITS 와 같다)
create or replace function public._block_const() returns jsonb language sql immutable as $$
  select '{"secPerMove": 0.3, "maxHours": 24}'::jsonb
$$;
revoke all on function public._block_const() from public, anon, authenticated;

-- 이번 주 월요일 (한국 날짜)
create or replace function public._block_week() returns date language sql stable as $$
  select date_trunc('week', (now() at time zone 'Asia/Seoul'))::date
$$;
revoke all on function public._block_week() from public, anon, authenticated;

create or replace function public.block_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b public.block_bests; wb int; top record;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._ensure_wallet(me);
  select * into b from public.block_bests where user_id = me;
  select best into wb from public.block_weekly where week = public._block_week() and user_id = me;
  select p.nickname, w.best into top from public.block_weekly w join public.profiles p on p.id = w.user_id
    where w.week = public._block_week() and not coalesce(p.is_admin, false) order by w.best desc, w.best_at asc, w.user_id limit 1;
  return jsonb_build_object(
    'best', coalesce(b.best, 0), 'bestAt', b.best_at, 'weekBest', coalesce(wb, 0),
    'siaCoins', coalesce((select sia_coins from public.wallets where user_id = me), 0),
    'weekTop', case when top.best is null then null else jsonb_build_object('name', top.nickname, 'score', top.best) end);
end $$;
revoke all on function public.block_state() from public, anon;
grant execute on function public.block_state() to authenticated;

create or replace function public.block_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rid uuid; sd bigint := floor(random() * 2147483647)::bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 끝을 보내지 않은 오래된 판 정리
  delete from public.block_runs where user_id = me and finished_at is null and started_at < now() - interval '2 days';
  insert into public.block_runs (user_id, seed) values (me, sd) returning block_runs.id into rid;
  return jsonb_build_object('run', rid, 'seed', sd);
end $$;
revoke all on function public.block_start() from public, anon;
grant execute on function public.block_start() to authenticated;

create or replace function public.block_finish_verified(p_user uuid, p_run uuid, p_result jsonb, p_claimed int, p_log jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ru public.block_runs; k jsonb := public._block_const(); b public.block_bests;
  sc int; ln int; mc int; mv int; ok boolean; got boolean := false; nb boolean := false;
  wk date := public._block_week(); rk int; wrk int; prev int;
begin
  select * into ru from public.block_runs where id = p_run and user_id = p_user for update;
  if ru.id is null then raise exception 'no run'; end if;
  if ru.finished_at is not null then raise exception 'already finished'; end if;
  if ru.started_at < now() - make_interval(hours => (k->>'maxHours')::int) then raise exception 'too late'; end if;
  sc := (p_result->>'score')::int; ln := (p_result->>'lines')::int; mc := (p_result->>'maxCombo')::int; mv := (p_result->>'moves')::int;
  if sc is null or sc < 0 or ln is null or ln < 0 or mc is null or mc < 0 or mv is null or mv < 1 then raise exception 'bad result'; end if;
  if extract(epoch from (now() - ru.started_at)) < mv * (k->>'secPerMove')::numeric then raise exception 'too fast'; end if;
  ok := p_claimed is not null and p_claimed = sc;
  update public.block_runs set finished_at = now(), score = sc, lines = ln, max_combo = mc, moves = mv, verified = ok, log = p_log
    where id = ru.id;
  if ok then
    select best into prev from public.block_bests where user_id = p_user for update;
    nb := sc > coalesce(prev, 0);
    insert into public.block_bests as t (user_id, best, best_at, lines, max_combo, plays) values (p_user, sc, now(), ln, mc, 1)
    on conflict (user_id) do update set
      plays = t.plays + 1,
      best_at = case when excluded.best > t.best then excluded.best_at else t.best_at end,
      lines = case when excluded.best > t.best then excluded.lines else t.lines end,
      max_combo = case when excluded.best > t.best then excluded.max_combo else t.max_combo end,
      best = greatest(t.best, excluded.best);
    insert into public.block_weekly as w (week, user_id, best, best_at, plays) values (wk, p_user, sc, now(), 1)
    on conflict (week, user_id) do update set
      plays = w.plays + 1,
      best_at = case when excluded.best > w.best then excluded.best_at else w.best_at end,
      best = greatest(w.best, excluded.best);
    -- 5주 지난 주간 줄 정리
    delete from public.block_weekly where week <= wk - 35;
    got := public._grant_sia_coin(p_user, 'block', 'run:' || ru.id::text);
  end if;
  select * into b from public.block_bests where user_id = p_user;
  -- 순위는 랭킹 뷰 그대로 (관리자는 랭킹에 없어 null)
  select place into rk from public.block_ranking where user_id = p_user;
  select place into wrk from public.block_weekly_ranking where user_id = p_user;
  return jsonb_build_object('score', sc, 'verified', ok, 'best', coalesce(b.best, 0),
    'weekBest', coalesce((select best from public.block_weekly where week = wk and user_id = p_user), 0),
    'newBest', ok and nb, 'rank', rk, 'weekRank', wrk, 'gotCoin', got,
    'siaCoins', coalesce((select sia_coins from public.wallets where user_id = p_user), 0));
end $$;
revoke all on function public.block_finish_verified(uuid, uuid, jsonb, int, jsonb) from public, anon, authenticated;
grant execute on function public.block_finish_verified(uuid, uuid, jsonb, int, jsonb) to service_role;

create or replace view public.block_ranking as
  select b.user_id, p.nickname, b.best, b.lines, b.max_combo, b.best_at as achieved_at,
    (row_number() over (order by b.best desc, b.best_at asc, b.user_id))::int as place,
    (count(*) over ())::int as total
  from public.block_bests b join public.profiles p on p.id = b.user_id
  where b.best > 0 and not coalesce(p.is_admin, false);
revoke all on public.block_ranking from anon, authenticated;
grant select on public.block_ranking to anon, authenticated;

create or replace view public.block_weekly_ranking as
  select w.user_id, p.nickname, w.best, w.best_at as achieved_at, w.plays,
    (row_number() over (order by w.best desc, w.best_at asc, w.user_id))::int as place,
    (count(*) over ())::int as total,
    w.week
  from public.block_weekly w join public.profiles p on p.id = w.user_id
  -- 이번 주 (_block_week() 와 같은 식. 뷰는 보는 사람 권한으로 함수를 불러 여기서는 직접 쓴다)
  where w.week = date_trunc('week', (now() at time zone 'Asia/Seoul'))::date and w.best > 0 and not coalesce(p.is_admin, false);
revoke all on public.block_weekly_ranking from anon, authenticated;
grant select on public.block_weekly_ranking to anon, authenticated;

-- 지난주 1~3등 → { today, top: [{ place, nickname, best }] }
create or replace function public.block_weekly_last_top() returns jsonb
language sql stable security definer set search_path = public as $$
  with ranked as (
    select p.nickname, w.best,
      row_number() over (order by w.best desc, w.best_at asc, w.user_id) as place
    from public.block_weekly w join public.profiles p on p.id = w.user_id
    where w.week = public._block_week() - 7 and w.best > 0 and not coalesce(p.is_admin, false)
  )
  select jsonb_build_object(
    'today', (now() at time zone 'Asia/Seoul')::date,
    'top', coalesce((select jsonb_agg(jsonb_build_object('place', place, 'nickname', nickname, 'best', best) order by place) from ranked where place <= 3), '[]'::jsonb))
$$;
revoke all on function public.block_weekly_last_top() from public;
grant execute on function public.block_weekly_last_top() to anon, authenticated;

insert into public.app_settings (key, value) values ('game_open:block', 'false'::jsonb) on conflict (key) do nothing;
