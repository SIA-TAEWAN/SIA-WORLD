/**
 * 전투 기준 값 (PRD '전투와 조작'). 길이는 맵 좌표(px), 시간은 초.
 * 밸런스 숫자는 초안이다 — 6·10단계(npm run pace, 실제 플레이)에서 맞춘다.
 */

/** 고정 간격 (1/60초) */
export const STEP = 1 / 60;
/** 타일 한 칸 */
export const TILE = 60;
/** 맵 너비 (칸). 화면(720px = 12칸)보다 넓어서 좌우로 조금 움직인다 */
export const MAP_W = 16;

export const PLAYER_R = 20;

/** 구르기: 짧게 밀려나며 잠깐 무적, 대기 1초 */
export const ROLL = { time: 0.28, dist: 200, cd: 1, invuln: 0.36 };
/** 맞은 뒤 잠깐 무적 (한꺼번에 여러 번 맞지 않게) */
export const HURT_INVULN = 0.35;
/** 물약 공통 대기 */
export const POTION_CD = 3;
/** 마력이 저절로 차는 양 (초당, 최대 마력의 비율) */
export const MP_REGEN = 0.03;
export const CRIT_MUL = 1.5;
/** 마력이 모자랄 때 부채 기본 공격의 피해 배율 (스킬을 쓰면 마력이 늘 바닥이라, 너무 낮으면 부채만 약해진다) */
export const NO_MP_MUL = 0.8;
/** 조준 보정: 바라보는 쪽 ±half 안에서 가장 가까운 요괴를 향한다 */
export const AIM_HALF = 1.05;
/** 요괴 무리가 깨어나는 거리 */
export const WAKE_DIST = 430;
/** 출구가 열리는 처치 비율 (보스 맵은 보스를 잡아야 열린다) */
export const EXIT_KILL_RATIO = 0.7;
/** 물(느려지는 땅) 위의 이동 배율 */
export const SLOW_TILE_MUL = 0.6;
/**
 * 지형 환경 효과 (PRD '캐릭터 — 지형 특성 대응'). 막는 대원(regions.ts 의 counter)은 영향을 받지 않고, 레어 방어구 '수호'는 절반만 받는다.
 * - mud  (2지형): 진흙탕(~) 위에서는 더 느려지고(이동 ×slow) 구르기 거리가 줄어든다(×roll)
 * - wind (3지형): every 초마다 골바람이 dur 초 동안 한쪽(좌우 번갈아)으로 초당 push 만큼 민다. warn 초 전에 알린다
 * - dark   (4지형): 대원에게서 see 보다 먼 요괴는 보이지 않고 조준 보정도 안 된다 (수호 갑옷은 두 배 멀리 본다)
 * - water  (5지형): 물(~) 위에 서 있으면 물살이 아래(시작 쪽)로 초당 push 만큼 민다
 * - poison (6지형): 늪(~) 위에 서 있으면 tick 초마다 최대 체력의 pct 만큼 독 피해 (방어 무시)
 * - arrow  (7지형): every 초마다 화살 n 발이 대원 둘레(spread)에 떨어진다 (원 반지름 r, 예고 warn 초, 피해 dmg × 요괴 공격 배율)
 * - sleep  (8지형): after 초 넘게 가만히 서 있으면 졸음이 full 초에 걸쳐 쌓여 이동이 × slow 까지 느려진다. 걸으면 wake 초에 걸쳐 깨고 구르면 바로 깬다
 * - slip   (9지형): 멈추면 가던 쪽으로 미끄러진다 (한 간격마다 속도 × keep — 90px 쯤)
 * - glare  (10지형): every 초마다 dur 초 동안 눈이 부셔 see 보다 먼 요괴가 안 보이고 조준이 안 된다. warn 초 전에 알린다
 * - cold   (11지형): 마력이 저절로 차는 양 × regen
 * - fire   (12지형): 불바닥(~)을 밟으면 first 초 뒤부터 tick 초마다 최대 체력의 pct 만큼 화상, 벗어나도 linger 번 더 (방어 무시)
 */
export const ENV = {
  mud: { slow: 0.45, roll: 0.5 },
  wind: { every: 10, warn: 1.5, dur: 2.6, push: 150 },
  dark: { see: 330 },
  water: { push: 65 },
  poison: { tick: 1, pct: 0.025 },
  arrow: { every: 7, warn: 1.2, n: 3, r: 85, spread: 210, gap: 0.15, dmg: 11 },
  sleep: { after: 1, full: 2, slow: 0.5, wake: 1.5 },
  slip: { keep: 0.955 },
  glare: { every: 12, warn: 1.5, dur: 3, see: 190 },
  cold: { regen: 0.65 },
  fire: { tick: 0.5, first: 0.15, pct: 0.015, linger: 2 },
} as const;

/** 10레벨마다 스킬 피해 +8% */
export const skillLevelMul = (level: number) => 1 + 0.08 * Math.floor(Math.max(1, level) / 10);

/** 피해 계산 (PRD): 공격력 × 계수 − 방어, 최소 1 */
export const damageOf = (atk: number, mul: number, def: number, crit: boolean) =>
  Math.max(1, Math.round((atk * mul - def) * (crit ? CRIT_MUL : 1)));
