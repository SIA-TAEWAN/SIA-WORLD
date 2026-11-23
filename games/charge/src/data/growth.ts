import { ZODIAC_IDS, LEADERS, type LeaderId, type ZodiacId } from './balance';

/**
 * 판 밖 성장 (PRD 9장): 엽전 · 영구 강화 · 지역 열기 · 대장 해금.
 * 서버(supabase/migrations/061_charge.sql)가 같은 표로 다시 계산한다. 값을 바꾸면 SQL 도 함께 바꾸고
 * tests/sql.test.ts 로 확인한다.
 */

export type UpgradeKey = 'troops' | 'attack' | 'rate' | 'range' | 'boss' | 'coin';

export interface UpgradeDef {
  key: UpgradeKey;
  name: string;
  /** 레벨당 효과 글자 */
  per: string;
  max: number;
  /** 레벨 n → n+1 비용 = base + step × n */
  base: number;
  step: number;
}

export const UPGRADES: UpgradeDef[] = [
  { key: 'troops', name: '시작 대원', per: '+2명', max: 20, base: 60, step: 30 },
  { key: 'attack', name: '공격력', per: '+5%', max: 20, base: 80, step: 40 },
  { key: 'rate', name: '연사 속도', per: '+3%', max: 10, base: 100, step: 50 },
  { key: 'range', name: '사거리', per: '+3%', max: 5, base: 120, step: 80 },
  { key: 'boss', name: '보스 피해', per: '+5%', max: 10, base: 100, step: 50 },
  { key: 'coin', name: '엽전 획득', per: '+5%', max: 5, base: 150, step: 100 },
];

export type Upgrades = Partial<Record<UpgradeKey, number>>;

export const upgradeCost = (u: UpgradeDef, lv: number) => u.base + u.step * lv;

/** 강화 → 판에 주는 배율 */
export interface RunMods {
  startAdd: number;
  dmgMul: number;
  rangeMul: number;
  bossMul: number;
  coinMul: number;
}

export function modsOf(up: Upgrades): RunMods {
  const lv = (k: UpgradeKey) => Math.max(0, Math.min(UPGRADES.find((u) => u.key === k)!.max, Math.floor(up[k] ?? 0)));
  return {
    startAdd: 2 * lv('troops'),
    dmgMul: (1 + 0.05 * lv('attack')) * (1 + 0.03 * lv('rate')),
    rangeMul: 1 + 0.03 * lv('range'),
    bossMul: 1 + 0.05 * lv('boss'),
    coinMul: 1 + 0.05 * lv('coin'),
  };
}

export const NO_MODS: RunMods = modsOf({});

/** 지역 수 */
export const REGIONS = 12;
/** 지역 이름 (십이지 순서) */
export const REGION_NAMES = [
  '쥐의 들판', '소의 논밭', '호랑이 고개', '토끼의 달동산', '용의 연못', '뱀의 늪',
  '말의 성문', '양의 뜰', '원숭이의 누각', '닭의 새벽길', '개의 삼도천', '돼지의 염라전',
];
/** 지역 배경 (시아서바이벌·시아디펜스의 4종을 3지역씩) */
export type Ground = 'field' | 'bamboo' | 'palace' | 'underworld';
export const groundOf = (region: number): Ground => (['field', 'bamboo', 'palace', 'underworld'] as const)[Math.min(3, Math.floor((region - 1) / 3))];

/** 지역 r 을 여는 데 필요한 별 (+ 앞 지역 5번째 스테이지 클리어). 1지역은 0 */
export const regionStars = (region: number) => (region <= 1 ? 0 : (region - 1) * 9);

/** 스테이지 클리어 엽전: 15 + 5×지역 + 5×별 */
export const clearCoins = (region: number, stars: number) => 15 + 5 * region + 5 * stars;
/** 첫 클리어 보너스: 20 + 10×지역 */
export const firstCoins = (region: number) => 20 + 10 * region;
/** 실패했을 때: 별 0개 클리어 엽전 × 0.3 × 진행도 */
export const failCoins = (region: number, progress: number) => Math.floor(clearCoins(region, 0) * 0.3 * Math.max(0, Math.min(1, progress)));
/** 끝없는 모드: 20m 마다 1 + 쓰러뜨린 보스마다 5 */
export const endlessCoins = (meters: number, bosses: number) => Math.floor(Math.max(0, meters) / 20) + 5 * Math.max(0, bosses);

/** 엽전 최종: (판 엽전 + 상자 엽전) × 강화 배율 × 대장 배율 (내림) */
export const totalCoins = (raw: number, crate: number, coinMul: number, leaderMul: number) => Math.floor((raw + crate) * coinMul * leaderMul);

/** 클리어한 스테이지로 열리는 대장 (십이지만. 고양이 같은 추가 캐릭터는 진행으로 열리지 않는다) */
export function unlockedLeaders(cleared: (stageId: string) => boolean): LeaderId[] {
  return LEADERS.filter((l) => !l.extra && (l.starter || cleared(`${l.unlockRegion}-5`))).map((l) => l.id);
}

export const isZodiac = (id: string): id is ZodiacId => (ZODIAC_IDS as readonly string[]).includes(id);
