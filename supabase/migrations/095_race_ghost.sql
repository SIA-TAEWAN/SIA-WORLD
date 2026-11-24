-- 095: 시아레이스 "1위 고스트" (오늘의 도전, 083 위에)
--   그날 오늘의 도전 1위가 누른 버튼 기록(걸음 번호 + 출발·점프·슬라이딩)을 남겨, 다른 사람의 판에 반투명 주자로 같이 달린다.
--   서버는 다시 달려 볼 수 없으므로 모양·크기·기록(ms)·날짜만 검사하고, 받는 기기가 다시 달려 기록이 맞는지 확인한다
--   (games/running/src/game/ghost.ts 의 acceptGhost: ±10ms 넘게 다르면 쓰지 않는다).
--   고스트는 서버 기록·시아코인·고양이 진행과 무관하다 (race_submit · race_daily_submit 은 다시 정의하지 않는다).
--
--   0. 최소 기록 28초 → 27초: 146m 트랙에서 부스트가 끝날 때 점프하면 27.8초대가 나온다 (2026-11-23 사용자 결정).
--      _race_const 최신 정의는 031 — 나머지 값은 그대로. race_records 의 check 도 같이. 기기 쪽은 constants.ts 의 MIN_VALID_MS.
--   1. race_ghosts : (그날, 사람)마다 가장 빠른 고스트 하나. RLS 켜고 정책 없음 (아래 함수로만).
--   2. race_ghost_submit(room, round, ghost) : race_daily_submit 이 받은 판(race_runs.daily_day)의 고스트만, 더 빠를 때만 바꾼다.
--   3. race_ghost_top(day) : 그날 1위(daily_ranking 과 같은 순서)의 고스트. 없으면 고스트가 있는 사람 중 가장 높은 순위. 없으면 null.
--   4. 7일 지난 고스트는 넣을 때마다 지운다 (029 의 race_rounds 정리처럼. 기본 키가 day 로 시작해 가볍다).

-- ---------- 0. 최소 기록 27초 ----------

create or replace function public._race_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'min_ms' then 27000        -- 이보다 빠른 기록은 없다 (146m: 그냥 달리면 29.4초, 부스트를 잘 이으면 27.8초대)
    when 'max_ms' then 90000        -- 출발 90초 뒤에는 경기가 끝난다
    when 'early_ms' then 400        -- 기기 시계 오차: 기록이 (지금 - GO)보다 이만큼까지는 커도 된다
    when 'late_ms' then 6000        -- 도착 뒤 이 시간 안에 올려야 한다 (통신 지연)
    when 'lead_ms' then 1200        -- GO 요청부터 '준비' 표시까지 (모든 기기에 전달될 시간)
    when 'gap_ms' then 4000         -- 같은 방에서 다음 판을 열 수 있는 최소 간격
  end
$$;

alter table public.race_records drop constraint if exists race_records_best_ms_check;
alter table public.race_records add constraint race_records_best_ms_check check (best_ms >= 27000);

-- ---------- 1. 표 ----------

create table if not exists public.race_ghosts (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ms int not null check (ms > 0),
  character text not null,
  -- { v: 1, day: 'YYYY-MM-DD', char, ms, presses: [[걸음 번호, 0 출발 · 1 점프 · 2 슬라이딩], …] }
  ghost jsonb not null,
  created_at timestamptz not null default now(),
  primary key (day, user_id)
);
alter table public.race_ghosts enable row level security;
-- 정책 없음: 직접 읽기·쓰기는 막고, 아래 함수로만.
revoke all on public.race_ghosts from anon, authenticated;

-- ---------- 2. 넣기 ----------

-- 오늘의 도전 판을 완주하고 race_daily_submit 이 받은 뒤에 부른다 (race_runs 는 1시간 뒤 지워지므로 도착 직후에).
-- → { saved, ms }   saved: 이번 것으로 바뀌었는가 (그날 내 고스트보다 느리면 false)
create or replace function public.race_ghost_submit(p_room_key text, p_round int, p_ghost jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  run public.race_runs;
  ch text;
  e jsonb;
  step numeric;
  prev numeric := 0;
  n int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_ghost is null or jsonb_typeof(p_ghost) <> 'object' then raise exception 'bad ghost'; end if;
  if octet_length(p_ghost::text) > 8192 then raise exception 'too big'; end if;

  -- 내 판이고, 오늘의 도전 기록으로 들어간 판 (083 race_daily_submit 이 daily_day 를 적는다)
  select * into run from public.race_runs where room_key = p_room_key and round = p_round and user_id = me;
  if not found then raise exception 'no run'; end if;
  if run.daily_day is null then raise exception 'not daily'; end if;

  if p_ghost->'v' is distinct from '1'::jsonb then raise exception 'bad ghost'; end if;
  if jsonb_typeof(p_ghost->'day') is distinct from 'string' or p_ghost->>'day' <> to_char(run.daily_day, 'YYYY-MM-DD') then
    raise exception 'bad day';
  end if;
  if jsonb_typeof(p_ghost->'ms') is distinct from 'number' or (p_ghost->>'ms')::numeric <> run.time_ms then raise exception 'bad time'; end if;
  ch := p_ghost->>'char';
  if jsonb_typeof(p_ghost->'char') is distinct from 'string' or not (ch = any (public._character_ids())) then raise exception 'bad character'; end if;

  -- 누름 목록: 1~200개, [정수 걸음 번호(1~10800, 오름차순), 0·1·2]
  if jsonb_typeof(p_ghost->'presses') is distinct from 'array' or jsonb_array_length(p_ghost->'presses') = 0 then raise exception 'bad ghost'; end if;
  if jsonb_array_length(p_ghost->'presses') > 200 then raise exception 'too many'; end if;
  for e in select value from jsonb_array_elements(p_ghost->'presses') loop
    if jsonb_typeof(e) <> 'array' then raise exception 'bad ghost'; end if;
    if jsonb_array_length(e) <> 2 or jsonb_typeof(e->0) <> 'number' or jsonb_typeof(e->1) <> 'number' then raise exception 'bad ghost'; end if;
    step := (e->>0)::numeric;
    if step <> trunc(step) or step <= prev or step > 10800 then raise exception 'bad ghost'; end if;
    if (e->>1) not in ('0', '1', '2') then raise exception 'bad ghost'; end if;
    prev := step;
  end loop;

  -- 그날 내 고스트보다 빠를 때만 바꾼다 (남는 칸은 버리고 다시 만든다)
  insert into public.race_ghosts as g (day, user_id, ms, character, ghost)
    values (run.daily_day, me, run.time_ms, ch,
      jsonb_build_object('v', 1, 'day', to_char(run.daily_day, 'YYYY-MM-DD'), 'char', ch, 'ms', run.time_ms, 'presses', p_ghost->'presses'))
  on conflict (day, user_id) do update set
    ms = excluded.ms, character = excluded.character, ghost = excluded.ghost, created_at = now()
  where excluded.ms < g.ms;
  get diagnostics n = row_count;

  -- 7일 지난 고스트 정리
  delete from public.race_ghosts where day < public._daily_day() - 7;

  return jsonb_build_object('saved', n > 0, 'ms', run.time_ms);
end $$;
revoke all on function public.race_ghost_submit(text, int, jsonb) from public, anon;
grant execute on function public.race_ghost_submit(text, int, jsonb) to authenticated;

-- ---------- 3. 읽기 ----------

-- 그날 1위의 고스트. 순서는 082 daily_ranking 과 같다 (score desc, best_at asc, user_id).
-- 1위의 고스트가 없으면 고스트가 있는 사람 중 그날 순위가 가장 높은 사람. 아무도 없으면 null.
-- → { ghost, nickname, character, ms, place(역대 race_ranking 순위, 없으면 null), day_place(그날 순위: daily_ranking 의 place 와 같은 rank), me }
create or replace function public.race_ghost_top(p_day text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  d date;
  res jsonb;
begin
  if me is null then raise exception 'need login'; end if;
  if p_day is null or p_day !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad day'; end if;
  begin
    d := p_day::date;
  exception when others then
    raise exception 'bad day';
  end;
  if d > public._daily_day() or d < public._daily_day() - 7 then raise exception 'bad day'; end if;

  with ranked as (
    select s.user_id, p.nickname,
      rank() over (order by s.score desc) as place,
      row_number() over (order by s.score desc, s.best_at asc, s.user_id) as rn
    from public.daily_scores s join public.profiles p on p.id = s.user_id
    where s.game = 'running' and s.day = d
  )
  select jsonb_build_object('ghost', g.ghost, 'nickname', r.nickname, 'character', g.character, 'ms', g.ms,
      'place', rr.place, 'day_place', r.place, 'me', r.user_id = me)
    into res
  from ranked r
  join public.race_ghosts g on g.day = d and g.user_id = r.user_id
  left join public.race_ranking rr on rr.user_id = r.user_id
  order by r.rn
  limit 1;
  return res;
end $$;
revoke all on function public.race_ghost_top(text) from public, anon;
grant execute on function public.race_ghost_top(text) to authenticated;
