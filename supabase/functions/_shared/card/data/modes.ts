/**
 * 모드·숙련 단계·오늘의 도전 데이터 (PRD [진행·재화]). 값은 사용자 스펙 그대로, 스펙에 없는 것은 '정한 값'.
 * SQL 112_card.sql 의 _card_const 와 같은 값이 있다 (games/card/tests/sql.test.ts 가 대조).
 */

/** 판 모드: 보통(3막 + 숨은 4막) · 끝없는 모드 · 오늘의 도전 */
export const RUN_MODES = ['normal', 'endless', 'daily'] as const;
export type RunMode = (typeof RUN_MODES)[number];

/**
 * 숙련 단계 (영웅별, 한 판을 깨면 다음 단계가 열린다). 누적 — n단계는 1~n 규칙을 모두 쓴다.
 * 이번엔 1~5 만 고를 수 있고(MASTERY_OPEN), 6~10 은 데이터만 있고 잠겨 있다.
 */
export const MASTERY = [
  { lv: 1, text: '정예 체력 +10%' },
  { lv: 2, text: '일반 요괴 공격 +1' },
  { lv: 3, text: '상점 가격 +15%' },
  { lv: 4, text: '쉼터 회복 20%' },
  { lv: 5, text: '막 보스 체력 +10%' },
  { lv: 6, text: '시작 덱에 도깨비 장난 1' },
  { lv: 7, text: '정예 칸 +3%' },
  { lv: 8, text: '전투 엽전 -20%' },
  { lv: 9, text: '보스 승리 회복 25%' },
  { lv: 10, text: '3막 보스가 정예 하나와 함께' },
] as const;
/** 고를 수 있는 가장 높은 숙련 단계 (6~10 은 잠금) */
export const MASTERY_OPEN = 5;
export const MASTERY_MAX = MASTERY.length;
/** 숙련 1: 정예 체력 배수 */
export const MASTERY_ELITE_HP = 1.1;
/** 숙련 2: 일반 전투 요괴 공격 + */
export const MASTERY_NORMAL_ATK = 1;
/** 숙련 3: 상점 가격 배수 */
export const MASTERY_SHOP = 1.15;
/** 숙련 4: 쉼터 회복 (최대 체력 비율, 보통 30%) */
export const REST_HEAL = 0.3;
export const MASTERY_REST_HEAL = 0.2;
/** 숙련 5: 막 보스 체력 배수 */
export const MASTERY_BOSS_HP = 1.1;

/** 끝없는 모드: 3막 뒤 지역 순서 (되풀이) */
export const ENDLESS_REGIONS = ['bamboo', 'field', 'palace', 'underworld'] as const;
/** 끝없는 모드: 막마다 요괴 체력·피해 +15%p (2막부터 더해 쌓임: 1 + 0.15×(막-1) — 11-26 사용자 확정). 백분율 정수 */
export const ENDLESS_STEP_PCT = 15;

/** 시아코인: 막 하나 깰 때마다 1, 한 판 최대 3 (어둑시니까지 4). 오늘의 도전은 없음 */
export const COIN_ACTS = 3;
export const COIN_ACTS_TRUE = 4;

/** 오늘의 도전 점수 = 올라간 칸×10 + 정예×30 + 보스×100 + 남은 체력 */
export const DAILY_SCORE = { floor: 10, elite: 30, boss: 100 } as const;

/** 서버에 보내는 입력 기록의 최대 길이 (그보다 길면 'bad log') */
export const MAX_LOG = 30000;
