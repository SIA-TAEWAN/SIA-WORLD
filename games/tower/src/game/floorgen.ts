/**
 * 층 만들기: 방 템플릿(rooms.json)을 칸 격자 위에 이어 붙인다. 같은 씨앗·같은 층이면 언제나 같은 층.
 * - 큰 길: 시작 → 전투(floors.json combat) → (구슬 받침대) → 계단. 휴식층은 시작 → 상점 → 계단, 정예층은 전투 → 정예 → 계단, 보스층은 시작 → 보스.
 * - 전투방은 무리(waves)가 여럿: 한 무리를 다 잡으면 템플릿의 적 자리에 다음 무리가 나온다.
 * - 곁방(floors.json side, 모두): 보물방 · 퍼즐방(발판·스위치·바위·화로·말뚝·찬물·풍경·징·둥근 바위 — 보물 길이라 진행을 막지 않는다).
 * 방 하나 = 벽을 두른 (INNER_W+2)×(INNER_H+2) 칸. 이웃한 방은 벽을 맞대고, 맞댄 벽 가운데 3칸이 문이다.
 */
import { INNER_H, INNER_W, ROOMS, enemyDef, floorRule, orbAtFloor, orbDef, zoneData, zoneOf, type RoomKind, type RoomTemplate, type SideKind } from '../data';
import { hashSeed, makeRng, shuffled, type Rng } from './rng';

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
  /** 발판 (밟으면 눌린다) */
  PLATE: 20,
  PLATE_ON: 21,
  /** 화로 (용 구슬의 불로 붙인다) */
  BRAZIER: 22,
  BRAZIER_LIT: 23,
  /** 말뚝 (뱀 구슬 채찍으로 감는다) */
  POST: 24,
  /** 찬물 (토끼 구슬 얼음 칼날이 지나가면 얼음) · 얼음 (걸을 수 있다) */
  COLD_WATER: 25,
  ICE: 26,
  /** 풍경 (닭 구슬 깃털로 한꺼번에 울린다) · 울리는 풍경 */
  BELL: 27,
  BELL_ON: 28,
  /** 징 (개 구슬 음파가 꿰뚫으며 한꺼번에 울린다) · 울리는 징 */
  GONG: 29,
  GONG_ON: 30,
  /** 둥근 바위 (호랑이 구슬 맹호 강타로 민다) · 구덩이 (둥근 바위로 메운다) */
  BOULDER: 31,
  PIT: 32,
} as const;
export type Tile = (typeof T)[keyof typeof T];

/** 걸어서 지나갈 수 있는 칸 (문은 잠기지 않았을 때 — 잠김은 sim 이 따로 본다) */
export const walkable = (t: number) => t === T.FLOOR || t === T.DOOR || t === T.STAIRS || t === T.RUBBLE || t === T.PLATE || t === T.PLATE_ON || t === T.ICE;
/** 투사체가 지나가는 칸 (물·찬물·구덩이 위로는 날아간다) */
export const flyable = (t: number) => walkable(t) || t === T.WATER || t === T.COLD_WATER || t === T.PIT;
/** 날짐승이 지나가는 칸 (물·찬물·구덩이 위) */
export const overWater = (t: number) => t === T.WATER || t === T.COLD_WATER || t === T.PIT;

export interface Spawn {
  def: string;
  x: number;
  y: number;
  /** 몇 번째 무리 (0 = 들어가자마자) */
  wave: number;
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
export type ObjKind = 'chest' | 'stairs' | 'pedestal' | 'shop' | 'fountain' | 'switch' | 'plate' | 'brazier' | 'post' | 'bell' | 'gong';
export interface Obj {
  id: number;
  kind: ObjKind;
  x: number;
  y: number;
  room: number;
  table?: 'treasure' | 'puzzle';
  orb?: string;
  /** 스위치·덩굴·발판·화로·풍경·징: 열리는 문 칸 (발판·화로·풍경·징은 그 방의 것을 모두 켜야 열린다) */
  gates?: { x: number; y: number }[];
  /** 보스방 구슬 받침대: 보스를 쓰러뜨리면 나타난다 (전설 구슬) */
  hidden?: boolean;
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
  const list = ROOMS.rooms.filter((r) => r.kind === kind && r.minFloor <= floor && (r.maxFloor ?? 999) >= floor && (!r.needs || puzzleOrbReady(r.needs, floor)));
  // 아직 내용이 없는 구역(준비 중): 그 종류의 마지막 템플릿을 빌린다 (보스방처럼 구역마다 다른 방)
  if (!list.length && kind !== 'puzzle') {
    const last = ROOMS.rooms.filter((r) => r.kind === kind && r.minFloor <= floor).pop();
    if (last) return [last];
  }
  return list;
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
  const k = rng.int(rule.combat[0], rule.combat[1]);
  const list: RoomKind[] = ['start'];
  for (let i = 0; i < k; i++) list.push('combat');
  if (rule.kind === 'elite') list.push('elite');
  if (orb) list.push('orb');
  list.push('stairs');
  return list;
}

/** 곁방 목록 (퍼즐 템플릿이 없는 층은 보물방) */
function sideKinds(floor: number): RoomKind[] {
  return floorRule(floor).side.map((s: SideKind) => (s === 'puzzle' && !templatesFor('puzzle', floor).length ? 'treasure' : s));
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
  const rule = floorRule(floor);
  const sides = rule.kind === 'boss' ? [] : sideKinds(floor);

  // 칸 격자: 큰 길 + 곁방 (곁방은 시작~계단 앞 방에 하나씩 붙인다. 계단·보스 방에는 붙이지 않는다)
  let cells: [number, number][] | null = null;
  let placed: { host: number; cell: [number, number] }[] = [];
  for (let tries = 0; tries < 80; tries++) {
    cells = layout(kinds.length, rng);
    if (!cells) continue;
    const used = new Set(cells.map(([x, y]) => `${x},${y}`));
    const hosts = cells.map((_, i) => i).filter((i) => i < kinds.length - 1);
    placed = [];
    for (let si = 0; si < sides.length; si++) {
      // 아직 곁방이 없는 방부터
      const taken = new Set(placed.map((p) => p.host));
      const order = shuffled(rng, [...hosts]).sort((a, b) => Number(taken.has(a)) - Number(taken.has(b)));
      for (const h of order) {
        const [x, y] = cells[h];
        const free = [0, 1, 2, 3].filter((d) => !used.has(`${x + DIRS[d][0]},${y + DIRS[d][1]}`));
        if (!free.length) continue;
        const d = rng.pick(free);
        const cell: [number, number] = [x + DIRS[d][0], y + DIRS[d][1]];
        used.add(`${cell[0]},${cell[1]}`);
        placed.push({ host: h, cell });
        break;
      }
    }
    if (placed.length === sides.length) break;
  }
  if (!cells) throw new Error('floor layout failed');
  const all: { kind: RoomKind; cell: [number, number]; side: boolean }[] = kinds.map((k, i) => ({ kind: k, cell: cells![i], side: false }));
  placed.forEach((p, i) => all.push({ kind: sides[i], cell: p.cell, side: true }));
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
    const foeSpots: { x: number; y: number }[] = [];
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
          case 'O':
            // 보스방의 받침대는 보스를 쓰러뜨린 뒤에 솟아오른다 (전설 구슬 — sim killEnemy)
            t = r.kind === 'boss' ? T.FLOOR : T.PEDESTAL;
            objs.push({ id: 0, kind: 'pedestal', x: tx, y: ty, room: id, orb: orbAtFloor(floor)?.id, ...(r.kind === 'boss' ? { hidden: true } : {}) });
            break;
          case 'K': t = T.SHOP; objs.push({ id: 0, kind: 'shop', x: tx, y: ty, room: id }); break;
          case 'F': t = T.FOUNTAIN; objs.push({ id: 0, kind: 'fountain', x: tx, y: ty, room: id }); break;
          case 'q': t = T.PLATE; switches.push({ id: 0, kind: 'plate', x: tx, y: ty, room: id }); break;
          case 'h': t = T.BRAZIER; switches.push({ id: 0, kind: 'brazier', x: tx, y: ty, room: id }); break;
          case 'p': t = T.POST; objs.push({ id: 0, kind: 'post', x: tx, y: ty, room: id }); break;
          case 'i': t = T.COLD_WATER; break;
          case 'b': t = T.BELL; switches.push({ id: 0, kind: 'bell', x: tx, y: ty, room: id }); break;
          case 'j': t = T.GONG; switches.push({ id: 0, kind: 'gong', x: tx, y: ty, room: id }); break;
          case 'u': t = T.BOULDER; break;
          case 'x': t = T.PIT; break;
          case 'P': start = px; break;
          case 'e': foeSpots.push(px); break;
          case 'E': if (zone?.elite) room.spawns.push({ def: zone.elite, ...px, wave: 0 }); break;
          case 'B': if (zone?.boss) room.spawns.push({ def: zone.boss, ...px, wave: 0 }); break;
        }
        set(tx, ty, t);
      }
    }
    for (const s of switches) objs.push({ ...s, gates });
    // 무리: 템플릿의 적 자리 중 pack 개를 골라 새로 뽑은 적. 한 무리를 다 잡으면 다음 무리 (전투방·정예방)
    if (foeSpots.length) {
      const fight = r.kind === 'combat' || r.kind === 'elite';
      const n = fight && rule.waves?.[1] ? rng.int(rule.waves[0], rule.waves[1]) : 1;
      for (let w = 0; w < n; w++) {
        const k = fight && rule.pack?.[1] ? Math.min(foeSpots.length, rng.int(rule.pack[0], rule.pack[1])) : foeSpots.length;
        const spots = shuffled(rng, [...foeSpots]).slice(0, k);
        for (const sp of spots) {
          const d = pickEnemy();
          if (d) room.spawns.push({ def: d, ...sp, wave: w });
        }
      }
    }
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
  placed.forEach((p, i) => link(rooms[p.host], rooms[kinds.length + i]));
  // 둘레를 기둥으로 채운 방(예전 크기 퍼즐·보스방): 문이 없는 쪽의 틔운 칸은 다시 막는다
  for (const room of rooms) {
    const tpl = ROOMS.rooms.find((t) => t.id === room.tpl);
    if (!tpl?.pad || tpl.pad === '.' || !tpl.src) continue;
    const ox = Math.floor((INNER_W - tpl.src.w) / 2);
    const oy = Math.floor((INNER_H - tpl.src.h) / 2);
    const door = (d: number) => room.doors.some((dd) => {
      const lx = dd.x - room.x0;
      const ly = dd.y - room.y0;
      return d === 0 ? ly === 0 : d === 1 ? lx === ROOM_W - 1 : d === 2 ? ly === ROOM_H - 1 : lx === 0;
    });
    for (let iy = 0; iy < INNER_H; iy++) {
      for (let ix = 0; ix < INNER_W; ix++) {
        const inside = ix >= ox && iy >= oy && ix < ox + tpl.src.w && iy < oy + tpl.src.h;
        if (inside) continue;
        const d = iy < oy ? 0 : iy >= oy + tpl.src.h ? 2 : ix < ox ? 3 : 1;
        if (!door(d)) set(room.x0 + 1 + ix, room.y0 + 1 + iy, T.PILLAR);
      }
    }
  }
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
