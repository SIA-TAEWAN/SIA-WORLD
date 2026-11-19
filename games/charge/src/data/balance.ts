/**
 * 시아돌격대 기본 수치 (PRD.md 3·5장). 단위: 거리 = 기준 화면 px(720×1280 기준), 시간 = 초.
 * 시뮬레이션(src/game/sim.ts)과 화면(src/scenes/GameScene.ts)이 모두 이 값을 쓴다.
 */

export const ZODIAC_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;
export type ZodiacId = (typeof ZODIAC_IDS)[number];

/** 길 폭 (가운데가 x=0, 왼쪽 끝 -ROAD_W/2) */
export const ROAD_W = 560;
/** 앞으로 달리는 속도 */
export const RUN_SPEED = 300;
/** 좌우로 움직이는 최대 속도 */
export const MOVE_SPEED = 1100;
/** 대원 수 상한 */
export const MAX_TROOPS = 9999;
/** 화면에 실제로 그리는 대원 수 상한 (나머지는 숫자로만 보인다) */
export const DRAW_MAX = 300;
/** 사거리: 무리 앞쪽에서 이만큼 앞에 있는 것까지 쏜다 */
export const RANGE = 720;
/** 문에 이만큼 피해를 주면 숫자가 1 오른다 */
export const GATE_STEP_DMG = 45;
/** 총으로 올릴 수 있는 문 숫자 상한 */
export const GATE_CAP = 99;
/** 요괴 무리와 부딪히는 거리 (무리 앞쪽 기준) */
export const CLASH_DIST = 34;
/** 보스 앞 이 거리에서 멈춰 서서 싸운다 */
export const BOSS_STOP = 420;
/** 요괴 무리가 이 거리 안에 들어오면 움직이기 시작한다 */
export const HORDE_WAKE = 950;

/** 대원 수 → 초당 화력. 대원이 많을수록 세지만 그대로 비례하지는 않는다 (× 문으로 수천 명이 돼도 판이 망가지지 않게) */
export function firePower(n: number): number {
  return n <= 0 ? 0 : 10 * Math.pow(n, 0.7);
}

/** 대원 수 → 무리 반지름 (좌우 폭의 절반). 무리가 클수록 넓게 퍼진다 */
export function crowdRadius(n: number): number {
  return n <= 0 ? 0 : Math.min(ROAD_W / 2 - 10, 12 + 5.5 * Math.sqrt(n));
}

export type EnemyKind = 'imp' | 'wisp' | 'club';

export interface EnemyDef {
  name: string;
  /** 한 마리 체력 */
  hp: number;
  /** 부딪힐 때 한 마리가 없애는 대원 수 */
  strength: number;
  /** 다가오는 속도 */
  speed: number;
  /** 그림 이름 (public/art/<이름>.png) */
  art: string;
}

/** 1지역 요괴 (PRD 7장. 나머지 요괴는 다음 단계에서 추가) */
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  imp: { name: '꼬마 도깨비', hp: 10, strength: 1, speed: 45, art: 'e-imp' },
  wisp: { name: '도깨비불', hp: 6, strength: 1, speed: 150, art: 'e-wisp' },
  club: { name: '방망이 도깨비', hp: 45, strength: 3, speed: 22, art: 'e-club' },
};

export type BossKind = 'chief' | 'bigDokkaebi';

export interface BossArt {
  name: string;
  art: string;
  /** 화면에 그릴 높이 */
  size: number;
}

export const BOSS_ART: Record<BossKind, BossArt> = {
  chief: { name: '도깨비 대장', art: 'e-club', size: 170 },
  bigDokkaebi: { name: '큰 도깨비', art: 'b-bigDokkaebi', size: 250 },
};

export interface LeaderDef {
  id: ZodiacId;
  name: string;
  trait: string;
  /** 처음 열려 있는 대장인가 (아니면 unlockRegion 지역을 클리어하면 열린다) */
  starter: boolean;
  unlockRegion: number;
  /** 시작 대원 배율 */
  startMul: number;
  /** 요괴·보스·장애물에 잃는 대원 배율 */
  lossMul: number;
  /** 보스에게 주는 피해 배율 */
  bossMul: number;
  /** 좌우 이동 속도 배율 */
  moveMul: number;
  /** 문에 주는 피해 배율 (숫자가 오르는 속도) */
  gateMul: number;
  /** 요괴 무리에게 주는 피해 배율 */
  hordeMul: number;
  /** 사거리 배율 */
  rangeMul: number;
}

const base = { startMul: 1, lossMul: 1, bossMul: 1, moveMul: 1, gateMul: 1, hordeMul: 1, rangeMul: 1 };

/** 대장 12종 (PRD 6장). 차이는 10% 안팎으로 작게 */
export const LEADERS: LeaderDef[] = [
  { ...base, id: 'rat', name: '쥐', trait: '시작 대원 +10%', starter: true, unlockRegion: 0, startMul: 1.1 },
  { ...base, id: 'ox', name: '소', trait: '요괴·보스에게 잃는 대원 -10%', starter: true, unlockRegion: 0, lossMul: 0.9 },
  { ...base, id: 'tiger', name: '호랑이', trait: '보스에게 주는 피해 +10%', starter: true, unlockRegion: 0, bossMul: 1.1 },
  { ...base, id: 'rabbit', name: '토끼', trait: '좌우 이동 속도 +15%', starter: false, unlockRegion: 1, moveMul: 1.15 },
  { ...base, id: 'dragon', name: '용', trait: '문 숫자 오르는 속도 +10%', starter: false, unlockRegion: 2, gateMul: 1.1 },
  { ...base, id: 'snake', name: '뱀', trait: '요괴 무리에게 주는 피해 +10%', starter: false, unlockRegion: 3, hordeMul: 1.1 },
  { ...base, id: 'horse', name: '말', trait: '사거리 +10%', starter: false, unlockRegion: 4, rangeMul: 1.1 },
  { ...base, id: 'sheep', name: '양', trait: '요괴와 부딪힐 때 잃는 대원 -10%', starter: false, unlockRegion: 5, lossMul: 0.9 },
  { ...base, id: 'monkey', name: '원숭이', trait: '상자 보상 +20%', starter: false, unlockRegion: 6 },
  { ...base, id: 'rooster', name: '닭', trait: '× 문 효과 조금 증가', starter: false, unlockRegion: 7 },
  { ...base, id: 'dog', name: '개', trait: '보스 공격 예고가 빨리 뜨고 피해 -10%', starter: false, unlockRegion: 8 },
  { ...base, id: 'pig', name: '돼지', trait: '엽전 획득 +10%', starter: false, unlockRegion: 9 },
];

export const leaderOf = (id: string): LeaderDef => LEADERS.find((l) => l.id === id) ?? LEADERS[0];
