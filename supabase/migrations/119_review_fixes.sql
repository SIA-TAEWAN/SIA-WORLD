-- 119: 11-27 2차 검사 반영 (카지노 정산 · 랭킹에서 관리자 빼기 · 시작 재시도)
--
-- 이 파일이 다시 정의하는 것 (이전 정의):
--   function public.apply_round_result(uuid, int, jsonb)   ← 118_low_fixes.sql
--   view public.pang_ranking                                ← 111_pang.sql
--   view public.defense_stage_ranking                       ← 048_defense.sql
--   view public.defense_endless_ranking                     ← 048_defense.sql
--   view public.twelve_level_ranking                        ← 097_review_fixes.sql
--   view public.twelve_tower_ranking                        ← 078_twelve.sql
--   function public.pang_start(int)                         ← 113_pang_lives.sql
--   function public.card_start(text, text, int, text, bigint) ← 117_card_cleanup.sql  (지우고 p_retry 를 더한 6인자로)
--
-- 1. apply_round_result (118 그대로 + 두 군데)
--    a) 포커·홀덤: 팟을 똑같이 나눠 deltas 가 전부 0 인 판도 한 판이다. 취소된 판(참가자 2명 미만, holdem/poker newRound)은
--       deltas 키가 1개 이하이므로, 키가 2개 이상이면 played.
--    b) 부족분 덜기의 won(이긴 몫 합)을 사람 자리의 양수 delta 로만 센다. AI 가 이긴 몫까지 넣으면 사람 승자에게서
--       short 의 일부만 덜려 그만큼 칩이 생겼다 (AI 몫은 어느 지갑에도 들어가지 않으므로 덜 대상이 아니다).
-- 2. 랭킹 뷰에서 관리자(profiles.is_admin) 빼기 — 117 의 card_endless_ranking 과 같은 방식. 열·순서·권한은 그대로.
-- 3. pang_start: 서버에선 시작됐는데 화면이 시간초과로 답을 못 받아 다시 누르면 목숨이 또 빠지고 판이 남았다.
--    → 같은 사람·같은 스테이지의 끝나지 않은 판이 2분 안에 시작된 게 있으면 그 판을 돌려주고 목숨은 빼지 않는다. 반환 형식 그대로.
-- 4. card_start: 117 의 오늘의 도전 2분 재사용은 '시간초과 뒤 다시 누름' 과 '일부러 새로 시작' 을 구분하지 못했다.
--    → p_retry(기본 false)가 true 일 때만 재사용. 화면은 직전 card_start 가 시간초과·통신 실패로 끝난 같은 판을 다시 누를 때만 보낸다.

-- ---------- 1. 카지노 정산 ----------

create or replace function public.apply_round_result(p_room uuid, p_round int, p_deltas jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare rm public.game_rooms; s public.room_seats; d bigint; cur text; bal bigint; applied bigint; n int; played boolean;
  pool boolean; short numeric := 0; won numeric := 0;
begin
  select * into rm from public.game_rooms where id = p_room for update;
  if not found then return false; end if;
  insert into public.game_results (room_id, round_no, game, deltas) values (p_room, p_round, rm.game, p_deltas)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  cur := case when rm.game = 'matgo' then 'nyang' else 'chips' end;
  pool := rm.game in ('poker', 'holdem');
  -- 취소된 판(아무 돈도 오가지 않음)은 코인을 주지 않는다
  select exists (select 1 from jsonb_each_text(coalesce(p_deltas, '{}'::jsonb)) x where x.value::numeric <> 0) into played;
  -- (118) 블랙잭은 건 자리만 deltas 에 있다: 모두 무승부여도 한 판
  if rm.game = 'blackjack' and not played then
    played := exists (select 1 from jsonb_object_keys(coalesce(p_deltas, '{}'::jsonb)));
  end if;
  -- (119) 포커·홀덤: 팟을 똑같이 나눈 판도 한 판. 취소된 판은 참가자 2명 미만이라 deltas 키가 1개 이하
  if pool and not played then
    played := (select count(*) from jsonb_object_keys(coalesce(p_deltas, '{}'::jsonb))) >= 2;
  end if;

  -- (118) 포커·홀덤: 진 사람 잔액이 모자란 만큼 이긴 몫을 덜 준다 (칩이 생기지 않게)
  if pool then
    for s in select * from public.room_seats where room_id = p_room and user_id is not null order by user_id loop
      d := coalesce((p_deltas ->> s.seat_no::text)::bigint, 0);
      if d >= 0 then continue; end if;
      perform public._ensure_wallet(s.user_id);
      select chips into bal from public.wallets where user_id = s.user_id for update;
      if -d > greatest(bal, 0) then short := short + (-d - greatest(bal, 0)); end if;
    end loop;
    -- (119) 덜 대상은 사람 자리의 이긴 몫만 (AI 몫은 지갑에 들어가지 않는다)
    select coalesce(sum(greatest(coalesce((p_deltas ->> rs.seat_no::text)::numeric, 0), 0)), 0) into won
      from public.room_seats rs where rs.room_id = p_room and rs.user_id is not null;
  end if;

  for s in select * from public.room_seats where room_id = p_room and user_id is not null loop
    if played and rm.game <> 'roulette' and not s.left_game and p_deltas ? s.seat_no::text then
      perform public._grant_sia_coin(s.user_id, rm.game, p_room || ':' || p_round);
    end if;
    d := coalesce((p_deltas ->> s.seat_no::text)::bigint, 0);
    if pool and short > 0 and won > 0 and d > 0 then
      d := d - least(d, ceil(short * d / won)::bigint);
    end if;
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
revoke all on function public.apply_round_result(uuid, int, jsonb) from public, anon, authenticated;
grant execute on function public.apply_round_result(uuid, int, jsonb) to service_role;

-- ---------- 2. 랭킹 뷰: 관리자 계정 빼기 (각 최신 정의 그대로, where 만) ----------

-- 시아팡팡 (111)
create or replace view public.pang_ranking as
  select r.user_id, p.nickname, r.total_stars, r.cleared, r.stars_at as achieved_at,
    (row_number() over (order by r.total_stars desc, r.cleared desc, r.stars_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.pang_profiles r join public.profiles p on p.id = r.user_id
  where r.total_stars > 0 and not coalesce(p.is_admin, false);
revoke all on public.pang_ranking from anon, authenticated;
grant select on public.pang_ranking to anon, authenticated;

-- 시아디펜스 스테이지 (048)
create or replace view public.defense_stage_ranking as
  select r.user_id, p.nickname, r.total_stars, r.cleared_stages,
    (select d.stage_id from public.defense_stages d where d.user_id = r.user_id
      order by split_part(d.stage_id, '-', 1)::int desc, split_part(d.stage_id, '-', 2)::int desc limit 1) as best_stage,
    r.stars_updated_at as achieved_at,
    (row_number() over (order by r.total_stars desc, r.cleared_stages desc, r.stars_updated_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.defense_profiles r join public.profiles p on p.id = r.user_id
  where r.total_stars > 0 and not coalesce(p.is_admin, false);
revoke all on public.defense_stage_ranking from anon, authenticated;
grant select on public.defense_stage_ranking to anon, authenticated;

-- 시아디펜스 끝없는 모드 (048)
create or replace view public.defense_endless_ranking as
  select r.user_id, p.nickname, r.best_wave, r.characters, r.achieved_at,
    (row_number() over (order by r.best_wave desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.defense_endless r join public.profiles p on p.id = r.user_id
  where not coalesce(p.is_admin, false);
revoke all on public.defense_endless_ranking from anon, authenticated;
grant select on public.defense_endless_ranking to anon, authenticated;

-- 시아열두길 레벨 (097)
create or replace view public.twelve_level_ranking as
  select r.user_id, p.nickname, r.level, r.exp, r.mode, r.hero,
    least(12, coalesce((select max(split_part(m.map_id, '-', 1)::int) from public.twelve_maps m
      where m.user_id = r.user_id and m.mode = r.mode and m.clears > 0 and m.map_id ~ '^[0-9]+-8$'), 0) + 1) as region,
    exists (select 1 from public.twelve_maps m where m.user_id = r.user_id and m.mode = 'hard' and m.map_id = 'final') as hard_done,
    r.level_at as achieved_at,
    (row_number() over (order by r.level desc, r.exp desc, r.level_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.twelve_profiles r join public.profiles p on p.id = r.user_id
  where r.cleared_maps > 0 and not coalesce(p.is_admin, false);
revoke all on public.twelve_level_ranking from anon, authenticated;
grant select on public.twelve_level_ranking to anon, authenticated;

-- 시아열두길 끝없는 탑 (078)
create or replace view public.twelve_tower_ranking as
  select r.user_id, p.nickname, r.best_floor, r.best_time, r.level, r.hero, r.achieved_at,
    (row_number() over (order by r.best_floor desc, r.best_time asc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.twelve_tower r join public.profiles p on p.id = r.user_id
  where not coalesce(p.is_admin, false);
revoke all on public.twelve_tower_ranking from anon, authenticated;
grant select on public.twelve_tower_ranking to anon, authenticated;

-- ---------- 3. 시아팡팡 시작 (113 그대로 + 2분 안 재시도는 같은 판) ----------

create or replace function public.pang_start(p_stage int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.pang_profiles; rid uuid; lv record; adm boolean; left_ int; at timestamptz; nxt int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_stage is null or p_stage < 1 or p_stage > 100 or not exists (select 1 from public._pang_stages where stage = p_stage) then raise exception 'bad stage'; end if;
  r := public._pang_row(me);
  adm := public._pang_is_admin(me);
  if not adm and p_stage > public._pang_open(r.stars) then raise exception 'locked stage'; end if;
  -- _pang_refill 이 pang_profiles 줄을 잠근다 → 같은 사람의 시작은 한 번에 하나씩 (아래 재시도 확인도 그 뒤)
  select * into lv from public._pang_refill(me);
  left_ := lv.o_lives; nxt := lv.o_next;
  -- (119) 시간초과로 받지 못한 시작을 다시 누른 것: 2분 안에 시작한, 끝나지 않은 같은 스테이지 판을 돌려준다 (목숨은 그대로)
  select pr.id into rid from public.pang_runs pr
    where pr.user_id = me and pr.stage = p_stage and pr.finished_at is null and pr.started_at > now() - interval '2 minutes'
    order by pr.started_at desc limit 1;
  if rid is not null then
    return jsonb_build_object('run', rid, 'lives', left_, 'nextLife', nxt);
  end if;
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

-- ---------- 4. 시아카드배틀 시작 (117 그대로 + p_retry 일 때만 재사용) ----------

drop function if exists public.card_start(text, text, int, text, bigint);

create or replace function public.card_start(p_mode text, p_hero text, p_mastery int default 0, p_day text default null, p_seed bigint default null, p_retry boolean default false)
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
    -- 시간초과로 받지 못한 시작을 다시 누른 것(p_retry): 방금 만든, 아직 기록 없는 같은 판을 그대로 돌려준다 (그날 첫 판을 잃지 않게)
    -- (119) 일부러 새로 시작한 것(p_retry = false)은 재사용하지 않는다
    if coalesce(p_retry, false) then
      select * into r from public.card_runs
        where user_id = me and mode = 'daily' and status = 'active' and day = d and hero = p_hero and seed = s
          and log_len = 0 and started_at > now() - interval '2 minutes';
      if found then
        return public._card_run_json(r) || jsonb_build_object('paidCoins', public._card_pay_owed(me, null));
      end if;
    end if;
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
  -- 버린 판 정리: 기록 없는 판은 지우고 나머지는 입력 기록만 비운다 ('그날 첫 판' 판정은 위에서 이미 했다)
  perform public._card_prune(me);
  insert into public.card_runs (user_id, mode, hero, mastery, seed, rules, day, first_of_day, start_gold)
    values (me, p_mode, p_hero, lv, s, public._card_const('rules'), d, first, g)
    returning * into r;
  -- 앞 판들에서 15초 규칙으로 못 받은 막 코인이 있으면 하나 (끝난 판이어도)
  return public._card_run_json(r) || jsonb_build_object('paidCoins', public._card_pay_owed(me, null));
end $$;
revoke all on function public.card_start(text, text, int, text, bigint, boolean) from public, anon;
grant execute on function public.card_start(text, text, int, text, bigint, boolean) to authenticated;
