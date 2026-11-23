/**
 * 성장 (PRD '성장과 플레이 시간'): 레벨별 기본 능력치와 경험치. 숫자는 초안 — 6단계(npm run pace)에서 15시간 곡선에 맞춘다.
 * 서버(078_twelve.sql)는 같은 표(_twelve_levels · _twelve_maps)로 경험치·엽전을 계산한다.
 */
import type { AccStat, FxId } from './economy';
import { heroOf, type HeroId, type StatKey } from './heroes';
import { tierAtk, type WeaponKind } from './weapons';

export const MAX_LEVEL = 99;

/** 레벨만으로 정해지는 기본 능력치 */
export function baseStats(level: number): Record<StatKey, number> {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1;
  return { hp: 120 + 14 * n, mp: 50 + 2 * n, atk: 10 + 2.2 * n, def: 2 + 0.9 * n, speed: 235, crit: 0.08 };
}

/**
 * 목표 곡선 (PRD '성장' 표): 누적 시간 → 도착 레벨. npm run pace 가 이 표에 맞는지 본다.
 * mode · 마지막 지형 · 누적 시간(시간) · 도착 레벨
 */
export const GROWTH_TARGETS = [
  { mode: 'normal', region: 4, hours: 4, level: 25 },
  { mode: 'normal', region: 8, hours: 9, level: 45 },
  { mode: 'normal', region: 12, hours: 15, level: 65 },
  { mode: 'hard', region: 6, hours: 22, level: 82 },
  { mode: 'hard', region: 12, hours: 30, level: 99 },
] as const;

/** 경험치 곡선: 레벨 n → n+1 에 필요한 경험치 = round(base × n^pow + add). 바꾸면 npm run sqlgen (서버 _twelve_levels 표) */
export const EXP_CURVE = { base: 130, pow: 1.4, add: 0 };
export const expNeed = (level: number) => (level >= MAX_LEVEL ? 0 : Math.round(EXP_CURVE.base * Math.pow(level, EXP_CURVE.pow) + EXP_CURVE.add));

/** 경험치를 더한 뒤의 레벨·경험치 */
export function addExp(level: number, exp: number, gain: number): { level: number; exp: number; ups: number } {
  let lv = level;
  let e = exp + Math.max(0, Math.floor(gain));
  let ups = 0;
  while (lv < MAX_LEVEL && e >= expNeed(lv)) {
    e -= expNeed(lv);
    lv++;
    ups++;
  }
  if (lv >= MAX_LEVEL) e = 0;
  return { level: lv, exp: e, ups };
}

/** 내 레벨이 맵 권장 레벨보다 높을 때의 경험치 배율 (PRD: 10 이상 높으면 크게 줄어든다) */
export const EXP_PENALTY = [
  { gap: 20, pct: 5 },
  { gap: 10, pct: 25 },
] as const;
/** 경험치 배율 (%, 정수 — 서버와 같은 정수 계산) */
export const expPenaltyPct = (myLevel: number, mapLevel: number): number => EXP_PENALTY.find((r) => myLevel - mapLevel >= r.gap)?.pct ?? 100;
export const expPenalty = (myLevel: number, mapLevel: number) => expPenaltyPct(myLevel, mapLevel) / 100;

/** 맵에 들고 들어가는 것 (착용한 장비에서 나온다: progress.ts 의 loadoutOf) */
export interface Loadout {
  hero: HeroId;
  level: number;
  weapon: WeaponKind;
  /** 무기 공격력 (등급·강화·레어가 정한다) */
  weaponAtk: number;
  /** 방어구가 주는 체력·방어 */
  armorHp?: number;
  armorDef?: number;
  /** 레어 특수 효과 (무기·방어구) */
  fx?: FxId[];
  /** 장신구: mp·speed·potion·coin 은 % 더하기, crit 은 %p 더하기 */
  bonus?: Partial<Record<AccStat, number>>;
}

export const HOME_BONUS = 1.1;
export const AFFINITY_BONUS = 1.05;

export interface PlayerStats extends Record<StatKey, number> {
  /** 고향 지형인지 · 잘 다루는 무기인지 (화면 표시용) */
  home: boolean;
  affinity: boolean;
}

/** 맵에서의 최종 능력치 */
export function playerStats(lo: Loadout, region: number): PlayerStats {
  const hero = heroOf(lo.hero);
  const b = baseStats(lo.level);
  const home = hero.home === region;
  const affinity = hero.weapon === lo.weapon;
  return {
    hp: Math.round((b.hp + (lo.armorHp ?? 0)) * hero.stats.hp),
    mp: Math.round(b.mp * hero.stats.mp * (1 + (lo.bonus?.mp ?? 0) / 100)),
    atk: (b.atk + lo.weaponAtk) * hero.stats.atk * (home ? HOME_BONUS : 1) * (affinity ? AFFINITY_BONUS : 1),
    def: (b.def + (lo.armorDef ?? 0)) * hero.stats.def * (home ? HOME_BONUS : 1),
    speed: b.speed * hero.stats.speed * (1 + (lo.bonus?.speed ?? 0) / 100),
    crit: b.crit * hero.stats.crit + (lo.bonus?.crit ?? 0) / 100,
    home,
    affinity,
  };
}

/** 시험·도구용: 그 등급의 일반 무기만 든 차림 */
export const defaultLoadout = (hero: HeroId, level: number, weapon: WeaponKind, tier: number): Loadout => ({ hero, level, weapon, weaponAtk: tierAtk(tier) });
