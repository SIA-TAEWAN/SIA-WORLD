/**
 * 판 밖 성장 (PRD 7장): 캐릭터 영구 레벨업과 공통 강화. 엽전으로 올린다.
 * 서버(supabase/migrations/048_defense.sql 의 _defense_level_costs · _defense_upgrades)와 같은 값이어야 한다
 * — tests/sql.test.ts 가 비교한다.
 */

/** 캐릭터 최대 레벨 */
export const CHAR_MAX_LV = 12;
/** 레벨마다 공격력 +4% (1레벨이 기준) */
export const LEVEL_DMG = 0.04;
/** 4·8·12레벨의 작은 추가 효과 */
export const PERKS = [
  { lv: 4, text: '사거리 +5%', range: 0.05 },
  { lv: 8, text: '배치·강화 비용 -5%', cost: 0.05 },
  { lv: 12, text: '공격 간격 -5%', haste: 0.05 },
] as const;

/** 레벨 n → n+1 로 올리는 엽전 (n = 1 … 11) */
export const LEVEL_COSTS = [40, 60, 90, 130, 180, 240, 320, 410, 520, 650, 800];
/** 지금 레벨에서 다음 레벨로 올리는 비용 (이미 최대면 null) */
export const levelCost = (lv: number): number | null => (lv >= 1 && lv < CHAR_MAX_LV ? LEVEL_COSTS[lv - 1] : null);

/** 그 레벨의 캐릭터가 받는 배율 */
export function levelMods(lv: number) {
  const L = Math.max(1, Math.min(CHAR_MAX_LV, Math.floor(lv) || 1));
  return {
    dmg: 1 + LEVEL_DMG * (L - 1),
    range: L >= 4 ? 1.05 : 1,
    cost: L >= 8 ? 0.95 : 1,
    every: L >= 12 ? 0.95 : 1,
  };
}

/** 공통 강화 (PRD 7장 표). 비용 = baseCost + step × 지금 레벨 */
export interface UpgradeDef {
  id: 'energy' | 'lives' | 'gain' | 'coin' | 'sell';
  name: string;
  icon: string;
  /** 레벨당 효과 설명 */
  text: string;
  max: number;
  baseCost: number;
  step: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'energy', name: '시작 기운', icon: '✨', text: '시작 기운 +5%', max: 5, baseCost: 80, step: 60 },
  { id: 'lives', name: '시작 생명', icon: '❤️', text: '시작 생명 +1', max: 5, baseCost: 60, step: 50 },
  { id: 'gain', name: '기운 획득', icon: '💫', text: '요괴 처치 기운 +3%', max: 5, baseCost: 80, step: 60 },
  { id: 'coin', name: '엽전 획득', icon: '🪙', text: '얻는 엽전 +5%', max: 5, baseCost: 100, step: 80 },
  { id: 'sell', name: '되팔기 환급', icon: '♻️', text: '되팔기 환급 +5%', max: 3, baseCost: 80, step: 80 },
];

export const upgradeOf = (id: string): UpgradeDef | undefined => UPGRADES.find((u) => u.id === id);
/** 지금 레벨에서 한 단계 올리는 비용 (최대면 null) */
export function upgradeCost(id: string, lv: number): number | null {
  const u = upgradeOf(id);
  return u && lv >= 0 && lv < u.max ? u.baseCost + u.step * lv : null;
}

export type Upgrades = Partial<Record<UpgradeDef['id'], number>>;
const lvOf = (up: Upgrades | undefined, id: UpgradeDef['id']) => Math.max(0, Math.min(upgradeOf(id)!.max, Math.floor(up?.[id] ?? 0) || 0));

/** 공통 강화가 판에 주는 값 */
export function upgradeMods(up: Upgrades | undefined) {
  return {
    /** 시작 기운 배율 */
    energy: 1 + 0.05 * lvOf(up, 'energy'),
    /** 시작 생명에 더하는 수 */
    lives: lvOf(up, 'lives'),
    /** 처치 기운 배율 */
    gain: 1 + 0.03 * lvOf(up, 'gain'),
    /** 엽전 배율은 정수 계산: 엽전 × (100 + coinPct) / 100 내림 */
    coinPct: 5 * lvOf(up, 'coin'),
    /** 되팔기 환급 비율에 더하는 값 */
    sell: 0.05 * lvOf(up, 'sell'),
  };
}

/** 개발용: 모든 공통 강화를 n레벨로 (최대 레벨까지만) */
export const presetUpgrades = (n: number): Upgrades => Object.fromEntries(UPGRADES.map((u) => [u.id, Math.min(u.max, Math.max(0, n))]));
