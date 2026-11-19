-- 058: 시아탱크 AI 판의 무승부를 받는다 (056_ai_matches.sql 에 덧붙임)
--   056 에서는 무승부로 끝난 판을 화면이 finish 도 cancel 도 부르지 않아, 열린 채로 남았다가
--   다음 ai_match_start 때 '최소 시간이 지난 버려진 판'으로 보고 패배로 마감됐다.
--   결과 화면의 '무승부는 전적에 기록되지 않아요' 가 사실이 되도록, 무승부 판을 기록·시아코인 없이 마감하는 함수를 둔다.
--   (마감한 판은 finished_at 이 차므로 ai_match_start 가 더는 건드리지 않는다)
-- 056 의 함수·표는 그대로 둔다.

-- 본인의 끝내지 않은 시아탱크 AI 판을 무승부로 마감한다: finished_at = 지금, won = null, counted = false. 전적·시아코인은 그대로.
-- 시간 제한(최소 시간)은 두지 않는다 (기록이 없으므로). 24시간이 넘은 판은 ai_match_finish 처럼 받지 않는다.
-- 없는 판·남의 판 'no match', 끝난 판 'already finished', 24시간 넘은 판 'too late', 배구 판 'no draw' 예외 (ai_match_finish 와 같은 말).
-- → { status: 'draw' }
create or replace function public.ai_match_draw(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz := clock_timestamp(); m public.ai_matches;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 없는 판과 남의 판은 같은 답
  select * into m from public.ai_matches where id = p_id;
  if not found or m.user_id <> me then raise exception 'no match'; end if;
  -- ai_match_start · ai_match_finish 와 같은 순서(잠금 → 행)로 잡는다
  perform pg_advisory_xact_lock(hashtext('ai-match:' || me::text || ':' || m.game));
  select * into m from public.ai_matches where id = p_id for update;
  if not found then raise exception 'no match'; end if;
  if m.finished_at is not null then raise exception 'already finished'; end if;
  -- 배구에는 무승부가 없다
  if m.game <> 'tank' then raise exception 'no draw'; end if;
  if extract(epoch from (t - m.started_at)) > public._ai_match_const('max_sec') then raise exception 'too late'; end if;
  update public.ai_matches set finished_at = t, won = null, counted = false where id = m.id;
  return jsonb_build_object('status', 'draw');
end $$;
revoke all on function public.ai_match_draw(uuid) from public, anon;
grant execute on function public.ai_match_draw(uuid) to authenticated;
