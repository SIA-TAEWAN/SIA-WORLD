/** 데이터 찾기 도우미 */
import { CARDS } from './data/cards.ts';
import { ENEMIES } from './data/enemies.ts';
import { EVENTS } from './data/events.ts';
import { HEROES } from './data/heroes.ts';
import { POTIONS } from './data/potions.ts';
import { RELICS } from './data/relics.ts';
import { ACTS, REGIONS } from './data/acts.ts';
import type { CardDef, EnemyDef, EventDef, HeroDef, MoveDef, Op, PhaseDef, PotionDef, RegionDef, RelicDef } from './types.ts';

export { CARDS, ENEMIES, EVENTS, HEROES, POTIONS, RELICS, ACTS, REGIONS };
export { CARD_ODDS, CARD_ODDS_MAGPIE, GOLD, NODE_RATIO, PRICES, ROWS_PER_ACT, ROW_WIDTH } from './data/acts.ts';

const byId = <T extends { id: string }>(list: T[]) => {
  const m = new Map<string, T>();
  for (const x of list) m.set(x.id, x);
  return m;
};
const cardMap = byId(CARDS);
const enemyMap = byId(ENEMIES);
const heroMap = byId(HEROES);
const relicMap = byId(RELICS);
const potionMap = byId(POTIONS);
const eventMap = byId(EVENTS);
const regionMap = byId(REGIONS);

const must = <T>(m: Map<string, T>, id: string, what: string): T => {
  const v = m.get(id);
  if (!v) throw new Error(`unknown ${what}: ${id}`);
  return v;
};
export const cardDef = (id: string): CardDef => must(cardMap, id, 'card');
export const hasCard = (id: string) => cardMap.has(id);
export const enemyDef = (id: string): EnemyDef => must(enemyMap, id, 'enemy');
export const heroDef = (id: string): HeroDef => must(heroMap, id, 'hero');
export const relicDef = (id: string): RelicDef => must(relicMap, id, 'relic');
export const potionDef = (id: string): PotionDef => must(potionMap, id, 'potion');
export const eventDef = (id: string): EventDef => must(eventMap, id, 'event');
export const regionDef = (id: string): RegionDef => must(regionMap, id, 'region');

/** 강화를 반영한 카드 값 */
export function cardCost(id: string, up?: boolean): number {
  const d = cardDef(id);
  return up && d.up?.cost !== undefined ? d.up.cost : d.cost;
}
export function cardOps(id: string, up?: boolean): Op[] {
  const d = cardDef(id);
  return up && d.up?.ops ? d.up.ops : d.ops;
}
export function cardExhaust(id: string, up?: boolean): boolean {
  const d = cardDef(id);
  return up && d.up?.exhaust !== undefined ? d.up.exhaust : !!d.exhaust;
}
export const canUpgrade = (id: string, up?: boolean) => !up && !!cardDef(id).up;

export function phaseOf(def: EnemyDef, phase: 1 | 2): PhaseDef {
  return phase === 2 && def.phase2 ? def.phase2 : def.phase1;
}
export function moveDef(def: EnemyDef, phase: 1 | 2, id: string): MoveDef {
  const m = phaseOf(def, phase).moves.find((x) => x.id === id);
  if (!m) throw new Error(`unknown move ${def.id}.${id}`);
  return m;
}

/** 부적 효과까지 구현된 것 (보상·상점·보물에 나오는 것) */
export const RELIC_READY = new Set(RELICS.map((r) => r.id));
