import { TOWER_TURNS } from './sim.ts';

/**
 * 끝없는 탑 (PRD "스테이지 구성" 끝없는 탑): 층마다 웨이브 하나, 5층마다 보스.
 * 층 구성은 층 번호만으로 정해진다 (무작위 없음) — 화면과 서버(finger-finish)가 같은 층을 만든다.
 *
 * 5층이 한 묶음이고, 묶음마다 지역을 하나씩 돌아간다 (1~5층 = 1지역, 6~10층 = 2지역 … 56~60층 = 12지역, 61층부터 다시 1지역).
 * 묶음 안의 층은 그 지역 스테이지의 웨이브 하나를 방(장애물)과 요괴 자리 그대로 가져온다:
 *   1층째 = r-1 의 첫 웨이브 · 2층째 = r-2 의 둘째 웨이브 · 3층째 = r-3 의 첫 웨이브 · 4층째 = r-4 의 마지막 웨이브(작은 대장) · 5층째 = r-5 의 마지막 웨이브(지역 보스)
 * 요괴 세기는 스테이지 보정 값 대신 층 번호로 정한다 (위로 갈수록 체력·공격이 오른다).
 */

/** 탑의 층 수 상한 (한 턴에 한 층보다 더 오를 수 없으므로 최대 턴과 같다) */
export const TOWER_FLOORS = TOWER_TURNS;
/** 한 묶음 (마지막 층이 보스) */
export const TOWER_BLOCK = 5;

/** 층 세기: 체력 배율 = HP0 × (1 + HP_STEP × (층 − 1)), 공격 배율 = ATK0 × (1 + ATK_STEP × (층 − 1)) */
export const TOWER_HP0 = 0.3;
export const TOWER_HP_STEP = 0.05;
export const TOWER_ATK0 = 1;
export const TOWER_ATK_STEP = 0.1;

/** 묶음 안 순번 → [스테이지 번호, 가져올 웨이브 번호(0부터)] */
const PICK: [number, number][] = [
  [1, 0],
  [2, 1],
  [3, 0],
  [4, 2],
  [5, 2],
];

export interface TowerFloor {
  /** 층 (1부터) */
  floor: number;
  region: number;
  /** 가져온 스테이지 id · 웨이브 번호 */
  stage: string;
  wave: number;
  /** 5층마다 지역 보스 */
  boss: boolean;
  /** 작은 대장 층 */
  chief: boolean;
  hpMul: number;
  atkMul: number;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function towerFloor(floor: number): TowerFloor {
  const n = Math.max(1, Math.floor(floor));
  const block = Math.floor((n - 1) / TOWER_BLOCK);
  const k = (n - 1) % TOWER_BLOCK;
  const region = (block % 12) + 1;
  const [no, wave] = PICK[k];
  return {
    floor: n,
    region,
    stage: `${region}-${no}`,
    wave,
    boss: k === TOWER_BLOCK - 1,
    chief: k === TOWER_BLOCK - 2,
    hpMul: round3(TOWER_HP0 * (1 + TOWER_HP_STEP * (n - 1))),
    atkMul: round3(TOWER_ATK0 * (1 + TOWER_ATK_STEP * (n - 1))),
  };
}
