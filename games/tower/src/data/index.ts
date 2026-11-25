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
  /** 큰 길 전투방 수 [최소, 최대] */
  combat: [number, number];
  /** 전투방마다 무리 수 [최소, 최대] (한 무리를 다 잡으면 다음 무리가 나온다) */
  waves: [number, number];
  /** 한 무리의 적 수 [최소, 최대] */
  pack?: [number, number];
  /** 곁방 (모두 붙인다) */
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
  /** 이 층까지만 (보스방처럼 구역마다 다른 방) */
  maxFloor?: number;
  /** 퍼즐방: 풀 수 있는 구슬 */
  needs?: string;
  /** 작은 템플릿의 둘레를 채울 글자 (기본 바닥) */
  pad?: string;
  grid: string[];
  /** 원래 템플릿 크기 (읽을 때 채운다) */
  src?: { w: number; h: number };
}
const ROOM_DATA = roomsJson as unknown as { size: { w: number; h: number }; rooms: RoomTemplate[] };
/** 방 안쪽 크기 (칸). 벽 한 줄을 둘러 방 하나는 (w+2)×(h+2) */
export const INNER_W = ROOM_DATA.size.w;
export const INNER_H = ROOM_DATA.size.h;
/**
 * 작은(예전 15×11) 템플릿을 방 크기에 맞춘다: 가운데에 놓고 둘레를 pad 글자로 채운다.
 * pad 가 바닥이 아니면(퍼즐방·보스방은 기둥으로 예전 크기를 지킨다) 네 문 앞 가운데 3칸은 바닥으로 틔운다.
 */
export function fitGrid(grid: string[], pad = '.'): string[] {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  if (w === INNER_W && h === INNER_H) return grid;
  const ox = Math.floor((INNER_W - w) / 2);
  const oy = Math.floor((INNER_H - h) / 2);
  const mx = Math.floor(INNER_W / 2);
  const my = Math.floor(INNER_H / 2);
  const out: string[] = [];
  for (let y = 0; y < INNER_H; y++) {
    let row = '';
    for (let x = 0; x < INNER_W; x++) {
      const gx = x - ox;
      const gy = y - oy;
      if (gx >= 0 && gy >= 0 && gx < w && gy < h) row += grid[gy][gx];
      else row += Math.abs(x - mx) <= 1 || Math.abs(y - my) <= 1 ? '.' : pad;
    }
    out.push(row);
  }
  return out;
}
/** 읽은 방 템플릿 (모두 방 크기). src = 원래 템플릿 크기 (둘레를 채운 방은 문이 없는 쪽의 틔운 칸을 다시 막는다 — floorgen) */
export const ROOMS = { size: ROOM_DATA.size, rooms: ROOM_DATA.rooms.map((r) => ({ ...r, grid: fitGrid(r.grid, r.pad), src: { w: r.grid[0].length, h: r.grid.length } })) };

// ---------- 적 ----------
export type EnemyAi = 'chase' | 'bat' | 'ranged' | 'melee' | 'elite' | 'golem' | 'hop' | 'imugi';
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
  /** 원거리: 한 번에 여러 발 (부채꼴) */
  spread?: { count: number; angle: number };
  /** 두꺼비: 뛰어올라 내려찍기 */
  hop?: { time: number; radius: number };
  /** 정예: 둘레로 가시를 쏜다 */
  ring?: { every: number; windup: number; count: number; mul: number };
  /** 이무기 */
  sweep?: { windup: number; radius: number; mul: number };
  spit?: { windup: number; count: number; countRage: number; spread: number; mul: number };
  bite?: { windup: number; speed: number; time: number; mul: number };
  burrow?: { hide: number; windup: number; radius: number; mul: number };
  summon?: { id: string; count: number };
}
const ENEMY_DATA = enemiesJson as unknown as { killExp: number; killCoins: number; packAtk?: number; enemies: EnemyDef[] };
export const ENEMIES = ENEMY_DATA.enemies;
/** 일반 적 한 마리 몫 (한 층 적 수가 늘어 경험치·엽전을 나눈다) */
export const KILL_EXP = ENEMY_DATA.killExp ?? 1;
export const KILL_COINS = ENEMY_DATA.killCoins ?? 1;
/** 일반 적 공격력 배수 (여럿이 한꺼번에 덤빈다) */
export const PACK_ATK = ENEMY_DATA.packAtk ?? 1;
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
  /** 스킬마다 세부 값 */
  params?: Record<string, number>;
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
  /** 싸움 밖 회복 (1초에 최대치의 몇 할) */
  restRegen?: { hp: number; mp: number };
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
