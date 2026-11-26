-- 시아팡팡 (games/pang): 아홉 정령 3매치 퍼즐 · 100스테이지 · 1인용
--
-- 판은 기기에서 돌아가고, 서버는 판 시작·끝과 기록(스테이지별 별·최고 점수)만 맡는다 (시아의탑 104 와 비슷한 방식).
--   pang_state()                                   → { stars: {스테이지: 별}, best: {스테이지: 최고 점수}, siaCoins }
--   pang_start(p_stage)                            → { run }      'bad stage' · 'locked stage'
--   pang_finish(p_run, p_won, p_score, p_swaps)    → { stars, best, gotCoin, siaCoins }   'bad run' · 'too fast' · 'bad score'
-- 별은 서버가 점수로 다시 계산한다 (이기면 1개, star2·star3 점수를 넘으면 2·3개. 표는 games/pang/src/data/levels.json 과 같다).
-- 확인: 판 번호가 내 것이고 아직 안 끝났는지, 3시간 안인지, 바꾼 횟수가 이동 수 + 40 이하인지,
--       바꾼 횟수 × 0.35초보다 빨리 끝내지 않았는지, 점수가 0 ~ 300만인지 (games/pang/src/net/api.ts 의 LIMITS 와 같이 고친다).
-- 시아코인: 끝낸 판마다 1개 (이기든 지든. 멈춤에서 나간 판은 끝을 보내지 않아 없다. _grant_sia_coin 의 15초·하루 100개 제한은 그대로)
-- 랭킹: pang_ranking — 모은 별 → 깬 스테이지 수 → 먼저 달성한 순

create table if not exists public._pang_stages (
  stage int primary key check (stage between 1 and 100),
  moves int not null check (moves between 1 and 99),
  star2 int not null check (star2 >= 0),
  star3 int not null check (star3 >= star2)
);
alter table public._pang_stages enable row level security;
revoke all on public._pang_stages from anon, authenticated;

create table if not exists public.pang_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stars jsonb not null default '{}'::jsonb,     -- { "1": 3, "2": 2, ... }
  best jsonb not null default '{}'::jsonb,      -- { "1": 15200, ... }
  total_stars int not null default 0 check (total_stars between 0 and 300),
  cleared int not null default 0 check (cleared between 0 and 100),
  stars_at timestamptz,
  plays int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.pang_profiles enable row level security;
drop policy if exists pang_profiles_read_own on public.pang_profiles;
create policy pang_profiles_read_own on public.pang_profiles for select using (auth.uid() = user_id);
revoke all on public.pang_profiles from anon, authenticated;
grant select on public.pang_profiles to authenticated;

create table if not exists public.pang_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage int not null check (stage between 1 and 100),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  won boolean,
  score int,
  swaps int
);
create index if not exists pang_runs_user_idx on public.pang_runs (user_id, started_at desc);
alter table public.pang_runs enable row level security;
revoke all on public.pang_runs from anon, authenticated;

-- 한계 (games/pang/src/net/api.ts 의 LIMITS 와 같다 — games/pang/tests/sql.test.ts 가 비교한다)
create or replace function public._pang_const() returns jsonb language sql immutable as $$
  select '{"maxScore": 3000000, "secPerSwap": 0.35, "extraSwaps": 40}'::jsonb
$$;
revoke all on function public._pang_const() from public, anon, authenticated;

create or replace function public._pang_row(p_user uuid) returns public.pang_profiles
language plpgsql security definer set search_path = public as $$
declare r public.pang_profiles;
begin
  insert into public.pang_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.pang_profiles where user_id = p_user;
  return r;
end $$;
revoke all on function public._pang_row(uuid) from public, anon, authenticated;

-- 열린 스테이지: 1부터 차례로 별을 받은 다음 스테이지까지
create or replace function public._pang_open(p_stars jsonb) returns int
language plpgsql immutable as $$
declare n int := 1;
begin
  while n <= 100 and coalesce((p_stars->>n::text)::int, 0) > 0 loop n := n + 1; end loop;
  return least(n, 100);
end $$;
revoke all on function public._pang_open(jsonb) from public, anon, authenticated;

create or replace function public.pang_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.pang_profiles;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  r := public._pang_row(me);
  perform public._ensure_wallet(me);
  return jsonb_build_object('stars', r.stars, 'best', r.best,
    'siaCoins', coalesce((select sia_coins from public.wallets where user_id = me), 0));
end $$;
revoke all on function public.pang_state() from public, anon;
grant execute on function public.pang_state() to authenticated;

create or replace function public.pang_start(p_stage int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.pang_profiles; rid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_stage is null or p_stage < 1 or p_stage > 100 or not exists (select 1 from public._pang_stages where stage = p_stage) then raise exception 'bad stage'; end if;
  r := public._pang_row(me);
  if p_stage > public._pang_open(r.stars) then raise exception 'locked stage'; end if;
  -- 오래된 판 정리 (끝을 보내지 않은 판은 하루가 지나면 지운다)
  delete from public.pang_runs where user_id = me and started_at < now() - interval '1 day';
  insert into public.pang_runs (user_id, stage) values (me, p_stage) returning pang_runs.id into rid;
  return jsonb_build_object('run', rid);
end $$;
revoke all on function public.pang_start(int) from public, anon;
grant execute on function public.pang_start(int) to authenticated;

create or replace function public.pang_finish(p_run uuid, p_won boolean, p_score int, p_swaps int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); ru public.pang_runs; st public._pang_stages; r public.pang_profiles;
  k jsonb := public._pang_const(); got boolean; n int := 0; cnt int := 0; total int := 0; key text;
  newstars jsonb; newbest jsonb; prev int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into ru from public.pang_runs where id = p_run and user_id = me for update;
  if ru.id is null or ru.finished_at is not null or ru.started_at < now() - interval '3 hours' then raise exception 'bad run'; end if;
  select * into st from public._pang_stages where stage = ru.stage;
  if p_won is null or p_score is null or p_swaps is null or p_score < 0 or p_score > (k->>'maxScore')::int
    or p_swaps < 1 or p_swaps > st.moves + (k->>'extraSwaps')::int then
    raise exception 'bad score';
  end if;
  if extract(epoch from (now() - ru.started_at)) < p_swaps * (k->>'secPerSwap')::numeric then raise exception 'too fast'; end if;
  n := case when not p_won then 0 when p_score >= st.star3 then 3 when p_score >= st.star2 then 2 else 1 end;
  update public.pang_runs set finished_at = now(), won = p_won, score = p_score, swaps = p_swaps where id = ru.id;

  r := public._pang_row(me);
  select * into r from public.pang_profiles where user_id = me for update;
  key := ru.stage::text;
  newstars := r.stars; newbest := r.best;
  if n > 0 then
    prev := coalesce((r.stars->>key)::int, 0);
    if n > prev then newstars := jsonb_set(r.stars, array[key], to_jsonb(n)); end if;
    if p_score > coalesce((r.best->>key)::int, 0) then newbest := jsonb_set(r.best, array[key], to_jsonb(p_score)); end if;
  end if;
  select coalesce(sum(value::int), 0), count(*) into total, cnt from jsonb_each_text(newstars);
  update public.pang_profiles set
    stars = newstars, best = newbest,
    stars_at = case when total > r.total_stars then now() else stars_at end,
    total_stars = total, cleared = cnt, plays = plays + 1, updated_at = now()
  where user_id = me;
  got := public._grant_sia_coin(me, 'pang', 'run:' || ru.id::text);
  return jsonb_build_object('stars', coalesce((newstars->>key)::int, 0), 'best', coalesce((newbest->>key)::int, 0), 'gotCoin', got,
    'siaCoins', coalesce((select sia_coins from public.wallets where user_id = me), 0));
end $$;
revoke all on function public.pang_finish(uuid, boolean, int, int) from public, anon;
grant execute on function public.pang_finish(uuid, boolean, int, int) to authenticated;

create or replace view public.pang_ranking as
  select r.user_id, p.nickname, r.total_stars, r.cleared, r.stars_at as achieved_at,
    (row_number() over (order by r.total_stars desc, r.cleared desc, r.stars_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.pang_profiles r join public.profiles p on p.id = r.user_id
  where r.total_stars > 0;
revoke all on public.pang_ranking from anon, authenticated;
grant select on public.pang_ranking to anon, authenticated;

-- 스테이지 표 (games/pang 에서 npm run sqlrows 로 다시 쓴다. 손으로 고치지 않는다)
-- <gen:stages>
insert into public._pang_stages (stage, moves, star2, star3) values
  (1, 17, 9000, 12700),
  (2, 14, 5600, 9200),
  (3, 19, 10200, 14100),
  (4, 14, 5500, 9100),
  (5, 19, 9500, 13300),
  (6, 21, 12000, 15300),
  (7, 16, 8000, 11800),
  (8, 18, 9100, 13400),
  (9, 14, 5300, 10800),
  (10, 18, 9600, 12900),
  (11, 24, 16100, 19800),
  (12, 12, 6300, 10900),
  (13, 21, 12200, 17600),
  (14, 17, 10400, 14600),
  (15, 14, 7600, 11800),
  (16, 17, 10100, 13300),
  (17, 18, 10800, 15800),
  (18, 19, 11600, 15200),
  (19, 21, 13600, 16700),
  (20, 13, 8500, 11600),
  (21, 20, 9300, 10900),
  (22, 16, 7600, 10100),
  (23, 16, 6400, 9100),
  (24, 17, 7000, 8800),
  (25, 15, 5700, 8400),
  (26, 22, 11500, 13800),
  (27, 15, 6900, 8800),
  (28, 15, 6500, 7900),
  (29, 13, 5500, 7900),
  (30, 19, 9600, 11300),
  (31, 16, 7500, 10200),
  (32, 26, 6500, 10700),
  (33, 14, 6400, 8700),
  (34, 33, 10900, 15200),
  (35, 16, 7800, 12800),
  (36, 24, 6700, 10700),
  (37, 13, 6500, 9300),
  (38, 24, 8600, 10800),
  (39, 12, 5400, 8100),
  (40, 23, 7800, 11500),
  (41, 14, 6400, 9300),
  (42, 25, 8600, 13100),
  (43, 18, 5900, 9200),
  (44, 25, 8200, 11600),
  (45, 20, 6100, 9100),
  (46, 29, 11400, 14600),
  (47, 22, 8500, 10700),
  (48, 28, 9700, 13800),
  (49, 25, 7900, 12200),
  (50, 24, 10300, 13400),
  (51, 27, 11200, 13700),
  (52, 31, 9800, 12400),
  (53, 35, 10000, 13100),
  (54, 22, 7800, 10200),
  (55, 28, 8400, 13500),
  (56, 33, 8700, 11500),
  (57, 23, 7800, 11200),
  (58, 30, 9100, 12500),
  (59, 32, 9100, 13200),
  (60, 24, 8700, 10900),
  (61, 19, 6200, 8400),
  (62, 26, 8300, 11600),
  (63, 24, 7400, 9000),
  (64, 31, 9700, 11200),
  (65, 30, 9500, 12900),
  (66, 30, 8200, 9700),
  (67, 35, 8600, 12900),
  (68, 30, 9100, 10900),
  (69, 34, 11300, 13900),
  (70, 24, 10000, 13300),
  (71, 17, 11300, 15400),
  (72, 33, 14500, 17700),
  (73, 26, 10800, 13100),
  (74, 29, 12000, 15000),
  (75, 33, 13000, 16200),
  (76, 27, 8900, 13400),
  (77, 40, 15700, 19900),
  (78, 33, 14500, 17700),
  (79, 29, 10600, 13800),
  (80, 30, 12800, 16800),
  (81, 15, 8400, 11100),
  (82, 34, 9800, 13000),
  (83, 31, 9400, 13500),
  (84, 31, 11000, 14200),
  (85, 29, 9700, 13100),
  (86, 30, 9200, 13800),
  (87, 34, 11200, 15300),
  (88, 32, 10800, 12000),
  (89, 21, 8100, 11900),
  (90, 30, 10400, 14100),
  (91, 13, 11000, 12900),
  (92, 25, 9800, 14100),
  (93, 29, 13700, 16700),
  (94, 30, 12500, 15300),
  (95, 33, 10800, 17700),
  (96, 29, 12700, 15300),
  (97, 28, 13100, 16500),
  (98, 25, 11200, 14800),
  (99, 20, 8600, 10700),
  (100, 30, 15500, 20000)
on conflict (stage) do update set moves = excluded.moves, star2 = excluded.star2, star3 = excluded.star3;
-- </gen:stages>

insert into public.app_settings (key, value) values ('game_open:pang', 'false'::jsonb) on conflict (key) do nothing;
