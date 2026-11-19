/**
 * 보스 (PRD 5장). 공통 뼈대(체력 바·등장 경고·생명 5 감소)는 계산(src/game/sim.ts)이 맡고,
 * 보스마다 다른 것은 특수 행동 하나뿐이다: act = src/game/bosses.ts 의 BOSS_ACTS 열쇠, p = 그 행동의 수치.
 * 새 보스 = 여기에 한 줄 + BOSS_ACTS 에 작은 함수 하나 (+ 그림 public/art/b-<id>.png).
 */
export interface BossDef {
  id: string;
  name: string;
  desc: string;
  hp: number;
  speed: number;
  bounty: number;
  r: number;
  size: number;
  /** 출구에 닿으면 줄어드는 생명 */
  leak: number;
  /** 특수 행동 (BOSS_ACTS 의 열쇠) 과 수치 */
  act: string;
  p: Record<string, number>;
}

export const BOSSES: BossDef[] = [
  {
    id: 'bigDokkaebi', name: '큰 도깨비', desc: '체력이 많고 가끔 빠르게 돌진해요', hp: 2200, speed: 26, bounty: 100, r: 34, size: 128, leak: 5,
    // 돌진: every 초마다 warn 초 동안 멈춰 벼른 뒤 dur 초 동안 mul 배 빠르게 달린다
    act: 'dash', p: { every: 8, warn: 0.9, dur: 1.6, mul: 3.2 },
  },
];

export const BOSS_INDEX: Record<string, number> = Object.fromEntries(BOSSES.map((b, i) => [b.id, i]));
