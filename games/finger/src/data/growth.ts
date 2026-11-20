import { HERO_IDS, HEROES, MAX_LEVEL, UPGRADE_MAX, type HeroId, type UpgradeKey, type Upgrades } from '../sim';
import { REGIONS } from './regions';

/**
 * 판 밖 성장 (PRD "성장·재화"): 스테이지 보상 · 대원 레벨 가격 · 공통 강화.
 * 서버(supabase/migrations/067_finger.sql)가 같은 표로 다시 계산한다. 값을 바꾸면 SQL 도 함께 바꾸고
 * tests/sql.test.ts 로 확인한다 (npm run sqlrows 로 SQL 줄을 만든다).
 * 강화 효과(체력 +3% 등)는 판에 들어가는 값이라 _shared/finger/heroes.ts 의 heroStats 에 있다.
 */

// ---------- 공통 강화 4종 ----------

export interface UpgradeDef {
  key: UpgradeKey;
  name: string;
  /** 한 단계 효과 글자 */
  per: string;
  max: number;
  /** 단계 n → n+1 비용 = base + step × n */
  base: number;
  step: number;
}

export const UPGRADES: UpgradeDef[] = [
  { key: 'hp', name: '시작 체력', per: '모든 대원 체력 +3%', max: UPGRADE_MAX.hp, base: 60, step: 30 },
  { key: 'charge', name: '필살기 충전', per: '처음부터 1턴만큼 차 있음', max: UPGRADE_MAX.charge, base: 150, step: 100 },
  { key: 'heal', name: '회복량', per: '회복 +10%', max: UPGRADE_MAX.heal, base: 80, step: 40 },
  { key: 'coin', name: '엽전 획득', per: '엽전 +5%', max: UPGRADE_MAX.coin, base: 150, step: 100 },
];

export const upgradeOf = (k: string) => UPGRADES.find((u) => u.key === k);
export const upgradeCost = (u: UpgradeDef, lv: number) => u.base + u.step * lv;
export const upgradeLv = (up: Upgrades, k: UpgradeKey) => Math.max(0, Math.min(UPGRADE_MAX[k], Math.floor(up[k] ?? 0)));

// ---------- 대원 레벨 1~30 ----------

/** 레벨 lv → lv+1 비용 = LEVEL_BASE + LEVEL_STEP × (lv − 1). 1→2 는 30, 29→30 은 450, 한 대원 1→30 합 6,960 */
export const LEVEL_BASE = 30;
export const LEVEL_STEP = 15;
export const levelCost = (lv: number) => LEVEL_BASE + LEVEL_STEP * (lv - 1);
/** 가격표: [레벨, 그 레벨에서 다음 레벨로 가는 비용] (레벨 1~29) */
export const LEVEL_TABLE: [number, number][] = Array.from({ length: MAX_LEVEL - 1 }, (_, i) => [i + 1, levelCost(i + 1)]);
/** 우정 콤보가 한 단계씩 강해지는 레벨 */
export const COMBO_LEVELS = [10, 20, 30];
export const levelOf = (levels: Partial<Record<HeroId, number>>, id: HeroId) => Math.max(1, Math.min(MAX_LEVEL, Math.floor(levels[id] ?? 1)));

// ---------- 스테이지 보상 ----------

export interface StageReward {
  id: string;
  region: number;
  no: number;
  /** 별 0개 클리어 엽전 (실패 엽전의 기준) */
  clear: number;
  /** 별 하나마다 */
  star: number;
  /** 첫 클리어 보너스 */
  first: number;
}

/**
 * 보상 식 (60스테이지 모두, id 는 `${지역}-${번호}`):
 *  클리어 20 + 8×지역 (+10 보스 스테이지) · 별마다 8 · 첫 클리어 30 + 15×지역 (+20 보스 스테이지)
 */
export function rewardOf(region: number, no: number): StageReward {
  const boss = no === 5;
  return { id: `${region}-${no}`, region, no, clear: 20 + 8 * region + (boss ? 10 : 0), star: 8, first: 30 + 15 * region + (boss ? 20 : 0) };
}

export const STAGE_REWARDS: StageReward[] = Array.from({ length: REGIONS * 5 }, (_, i) => rewardOf(Math.floor(i / 5) + 1, (i % 5) + 1));
export const rewardFor = (id: string) => STAGE_REWARDS.find((r) => r.id === id);

/** 클리어 엽전 (첫 클리어 보너스 제외) */
export const clearCoins = (rw: StageReward, stars: number) => rw.clear + rw.star * stars;
/** 실패: 별 0개 클리어 엽전 × 0.3 × (넘긴 웨이브 / 웨이브 수), 내림 */
export const failCoins = (rw: StageReward, wave: number, waves: number) =>
  waves > 0 ? Math.floor((rw.clear * 3 * Math.max(0, Math.min(wave, waves))) / (10 * waves)) : 0;
/** 판 안에서 주운 엽전 상한 (이상한 값 막기) */
export const PICK_CAP = 300;
/** 엽전 최종: (보상 + 주운 엽전) × (100 + 5 × 엽전 강화)% , 내림 (정수 계산) */
export const totalCoins = (raw: number, picked: number, up: Upgrades) =>
  Math.floor(((raw + Math.max(0, Math.min(PICK_CAP, picked))) * (100 + 5 * upgradeLv(up, 'coin'))) / 100);

/** 대원 합류 표: [대원, 합류 지역 (0 = 처음부터)] */
export const HERO_UNLOCKS: [HeroId, number][] = HERO_IDS.map((id) => [id, HEROES[id].unlockRegion]);
