/** 시아레이스 규칙 값 (PRD). 길이는 m, 시간은 초, 속도는 m/s */

/** 계산 한 걸음 (고정 시간 간격) */
export const DT = 1 / 120;

/** 트랙 길이: 그냥 달리면 약 30초 (150m ÷ 5 m/s) */
export const TRACK_LEN = 150;
export const LANES = 4;

/** 최고 속도와 가속 (정지 → 최고 속도 0.4초) */
export const TOP_SPEED = 5;
export const ACCEL_TIME = 0.4;
export const ACCEL = TOP_SPEED / ACCEL_TIME;

/** 점프: 체공 0.6초, 뛰는 순간의 속도 유지 (5 m/s면 3m) */
export const JUMP_TIME = 0.6;
/** 화면에 그릴 점프 높이 (m) */
export const JUMP_HEIGHT = 0.9;

/** 슬라이딩: 0.6초 동안 몸을 낮추고 누르는 순간의 속도로 미끄러진다 (가속은 멈춘다). 슬라이딩 중 재슬라이딩·점프 불가 */
export const SLIDE_TIME = 0.6;

/** 진흙: 밟는 동안 20% 감속 */
export const MUD_FACTOR = 0.8;
export const MUD_SHORT_LEN = 2;
export const MUD_LONG_LEN = 5;

/** 넘어짐·미끄러짐으로 멈추는 시간 */
export const HURDLE_STUN = 0.8;
export const BANANA_STUN = 0.6;
export const LOG_STUN = 1.0;
/** 낮은 막대(머리 높이): 슬라이딩으로만 지나간다. 서서 달리거나 점프하면 부딪혀 넘어진다 */
export const BAR_STUN = 0.8;
/** 일어난 뒤 같은 방해물에 다시 걸리지 않는 시간 */
export const IMMUNE_TIME = 0.5;

/** 통나무: 달리는 쪽으로 초속 2m로 굴러온다. 주자가 이 거리 안에 오면 구르기 시작 */
export const LOG_SPEED = 2;
export const LOG_TRIGGER = 9;
/** 주자를 지나 이만큼 뒤로 가면 사라진다 */
export const LOG_GONE = 4;

/** 부스트 발판: 1.5초간 30% 빨라짐 */
export const BOOST_FACTOR = 1.3;
export const BOOST_TIME = 1.5;
export const BOOST_LEN = 1;

/** 방해물 크기 (닿는 범위, m) */
export const HURDLE_LEN = 0.3;
export const BANANA_LEN = 0.4;
export const LOG_LEN = 0.6;
export const BAR_LEN = 0.3;

/** 배치 규칙: 출발 10m·도착 전 5m에는 없음, 방해물 사이 최소 6m */
export const SAFE_START = 10;
export const SAFE_END = 5;
export const MIN_GAP = 6;

/** 판마다 놓는 개수 (합 18: 150m 트랙). 통나무는 화면·동기화가 하나만 다루므로 1개 */
export const OBSTACLE_COUNTS = { mudShort: 2, mudLong: 1, hurdle: 5, banana: 3, log: 1, boost: 3, bar: 3 } as const;

/** 경기 끝: 1등 도착 뒤 15초 또는 출발(GO) 뒤 90초 */
export const END_AFTER_FIRST = 15;
export const END_AFTER_GO = 90;

/** AI: 방해물마다 점프(낮은 막대는 슬라이딩) 성공 확률, 출발 반응, 도착 시간 범위 */
export const AI_SUCCESS = 0.75;
export const AI_REACT_MIN = 0.2;
export const AI_REACT_MAX = 0.5;
export const AI_FINISH_MIN = 33;
export const AI_FINISH_MAX = 37.5;

/** 등급 기준 (ms 이내). 임시 값 — shared/ranking-dialog.js 의 RACE_TIERS 와 같이 고친다 */
export const TIER_SUN_MS = 30750;
export const TIER_MOON_MS = 33000;
export const TIER_STAR_MS = 37500;

/** 서버가 받아 주는 가장 빠른 기록 (supabase/migrations/031_race_150m.sql 의 min_ms) */
export const MIN_VALID_MS = 28000;

/** 위치 전송 간격 (초당 10회) */
export const NET_INTERVAL_MS = 100;

export const ZODIAC_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;
export type ZodiacId = (typeof ZODIAC_IDS)[number];
export const ZODIAC_NICK: Record<ZodiacId, string> = {
  rat: '찍찍이', ox: '우직이', tiger: '어흥이', rabbit: '깡총이', dragon: '여의룡', snake: '스르르',
  horse: '따각이', sheep: '몽실이', monkey: '재롱이', rooster: '꼬꼬댁', dog: '멍뭉이', pig: '꿀꿀이',
};
