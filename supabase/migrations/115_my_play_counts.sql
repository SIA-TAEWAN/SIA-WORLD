-- 115: 랭킹 창 탭을 "내가 많이 한 게임" 순서로 — 게임별로 내가 끝낸 판 수
--
-- 판을 끝까지 한 기록은 sia_coin_logs(시아코인을 받은 판: 게임 id · 판 번호, 한 판에 한 줄)에 쌓인다.
-- 15초 안에 이어서 끝낸 판·하루 100개를 넘긴 판은 빠지므로 정확한 판 수가 아니라 "많이 한 순서"를 고르는 데만 쓴다.
-- 게임 id 는 지급할 때 쓴 그대로 (tank · target · race · volleyball · matgo · poker · holdem · blackjack · roulette · survival ·
-- defense · charge · finger · twelve · tower · pang · card). 탭으로 묶는 일(카지노 = poker·holdem·blackjack·roulette)은 shared/ranking-dialog.js 가 한다.
--   my_play_counts() → { "<게임 id>": 판 수, ... }   (로그인 안 했으면 {})

create or replace function public.my_play_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(game, n), '{}'::jsonb)
  from (select game, count(*)::int as n from public.sia_coin_logs where user_id = auth.uid() group by game) t
$$;
revoke all on function public.my_play_counts() from public, anon;
grant execute on function public.my_play_counts() to authenticated;
