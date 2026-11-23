/**
 * 드랍 판정과 확정 보정 (PRD '드랍과 확정 보정'). 순수 모듈.
 * 판의 드랍은 '판 씨앗 + 몇 번째로 잡았는지'만으로 정해진다 (맵을 시작할 때 서버가 씨앗을 준다).
 * 그래서 전투 화면은 요괴가 쓰러지는 순간 무엇이 떨어질지 알 수 있고, 서버(078_twelve.sql 의 twelve_finish)는
 * 잡은 수만 받아 같은 규칙으로 다시 판정한다. **여기를 바꾸면 SQL 의 _twelve_roll · twelve_finish 도 같이 바꾼다**
 * (scripts/pg-check.mjs 가 같은 씨앗으로 두 쪽 결과를 맞춰 본다).
 */
import { ACC_STATS, DROP, PITY, bossStones, eliteStones, potionSizeForTier, regionTier } from '../data/economy';
import { accessory, gearDrops, regionRares } from '../data/items';
import type { Mode } from '../data/regions';

export type Drop =
  /** 물약: slot 0 체력 · 1 마력, size 0 소 · 1 중 · 2 대 */
  | { t: 'potion'; slot: number; size: number }
  | { t: 'item'; base: string; rare: boolean }
  | { t: 'stone'; n: number }
  | { t: 'key' };

/** 못 받은 횟수 (지형·모드마다). 받으면 0 */
export interface Pity {
  /** 레어 없이 잡은 정예 수 · 보스 수 */
  elite: number;
  boss: number;
  /** 열쇠 없이 잡은 보스 수 */
  key: number;
}
export const noPity = (): Pity => ({ elite: 0, boss: 0, key: 0 });

/** 판정에 필요한 것. pity · codex · hasKey 는 판정하면서 바뀐다 (복사본을 넘길 것) */
export interface DropCtx {
  seed: number;
  region: number;
  mode: Mode;
  pity: Pity;
  /** 지금까지 얻어 본 레어 (확정 보정은 아직 없는 것부터) */
  codex: string[];
  /** 이 지형 열쇠가 이미 있다 */
  hasKey: boolean;
}

/** 판정 종류 (SQL 과 같은 번호) */
const TAG = { normal: 1, normalPick: 2, eliteStone: 3, eliteAcc: 4, eliteAccPick: 5, eliteRare: 6, eliteRarePick: 7, bossAcc: 8, bossAccPick: 9, bossRare: 10, bossRarePick: 11, key: 12 } as const;

/** 씨앗 · 판정 종류 · 순번 → 0 ~ 2³²-1 (SQL 의 _twelve_roll 과 같은 계산) */
export function roll(seed: number, tag: number, n: number): number {
  let x = (seed ^ Math.imul(tag, 0x9e3779b1) ^ Math.imul(n, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
const chance = (seed: number, tag: number, n: number, rate: number) => roll(seed, tag, n) % 10000 < rate;
const pick = <T>(seed: number, tag: number, n: number, list: readonly T[]): T => list[roll(seed, tag, n) % list.length];

/** i 번째(1부터)로 잡은 일반 요괴 */
export function normalDrop(c: DropCtx, i: number): Drop[] {
  const r = roll(c.seed, TAG.normal, i) % 10000;
  const tier = regionTier(c.region, c.mode);
  if (r < DROP.potion) return [{ t: 'potion', slot: roll(c.seed, TAG.normalPick, i) % 2, size: potionSizeForTier(tier) }];
  if (r < DROP.potion + DROP.gear) return [{ t: 'item', base: pick(c.seed, TAG.normalPick, i, gearDrops(tier)), rare: false }];
  return [];
}

/** 레어 하나: 확률로 나왔으면 목록에서 아무거나, 확정 보정이면 아직 없는 것부터 */
function rare(c: DropCtx, tag: number, n: number, pity: boolean): Drop {
  const list = regionRares(c.region, c.mode);
  const base = (pity ? list.find((b) => !c.codex.includes(b)) : undefined) ?? pick(c.seed, tag, n, list);
  if (!c.codex.includes(base)) c.codex.push(base);
  c.pity.elite = 0;
  c.pity.boss = 0;
  return { t: 'item', base, rare: true };
}

/** j 번째(1부터)로 잡은 정예 */
export function eliteDrop(c: DropCtx, j: number): Drop[] {
  const out: Drop[] = [];
  const tier = regionTier(c.region, c.mode);
  if (chance(c.seed, TAG.eliteStone, j, DROP.eliteStone)) out.push({ t: 'stone', n: eliteStones(tier) });
  if (chance(c.seed, TAG.eliteAcc, j, DROP.eliteAcc)) out.push({ t: 'item', base: accessory(pick(c.seed, TAG.eliteAccPick, j, ACC_STATS), tier), rare: false });
  c.pity.elite++;
  if (chance(c.seed, TAG.eliteRare, j, DROP.eliteRare)) out.push(rare(c, TAG.eliteRarePick, j, false));
  else if (c.pity.elite >= PITY.elite) out.push(rare(c, TAG.eliteRarePick, j, true));
  return out;
}

/** 지형 보스 */
export function bossDrop(c: DropCtx): Drop[] {
  const tier = regionTier(c.region, c.mode);
  const out: Drop[] = [{ t: 'stone', n: bossStones(tier) }];
  if (chance(c.seed, TAG.bossAcc, 1, DROP.bossAcc)) out.push({ t: 'item', base: accessory(pick(c.seed, TAG.bossAccPick, 1, ACC_STATS), tier), rare: false });
  c.pity.boss++;
  if (chance(c.seed, TAG.bossRare, 1, DROP.bossRare)) out.push(rare(c, TAG.bossRarePick, 1, false));
  else if (c.pity.boss >= PITY.boss) out.push(rare(c, TAG.bossRarePick, 1, true));
  if (!c.hasKey) {
    c.pity.key++;
    if (chance(c.seed, TAG.key, 1, DROP.key) || c.pity.key >= PITY.key) {
      c.hasKey = true;
      c.pity.key = 0;
      out.push({ t: 'key' });
    }
  }
  return out;
}

/** 판 하나의 드랍 전부: 일반 요괴 → 정예 → 보스 순서 (서버가 주는 순서와 같다) */
export function rollRun(c: DropCtx, normals: number, elites: number, boss: boolean): Drop[] {
  const out: Drop[] = [];
  for (let i = 1; i <= normals; i++) out.push(...normalDrop(c, i));
  for (let j = 1; j <= elites; j++) out.push(...eliteDrop(c, j));
  if (boss) out.push(...bossDrop(c));
  return out;
}

export const copyCtx = (c: DropCtx): DropCtx => ({ ...c, pity: { ...c.pity }, codex: [...c.codex] });
