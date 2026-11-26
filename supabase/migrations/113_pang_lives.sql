-- 113: 시아팡팡 목숨 · 관리자 · 쉬운 별 기준 (111_pang.sql 위에)
--
-- 목숨: 최대 5개. 판을 시작할 때마다 1개 쓴다. 처음 깬 스테이지면 끝낼 때 1개 돌려받는다 (최대 5개까지).
--       5개보다 적으면 20분마다 1개씩 찬다 (games/pang/src/net/api.ts 의 LIVES 와 같다 — tests/sql.test.ts 가 비교한다).
-- 관리자(profiles.is_admin): 목숨이 줄지 않고 100스테이지 모두 시작할 수 있다.
--   pang_state()       → { stars, best, siaCoins, lives, nextLife(초, 다 찼으면 0), admin }
--   pang_start(p_stage) → { run, lives, nextLife }           'bad stage' · 'locked stage' · 'no lives'
--   pang_finish(...)   → { stars, best, gotCoin, siaCoins, lives, nextLife, lifeBack }
-- 별 기준은 이 파일의 스테이지 표가 최신이다 (games/pang 에서 npm run sqlrows).

alter table public.pang_profiles add column if not exists lives int not null default 5 check (lives between 0 and 5);
alter table public.pang_profiles add column if not exists lives_at timestamptz;   -- 다음 목숨이 차기 시작한 때 (다 찼으면 null)

create or replace function public._pang_lives_const() returns jsonb language sql immutable as $$
  select '{"max": 5, "regenSec": 1200}'::jsonb
$$;
revoke all on function public._pang_lives_const() from public, anon, authenticated;

create or replace function public._pang_is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = p_user), false)
$$;
revoke all on function public._pang_is_admin(uuid) from public, anon, authenticated;

-- 시간이 지나 찬 목숨을 반영해 저장하고 (lives, nextLife 초) 를 돌려준다. 행을 잠근 채로 부른다.
create or replace function public._pang_refill(p_user uuid, out o_lives int, out o_next int)
language plpgsql security definer set search_path = public as $$
declare k jsonb := public._pang_lives_const(); mx int := (k->>'max')::int; rg int := (k->>'regenSec')::int;
  r public.pang_profiles; gained int; at timestamptz;
begin
  select * into r from public.pang_profiles where user_id = p_user for update;
  o_lives := r.lives; at := r.lives_at;
  if o_lives >= mx then o_lives := mx; at := null;
  elsif at is null then at := now();
  else
    gained := floor(extract(epoch from (now() - at)) / rg)::int;
    if gained > 0 then
      o_lives := least(mx, o_lives + gained);
      at := case when o_lives >= mx then null else at + make_interval(secs => gained * rg) end;
    end if;
  end if;
  if o_lives is distinct from r.lives or at is distinct from r.lives_at then
    update public.pang_profiles set lives = o_lives, lives_at = at where user_id = p_user;
  end if;
  o_next := case when at is null then 0 else greatest(1, ceil(rg - extract(epoch from (now() - at)))::int) end;
end $$;
revoke all on function public._pang_refill(uuid) from public, anon, authenticated;

create or replace function public.pang_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.pang_profiles; lv record; adm boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  r := public._pang_row(me);
  perform public._ensure_wallet(me);
  select * into lv from public._pang_refill(me);
  adm := public._pang_is_admin(me);
  return jsonb_build_object('stars', r.stars, 'best', r.best,
    'siaCoins', coalesce((select sia_coins from public.wallets where user_id = me), 0),
    'lives', lv.o_lives, 'nextLife', lv.o_next, 'admin', adm);
end $$;
revoke all on function public.pang_state() from public, anon;
grant execute on function public.pang_state() to authenticated;

create or replace function public.pang_start(p_stage int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.pang_profiles; rid uuid; lv record; adm boolean; left_ int; at timestamptz; nxt int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_stage is null or p_stage < 1 or p_stage > 100 or not exists (select 1 from public._pang_stages where stage = p_stage) then raise exception 'bad stage'; end if;
  r := public._pang_row(me);
  adm := public._pang_is_admin(me);
  if not adm and p_stage > public._pang_open(r.stars) then raise exception 'locked stage'; end if;
  select * into lv from public._pang_refill(me);
  left_ := lv.o_lives; nxt := lv.o_next;
  if not adm then
    if left_ < 1 then raise exception 'no lives'; end if;
    select lives_at into at from public.pang_profiles where user_id = me;
    left_ := left_ - 1;
    update public.pang_profiles set lives = left_, lives_at = coalesce(at, now()) where user_id = me;
    if at is null then nxt := (public._pang_lives_const()->>'regenSec')::int; end if;
  end if;
  delete from public.pang_runs where user_id = me and started_at < now() - interval '1 day';
  insert into public.pang_runs (user_id, stage) values (me, p_stage) returning pang_runs.id into rid;
  return jsonb_build_object('run', rid, 'lives', left_, 'nextLife', nxt);
end $$;
revoke all on function public.pang_start(int) from public, anon;
grant execute on function public.pang_start(int) to authenticated;

create or replace function public.pang_finish(p_run uuid, p_won boolean, p_score int, p_swaps int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); ru public.pang_runs; st public._pang_stages; r public.pang_profiles;
  k jsonb := public._pang_const(); got boolean; n int := 0; cnt int := 0; total int := 0; key text;
  newstars jsonb; newbest jsonb; prev int; back boolean := false; lv record; mx int := (public._pang_lives_const()->>'max')::int;
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
  select * into lv from public._pang_refill(me);   -- 행을 잠근다
  select * into r from public.pang_profiles where user_id = me for update;
  key := ru.stage::text;
  newstars := r.stars; newbest := r.best;
  if n > 0 then
    prev := coalesce((r.stars->>key)::int, 0);
    back := prev = 0;
    if n > prev then newstars := jsonb_set(r.stars, array[key], to_jsonb(n)); end if;
    if p_score > coalesce((r.best->>key)::int, 0) then newbest := jsonb_set(r.best, array[key], to_jsonb(p_score)); end if;
  end if;
  select coalesce(sum(value::int), 0), count(*) into total, cnt from jsonb_each_text(newstars);
  update public.pang_profiles set
    stars = newstars, best = newbest,
    stars_at = case when total > r.total_stars then now() else stars_at end,
    total_stars = total, cleared = cnt, plays = plays + 1, updated_at = now(),
    lives = case when back then least(mx, lives + 1) else lives end,
    lives_at = case when back and lives + 1 >= mx then null else lives_at end
  where user_id = me;
  select * into lv from public._pang_refill(me);
  got := public._grant_sia_coin(me, 'pang', 'run:' || ru.id::text);
  return jsonb_build_object('stars', coalesce((newstars->>key)::int, 0), 'best', coalesce((newbest->>key)::int, 0), 'gotCoin', got,
    'siaCoins', coalesce((select sia_coins from public.wallets where user_id = me), 0),
    'lives', lv.o_lives, 'nextLife', lv.o_next, 'lifeBack', back);
end $$;
revoke all on function public.pang_finish(uuid, boolean, int, int) from public, anon;
grant execute on function public.pang_finish(uuid, boolean, int, int) to authenticated;

-- 스테이지 표 (games/pang 에서 npm run sqlrows 로 다시 쓴다. 손으로 고치지 않는다)
-- <gen:stages>
insert into public._pang_stages (stage, moves, star2, star3) values
  (1, 17, 6900, 9000),
  (2, 14, 4300, 6200),
  (3, 19, 9000, 11000),
  (4, 14, 4700, 5500),
  (5, 19, 7200, 9200),
  (6, 21, 9600, 12300),
  (7, 16, 6000, 7400),
  (8, 18, 7300, 8800),
  (9, 14, 4500, 6600),
  (10, 18, 6500, 9400),
  (11, 24, 12200, 14700),
  (12, 12, 5300, 6400),
  (13, 21, 10300, 13100),
  (14, 17, 7300, 11400),
  (15, 14, 5800, 7600),
  (16, 17, 7100, 9800),
  (17, 18, 8700, 12000),
  (18, 19, 9400, 11900),
  (19, 21, 10600, 12200),
  (20, 13, 6600, 8900),
  (21, 20, 7800, 9900),
  (22, 16, 6300, 8000),
  (23, 16, 5800, 7000),
  (24, 17, 5500, 7500),
  (25, 15, 5000, 6100),
  (26, 22, 10900, 12300),
  (27, 15, 5700, 8000),
  (28, 15, 5300, 6900),
  (29, 13, 3900, 6200),
  (30, 19, 8500, 10300),
  (31, 16, 6200, 7500),
  (32, 26, 5500, 8200),
  (33, 14, 4500, 6300),
  (34, 33, 7900, 10700),
  (35, 16, 5800, 8700),
  (36, 24, 5100, 7000),
  (37, 13, 5100, 7200),
  (38, 24, 6700, 8500),
  (39, 12, 3500, 5400),
  (40, 23, 5400, 8800),
  (41, 14, 5200, 7000),
  (42, 25, 6500, 9100),
  (43, 18, 5000, 6800),
  (44, 25, 7000, 8600),
  (45, 20, 4700, 7200),
  (46, 29, 10100, 12400),
  (47, 22, 7800, 9300),
  (48, 28, 7400, 10600),
  (49, 25, 6800, 8700),
  (50, 24, 9300, 10300),
  (51, 27, 8300, 10100),
  (52, 31, 7500, 9300),
  (53, 35, 7600, 10200),
  (54, 22, 4100, 7100),
  (55, 28, 7200, 8600),
  (56, 33, 6600, 8700),
  (57, 23, 6200, 7800),
  (58, 30, 7200, 9200),
  (59, 32, 8200, 10600),
  (60, 24, 7100, 8400),
  (61, 19, 4600, 6900),
  (62, 26, 7400, 9600),
  (63, 24, 6000, 8000),
  (64, 31, 7600, 10200),
  (65, 30, 7500, 9800),
  (66, 30, 7200, 9000),
  (67, 35, 7400, 9900),
  (68, 30, 8500, 9700),
  (69, 34, 9200, 12200),
  (70, 24, 7400, 11100),
  (71, 17, 10000, 12800),
  (72, 33, 11900, 14300),
  (73, 26, 8300, 10700),
  (74, 29, 9700, 11400),
  (75, 33, 10400, 12900),
  (76, 27, 7400, 9500),
  (77, 40, 10000, 14100),
  (78, 33, 11900, 14300),
  (79, 29, 9300, 11300),
  (80, 30, 8700, 12800),
  (81, 15, 6000, 8700),
  (82, 34, 8400, 9600),
  (83, 31, 7300, 10500),
  (84, 31, 8100, 10900),
  (85, 29, 7300, 9800),
  (86, 30, 7900, 12000),
  (87, 34, 9400, 11600),
  (88, 32, 9300, 10800),
  (89, 21, 5800, 9600),
  (90, 30, 9500, 11800),
  (91, 13, 9100, 11800),
  (92, 25, 8100, 12000),
  (93, 29, 10000, 13000),
  (94, 30, 8700, 12800),
  (95, 33, 9700, 12800),
  (96, 29, 10500, 12900),
  (97, 28, 11200, 13600),
  (98, 25, 8000, 11200),
  (99, 20, 8100, 9300),
  (100, 30, 13900, 15900)
on conflict (stage) do update set moves = excluded.moves, star2 = excluded.star2, star3 = excluded.star3;
-- </gen:stages>
