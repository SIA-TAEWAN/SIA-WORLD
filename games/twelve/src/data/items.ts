/**
 * 장비 목록 (PRD '장비'): 무기 4종 × 12등급 · 방어구 12등급 (일반, 상점) + 지형별 레어 (드랍) + 장신구 (드랍 · 별 보상).
 * 숫자는 economy.ts 가 정하고, 여기는 목록과 이름만 만든다. 서버(078_twelve.sql 의 _twelve_items)는 이 목록에서 뽑은 줄을 쓴다.
 *
 * 장비 id:
 *   w-<무기>-<등급>   일반 무기          a-<등급>          일반 방어구
 *   r-<n|h><지형>-<1~3>  지형 레어 (1·2 = 무기, 3 = 방어구. n 보통 · h 어려움)
 *   c-<능력>-<등급>   장신구 (드랍)      s-<n|h><지형>     지형 별 24개 보상 장신구
 */
import {
  ACC_STATS,
  MAX_PLUS,
  STAR_ACC_MUL,
  TIERS,
  WEAPON_FX,
  accValue,
  armorDefOf,
  armorHpOf,
  buyPrice,
  regionTier,
  scrapStones,
  sellPrice,
  weaponAtkOf,
  type AccStat,
  type FxId,
} from './economy';
import { heroOf } from './heroes';
import { MODES, REGION_TABLE, type Mode } from './regions';
import { TIER_LEVELS, WEAPONS, WEAPON_KINDS, type WeaponKind } from './weapons';

export const SLOTS = ['weapon', 'armor', 'acc'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_NAME: Record<Slot, string> = { weapon: '무기', armor: '방어구', acc: '장신구' };

export interface ItemDef {
  id: string;
  slot: Slot;
  name: string;
  icon: string;
  /** 등급 0~11 (착용 레벨 = TIER_LEVELS[tier]) */
  tier: number;
  rare: boolean;
  /** 무기 종류 */
  kind?: WeaponKind;
  /** 레어 특수 효과 */
  fx?: FxId;
  /** 장신구가 올리는 능력과 값 */
  stat?: AccStat;
  value?: number;
  /** 상점 값 (0 = 팔지 않는다) · 파는 값 · 분해 강화석 */
  buy: number;
  sell: number;
  scrap: number;
  /** 레어·별 보상이 나오는 곳 */
  region?: number;
  mode?: Mode;
}

/** 내가 가진 장비 하나 */
export interface Item {
  id: string;
  base: string;
  /** 강화 +0~+9 */
  plus: number;
  /** 잠금 (팔기·분해 방지) */
  lock: boolean;
  /** 가방이 꽉 차서 보관함에 있다 */
  box: boolean;
}

const TIER_WORD = ['나무', '무쇠', '청동', '강철', '백은', '황금', '흑철', '비취', '용린', '천둥', '월광', '여의'];
export const FX_NAME: Record<FxId, string> = { burn: '불길', twin: '연속 베기', leech: '흡혈', ice: '얼음', thrift: '마력 절약', keen: '치명타 강화', ward: '수호' };
export const FX_DESC: Record<FxId, string> = {
  burn: '맞은 요괴가 불에 타요',
  twin: '가끔 한 번 더 베어요',
  leech: '준 피해의 일부만큼 체력을 회복해요',
  ice: '맞은 요괴가 느려져요',
  thrift: '스킬 마력이 20% 줄어요',
  keen: '치명타가 더 아파요',
  ward: '받는 피해가 줄고, 지형 환경 피해가 절반이 돼요',
};
const ACC_NAME: Record<AccStat, string> = { mp: '마력 구슬', speed: '바람 방울', crit: '매의 눈', potion: '약초 주머니', coin: '복주머니' };
const ACC_ICON: Record<AccStat, string> = { mp: '🔮', speed: '🎐', crit: '🧿', potion: '🌿', coin: '👛' };
export const ACC_TEXT: Record<AccStat, string> = { mp: '마력', speed: '이동 속도', crit: '치명타', potion: '물약 효과', coin: '엽전 획득' };
const MODE_KEY: Record<Mode, string> = { normal: 'n', hard: 'h' };

const list: ItemDef[] = [];
for (let t = 0; t < TIERS; t++) {
  for (const k of WEAPON_KINDS) {
    list.push({ id: `w-${k}-${t}`, slot: 'weapon', name: `${TIER_WORD[t]} ${WEAPONS[k].name}`, icon: WEAPONS[k].icon, tier: t, rare: false, kind: k, buy: buyPrice(t), sell: sellPrice(t, 'normal'), scrap: scrapStones(t, false) });
  }
  list.push({ id: `a-${t}`, slot: 'armor', name: `${TIER_WORD[t]} 갑옷`, icon: '🛡️', tier: t, rare: false, buy: buyPrice(t), sell: sellPrice(t, 'normal'), scrap: scrapStones(t, false) });
  for (const st of ACC_STATS) {
    list.push({ id: `c-${st}-${t}`, slot: 'acc', name: `${ACC_NAME[st]} ${t + 1}단`, icon: ACC_ICON[st], tier: t, rare: false, stat: st, value: accValue(st, t), buy: 0, sell: sellPrice(t, 'acc'), scrap: scrapStones(t, false) });
  }
}
for (const mode of MODES) {
  for (const r of REGION_TABLE) {
    const t = regionTier(r.region, mode);
    const animal = heroOf(r.home).animal;
    const head = `${mode === 'hard' ? '깊은 ' : ''}${animal}의`;
    const key = `${MODE_KEY[mode]}${r.region}`;
    // 레어 무기 둘: 고향 대원이 잘 다루는 무기 + 다른 무기 하나. 효과는 지형마다 돌아가며 (어려움은 한 칸 밀어서)
    const k1 = heroOf(r.home).weapon;
    const k2 = WEAPON_KINDS.filter((k) => k !== k1)[r.region % 3];
    const shift = mode === 'hard' ? 1 : 0;
    [k1, k2].forEach((k, i) => {
      const fx = WEAPON_FX[(r.region - 1 + i * 3 + shift) % WEAPON_FX.length];
      list.push({ id: `r-${key}-${i + 1}`, slot: 'weapon', name: `${head} ${FX_NAME[fx]} ${WEAPONS[k].name}`, icon: WEAPONS[k].icon, tier: t, rare: true, kind: k, fx, buy: 0, sell: sellPrice(t, 'rare'), scrap: scrapStones(t, true), region: r.region, mode });
    });
    list.push({ id: `r-${key}-3`, slot: 'armor', name: `${head} 수호 갑옷`, icon: '🛡️', tier: t, rare: true, fx: 'ward', buy: 0, sell: sellPrice(t, 'rare'), scrap: scrapStones(t, true), region: r.region, mode });
    const st = ACC_STATS[(r.region - 1) % ACC_STATS.length];
    list.push({ id: `s-${key}`, slot: 'acc', name: `${mode === 'hard' ? '깊은 ' : ''}${r.name}의 별`, icon: '🌟', tier: t, rare: true, stat: st, value: Math.round(accValue(st, t) * STAR_ACC_MUL), buy: 0, sell: sellPrice(t, 'acc'), scrap: scrapStones(t, false), region: r.region, mode });
  }
}

export const ITEMS: readonly ItemDef[] = list;
const BY_ID = new Map(list.map((d) => [d.id, d]));
export const itemDef = (base: string): ItemDef | null => BY_ID.get(base) ?? null;
/** 착용 레벨 */
export const itemLevel = (d: ItemDef) => TIER_LEVELS[d.tier];
/** 그 지형에서만 나오는 레어 (드랍 목록) */
export const regionRares = (region: number, mode: Mode): string[] => [1, 2, 3].map((i) => `r-${MODE_KEY[mode]}${region}-${i}`);
/** 지형 별 24개 보상 장신구 */
export const starReward = (region: number, mode: Mode) => `s-${MODE_KEY[mode]}${region}`;
export const normalWeapon = (kind: WeaponKind, tier: number) => `w-${kind}-${tier}`;
export const normalArmor = (tier: number) => `a-${tier}`;
export const accessory = (stat: AccStat, tier: number) => `c-${stat}-${tier}`;
/** 일반 장비 드랍 후보 (칼·창·활·부채·갑옷 — 순서가 드랍 판정에 쓰인다) */
export const gearDrops = (tier: number): string[] => [...WEAPON_KINDS.map((k) => normalWeapon(k, tier)), normalArmor(tier)];
/** 강화할 수 있는 장비인지 (장신구는 강화 없음) */
export const canEnhance = (d: ItemDef) => d.slot !== 'acc';

/** 장비의 능력치 (강화 포함). 비교 화면과 전투가 같이 쓴다 */
export interface ItemStats {
  atk: number;
  hp: number;
  def: number;
}
export function itemStats(d: ItemDef, plus: number): ItemStats {
  const p = Math.max(0, Math.min(MAX_PLUS, plus));
  if (d.slot === 'weapon') return { atk: weaponAtkOf(d.tier, p, d.rare), hp: 0, def: 0 };
  if (d.slot === 'armor') return { atk: 0, hp: armorHpOf(d.tier, p, d.rare), def: armorDefOf(d.tier, p, d.rare) };
  return { atk: 0, hp: 0, def: 0 };
}
/** 장비 한 줄 설명 (특수 효과 · 장신구 능력) */
export function itemNote(d: ItemDef): string {
  if (d.stat) return `${ACC_TEXT[d.stat]} +${d.value}${d.stat === 'crit' ? '%p' : '%'}`;
  if (d.fx) return `${FX_NAME[d.fx]}: ${FX_DESC[d.fx]}`;
  return '';
}
