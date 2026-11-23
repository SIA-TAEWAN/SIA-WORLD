/**
 * 서버 표 줄 만들기: 게임 데이터(src/data) → supabase/migrations/089_twelve_full.sql 의 `-- <gen:이름>` ~ `-- </gen:이름>` 사이.
 * `npm run sqlgen` 이 그 사이를 다시 쓰고, tests/sql.test.ts 가 파일과 여기 결과가 같은지 본다.
 * 숫자(경험치 곡선·요괴 보상·드랍 확률·값)를 바꾸면 sqlgen 만 다시 돌리면 된다 — SQL 의 계산 순서는 그대로다.
 */
import { EXIT_KILL_RATIO } from './balance';
import { ACC_STATS, BAG, BOSS_GIFT, DROP, MAX_PLUS, PITY, POTION, POTION_SIZES, TIERS, bagPrice, bossStones, eliteStones, enhanceCost, potionSizeForTier, regionTier } from './economy';
import { EXP_PENALTY, MAX_LEVEL, expNeed } from './growth';
import { HEROES } from './heroes';
import { ITEMS, canEnhance, regionRares, starReward } from './items';
import { MAPS } from './maps';
import { TOWER } from './tower';
import { HARD_READY, MODES, REGIONS, type Mode } from './regions';
import { WEAPON_KINDS } from './weapons';
import { LIMITS, STARTER_ITEMS, mapReward } from '../game/progress';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const row = (...cols: (string | number | boolean)[]) => `(${cols.join(', ')})`;
/** 준비된 모드 (어려움은 HARD_READY 뒤에) */
const readyModes = (): Mode[] => MODES.filter((m) => m === 'normal' || HARD_READY);

/** 맵: id · 모드 · 지형 · 번호 · 권장 레벨 · 별 시간 · 보스 맵 · 요괴 수 · 정예 수 · 정예 경험치/엽전 · 보스 경험치/엽전 · 상자 엽전 · 종류별 [최대, 경험치, 엽전] */
export function mapRows(): string[] {
  const out: string[] = [];
  for (const mode of readyModes()) {
    for (const m of MAPS) {
      const r = mapReward(m, mode);
      const kinds = Object.fromEntries(Object.entries(r.kinds).map(([k, v]) => [k, [v.max, v.exp, v.coin]]));
      out.push(row(q(m.id), q(mode), m.region, m.no, r.level, m.par, !!m.boss, r.total, r.elites, r.eliteExp, r.eliteCoin, r.bossExp, r.bossCoin, r.chestCoin, `${q(JSON.stringify(kinds))}::jsonb`));
    }
  }
  return out;
}

/** 레벨 n → n+1 에 필요한 경험치 */
export const levelRows = (): string[] => Array.from({ length: MAX_LEVEL - 1 }, (_, i) => row(i + 1, expNeed(i + 1)));

/** 내 레벨 − 맵 권장 레벨이 gap 이상이면 경험치 pct% */
export const penaltyRows = (): string[] => EXP_PENALTY.map((p) => row(p.gap, p.pct));

/** 장비: id · 칸 · 등급 · 레어 · 강화 가능 · 상점 값(0 = 안 판다) · 파는 값 · 분해 강화석 · 엽전 획득 % */
export const itemRows = (): string[] => ITEMS.map((d) => row(q(d.id), q(d.slot), d.tier, d.rare, canEnhance(d), d.buy, d.sell, d.scrap, d.stat === 'coin' ? (d.value ?? 0) : 0));

/** 지형(모드별): 등급 · 정예 강화석 · 보스 강화석 · 드랍 물약 크기 · 별 24개 보상 · 레어 목록 */
export function regionRows(): string[] {
  const out: string[] = [];
  for (const mode of MODES) {
    for (let r = 1; r <= REGIONS; r++) {
      const t = regionTier(r, mode);
      out.push(row(q(mode), r, t, eliteStones(t), bossStones(t), potionSizeForTier(t), q(starReward(r, mode)), `array[${regionRares(r, mode).map(q).join(', ')}]`));
    }
  }
  return out;
}

/** 강화: 등급 · 올라갈 단계(1~9) · 엽전 · 강화석 */
export function enhanceRows(): string[] {
  const out: string[] = [];
  for (let t = 0; t < TIERS; t++) for (let n = 1; n <= MAX_PLUS; n++) out.push(row(t, n, enhanceCost(t, n).coins, enhanceCost(t, n).stones));
  return out;
}

/** 가방 늘리기: 지금 칸 수 · 값 */
export function bagRows(): string[] {
  const out: string[] = [];
  for (let size: number = BAG.size; size < BAG.max; size += BAG.step) out.push(row(size, bagPrice(size)));
  return out;
}

/** 물약: 종류(0 체력 · 1 마력) · 크기 · 값 */
export function potionRows(): string[] {
  const out: string[] = [];
  for (let s = 0; s < 2; s++) for (let z = 0; z < POTION_SIZES; z++) out.push(row(s, z, POTION.price[s][z]));
  return out;
}

/** 대원: id · 합류 지형 (0 처음부터 · -1 시아코인으로 여는 고양이) */
export const heroRows = (): string[] => HEROES.map((h) => row(q(h.id), h.hidden ? -1 : h.join));

/** 기준 값 (_twelve_const) */
export function constRows(): string[] {
  const c: Record<string, number> = {
    max_level: MAX_LEVEL,
    max_time: LIMITS.maxTime,
    clear_min_time: LIMITS.clearMinTime,
    time_slack: LIMITS.timeSlack,
    max_age: LIMITS.maxAge,
    coin_min_time: LIMITS.coinMinTime,
    coin_level_gap: LIMITS.coinLevelGap,
    exit_pct: Math.round(EXIT_KILL_RATIO * 100),
    drop_potion: DROP.potion,
    drop_gear: DROP.gear,
    drop_elite_stone: DROP.eliteStone,
    drop_elite_acc: DROP.eliteAcc,
    drop_elite_rare: DROP.eliteRare,
    drop_boss_acc: DROP.bossAcc,
    drop_boss_rare: DROP.bossRare,
    drop_key: DROP.key,
    pity_elite: PITY.elite,
    pity_boss: PITY.boss,
    pity_key: PITY.key,
    bag_size: BAG.size,
    bag_step: BAG.step,
    bag_max: BAG.max,
    potion_max: POTION.max,
    max_plus: MAX_PLUS,
    // 보스의 선물 (economy.ts 의 BOSS_GIFT): 그 지형 보스를 처음 잡으면 받는 강화석
    ...Object.fromEntries(Object.entries(BOSS_GIFT).map(([r, n]) => [`boss_gift_${r}`, n])),
    // 끝없는 탑 (data/tower.ts 의 TOWER)
    tower_cp: TOWER.cp,
    tower_elite_every: TOWER.eliteEvery,
    tower_min_time: TOWER.minTime,
    tower_boss_min_time: TOWER.bossMinTime,
    tower_coin_base: TOWER.coin.base,
    tower_coin_step: TOWER.coin.step,
    tower_coin_elite: TOWER.coin.elite,
    tower_coin_boss: TOWER.coin.boss,
    tower_stone_rate: TOWER.stone.rate,
    tower_stone_elite: TOWER.stone.elite,
    tower_stone_elite_step: TOWER.stone.eliteStep,
    tower_stone_boss: TOWER.stone.boss,
    tower_stone_boss_step: TOWER.stone.bossStep,
    tower_stone_max: TOWER.stone.max,
    tower_gear: TOWER.gear,
    tower_acc_elite: TOWER.acc.elite,
    tower_acc_boss: TOWER.acc.boss,
    tower_rare_elite: TOWER.rare.elite,
    tower_rare_elite_step: TOWER.rare.eliteStep,
    tower_rare_elite_max: TOWER.rare.eliteMax,
    tower_rare_boss: TOWER.rare.boss,
    tower_rare_boss_step: TOWER.rare.bossStep,
    tower_rare_boss_max: TOWER.rare.bossMax,
  };
  return Object.entries(c).map(([k, v]) => `    when ${q(k)} then ${v}`);
}

/** 한 줄짜리 값들 */
export const starterItems = () => `  select array[${STARTER_ITEMS.map(q).join(', ')}]::text[]`;
export const starterPotions = () => `  select ${q(JSON.stringify(POTION.start))}::jsonb`;
/** 일반 장비 드랍 후보의 앞 글자 (뒤에 등급을 붙인다) · 장신구 능력 — 순서가 드랍 판정에 쓰인다 */
export const gearPrefixes = () => `  select array[${[...WEAPON_KINDS.map((k) => `w-${k}-`), 'a-'].map(q).join(', ')}]::text[]`;
export const accStats = () => `  select array[${ACC_STATS.map(q).join(', ')}]::text[]`;

const values = (rows: string[]) => rows.map((r) => `    ${r}`).join(',\n');
/** 블록 이름 → 그 사이에 들어갈 글 */
export function sqlBlocks(): Record<string, string> {
  return {
    const: constRows().join('\n'),
    maps: values(mapRows()),
    levels: values(levelRows()),
    penalty: values(penaltyRows()),
    items: values(itemRows()),
    regions: values(regionRows()),
    enhance: values(enhanceRows()),
    bag: values(bagRows()),
    potions: values(potionRows()),
    heroes: values(heroRows()),
    starter: starterItems(),
    starter_potions: starterPotions(),
    gear: gearPrefixes(),
    acc: accStats(),
  };
}

const open = (name: string) => `-- <gen:${name}>`;
const close = (name: string) => `-- </gen:${name}>`;
/** SQL 파일에서 블록 하나의 글 (없으면 null) */
export function blockIn(sql: string, name: string): string | null {
  const a = sql.indexOf(open(name));
  const b = sql.indexOf(close(name));
  if (a < 0 || b < a) return null;
  return sql.slice(sql.indexOf('\n', a) + 1, sql.lastIndexOf('\n', b));
}
/** SQL 파일의 블록을 모두 새 값으로 */
export function fillBlocks(sql: string): string {
  let out = sql.replace(/\r\n/g, '\n');
  for (const [name, body] of Object.entries(sqlBlocks())) {
    const a = out.indexOf(open(name));
    const b = out.indexOf(close(name));
    if (a < 0 || b < a) throw new Error(`089_twelve_full.sql 에 ${open(name)} 블록이 없어요`);
    out = `${out.slice(0, out.indexOf('\n', a) + 1)}${body}\n${out.slice(out.lastIndexOf('\n', b) + 1)}`;
  }
  return out;
}
