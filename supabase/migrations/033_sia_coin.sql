-- 033: 시아코인
--   게임 한 판을 정상적으로 끝낼 때마다 1코인. 지갑(wallets.sia_coins)에 쌓이고 SIA WORLD 로비에서 본다.
--   나중에 다른 게임에서 쓴다 (쓰는 함수는 그때 만든다).
-- 코인은 서버 함수 안에서만 준다 (_grant_sia_coin). 화면에서 직접 부를 수 없다.
--   · 같은 판(game + ref)으로는 한 사람에게 한 번만
--   · 한 사람은 15초에 한 번만 받는다 (판을 열자마자 끝내는 식으로 모으지 못하게. 정상적인 판은 모두 이보다 길다)
-- 주는 곳:
--   시아탱크      end_game (승패가 난 대전: 끝까지 남아 있던 사람) · submit_target_score (백발백중 한 판)
--   맞고·카지노   apply_round_result (돈이 오간 판: 끝까지 자리에 있던 사람) · roulette_pay (그 스핀에 베팅한 사람)
--   시아레이스    race_submit (완주 기록을 올린 사람)
--   시아배구      034_volleyball.sql 의 경기 확정 (정상 종료한 두 사람)

-- ---------- 1. 표 ----------

alter table public.wallets add column if not exists sia_coins bigint not null default 0 check (sia_coins >= 0);

create table if not exists public.sia_coin_logs (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  ref text not null,
  amount int not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, game, ref)
);
alter table public.sia_coin_logs enable row level security;
drop policy if exists sia_coin_logs_read_own on public.sia_coin_logs;
create policy sia_coin_logs_read_own on public.sia_coin_logs for select using (auth.uid() = user_id);
revoke all on public.sia_coin_logs from anon, authenticated;
grant select on public.sia_coin_logs to authenticated;
create index if not exists sia_coin_logs_user_time_idx on public.sia_coin_logs (user_id, created_at desc);

-- ---------- 2. 코인 주기 (안에서만 부른다) ----------

-- 주었으면 true. 회원이 아니거나, 이미 준 판이거나, 15초 안에 또 받는 것이면 false (오류를 내지 않는다: 게임 정산을 막지 않게)
create or replace function public._grant_sia_coin(p_user uuid, p_game text, p_ref text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_user is null or p_game is null or p_ref is null then return false; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return false; end if;
  perform public._ensure_wallet(p_user);
  -- 같은 사람의 요청은 한 번에 하나씩 (15초 확인이 겹치지 않게)
  perform 1 from public.wallets where user_id = p_user for update;
  if exists (select 1 from public.sia_coin_logs where user_id = p_user and created_at > now() - interval '15 seconds') then return false; end if;
  insert into public.sia_coin_logs (user_id, game, ref) values (p_user, p_game, p_ref) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  update public.wallets set sia_coins = sia_coins + 1 where user_id = p_user;
  return true;
end $$;
revoke all on function public._grant_sia_coin(uuid, text, text) from public, anon, authenticated;

-- ---------- 3. 지갑 정보에 코인 넣기 ----------

create or replace function public._wallet_json(w public.wallets) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'chips', w.chips,
    'nyang', w.nyang,
    'siaCoins', w.sia_coins,
    'chipsRefillsLeft', case when w.refill_date = public._kst_today() then greatest(0, 3 - w.chips_refills_today) else 3 end,
    'nyangRefillsLeft', case when w.refill_date = public._kst_today() then greatest(0, 3 - w.nyang_refills_today) else 3 end
  )
$$;

-- ---------- 4. 시아탱크 ----------

-- 판 정산 (015와 같고, 승패가 난 대전이면 끝까지 남아 있던 사람에게 코인)
create or replace function public.end_game(p_id uuid, p_game_no int, p_present text[], p_winner int default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb; e jsonb; won boolean;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'playing' or r.game_no <> p_game_no then return; end if;
  if p_winner in (0, 1) and r.map <> 'target' then
    for e in select * from jsonb_array_elements(r.players) loop
      continue when not exists (select 1 from public.profiles pr where pr.id::text = e->>'id');
      won := (e->>'team')::int = p_winner;
      insert into public.player_points as pp (user_id, points, wins, losses)
      values ((e->>'id')::uuid, case when won then 1100 else 1000 end, case when won then 1 else 0 end, case when won then 0 else 1 end)
      on conflict (user_id) do update set
        points = greatest(1000, pp.points + case when won then 100 else -100 end),
        wins = pp.wins + case when won then 1 else 0 end,
        losses = pp.losses + case when won then 0 else 1 end,
        updated_at = now();
      if (e->>'id') = any(p_present) and not ((e->>'id') = any(r.gone)) then
        perform public._grant_sia_coin((e->>'id')::uuid, 'tank', p_id || ':' || p_game_no);
      end if;
    end loop;
  end if;
  select coalesce(jsonb_agg(x || '{"items":[],"ready":false}'::jsonb), '[]'::jsonb) into rest
  from jsonb_array_elements(r.players) x where x->>'id' = any(p_present) and not (x->>'id' = any(r.gone));
  if jsonb_array_length(rest) = 0 then
    delete from public.rooms where id = p_id;
  else
    update public.rooms set status = 'waiting', players = rest, gone = '{}',
      host_id = case when exists (select 1 from jsonb_array_elements(rest) x where x->>'id' = r.host_id) then r.host_id else rest->0->>'id' end,
      updated_at = now()
    where id = p_id;
  end if;
end $$;

-- 백발백중 한 판 (015와 같고, 점수를 올리면 코인)
create or replace function public.submit_target_score(p_score int)
returns int language plpgsql security definer set search_path = public as $$
declare b int; n int;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'need login'; end if;
  if p_score is null or p_score < 0 or p_score > 2500 or p_score % 50 <> 0 then raise exception 'bad score'; end if;
  insert into public.target_scores as ts (user_id, best, plays) values (auth.uid(), p_score, 1)
  on conflict (user_id) do update set best = greatest(ts.best, excluded.best), plays = ts.plays + 1, updated_at = now()
  returning best, plays into b, n;
  perform public._grant_sia_coin(auth.uid(), 'target', n::text);
  return b;
end $$;
revoke all on function public.submit_target_score(int) from public, anon;
grant execute on function public.submit_target_score(int) to authenticated;

-- ---------- 5. 맞고 · 카지노 ----------

-- 판 정산 (018과 같고, 돈이 오간 판이면 끝까지 자리에 있던 사람에게 코인. 룰렛은 스핀마다 roulette_pay에서 준다)
create or replace function public.apply_round_result(p_room uuid, p_round int, p_deltas jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare rm public.game_rooms; s public.room_seats; d bigint; cur text; bal bigint; applied bigint; n int; played boolean;
begin
  select * into rm from public.game_rooms where id = p_room for update;
  if not found then return false; end if;
  insert into public.game_results (room_id, round_no, game, deltas) values (p_room, p_round, rm.game, p_deltas)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  cur := case when rm.game = 'matgo' then 'nyang' else 'chips' end;
  -- 취소된 판(아무 돈도 오가지 않음)은 코인을 주지 않는다
  select exists (select 1 from jsonb_each_text(coalesce(p_deltas, '{}'::jsonb)) x where x.value::numeric <> 0) into played;
  for s in select * from public.room_seats where room_id = p_room and user_id is not null loop
    if played and rm.game <> 'roulette' and not s.left_game and p_deltas ? s.seat_no::text then
      perform public._grant_sia_coin(s.user_id, rm.game, p_room || ':' || p_round);
    end if;
    d := coalesce((p_deltas ->> s.seat_no::text)::bigint, 0);
    if d = 0 then continue; end if;
    perform public._ensure_wallet(s.user_id);
    select case when cur = 'nyang' then nyang else chips end into bal from public.wallets where user_id = s.user_id for update;
    applied := greatest(d, -bal);
    if cur = 'nyang' then update public.wallets set nyang = nyang + applied where user_id = s.user_id;
    else update public.wallets set chips = chips + applied where user_id = s.user_id; end if;
    insert into public.wallet_logs (user_id, currency, amount, reason, game_id)
    values (s.user_id, cur, applied, 'game', rm.game || ':' || p_room || ':' || p_round);
  end loop;
  return true;
end $$;

-- 룰렛 지급 (027과 같고, 그 스핀에 베팅한 사람에게 코인)
create or replace function public.roulette_pay(p_room uuid, p_round int, p_spin int, p_result int)
returns int language plpgsql security definer set search_path = public as $$
declare b public.roulette_bets; pay bigint; n int := 0;
begin
  if p_result is null or p_result < 0 or p_result > 11 then raise exception 'bad result'; end if;
  perform pg_advisory_xact_lock(hashtext('roulette:' || p_room || ':' || p_round || ':' || p_spin));
  -- 스핀을 닫는다 (이후 확정 베팅은 거절). 이미 닫혔으면 그 결과를 쓴다
  insert into public.roulette_spins (room_id, round_no, spin_no, result) values (p_room, p_round, p_spin, p_result)
  on conflict do nothing;
  select result into p_result from public.roulette_spins where room_id = p_room and round_no = p_round and spin_no = p_spin;
  for b in select * from public.roulette_bets
           where room_id = p_room and round_no = p_round and spin_no = p_spin and payout is null for update loop
    pay := public._roulette_payout(b.bets, p_result);
    update public.roulette_bets set result = p_result, payout = pay
    where room_id = b.room_id and round_no = b.round_no and spin_no = b.spin_no and user_id = b.user_id;
    if pay > 0 then
      perform public._ensure_wallet(b.user_id);
      update public.wallets set chips = chips + pay where user_id = b.user_id;
      insert into public.wallet_logs (user_id, currency, amount, reason, game_id)
      values (b.user_id, 'chips', pay, 'game', 'roulette:' || p_room || ':' || p_round || ':' || p_spin);
    end if;
    perform public._grant_sia_coin(b.user_id, 'roulette', p_room || ':' || p_round || ':' || p_spin);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.roulette_pay(uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.roulette_pay(uuid, int, int, int) to service_role;

-- ---------- 6. 시아레이스 ----------

-- 완주 기록 올리기 (029와 같고, 받아들인 기록이면 코인)
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
  perform public._grant_sia_coin(auth.uid(), 'race', p_room_key || ':' || p_round || ':' || extract(epoch from rd.created_at)::bigint);
  return jsonb_build_object('accepted', true, 'time_ms', p_time_ms, 'best_ms', rec.best_ms,
    'improved', old_best is null or p_time_ms < old_best, 'plays', rec.plays);
end $$;
revoke all on function public.race_submit(text, int, int, text) from public, anon;
grant execute on function public.race_submit(text, int, int, text) to authenticated;
