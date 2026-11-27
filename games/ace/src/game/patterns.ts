// 이름 붙은 탄막 패턴. 스테이지 데이터(waves)는 이 이름만 적는다.
// 기본 함수(aimed · nway · ring · spiral · laser)를 조합해 이름 붙은 패턴을 만든다.
// 속도는 "보통" 기준이고, 실제 속도는 Sim.addBullet 이 난이도 배율(speedMul)을 곱한다.
import type { Sim } from './sim';

/** 기체 기본샷 (청룡호: 전방 집중 발칸). main[파워-1] = 한 번에 나가는 탄들 */
export const FIRE = {
  every: 4,
  speed: 30,
  optDmg: 1,
  main: [
    [{ x: -9, vx: 0, dmg: 1 }, { x: 9, vx: 0, dmg: 1 }],
    [{ x: -16, vx: 0, dmg: 1 }, { x: 0, vx: 0, dmg: 1 }, { x: 16, vx: 0, dmg: 1 }],
    [{ x: -24, vx: -0.6, dmg: 1 }, { x: -8, vx: 0, dmg: 1 }, { x: 8, vx: 0, dmg: 1 }, { x: 24, vx: 0.6, dmg: 1 }],
    [{ x: -30, vx: -1.4, dmg: 1 }, { x: -15, vx: -0.4, dmg: 1 }, { x: 0, vx: 0, dmg: 1 }, { x: 15, vx: 0.4, dmg: 1 }, { x: 30, vx: 1.4, dmg: 1 }],
  ],
};

// ---------------- 기본 함수 ----------------
/** 조준탄: 기체를 향해 한 발 */
export function aimed(sim: Sim, x: number, y: number, speed: number, big = false) {
  const a = Math.atan2(sim.py - y, sim.px - x);
  sim.addBullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, big);
}

/** n-way: 기준 각도(없으면 기체 방향)를 가운데로 부채꼴 n발 */
export function nway(sim: Sim, x: number, y: number, speed: number, n: number, spread: number, angle?: number, big = false) {
  const base = angle ?? Math.atan2(sim.py - y, sim.px - x);
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? base : base - spread / 2 + (spread * i) / (n - 1);
    sim.addBullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, big);
  }
}

/** 원형: 360도로 n발 */
export function ring(sim: Sim, x: number, y: number, speed: number, n: number, offset = 0, big = false) {
  for (let i = 0; i < n; i++) {
    const a = offset + (Math.PI * 2 * i) / n;
    sim.addBullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, big);
  }
}

/** 나선: 시간(t)에 따라 돌아가는 팔 arms 개 */
export function spiral(sim: Sim, x: number, y: number, speed: number, arms: number, t: number, turn = 0.18) {
  ring(sim, x, y, speed, arms, t * turn);
}

/** 레이저 (임시): 기체 방향으로 촘촘한 탄 한 줄. M2 에서 예고선 + 판정 띠로 바꾼다 */
export function laser(sim: Sim, x: number, y: number, speed: number, len = 10) {
  const a = Math.atan2(sim.py - y, sim.px - x);
  for (let i = 0; i < len; i++) {
    const s = speed + i * 0.35;
    sim.addBullet(x, y, Math.cos(a) * s, Math.sin(a) * s);
  }
}

// ---------------- 이름 붙은 패턴 ----------------
export const PATTERNS = {
  /** 소형기: 느린 조준탄 한 발 */
  aim1: (sim: Sim, x: number, y: number) => aimed(sim, x, y, 4.2),
  /** 중형기: 조준 3-way */
  aim3: (sim: Sim, x: number, y: number) => nway(sim, x, y, 4.6, 3, 0.5),
  /** 중형기: 원형 16발 (번갈아 반 칸 비켜 쏜다) */
  ring16: (sim: Sim, x: number, y: number, t: number) => ring(sim, x, y, 3.6, 16, (Math.floor(t / 90) % 2) * (Math.PI / 16), true),
  /** 중형기: 조준 3-way 와 원형을 번갈아 */
  medMix: (sim: Sim, x: number, y: number, t: number) => {
    if (Math.floor(t / 10) % 2) ring(sim, x, y, 3.4, 14, t * 0.1, true);
    else nway(sim, x, y, 5, 5, 0.7);
  },
  spiral4: (sim: Sim, x: number, y: number, t: number) => spiral(sim, x, y, 3.4, 4, t),
  laser: (sim: Sim, x: number, y: number) => laser(sim, x, y, 7),
  /** 게 집게: 아래로 넓게 퍼지는 7-way */
  clawFan: (sim: Sim, x: number, y: number) => nway(sim, x, y, 3.8, 7, 1.3, Math.PI / 2),
} satisfies Record<string, (sim: Sim, x: number, y: number, t: number) => void>;

export type PatternName = keyof typeof PATTERNS;
