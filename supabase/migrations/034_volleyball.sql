-- 034: 시아배구 (1:1 온라인 배구)
--   volleyball_rankings : 사용자별 누적 전적 (사람 대 사람 경기만, 초기화 없음)
--   volleyball_matches  : 경기 한 판 (진행 중인 줄 + 끝난 기록)
-- 방 자체는 실시간 채널(Presence)만 쓰고 DB에 두지 않는다. 방 열쇠(room_key)는 주소의 방 코드,
-- 경기 번호(match_no)는 방장이 시작 알림에 담아 보내는 숫자(서버 시각 ms).
--
-- 결과는 '양쪽 보고 일치' 방식으로만 기록한다 (한 기기가 승패를 마음대로 올리지 못하게):
--   1) 경기 시작: 두 사람이 각자 volleyball_begin() → 서로가 서로를 상대로 지목했을 때만 live
--   2) 경기 끝: 두 사람이 각자 volleyball_report() → 두 보고의 승자(정상 종료면 점수도)가 같으면 확정, 다르면 무효(void)
--   3) 상대가 나가 버려 보고가 하나뿐이면: 첫 보고 10초 뒤 volleyball_settle() 로 그 보고 하나로 확정
-- 표는 함수만 바꾼다 (직접 쓰기 권한 없음).
-- 시아코인(033_sia_coin.sql): 정상 종료('normal')로 확정된 경기의 두 사람 모두에게 준다. 이탈('leave')·무효(void)는 주지 않는다.

-- ---------- 1. 표 ----------

create table if not exists public.volleyball_rankings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  wins int not null default 0 check (wins >= 0),
  losses int not null default 0 check (losses >= 0),
  last_character text not null,
  -- 지금 승수에 처음 도달한 시각 (승수·승률이 같으면 먼저 달성한 사람이 위)
  reached_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.volleyball_rankings enable row level security;
drop policy if exists volleyball_rankings_read on public.volleyball_rankings;
create policy volleyball_rankings_read on public.volleyball_rankings for select using (true);
revoke all on public.volleyball_rankings from anon, authenticated;
grant select on public.volleyball_rankings to anon, authenticated;
create index if not exists volleyball_rankings_rank_idx on public.volleyball_rankings (wins desc, reached_at);

create table if not exists public.volleyball_matches (
  id uuid primary key default gen_random_uuid(),
  room_key text not null,
  match_no bigint not null,
  -- pending: 자리 채우는 중 · live: 경기 중 · done: 결과 확정 · void: 두 보고가 달라 무효
  status text not null default 'pending' check (status in ('pending', 'live', 'done', 'void')),
  left_user_id uuid references public.profiles(id) on delete set null,
  right_user_id uuid references public.profiles(id) on delete set null,
  left_character text,
  right_character text,
  left_joined_at timestamptz,
  right_joined_at timestamptz,
  -- 각 자리의 사람이 '내 상대'라고 지목한 사용자
  left_claim uuid,
  right_claim uuid,
  -- 각 자리의 보고: { "l": 왼쪽 점수, "r": 오른쪽 점수, "reason": "normal"|"leave", "winner": 0|1 }
  left_report jsonb,
  right_report jsonb,
  first_report_at timestamptz,
  live_at timestamptz,
  -- 확정된 결과
  left_score int check (left_score between 0 and 3),
  right_score int check (right_score between 0 and 3),
  winner_id uuid references public.profiles(id) on delete set null,
  ended_reason text check (ended_reason in ('normal', 'leave')),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (room_key, match_no)
);
alter table public.volleyball_matches enable row level security;
-- 정책 없음 + 권한 없음: 함수(security definer)로만 읽고 쓴다
revoke all on public.volleyball_matches from anon, authenticated;
create index if not exists volleyball_matches_created_idx on public.volleyball_matches (status, created_at);
create index if not exists volleyball_matches_left_idx on public.volleyball_matches (left_user_id, created_at);
create index if not exists volleyball_matches_right_idx on public.volleyball_matches (right_user_id, created_at);

-- ---------- 2. 기준 값 ----------

-- 게임 쪽 값(games/volleyball/src/game/constants.ts · net/record.ts)과 맞춘다.
create or replace function public._volleyball_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'win_score' then 3          -- 3점 선승
    when 'min_sec' then 5            -- live 뒤 이보다 빨리 끝난 경기는 없다
    when 'max_sec' then 1800         -- live 뒤 30분이 지나면 보고를 받지 않는다
    when 'settle_sec' then 10        -- 첫 보고 뒤 이만큼 지나도 상대 보고가 없으면 보고 하나로 확정
    when 'no_window_sec' then 600    -- 경기 번호(서버 시각 ms)가 지금과 이만큼 넘게 다르면 거절
    when 'begin_gap_sec' then 3      -- 한 사람이 새 경기를 시작할 수 있는 최소 간격
  end
$$;
revoke all on function public._volleyball_const(text) from public, anon, authenticated;

-- ---------- 3. 서버 시각 ----------

-- 기기 시계를 서버 시각에 맞추는 용도 (epoch ms). 두 기기가 같은 순간에 카운트다운을 끝낸다.
create or replace function public.volleyball_now() returns double precision
language sql volatile security definer set search_path = public as $$
  select extract(epoch from clock_timestamp()) * 1000
$$;
revoke all on function public.volleyball_now() from public;
grant execute on function public.volleyball_now() to anon, authenticated;

-- ---------- 4. 결과 확정 (안에서만 쓴다) ----------

-- 한 경기를 한 번만 확정한다: 부르는 쪽이 그 줄을 잠근 채(for update) status = 'live' 를 확인하고 부른다.
create or replace function public._volleyball_finish(p_id uuid, p_left int, p_right int, p_winner_side int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.volleyball_matches; w uuid; l uuid; wc text; lc text; t timestamptz := clock_timestamp();
begin
  select * into m from public.volleyball_matches where id = p_id for update;
  if not found or m.status <> 'live' then return; end if;
  if p_winner_side = 0 then
    w := m.left_user_id; wc := m.left_character; l := m.right_user_id; lc := m.right_character;
  else
    w := m.right_user_id; wc := m.right_character; l := m.left_user_id; lc := m.left_character;
  end if;
  update public.volleyball_matches
    set status = 'done', left_score = p_left, right_score = p_right, winner_id = w, ended_reason = p_reason, done_at = t
    where id = p_id;
  -- 이긴 사람: 승 +1, 지금 승수에 도달한 시각 갱신
  if w is not null then
    insert into public.volleyball_rankings as r (user_id, wins, losses, last_character, reached_at, updated_at)
    values (w, 1, 0, wc, t, t)
    on conflict (user_id) do update set wins = r.wins + 1, last_character = excluded.last_character, reached_at = excluded.reached_at, updated_at = excluded.updated_at;
  end if;
  -- 진 사람: 패 +1 (승수는 그대로라 도달 시각도 그대로)
  if l is not null then
    insert into public.volleyball_rankings as r (user_id, wins, losses, last_character, reached_at, updated_at)
    values (l, 0, 1, lc, t, t)
    on conflict (user_id) do update set losses = r.losses + 1, last_character = excluded.last_character, updated_at = excluded.updated_at;
  end if;
  -- 시아코인: 끝까지 한 경기(정상 종료)의 두 사람 모두. 이미 준 판·15초 안 중복은 _grant_sia_coin 이 알아서 false
  if p_reason = 'normal' then
    perform public._grant_sia_coin(m.left_user_id, 'volleyball', m.id::text);
    perform public._grant_sia_coin(m.right_user_id, 'volleyball', m.id::text);
  end if;
end $$;
revoke all on function public._volleyball_finish(uuid, int, int, int, text) from public, anon, authenticated;

-- 끝난 경기를 부른 사람에게 알려 줄 모양
create or replace function public._volleyball_result(m public.volleyball_matches, p_me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status', m.status,
    'left_score', m.left_score,
    'right_score', m.right_score,
    'winner_id', m.winner_id,
    'reason', m.ended_reason,
    'wins', coalesce((select wins from public.volleyball_rankings where user_id = p_me), 0),
    'losses', coalesce((select losses from public.volleyball_rankings where user_id = p_me), 0))
$$;
revoke all on function public._volleyball_result(public.volleyball_matches, uuid) from public, anon, authenticated;

-- ---------- 5. 경기 시작 ----------

-- 경기 시작 때 두 사람이 각자 부른다. p_side: 0 왼쪽(방장) · 1 오른쪽, p_opponent: 상대 사용자 ID.
-- (room_key, match_no) 줄을 만들거나 찾아 자기 자리를 채운다. 두 자리가 차고 서로가 서로를 지목했을 때만 live.
-- → { match: uuid, live: bool }
create or replace function public.volleyball_begin(p_room_key text, p_match_no bigint, p_side int, p_opponent uuid, p_character text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t timestamptz := clock_timestamp(); m public.volleyball_matches;
  other_cur uuid; other_claim uuid; now_ms numeric;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_room_key is null or p_room_key !~ '^[a-z0-9]{4,24}$' then raise exception 'bad room'; end if;
  if p_side is null or p_side not in (0, 1) then raise exception 'bad side'; end if;
  if p_character is null or p_character not in ('rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig') then raise exception 'bad character'; end if;
  if p_opponent is null or p_opponent = me then raise exception 'bad opponent'; end if;
  if not exists (select 1 from public.profiles where id = p_opponent) then raise exception 'bad opponent'; end if;
  -- 경기 번호는 방장이 서버 시각(ms)으로 만든다: 지금과 너무 다르면 거절 (미리 만들어 두거나 옛 번호를 다시 쓰지 못하게)
  now_ms := extract(epoch from t) * 1000;
  if p_match_no is null or abs(p_match_no - now_ms) > public._volleyball_const('no_window_sec') * 1000.0 then raise exception 'bad match no'; end if;

  -- 같은 경기의 요청은 한 번에 하나씩
  perform pg_advisory_xact_lock(hashtext('volley:' || p_room_key || ':' || p_match_no::text));
  -- 오래된 줄 정리: 시작하지 못했거나 무효가 된 줄(1시간), 끝내 확정되지 않은 줄(3시간)
  delete from public.volleyball_matches where status in ('pending', 'void') and created_at < t - interval '1 hour';
  delete from public.volleyball_matches where status = 'live' and created_at < t - interval '3 hours';

  select * into m from public.volleyball_matches where room_key = p_room_key and match_no = p_match_no for update;
  if not found then
    -- 너무 자주 새 경기를 열지 못하게 (같은 사람 기준)
    if exists (
      select 1 from public.volleyball_matches
      where (left_user_id = me or right_user_id = me)
        and created_at > t - make_interval(secs => public._volleyball_const('begin_gap_sec'))
    ) then raise exception 'too soon'; end if;
    insert into public.volleyball_matches (room_key, match_no, created_at) values (p_room_key, p_match_no, t) returning * into m;
  end if;

  -- 이미 시작했거나 끝난 경기: 참가자에게는 그 경기를 그대로 알려 주고(다시 불러도 같은 답), 남은 거절
  if m.status <> 'pending' then
    if me = m.left_user_id or me = m.right_user_id then
      return jsonb_build_object('match', m.id, 'live', m.status = 'live');
    end if;
    raise exception 'closed';
  end if;

  if p_side = 0 then
    other_cur := m.right_user_id; other_claim := m.right_claim;
  else
    other_cur := m.left_user_id; other_claim := m.left_claim;
  end if;
  -- 내가 이미 반대쪽 자리에 앉아 있다 (자기 자신과의 경기)
  if other_cur = me then raise exception 'bad seat'; end if;
  -- 반대쪽에 앉은 사람이 내가 지목한 상대가 아니다: 끼어든 사람이므로 그 자리를 비운다
  if other_cur is not null and other_cur <> p_opponent then
    if p_side = 0 then
      update public.volleyball_matches set right_user_id = null, right_character = null, right_joined_at = null, right_claim = null where id = m.id;
    else
      update public.volleyball_matches set left_user_id = null, left_character = null, left_joined_at = null, left_claim = null where id = m.id;
    end if;
    other_cur := null; other_claim := null;
  end if;
  -- 반대쪽 사람(내가 지목한 상대)이 나를 지목하지 않았다
  if other_cur is not null and other_claim is distinct from me then raise exception 'not your match'; end if;
  -- 내 자리에 다른 사람이 앉아 있으면(아직 시작 전) 내가 앉는다. 진짜 상대가 오면 위 규칙으로 가려진다.
  if p_side = 0 then
    update public.volleyball_matches set left_user_id = me, left_character = p_character, left_joined_at = t, left_claim = p_opponent where id = m.id;
  else
    update public.volleyball_matches set right_user_id = me, right_character = p_character, right_joined_at = t, right_claim = p_opponent where id = m.id;
  end if;
  -- 두 자리가 찼고 서로가 서로를 지목했다 → 경기 시작
  if other_cur is not null then
    update public.volleyball_matches set status = 'live', live_at = t where id = m.id;
    return jsonb_build_object('match', m.id, 'live', true);
  end if;
  return jsonb_build_object('match', m.id, 'live', false);
end $$;
revoke all on function public.volleyball_begin(text, bigint, int, uuid, text) from public, anon;
grant execute on function public.volleyball_begin(text, bigint, int, uuid, text) to authenticated;

-- ---------- 6. 결과 보고 ----------

-- 경기가 끝나면 두 사람이 각자 부른다. p_reason: 'normal'(3점으로 끝남) · 'leave'(상대가 나갔다는 주장 → 보고자가 이긴 것으로만).
-- 양쪽 보고가 모이면 승자(둘 다 normal이면 점수도)가 같을 때만 확정, 다르면 무효.
-- → { status: 'waiting' | 'done' | 'void', (done이면) left_score, right_score, winner_id, reason, wins, losses }
create or replace function public.volleyball_report(p_match uuid, p_left_score int, p_right_score int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t timestamptz := clock_timestamp(); m public.volleyball_matches;
  my_side int; win int := public._volleyball_const('win_score'); winner int; age numeric; mine jsonb; theirs jsonb; a jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into m from public.volleyball_matches where id = p_match for update;
  if not found then raise exception 'no match'; end if;
  if me = m.left_user_id then my_side := 0;
  elsif me = m.right_user_id then my_side := 1;
  else raise exception 'not in match';
  end if;
  -- 이미 확정·무효: 그 결과를 그대로 알려 준다 (늦게 보고한 쪽)
  if m.status in ('done', 'void') then return public._volleyball_result(m, me); end if;
  if m.status <> 'live' then raise exception 'not live'; end if;

  if p_reason is null or p_reason not in ('normal', 'leave') then raise exception 'bad reason'; end if;
  if p_left_score is null or p_right_score is null or p_left_score < 0 or p_right_score < 0 or p_left_score > win or p_right_score > win then raise exception 'bad score'; end if;
  if p_reason = 'normal' then
    -- 정확히 한쪽만 3점
    if (p_left_score = win) = (p_right_score = win) then raise exception 'bad score'; end if;
    winner := case when p_left_score = win then 0 else 1 end;
  else
    -- 상대가 나갔다: 아무도 3점이 아니고, 보고한 내가 이긴 것으로만
    if p_left_score = win or p_right_score = win then raise exception 'bad score'; end if;
    winner := my_side;
  end if;
  age := extract(epoch from (t - m.live_at));
  if age < public._volleyball_const('min_sec') then raise exception 'too early'; end if;
  if age > public._volleyball_const('max_sec') then raise exception 'too late'; end if;

  -- 내 보고는 한 번만 (이미 있으면 처음 것을 그대로 둔다)
  mine := case when my_side = 0 then m.left_report else m.right_report end;
  theirs := case when my_side = 0 then m.right_report else m.left_report end;
  if mine is null then
    mine := jsonb_build_object('l', p_left_score, 'r', p_right_score, 'reason', p_reason, 'winner', winner);
    if my_side = 0 then
      update public.volleyball_matches set left_report = mine, first_report_at = coalesce(first_report_at, t) where id = m.id;
    else
      update public.volleyball_matches set right_report = mine, first_report_at = coalesce(first_report_at, t) where id = m.id;
    end if;
  end if;
  if theirs is null then return jsonb_build_object('status', 'waiting'); end if;

  -- 양쪽 보고가 모였다
  if (mine->>'winner')::int <> (theirs->>'winner')::int
     or (mine->>'reason' = 'normal' and theirs->>'reason' = 'normal' and (mine->>'l' <> theirs->>'l' or mine->>'r' <> theirs->>'r')) then
    update public.volleyball_matches set status = 'void', done_at = t where id = m.id;
    return jsonb_build_object('status', 'void');
  end if;
  -- 승자가 같다: 점수·사유는 정상 종료 보고가 있으면 그것, 없으면 내 보고
  a := case when mine->>'reason' = 'normal' then mine when theirs->>'reason' = 'normal' then theirs else mine end;
  perform public._volleyball_finish(m.id, (a->>'l')::int, (a->>'r')::int, (a->>'winner')::int, a->>'reason');
  select * into m from public.volleyball_matches where id = p_match;
  return public._volleyball_result(m, me);
end $$;
revoke all on function public.volleyball_report(uuid, int, int, text) from public, anon;
grant execute on function public.volleyball_report(uuid, int, int, text) to authenticated;

-- ---------- 7. 보고 하나로 확정 ----------

-- 참가자가 부른다. 첫 보고 뒤 10초가 지났는데 상대 보고가 없으면(상대가 나가 버림) 그 보고 하나로 확정한다.
-- → { status: 'waiting' | 'done' | 'void', … }
create or replace function public.volleyball_settle(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz := clock_timestamp(); m public.volleyball_matches; one jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into m from public.volleyball_matches where id = p_match for update;
  if not found then raise exception 'no match'; end if;
  if me is distinct from m.left_user_id and me is distinct from m.right_user_id then raise exception 'not in match'; end if;
  if m.status in ('done', 'void') then return public._volleyball_result(m, me); end if;
  if m.status <> 'live' then raise exception 'not live'; end if;
  -- 보고가 정확히 하나이고, 그 뒤 10초가 지났을 때만
  if (m.left_report is null) = (m.right_report is null) or m.first_report_at is null
     or m.first_report_at > t - make_interval(secs => public._volleyball_const('settle_sec')) then
    return jsonb_build_object('status', 'waiting');
  end if;
  one := coalesce(m.left_report, m.right_report);
  perform public._volleyball_finish(m.id, (one->>'l')::int, (one->>'r')::int, (one->>'winner')::int, one->>'reason');
  select * into m from public.volleyball_matches where id = p_match;
  return public._volleyball_result(m, me);
end $$;
revoke all on function public.volleyball_settle(uuid) from public, anon;
grant execute on function public.volleyball_settle(uuid) to authenticated;

-- ---------- 8. 랭킹 ----------

-- 승수 많은 순 → 승률 높은 순 → 그 승수에 먼저 도달한 순. place는 전체 순위 (상위 100명은 place <= 100, 내 순위는 user_id로 조회)
create or replace view public.volleyball_ranking as
  select r.user_id, p.nickname, r.wins, r.losses, r.last_character, r.reached_at,
    (row_number() over (
      order by r.wins desc,
        (case when r.wins + r.losses > 0 then r.wins::numeric / (r.wins + r.losses) else 0 end) desc,
        r.reached_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.volleyball_rankings r join public.profiles p on p.id = r.user_id;
revoke all on public.volleyball_ranking from anon, authenticated;
grant select on public.volleyball_ranking to anon, authenticated;
