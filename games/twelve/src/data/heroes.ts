/**
 * 대원 (PRD '캐릭터'): 십이지 12종 + 고양이(숨김).
 * - 능력치 배율은 0.955~1.05 (대원끼리 차이 최대 10%: 1.05 ÷ 0.955 = 1.0995). 고양이는 가장 좋은 대원보다 5% 안쪽으로만 좋다.
 * - home: 고향 지형 (공격·방어 +10%), weapon: 잘 다루는 무기 (공격 +5%), join: 합류하는 지형 보스 (0 = 처음부터).
 * - 고유 스킬은 무기 스킬과 같은 동작 조각(acts.ts)으로 만든다.
 */
import type { Act } from './acts';
import type { SkillDef, WeaponKind } from './weapons';

export const ZODIAC_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;
export type ZodiacId = (typeof ZODIAC_IDS)[number];
export type HeroId = ZodiacId | 'cat';
export const HERO_IDS: readonly HeroId[] = [...ZODIAC_IDS, 'cat'];

export const STAT_KEYS = ['hp', 'mp', 'atk', 'def', 'speed', 'crit'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_NAME: Record<StatKey, string> = { hp: '체력', mp: '마력', atk: '공격', def: '방어', speed: '이동', crit: '치명타' };

export interface HeroDef {
  id: HeroId;
  /** 동물 이름 */
  animal: string;
  /** 화면에 쓰는 이름 (DESIGN.md 6장) */
  name: string;
  /** 능력치 배율 */
  stats: Record<StatKey, number>;
  weapon: WeaponKind;
  /** 고향 지형 (0 = 없음) */
  home: number;
  /** 합류: 0 = 처음부터, 1~9 = 그 지형 보스를 처음 잡으면 */
  join: number;
  /** 보통 모드를 클리어하기 전에는 보이지 않는다 (고양이) */
  hidden?: boolean;
  /** 시아코인 값 (고양이만) */
  price?: number;
  unique: SkillDef;
}

const S = (o: Partial<Record<StatKey, number>>): Record<StatKey, number> => ({ hp: 1, mp: 1, atk: 1, def: 1, speed: 1, crit: 1, ...o });
const U = (name: string, desc: string, icon: string, cd: number, sound: string, acts: Act[], mp = 25): SkillDef => ({ name, desc, icon, mp, cd, sound, acts });

export const HEROES: HeroDef[] = [
  {
    id: 'rat', animal: '쥐', name: '찍찍이', stats: S({ speed: 1.05, crit: 1.05, hp: 0.955 }), weapon: 'sword', home: 1, join: 0,
    unique: U('잽싼 발', '6초 동안 이동 +40%, 치명타 +30%', '🐭', 22, 'boost', [{ t: 'buff', dur: 6, speed: 1.4, crit: 0.3 }]),
  },
  {
    id: 'ox', animal: '소', name: '우직이', stats: S({ hp: 1.05, def: 1.05, speed: 0.955 }), weapon: 'spear', home: 2, join: 0,
    unique: U('버티기', '6초 동안 받는 피해 60% 줄이기', '🐮', 24, 'tankBuild', [{ t: 'buff', dur: 6, guard: 0.4 }]),
  },
  {
    id: 'tiger', animal: '호랑이', name: '어흥이', stats: S({ atk: 1.05, crit: 1.03, def: 0.97, mp: 0.955 }), weapon: 'sword', home: 3, join: 0,
    unique: U('포효', '주변 요괴를 기절시킨다', '🐯', 22, 'survBossWarn', [{ t: 'hit', shape: { k: 'circle', r: 270 }, mul: 1.2, stun: 2.5, kb: 60 }]),
  },
  {
    id: 'rabbit', animal: '토끼', name: '깡총이', stats: S({ speed: 1.05, mp: 1.03, hp: 0.96 }), weapon: 'bow', home: 4, join: 1,
    unique: U('달떡', '체력을 35% 회복한다', '🐰', 28, 'tankHeal', [{ t: 'heal', hp: 0.35 }]),
  },
  {
    id: 'dragon', animal: '용', name: '여의룡', stats: S({ atk: 1.04, mp: 1.05, def: 0.955 }), weapon: 'fan', home: 5, join: 2,
    unique: U('용숨', '앞쪽에 불길을 뿜는다', '🐲', 20, 'tankFire', [{ t: 'hit', shape: { k: 'arc', r: 330, half: 0.6 }, mul: 3, kb: 80, dot: { mul: 0.5, dur: 4 } }]),
  },
  {
    id: 'snake', animal: '뱀', name: '스르르', stats: S({ crit: 1.05, mp: 1.04, hp: 0.955 }), weapon: 'fan', home: 6, join: 3,
    unique: U('독안개', '내 자리에 독안개를 깐다', '🐍', 20, 'slide', [{ t: 'zone', look: 'poison', ahead: 0, r: 200, dur: 5, tick: 0.5, mul: 0.5, slow: { mul: 0.6, dur: 1 } }]),
  },
  {
    id: 'horse', animal: '말', name: '따각이', stats: S({ speed: 1.05, atk: 1.02, mp: 0.955 }), weapon: 'spear', home: 7, join: 4,
    unique: U('질주', '멀리 달려가며 들이받는다', '🐴', 18, 'boost', [{ t: 'dash', dist: 520, time: 0.32, w: 110, mul: 3.2, kb: 220, stun: 0.6 }]),
  },
  {
    id: 'sheep', animal: '양', name: '몽실이', stats: S({ hp: 1.04, mp: 1.05, atk: 0.96 }), weapon: 'fan', home: 8, join: 5,
    unique: U('솜구름', '주변 요괴를 느리게 하고 체력을 15% 회복한다', '🐑', 24, 'tankHeal', [
      { t: 'hit', shape: { k: 'circle', r: 260 }, mul: 0.6, slow: { mul: 0.45, dur: 4 } },
      { t: 'heal', hp: 0.15 },
    ]),
  },
  {
    id: 'monkey', animal: '원숭이', name: '재롱이', stats: S({ crit: 1.05, speed: 1.03, def: 0.955 }), weapon: 'bow', home: 9, join: 6,
    unique: U('재주넘기', '주변을 세 번 휩쓴다', '🐵', 20, 'survSlash', [0, 0.18, 0.36].map((at): Act => ({ t: 'hit', at, shape: { k: 'circle', r: 190 }, mul: 1.3, kb: 90 }))),
  },
  {
    id: 'rooster', animal: '닭', name: '꼬꼬댁', stats: S({ atk: 1.05, speed: 1.02, hp: 0.96 }), weapon: 'bow', home: 10, join: 7,
    unique: U('새벽 울음', '6초 동안 공격 +40%', '🐔', 24, 'raceGo', [{ t: 'buff', dur: 6, atk: 1.4 }]),
  },
  {
    id: 'dog', animal: '개', name: '멍뭉이', stats: S({ def: 1.04, atk: 1.03, mp: 0.96 }), weapon: 'sword', home: 11, join: 8,
    unique: U('물어뜯기', '가까운 요괴 다섯을 차례로 문다', '🐶', 20, 'slap', [{ t: 'chain', range: 320, jumps: 5, jumpRange: 260, mul: 2.4, falloff: 1, slow: { mul: 0.6, dur: 2 } }]),
  },
  {
    id: 'pig', animal: '돼지', name: '꿀꿀이', stats: S({ hp: 1.05, mp: 1.03, speed: 0.96 }), weapon: 'spear', home: 12, join: 9,
    unique: U('복주머니', '마력을 60% 회복한다', '🐷', 30, 'coin', [{ t: 'heal', mp: 0.6 }], 0),
  },
  {
    id: 'cat', animal: '고양이', name: '야옹이', stats: S({ hp: 1.03, mp: 1.03, atk: 1.07, def: 1.03, speed: 1.07, crit: 1.08 }), weapon: 'sword', home: 0, join: 0, hidden: true, price: 100,
    unique: U('발톱 춤', '요괴 여섯을 옮겨 다니며 할퀸다', '🐱', 18, 'survSlash', [{ t: 'chain', range: 360, jumps: 6, jumpRange: 300, mul: 2.2, falloff: 1, kb: 60 }]),
  },
];

const BY_ID = new Map(HEROES.map((h) => [h.id, h]));
export const heroOf = (id: string): HeroDef => BY_ID.get(id as HeroId) ?? HEROES[0];
export const isHero = (id: string): id is HeroId => BY_ID.has(id as HeroId);
/** 처음부터 있는 대원 (쥐·소·호랑이) */
export const STARTERS: HeroId[] = HEROES.filter((h) => h.join === 0 && !h.hidden).map((h) => h.id);
/** 그 지형 보스를 처음 잡으면 합류하는 대원 (없으면 null) */
export const joinsAt = (region: number): HeroDef | null => HEROES.find((h) => h.join === region && !h.hidden) ?? null;
