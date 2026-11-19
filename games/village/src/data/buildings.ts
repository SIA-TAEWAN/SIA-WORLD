import type { ResId } from './balance';

/**
 * 건물 (PRD 5장). 지금은 1~3단계 범위의 다섯 가지만 있다 — 나머지는 해당 단계에서 더한다.
 * SQL 의 _village_types 와 같아야 한다 (tests/sql.test.ts).
 */
export type BuildingType = 'hall' | 'paddy' | 'house' | 'lumber' | 'storage';

export interface BuildingDef {
  id: BuildingType;
  name: string;
  desc: string;
  /** 차지하는 칸 */
  w: number;
  h: number;
  /** 짓는 값 (업그레이드 값의 기준이기도 하다) */
  rice: number;
  wood: number;
  /** 짓는 시간 (초) */
  buildSec: number;
  /** 만드는 자원과 레벨 1의 시간당 생산량 (생산 건물이 아니면 null · 0) */
  product: ResId | null;
  rate: number;
  /** 다 지었을 때의 경험치 */
  buildExp: number;
  /** n번째 건물이 열리는 마을 레벨 (길이 = 지을 수 있는 최대 개수) */
  unlock: number[];
}

export const BUILDINGS: BuildingDef[] = [
  { id: 'hall', name: '마을 회관', desc: '마을의 중심. 레벨을 올리면 다른 건물의 최대 레벨과 창고 용량이 늘어요', w: 2, h: 2, rice: 40, wood: 40, buildSec: 0, product: null, rate: 0, buildExp: 0, unlock: [1] },
  { id: 'paddy', name: '논', desc: '쌀을 만들어요', w: 1, h: 1, rice: 5, wood: 10, buildSec: 10, product: 'rice', rate: 60, buildExp: 10, unlock: [1, 1, 3, 5, 7, 10, 13, 17] },
  { id: 'house', name: '주민 집', desc: '주민 한 명이 살 집. 지으면 십이지가 이사 와요', w: 1, h: 1, rice: 10, wood: 20, buildSec: 30, product: null, rate: 0, buildExp: 15, unlock: [1, 2, 3, 5, 7, 9, 11, 13, 15, 18, 21, 24] },
  { id: 'lumber', name: '벌목장', desc: '나무를 만들어요', w: 1, h: 1, rice: 30, wood: 10, buildSec: 20, product: 'wood', rate: 40, buildExp: 12, unlock: [2, 2, 4, 6, 8, 11, 14, 18] },
  { id: 'storage', name: '창고', desc: '쌀·나무·돌·떡을 더 많이 보관해요', w: 1, h: 1, rice: 30, wood: 40, buildSec: 60, product: null, rate: 0, buildExp: 20, unlock: [2, 4, 7, 10, 14, 18] },
];

export const BUILDING: Record<BuildingType, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b])) as Record<BuildingType, BuildingDef>;
export const isBuildingType = (t: unknown): t is BuildingType => typeof t === 'string' && Object.prototype.hasOwnProperty.call(BUILDING, t);
