/**
 * 성장 (PRD '성장과 플레이 시간'): 레벨별 기본 능력치와 경험치. 숫자는 초안 — 5·6단계(npm run pace)에서 15시간 곡선에 맞춘다.
 * 서버(078_twelve.sql)가 생기면 경험치·엽전은 서버가 같은 표로 계산한다.
 */
import { heroOf, type HeroId, type StatKey } from './heroes';
import { tierAtk, type WeaponKind } from './weapons';

export const MAX_LEVEL = 99;

/** 레벨만으로 정해지는 기본 능력치 */
export function baseStats(level: number): Record<StatKey, number> {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1;
  return { hp: 120 + 14 * n, mp: 50 + 2 * n, atk: 10 + 2.2 * n, def: 2 + 0.9 * n, speed: 235, crit: 0.08 };
}

/** 레벨 n → n+1 에 필요한 경험치 */
export const expNeed = (level: number) => (level >= MAX_LEVEL ? 0 : Math.round(30 * Math.pow(level, 1.55) + 20));

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
export const expPenalty = (myLevel: number, mapLevel: number) => {
  const d = myLevel - mapLevel;
  return d >= 20 ? 0.05 : d >= 10 ? 0.25 : 1;
};

/** 맵에 들고 들어가는 것. 4단계에서 방어구·장신구·강화·레어 효과가 더해진다 */
export interface Loadout {
  hero: HeroId;
  level: number;
  weapon: WeaponKind;
  /** 무기 공격력 (등급·강화·레어가 정한다. 지금은 등급만) */
  weaponAtk: number;
  /** 방어구가 주는 체력·방어 (4단계) */
  armorHp?: number;
  armorDef?: number;
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
    mp: Math.round(b.mp * hero.stats.mp),
    atk: (b.atk + lo.weaponAtk) * hero.stats.atk * (home ? HOME_BONUS : 1) * (affinity ? AFFINITY_BONUS : 1),
    def: (b.def + (lo.armorDef ?? 0)) * hero.stats.def * (home ? HOME_BONUS : 1),
    speed: b.speed * hero.stats.speed,
    crit: b.crit * hero.stats.crit,
    home,
    affinity,
  };
}

/** 장비 표가 생기기 전의 기본 무기: 내 레벨에 맞는 등급의 일반 무기 */
export const defaultLoadout = (hero: HeroId, level: number, weapon: WeaponKind, tier: number): Loadout => ({ hero, level, weapon, weaponAtk: tierAtk(tier) });
