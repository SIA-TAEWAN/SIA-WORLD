/**
 * 층 만들기: 방 템플릿(rooms.json)을 칸 격자 위에 이어 붙인다. 같은 씨앗·같은 층이면 언제나 같은 층.
 * - 큰 길: 시작 → 전투(1~2) → (구슬 받침대) → 계단. 휴식층은 시작 → 상점 → 계단, 정예층은 전투 → 정예 → 계단, 보스층은 시작 → 보스.
 * - 곁방 하나: 보물방 또는 퍼즐방(구슬이 있어야 풀리는 보물 길 — 진행을 막지 않는다).
 * 방 하나 = 벽을 두른 (INNER_W+2)×(INNER_H+2) 칸. 이웃한 방은 벽을 맞대고, 맞댄 벽 가운데 3칸이 문이다.
 */
import { INNER_H, INNER_W, ROOMS, enemyDef, floorRule, orbAtFloor, orbDef, zoneData, zoneOf, type RoomKind, type RoomTemplate, type SideKind } from '../data';
import { hashSeed, makeRng, type Rng } from './rng';

export const TILE = 16;
export const ROOM_W = INNER_W + 2;
export const ROOM_H = INNER_H + 2;

/** 칸 종류 (논리). 그림 번호는 scenes/art 가 따로 고른다 */
export const T = {
  VOID: 0,
  FLOOR: 1,
  WALL: 2,
  DOOR: 3,
  WATER: 4,
  PILLAR: 5,
  GATE: 6,
  ROCK: 7,
  SWITCH: 8,
  SWITCH_ON: 9,
  VINE: 10,
  STAIRS: 11,
  CHEST: 12,
  CHEST_OPEN: 13,
  PEDESTAL: 14,
  PEDESTAL_EMPTY: 15,
  SHOP: 16,
  FOUNTAIN: 17,
  RUBBLE: 18,
  FOUNTAIN_DRY: 19,
} as const;
export type Tile = (typeof T)[keyof typeof T];

/** 걸어서 지나갈 수 있는 칸 (문은 잠기지 않았을 때 — 잠김은 sim 이 따로 본다) */
export const walkable = (t: number) => t === T.FLOOR || t === T.DOOR || t === T.STAIRS || t === T.RUBBLE;
/** 투사체가 지나가는 칸 (물 위로는 날아간다) */
export const flyable = (t: number) => walkable(t) || t === T.WATER;

export interface Spawn {
  def: string;
  x: number;
  y: number;
}
export interface Room {
  id: number;
  kind: RoomKind;
  tpl: string;
  cx: number;
  cy: number;
  /** 벽을 포함한 방의 왼쪽 위 칸 */
  x0: number;
  y0: number;
  side: boolean;
  doors: { x: number; y: number }[];
  spawns: Spawn[];
}
export type ObjKind = 'chest' | 'stairs' | 'pedestal' | 'shop' | 'fountain' | 'switch';
export interface Obj {
  id: number;
  kind: ObjKind;
  x: number;
  y: number;
  room: number;
  table?: 'treasure' | 'puzzle';
  orb?: string;
  /** 스위치·덩굴: 맞히면 열리는 문 칸 */
  gates?: { x: number; y: number }[];
}
export interface FloorMap {
  floor: number;
  zone: number;
  kind: 'normal' | 'rest' | 'elite' | 'boss';
  seed: number;
  w: number;
  h: number;
  tiles: number[];
  rooms: Room[];
  objs: Obj[];
  /** 시작 자리 (픽셀, 칸 가운데) */
  start: { x: number; y: number };
  /** 계단이 보스 처치 뒤에 나타난다 */
  stairsHidden: boolean;
}

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** 방 안쪽 좌표의 문 자리 (위·오른쪽·아래·왼쪽 벽, 각 3칸) */
export function doorTiles(dir: number): { x: number; y: number }[] {
  const mx = Math.floor(ROOM_W / 2);
  const my = Math.floor(ROOM_H / 2);
  const out: { x: number; y: number }[] = [];
  for (let i = -1; i <= 1; i++) {
    if (dir === 0) out.push({ x: mx + i, y: 0 });
    if (dir === 1) out.push({ x: ROOM_W - 1, y: my + i });
    if (dir === 2) out.push({ x: mx + i, y: ROOM_H - 1 });
    if (dir === 3) out.push({ x: 0, y: my + i });
  }
  return out;
}

function templatesFor(kind: RoomKind, floor: number): RoomTemplate[] {
  return ROOMS.rooms.filter((r) => r.kind === kind && r.minFloor <= floor && (!r.needs || puzzleOrbReady(r.needs, floor)));
}
/** 퍼즐 구슬을 이 층보다 아래에서 받았다 (구현된 구슬만) */
const puzzleOrbReady = (id: string, floor: number) => {
  const o = orbDef(id);
  return !!o && o.implemented && o.floor < floor;
};

function mainKinds(floor: number, rng: Rng): RoomKind[] {
  const rule = floorRule(floor);
  if (rule.kind === 'rest') return ['start', 'shop', 'stairs'];
  if (rule.kind === 'boss') return ['start', 'boss'];
  const orb = orbAtFloor(floor);
  let k = rng.int(rule.combat[0], rule.combat[1]);
  if (orb && k > 1) k = 1;
  const list: RoomKind[] = ['start'];
  for (let i = 0; i < k; i++) list.push('combat');
  if (rule.kind === 'elite') list.push('elite');
  if (orb) list.push('orb');
  list.push('stairs');
  return list;
}

function sideKind(floor: number, rng: Rng): RoomKind | null {
  const rule = floorRule(floor);
  const opts: SideKind[] = rule.side.filter((s) => s !== 'puzzle' || templatesFor('puzzle', floor).length > 0);
  if (!opts.length) return null;
  // 첫 번째가 그 층에서 먼저 나오는 쪽 (3:1)
  return rng.next() < 0.75 || opts.length === 1 ? opts[0] : opts[1];
}

function layout(n: number, rng: Rng): [number, number][] | null {
  const path: [number, number][] = [[0, 0]];
  const used = new Set(['0,0']);
  let dir = rng.int(0, 3);
  for (let i = 1; i < n; i++) {
    const [x, y] = path[path.length - 1];
    const opts = [0, 1, 2, 3].filter((d) => !used.has(`${x + DIRS[d][0]},${y + DIRS[d][1]}`));
    if (!opts.length) return null;
    // 같은 쪽으로 이어 가기를 조금 더 (긴 복도 느낌), 아니면 아무 쪽
    if (!opts.includes(dir) || rng.next() < 0.45) dir = rng.pick(opts);
    const nx = x + DIRS[dir][0];
    const ny = y + DIRS[dir][1];
    path.push([nx, ny]);
    used.add(`${nx},${ny}`);
  }
  return path;
}

export function generateFloor(seed: number, floor: number): FloorMap {
  const rng = makeRng(hashSeed(seed, floor, 0x70e));
  const zone = zoneData(floor);
  const kinds = mainKinds(floor, rng);
  const side = floorRule(floor).kind === 'rest' || floorRule(floor).kind === 'boss' ? null : sideKind(floor, rng);

  // 칸 격자: 큰 길 + 곁방
  let cells: [number, number][] | null = null;
  let sideAt = -1;
  let sideCell: [number, number] | null = null;
  for (let tries = 0; tries < 50 && !sideCell; tries++) {
    cells = layout(kinds.length, rng);
    if (!cells) continue;
    if (!side) break;
    const used = new Set(cells.map(([x, y]) => `${x},${y}`));
    // 곁방은 시작~계단 앞 방에 붙인다 (계단·보스 방에는 붙이지 않는다)
    const hosts = cells.map((_, i) => i).filter((i) => i < kinds.length - 1);
    for (const h of [...hosts].sort(() => rng.next() - 0.5)) {
      const [x, y] = cells[h];
      const free = [0, 1, 2, 3].filter((d) => !used.has(`${x + DIRS[d][0]},${y + DIRS[d][1]}`));
      if (free.length) {
        const d = rng.pick(free);
        sideAt = h;
        sideCell = [x + DIRS[d][0], y + DIRS[d][1]];
        break;
      }
    }
  }
  if (!cells) throw new Error('floor layout failed');
  const all: { kind: RoomKind; cell: [number, number]; side: boolean }[] = kinds.map((k, i) => ({ kind: k, cell: cells![i], side: false }));
  if (side && sideCell) all.push({ kind: side, cell: sideCell, side: true });
  const minX = Math.min(...all.map((r) => r.cell[0]));
  const minY = Math.min(...all.map((r) => r.cell[1]));
  const cw = Math.max(...all.map((r) => r.cell[0])) - minX + 1;
  const ch = Math.max(...all.map((r) => r.cell[1])) - minY + 1;
  const w = cw * ROOM_W;
  const h = ch * ROOM_H;
  const tiles = new Array<number>(w * h).fill(T.VOID);
  const set = (x: number, y: number, t: number) => (tiles[y * w + x] = t);

  const rooms: Room[] = [];
  const objs: Obj[] = [];
  let start = { x: 0, y: 0 };
  let stairsHidden = false;
  const usedTpl = new Set<string>();
  const enemyPool = (zone?.enemies ?? []).map(enemyDef).filter((e) => e.minFloor <= floor && e.weight > 0);
  const pickEnemy = () => {
    if (!enemyPool.length) return '';
    let r = rng.next() * enemyPool.reduce((s, e) => s + e.weight, 0);
    for (const e of enemyPool) if ((r -= e.weight) < 0) return e.id;
    return enemyPool[0].id;
  };

  all.forEach((r, id) => {
    const cx = r.cell[0] - minX;
    const cy = r.cell[1] - minY;
    const x0 = cx * ROOM_W;
    const y0 = cy * ROOM_H;
    let list = templatesFor(r.kind, floor);
    if (!list.length) throw new Error(`no room template ${r.kind} for floor ${floor}`);
    const fresh = list.filter((t) => !usedTpl.has(t.id));
    if (fresh.length) list = fresh;
    const tpl = rng.pick(list);
    usedTpl.add(tpl.id);
    const room: Room = { id, kind: r.kind, tpl: tpl.id, cx, cy, x0, y0, side: r.side, doors: [], spawns: [] };
    for (let y = 0; y < ROOM_H; y++) for (let x = 0; x < ROOM_W; x++) set(x0 + x, y0 + y, T.WALL);
    const gates: { x: number; y: number }[] = [];
    const switches: Obj[] = [];
    for (let iy = 0; iy < INNER_H; iy++) {
      for (let ix = 0; ix < INNER_W; ix++) {
        const c = tpl.grid[iy][ix];
        const tx = x0 + 1 + ix;
        const ty = y0 + 1 + iy;
        const px = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
        let t: number = T.FLOOR;
        switch (c) {
          case '#': t = T.PILLAR; break;
          case '~': t = T.WATER; break;
          case ',': t = T.RUBBLE; break;
          case 'g': t = T.GATE; gates.push({ x: tx, y: ty }); break;
          case 'r': t = T.ROCK; break;
          case 'w':
          case 'v':
            t = c === 'w' ? T.SWITCH : T.VINE;
            switches.push({ id: 0, kind: 'switch', x: tx, y: ty, room: id });
            break;
          case 'C': t = T.CHEST; objs.push({ id: 0, kind: 'chest', x: tx, y: ty, room: id, table: r.kind === 'puzzle' ? 'puzzle' : 'treasure' }); break;
          case 'S':
            t = r.kind === 'boss' ? T.FLOOR : T.STAIRS;
            if (r.kind === 'boss') stairsHidden = true;
            objs.push({ id: 0, kind: 'stairs', x: tx, y: ty, room: id });
            break;
          case 'O': t = T.PEDESTAL; objs.push({ id: 0, kind: 'pedestal', x: tx, y: ty, room: id, orb: orbAtFloor(floor)?.id }); break;
          case 'K': t = T.SHOP; objs.push({ id: 0, kind: 'shop', x: tx, y: ty, room: id }); break;
          case 'F': t = T.FOUNTAIN; objs.push({ id: 0, kind: 'fountain', x: tx, y: ty, room: id }); break;
          case 'P': start = px; break;
          case 'e': { const d = pickEnemy(); if (d) room.spawns.push({ def: d, ...px }); break; }
          case 'E': if (zone?.elite) room.spawns.push({ def: zone.elite, ...px }); break;
          case 'B': if (zone?.boss) room.spawns.push({ def: zone.boss, ...px }); break;
        }
        set(tx, ty, t);
      }
    }
    for (const s of switches) objs.push({ ...s, gates });
    rooms.push(room);
  });

  // 문: 이웃한 두 방의 맞댄 벽
  const link = (a: Room, b: Room) => {
    const d = DIRS.findIndex(([dx, dy]) => a.cx + dx === b.cx && a.cy + dy === b.cy);
    if (d < 0) throw new Error('rooms not adjacent');
    for (const t of doorTiles(d)) {
      set(a.x0 + t.x, a.y0 + t.y, T.DOOR);
      a.doors.push({ x: a.x0 + t.x, y: a.y0 + t.y });
    }
    for (const t of doorTiles((d + 2) % 4)) {
      set(b.x0 + t.x, b.y0 + t.y, T.DOOR);
      b.doors.push({ x: b.x0 + t.x, y: b.y0 + t.y });
    }
  };
  for (let i = 1; i < kinds.length; i++) link(rooms[i - 1], rooms[i]);
  if (side && sideCell) link(rooms[sideAt], rooms[rooms.length - 1]);
  objs.forEach((o, i) => (o.id = i));
  return { floor, zone: zoneOf(floor), kind: floorRule(floor).kind, seed, w, h, tiles, rooms, objs, start, stairsHidden };
}

export const tileAt = (m: FloorMap, x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? T.VOID : m.tiles[y * m.w + x]);
/** 픽셀 → 그 칸이 속한 방 (없으면 -1) */
export function roomAt(m: FloorMap, px: number, py: number): number {
  const cx = Math.floor(px / TILE / ROOM_W);
  const cy = Math.floor(py / TILE / ROOM_H);
  const r = m.rooms.find((r) => r.cx === cx && r.cy === cy);
  return r ? r.id : -1;
}
/** 방 안쪽(벽 제외)에 있나 */
export function insideRoom(r: Room, px: number, py: number, margin = 0): boolean {
  const x = px / TILE - r.x0;
  const y = py / TILE - r.y0;
  return x >= 1 + margin && x <= ROOM_W - 1 - margin && y >= 1 + margin && y <= ROOM_H - 1 - margin;
}
