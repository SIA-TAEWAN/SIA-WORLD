/**
 * 저장하는 진행 상태 (서버 tower_profiles.data — 모양은 클라이언트가 정한다, PRD '서버 약속') 와 그 규칙.
 * 층 안의 일은 sim.ts, 층을 넘나드는 일(층 깨기·죽음·상점·구슬·각성)은 여기.
 */
import {
  BAG_ITEMS, LAST_READY, MAX_LEVEL, SHARDS_TO_AWAKEN, START_ITEMS, TOTAL_FLOORS, ZONE_SIZE, expNeed, floorRule, isCheckpoint, itemDef, orbDef, priceOf,
  type ItemId,
} from '../data';

export type Sex = 'm' | 'f';
export interface Look {
  sex: Sex;
  hair: number;
  face: number;
  outfit: number;
}
export const LOOK_PRICE = 30;
export const isLook = (v: unknown): v is Look => {
  const o = v as Look;
  const n = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 3;
  return !!o && typeof o === 'object' && (o.sex === 'm' || o.sex === 'f') && n(o.hair) && n(o.face) && n(o.outfit);
};
export const sameLook = (a: Look | null, b: Look | null) => !!a && !!b && a.sex === b.sex && a.hair === b.hair && a.face === b.face && a.outfit === b.outfit;

export type Bag = Record<Exclude<ItemId, 'shard'>, number>;
export interface TowerData {
  v: 1;
  /** 층 배치 씨앗 (계정마다 하나. 같은 층은 언제나 같은 배치) */
  seed: number;
  level: number;
  exp: number;
  coins: number;
  /** 다음에 시작할 층 */
  floor: number;
  /** 죽으면 돌아가는 층 (1·11·21…) */
  checkpoint: number;
  /** 깬 최고 층 */
  best: number;
  /** 얻은 구슬 수 */
  orbs: Record<string, number>;
  awakened: string[];
  shards: number;
  equipped: string | null;
  items: Bag;
  /** 구슬 조각을 산 휴식층 */
  shopShard: number[];
  /** 지도 두루마리로 밝힌 층 */
  mapped: number[];
  /** 쓰러진 횟수 (보기용) */
  deaths: number;
  /** 첫 보상(조각)을 이미 받은 곳: '<층>:chest' · '<층>:boss' — 그 층에서 쓰러지거나 나갔다 와도 다시 받지 않는다 */
  got: string[];
}

const int = (v: unknown, min: number, max: number, dflt = min) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.floor(Number(v)))) : dflt);
const floors = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_FLOORS))].sort((a, b) => a - b) : []);

export function emptyBag(): Bag {
  const b = {} as Bag;
  for (const id of BAG_ITEMS) b[id as keyof Bag] = 0;
  return b;
}

export function newData(seed = Math.floor(Math.random() * 0x7fffffff)): TowerData {
  const items = emptyBag();
  for (const [id, n] of Object.entries(START_ITEMS)) if (id in items) items[id as keyof Bag] = n ?? 0;
  return { v: 1, seed: seed >>> 0, level: 1, exp: 0, coins: 0, floor: 1, checkpoint: 1, best: 0, orbs: {}, awakened: [], shards: 0, equipped: null, items, shopShard: [], mapped: [], deaths: 0, got: [] };
}

/** 저장된 값(서버·기기) → 진행 상태. 처음({})이면 새 상태. 어긋난 값은 가까운 바른 값으로 */
export function normalize(v: unknown): TowerData {
  const o = (v ?? {}) as Partial<TowerData>;
  if (typeof o !== 'object' || !Number.isFinite(Number(o.level))) {
    // 처음 상태: 새 진행. 서버가 먼저 넣어 둔 엽전(관리자 1만 — 105_tower_admin.sql)은 이어받는다
    const d = newData(Number.isFinite(Number(o?.seed)) ? Number(o.seed) : undefined);
    if (o && typeof o === 'object') d.coins = int(o.coins, 0, 1e9, 0);
    return d;
  }
  const best = int(o.best, 0, TOTAL_FLOORS);
  let checkpoint = int(o.checkpoint, 1, TOTAL_FLOORS, 1);
  if (!isCheckpoint(checkpoint) || checkpoint > best + 1) checkpoint = Math.min(best + 1, Math.floor(best / ZONE_SIZE) * ZONE_SIZE + 1, TOTAL_FLOORS - ZONE_SIZE + 1);
  const floor = Math.max(1, Math.min(int(o.floor, 1, TOTAL_FLOORS, checkpoint), best + 1));
  const orbs: Record<string, number> = {};
  if (o.orbs && typeof o.orbs === 'object') for (const [id, n] of Object.entries(o.orbs)) if (orbDef(id) && Number(n) > 0) orbs[id] = int(n, 1, 99);
  const awakened = Array.isArray(o.awakened) ? [...new Set(o.awakened.map(String))].filter((id) => orbs[id]) : [];
  const items = emptyBag();
  for (const id of BAG_ITEMS) items[id as keyof Bag] = int((o.items as Partial<Bag> | undefined)?.[id as keyof Bag], 0, id === 'revive' ? (itemDef(id)?.max ?? 1) : 999);
  const equipped = typeof o.equipped === 'string' && orbs[o.equipped] ? o.equipped : null;
  return {
    v: 1,
    seed: int(o.seed, 0, 0x7fffffff, Math.floor(Math.random() * 0x7fffffff)),
    level: int(o.level, 1, MAX_LEVEL, 1),
    exp: int(o.exp, 0, 1e9),
    coins: int(o.coins, 0, 1e9),
    floor,
    checkpoint,
    best,
    orbs,
    awakened,
    shards: int(o.shards, 0, 999),
    equipped,
    items,
    shopShard: floors(o.shopShard),
    mapped: floors(o.mapped),
    deaths: int(o.deaths, 0, 1e6),
    got: Array.isArray(o.got) ? [...new Set(o.got.map(String).filter((k) => /^\d{1,3}:(chest|boss)$/.test(k)))].slice(0, 400) : [],
  };
}

export const clone = (d: TowerData): TowerData => JSON.parse(JSON.stringify(d));

// ---------- 경험치 ----------
/** 경험치를 더한다 → 오른 레벨 수 */
export function addExp(d: TowerData, amount: number): number {
  let ups = 0;
  d.exp += Math.max(0, Math.round(amount));
  while (d.level < MAX_LEVEL && d.exp >= expNeed(d.level)) {
    d.exp -= expNeed(d.level);
    d.level++;
    ups++;
  }
  if (d.level >= MAX_LEVEL) d.exp = 0;
  return ups;
}

// ---------- 구슬 ----------
export type OrbGain = 'new' | 'awaken' | 'shard';
/** 구슬을 얻었다: 처음 = 새 구슬(장착한 것이 없으면 바로 장착), 두 번째 = 그 구슬 각성, 이미 각성했으면 조각 1개 */
export function gainOrb(d: TowerData, id: string): OrbGain {
  if (!d.orbs[id]) {
    d.orbs[id] = 1;
    if (!d.equipped) d.equipped = id;
    return 'new';
  }
  d.orbs[id]++;
  if (!d.awakened.includes(id)) {
    d.awakened.push(id);
    return 'awaken';
  }
  d.shards++;
  return 'shard';
}
/** 조각 5개로 각성 → 못 하면 까닭 */
export function awakenWithShards(d: TowerData, id: string): string | null {
  if (!d.orbs[id]) return '아직 없는 구슬이에요';
  if (d.awakened.includes(id)) return '이미 각성한 구슬이에요';
  if (d.shards < SHARDS_TO_AWAKEN) return `구슬 조각이 ${SHARDS_TO_AWAKEN}개 있어야 해요`;
  d.shards -= SHARDS_TO_AWAKEN;
  d.awakened.push(id);
  return null;
}
export function equipOrb(d: TowerData, id: string | null): string | null {
  if (id && !d.orbs[id]) return '아직 없는 구슬이에요';
  d.equipped = id;
  return null;
}

// ---------- 상점 ----------
/** 휴식층 상점에서 산다 → 못 사면 까닭 */
export function buy(d: TowerData, id: ItemId, floor: number): string | null {
  const def = itemDef(id);
  if (!def) return '팔지 않는 물건이에요';
  if (floorRule(floor).kind !== 'rest') return '휴식층에서만 살 수 있어요';
  if (id === 'shard' && d.shopShard.includes(floor)) return '구슬 조각은 휴식층마다 1개만 살 수 있어요';
  if (id === 'revive' && d.items.revive >= (def.max ?? 1)) return '부활 부적은 1개만 지닐 수 있어요';
  const price = priceOf(id, floor);
  if (d.coins < price) return '엽전이 모자라요';
  d.coins -= price;
  if (id === 'shard') {
    d.shards++;
    d.shopShard.push(floor);
  } else d.items[id]++;
  return null;
}

// ---------- 층 ----------
/** 층을 깼다 (계단을 올랐다 / 10층은 보스 처치) → 저장할 cleared 층 */
export function clearFloor(d: TowerData, floor: number): number {
  d.best = Math.max(d.best, floor);
  d.floor = Math.min(TOTAL_FLOORS, floor + 1);
  if (floor % ZONE_SIZE === 0 && floor < TOTAL_FLOORS) d.checkpoint = Math.max(d.checkpoint, floor + 1);
  d.mapped = d.mapped.filter((f) => f > floor);
  return floor;
}
/** 쓰러졌다: 마지막 체크포인트부터. 레벨·경험치·엽전·구슬·조각·외형은 그대로 */
export function die(d: TowerData) {
  d.floor = d.checkpoint;
  d.deaths++;
}
/** 이미 깬 층(다시 오르는 층): 경험치 절반 */
export const isReplay = (d: TowerData, floor: number) => floor <= d.best;
/** 탑을 다 올랐다 (100층 소원 — 엔딩을 본 뒤). 저장은 그대로 best 100 · floor 100 · checkpoint 91 (104 의 확인: 층 ≤ 100, 체크포인트 ≤ 91) */
export const towerDone = (d: TowerData) => d.best >= TOTAL_FLOORS;
/** 다 오른 뒤: 고른 체크포인트(1·11·…·91)부터 다시 오른다 (이미 깬 층이라 경험치 절반) → 못 하면 까닭 */
export function climbAgain(d: TowerData, cp: number): string | null {
  if (!towerDone(d)) return '탑을 다 오른 뒤에 고를 수 있어요';
  if (!isCheckpoint(cp) || cp > TOTAL_FLOORS - ZONE_SIZE + 1) return '체크포인트가 아니에요';
  d.floor = cp;
  d.checkpoint = cp;
  return null;
}
/** 준비된 층까지만 (floors.json 의 ready 구역 — 4차부터 100층 모두) */
export const canEnter = (floor: number) => floor <= LAST_READY;
