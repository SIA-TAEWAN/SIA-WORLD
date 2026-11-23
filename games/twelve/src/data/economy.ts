/**
 * 장비·드랍·상점·대장간의 숫자를 한 곳에 (PRD '장비' · '드랍과 확정 보정' · '마을·상점·대장간').
 * 밸런스(npm run pace)에서 고치는 값은 여기와 growth.ts(경험치 곡선)에 모여 있다.
 * 여기 값을 바꾸면 `npm run sqlgen` 으로 078_twelve.sql 의 표를 다시 만든다 (tests/sql.test.ts 가 대조한다).
 */
import type { Mode } from './regions';
import { TIER_LEVELS, tierAtk } from './weapons';

export const TIERS = TIER_LEVELS.length;

/**
 * 지형에서 나오는 장비 등급 (0~11, 착용 레벨 TIER_LEVELS).
 * PRD '성장' 표: 보통 1~4지형 Lv1~18 · 5~8지형 Lv27~45 · 9~12지형 Lv54~63, 어려움 1~6지형 Lv72~81 · 7~12지형 Lv90~99
 */
export const REGION_TIER: Record<Mode, readonly number[]> = {
  normal: [0, 0, 1, 2, 3, 3, 4, 5, 6, 6, 7, 7],
  hard: [8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11],
};
export const regionTier = (region: number, mode: Mode) => REGION_TIER[mode][Math.max(1, Math.min(12, region)) - 1];

// ---------- 장비 능력치 ----------

/** 레어: 같은 착용 레벨 일반보다 +20% */
export const RARE_MUL = 1.2;
export const MAX_PLUS = 9;
/** 일반 방어구의 체력 · 방어 */
export const tierHp = (tier: number) => 20 + 40 * tier + 4 * tier * tier;
export const tierDef = (tier: number) => 1 + 2.5 * tier + 0.2 * tier * tier;
/** 강화: +9 가 다음 등급 일반과 같아지게 등급 차이를 9로 나눠 올린다 */
const plusOf = (f: (tier: number) => number, tier: number, plus: number, rare: boolean) => Math.round((f(tier) + ((f(tier + 1) - f(tier)) * plus) / MAX_PLUS) * (rare ? RARE_MUL : 1));
export const weaponAtkOf = (tier: number, plus: number, rare: boolean) => plusOf(tierAtk, tier, plus, rare);
export const armorHpOf = (tier: number, plus: number, rare: boolean) => plusOf(tierHp, tier, plus, rare);
export const armorDefOf = (tier: number, plus: number, rare: boolean) => plusOf(tierDef, tier, plus, rare);

/** 장신구가 올려 주는 것 (하나씩). mp·speed·potion·coin 은 % 더하기, crit 은 %p 더하기 */
export const ACC_STATS = ['mp', 'speed', 'crit', 'potion', 'coin'] as const;
export type AccStat = (typeof ACC_STATS)[number];
export const accValue = (stat: AccStat, tier: number): number =>
  ({ mp: 10 + 2 * tier, speed: 3 + 0.5 * tier, crit: 2 + 0.5 * tier, potion: 10 + 3 * tier, coin: 5 + tier + Math.floor(tier / 2) })[stat];
/** 지형 별 24개 보상 장신구는 같은 등급 드랍의 1.5배 */
export const STAR_ACC_MUL = 1.5;

/** 레어 특수 효과 (PRD '장비'). 무기 6가지 + 방어구 1가지 */
export const FX = {
  /** 불길: 맞은 요괴가 dur 초 동안 초당 공격력 × mul 피해 */
  burn: { mul: 0.25, dur: 3 },
  /** 연속 베기: chance 확률로 한 번 더 (피해 × mul) */
  twin: { chance: 0.15, mul: 0.6 },
  /** 흡혈: 준 피해의 rate 만큼 체력 회복 */
  leech: { rate: 0.03 },
  /** 얼음: 맞은 요괴가 dur 초 동안 느려짐 */
  ice: { mul: 0.7, dur: 1.5 },
  /** 마력 절약: 스킬 마력 × mul */
  thrift: { mul: 0.8 },
  /** 치명타 강화: 치명타 배율 1.5 → mul */
  keen: { mul: 1.9 },
  /** 수호(방어구): 받는 피해 × mul. 지형 환경 피해(6단계)는 × env */
  ward: { mul: 0.92, env: 0.5 },
} as const;
export type FxId = keyof typeof FX;
export const WEAPON_FX: readonly FxId[] = ['burn', 'twin', 'leech', 'ice', 'thrift', 'keen'];

// ---------- 드랍 (PRD 드랍 표. 확률은 1/10000 단위 — SQL 과 같은 정수 비교) ----------

export const DROP = {
  /** 일반 요괴: 물약 5% · 일반 장비 3% */
  potion: 500,
  gear: 300,
  /** 정예: 강화석 30% · 장신구 5% · 레어 1% */
  eliteStone: 3000,
  eliteAcc: 500,
  eliteRare: 100,
  /** 보스: 강화석 항상 · 장신구 30% · 레어 10% · 열쇠 40% */
  bossAcc: 3000,
  bossRare: 1000,
  key: 4000,
} as const;
/** 확정 보정: 그 지형에서 레어 없이 정예 100마리 또는 보스 8번, 같은 보스 3번째에 열쇠 */
export const PITY = { elite: 100, boss: 8, key: 3 } as const;
/** 강화석 수: 정예 1개, 보스 3 + 등급÷2 */
export const eliteStones = (_tier: number) => 1;
export const bossStones = (tier: number) => 3 + Math.floor(tier / 2);

// ---------- 가방 ----------

export const BAG = { size: 40, step: 8, max: 80 } as const;
/** 가방을 size 칸에서 한 번 늘리는 값 */
export const bagPrice = (size: number) => {
  const n = Math.floor((size - BAG.size) / BAG.step) + 1;
  return 300 * n * n;
};

// ---------- 상점 · 대장간 ----------

/** 일반 무기·방어구 값 */
export const buyPrice = (tier: number) => 50 * (tier + 1) * (tier + 1);
/** 파는 값 = 그 등급 일반 장비 값의 비율 (%) */
export const SELL_PCT = { normal: 25, rare: 60, acc: 30 } as const;
export const sellPrice = (tier: number, kind: keyof typeof SELL_PCT) => Math.floor((buyPrice(tier) * SELL_PCT[kind]) / 100);
/** 분해해서 받는 강화석: 1 + 등급÷2 (레어 +3 + 등급÷2), 강화한 단계마다 +1 */
export const scrapStones = (tier: number, rare: boolean) => 1 + Math.floor(tier / 2) + (rare ? 3 + Math.floor(tier / 2) : 0);
/** 강화: +(n-1) → +n 의 값 (항상 성공) */
export const enhanceCost = (tier: number, n: number) => ({ coins: 30 * (tier + 1) * n, stones: Math.ceil(n / 2) + Math.floor(tier / 3) });

/** 물약 소·중·대: 회복량(최대치의 비율) · 값 */
export const POTION_SIZES = 3;
export const POTION_NAME = ['소', '중', '대'] as const;
export const POTION = {
  heal: [
    [0.4, 0.7, 1],
    [0.5, 0.8, 1],
  ],
  price: [
    [15, 60, 200],
    [15, 60, 200],
  ],
  /** 종류마다 가질 수 있는 수 */
  max: 20,
  /** 처음 받는 물약 [체력 소·중·대, 마력 소·중·대] */
  start: [
    [5, 0, 0],
    [3, 0, 0],
  ],
} as const;
/** 드랍되는 물약 크기 (등급에 따라) */
export const potionSizeForTier = (tier: number) => (tier <= 2 ? 0 : tier <= 5 ? 1 : 2);
