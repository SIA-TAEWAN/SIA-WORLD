-- 116: 시아카드배틀 9단계 — 1막 정예 난이도 조정 (games/card/PROGRESS.md '9단계').
--   _card_const('rules') 6 → 7 (RULES_VERSION 7: 정예로 만난 보스의 체력 비율 · 공격 배율을 보스마다 따로).
--   114 의 정의를 그대로 옮기고 rules 값만 바꾼다. 판본이 바뀌면 진행 중인 판은 이어 할 수 없다.
--   다시 정의하는 함수 (마지막 정의는 114_card_tune.sql — 권한 그대로): _card_const

create or replace function public._card_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'rules' then 7            -- RULES_VERSION (run.ts)
    when 'mastery_open' then 5     -- MASTERY_OPEN: 고를 수 있는 가장 높은 숙련 단계 (6~10 잠금)
    when 'coin_acts' then 3        -- COIN_ACTS: 한 판 시아코인 최대
    when 'coin_acts_true' then 4   -- COIN_ACTS_TRUE: 어둑시니까지 깬 판
    when 'max_log' then 30000      -- MAX_LOG: 입력 기록 최대 길이
    when 'score_floor' then 10     -- DAILY_SCORE (오늘의 도전 점수)
    when 'score_elite' then 30
    when 'score_boss' then 100
    when 'cat_need' then 1         -- 고양이: 보통 판 클리어 수
    when 'admin_gold' then 10000   -- ADMIN_START_GOLD (run.ts): 관리자 시험 판 시작 엽전
  end
$$;
revoke all on function public._card_const(text) from public, anon, authenticated;
