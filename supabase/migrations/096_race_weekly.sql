-- 096: 시아레이스 "주간 랭킹" (오늘의 도전, 083 · 095 위에)
--   한 주 = 한국 시간 월요일 00:00 ~ 일요일 23:59. 그 주에 세운 오늘의 도전 완주 기록 중 가장 빠른 것으로 순위를 매긴다
--   (동률은 먼저 세운 기록이 위). 그냥 race_runs 에 들어온 기록(오늘의 도전이 아닌 판)은 세지 않는다.
--   race_submit · race_daily_submit · race_ghost_submit 은 다시 정의하지 않는다. 대신 트리거 둘:
--     · race_runs.daily_day 가 채워질 때(null → 값, 083 race_daily_submit): 그 날이 속한 주(월요일)의 내 줄을 넣거나, 더 빠를 때만 바꾼다.
--       캐릭터 = 그날 race_ghosts 의 캐릭터(같은 기록일 때), 없으면 race_records.character (2026-11-23 사용자 결정).
--     · race_ghosts 에 넣기/바꾸기(095 race_ghost_submit, race_daily_submit 뒤에 따로 올라온다): 그 고스트의 ms 가
--       그 주 내 best_ms 와 같으면 character 를 고스트 캐릭터로 고친다.
--   4주 지난 줄(그 주 월요일이 이번 주 월요일보다 28일 이상 앞)은 넣을 때마다 지운다 (기본 키가 week 로 시작해 가볍다).
--
--   1. race_weekly                : (주, 사람)마다 그 주 최고 기록 하나. RLS 켜고 정책 없음 (아래 뷰·함수로만).
--   2. race_weekly_ranking (뷰)   : 이번 주만. race_ranking(029) 과 같은 열 (user_id, nickname, best_ms, best_at, character, plays, place, total).
--   3. race_weekly_last_top()     : 지난주 1~3등 (다음 주 동안 '지난주 🥇🥈🥉' 로 보인다).
--   읽기 권한은 race_ranking 과 같다 (anon · authenticated).

-- ---------- 1. 표 ----------

create table if not exists public.race_weekly (
  -- 그 주의 월요일 (한국 날짜)
  week date not null check (extract(isodow from week) = 1),
  user_id uuid not null references auth.users(id) on delete cascade,
  best_ms int not null check (best_ms > 0),
  best_at timestamptz not null default now(),
  character text not null,
  -- 그 주에 오늘의 도전 기록으로 들어간 판 수
  plays int not null default 1 check (plays >= 0),
  primary key (week, user_id)
);
create index if not exists race_weekly_rank_idx on public.race_weekly (week, best_ms, best_at);
alter table public.race_weekly enable row level security;
-- 정책 없음: 직접 읽기·쓰기는 막고, 아래 뷰·함수로만.
revoke all on public.race_weekly from anon, authenticated;

-- 그 날짜가 속한 주의 월요일 (한국 날짜 기준. date_trunc('week') 는 ISO 주: 월요일 시작)
create or replace function public._race_week(p_day date) returns date
language sql immutable as $$
  select date_trunc('week', p_day::timestamp)::date
$$;
revoke all on function public._race_week(date) from public, anon, authenticated;

-- ---------- 2. 트리거: 오늘의 도전 기록이 들어갈 때 ----------

create or replace function public._race_weekly_on_daily() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wk date := public._race_week(new.daily_day);
  ch text;
begin
  -- 그날 고스트가 이 기록과 같으면 그 캐릭터, 아니면 역대 최고 기록의 캐릭터 (race_submit 이 방금 고친 race_records)
  select g.character into ch from public.race_ghosts g
    where g.day = new.daily_day and g.user_id = new.user_id and g.ms = new.time_ms;
  if ch is null then
    select r.character into ch from public.race_records r where r.user_id = new.user_id;
  end if;

  insert into public.race_weekly as w (week, user_id, best_ms, best_at, character, plays)
    values (wk, new.user_id, new.time_ms, now(), coalesce(ch, 'tiger'), 1)
  on conflict (week, user_id) do update set
    plays = w.plays + 1,
    best_at = case when excluded.best_ms < w.best_ms then excluded.best_at else w.best_at end,
    character = case when excluded.best_ms < w.best_ms then excluded.character else w.character end,
    best_ms = least(w.best_ms, excluded.best_ms);

  -- 4주 지난 줄 정리
  delete from public.race_weekly where week <= public._race_week(public._daily_day()) - 28;
  return null;
end $$;
revoke all on function public._race_weekly_on_daily() from public, anon, authenticated;

drop trigger if exists race_runs_weekly on public.race_runs;
create trigger race_runs_weekly
  after update of daily_day on public.race_runs
  for each row
  when (old.daily_day is null and new.daily_day is not null)
  execute function public._race_weekly_on_daily();

-- ---------- 3. 트리거: 고스트가 나중에 올라올 때 ----------

create or replace function public._race_weekly_on_ghost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.race_weekly set character = new.character
    where week = public._race_week(new.day) and user_id = new.user_id and best_ms = new.ms and character is distinct from new.character;
  return null;
end $$;
revoke all on function public._race_weekly_on_ghost() from public, anon, authenticated;

drop trigger if exists race_ghosts_weekly on public.race_ghosts;
create trigger race_ghosts_weekly
  after insert or update on public.race_ghosts
  for each row
  execute function public._race_weekly_on_ghost();

-- ---------- 4. 이번 주 랭킹 ----------

-- 최고 기록 빠른 순, 같으면 먼저 세운 사람이 위 (race_ranking 과 같은 열·같은 순서). 이번 주(한국 시간)만.
-- 뷰 안에서는 _daily_day() 를 부르지 않는다 (뷰가 부르는 함수는 읽는 사람의 권한으로 실행된다: anon 은 그 함수를 못 부른다).
create or replace view public.race_weekly_ranking as
  select w.user_id, p.nickname, w.best_ms, w.best_at, w.character, w.plays,
    (row_number() over (order by w.best_ms asc, w.best_at asc, w.user_id))::int as place,
    (count(*) over ())::int as total,
    w.week
  from public.race_weekly w join public.profiles p on p.id = w.user_id
  where w.week = date_trunc('week', (now() at time zone 'Asia/Seoul'))::date;
revoke all on public.race_weekly_ranking from anon, authenticated;
grant select on public.race_weekly_ranking to anon, authenticated;

-- ---------- 5. 지난주 1~3등 ----------

-- → { today: 'YYYY-MM-DD'(서버의 한국 날짜), week: 이번 주 월요일, last_week: 지난주 월요일,
--     top: [{ place, user_id, nickname, best_ms, character }] (1~3등, 없으면 빈 배열) }
create or replace function public.race_weekly_last_top() returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (select public._daily_day() as today),
  wk as (select today, public._race_week(today) as this_week, public._race_week(today) - 7 as last_week from t),
  ranked as (
    select w.user_id, p.nickname, w.best_ms, w.character,
      row_number() over (order by w.best_ms asc, w.best_at asc, w.user_id) as place
    from public.race_weekly w join public.profiles p on p.id = w.user_id, wk
    where w.week = wk.last_week
  )
  select jsonb_build_object(
    'today', to_char(wk.today, 'YYYY-MM-DD'),
    'week', to_char(wk.this_week, 'YYYY-MM-DD'),
    'last_week', to_char(wk.last_week, 'YYYY-MM-DD'),
    'top', coalesce((select jsonb_agg(jsonb_build_object('place', r.place, 'user_id', r.user_id, 'nickname', r.nickname,
        'best_ms', r.best_ms, 'character', r.character) order by r.place) from ranked r where r.place <= 3), '[]'::jsonb))
  from wk
$$;
revoke all on function public.race_weekly_last_top() from public;
grant execute on function public.race_weekly_last_top() to anon, authenticated;
