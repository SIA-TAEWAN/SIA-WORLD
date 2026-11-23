-- 083: 시아레이스 "오늘의 도전" (공통 틀은 082_daily.sql)
--   오늘의 트랙: 날짜 시드로 만든 방해물 배치를 혼자(+AI 3명) 달린다. 점수 = -완주 ms (빠를수록 좋음), detail = { ms }.
--   기록은 race_submit(최신 정의 072_cat_versus.sql)이 이미 검사해 race_runs 에 남긴 완주 기록만 쓴다:
--     · 내가 연 판(race_rounds.created_by)이고, 오늘의 도전 전용 방(room_key 가 'daily' 로 시작)이며
--     · 내 완주 기록(race_runs)이 있고, 그 판에 다른 사람의 기록이 없어야 한다 (방에서 같이 달린 판은 오늘의 도전이 아니다)
--     · 같은 판은 한 번만 (race_runs.daily_day 에 넣은 날을 적는다)
--   race_submit · race_go 는 다시 정의하지 않는다.
--   못 끝낸 판(미완주·실격·끊김)은 race_runs 에 없으므로 기록도 없다.
--   race_rounds 는 1시간 뒤 지워지고 race_runs 도 함께 지워진다(029). 그래서 도착 직후에 넣는다.

alter table public.race_runs add column if not exists daily_day date;

-- p_day: 기기가 트랙을 만든 날짜 'YYYY-MM-DD' (없으면 그 판이 GO 한 날).
--        자정을 넘겨 달린 판을 위해 GO 한 날 또는 그 전날만 받는다.
-- → { day, improved, best, first, ms }   (best 는 점수 = -ms)
create or replace function public.race_daily_submit(p_room_key text, p_round int, p_day text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  rd public.race_rounds;
  ms int;
  go_day date;
  d date;
  n int;
  res jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_room_key is null or p_room_key !~ '^daily[a-z0-9]{4,19}$' then raise exception 'not daily'; end if;
  select * into rd from public.race_rounds where room_key = p_room_key and round = p_round;
  if not found then raise exception 'no round'; end if;
  if rd.created_by <> me then raise exception 'not yours'; end if;

  go_day := (rd.go_at at time zone 'Asia/Seoul')::date;
  begin
    d := coalesce(nullif(p_day, '')::date, go_day);
  exception when others then raise exception 'bad day';
  end;
  if d > go_day or d < go_day - 1 then raise exception 'bad day'; end if;

  -- 혼자 달린 판만
  if exists (select 1 from public.race_runs where room_key = p_room_key and round = p_round and user_id <> me) then
    raise exception 'not solo';
  end if;

  -- 내 완주 기록 (race_submit 이 시각을 검사해 넣은 것). 같은 판은 한 번만
  update public.race_runs set daily_day = d
    where room_key = p_room_key and round = p_round and user_id = me and daily_day is null
    returning time_ms into ms;
  get diagnostics n = row_count;
  if n = 0 then
    if exists (select 1 from public.race_runs where room_key = p_room_key and round = p_round and user_id = me) then
      raise exception 'already submitted';
    end if;
    raise exception 'no run';
  end if;

  res := public._daily_record(me, 'running', -ms::bigint, jsonb_build_object('ms', ms), p_room_key || ':' || p_round, d);
  return res || jsonb_build_object('ms', ms);
end $$;
revoke all on function public.race_daily_submit(text, int, text) from public, anon;
grant execute on function public.race_daily_submit(text, int, text) to authenticated;
