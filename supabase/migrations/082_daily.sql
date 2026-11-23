-- 오늘의 도전 공통 틀 (레이스·서바이벌·돌격대·핑거·디펜스)
--   하루(한국 시간) 동안 모두 같은 조건으로 한 게임을 하고, 그날 기록만 따로 순위를 매긴다.
--   조건(시드·맵·캐릭터 등)은 날짜 문자열에서 기기가 똑같이 만든다. 날짜는 기기 시계 대신 daily_today() 로 받는다.
--   기록은 각 게임 마이그레이션(083~087)의 security definer 함수가, 그 게임 서버가 이미 검사한 결과로만 _daily_record 를 부른다.
--   점수는 언제나 "클수록 좋음" (시간이 짧을수록 좋은 게임은 음수 등으로 바꿔 넣는다). detail 은 화면에 보여 줄 값.

create table if not exists public.daily_scores (
  game text not null,
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  score bigint not null,
  detail jsonb not null default '{}'::jsonb,
  run_ref text,
  plays int not null default 1,
  best_at timestamptz not null default now(),
  primary key (game, day, user_id)
);
create index if not exists daily_scores_rank_idx on public.daily_scores (game, day, score desc, best_at);
alter table public.daily_scores enable row level security;
-- 정책 없음: 직접 읽기·쓰기는 막고, 아래 함수로만.
revoke all on public.daily_scores from anon, authenticated;

create or replace function public._daily_games() returns text[]
language sql immutable set search_path = public as $$
  select array['running','survival','charge','finger','defense']::text[];
$$;
revoke all on function public._daily_games() from public, anon, authenticated;

-- 오늘(한국 시간) 날짜
create or replace function public._daily_day() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;
revoke all on function public._daily_day() from public, anon, authenticated;

create or replace function public.daily_today() returns text
language sql stable security definer set search_path = public as $$
  select to_char(public._daily_day(), 'YYYY-MM-DD');
$$;
revoke all on function public.daily_today() from public, anon;
grant execute on function public.daily_today() to authenticated;

-- 기록 넣기 (안쪽 함수). 오늘 기록보다 좋을 때만 점수·detail·best_at 을 바꾸고, 판 수는 늘 센다.
-- p_day 가 null 이면 오늘. 어제 시작한 판이 자정을 넘겨 끝났으면 게임 쪽에서 시작한 날을 넘긴다.
create or replace function public._daily_record(
  p_user uuid, p_game text, p_score bigint, p_detail jsonb, p_ref text, p_day date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d date := coalesce(p_day, public._daily_day());
  old_score bigint;
  improved boolean;
begin
  if p_user is null then raise exception 'need login'; end if;
  if not (p_game = any (public._daily_games())) then raise exception 'bad game'; end if;
  if p_score is null then raise exception 'bad result'; end if;
  if d < public._daily_day() - 1 or d > public._daily_day() then raise exception 'bad day'; end if;

  select score into old_score from public.daily_scores
    where game = p_game and day = d and user_id = p_user for update;
  if not found then
    insert into public.daily_scores (game, day, user_id, score, detail, run_ref)
      values (p_game, d, p_user, p_score, coalesce(p_detail, '{}'::jsonb), p_ref);
    improved := true;
  else
    improved := p_score > old_score;
    update public.daily_scores set
      plays = plays + 1,
      score = case when improved then p_score else score end,
      detail = case when improved then coalesce(p_detail, '{}'::jsonb) else detail end,
      run_ref = case when improved then p_ref else run_ref end,
      best_at = case when improved then now() else best_at end
    where game = p_game and day = d and user_id = p_user;
  end if;
  return jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'improved', improved,
    'best', greatest(p_score, coalesce(old_score, p_score)), 'first', old_score is null);
end;
$$;
revoke all on function public._daily_record(uuid, text, bigint, jsonb, text, date) from public, anon, authenticated;

-- 오늘(또는 지정한 날) 순위: 상위 50명 + 내 기록. 동점은 먼저 달성한 사람.
create or replace function public.daily_ranking(p_game text, p_day text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  d date;
  top jsonb;
  mine jsonb;
  total int;
begin
  if me is null then raise exception 'need login'; end if;
  if not (p_game = any (public._daily_games())) then raise exception 'bad game'; end if;
  d := coalesce(nullif(p_day, '')::date, public._daily_day());
  if d > public._daily_day() or d < public._daily_day() - 30 then raise exception 'bad day'; end if;

  with ranked as (
    select s.user_id, s.score, s.detail, s.plays, p.nickname,
      rank() over (order by s.score desc) as place,
      row_number() over (order by s.score desc, s.best_at asc, s.user_id) as rn
    from public.daily_scores s join public.profiles p on p.id = s.user_id
    where s.game = p_game and s.day = d
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('place', r.place, 'nickname', r.nickname,
      'score', r.score, 'detail', r.detail, 'me', r.user_id = me) order by r.rn)
      from ranked r where r.rn <= 50), '[]'::jsonb),
    (select jsonb_build_object('place', r.place, 'score', r.score, 'detail', r.detail, 'plays', r.plays)
      from ranked r where r.user_id = me),
    (select count(*)::int from ranked)
  into top, mine, total;

  return jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'today', to_char(public._daily_day(), 'YYYY-MM-DD'),
    'top', top, 'mine', mine, 'total', total);
end;
$$;
revoke all on function public.daily_ranking(text, text) from public, anon;
grant execute on function public.daily_ranking(text, text) to authenticated;
