// 보스 정의. 그림은 한 장(image), 부술 수 있는 부위는 여기 적은 위치(보스 중심 기준 px)에 판정만 둔다.
// phases: 체력 비율이 until 아래로 내려가면 다음 페이즈 (바뀔 때 화면 탄 제거).
// fire.from = 'core' 이면 몸통에서, 숫자면 그 부위에서 쏜다 (부위가 부서지면 그 탄은 멈춘다 → 패턴이 약해짐).
import type { PatternName } from '../game/patterns';
import PARTS from '../../art/boss-parts.json';

/** 받은 보스 그림 크기 (public/art/boss-<n>.png). 부위 위치(0..1)를 월드 px 로 바꿀 때 쓴다 */
export const ART_SIZE: Record<string, [number, number]> = {
  'boss-1': [480, 520], 'boss-2': [301, 620], 'boss-3': [453, 620], 'boss-5': [474, 620], 'boss-7': [480, 598],
  'boss-8': [480, 566], 'boss-9': [480, 618], 'boss-10': [469, 620], 'boss-11': [480, 464], 'boss-12': [480, 533],
};
/** 그림 안 위치(0..1) → 보스 중심 기준 px (그림을 너비 width 로 그릴 때) */
export function artPoint(art: string, width: number, fx: number, fy: number) {
  const [w, h] = ART_SIZE[art];
  return { x: Math.round((fx - 0.5) * width), y: Math.round((fy - 0.5) * width * (h / w)) };
}
function artPart(art: string, width: number, i: number) {
  const p = (PARTS as unknown as Record<string, { x: number; y: number }[]>)[art][i];
  return artPoint(art, width, p.x, p.y);
}

export interface PartDef { x: number; y: number; r: number; hp: number }
export interface FireDef { pattern: PatternName; every: number; from: 'core' | number; delay?: number }
export interface PhaseDef { until: number; move: 'sway' | 'still' | 'figure8'; fire: FireDef[] }
export interface BossDef {
  id: string;
  name: string;
  kind: 'mid' | 'stage';
  /** 그림 이름 (public/art/<image>.png). 못 읽으면 코드 그림 'bossCode' */
  image: string;
  /** 그림 너비 (월드 px) */
  width: number;
  /** 몸통 판정 원 (중심 기준) */
  core: { x: number; y: number; r: number };
  hp: number;
  /** 머무는 높이 */
  restY: number;
  /** 제한 시간 (초) — 넘기면 도망간다 */
  time: number;
  parts: PartDef[];
  phases: PhaseDef[];
}

export const PART_SCORE = 5000;
export const MID_SCORE = 10000;
export const BOSS_SCORE_PER_STAGE = 50000;

export const BOSSES: Record<string, BossDef> = {
  // 1스테이지 중간 보스: 요괴 수송선 (큰 도깨비가 탄 크림 비행선)
  transport: {
    id: 'transport', name: '요괴 수송선', kind: 'mid', image: 'mid-transport', width: 300,
    core: { x: 0, y: -10, r: 70 }, hp: 260, restY: 330, time: 40,
    parts: [{ x: -110, y: 50, r: 30, hp: 60 }, { x: 110, y: 50, r: 30, hp: 60 }],
    phases: [
      { until: 0.5, move: 'sway', fire: [{ pattern: 'aim3', every: 70, from: 0 }, { pattern: 'aim3', every: 70, from: 1, delay: 35 }] },
      { until: 0, move: 'sway', fire: [{ pattern: 'ring16', every: 80, from: 'core' }, { pattern: 'aim1', every: 40, from: 0 }, { pattern: 'aim1', every: 40, from: 1, delay: 20 }] },
    ],
  },
  // 1스테이지 보스: 거대 게 전함 (튜토리얼: 느린 탄). 그림 boss-1 (480×520) — 부위·핵 위치는 art/boss-parts.json
  crab: {
    id: 'crab', name: '거대 게 전함', kind: 'stage', image: 'boss-1', width: 460,
    core: { ...artPoint('boss-1', 460, 0.5, 0.42), r: 115 }, hp: 900, restY: 380, time: 90,
    parts: [
      { ...artPart('boss-1', 460, 0), r: 38, hp: 120 },
      { ...artPart('boss-1', 460, 1), r: 38, hp: 120 },
      { ...artPart('boss-1', 460, 2), r: 42, hp: 150 },
      { ...artPart('boss-1', 460, 3), r: 42, hp: 150 },
    ],
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'aim3', every: 80, from: 2 }, { pattern: 'aim3', every: 80, from: 3, delay: 40 }, { pattern: 'ring16', every: 140, from: 'core' },
      ] },
      { until: 0.33, move: 'figure8', fire: [
        { pattern: 'clawFan', every: 54, from: 2 }, { pattern: 'clawFan', every: 54, from: 3, delay: 27 },
        { pattern: 'aim1', every: 30, from: 0 }, { pattern: 'aim1', every: 30, from: 1, delay: 15 },
      ] },
      { until: 0, move: 'sway', fire: [
        { pattern: 'spiral4', every: 10, from: 'core' }, { pattern: 'aim3', every: 70, from: 2 }, { pattern: 'aim3', every: 70, from: 3, delay: 35 },
      ] },
    ],
  },
};
