/**
 * 층 하나의 시뮬레이션 (순수 TS, Phaser 없음). 고정 시간 단계 STEP 으로만 돌고, 난수는 모두 씨앗 Rng.
 * 화면(scenes/GameScene)과 자동 조종 봇(tests/bot.ts)이 같은 step() 을 부른다.
 *
 * 좌표는 픽셀(칸 16px). 캐릭터 위치 = 발밑 가운데, 적 위치 = 몸 가운데.
 */
import {
  CHESTS, GROWTH, MAX_LEVEL, enemyDef, enemyRefAtk, expNeed, itemDef, orbDef, statsAt, zoneMul,
  type EnemyDef, type ItemId, type Stats,
} from '../data';
import { T, TILE, flyable, insideRoom, roomAt, walkable, type FloorMap, type Obj } from './floorgen';
import { addExp, clone, gainOrb, isReplay, type OrbGain, type TowerData } from './progress';
import { hashSeed, makeRng, type Rng } from './rng';

export const STEP = 1 / 60;
/** 아래·왼쪽·오른쪽·위 (캐릭터 시트의 줄 순서와 같다 — ASSETS.md) */
export const FACE_VEC = [
  [0, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
] as const;

export const PLAYER_SPEED = 66;
const HALF_W = 5;
const HALF_H = 4;
/** 캐릭터 몸 가운데는 발보다 이만큼 위 */
export const BODY_UP = 7;
const SWING = [0.26, 0.26, 0.36];
const COMBO_MUL = [1, 1, 1.4];
const REACH = 20;
const INV_TIME = 0.45;
const INTERACT_R = 24;

export interface Input {
  /** -1 ~ 1 (조이스틱·키보드) */
  mx: number;
  my: number;
  /** 누르고 있는 동안 계속 콤보 */
  attack: boolean;
  /** 눌렀다 뗀 버튼 (한 간격만 true) */
  skill: boolean;
  awaken: boolean;
  interact: boolean;
  potion: boolean;
}
export const noInput = (): Input => ({ mx: 0, my: 0, attack: false, skill: false, awaken: false, interact: false, potion: false });

export type SwingKind = 'basic' | 'rat' | 'ox';
export interface Swing {
  kind: SwingKind;
  combo: number;
  t: number;
  dur: number;
  hit: boolean;
  queued: boolean;
}
export interface Player {
  x: number;
  y: number;
  face: number;
  moving: boolean;
  walkT: number;
  axis: 'x' | 'y';
  hp: number;
  mp: number;
  stats: Stats;
  swing: Swing | null;
  lastCombo: number;
  comboWindow: number;
  recover: number;
  /** 소 구슬: 영체 팔이 내리칠 때까지 남은 시간 (-1 = 없음) */
  arm: number;
  armFx: number;
  skillCd: number;
  awakenCd: number;
  gale: number;
  giant: { t: number; hp: number; max: number } | null;
  slow: number;
  poison: number;
  poisonPow: number;
  inv: number;
  hurtT: number;
}
export type EnemyState = 'idle' | 'move' | 'windup' | 'strike' | 'flee' | 'dashWind' | 'dash' | 'stun' | 'slamWind' | 'rockWind' | 'chargeWind' | 'charge' | 'dead';
export interface Telegraph {
  kind: 'circle' | 'line';
  x: number;
  y: number;
  r: number;
  dx: number;
  dy: number;
  len: number;
  t: number;
  total: number;
}
export interface Enemy {
  id: number;
  def: EnemyDef;
  room: number;
  level: number;
  x: number;
  y: number;
  hp: number;
  max: number;
  atk: number;
  alive: boolean;
  active: boolean;
  state: EnemyState;
  t: number;
  cd: number;
  faceX: number;
  dirX: number;
  dirY: number;
  hitFlash: number;
  dashCd: number;
  pattern: number;
  rage: boolean;
  tele: Telegraph | null;
  touched: boolean;
  basicHits: number;
  onlyBasic: boolean;
}
export interface Proj {
  id: number;
  from: 'p' | 'e';
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  dmg: number;
  hit: number[];
  status?: EnemyDef['status'];
}
export type SimEvent =
  | { t: 'swing'; kind: SwingKind; combo: number }
  | { t: 'hit'; x: number; y: number; dmg: number; big: boolean }
  | { t: 'hurt'; dmg: number; giant: boolean }
  | { t: 'kill'; id: number; x: number; y: number; def: string; coins: number; exp: number }
  | { t: 'level'; level: number }
  | { t: 'chest'; coins: number; items: ItemId[]; shard: number }
  | { t: 'orb'; id: string; gain: OrbGain }
  | { t: 'lock' }
  | { t: 'unlock' }
  | { t: 'gate'; x: number; y: number }
  | { t: 'rock'; x: number; y: number }
  | { t: 'note'; text: string }
  | { t: 'shop' }
  | { t: 'fountain' }
  | { t: 'skill'; kind: string }
  | { t: 'awaken'; kind: string }
  | { t: 'boss'; phase: number }
  | { t: 'bossDown' }
  | { t: 'stairsShown' }
  | { t: 'item'; id: ItemId }
  | { t: 'revive' }
  | { t: 'status'; kind: 'slow' | 'poison' }
  | { t: 'clear' }
  | { t: 'dead' };

export interface RunStats {
  hits: number;
  kills: number;
  /** 기본 공격만으로 쓰러뜨린 적의 타수 (일반 적) */
  killHits: number[];
  coins: number;
  exp: number;
  bossTime: number;
  potions: number;
}
export interface RunState {
  map: FloorMap;
  /** 바뀌는 칸 (문·바위·상자). map.tiles 는 그대로 둔다 */
  tiles: number[];
  doorOwner: Map<number, number>;
  data: TowerData;
  rng: Rng;
  t: number;
  p: Player;
  enemies: Enemy[];
  projs: Proj[];
  events: SimEvent[];
  room: number;
  locked: Set<number>;
  cleared: Set<number>;
  visited: Set<number>;
  firstClear: boolean;
  replay: boolean;
  over: null | 'clear' | 'dead';
  clearAt: number;
  boss: Enemy | null;
  bossStart: number;
  nextId: number;
  stats: RunStats;
  god: boolean;
  noteCd: number;
  stairsShown: boolean;
}

// ---------- 시작 ----------
export function createRun(map: FloorMap, data: TowerData, opts: { god?: boolean; attempt?: number } = {}): RunState {
  const d = clone(data);
  const stats = statsAt(d.level);
  const tiles = map.tiles.slice();
  const doorOwner = new Map<number, number>();
  for (const r of map.rooms) for (const dd of r.doors) doorOwner.set(dd.y * map.w + dd.x, r.id);
  const s: RunState = {
    map,
    tiles,
    doorOwner,
    data: d,
    rng: makeRng(hashSeed(map.seed, map.floor, opts.attempt ?? d.deaths, 0x51)),
    t: 0,
    p: {
      x: map.start.x, y: map.start.y + 4, face: 0, moving: false, walkT: 0, axis: 'y', hp: stats.hp, mp: stats.mp, stats,
      swing: null, lastCombo: 0, comboWindow: 0, recover: 0, arm: -1, armFx: 0, skillCd: 0, awakenCd: 0, gale: 0, giant: null,
      slow: 0, poison: 0, poisonPow: 0, inv: 0, hurtT: 0,
    },
    enemies: [],
    projs: [],
    events: [],
    room: -1,
    locked: new Set(),
    cleared: new Set(),
    visited: new Set(),
    firstClear: !isReplay(d, map.floor),
    replay: isReplay(d, map.floor),
    over: null,
    clearAt: -1,
    boss: null,
    bossStart: 0,
    nextId: 1,
    stats: { hits: 0, kills: 0, killHits: [], coins: 0, exp: 0, bossTime: 0, potions: 0 },
    god: !!opts.god,
    noteCd: 0,
    stairsShown: !map.stairsHidden,
  };
  for (const r of map.rooms) {
    for (const sp of r.spawns) {
      const def = enemyDef(sp.def);
      const level = def.level ?? map.floor;
      const hp = Math.round(def.hp * statsAt(level).atk);
      s.enemies.push({
        id: s.nextId++, def, room: r.id, level, x: sp.x, y: sp.y, hp, max: hp, atk: def.atk * enemyRefAtk(level), alive: true, active: false, state: 'idle',
        t: 0, cd: 0.6 + s.rng.next() * 0.8, faceX: 1, dirX: 0, dirY: 1, hitFlash: 0, dashCd: def.dash?.every ?? 0, pattern: 0, rage: false, tele: null, touched: false,
        basicHits: 0, onlyBasic: true,
      });
    }
  }
  // 구슬 받침대: 아직 없는 구슬일 때만 구슬이 있다 (그 층에서 줍고 쓰러져도 다시 놓이지 않는다 — 두 번째 구슬로 공짜 각성이 되지 않게)
  for (const o of map.objs) if (o.kind === 'pedestal' && !(o.orb && !d.orbs[o.orb])) tiles[o.y * map.w + o.x] = T.PEDESTAL_EMPTY;
  return s;
}

// ---------- 칸 ----------
const tIdx = (s: RunState, x: number, y: number) => y * s.map.w + x;
export const tileOf = (s: RunState, tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= s.map.w || ty >= s.map.h ? T.VOID : s.tiles[tIdx(s, tx, ty)]);
const setTile = (s: RunState, tx: number, ty: number, t: number) => (s.tiles[tIdx(s, tx, ty)] = t);
/** 사람이 지나갈 수 없는 칸 */
export function blockedFor(s: RunState, tx: number, ty: number, who: 'p' | 'e' | 'fly'): boolean {
  const t = tileOf(s, tx, ty);
  if (t === T.DOOR) {
    if (who !== 'p') return true;
    const owner = s.doorOwner.get(tIdx(s, tx, ty));
    return owner !== undefined && s.locked.has(owner);
  }
  if (who === 'fly' && t === T.WATER) return false;
  return !walkable(t);
}
function boxFree(s: RunState, x: number, y: number, hw: number, hh: number, who: 'p' | 'e' | 'fly'): boolean {
  const x0 = Math.floor((x - hw) / TILE);
  const x1 = Math.floor((x + hw - 0.001) / TILE);
  const y0 = Math.floor((y - hh) / TILE);
  const y1 = Math.floor((y + hh - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (blockedFor(s, tx, ty, who)) return false;
  return true;
}
/** 움직이기 (가로·세로 따로, 모서리에 걸리면 살짝 비껴 준다) */
function moveBox(s: RunState, o: { x: number; y: number }, dx: number, dy: number, hw: number, hh: number, who: 'p' | 'e' | 'fly', assist = false) {
  if (dx) {
    if (boxFree(s, o.x + dx, o.y, hw, hh, who)) o.x += dx;
    else if (assist) slide(s, o, dx, 0, hw, hh, who);
  }
  if (dy) {
    if (boxFree(s, o.x, o.y + dy, hw, hh, who)) o.y += dy;
    else if (assist) slide(s, o, 0, dy, hw, hh, who);
  }
}
function slide(s: RunState, o: { x: number; y: number }, dx: number, dy: number, hw: number, hh: number, who: 'p' | 'e' | 'fly') {
  const amt = Math.abs(dx || dy);
  for (let off = 1; off <= 8; off++) {
    for (const sg of [-1, 1]) {
      const ox = dy ? sg * off : 0;
      const oy = dx ? sg * off : 0;
      if (boxFree(s, o.x + ox, o.y + oy, hw, hh, who) && boxFree(s, o.x + ox + dx, o.y + oy + dy, hw, hh, who)) {
        if (dy) o.x += Math.sign(ox) * Math.min(amt, off);
        else o.y += Math.sign(oy) * Math.min(amt, off);
        return;
      }
    }
  }
}

// ---------- 능력치 ----------
export const maxHp = (s: RunState) => s.p.stats.hp;
export const maxMp = (s: RunState) => s.p.stats.mp;
const atkSpeed = (s: RunState) => (s.p.gale > 0 ? 1.6 : 1);
export function moveSpeed(s: RunState) {
  let v = PLAYER_SPEED;
  if (s.p.gale > 0) v *= 1.4;
  if (s.p.giant) v *= 0.65;
  if (s.p.slow > 0) v *= 0.55;
  return v;
}
export const equippedOrb = (s: RunState) => (s.data.equipped ? orbDef(s.data.equipped) : undefined);
export const canAwaken = (s: RunState) => !!s.data.equipped && s.data.awakened.includes(s.data.equipped) && !!equippedOrb(s)?.implemented;

function addMp(s: RunState, n: number) {
  s.p.mp = Math.min(maxMp(s), s.p.mp + n);
}
function gainExp(s: RunState, amount: number) {
  const before = s.p.stats;
  const ups = addExp(s.data, amount);
  s.stats.exp += Math.round(amount);
  if (!ups) return;
  const now = statsAt(s.data.level);
  s.p.stats = now;
  s.p.hp = Math.min(now.hp, s.p.hp + (now.hp - before.hp) + now.hp * GROWTH.levelUpHeal);
  s.p.mp = Math.min(now.mp, s.p.mp + (now.mp - before.mp) + now.mp * GROWTH.levelUpHeal);
  s.events.push({ t: 'level', level: s.data.level });
}
function note(s: RunState, text: string) {
  if (s.noteCd > 0) return;
  s.noteCd = 2.5;
  s.events.push({ t: 'note', text });
}

// ---------- 한 간격 ----------
export function step(s: RunState, input: Input) {
  if (s.over) return;
  s.t += STEP;
  const p = s.p;
  for (const k of ['skillCd', 'awakenCd', 'gale', 'slow', 'inv', 'hurtT', 'recover', 'comboWindow', 'armFx'] as const) if (p[k] > 0) p[k] = Math.max(0, p[k] - STEP);
  if (s.noteCd > 0) s.noteCd -= STEP;
  if (p.giant && (p.giant.t -= STEP) <= 0) p.giant = null;
  if (p.poison > 0) {
    p.poison = Math.max(0, p.poison - STEP);
    p.hp = Math.max(1, p.hp - maxHp(s) * p.poisonPow * STEP);
  }

  if (s.clearAt >= 0 && s.t >= s.clearAt) return finishFloor(s);

  updatePlayer(s, input);
  updateRooms(s);
  for (const e of s.enemies) if (e.alive && e.active) updateEnemy(s, e);
  updateProjs(s);
  if (s.boss && s.boss.alive && s.boss.active) s.stats.bossTime += STEP;
}

function updatePlayer(s: RunState, input: Input) {
  const p = s.p;
  // 이동 (4방향: 더 크게 민 쪽, 비슷하면 하던 쪽)
  const ax = Math.abs(input.mx);
  const ay = Math.abs(input.my);
  let dx = 0;
  let dy = 0;
  if (ax > 0.25 || ay > 0.25) {
    if (p.axis === 'x') p.axis = ay > ax * 1.3 ? 'y' : 'x';
    else p.axis = ax > ay * 1.3 ? 'x' : 'y';
    if (p.axis === 'x') dx = Math.sign(input.mx);
    else dy = Math.sign(input.my);
  }
  p.moving = !!(dx || dy);
  if (p.moving && !p.swing) p.face = dx > 0 ? 2 : dx < 0 ? 1 : dy > 0 ? 0 : 3;
  const sp = moveSpeed(s) * (p.swing ? 0.3 : 1) * STEP;
  if (p.moving) {
    moveBox(s, p, dx * sp, dy * sp, HALF_W, HALF_H, 'p', true);
    p.walkT += STEP;
  } else p.walkT = 0;

  // 물약 · 상호작용
  if (input.potion) quickPotion(s);
  if (input.interact) interact(s);

  // 스킬 · 각성
  if (input.skill) useSkill(s);
  if (input.awaken) useAwaken(s);

  // 칼 3타 콤보
  if (p.swing) {
    const w = p.swing;
    w.t += STEP;
    if (input.attack) w.queued = true;
    if (!w.hit && w.t >= w.dur * 0.35) {
      w.hit = true;
      swingHit(s, w);
    }
    if (p.arm >= 0 && (p.arm -= STEP) < 0) {
      p.arm = -1;
      armHit(s);
    }
    if (w.t >= w.dur) {
      p.swing = null;
      p.lastCombo = w.kind === 'basic' ? w.combo : 0;
      if (w.kind === 'basic' && w.combo === 3) {
        p.recover = 0.22 / atkSpeed(s);
        p.lastCombo = 0;
      } else p.comboWindow = 0.4;
      if (w.queued && w.kind === 'basic' && w.combo < 3 && p.recover <= 0) startSwing(s, 'basic', w.combo + 1);
    }
  } else if (p.arm >= 0 && (p.arm -= STEP) < 0) {
    p.arm = -1;
    armHit(s);
  }
  if (!p.swing && input.attack && p.recover <= 0) startSwing(s, 'basic', p.comboWindow > 0 && p.lastCombo < 3 ? p.lastCombo + 1 : 1);
}

function startSwing(s: RunState, kind: SwingKind, combo: number) {
  const p = s.p;
  const c = Math.max(1, Math.min(3, combo));
  p.swing = { kind, combo: c, t: 0, dur: (kind === 'basic' ? SWING[c - 1] : 0.3) / atkSpeed(s), hit: false, queued: false };
  p.comboWindow = 0;
  s.events.push({ t: 'swing', kind, combo: c });
}

/** 바라보는 쪽 앞의 네모 (reach × width) */
export function frontBox(s: RunState, reach: number, width: number) {
  const p = s.p;
  const [fx, fy] = FACE_VEC[p.face];
  const cx = p.x + fx * (reach / 2 + 2);
  const cy = p.y - BODY_UP + fy * (reach / 2 + 2);
  const hw = fx ? reach / 2 : width / 2;
  const hh = fy ? reach / 2 : width / 2;
  return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
}
const circleBox = (x: number, y: number, r: number, b: { x0: number; x1: number; y0: number; y1: number }) => {
  const nx = Math.max(b.x0, Math.min(x, b.x1));
  const ny = Math.max(b.y0, Math.min(y, b.y1));
  return (x - nx) ** 2 + (y - ny) ** 2 <= r * r;
};

function swingHit(s: RunState, w: Swing) {
  const p = s.p;
  const box = frontBox(s, REACH, 22);
  const mul = w.kind === 'basic' ? COMBO_MUL[w.combo - 1] : 1;
  let any = false;
  for (const e of s.enemies) {
    if (!e.alive || !e.active || !circleBox(e.x, e.y, e.def.r, box)) continue;
    any = true;
    damageEnemy(s, e, p.stats.atk * mul, w.kind === 'basic' && w.combo === 3, w.kind === 'basic');
    addMp(s, GROWTH.mpPerHit);
  }
  if (w.kind === 'rat') {
    const orb = orbDef('rat')!;
    const [fx, fy] = FACE_VEC[p.face];
    s.projs.push({ id: s.nextId++, from: 'p', kind: 'crescent', x: p.x + fx * 6, y: p.y - BODY_UP + fy * 6, vx: fx * 170, vy: fy * 170, r: 6, life: 0.8, dmg: p.stats.atk * (orb.basic.mul ?? 1.5), hit: [] });
  }
  // 칼에 닿은 칸: 금 간 바위·잠긴 문은 칼로 안 된다고 알려 준다
  if (!any) {
    for (const t of boxTiles(box)) {
      const k = tileOf(s, t.x, t.y);
      if (k === T.ROCK) note(s, '단단한 바위예요. 영체 팔이라면 부술 수 있을 것 같아요');
      else if (k === T.GATE) note(s, '어딘가의 스위치를 맞혀야 열리는 문이에요');
    }
  }
  if (any) s.stats.hits++;
}
function boxTiles(b: { x0: number; x1: number; y0: number; y1: number }) {
  const out: { x: number; y: number }[] = [];
  for (let ty = Math.floor(b.y0 / TILE); ty <= Math.floor(b.y1 / TILE); ty++) for (let tx = Math.floor(b.x0 / TILE); tx <= Math.floor(b.x1 / TILE); tx++) out.push({ x: tx, y: ty });
  return out;
}

/** 소 구슬: 영체 팔 (넓고 세게, 금 간 바위를 부순다) */
function armHit(s: RunState) {
  const orb = orbDef('ox')!;
  const box = frontBox(s, 30, 30);
  s.p.armFx = 0.25;
  for (const e of s.enemies) {
    if (!e.alive || !e.active || !circleBox(e.x, e.y, e.def.r, box)) continue;
    damageEnemy(s, e, s.p.stats.atk * (orb.basic.mul ?? 1.9), true, false);
  }
  for (const t of boxTiles(box)) {
    if (tileOf(s, t.x, t.y) === T.ROCK) {
      setTile(s, t.x, t.y, T.RUBBLE);
      s.events.push({ t: 'rock', x: t.x, y: t.y });
    }
  }
}

function useSkill(s: RunState) {
  const p = s.p;
  const orb = equippedOrb(s);
  if (!orb) return note(s, '장착한 구슬이 없어요');
  if (!orb.implemented) return note(s, '이 구슬의 힘은 아직 깨어나지 않았어요');
  if (p.skillCd > 0 || p.swing) return;
  if (p.mp < orb.basic.mp) return note(s, '혼력이 모자라요. 기본 공격을 맞히면 차올라요');
  p.mp -= orb.basic.mp;
  p.skillCd = orb.basic.cd;
  startSwing(s, orb.id === 'rat' ? 'rat' : 'ox', 1);
  if (orb.id === 'ox') p.arm = p.swing!.dur * 0.35 + 0.14;
  s.events.push({ t: 'skill', kind: orb.id });
}
function useAwaken(s: RunState) {
  const p = s.p;
  const orb = equippedOrb(s);
  if (!orb) return note(s, '장착한 구슬이 없어요');
  if (!canAwaken(s)) return note(s, '아직 각성하지 않은 구슬이에요');
  if (p.awakenCd > 0) return;
  if (p.mp < orb.awaken.mp) return note(s, '혼력이 모자라요');
  p.mp -= orb.awaken.mp;
  p.awakenCd = orb.awaken.cd;
  const dur = orb.awaken.dur ?? 10;
  if (orb.id === 'rat') p.gale = dur;
  else {
    const hp = Math.round(maxHp(s) * 2);
    p.giant = { t: dur, hp, max: hp };
  }
  s.events.push({ t: 'awaken', kind: orb.id });
}

// ---------- 물건 ----------
/** 소지품 쓰기 (메뉴 · 빠른 물약) → 못 쓰면 까닭 */
export function useItem(s: RunState, id: ItemId): string | null {
  const p = s.p;
  const def = itemDef(id);
  if (!def || id === 'shard' || id === 'revive') return '여기서 쓰는 물건이 아니에요';
  if (!(s.data.items[id] > 0)) return '가진 것이 없어요';
  if (def.heal && p.hp >= maxHp(s)) return '체력이 가득해요';
  if (def.mana && p.mp >= maxMp(s)) return '혼력이 가득해요';
  if (def.cleanse && !(p.poison > 0 || p.slow > 0)) return '풀어야 할 나쁜 상태가 없어요';
  if (def.map) {
    const next = s.map.floor + 1;
    if (s.data.mapped.includes(next)) return '다음 층은 이미 밝혀 두었어요';
    s.data.mapped.push(next);
  }
  s.data.items[id]--;
  if (def.heal) p.hp = Math.min(maxHp(s), p.hp + maxHp(s) * def.heal);
  if (def.mana) p.mp = Math.min(maxMp(s), p.mp + maxMp(s) * def.mana);
  if (def.cleanse) p.poison = p.slow = 0;
  if (def.heal) s.stats.potions++;
  s.events.push({ t: 'item', id });
  return null;
}
function quickPotion(s: RunState) {
  const p = s.p;
  const miss = 1 - p.hp / maxHp(s);
  const order: ('potionL' | 'potionS')[] = miss >= 0.5 ? ['potionL', 'potionS'] : ['potionS', 'potionL'];
  if (miss <= 0) return note(s, '체력이 가득해요');
  for (const id of order) if (s.data.items[id] > 0) return void useItem(s, id);
  note(s, '회복약이 없어요');
}

// ---------- 상호작용 ----------
/** 지금 E 로 할 수 있는 것 (HUD 단추·봇) */
export function interactTarget(s: RunState): Obj | null {
  const p = s.p;
  let best: Obj | null = null;
  let bd = INTERACT_R;
  for (const o of s.map.objs) {
    const t = tileOf(s, o.x, o.y);
    const ok =
      (o.kind === 'chest' && t === T.CHEST) ||
      (o.kind === 'stairs' && s.stairsShown && t === T.STAIRS) ||
      (o.kind === 'pedestal' && t === T.PEDESTAL) ||
      o.kind === 'shop' ||
      (o.kind === 'fountain' && t === T.FOUNTAIN);
    if (!ok) continue;
    const d = Math.hypot(o.x * TILE + TILE / 2 - p.x, o.y * TILE + TILE / 2 - (p.y - 4));
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}
export const interactLabel = (o: Obj) => (o.kind === 'chest' ? '열기' : o.kind === 'stairs' ? '오르기' : o.kind === 'pedestal' ? '줍기' : o.kind === 'shop' ? '상점' : '마시기');

function interact(s: RunState) {
  const o = interactTarget(s);
  if (!o) return;
  if (o.kind === 'chest') return openChest(s, o);
  if (o.kind === 'stairs') {
    if (s.locked.size) return note(s, '적을 모두 물리쳐야 해요');
    return finishFloor(s);
  }
  if (o.kind === 'pedestal' && o.orb) {
    setTile(s, o.x, o.y, T.PEDESTAL_EMPTY);
    const gain = gainOrb(s.data, o.orb);
    s.events.push({ t: 'orb', id: o.orb, gain });
    return;
  }
  if (o.kind === 'shop') return void s.events.push({ t: 'shop' });
  if (o.kind === 'fountain') {
    setTile(s, o.x, o.y, T.FOUNTAIN_DRY);
    s.p.hp = maxHp(s);
    s.p.mp = maxMp(s);
    s.p.poison = s.p.slow = 0;
    s.events.push({ t: 'fountain' });
  }
}
function openChest(s: RunState, o: Obj) {
  setTile(s, o.x, o.y, T.CHEST_OPEN);
  const table = CHESTS[o.table ?? 'treasure'];
  const coins = Math.round(s.rng.int(table.coins[0], table.coins[1]) * zoneMul(s.map.floor));
  const items: ItemId[] = [];
  for (const dr of table.drops) if (s.rng.next() < dr.chance) items.push(dr.item);
  const key = `${s.map.floor}:chest`;
  const shard = table.firstShard && !s.data.got.includes(key) ? table.firstShard : 0;
  if (shard) s.data.got.push(key);
  s.data.coins += coins;
  s.stats.coins += coins;
  for (const id of items) if (id !== 'shard') s.data.items[id]++;
  s.data.shards += shard;
  s.events.push({ t: 'chest', coins, items, shard });
}

// ---------- 방 ----------
function updateRooms(s: RunState) {
  const p = s.p;
  const rid = roomAt(s.map, p.x, p.y);
  const room = rid >= 0 ? s.map.rooms[rid] : null;
  // 문턱을 넘어 안으로 다 들어왔을 때 (발 상자가 벽 줄을 벗어남)
  if (room && insideRoom(room, p.x, p.y, 0.45)) {
    if (s.room !== rid) {
      s.room = rid;
      s.visited.add(rid);
      if (room.kind === 'puzzle' && room.tpl.includes('rat') && s.data.equipped !== 'rat') note(s, s.data.orbs.rat ? '쥐 구슬을 장착하면 풀 수 있을 것 같아요' : '무언가 날려 보낼 힘이 있으면 좋겠어요');
      if (room.kind === 'puzzle' && room.tpl.includes('ox') && s.data.equipped !== 'ox') note(s, s.data.orbs.ox ? '소 구슬을 장착하면 바위를 부술 수 있을 것 같아요' : '바위를 부술 힘이 있으면 좋겠어요');
    }
    const alive = s.enemies.filter((e) => e.room === rid && e.alive);
    if (alive.length && !s.cleared.has(rid) && !s.locked.has(rid)) {
      s.locked.add(rid);
      for (const e of alive) {
        e.active = true;
        if (e.def.boss) {
          s.boss = e;
          s.bossStart = s.t;
          s.events.push({ t: 'boss', phase: 1 });
        }
      }
      s.events.push({ t: 'lock' });
    }
  }
  for (const r of [...s.locked]) {
    if (!s.enemies.some((e) => e.room === r && e.alive)) {
      s.locked.delete(r);
      s.cleared.add(r);
      s.events.push({ t: 'unlock' });
    }
  }
}

// ---------- 적 ----------
function hurtPlayer(s: RunState, raw: number, status?: EnemyDef['status']) {
  const p = s.p;
  if (p.inv > 0 || s.over) return;
  const dmg = Math.max(1, Math.round(raw * (0.9 + s.rng.next() * 0.2) - p.stats.def / 2));
  if (p.giant) {
    p.giant.hp -= dmg;
    s.events.push({ t: 'hurt', dmg, giant: true });
    if (p.giant.hp <= 0) p.giant = null;
    p.inv = 0.2;
    return;
  }
  p.inv = INV_TIME;
  p.hurtT = 0.3;
  if (s.god) return void s.events.push({ t: 'hurt', dmg: 0, giant: false });
  p.hp -= dmg;
  s.events.push({ t: 'hurt', dmg, giant: false });
  if (status) {
    if (status.kind === 'slow') p.slow = Math.max(p.slow, status.dur);
    else {
      p.poison = Math.max(p.poison, status.dur);
      p.poisonPow = status.power;
    }
    s.events.push({ t: 'status', kind: status.kind });
  }
  if (p.hp <= 0) {
    // 부활 부적 (최종보스전에서는 쓰지 못한다)
    if (s.data.items.revive > 0 && s.map.floor < 100) {
      s.data.items.revive--;
      p.hp = Math.round(maxHp(s) * 0.5);
      p.inv = 2;
      s.events.push({ t: 'revive' });
      return;
    }
    p.hp = 0;
    s.over = 'dead';
    s.events.push({ t: 'dead' });
  }
}

function damageEnemy(s: RunState, e: Enemy, raw: number, big: boolean, basic: boolean) {
  const dmg = Math.max(1, Math.round(raw * (0.92 + s.rng.next() * 0.16) - e.def.def / 2));
  e.hp -= dmg;
  e.hitFlash = 0.12;
  if (basic) e.basicHits++;
  else e.onlyBasic = false;
  s.events.push({ t: 'hit', x: e.x, y: e.y - e.def.r, dmg, big });
  // 밀려남 (보스·정예는 거의 안 밀린다)
  if (!e.def.boss) {
    const k = e.def.elite ? 1 : 3;
    const dx = e.x - s.p.x;
    const dy = e.y - (s.p.y - BODY_UP);
    const d = Math.hypot(dx, dy) || 1;
    moveBox(s, e, (dx / d) * k, (dy / d) * k, e.def.r * 0.8, e.def.r * 0.8, e.def.fly ? 'fly' : 'e');
  }
  if (e.hp <= 0) killEnemy(s, e);
}

function killEnemy(s: RunState, e: Enemy) {
  e.alive = false;
  e.state = 'dead';
  e.tele = null;
  s.stats.kills++;
  if (e.onlyBasic && !e.def.boss && !e.def.elite) s.stats.killHits.push(e.basicHits);
  const exp = (e.def.exp / 100) * expNeed(e.level) * (s.replay ? GROWTH.replayRate : 1);
  const coins = Math.round(s.rng.int(e.def.coins[0], e.def.coins[1]) * zoneMul(s.map.floor));
  s.data.coins += coins;
  s.stats.coins += coins;
  s.events.push({ t: 'kill', id: e.id, x: e.x, y: e.y, def: e.def.id, coins, exp: Math.round(exp) });
  gainExp(s, exp);
  if (e.def.boss) {
    const key = `${s.map.floor}:boss`;
    if (e.def.firstShard && !s.data.got.includes(key)) {
      s.data.shards += e.def.firstShard;
      s.data.got.push(key);
    }
    // 쓰러뜨린 뒤 연출 동안 날아오던 공격에 맞아 쓰러지지 않게: 적 투사체를 지우고 잠깐 무적
    s.projs = s.projs.filter((q) => q.from === 'p');
    s.p.inv = Math.max(s.p.inv, 3);
    s.events.push({ t: 'bossDown' });
    if (s.map.stairsHidden) {
      for (const o of s.map.objs) if (o.kind === 'stairs') setTile(s, o.x, o.y, T.STAIRS);
      s.stairsShown = true;
      s.events.push({ t: 'stairsShown' });
    }
    // 10층(보스층)은 보스를 쓰러뜨리면 층을 깬 것 (잠깐 뒤 — 연출)
    s.clearAt = s.t + 2.5;
    for (const o of s.enemies) if (o.alive && o.room === e.room) killEnemy(s, o);
  }
}

function enemyMove(s: RunState, e: Enemy, dx: number, dy: number, speed: number) {
  const d = Math.hypot(dx, dy);
  if (d < 0.01) return;
  const v = speed * STEP;
  e.dirX = dx / d;
  e.dirY = dy / d;
  if (Math.abs(dx) > 0.5) e.faceX = Math.sign(dx);
  const before = { x: e.x, y: e.y };
  moveBox(s, e, e.dirX * v, e.dirY * v, e.def.r * 0.8, e.def.r * 0.8, e.def.fly ? 'fly' : 'e', true);
  return Math.hypot(e.x - before.x, e.y - before.y);
}

function updateEnemy(s: RunState, e: Enemy) {
  const p = s.p;
  const def = e.def;
  if (e.hitFlash > 0) e.hitFlash -= STEP;
  if (e.cd > 0) e.cd -= STEP;
  const px = p.x;
  const py = p.y - BODY_UP;
  const dx = px - e.x;
  const dy = py - e.y;
  const dist = Math.hypot(dx, dy);
  const rage = e.rage ? 0.75 : 1;
  const touching = dist < def.r + 6;

  switch (def.ai) {
    case 'chase':
      if (dist > def.r + 4) enemyMove(s, e, dx, dy, def.speed);
      if (touching && e.cd <= 0) {
        hurtPlayer(s, e.atk, def.status);
        e.cd = def.cd;
      }
      break;
    case 'bat': {
      if (e.state === 'flee') {
        enemyMove(s, e, -dx, -dy, def.speed * 0.8);
        if ((e.t -= STEP) <= 0) e.state = 'move';
        break;
      }
      const ang = Math.atan2(dy, dx) + Math.sin(s.t * 4 + e.id) * 0.9;
      enemyMove(s, e, Math.cos(ang), Math.sin(ang), def.speed);
      if (touching && e.cd <= 0) {
        hurtPlayer(s, e.atk, def.status);
        e.cd = def.cd;
        e.state = 'flee';
        e.t = 0.6;
      }
      break;
    }
    case 'ranged':
      if (e.state === 'windup') {
        if (e.tele) e.tele.t += STEP;
        if ((e.t -= STEP) <= 0) {
          e.state = 'idle';
          e.tele = null;
          shoot(s, e, Math.atan2(dy, dx), def.atk);
          e.cd = def.cd;
        }
      } else if (dist < (def.range ?? 100) && e.cd <= 0) {
        e.state = 'windup';
        e.t = def.windup ?? 0.5;
        e.faceX = Math.sign(dx) || e.faceX;
      }
      if (touching && e.cd <= 0 && e.state !== 'windup') {
        hurtPlayer(s, e.atk * 0.5);
        e.cd = 1;
      }
      break;
    case 'melee':
    case 'elite':
      meleeAi(s, e, dx, dy, dist);
      break;
    case 'golem':
      golemAi(s, e, dx, dy, dist, rage);
      break;
  }
}

function shoot(s: RunState, e: Enemy, ang: number, mulAtk: number) {
  const pr = e.def.proj!;
  s.projs.push({ id: s.nextId++, from: 'e', kind: pr.kind, x: e.x, y: e.y, vx: Math.cos(ang) * pr.speed, vy: Math.sin(ang) * pr.speed, r: pr.r, life: pr.life, dmg: e.atk * mulAtk, hit: [], status: e.def.status });
}

function meleeAi(s: RunState, e: Enemy, dx: number, dy: number, dist: number) {
  const def = e.def;
  const reach = def.reach ?? 18;
  if (e.dashCd > 0) e.dashCd -= STEP;
  switch (e.state) {
    case 'windup': {
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        // 내리치기: 바라보던 쪽 앞의 원
        const hx = e.x + e.dirX * reach * 0.6;
        const hy = e.y + e.dirY * reach * 0.6;
        if (Math.hypot(s.p.x - hx, s.p.y - BODY_UP - hy) < reach * 0.75 + 5) hurtPlayer(s, e.atk, def.status);
        e.state = 'strike';
        e.t = 0.18;
        e.tele = null;
        e.cd = def.cd;
      }
      return;
    }
    case 'strike':
      if ((e.t -= STEP) <= 0) e.state = 'move';
      return;
    case 'dashWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        e.state = 'dash';
        e.t = def.dash!.time;
        e.touched = false;
        e.tele = null;
      }
      return;
    case 'dash': {
      const moved = enemyMove(s, e, e.dirX, e.dirY, def.dash!.speed) ?? 0;
      if (!e.touched && Math.hypot(s.p.x - e.x, s.p.y - BODY_UP - e.y) < def.r + 6) {
        e.touched = true;
        hurtPlayer(s, e.atk * 1.2);
      }
      if ((e.t -= STEP) <= 0 || moved < 0.2) {
        e.state = 'move';
        e.dashCd = def.dash!.every;
        e.cd = 0.5;
      }
      return;
    }
  }
  // 다가가기
  if (def.dash && e.dashCd <= 0 && dist > 44 && dist < 150) {
    e.state = 'dashWind';
    e.t = def.dash.windup;
    const d = dist || 1;
    e.dirX = dx / d;
    e.dirY = dy / d;
    e.tele = { kind: 'line', x: e.x, y: e.y, r: def.r, dx: e.dirX, dy: e.dirY, len: def.dash.speed * def.dash.time, t: 0, total: def.dash.windup };
    return;
  }
  if (dist > reach + def.r * 0.3) enemyMove(s, e, dx, dy, def.speed);
  else if (e.cd <= 0) {
    const d = dist || 1;
    e.dirX = dx / d;
    e.dirY = dy / d;
    e.faceX = Math.sign(dx) || e.faceX;
    e.state = 'windup';
    e.t = def.windup ?? 0.45;
    e.tele = { kind: 'circle', x: e.x + e.dirX * reach * 0.6, y: e.y + e.dirY * reach * 0.6, r: reach * 0.75, dx: e.dirX, dy: e.dirY, len: 0, t: 0, total: e.t };
  }
}

const GOLEM_CYCLE = ['slam', 'rocks', 'charge', 'rocks', 'slam', 'charge'] as const;
function golemAi(s: RunState, e: Enemy, dx: number, dy: number, dist: number, rageMul: number) {
  const def = e.def;
  if (!e.rage && e.hp <= e.max * (def.rage ?? 0.5)) {
    e.rage = true;
    s.events.push({ t: 'boss', phase: 2 });
  }
  const d = dist || 1;
  switch (e.state) {
    case 'slamWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        if (dist < def.slam!.radius + 4) hurtPlayer(s, e.atk * def.slam!.mul);
        e.tele = null;
        e.state = 'strike';
        e.t = 0.5;
      }
      return;
    case 'rockWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        const n = e.rage ? def.rocks!.countRage : def.rocks!.count;
        const base = Math.atan2(dy, dx);
        for (let i = 0; i < n; i++) shoot(s, e, base + (i - (n - 1) / 2) * def.rocks!.spread, def.rocks!.mul);
        e.tele = null;
        e.state = 'strike';
        e.t = 0.5;
      }
      return;
    case 'chargeWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        e.state = 'charge';
        e.t = def.charge!.time;
        e.touched = false;
        e.tele = null;
      }
      return;
    case 'charge': {
      const moved = enemyMove(s, e, e.dirX, e.dirY, def.charge!.speed * (e.rage ? 1.2 : 1)) ?? 0;
      if (!e.touched && Math.hypot(s.p.x - e.x, s.p.y - BODY_UP - e.y) < def.r + 6) {
        e.touched = true;
        hurtPlayer(s, e.atk * def.charge!.mul);
      }
      if (moved < 0.3) {
        // 벽에 부딪혀 잠깐 멍해진다 (때릴 틈)
        e.state = 'stun';
        e.t = def.charge!.stun;
      } else if ((e.t -= STEP) <= 0) {
        e.state = 'strike';
        e.t = 0.4;
      }
      return;
    }
    case 'stun':
    case 'strike':
      if ((e.t -= STEP) <= 0) {
        e.state = 'move';
        e.cd = (e.rage ? 1.3 : 1.9) + s.rng.next() * 0.6;
      }
      return;
    case 'windup':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        if (dist < (def.reach ?? 26) + 6) hurtPlayer(s, e.atk);
        e.tele = null;
        e.state = 'strike';
        e.t = 0.35;
      }
      return;
  }
  // 걷기 + 가까우면 주먹, 때가 되면 큰 기술
  if (dist > (def.reach ?? 26)) enemyMove(s, e, dx, dy, def.speed * (e.rage ? 1.25 : 1));
  else e.faceX = Math.sign(dx) || e.faceX;
  if (e.cd > 0) {
    if (dist < (def.reach ?? 26) + 2 && e.cd < 1.2 && e.cd > 0.2) {
      e.state = 'windup';
      e.t = (def.windup ?? 0.6) * rageMul;
      e.tele = { kind: 'circle', x: e.x, y: e.y, r: (def.reach ?? 26) + 6, dx: 0, dy: 0, len: 0, t: 0, total: e.t };
      e.cd = 1.4;
    }
    return;
  }
  const move = GOLEM_CYCLE[e.pattern++ % GOLEM_CYCLE.length];
  e.dirX = dx / d;
  e.dirY = dy / d;
  if (move === 'slam') {
    e.state = 'slamWind';
    e.t = def.slam!.windup * rageMul;
    e.tele = { kind: 'circle', x: e.x, y: e.y, r: def.slam!.radius, dx: 0, dy: 0, len: 0, t: 0, total: e.t };
  } else if (move === 'rocks') {
    e.state = 'rockWind';
    e.t = def.rocks!.windup * rageMul;
    e.tele = { kind: 'line', x: e.x, y: e.y, r: 4, dx: e.dirX, dy: e.dirY, len: 60, t: 0, total: e.t };
  } else {
    e.state = 'chargeWind';
    e.t = def.charge!.windup * rageMul;
    e.tele = { kind: 'line', x: e.x, y: e.y, r: def.r, dx: e.dirX, dy: e.dirY, len: 200, t: 0, total: e.t };
  }
}

// ---------- 투사체 ----------
function updateProjs(s: RunState) {
  const p = s.p;
  for (const pr of s.projs) {
    pr.life -= STEP;
    pr.x += pr.vx * STEP;
    pr.y += pr.vy * STEP;
    const tx = Math.floor(pr.x / TILE);
    const ty = Math.floor(pr.y / TILE);
    const t = tileOf(s, tx, ty);
    if (t === T.DOOR ? blockedFor(s, tx, ty, 'p') : !flyable(t)) {
      if (pr.from === 'p' && (t === T.SWITCH || t === T.VINE)) hitSwitch(s, tx, ty);
      else if (pr.from === 'p' && t === T.GATE) note(s, '이 문은 스위치로 열어야 해요');
      pr.life = 0;
      continue;
    }
    if (pr.from === 'p') {
      for (const e of s.enemies) {
        if (!e.alive || !e.active || pr.hit.includes(e.id)) continue;
        if (Math.hypot(e.x - pr.x, e.y - pr.y) < e.def.r + pr.r) {
          pr.hit.push(e.id);
          damageEnemy(s, e, pr.dmg, true, false);
        }
      }
    } else if (Math.hypot(p.x - pr.x, p.y - BODY_UP - pr.y) < pr.r + 5) {
      hurtPlayer(s, pr.dmg, pr.status);
      pr.life = 0;
    }
  }
  s.projs = s.projs.filter((pr) => pr.life > 0);
}

function hitSwitch(s: RunState, tx: number, ty: number) {
  const o = s.map.objs.find((x) => x.kind === 'switch' && x.x === tx && x.y === ty);
  setTile(s, tx, ty, tileOf(s, tx, ty) === T.VINE ? T.WATER : T.SWITCH_ON);
  if (!o?.gates) return;
  for (const g of o.gates) {
    if (tileOf(s, g.x, g.y) === T.GATE) {
      setTile(s, g.x, g.y, T.FLOOR);
      s.events.push({ t: 'gate', x: g.x, y: g.y });
    }
  }
}

// ---------- 층 끝 ----------
function finishFloor(s: RunState) {
  if (s.over) return;
  const floor = s.map.floor;
  gainExp(s, GROWTH.clearBonus * expNeed(Math.min(MAX_LEVEL, floor)) * (s.replay ? GROWTH.replayRate : 1));
  s.over = 'clear';
  s.events.push({ t: 'clear' });
}

/** 방 안의 살아 있는 적 수 (미니맵·HUD) */
export const aliveIn = (s: RunState, room: number) => s.enemies.filter((e) => e.room === room && e.alive).length;
/** 쓰러지지 않은 일반 적 쓰러뜨리는 데 드는 기본 공격 타수 어림 (밸런스 확인) */
export function hitsToKill(enemyId: string, level: number, floorLevel = level): number {
  const def = enemyDef(enemyId);
  const hp = Math.round(def.hp * statsAt(def.level ?? floorLevel).atk);
  const atk = statsAt(level).atk;
  let left = hp;
  let n = 0;
  while (left > 0 && n < 99) {
    left -= Math.max(1, Math.round(atk * COMBO_MUL[n % 3] - def.def / 2));
    n++;
  }
  return n;
}
