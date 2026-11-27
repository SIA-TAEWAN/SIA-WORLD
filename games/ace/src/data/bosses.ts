// 보스 정의. 그림은 한 장(image), 부술 수 있는 부위는 여기 적은 위치(보스 중심 기준 px)에 판정만 둔다.
// phases: 체력 비율이 until 아래로 내려가면 다음 페이즈 (바뀔 때 화면 탄 제거).
// fire.from = 'core' 이면 몸통에서, 숫자면 그 부위에서 쏜다 (부위가 부서지면 그 탄은 멈춘다 → 패턴이 약해짐).
//
// 그림 두 가지:
//  - 받은 보스 그림 (public/art/boss-<n>.png, SpriteCook): 부위·핵 위치는 art/boss-parts.json → artPoint/artPart
//  - 코드 몸체(hull) + 기존 요괴 그림(rider, public/art/rider-<이름>.png): 중간 보스 · 구미호 · 이무기. 포문 2개는 hullParts
import type { PatternName } from '../game/patterns';
import PARTS from '../../art/boss-parts.json';

export interface PartDef { x: number; y: number; r: number; hp: number }
export interface FireDef { pattern: PatternName; every: number; from: 'core' | number; delay?: number }
export interface PhaseDef { until: number; move: 'sway' | 'still' | 'figure8'; fire: FireDef[] }
export type HullKind = 'airship' | 'kite' | 'cloud' | 'flower' | 'fort';
export interface BossDef {
  id: string;
  name: string;
  kind: 'mid' | 'stage';
  /** 받은 그림 이름 (public/art/<image>.png). hull 이 있으면 쓰지 않는다 */
  image: string;
  /** 코드로 그리는 몸체 + 그 위에 탄 요괴 */
  hull?: HullKind;
  rider?: string;
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
/** 코드 몸체 높이 = 너비 × 0.8 */
export const HULL_ASPECT = 0.8;

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
function artCore(art: string, width: number, r: number) {
  const c = (PARTS as unknown as { _core: Record<string, { x: number; y: number }> })._core[art];
  return { ...artPoint(art, width, c.x, c.y), r };
}
/** 코드 몸체의 양쪽 포문 2개 (art.ts 의 drawHull 과 같은 자리) */
function hullParts(width: number, hp: number): PartDef[] {
  const y = Math.round(width * HULL_ASPECT * 0.24);
  return [{ x: -Math.round(width * 0.37), y, r: 30, hp }, { x: Math.round(width * 0.37), y, r: 30, hp }];
}
/** 중간 보스 (코드 몸체 + 기존 요괴): 40초, 두 페이즈 */
function mid(id: string, name: string, hull: HullKind, rider: string, hp: number, p1: FireDef[], p2: FireDef[]): BossDef {
  const width = 300;
  return {
    id, name, kind: 'mid', image: '', hull, rider, width, core: { x: 0, y: -24, r: 72 }, hp, restY: 330, time: 40,
    parts: hullParts(width, Math.round(hp * 0.22)),
    phases: [{ until: 0.5, move: 'sway', fire: p1 }, { until: 0, move: 'sway', fire: p2 }],
  };
}

export const BOSSES: Record<string, BossDef> = {
  // ---------- 1 해안 마을 ----------
  transport: mid('transport', '요괴 수송선', 'airship', 'bigDokkaebi', 260,
    [{ pattern: 'aim3', every: 70, from: 0 }, { pattern: 'aim3', every: 70, from: 1, delay: 35 }],
    [{ pattern: 'ring16', every: 80, from: 'core' }, { pattern: 'aim1', every: 40, from: 0 }, { pattern: 'aim1', every: 40, from: 1, delay: 20 }]),
  // 거대 게 전함 (튜토리얼: 느린 탄)
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

  // ---------- 2 넓은 바다 ----------
  diver: mid('diver', '잠수 요괴', 'fort', 'dueoksini', 340,
    [{ pattern: 'rise8', every: 60, from: 'core' }, { pattern: 'aim3', every: 80, from: 0 }, { pattern: 'aim3', every: 80, from: 1, delay: 40 }],
    [{ pattern: 'ring16', every: 70, from: 'core' }, { pattern: 'aim5', every: 60, from: 0 }, { pattern: 'aim5', every: 60, from: 1, delay: 30 }]),
  // 해룡 항모: 세로로 긴 그림 (갑판 포대 3)
  carrier: {
    id: 'carrier', name: '해룡 항모', kind: 'stage', image: 'boss-2', width: 280,
    core: artCore('boss-2', 280, 70), hp: 1250, restY: 330, time: 90,
    parts: [0, 1, 2].map(i => ({ ...artPart('boss-2', 280, i), r: 34, hp: 160 })),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'aim3', every: 60, from: 0 }, { pattern: 'fan9', every: 90, from: 2 }, { pattern: 'rise8', every: 50, from: 1, delay: 25 },
      ] },
      { until: 0.33, move: 'sway', fire: [
        { pattern: 'ring16', every: 60, from: 'core' }, { pattern: 'aim5', every: 50, from: 0 }, { pattern: 'aim5', every: 50, from: 2, delay: 25 },
      ] },
      { until: 0, move: 'figure8', fire: [
        { pattern: 'spiral4', every: 8, from: 'core' }, { pattern: 'bigAim', every: 40, from: 1 },
      ] },
    ],
  },

  // ---------- 3 대나무 숲 ----------
  kites: mid('kites', '연 요괴 편대', 'kite', 'yagwanggwi', 420,
    [{ pattern: 'fan9', every: 70, from: 'core' }, { pattern: 'aim1', every: 30, from: 0 }, { pattern: 'aim1', every: 30, from: 1, delay: 15 }],
    [{ pattern: 'medMix', every: 40, from: 'core' }, { pattern: 'aim3', every: 50, from: 0 }, { pattern: 'aim3', every: 50, from: 1, delay: 25 }]),
  // 천년 너구리 (대나무 포 2)
  tanuki: {
    id: 'tanuki', name: '천년 너구리', kind: 'stage', image: 'boss-3', width: 420,
    core: artCore('boss-3', 420, 80), hp: 1550, restY: 360, time: 90,
    parts: [0, 1].map(i => ({ ...artPart('boss-3', 420, i), r: 44, hp: 220 })),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'aim5', every: 70, from: 0 }, { pattern: 'aim5', every: 70, from: 1, delay: 35 }, { pattern: 'ring16', every: 120, from: 'core' },
      ] },
      { until: 0.33, move: 'still', fire: [
        { pattern: 'spiral4', every: 8, from: 'core' }, { pattern: 'fan9', every: 60, from: 0 }, { pattern: 'fan9', every: 60, from: 1, delay: 30 },
      ] },
      { until: 0, move: 'figure8', fire: [
        { pattern: 'medMix', every: 30, from: 'core' }, { pattern: 'bigAim', every: 30, from: 0 }, { pattern: 'bigAim', every: 30, from: 1, delay: 15 },
      ] },
    ],
  },

  // ---------- 4 벚꽃 계곡 (곡선 탄) ----------
  petals: mid('petals', '꽃잎 정령 편대', 'flower', 'bulgasal', 480,
    [{ pattern: 'petal', every: 50, from: 'core' }, { pattern: 'aim1', every: 40, from: 0 }, { pattern: 'aim1', every: 40, from: 1, delay: 20 }],
    [{ pattern: 'petal', every: 30, from: 'core' }, { pattern: 'petalFan', every: 50, from: 0 }, { pattern: 'petalFan', every: 50, from: 1, delay: 25 }]),
  // 구미호 비행선: 기존 구미호 그림 + 코드 비행선 (시안과 같은 모양)
  gumiho: {
    id: 'gumiho', name: '구미호 비행선', kind: 'stage', image: '', hull: 'airship', rider: 'gumiho', width: 430,
    core: { x: 0, y: -50, r: 95 }, hp: 1800, restY: 340, time: 90,
    parts: hullParts(430, 260),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'petal', every: 45, from: 'core' }, { pattern: 'aim3', every: 60, from: 0 }, { pattern: 'aim3', every: 60, from: 1, delay: 30 },
      ] },
      { until: 0.33, move: 'figure8', fire: [
        { pattern: 'petalFan', every: 26, from: 'core' }, { pattern: 'aim5', every: 70, from: 0 }, { pattern: 'aim5', every: 70, from: 1, delay: 35 },
      ] },
      { until: 0, move: 'sway', fire: [
        { pattern: 'petal', every: 18, from: 'core' }, { pattern: 'bigAim', every: 40, from: 0 }, { pattern: 'bigAim', every: 40, from: 1, delay: 20 },
      ] },
    ],
  },

  // ---------- 5 구름 위 (번개 예고 구역) ----------
  cloudship: mid('cloudship', '구름 비행선', 'cloud', 'gangcheori', 540,
    [{ pattern: 'thunder', every: 120, from: 'core' }, { pattern: 'aim3', every: 60, from: 0 }, { pattern: 'aim3', every: 60, from: 1, delay: 30 }],
    [{ pattern: 'thunder2', every: 110, from: 'core' }, { pattern: 'ring16', every: 70, from: 'core', delay: 35 }, { pattern: 'aim5', every: 70, from: 0 }]),
  // 뇌신 비행선 (북 4개)
  raijin: {
    id: 'raijin', name: '뇌신 비행선', kind: 'stage', image: 'boss-5', width: 440,
    core: artCore('boss-5', 440, 80), hp: 2100, restY: 370, time: 90,
    parts: [0, 1, 2, 3].map(i => ({ ...artPart('boss-5', 440, i), r: 40, hp: 170 })),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'thunder', every: 110, from: 'core' }, { pattern: 'aim3', every: 70, from: 0 }, { pattern: 'aim3', every: 70, from: 1, delay: 35 },
        { pattern: 'ring16', every: 90, from: 2 }, { pattern: 'ring16', every: 90, from: 3, delay: 45 },
      ] },
      { until: 0.33, move: 'still', fire: [
        { pattern: 'thunder2', every: 100, from: 'core' }, { pattern: 'spiral4', every: 9, from: 'core' },
      ] },
      { until: 0, move: 'figure8', fire: [
        { pattern: 'thunder', every: 70, from: 'core' }, { pattern: 'aim5', every: 40, from: 0 }, { pattern: 'aim5', every: 40, from: 1, delay: 20 },
        { pattern: 'fan9', every: 60, from: 2 }, { pattern: 'fan9', every: 60, from: 3, delay: 30 },
      ] },
    ],
  },

  // ---------- 6 독안개 늪 ----------
  fogfort: mid('fogfort', '독안개 포대', 'fort', 'centipede', 600,
    [{ pattern: 'slowRing', every: 60, from: 'core' }, { pattern: 'aim3', every: 50, from: 0 }, { pattern: 'aim3', every: 50, from: 1, delay: 25 }],
    [{ pattern: 'slowRing', every: 40, from: 'core' }, { pattern: 'aim5', every: 50, from: 0 }, { pattern: 'aim5', every: 50, from: 1, delay: 25 }]),
  // 이무기: 기존 이무기 그림 + 돌 요새 몸체
  imugi: {
    id: 'imugi', name: '이무기', kind: 'stage', image: '', hull: 'fort', rider: 'imugi', width: 440,
    core: { x: 0, y: -50, r: 100 }, hp: 2400, restY: 350, time: 90,
    parts: hullParts(440, 280),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'serpent', every: 7, from: 'core' }, { pattern: 'aim3', every: 60, from: 0 }, { pattern: 'aim3', every: 60, from: 1, delay: 30 },
      ] },
      { until: 0.33, move: 'figure8', fire: [
        { pattern: 'slowRing', every: 40, from: 'core' }, { pattern: 'aim5', every: 45, from: 0 }, { pattern: 'aim5', every: 45, from: 1, delay: 22 },
      ] },
      { until: 0, move: 'sway', fire: [
        { pattern: 'serpent', every: 5, from: 'core' }, { pattern: 'bigAim', every: 36, from: 0 }, { pattern: 'bigAim', every: 36, from: 1, delay: 18 },
      ] },
    ],
  },

  // ---------- 7 사막 협곡 (지상 포탑 다수) ----------
  tanks: mid('tanks', '모래 전차 부대', 'fort', 'jangsanbeom', 660,
    [{ pattern: 'aim5', every: 60, from: 0 }, { pattern: 'aim5', every: 60, from: 1, delay: 30 }, { pattern: 'ring16', every: 90, from: 'core' }],
    [{ pattern: 'fan9', every: 45, from: 'core' }, { pattern: 'bigAim', every: 40, from: 0 }, { pattern: 'bigAim', every: 40, from: 1, delay: 20 }]),
  // 모래벌레 요새 (포탑 3)
  sandworm: {
    id: 'sandworm', name: '모래벌레 요새', kind: 'stage', image: 'boss-7', width: 440,
    core: artCore('boss-7', 440, 90), hp: 2300, restY: 380, time: 90,
    parts: [0, 1, 2].map(i => ({ ...artPart('boss-7', 440, i), r: 40, hp: 230 })),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'aim5', every: 55, from: 0 }, { pattern: 'fan9', every: 70, from: 1 }, { pattern: 'fan9', every: 70, from: 2, delay: 35 },
      ] },
      { until: 0.33, move: 'still', fire: [
        { pattern: 'spiral4', every: 7, from: 'core' }, { pattern: 'bigAim', every: 36, from: 1 }, { pattern: 'bigAim', every: 36, from: 2, delay: 18 },
      ] },
      { until: 0, move: 'figure8', fire: [
        { pattern: 'medMix', every: 26, from: 'core' }, { pattern: 'aim5', every: 40, from: 0 },
      ] },
    ],
  },

  // ---------- 8 바람 고원 (바람에 휘는 탄) ----------
  windmill: mid('windmill', '바람개비 요새', 'kite', 'guardCaptain', 720,
    [{ pattern: 'ring16', every: 55, from: 'core' }, { pattern: 'aim3', every: 45, from: 0 }, { pattern: 'aim3', every: 45, from: 1, delay: 22 }],
    [{ pattern: 'spiral4', every: 9, from: 'core' }, { pattern: 'aim5', every: 55, from: 0 }, { pattern: 'aim5', every: 55, from: 1, delay: 27 }]),
  // 회오리 거인 (팔 대포 2)
  tornado: {
    id: 'tornado', name: '회오리 거인', kind: 'stage', image: 'boss-8', width: 440,
    core: artCore('boss-8', 440, 95), hp: 2500, restY: 370, time: 90,
    parts: [0, 1].map(i => ({ ...artPart('boss-8', 440, i), r: 44, hp: 320 })),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'ring16', every: 50, from: 'core' }, { pattern: 'aim5', every: 60, from: 0 }, { pattern: 'aim5', every: 60, from: 1, delay: 30 },
      ] },
      { until: 0.33, move: 'figure8', fire: [
        { pattern: 'serpent', every: 6, from: 'core' }, { pattern: 'fan9', every: 60, from: 0 }, { pattern: 'fan9', every: 60, from: 1, delay: 30 },
      ] },
      { until: 0, move: 'sway', fire: [
        { pattern: 'spiral4', every: 6, from: 'core' }, { pattern: 'bigAim', every: 30, from: 0 }, { pattern: 'bigAim', every: 30, from: 1, delay: 15 },
      ] },
    ],
  },

  // ---------- 9 얼음 산맥 (눈보라) ----------
  snowfog: mid('snowfog', '눈안개 요괴', 'cloud', 'dueoksini', 780,
    [{ pattern: 'slowRing', every: 45, from: 'core' }, { pattern: 'aim3', every: 40, from: 0 }, { pattern: 'aim3', every: 40, from: 1, delay: 20 }],
    [{ pattern: 'ring16', every: 40, from: 'core' }, { pattern: 'aim5', every: 45, from: 0 }, { pattern: 'aim5', every: 45, from: 1, delay: 22 }]),
  // 설인 요새 (눈덩이 대포 + 얼음 포 2)
  yeti: {
    id: 'yeti', name: '설인 요새', kind: 'stage', image: 'boss-9', width: 440,
    core: artCore('boss-9', 440, 95), hp: 2700, restY: 380, time: 90,
    parts: [0, 1, 2].map(i => ({ ...artPart('boss-9', 440, i), r: 42, hp: 280 })),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'bigAim', every: 40, from: 0 }, { pattern: 'aim5', every: 55, from: 1 }, { pattern: 'aim5', every: 55, from: 2, delay: 27 },
      ] },
      { until: 0.33, move: 'still', fire: [
        { pattern: 'slowRing', every: 30, from: 'core' }, { pattern: 'fan9', every: 50, from: 1 }, { pattern: 'fan9', every: 50, from: 2, delay: 25 },
      ] },
      { until: 0, move: 'figure8', fire: [
        { pattern: 'spiral4', every: 6, from: 'core' }, { pattern: 'ring16', every: 45, from: 0 },
      ] },
    ],
  },

  // ---------- 10 폐허 성곽 (벽 뒤에서 쏘는 포대) ----------
  riders: mid('riders', '망령 기병', 'fort', 'reaper', 840,
    [{ pattern: 'aim5', every: 45, from: 0 }, { pattern: 'aim5', every: 45, from: 1, delay: 22 }, { pattern: 'slowRing', every: 70, from: 'core' }],
    [{ pattern: 'medMix', every: 30, from: 'core' }, { pattern: 'bigAim', every: 35, from: 0 }, { pattern: 'bigAim', every: 35, from: 1, delay: 17 }]),
  // 해골 장군 비행탑 (위 대포 + 뼈 대포 2)
  skeleton: {
    id: 'skeleton', name: '해골 장군 비행탑', kind: 'stage', image: 'boss-10', width: 430,
    core: artCore('boss-10', 430, 90), hp: 2900, restY: 380, time: 90,
    parts: [0, 1, 2].map(i => ({ ...artPart('boss-10', 430, i), r: 42, hp: 300 })),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'ring16', every: 50, from: 0 }, { pattern: 'aim5', every: 50, from: 1 }, { pattern: 'aim5', every: 50, from: 2, delay: 25 },
      ] },
      { until: 0.33, move: 'figure8', fire: [
        { pattern: 'serpent', every: 5, from: 'core' }, { pattern: 'bigAim', every: 34, from: 1 }, { pattern: 'bigAim', every: 34, from: 2, delay: 17 },
      ] },
      { until: 0, move: 'sway', fire: [
        { pattern: 'medMix', every: 22, from: 'core' }, { pattern: 'fan9', every: 45, from: 0 },
      ] },
    ],
  },

  // ---------- 11 불타는 화산 (아래에서 솟는 불기둥) ----------
  lavaship: mid('lavaship', '용암 전함', 'airship', 'bigDokkaebi', 900,
    [{ pattern: 'pillar', every: 90, from: 'core' }, { pattern: 'aim5', every: 45, from: 0 }, { pattern: 'aim5', every: 45, from: 1, delay: 22 }],
    [{ pattern: 'pillar2', every: 90, from: 'core' }, { pattern: 'ring16', every: 45, from: 'core', delay: 22 }, { pattern: 'bigAim', every: 40, from: 0 }]),
  // 화산 거인 (분화구 + 용암 팔 2)
  volcano: {
    id: 'volcano', name: '화산 거인', kind: 'stage', image: 'boss-11', width: 460,
    core: artCore('boss-11', 460, 95), hp: 3100, restY: 360, time: 90,
    parts: [0, 1, 2].map(i => ({ ...artPart('boss-11', 460, i), r: 44, hp: 320 })),
    phases: [
      { until: 0.66, move: 'sway', fire: [
        { pattern: 'pillar', every: 80, from: 'core' }, { pattern: 'ring16', every: 50, from: 0 }, { pattern: 'aim5', every: 50, from: 1 }, { pattern: 'aim5', every: 50, from: 2, delay: 25 },
      ] },
      { until: 0.33, move: 'still', fire: [
        { pattern: 'pillar2', every: 70, from: 'core' }, { pattern: 'spiral4', every: 7, from: 'core' },
      ] },
      { until: 0, move: 'figure8', fire: [
        { pattern: 'pillar', every: 50, from: 'core' }, { pattern: 'fan9', every: 40, from: 1 }, { pattern: 'fan9', every: 40, from: 2, delay: 20 }, { pattern: 'bigAim', every: 30, from: 0 },
      ] },
    ],
  },

  // ---------- 12 요괴 하늘성 (이전 보스 패턴 일부) ----------
  generals: mid('generals', '두 장군', 'fort', 'yeomra', 1000,
    [{ pattern: 'clawFan', every: 45, from: 0 }, { pattern: 'petalFan', every: 45, from: 1, delay: 22 }, { pattern: 'ring16', every: 60, from: 'core' }],
    [{ pattern: 'serpent', every: 6, from: 'core' }, { pattern: 'aim5', every: 40, from: 0 }, { pattern: 'aim5', every: 40, from: 1, delay: 20 }]),
  // 요괴왕 모함: 4 페이즈, 페이즈마다 앞 스테이지 보스의 패턴을 섞는다
  king: {
    id: 'king', name: '요괴왕 모함', kind: 'stage', image: 'boss-12', width: 470,
    core: artCore('boss-12', 470, 100), hp: 4200, restY: 370, time: 90,
    parts: [0, 1, 2, 3].map(i => ({ ...artPart('boss-12', 470, i), r: 40, hp: 300 })),
    phases: [
      // 1: 게 전함 · 해룡 항모
      { until: 0.75, move: 'sway', fire: [
        { pattern: 'clawFan', every: 50, from: 2 }, { pattern: 'clawFan', every: 50, from: 3, delay: 25 }, { pattern: 'rise8', every: 40, from: 0 }, { pattern: 'rise8', every: 40, from: 1, delay: 20 },
      ] },
      // 2: 구미호 · 뇌신
      { until: 0.5, move: 'figure8', fire: [
        { pattern: 'petal', every: 22, from: 'core' }, { pattern: 'thunder', every: 90, from: 'core' }, { pattern: 'aim5', every: 50, from: 0 }, { pattern: 'aim5', every: 50, from: 1, delay: 25 },
      ] },
      // 3: 이무기 · 화산 거인
      { until: 0.25, move: 'sway', fire: [
        { pattern: 'serpent', every: 5, from: 'core' }, { pattern: 'pillar', every: 70, from: 'core' }, { pattern: 'bigAim', every: 36, from: 2 }, { pattern: 'bigAim', every: 36, from: 3, delay: 18 },
      ] },
      // 4: 요괴왕 본모습 — 모두 섞어서
      { until: 0, move: 'figure8', fire: [
        { pattern: 'spiral4', every: 5, from: 'core' }, { pattern: 'petalFan', every: 40, from: 'core', delay: 20 }, { pattern: 'thunder2', every: 100, from: 'core' },
        { pattern: 'fan9', every: 45, from: 0 }, { pattern: 'fan9', every: 45, from: 1, delay: 22 },
      ] },
    ],
  },
};

/** 아케이드 스테이지 보스 순서 (보스 러시) */
export const RUSH = ['crab', 'carrier', 'tanuki', 'gumiho', 'raijin', 'imugi', 'sandworm', 'tornado', 'yeti', 'skeleton', 'volcano', 'king'];
