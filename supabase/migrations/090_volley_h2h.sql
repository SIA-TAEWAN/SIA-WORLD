-- 090: 시아배구 맞대결 전적 (게임방·결과 화면의 "○○와 7승 4패 · 최근 2연승")
--   volleyball_h2h(p_opponent) : 나와 그 사람 사이의 확정 경기(volleyball_matches.status = 'done')만 센다.
--
-- 세는 방법 (034 _volleyball_finish 가 남기는 winner_id 그대로):
--   · winner_id 가 나 → 내 승, winner_id 가 상대 → 내 패. 그래서 내 승 = 상대의 패 (두 사람이 보는 숫자가 서로 뒤집힌 값).
--   · 'leave'(한쪽이 나가 AI 가 이어받은 경기)에서 남은 사람이 AI 를 이겼으면 남은 사람의 승(= 나간 사람의 패)으로 센다.
--     AI 가 이겼으면 winner_id 가 null 이라 세지 않는다 (사람끼리 가린 승부가 아니다).
--   · 무효(void)·진행 중(pending·live) 경기는 세지 않는다. 보고 하나로 확정됐다가 무효로 되돌려진 경기도 그때부터 빠진다.
--   · AI 연습 판은 ai_matches(056)에 따로 쌓이므로 여기에 들어오지 않는다.
-- 표(volleyball_matches)는 034 그대로 정책 없음 + 권한 없음. 이 함수는 부른 사람(auth.uid())이 들어 있는 경기만 읽는다.

-- 두 사람의 경기를 양쪽 자리 어느 쪽으로든 빨리 찾게 (034 의 left/right 색인은 한 사람 기준)
create index if not exists volleyball_matches_pair_idx on public.volleyball_matches (left_user_id, right_user_id) where status = 'done';

-- → { wins, losses, streak, streak_won }
--   streak: 가장 최근 경기부터 같은 결과가 이어진 판 수 (경기가 없으면 0), streak_won: 그 결과가 내 승인가 (경기가 없으면 null)
create or replace function public.volleyball_h2h(p_opponent uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); w int; l int; last_won boolean; run int;
begin
  if me is null then raise exception 'need login'; end if;
  if p_opponent is null or p_opponent = me then raise exception 'bad opponent'; end if;

  with g as (
    select (m.winner_id = me) as won,
           row_number() over (order by m.done_at desc nulls last, m.id desc) as rn
    from public.volleyball_matches m
    where m.status = 'done'
      and m.winner_id in (me, p_opponent)
      and ((m.left_user_id = me and m.right_user_id = p_opponent)
        or (m.left_user_id = p_opponent and m.right_user_id = me))
  ), head as (
    select won from g where rn = 1
  )
  select (count(*) filter (where g.won))::int,
         (count(*) filter (where not g.won))::int,
         (select won from head),
         -- 가장 최근 결과와 다른 첫 경기 바로 앞까지 (끝까지 같으면 전부)
         coalesce(min(g.rn) filter (where g.won is distinct from (select won from head)) - 1, count(*))::int
    into w, l, last_won, run
  from g;

  return jsonb_build_object('wins', w, 'losses', l, 'streak', run, 'streak_won', last_won);
end $$;
revoke all on function public.volleyball_h2h(uuid) from public, anon;
grant execute on function public.volleyball_h2h(uuid) to authenticated;
