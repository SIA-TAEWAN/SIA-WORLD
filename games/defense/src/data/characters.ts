import type { ZodiacId } from './balance';

/**
 * 캐릭터(타워) 수치 (PRD 4장). 공격 방식(kind)마다 계산 함수가 하나씩 있다 (src/game/towers.ts 의 ATTACKS).
 * 새 캐릭터 = 여기에 한 줄 + (새 공격 방식이면) ATTACKS 에 함수 하나.
 *
 * 밸런스 원칙: 같은 기운을 썼을 때의 효율은 비슷하게, 요괴 종류에 따라 유리한 캐릭터가 달라지게.
 *   쥐: 한 마리씩 빠르게(빠르고 약한 요괴) · 호랑이: 짧은 사거리에 큰 한 방(단단한 요괴·보스)
 *   토끼: 무리에 강함(범위) · 소: 피해는 약하지만 요괴를 세워 다른 캐릭터가 더 때리게 함
 */
export type AttackKind = 'shot' | 'stun' | 'melee' | 'lob';

export interface TowerLevel {
  /** 한 번의 피해 */
  dmg: number;
  /** 사거리 (px) */
  range: number;
  /** 공격 간격 (초) */
  every: number;
  /** shot: 한 번에 던지는 수 (기본 1) */
  count?: number;
  /** stun: 멈춤 시간 (초) */
  stun?: number;
  /** melee·lob: 맞은 자리 둘레 이 반지름 안의 요괴도 함께 맞는다 (px) */
  splash?: number;
}

export interface TowerDef {
  id: ZodiacId;
  /** 띠 이름 · 캐릭터 이름 (DESIGN.md 6장) */
  name: string;
  nick: string;
  role: string;
  desc: string;
  kind: AttackKind;
  /** 배치 비용 (기운) */
  cost: number;
  /** 2단계·3단계로 올리는 비용 */
  up: [number, number];
  levels: [TowerLevel, TowerLevel, TowerLevel];
  /** 3단계 특수 효과 설명 */
  special: string;
}

export const TOWERS: TowerDef[] = [
  {
    id: 'rat', name: '쥐', nick: '찍찍이', role: '빠른 단일 공격', desc: '표창을 빠르게 던져요. 값이 싸요', kind: 'shot',
    cost: 50, up: [40, 75],
    levels: [
      { dmg: 9, range: 185, every: 0.46 },
      { dmg: 12, range: 200, every: 0.4 },
      { dmg: 12, range: 215, every: 0.38, count: 2 },
    ],
    special: '표창을 2개씩 던져요',
  },
  {
    id: 'ox', name: '소', nick: '우직이', role: '길막이', desc: '방울을 울려 주변 요괴를 잠깐 멈춰요', kind: 'stun',
    cost: 85, up: [65, 110],
    levels: [
      { dmg: 5, range: 125, every: 3.2, stun: 0.9 },
      { dmg: 8, range: 135, every: 3.0, stun: 1.1 },
      { dmg: 12, range: 145, every: 2.8, stun: 1.7 },
    ],
    special: '멈춤 시간이 크게 늘어요',
  },
  {
    id: 'tiger', name: '호랑이', nick: '어흥이', role: '강한 근접', desc: '가까운 요괴를 발톱으로 크게 베요. 사거리가 짧아요', kind: 'melee',
    cost: 110, up: [90, 150],
    levels: [
      { dmg: 44, range: 112, every: 0.95 },
      { dmg: 64, range: 120, every: 0.86 },
      { dmg: 80, range: 128, every: 0.78, splash: 70 },
    ],
    special: '둘레의 요괴까지 함께 베요',
  },
  {
    id: 'rabbit', name: '토끼', nick: '깡총이', role: '범위 폭발', desc: '달떡을 던져 떨어진 자리 주변에 피해를 줘요', kind: 'lob',
    cost: 120, up: [95, 160],
    levels: [
      { dmg: 20, range: 205, every: 1.5, splash: 62 },
      { dmg: 30, range: 220, every: 1.4, splash: 68 },
      { dmg: 40, range: 235, every: 1.3, splash: 96 },
    ],
    special: '폭발 범위가 크게 늘어요',
  },
];

export const TOWER_INDEX: Record<string, number> = Object.fromEntries(TOWERS.map((t, i) => [t.id, i]));
export const towerOf = (id: string): TowerDef | undefined => TOWERS[TOWER_INDEX[id]];

/**
 * 십이지 12종의 출전 명단 (PRD 4장). 계산까지 만들어진 캐릭터는 TOWERS 에 있고, 나머지는 해금 조건만 보여 준다.
 * unlockRegion: 이 지역을 클리어하면 열린다 (0 = 처음부터)
 */
export interface RosterEntry {
  id: ZodiacId;
  name: string;
  nick: string;
  role: string;
  unlockRegion: number;
}

export const ROSTER: RosterEntry[] = [
  { id: 'rat', name: '쥐', nick: '찍찍이', role: '빠른 단일 공격', unlockRegion: 0 },
  { id: 'ox', name: '소', nick: '우직이', role: '길막이', unlockRegion: 0 },
  { id: 'tiger', name: '호랑이', nick: '어흥이', role: '강한 근접', unlockRegion: 0 },
  { id: 'rabbit', name: '토끼', nick: '깡총이', role: '범위 폭발', unlockRegion: 0 },
  { id: 'dragon', name: '용', nick: '여의룡', role: '관통', unlockRegion: 1 },
  { id: 'snake', name: '뱀', nick: '스르르', role: '독', unlockRegion: 2 },
  { id: 'horse', name: '말', nick: '따각이', role: '장거리 저격', unlockRegion: 3 },
  { id: 'sheep', name: '양', nick: '몽실이', role: '감속', unlockRegion: 4 },
  { id: 'monkey', name: '원숭이', nick: '재롱이', role: '공중 전담', unlockRegion: 5 },
  { id: 'rooster', name: '닭', nick: '꼬꼬댁', role: '지원', unlockRegion: 6 },
  { id: 'dog', name: '개', nick: '멍뭉이', role: '감지·추격', unlockRegion: 7 },
  { id: 'pig', name: '돼지', nick: '꿀꿀이', role: '재화', unlockRegion: 8 },
];

/** 처음부터 쓸 수 있는 캐릭터 */
export const STARTERS: ZodiacId[] = ROSTER.filter((r) => r.unlockRegion === 0).map((r) => r.id);

/** 그 단계까지 쓴 기운 (배치 + 강화) */
export function spentAt(def: TowerDef, lv: number): number {
  return def.cost + (lv >= 2 ? def.up[0] : 0) + (lv >= 3 ? def.up[1] : 0);
}
