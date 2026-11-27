-- 117: 시아카드배틀 정리 (11-27 전체검사 남긴 낮은 것)
--   1. 버린 판 정리: 새 판을 시작하면 앞 판은 버린 판(abandoned)이 되는데 행 · 입력 기록(최대 3만 개)이 그대로 쌓였다.
--      card_start 가 그 사람의 버린 판을 정리한다 —
--        · 한 막도 기록되지 않은 버린 판(log_len = 0, acts = 0)은 지운다. 받을 시아코인이 없고 읽는 곳도 없다.
--          단 오늘의 도전 판은 오늘 것까지 남긴다 (card_start 의 '그날 첫 판' 판정이 그날 판이 있는지로 본다).
--        · 나머지 버린 판은 입력 기록만 비운다 (_card_pay_owed 는 acts · coins · ending 만 읽는다 — 못 받은 막 코인은 그대로 받는다).
--      끝난 판(over)은 그대로 둔다. 이미 쌓인 행은 아래 6번에서 한 번 정리한다.
--   2. 오늘의 도전 시작 재시도: 시작 RPC 가 서버에서는 됐는데 화면이 시간초과로 받지 못하면, 다시 누를 때
--      그날 첫 판(first_of_day)이 버린 판이 되고 새 판은 순위에 들지 못했다. 이제 같은 날 · 같은 영웅 · 같은 씨앗의
--      진행 중인 판이 아직 아무 기록 없이(log_len = 0) 2분 안에 시작된 것이면 새로 만들지 않고 그 판을 그대로 돌려준다.
--      (오늘의 도전은 모두 같은 영웅 · 씨앗이라 같은 판이다. 2분이 지났거나 막을 기록한 판은 예전처럼 새로 시작.)
--   3. 끝없는 모드 랭킹(card_endless_ranking)에서 관리자 계정(profiles.is_admin — card_start 의 시험 판 판정과 같은 열)을 뺀다.
--      관리자 자신의 최고 기록(card_state 'endless')은 그대로 남는다.
--   규칙 결과는 바뀌지 않으므로 RULES_VERSION · _card_const('rules') 는 그대로 (7).
--   다시 정의하는 것 (마지막 정의: card_start 는 114_card_tune.sql, card_endless_ranking 은 112_card.sql — 권한 그대로)

-- ---------- 1. 버린 판 정리 (card_start 안에서 · 아래 한 번 정리에서) ----------

create or replace function public._card_prune(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.card_runs
    where user_id = p_user and status = 'abandoned' and log_len = 0 and acts = 0
      and (mode <> 'daily' or day is null or day < public._daily_day());
  update public.card_runs set log = '[]'::jsonb
    where user_id = p_user and status = 'abandoned' and log <> '[]'::jsonb;
end $$;
revoke all on function public._card_prune(uuid) from public, anon, authenticated;

-- ---------- 2. 판 시작 (114 그대로 + 오늘의 도전 재시도 · 버린 판 정리) ----------

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
    -- 시간초과로 받지 못한 시작을 다시 누른 것: 방금 만든, 아직 기록 없는 같은 판을 그대로 돌려준다 (그날 첫 판을 잃지 않게)
    select * into r from public.card_runs
      where user_id = me and mode = 'daily' and status = 'active' and day = d and hero = p_hero and seed = s
        and log_len = 0 and started_at > now() - interval '2 minutes';
    if found then
      return public._card_run_json(r) || jsonb_build_object('paidCoins', public._card_pay_owed(me, null));
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
revoke all on function public.card_start(text, text, int, text, bigint) from public, anon;
grant execute on function public.card_start(text, text, int, text, bigint) to authenticated;

-- ---------- 3. 끝없는 모드 랭킹: 관리자 계정 빼기 (112 그대로, where 만) ----------

create or replace view public.card_endless_ranking as
  select e.user_id, p.nickname, e.best_floors, e.acts, e.hero, e.achieved_at,
    (row_number() over (order by e.best_floors desc, e.achieved_at asc, e.user_id))::int as place,
    (count(*) over ())::int as total
  from public.card_endless e join public.profiles p on p.id = e.user_id
  where not coalesce(p.is_admin, false);
revoke all on public.card_endless_ranking from anon, authenticated;
grant select on public.card_endless_ranking to anon, authenticated;

-- ---------- 4. 이미 쌓인 버린 판 한 번 정리 (_card_prune 과 같은 조건, 모든 사람) ----------

delete from public.card_runs
  where status = 'abandoned' and log_len = 0 and acts = 0
    and (mode <> 'daily' or day is null or day < public._daily_day());
update public.card_runs set log = '[]'::jsonb where status = 'abandoned' and log <> '[]'::jsonb;
