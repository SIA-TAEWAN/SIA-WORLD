import type { ZodiacId } from './balance';

/**
 * 캐릭터(타워) 수치 (PRD 4장). 공격 방식(kind)마다 계산 함수가 하나씩 있다 (src/game/towers.ts 의 ATTACKS).
 * 새 캐릭터 = 여기에 한 줄 + (새 공격 방식이면) ATTACKS 에 함수 하나.
 *
 * 밸런스 원칙: 같은 기운을 썼을 때의 효율은 비슷하게, 요괴 종류에 따라 유리한 캐릭터가 달라지게.
 *   쥐 빠른 요괴 · 호랑이 단단한 요괴(짧은 사거리) · 토끼 무리 · 소/양 붙잡아 두기 · 용 한 줄로 오는 무리와 방패 ·
 *   뱀 단단하고 회복하는 요괴 · 말 보스와 큰 요괴 · 원숭이 공중과 은신 · 닭 다른 캐릭터를 빠르게 · 개 은신 · 돼지 기운
 */
export type AttackKind = 'shot' | 'stun' | 'melee' | 'lob' | 'beam' | 'poison' | 'slow' | 'bank';

export interface TowerLevel {
  /** 한 번의 피해 */
  dmg: number;
  /** 사거리 (px) */
  range: number;
  /** 공격 간격 (초) */
  every: number;
  /** shot: 한 번에 던지는 수 (기본 1) */
  count?: number;
  /** stun·shot: 맞은 요괴를 멈추는 시간 (초) */
  stun?: number;
  /** melee·lob·poison: 맞은 자리 둘레 이 반지름 안의 요괴도 함께 (px) */
  splash?: number;
  /** beam: 광선의 반 너비 (px) · 맞은 요괴가 타는 초당 피해와 시간 */
  width?: number;
  burn?: number;
  burnSec?: number;
  /** poison: 초당 피해 + 초당 최대 체력의 이 비율 (보스는 1/4) · 지속 시간 */
  poison?: number;
  poisonPct?: number;
  dur?: number;
  /** 보스에게 주는 피해 배율 · 공중 요괴에게 주는 피해 배율 */
  bossMul?: number;
  airMul?: number;
  /** slow: 사거리 안 요괴의 이동 속도 배율 · 느려진 요괴가 더 받는 피해 비율 */
  slow?: number;
  vuln?: number;
  /** 사거리 안의 은신 요괴를 드러낸다 */
  detect?: boolean;
  /** 사거리 안 다른 캐릭터의 공격 속도를 이만큼 올린다 (0.2 = +20%) */
  haste?: number;
  /** bank: 웨이브가 시작될 때마다 버는 기운 · 엽전 */
  income?: number;
  coin?: number;
}

export interface TowerDef {
  id: ZodiacId;
  /** 띠 이름 · 캐릭터 이름 (DESIGN.md 6장) */
  name: string;
  nick: string;
  role: string;
  desc: string;
  kind: AttackKind;
  /** 투사체 그림 (state.ts 의 PROJ). shot·poison 만 */
  proj?: number;
  /** 공중 요괴를 맞힐 수 있나 */
  air: boolean;
  /** 누구부터 노리나: first 출구에 가장 가까운 요괴(기본) · strong 체력이 가장 많은 요괴 · air 공중 요괴 먼저 */
  target?: 'first' | 'strong' | 'air';
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
    id: 'rat', name: '쥐', nick: '찍찍이', role: '빠른 단일 공격', desc: '표창을 빠르게 던져요. 값이 싸요', kind: 'shot', proj: 0, air: true,
    cost: 50, up: [40, 75],
    levels: [
      { dmg: 7, range: 175, every: 0.46 },
      { dmg: 9, range: 190, every: 0.4 },
      { dmg: 9, range: 205, every: 0.38, count: 2 },
    ],
    special: '표창을 2개씩 던져요',
  },
  {
    id: 'ox', name: '소', nick: '우직이', role: '길막이', desc: '방울을 울려 주변 요괴를 잠깐 멈춰요', kind: 'stun', air: false,
    cost: 70, up: [55, 95],
    levels: [
      { dmg: 18, range: 140, every: 2.6, stun: 1.4 },
      { dmg: 26, range: 150, every: 2.4, stun: 1.7 },
      { dmg: 36, range: 160, every: 2.2, stun: 2.3 },
    ],
    special: '멈춤 시간이 크게 늘어요',
  },
  {
    id: 'tiger', name: '호랑이', nick: '어흥이', role: '강한 근접', desc: '가까운 요괴를 발톱으로 크게 베요. 사거리가 짧아요', kind: 'melee', air: false,
    cost: 110, up: [90, 150],
    levels: [
      { dmg: 44, range: 112, every: 0.95 },
      { dmg: 64, range: 120, every: 0.86 },
      { dmg: 80, range: 128, every: 0.78, splash: 70 },
    ],
    special: '둘레의 요괴까지 함께 베요',
  },
  {
    id: 'rabbit', name: '토끼', nick: '깡총이', role: '범위 폭발', desc: '달떡을 던져 떨어진 자리 주변에 피해를 줘요', kind: 'lob', air: false,
    cost: 120, up: [95, 160],
    levels: [
      { dmg: 30, range: 205, every: 1.4, splash: 70 },
      { dmg: 44, range: 220, every: 1.3, splash: 76 },
      { dmg: 58, range: 235, every: 1.2, splash: 106 },
    ],
    special: '폭발 범위가 크게 늘어요',
  },
  {
    id: 'dragon', name: '용', nick: '여의룡', role: '관통', desc: '여의주 광선이 일직선의 요괴를 모두 맞혀요. 방패도 뚫어요', kind: 'beam', air: true,
    cost: 130, up: [105, 170],
    levels: [
      { dmg: 30, range: 200, every: 1.2, width: 26 },
      { dmg: 42, range: 215, every: 1.1, width: 28 },
      { dmg: 54, range: 230, every: 1, width: 30, burn: 16, burnSec: 2 },
    ],
    special: '광선에 맞은 요괴가 계속 타요',
  },
  {
    id: 'snake', name: '뱀', nick: '스르르', role: '독', desc: '독을 묻혀 시간에 걸쳐 피해를 줘요. 단단한 요괴에 강해요', kind: 'poison', proj: 2, air: true,
    cost: 100, up: [80, 130],
    levels: [
      { dmg: 6, range: 170, every: 1.1, poison: 9, poisonPct: 0.014, dur: 4 },
      { dmg: 8, range: 185, every: 1, poison: 13, poisonPct: 0.017, dur: 4 },
      { dmg: 10, range: 200, every: 0.9, poison: 17, poisonPct: 0.02, dur: 4, splash: 64 },
    ],
    special: '독이 주변 요괴에게 번져요',
  },
  {
    id: 'horse', name: '말', nick: '따각이', role: '장거리 저격', desc: '사거리가 매우 길고 한 발이 세요. 느려요', kind: 'shot', proj: 3, air: true, target: 'strong',
    cost: 130, up: [105, 170],
    levels: [
      { dmg: 120, range: 330, every: 2.5 },
      { dmg: 175, range: 370, every: 2.3 },
      { dmg: 230, range: 410, every: 2.1, bossMul: 1.6 },
    ],
    special: '보스에게 더 큰 피해를 줘요',
  },
  {
    id: 'sheep', name: '양', nick: '몽실이', role: '감속', desc: '양털 구름으로 범위 안 요괴를 느리게 해요', kind: 'slow', air: true,
    cost: 80, up: [65, 110],
    levels: [
      { dmg: 0, range: 135, every: 0.5, slow: 0.5 },
      { dmg: 0, range: 147, every: 0.5, slow: 0.42 },
      { dmg: 0, range: 160, every: 0.5, slow: 0.35, vuln: 0.25 },
    ],
    special: '느려진 요괴가 피해를 더 받아요',
  },
  {
    id: 'monkey', name: '원숭이', nick: '재롱이', role: '공중 전담', desc: '날아다니는 요괴를 먼저 노리고, 공중에 큰 피해를 줘요', kind: 'shot', proj: 4, air: true, target: 'air',
    cost: 80, up: [65, 105],
    levels: [
      { dmg: 13, range: 200, every: 0.7, airMul: 2.4 },
      { dmg: 19, range: 215, every: 0.64, airMul: 2.4 },
      { dmg: 24, range: 230, every: 0.58, airMul: 2.4, detect: true },
    ],
    special: '숨은 요괴를 찾아내요',
  },
  {
    id: 'rooster', name: '닭', nick: '꼬꼬댁', role: '지원', desc: '주변 캐릭터의 공격 속도를 올려요. 직접 공격은 약해요', kind: 'shot', proj: 5, air: true,
    cost: 100, up: [80, 130],
    levels: [
      { dmg: 8, range: 135, every: 1, haste: 0.3 },
      { dmg: 11, range: 145, every: 1, haste: 0.4 },
      { dmg: 14, range: 185, every: 1, haste: 0.5 },
    ],
    special: '지원 범위가 크게 늘어요',
  },
  {
    id: 'dog', name: '개', nick: '멍뭉이', role: '감지·추격', desc: '숨은 요괴를 드러내고, 강아지를 보내 길 위의 요괴를 물어 세워요', kind: 'shot', proj: 6, air: false,
    cost: 110, up: [90, 150],
    levels: [
      { dmg: 34, range: 180, every: 1.4, stun: 1, detect: true },
      { dmg: 48, range: 195, every: 1.3, stun: 1.2, detect: true },
      { dmg: 58, range: 210, every: 1.2, stun: 1.4, detect: true, count: 2 },
    ],
    special: '강아지를 2마리씩 보내요',
  },
  {
    id: 'pig', name: '돼지', nick: '꿀꿀이', role: '재화', desc: '웨이브(30초)마다 기운을 벌어 줘요. 공격은 하지 않아요', kind: 'bank', air: false,
    cost: 90, up: [75, 130],
    levels: [
      { dmg: 0, range: 0, every: 1, income: 40 },
      { dmg: 0, range: 0, every: 1, income: 62 },
      { dmg: 0, range: 0, every: 1, income: 88, coin: 2 },
    ],
    special: '엽전도 조금 벌어요',
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
