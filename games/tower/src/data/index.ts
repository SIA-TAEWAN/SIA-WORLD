/**
 * 시아의탑 데이터 (JSON) 에 타입을 붙여 읽는 곳. 100층까지 늘릴 때는 JSON 만 더한다:
 * - floors.json: 구역(10층) 구성 규칙과 구역마다의 적·정예·보스 (ready=false 인 구역은 구조만)
 * - rooms.json: 방 템플릿 (15×11 안쪽 칸 글자 그리드)
 * - enemies.json · orbs.json · items.json · growth.json
 */
import floorsJson from './floors.json';
import roomsJson from './rooms.json';
import enemiesJson from './enemies.json';
import orbsJson from './orbs.json';
import itemsJson from './items.json';
import growthJson from './growth.json';

// ---------- 층 ----------
export type FloorKind = 'normal' | 'rest' | 'elite' | 'boss';
export type SideKind = 'treasure' | 'puzzle';
export interface FloorRule {
  at: number;
  kind: FloorKind;
  combat: [number, number];
  side: SideKind[];
}
export interface Zone {
  zone: number;
  name: string;
  desc?: string;
  theme: string;
  ready: boolean;
  enemies: string[];
  elite: string;
  boss: string;
}
export const FLOORS = floorsJson as unknown as { totalFloors: number; zoneSize: number; pattern: FloorRule[]; zones: Zone[] };
export const TOTAL_FLOORS = FLOORS.totalFloors;
export const ZONE_SIZE = FLOORS.zoneSize;
export const zoneOf = (floor: number) => Math.floor((floor - 1) / ZONE_SIZE) + 1;
export const zoneData = (floor: number): Zone | undefined => FLOORS.zones.find((z) => z.zone === zoneOf(floor));
export const floorRule = (floor: number): FloorRule => FLOORS.pattern[(floor - 1) % ZONE_SIZE];
/** 들어갈 수 있는 층 (구역 데이터가 준비된 층) */
export const floorReady = (floor: number) => floor >= 1 && floor <= TOTAL_FLOORS && !!zoneData(floor)?.ready;
/** 준비된 마지막 층 */
export const LAST_READY = (() => {
  let f = 0;
  while (floorReady(f + 1)) f++;
  return f;
})();
/** 체크포인트 층 (1·11·21…) */
export const isCheckpoint = (floor: number) => floor >= 1 && floor <= TOTAL_FLOORS && (floor - 1) % ZONE_SIZE === 0;

// ---------- 방 ----------
export type RoomKind = 'start' | 'combat' | 'treasure' | 'puzzle' | 'stairs' | 'orb' | 'shop' | 'elite' | 'boss';
export interface RoomTemplate {
  id: string;
  kind: RoomKind;
  minFloor: number;
  /** 퍼즐방: 풀 수 있는 구슬 */
  needs?: string;
  grid: string[];
}
export const ROOMS = roomsJson as unknown as { size: { w: number; h: number }; rooms: RoomTemplate[] };
/** 방 안쪽 크기 (칸). 벽 한 줄을 둘러 방 하나는 (w+2)×(h+2) */
export const INNER_W = ROOMS.size.w;
export const INNER_H = ROOMS.size.h;

// ---------- 적 ----------
export type EnemyAi = 'chase' | 'bat' | 'ranged' | 'melee' | 'elite' | 'golem';
export interface EnemyDef {
  id: string;
  name: string;
  ai: EnemyAi;
  size: number;
  r: number;
  hp: number;
  atk: number;
  def: number;
  speed: number;
  exp: number;
  coins: [number, number];
  minFloor: number;
  weight: number;
  contact?: boolean;
  fly?: boolean;
  cd: number;
  range?: number;
  windup?: number;
  reach?: number;
  elite?: boolean;
  boss?: boolean;
  level?: number;
  status?: { kind: 'slow' | 'poison'; dur: number; power: number };
  proj?: { speed: number; r: number; life: number; kind: string };
  dash?: { every: number; windup: number; speed: number; time: number };
  slam?: { windup: number; radius: number; mul: number };
  rocks?: { windup: number; count: number; countRage: number; spread: number; mul: number };
  charge?: { windup: number; speed: number; time: number; stun: number; mul: number };
  rage?: number;
  firstShard?: number;
}
export const ENEMIES = (enemiesJson as unknown as { enemies: EnemyDef[] }).enemies;
export const enemyDef = (id: string): EnemyDef => {
  const d = ENEMIES.find((e) => e.id === id);
  if (!d) throw new Error(`no enemy ${id}`);
  return d;
};

// ---------- 구슬 ----------
export interface OrbSkill {
  name: string;
  desc: string;
  mp: number;
  cd: number;
  mul?: number;
  dur?: number;
}
export interface OrbDef {
  id: string;
  name: string;
  icon: string;
  element: string;
  floor: number;
  legend: boolean;
  implemented: boolean;
  basic: OrbSkill;
  awaken: OrbSkill;
  limit: string;
}
const ORB_DATA = orbsJson as unknown as { shardsToAwaken: number; orbs: OrbDef[] };
export const ORBS = ORB_DATA.orbs;
export const SHARDS_TO_AWAKEN = ORB_DATA.shardsToAwaken;
export const orbDef = (id: string | null | undefined) => ORBS.find((o) => o.id === id);
/** 그 층에서 받는 구슬 (보스 층의 전설 구슬도 여기서. 구현되지 않은 구슬은 없음) */
export const orbAtFloor = (floor: number) => ORBS.find((o) => o.floor === floor && o.implemented);

// ---------- 소지품 ----------
export type ItemId = 'potionS' | 'potionL' | 'mana' | 'cleanse' | 'map' | 'shard' | 'revive';
export interface ItemDef {
  id: ItemId;
  name: string;
  icon: string;
  desc: string;
  price: number;
  heal?: number;
  mana?: number;
  cleanse?: boolean;
  map?: boolean;
  perRest?: number;
  max?: number;
}
export interface ChestTable {
  coins: [number, number];
  firstShard?: number;
  drops: { item: ItemId; chance: number }[];
}
const ITEM_DATA = itemsJson as unknown as { zonePriceRate: number; items: ItemDef[]; chests: Record<'treasure' | 'puzzle', ChestTable>; startItems: Partial<Record<ItemId, number>> };
export const ITEMS = ITEM_DATA.items;
export const CHESTS = ITEM_DATA.chests;
export const START_ITEMS = ITEM_DATA.startItems;
export const ZONE_RATE = ITEM_DATA.zonePriceRate;
/** 소지품으로 갖고 다니는 것 (구슬 조각은 따로 센다) */
export const BAG_ITEMS: ItemId[] = ['potionS', 'potionL', 'mana', 'cleanse', 'map', 'revive'];
export const itemDef = (id: string) => ITEMS.find((i) => i.id === id);
/** 구역 배율 (값·엽전): 1구역 1, 2구역 1.5, … */
export const zoneMul = (floor: number) => Math.pow(ZONE_RATE, zoneOf(floor) - 1);
export const priceOf = (id: ItemId, floor: number) => Math.round((itemDef(id)?.price ?? 0) * zoneMul(floor));

// ---------- 성장 ----------
export const GROWTH = growthJson as {
  maxLevel: number;
  base: { hp: number; atk: number; def: number; mp: number };
  perLevel: { hp: number; atk: number; def: number; mp: number };
  expCurve: { a: number; p: number };
  clearBonus: number;
  replayRate: number;
  mpPerHit: number;
  levelUpHeal: number;
  enemyRef: { atk: number; atkPerLevel: number };
};
export const MAX_LEVEL = GROWTH.maxLevel;
export interface Stats {
  hp: number;
  atk: number;
  def: number;
  mp: number;
}
export const statsAt = (level: number): Stats => {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1;
  const b = GROWTH.base;
  const p = GROWTH.perLevel;
  return { hp: b.hp + p.hp * l, atk: b.atk + p.atk * l, def: b.def + p.def * l, mp: b.mp + p.mp * l };
};
/** 레벨 L 에서 L+1 이 되는 데 드는 경험치 */
export const expNeed = (level: number) => Math.round(GROWTH.expCurve.a * Math.pow(Math.max(1, level), GROWTH.expCurve.p));
/** 적의 공격력 기준 (레벨 L) */
export const enemyRefAtk = (level: number) => GROWTH.enemyRef.atk + GROWTH.enemyRef.atkPerLevel * (Math.max(1, level) - 1);
