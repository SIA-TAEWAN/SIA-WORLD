/**
 * 층 하나의 시뮬레이션 (순수 TS, Phaser 없음). 고정 시간 단계 STEP 으로만 돌고, 난수는 모두 씨앗 Rng.
 * 화면(scenes/GameScene)과 자동 조종 봇(tests/bot.ts)이 같은 step() 을 부른다.
 *
 * 좌표는 픽셀(칸 16px). 캐릭터 위치 = 발밑 가운데, 적 위치 = 몸 가운데.
 * 구슬 스킬 16개는 아래 '구슬 스킬' (값은 orbs.json 의 basic · awaken · params).
 */
import {
  CHESTS, GROWTH, KILL_COINS, KILL_EXP, MAX_LEVEL, PACK_ATK, enemyDef, enemyRefAtk, expNeed, itemDef, orbDef, statsAt, zoneMul,
  type EnemyDef, type ItemId, type OrbDef, type Stats,
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
/** 무리를 다 잡은 뒤 다음 무리가 나올 때까지 (초) */
const WAVE_GAP = 1.0;
/** 다음 무리가 나와서 움직이기 시작할 때까지 */
const WAKE_TIME = 0.6;

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

/** 칼을 휘두르는 동작 (기본 3타 + 칼로 쓰는 구슬 스킬) */
export type SwingKind = 'basic' | 'rat' | 'ox' | 'dragon' | 'snake' | 'sheep' | 'tiger' | 'wt';
export interface Swing {
  kind: SwingKind;
  combo: number;
  t: number;
  dur: number;
  /** 맞는 때 (dur 의 몇 할) */
  at: number;
  hit: boolean;
  queued: boolean;
  /** 맹호 강타: 2타 뒤에 이어 쳤다 */
  chain?: boolean;
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
  /** 움직이지 못함 (토끼 각성 뒤 · 현무 결계 · 시전) */
  root: number;
  /** 시전 중인 각성 (용: 지면 폭발) */
  cast: { kind: string; t: number; total: number } | null;
  /** 현무: 물 보호막 */
  shield: { hp: number; max: number; t: number } | null;
  /** 현무 결계: 피해 무효 */
  barrier: number;
  /** 원숭이: 막기 자세 · 빈틈 · 역류 */
  parry: number;
  parried: boolean;
  gap: number;
  reflect: number;
  /** 호랑이 혈기 · 백호 탈진 */
  blood: number;
  tired: number;
  /** 돼지 폭풍 연타 */
  storm: number;
  stacks: number;
  /** 말 낙뢰 */
  bolts: number;
  boltNext: number;
  /** 닭 깃털 방벽 */
  blades: number;
  bladeHit: Map<number, number>;
  /** 주작 불사조: 되살아날 힘 (그 전투에서 한 번) */
  rebirth: number;
  rebirthUsed: string;
  /** 백호참: 남은 표적 */
  dashChain: { ids: number[]; t: number } | null;
  /** 뱀: 말뚝으로 끌려가는 중 */
  pull: { fx: number; fy: number; tx: number; ty: number; t: number; dur: number } | null;
}
export type EnemyState =
  | 'idle' | 'move' | 'windup' | 'strike' | 'flee' | 'dashWind' | 'dash' | 'stun' | 'slamWind' | 'rockWind' | 'chargeWind' | 'charge'
  | 'hopWind' | 'hop' | 'ringWind' | 'biteWind' | 'bite' | 'sweepWind' | 'spitWind' | 'burrow' | 'burrowWind' | 'dead';
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
  /** 몇 번째 무리 · 아직 나오지 않았다 · 나와서 움직이기까지 */
  wave: number;
  pending: boolean;
  wake: number;
  /** 상태: 화상 · 둔화 · 빙결 · 기절 */
  burn: number;
  burnDps: number;
  slowT: number;
  freeze: number;
  stun: number;
  /** 이무기: 땅속 (맞지 않는다) */
  hidden: boolean;
  /** 뛰어오르기(두꺼비)·땅파기 출발점과 도착점 */
  from: { x: number; y: number } | null;
  to: { x: number; y: number } | null;
  ringCd: number;
  summoned: boolean;
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
  /** 맞혀도 계속 날아간다 */
  pierce?: boolean;
  /** 맞힌 적에게: 둔화 · 화상 · 밀쳐내기 */
  slow?: { mul: number; dur: number };
  burn?: { dur: number; dps: number };
  push?: number;
  /** 회오리: 같은 적을 이 간격마다 다시 맞힌다 */
  tick?: number;
  tickT?: number;
  /** 쏜 적 (원숭이 역류·되받아치기) */
  src?: number;
}
/** 화면 효과 (그림만 — 시뮬레이션에는 영향 없음) */
export interface Fx {
  kind: string;
  x: number;
  y: number;
  r: number;
  t: number;
  dur: number;
  x2?: number;
  y2?: number;
  ang?: number;
  arc?: number;
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
  | { t: 'wave'; n: number; total: number }
  | { t: 'gate'; x: number; y: number }
  | { t: 'rock'; x: number; y: number }
  | { t: 'plate'; on: number; all: number }
  | { t: 'plateReset' }
  | { t: 'fire'; x: number; y: number }
  | { t: 'grapple' }
  | { t: 'parry' }
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
  | { t: 'rebirth' }
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
  /** 쓴 구슬 스킬 수 (구슬 id → 기본 · 각성) */
  skills: Record<string, number>;
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
  fx: Fx[];
  events: SimEvent[];
  room: number;
  locked: Set<number>;
  cleared: Set<number>;
  visited: Set<number>;
  /** 방마다 다음 무리가 나올 때 */
  waveAt: Map<number, number>;
  /** 발판: 방마다 다시 올라오는 때 · 다 푼 방 */
  plateAt: Map<number, number>;
  solved: Set<number>;
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
function makeEnemy(s: RunState, defId: string, room: number, x: number, y: number, wave: number, level: number): Enemy {
  const def = enemyDef(defId);
  const lv = def.level ?? level;
  const hp = Math.round(def.hp * statsAt(lv).atk);
  return {
    id: s.nextId++, def, room, level: lv, x, y, hp, max: hp, atk: def.atk * enemyRefAtk(lv) * (def.boss || def.elite ? 1 : PACK_ATK), alive: true, active: false, state: 'idle',
    t: 0, cd: 0.6 + s.rng.next() * 0.8, faceX: 1, dirX: 0, dirY: 1, hitFlash: 0, dashCd: def.dash?.every ?? 0, pattern: 0, rage: false, tele: null, touched: false,
    basicHits: 0, onlyBasic: true, wave, pending: wave > 0, wake: 0, burn: 0, burnDps: 0, slowT: 0, freeze: 0, stun: 0, hidden: false, from: null, to: null,
    ringCd: def.ring?.every ?? 0, summoned: false,
  };
}

/** 적 하나를 더한다 (시험·개발용: 바로 나와 있는 적) */
export function addEnemy(s: RunState, defId: string, x: number, y: number, room = 0): Enemy {
  const e = makeEnemy(s, defId, room, x, y, 0, s.map.floor);
  e.active = true;
  s.enemies.push(e);
  return e;
}

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
      slow: 0, poison: 0, poisonPow: 0, inv: 0, hurtT: 0, root: 0, cast: null, shield: null, barrier: 0, parry: 0, parried: false, gap: 0, reflect: 0,
      blood: 0, tired: 0, storm: 0, stacks: 0, bolts: 0, boltNext: 0, blades: 0, bladeHit: new Map(), rebirth: 0, rebirthUsed: '', dashChain: null, pull: null,
    },
    enemies: [],
    projs: [],
    fx: [],
    events: [],
    room: -1,
    locked: new Set(),
    cleared: new Set(),
    visited: new Set(),
    waveAt: new Map(),
    plateAt: new Map(),
    solved: new Set(),
    firstClear: !isReplay(d, map.floor),
    replay: isReplay(d, map.floor),
    over: null,
    clearAt: -1,
    boss: null,
    bossStart: 0,
    nextId: 1,
    stats: { hits: 0, kills: 0, killHits: [], coins: 0, exp: 0, bossTime: 0, potions: 0, skills: {} },
    god: !!opts.god,
    noteCd: 0,
    stairsShown: !map.stairsHidden,
  };
  for (const r of map.rooms) for (const sp of r.spawns) s.enemies.push(makeEnemy(s, sp.def, r.id, sp.x, sp.y, sp.wave ?? 0, map.floor));
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
  if (s.p.tired > 0) v *= prm('whiteTiger', 'tiredSpeed', 0.5);
  return v;
}
/** 지금 공격력 (혈기 · 탈진) */
export function patk(s: RunState) {
  let a = s.p.stats.atk;
  if (s.p.blood > 0) a *= prm('tiger', 'bloodAtk', 1.6);
  if (s.p.tired > 0) a *= prm('whiteTiger', 'tiredAtk', 0.7);
  return a;
}
export const equippedOrb = (s: RunState) => (s.data.equipped ? orbDef(s.data.equipped) : undefined);
export const canAwaken = (s: RunState) => !!s.data.equipped && s.data.awakened.includes(s.data.equipped) && !!equippedOrb(s)?.implemented;
/** 구슬 세부 값 (orbs.json params) */
export const prm = (orb: string, key: string, dflt: number) => orbDef(orb)?.params?.[key] ?? dflt;
const P = (o: OrbDef, key: string, dflt: number) => o.params?.[key] ?? dflt;

function addMp(s: RunState, n: number) {
  s.p.mp = Math.min(maxMp(s), s.p.mp + n);
}
function heal(s: RunState, n: number) {
  s.p.hp = Math.min(maxHp(s), s.p.hp + Math.max(0, n));
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
function fx(s: RunState, f: Omit<Fx, 't'> & { t?: number }) {
  s.fx.push({ ...f, t: f.t ?? f.dur });
}

// ---------- 한 간격 ----------
export function step(s: RunState, input: Input) {
  if (s.over) return;
  s.t += STEP;
  const p = s.p;
  for (const k of ['skillCd', 'awakenCd', 'gale', 'slow', 'inv', 'hurtT', 'recover', 'comboWindow', 'armFx', 'root', 'barrier', 'reflect', 'blood', 'tired', 'blades', 'rebirth'] as const) {
    if (p[k] > 0) p[k] = Math.max(0, p[k] - STEP);
  }
  if (s.noteCd > 0) s.noteCd -= STEP;
  if (p.giant && (p.giant.t -= STEP) <= 0) p.giant = null;
  if (p.shield && (p.shield.t -= STEP) <= 0) p.shield = null;
  if (p.poison > 0) {
    p.poison = Math.max(0, p.poison - STEP);
    p.hp = Math.max(1, p.hp - maxHp(s) * p.poisonPow * STEP);
  }
  // 혈기: 지속 중 체력이 준다 (1 아래로는 내려가지 않는다)
  if (p.blood > 0) p.hp = Math.max(1, p.hp - maxHp(s) * prm('tiger', 'bloodDrain', 0.015) * STEP);
  // 싸움 밖(잠긴 방이 없을 때)에서는 천천히 회복한다 — 방을 돌며 퍼즐·보물을 찾는 동안
  if (!s.locked.size && GROWTH.restRegen && p.hp > 0) {
    p.hp = Math.min(maxHp(s), p.hp + maxHp(s) * GROWTH.restRegen.hp * STEP);
    p.mp = Math.min(maxMp(s), p.mp + maxMp(s) * GROWTH.restRegen.mp * STEP);
  }
  for (const f of s.fx) f.t -= STEP;
  if (s.fx.length) s.fx = s.fx.filter((f) => f.t > 0);

  if (s.clearAt >= 0 && s.t >= s.clearAt) return finishFloor(s);

  updatePlayer(s, input);
  updateOrbTimers(s);
  updateRooms(s);
  for (const e of s.enemies) if (e.alive && e.active) updateEnemy(s, e);
  updateProjs(s);
  if (s.boss && s.boss.alive && s.boss.active) s.stats.bossTime += STEP;
}

function updatePlayer(s: RunState, input: Input) {
  const p = s.p;
  // 말뚝에 끌려가는 중 / 백호참 중에는 조작하지 않는다
  if (p.pull) {
    const pl = p.pull;
    pl.t += STEP;
    const k = Math.min(1, pl.t / pl.dur);
    p.x = pl.fx + (pl.tx - pl.fx) * k;
    p.y = pl.fy + (pl.ty - pl.fy) * k;
    if (k >= 1) p.pull = null;
    return;
  }
  if (p.dashChain) return;
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
  const rooted = p.root > 0 || p.barrier > 0 || !!p.cast;
  p.moving = !!(dx || dy) && !rooted;
  if ((dx || dy) && !p.swing && !p.cast) p.face = dx > 0 ? 2 : dx < 0 ? 1 : dy > 0 ? 0 : 3;
  const sp = moveSpeed(s) * (p.swing ? 0.3 : 1) * STEP;
  if (p.moving) {
    moveBox(s, p, dx * sp, dy * sp, HALF_W, HALF_H, 'p', true);
    p.walkT += STEP;
  } else p.walkT = 0;
  stepPlates(s);

  // 물약 · 상호작용
  if (input.potion) quickPotion(s);
  if (input.interact) interact(s);

  // 스킬 · 각성
  if (input.skill) useSkill(s);
  if (input.awaken) useAwaken(s);

  // 시전 (용: 지면 폭발)
  if (p.cast) {
    p.cast.t += STEP;
    if (p.cast.t >= p.cast.total) {
      const k = p.cast.kind;
      p.cast = null;
      if (k === 'dragon') dragonBlast(s);
    }
    return;
  }
  // 원숭이: 막기 자세
  if (p.parry > 0) {
    p.parry = Math.max(0, p.parry - STEP);
    if (p.parry <= 0 && !p.parried) p.gap = prm('monkey', 'gap', 0.5);
    return;
  }
  if (p.gap > 0) p.gap = Math.max(0, p.gap - STEP);

  // 칼 3타 콤보
  if (p.swing) {
    const w = p.swing;
    w.t += STEP;
    if (input.attack) w.queued = true;
    if (!w.hit && w.t >= w.dur * w.at) {
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

function startSwing(s: RunState, kind: SwingKind, combo: number, dur = 0.3, at = 0.35) {
  const p = s.p;
  const c = Math.max(1, Math.min(3, combo));
  p.swing = { kind, combo: c, t: 0, dur: (kind === 'basic' ? SWING[c - 1] : dur) / atkSpeed(s), at, hit: false, queued: false };
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
type Box = { x0: number; x1: number; y0: number; y1: number };
const circleBox = (x: number, y: number, r: number, b: Box) => {
  const nx = Math.max(b.x0, Math.min(x, b.x1));
  const ny = Math.max(b.y0, Math.min(y, b.y1));
  return (x - nx) ** 2 + (y - ny) ** 2 <= r * r;
};
/** 맞힐 수 있는 적 (나와 있고 땅속이 아닌) */
const hittable = (e: Enemy) => e.alive && e.active && !e.hidden;
const bodyY = (s: RunState) => s.p.y - BODY_UP;
const distP = (s: RunState, e: { x: number; y: number }) => Math.hypot(e.x - s.p.x, e.y - bodyY(s));
/** 반지름 안의 적 */
const foesNear = (s: RunState, r: number, x = s.p.x, y = bodyY(s)) => s.enemies.filter((e) => hittable(e) && Math.hypot(e.x - x, e.y - y) <= r + e.def.r);

function swingHit(s: RunState, w: Swing) {
  const p = s.p;
  const orbId = s.data.equipped;
  let box = frontBox(s, REACH, 22);
  let mul = w.kind === 'basic' ? COMBO_MUL[w.combo - 1] : 1;
  // 뱀 구슬을 장착하면 칼(가까운 공격)이 약해진다
  if (w.kind === 'basic' && orbId === 'snake') mul *= prm('snake', 'nearMul', 0.85);
  const o = w.kind !== 'basic' ? orbDef(w.kind === 'wt' ? 'whiteTiger' : w.kind) : undefined;
  if (o && (w.kind === 'dragon' || w.kind === 'wt')) box = frontBox(s, P(o, 'reach', 24), P(o, 'width', 26));
  if (o && w.kind === 'snake') {
    box = frontBox(s, P(o, 'reach', 54), P(o, 'width', 12));
    const [fx, fy] = FACE_VEC[p.face];
    fx2(s, 'whip', p.x + fx * 4, bodyY(s) + fy * 4, p.x + fx * P(o, 'reach', 54), bodyY(s) + fy * P(o, 'reach', 54), 0.18);
  }
  if (o && (w.kind === 'dragon' || w.kind === 'sheep' || w.kind === 'snake' || w.kind === 'wt')) mul = o.basic.mul ?? 1;
  if (o && w.kind === 'tiger') mul = (o.basic.mul ?? 2) * (w.chain ? 1.5 : 1);
  let any = false;
  let dealt = 0;
  for (const e of s.enemies) {
    if (!hittable(e) || !circleBox(e.x, e.y, e.def.r, box)) continue;
    any = true;
    let raw = patk(s) * mul;
    let ignoreDef = false;
    if (w.kind === 'wt' && o) {
      ignoreDef = true;
      if (s.rng.next() < P(o, 'crit', 0.5)) raw *= P(o, 'critMul', 1.5);
    }
    dealt += damageEnemy(s, e, raw, (w.kind === 'basic' && w.combo === 3) || w.kind !== 'basic', w.kind === 'basic', ignoreDef);
    if (w.kind === 'dragon' && o) burnEnemy(e, P(o, 'burnDur', 3), P(o, 'burnDps', 0.3) * patk(s));
    addMp(s, GROWTH.mpPerHit);
    // 돼지 폭풍 연타: 기본 공격이 맞을 때마다 쌓는다
    if (w.kind === 'basic' && p.storm > 0) p.stacks = Math.min(prm('pig', 'stackMax', 20), p.stacks + 1);
  }
  if (w.kind === 'sheep' && o && dealt > 0) heal(s, Math.min(dealt * P(o, 'steal', 0.3), maxHp(s) * P(o, 'cap', 0.08)));
  if (w.kind === 'dragon') {
    lightBraziers(s, box);
    const [fx, fy] = FACE_VEC[p.face];
    fx2(s, 'fireHit', p.x + fx * 14, bodyY(s) + fy * 14, 0, 0, 0.3, 12);
  }
  if (w.kind === 'rat') {
    const orb = orbDef('rat')!;
    const [fx, fy] = FACE_VEC[p.face];
    s.projs.push({ id: s.nextId++, from: 'p', kind: 'crescent', x: p.x + fx * 6, y: bodyY(s) + fy * 6, vx: fx * 170, vy: fy * 170, r: 6, life: 0.8, dmg: patk(s) * (orb.basic.mul ?? 1.5), hit: [], pierce: true });
  }
  // 칼에 닿은 칸: 금 간 바위·잠긴 문은 칼로 안 된다고 알려 준다
  if (!any) {
    for (const t of boxTiles(box)) {
      const k = tileOf(s, t.x, t.y);
      if (k === T.ROCK) note(s, '단단한 바위예요. 영체 팔이라면 부술 수 있을 것 같아요');
      else if (k === T.GATE) note(s, '어딘가의 장치를 풀어야 열리는 문이에요');
      else if (k === T.BRAZIER && w.kind !== 'dragon') note(s, '꺼진 화로예요. 불을 붙일 힘이 있으면 좋겠어요');
      else if (k === T.POST) note(s, '단단한 말뚝이에요. 무언가로 감아 당길 수 있을 것 같아요');
    }
  }
  if (any) s.stats.hits++;
}
function boxTiles(b: Box) {
  const out: { x: number; y: number }[] = [];
  for (let ty = Math.floor(b.y0 / TILE); ty <= Math.floor(b.y1 / TILE); ty++) for (let tx = Math.floor(b.x0 / TILE); tx <= Math.floor(b.x1 / TILE); tx++) out.push({ x: tx, y: ty });
  return out;
}
function fx2(s: RunState, kind: string, x: number, y: number, x2: number, y2: number, dur: number, r = 0) {
  fx(s, { kind, x, y, x2, y2, r, dur });
}

/** 소 구슬: 영체 팔 (넓고 세게, 금 간 바위를 부순다) */
function armHit(s: RunState) {
  const orb = orbDef('ox')!;
  const box = frontBox(s, 30, 30);
  s.p.armFx = 0.25;
  for (const e of s.enemies) {
    if (!hittable(e) || !circleBox(e.x, e.y, e.def.r, box)) continue;
    damageEnemy(s, e, patk(s) * (orb.basic.mul ?? 1.9), true, false);
  }
  for (const t of boxTiles(box)) {
    if (tileOf(s, t.x, t.y) === T.ROCK) {
      setTile(s, t.x, t.y, T.RUBBLE);
      s.events.push({ t: 'rock', x: t.x, y: t.y });
    }
  }
}

// ---------- 구슬 스킬 ----------
function spend(s: RunState, o: OrbDef, which: 'basic' | 'awaken') {
  const sk = o[which];
  s.p.mp -= sk.mp;
  if (which === 'basic') s.p.skillCd = sk.cd;
  else s.p.awakenCd = sk.cd;
  s.stats.skills[`${o.id}:${which}`] = (s.stats.skills[`${o.id}:${which}`] ?? 0) + 1;
  s.events.push({ t: which === 'basic' ? 'skill' : 'awaken', kind: o.id });
}
function shootP(s: RunState, kind: string, ang: number, speed: number, life: number, r: number, dmg: number, extra: Partial<Proj> = {}) {
  const p = s.p;
  const vx = Math.cos(ang);
  const vy = Math.sin(ang);
  s.projs.push({ id: s.nextId++, from: 'p', kind, x: p.x + vx * 6, y: bodyY(s) + vy * 6, vx: vx * speed, vy: vy * speed, r, life, dmg, hit: [], ...extra });
}
const faceAng = (s: RunState) => Math.atan2(FACE_VEC[s.p.face][1], FACE_VEC[s.p.face][0]);

export function useSkill(s: RunState) {
  const p = s.p;
  const orb = equippedOrb(s);
  if (!orb) return note(s, '장착한 구슬이 없어요');
  if (!orb.implemented) return note(s, '이 구슬의 힘은 아직 깨어나지 않았어요');
  if (p.skillCd > 0 || p.swing || p.cast || p.parry > 0 || p.pull || p.dashChain) return;
  if (p.mp < orb.basic.mp) return note(s, '혼력이 모자라요. 기본 공격을 맞히면 차올라요');
  const b = orb.basic;
  const atk = patk(s);
  switch (orb.id) {
    case 'rat':
      spend(s, orb, 'basic');
      return startSwing(s, 'rat', 1);
    case 'ox':
      spend(s, orb, 'basic');
      startSwing(s, 'ox', 1);
      p.arm = p.swing!.dur * 0.35 + 0.14;
      return;
    case 'dragon':
      // 화염 강타: 시전이 느리다 (늦게 맞는다)
      spend(s, orb, 'basic');
      return startSwing(s, 'dragon', 3, P(orb, 'cast', 0.5), 0.7);
    case 'snake': {
      spend(s, orb, 'basic');
      startSwing(s, 'snake', 2, 0.3, 0.4);
      grapple(s, orb);
      return;
    }
    case 'sheep':
      spend(s, orb, 'basic');
      return startSwing(s, 'sheep', 2);
    case 'tiger': {
      const chain = p.comboWindow > 0 && p.lastCombo === 2;
      spend(s, orb, 'basic');
      startSwing(s, 'tiger', 3, 0.36);
      p.swing!.chain = chain;
      return;
    }
    case 'whiteTiger':
      spend(s, orb, 'basic');
      return startSwing(s, 'wt', 3, 0.32);
    case 'rabbit':
      spend(s, orb, 'basic');
      shootP(s, 'ice', faceAng(s), P(orb, 'speed', 150), P(orb, 'life', 0.7), 5, atk * (b.mul ?? 1.3), { slow: { mul: P(orb, 'slow', 0.5), dur: P(orb, 'slowDur', 3) } });
      return startSwing(s, 'basic', 1);
    case 'monkey':
      spend(s, orb, 'basic');
      p.parry = P(orb, 'window', 0.35);
      p.parried = false;
      p.gap = 0;
      fx(s, { kind: 'parry', x: p.x, y: bodyY(s), r: 12, dur: p.parry });
      return;
    case 'turtle': {
      spend(s, orb, 'basic');
      const hp = Math.round(maxHp(s) * P(orb, 'shield', 0.3));
      p.shield = { hp, max: hp, t: P(orb, 'shieldDur', 8) };
      return;
    }
    case 'rooster': {
      const live = s.projs.filter((q) => q.from === 'p' && q.kind === 'feather').length;
      const want = s.data.awakened.includes('rooster') ? P(orb, 'countAwake', 5) : P(orb, 'count', 3);
      // 투사체 수에 한계: 떠 있는 깃털이 max 개를 넘지 않게
      const n = Math.min(want, P(orb, 'max', 10) - live);
      if (n <= 0) return note(s, '깃털이 아직 날고 있어요');
      spend(s, orb, 'basic');
      const base = faceAng(s);
      const sp = P(orb, 'spread', 0.26);
      for (let i = 0; i < n; i++) shootP(s, 'feather', base + (i - (n - 1) / 2) * sp, P(orb, 'speed', 180), P(orb, 'life', 0.6), 4, atk * (b.mul ?? 0.8));
      return;
    }
    case 'dog':
      spend(s, orb, 'basic');
      return shootP(s, 'sonic', faceAng(s), P(orb, 'speed', 210), P(orb, 'life', 0.7), 6, atk * (b.mul ?? 1.4), { pierce: true });
    case 'phoenix':
      spend(s, orb, 'basic');
      return shootP(s, 'fireFeather', faceAng(s), P(orb, 'speed', 170), P(orb, 'life', 0.8), 5, atk * (b.mul ?? 1.4), { burn: { dur: P(orb, 'burnDur', 3), dps: P(orb, 'burnDps', 0.3) * atk } });
    case 'pig':
      spend(s, orb, 'basic');
      return shootP(s, 'wind', faceAng(s), P(orb, 'speed', 170), P(orb, 'life', 0.6), 6, atk * (b.mul ?? 1.3), { push: P(orb, 'push', 26) });
    case 'blueDragon':
      spend(s, orb, 'basic');
      return shootP(s, 'tornado', faceAng(s), P(orb, 'speed', 90), P(orb, 'life', 1.4), P(orb, 'r', 9), atk * (b.mul ?? 1.8), { pierce: true, tick: P(orb, 'tick', 0.25), tickT: 0, push: P(orb, 'push', 10) });
    case 'horse': {
      // 연쇄 번개: 가장 가까운 적 → 그 둘레 1~2명에게 튄다
      const first = foesNear(s, P(orb, 'range', 90)).sort((a, c) => distP(s, a) - distP(s, c))[0];
      if (!first) return note(s, '번개가 닿을 적이 없어요');
      spend(s, orb, 'basic');
      const hitIds = [first.id];
      let cur = first;
      fx2(s, 'chain', p.x, bodyY(s), first.x, first.y, 0.25);
      damageEnemy(s, first, atk * (b.mul ?? 1.2), true, false);
      for (let i = 0; i < P(orb, 'chains', 2); i++) {
        const next = s.enemies.filter((e) => hittable(e) && !hitIds.includes(e.id) && Math.hypot(e.x - cur.x, e.y - cur.y) <= P(orb, 'jump', 56)).sort((a, c) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(c.x - cur.x, c.y - cur.y))[0];
        if (!next) break;
        fx2(s, 'chain', cur.x, cur.y, next.x, next.y, 0.25);
        hitIds.push(next.id);
        damageEnemy(s, next, atk * (b.mul ?? 1.2), true, false);
        cur = next;
      }
      return;
    }
  }
}

export function useAwaken(s: RunState) {
  const p = s.p;
  const orb = equippedOrb(s);
  if (!orb) return note(s, '장착한 구슬이 없어요');
  if (!canAwaken(s)) return note(s, '아직 각성하지 않은 구슬이에요');
  if (p.awakenCd > 0 || p.cast || p.pull || p.dashChain) return;
  if (p.mp < orb.awaken.mp) return note(s, '혼력이 모자라요');
  const a = orb.awaken;
  const atk = patk(s);
  const dur = a.dur ?? 10;
  switch (orb.id) {
    case 'rat':
      spend(s, orb, 'awaken');
      p.gale = dur;
      return;
    case 'ox': {
      spend(s, orb, 'awaken');
      const hp = Math.round(maxHp(s) * 2);
      p.giant = { t: dur, hp, max: hp };
      return;
    }
    case 'dragon':
      // 지면 폭발: 시전이 느리다 (그동안 움직이지 못한다)
      spend(s, orb, 'awaken');
      p.cast = { kind: 'dragon', t: 0, total: P(orb, 'waveCast', 0.7) };
      p.swing = null;
      return;
    case 'snake': {
      // 휘감기: 앞쪽 부채꼴을 휩쓸고 적을 끌어온다
      spend(s, orb, 'awaken');
      const R = P(orb, 'sweepR', 66);
      const arc = P(orb, 'sweepArc', 2.2);
      const base = faceAng(s);
      fx(s, { kind: 'sweep', x: p.x, y: bodyY(s), r: R, ang: base, arc, dur: 0.3 });
      for (const e of foesNear(s, R)) {
        const ang = Math.atan2(e.y - bodyY(s), e.x - p.x);
        let d = Math.abs(ang - base);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d > arc / 2 && distP(s, e) > e.def.r + 10) continue;
        damageEnemy(s, e, atk * P(orb, 'sweepMul', 2.2), true, false);
        if (!e.def.boss && e.alive) pullEnemy(s, e, P(orb, 'pullTo', 22));
      }
      return;
    }
    case 'rabbit': {
      // 빙결의 춤: 주변 적을 얼린다 (보스는 둔화만). 사용 뒤 2초 움직이지 못한다
      spend(s, orb, 'awaken');
      const R = P(orb, 'freezeR', 72);
      fx(s, { kind: 'freeze', x: p.x, y: bodyY(s), r: R, dur: 0.5 });
      for (const e of foesNear(s, R)) {
        damageEnemy(s, e, atk * P(orb, 'freezeMul', 1.5), true, false);
        if (!e.alive) continue;
        if (e.def.boss) slowEnemy(e, 0.5, P(orb, 'bossSlowDur', 4));
        else freezeEnemy(e, P(orb, 'freezeDur', 3));
      }
      p.root = P(orb, 'root', 2);
      return;
    }
    case 'monkey':
      spend(s, orb, 'awaken');
      p.reflect = dur || 3;
      return;
    case 'turtle':
      spend(s, orb, 'awaken');
      p.barrier = dur || 5;
      p.swing = null;
      return;
    case 'rooster':
      spend(s, orb, 'awaken');
      p.blades = dur || 8;
      p.bladeHit.clear();
      return;
    case 'sheep': {
      // 포근한 양털: 주변 적에게서 흡수하고 크게 회복 (상한 있음)
      spend(s, orb, 'awaken');
      const R = P(orb, 'woolR', 64);
      fx(s, { kind: 'wool', x: p.x, y: bodyY(s), r: R, dur: 0.6 });
      let dealt = 0;
      for (const e of foesNear(s, R)) dealt += damageEnemy(s, e, atk * P(orb, 'woolMul', 1.5), true, false);
      heal(s, Math.min(maxHp(s) * P(orb, 'woolCap', 0.5), dealt * P(orb, 'woolSteal', 0.5) + maxHp(s) * P(orb, 'woolHeal', 0.2)));
      return;
    }
    case 'dog': {
      // 화음: 넓은 음파로 잠깐 기절 (보스는 기절하지 않는다)
      spend(s, orb, 'awaken');
      const R = P(orb, 'chordR', 84);
      fx(s, { kind: 'chord', x: p.x, y: bodyY(s), r: R, dur: 0.5 });
      for (const e of foesNear(s, R)) {
        damageEnemy(s, e, atk * P(orb, 'chordMul', 1.2), true, false);
        if (e.alive && !e.def.boss) stunEnemy(e, P(orb, 'stun', 1.5));
      }
      return;
    }
    case 'tiger':
      spend(s, orb, 'awaken');
      p.blood = dur || 10;
      return;
    case 'phoenix': {
      // 불사조: 대폭발 + 이 전투에서 한 번 되살아날 힘
      spend(s, orb, 'awaken');
      const R = P(orb, 'blastR', 80);
      fx(s, { kind: 'explode', x: p.x, y: bodyY(s), r: R, dur: 0.6 });
      for (const e of foesNear(s, R)) {
        damageEnemy(s, e, atk * P(orb, 'blastMul', 3), true, false);
        if (e.alive) burnEnemy(e, P(orb, 'burnDur', 3), P(orb, 'burnDps', 0.3) * atk);
      }
      lightBraziersCircle(s, p.x, bodyY(s), R);
      p.rebirth = 30;
      return;
    }
    case 'horse':
      spend(s, orb, 'awaken');
      p.bolts = dur || 5;
      p.boltNext = 0;
      return;
    case 'pig':
      spend(s, orb, 'awaken');
      p.storm = dur || 8;
      p.stacks = 0;
      return;
    case 'whiteTiger': {
      // 백호참: 방 안의 적에게 순간이동하며 연속으로 벤다. 끝나면 5초 지친다
      const ids = s.enemies.filter((e) => hittable(e) && distP(s, e) < 160).sort((a, c) => distP(s, a) - distP(s, c)).slice(0, P(orb, 'slashes', 5)).map((e) => e.id);
      if (!ids.length) return note(s, '벨 적이 없어요');
      spend(s, orb, 'awaken');
      p.swing = null;
      p.dashChain = { ids, t: 0 };
      p.inv = Math.max(p.inv, ids.length * P(orb, 'slashGap', 0.15) + 0.3);
      return;
    }
    case 'blueDragon': {
      // 청룡승천: 화면(방) 전체에 폭풍
      spend(s, orb, 'awaken');
      fx(s, { kind: 'storm', x: p.x, y: bodyY(s), r: 220, dur: 0.9 });
      for (const e of s.enemies) {
        if (!hittable(e) || e.room !== s.room) continue;
        damageEnemy(s, e, atk * P(orb, 'stormMul', 4), true, false);
        if (e.alive && !e.def.boss) stunEnemy(e, P(orb, 'stun', 1));
      }
      return;
    }
  }
}

/** 지면 폭발 (용 각성의 시전이 끝나면) */
function dragonBlast(s: RunState) {
  const o = orbDef('dragon')!;
  const p = s.p;
  const R = P(o, 'waveR', 76);
  const atk = patk(s);
  fx(s, { kind: 'fireWave', x: p.x, y: bodyY(s), r: R, dur: 0.5 });
  for (const e of foesNear(s, R)) {
    damageEnemy(s, e, atk * P(o, 'waveMul', 2.6), true, false);
    if (e.alive) burnEnemy(e, P(o, 'burnDur', 3), P(o, 'burnDps', 0.3) * atk);
  }
  lightBraziersCircle(s, p.x, bodyY(s), R);
}

/** 뱀: 바라보는 쪽 말뚝(물·바닥 너머 grapple 칸 안)을 감아 그 너머로 건너간다 */
function grapple(s: RunState, o: OrbDef) {
  const t = grappleTarget(s, s.p.face, P(o, 'grapple', 7));
  if (!t) return;
  const p = s.p;
  const tx = t.x * TILE + TILE / 2;
  const ty = t.y * TILE + TILE / 2 + 4;
  p.pull = { fx: p.x, fy: p.y, tx, ty, t: 0, dur: Math.max(0.15, Math.hypot(tx - p.x, ty - p.y) / 260) };
  p.inv = Math.max(p.inv, p.pull.dur + 0.1);
  p.swing = null;
  fx2(s, 'whip', p.x, bodyY(s), t.px, t.py, 0.3);
  s.events.push({ t: 'grapple' });
}
/** 말뚝 감기: 내 칸에서 face 쪽으로 range 칸 안에 말뚝이 있고, 사이가 물·바닥이며, 말뚝 너머가 걸을 수 있으면 → 내릴 칸 */
export function grappleTarget(s: RunState, face: number, range = 7): { x: number; y: number; px: number; py: number } | null {
  const p = s.p;
  const [fx, fy] = FACE_VEC[face];
  const sx = Math.floor(p.x / TILE);
  const sy = Math.floor((p.y - 2) / TILE);
  for (let d = 1; d <= range; d++) {
    const x = sx + fx * d;
    const y = sy + fy * d;
    const k = tileOf(s, x, y);
    if (k === T.POST) {
      if (d < 2) return null;
      const lx = x + fx;
      const ly = y + fy;
      if (blockedFor(s, lx, ly, 'p')) return null;
      return { x: lx, y: ly, px: x * TILE + TILE / 2, py: y * TILE + TILE / 2 };
    }
    // 문(잠긴 문 포함)은 넘어 감지 않는다 — 잠긴 전투방에서 이웃 곁방으로 빠져나가 갇히지 않게
    if (k === T.DOOR || !flyable(k)) return null;
  }
  return null;
}

function updateOrbTimers(s: RunState) {
  const p = s.p;
  // 말 낙뢰: 무작위 자리에 떨어진다
  if (p.bolts > 0) {
    p.bolts = Math.max(0, p.bolts - STEP);
    p.boltNext -= STEP;
    if (p.boltNext <= 0) {
      const o = orbDef('horse')!;
      p.boltNext = P(o, 'boltEvery', 0.5);
      const a = s.rng.next() * Math.PI * 2;
      const d = s.rng.next() * P(o, 'boltArea', 90);
      const x = p.x + Math.cos(a) * d;
      const y = bodyY(s) + Math.sin(a) * d;
      const R = P(o, 'boltR', 22);
      fx(s, { kind: 'bolt', x, y, r: R, dur: 0.35 });
      for (const e of foesNear(s, R, x, y)) damageEnemy(s, e, patk(s) * P(o, 'boltMul', 1.5), true, false);
    }
  }
  // 돼지 폭풍 연타: 끝나면 쌓은 만큼 터진다
  if (p.storm > 0) {
    p.storm = Math.max(0, p.storm - STEP);
    if (p.storm <= 0 && p.stacks > 0) {
      const o = orbDef('pig')!;
      const R = P(o, 'burstR', 64);
      fx(s, { kind: 'burst', x: p.x, y: bodyY(s), r: R, dur: 0.5 });
      for (const e of foesNear(s, R)) damageEnemy(s, e, patk(s) * P(o, 'burstMul', 0.5) * p.stacks, true, false);
      p.stacks = 0;
    }
  }
  // 닭 깃털 방벽: 몸 주위를 도는 칼날
  if (p.blades > 0) {
    const o = orbDef('rooster')!;
    const R = P(o, 'bladeR', 20);
    for (const e of s.enemies) {
      if (!hittable(e)) continue;
      const d = distP(s, e);
      if (d > R + e.def.r + 4) continue;
      const last = p.bladeHit.get(e.id) ?? -9;
      if (s.t - last < P(o, 'bladeHit', 0.4)) continue;
      p.bladeHit.set(e.id, s.t);
      damageEnemy(s, e, patk(s) * P(o, 'bladeMul', 0.6), false, false);
    }
  }
  // 백호참
  if (p.dashChain) {
    const o = orbDef('whiteTiger')!;
    const dc = p.dashChain;
    dc.t -= STEP;
    if (dc.t <= 0) {
      const id = dc.ids.shift();
      const e = s.enemies.find((x) => x.id === id);
      if (e && hittable(e)) {
        const ox = p.x;
        const oy = bodyY(s);
        // 적 바로 앞 (막히지 않는 쪽)
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
          const nx = e.x + dx * (e.def.r + 8);
          const ny = e.y + dy * (e.def.r + 8) + BODY_UP;
          if (boxFree(s, nx, ny, HALF_W, HALF_H, 'p')) {
            p.x = nx;
            p.y = ny;
            p.face = dx > 0 ? 1 : dx < 0 ? 2 : dy > 0 ? 3 : 0;
            break;
          }
        }
        fx2(s, 'slash', ox, oy, e.x, e.y, 0.25);
        damageEnemy(s, e, patk(s) * P(o, 'slashMul', 2.5), true, false, true);
      }
      dc.t = P(o, 'slashGap', 0.15);
      if (!dc.ids.length) {
        p.dashChain = null;
        p.tired = P(o, 'tired', 5);
      }
    }
  }
}

function pullEnemy(s: RunState, e: Enemy, to: number) {
  const dx = s.p.x - e.x;
  const dy = bodyY(s) - e.y;
  const d = Math.hypot(dx, dy);
  if (d <= to) return;
  const n = Math.ceil((d - to) / 3);
  for (let i = 0; i < n; i++) moveBox(s, e, (dx / d) * Math.min(3, d - to - i * 3), (dy / d) * Math.min(3, d - to - i * 3), e.def.r * 0.8, e.def.r * 0.8, e.def.fly ? 'fly' : 'e');
}
function pushEnemy(s: RunState, e: Enemy, dirX: number, dirY: number, amount: number) {
  if (e.def.boss) return;
  const k = e.def.elite ? 0.35 : 1;
  const n = Math.ceil((amount * k) / 3);
  for (let i = 0; i < n; i++) moveBox(s, e, dirX * 3, dirY * 3, e.def.r * 0.8, e.def.r * 0.8, e.def.fly ? 'fly' : 'e');
}
function burnEnemy(e: Enemy, dur: number, dps: number) {
  e.burn = Math.max(e.burn, dur);
  e.burnDps = Math.max(e.burnDps, dps);
}
function slowEnemy(e: Enemy, _mul: number, dur: number) {
  e.slowT = Math.max(e.slowT, dur);
}
function freezeEnemy(e: Enemy, dur: number) {
  e.freeze = Math.max(e.freeze, dur);
  e.tele = null;
  if (e.state.endsWith('Wind') || e.state === 'windup') e.state = 'move';
}
function stunEnemy(e: Enemy, dur: number) {
  e.stun = Math.max(e.stun, dur);
  e.tele = null;
  if (e.state.endsWith('Wind') || e.state === 'windup') e.state = 'move';
}

// ---------- 퍼즐 ----------
/** 발판: 밟으면 눌리고, 그 방 발판을 시간 안에 모두 누르면 철문이 열린다 (못 하면 다시 올라온다) */
function stepPlates(s: RunState) {
  const p = s.p;
  const tx = Math.floor(p.x / TILE);
  const ty = Math.floor((p.y - 2) / TILE);
  if (tileOf(s, tx, ty) === T.PLATE) {
    const o = s.map.objs.find((x) => x.kind === 'plate' && x.x === tx && x.y === ty);
    if (o && !s.solved.has(o.room)) {
      setTile(s, tx, ty, T.PLATE_ON);
      const all = s.map.objs.filter((x) => x.kind === 'plate' && x.room === o.room);
      const on = all.filter((x) => tileOf(s, x.x, x.y) === T.PLATE_ON).length;
      if (!s.plateAt.has(o.room)) s.plateAt.set(o.room, s.t + 3 + 2.5 * all.length);
      s.events.push({ t: 'plate', on, all: all.length });
      if (on === all.length) {
        s.solved.add(o.room);
        s.plateAt.delete(o.room);
        openGates(s, o);
      }
    }
  }
  for (const [room, at] of s.plateAt) {
    if (s.t < at) continue;
    s.plateAt.delete(room);
    for (const x of s.map.objs) if (x.kind === 'plate' && x.room === room) setTile(s, x.x, x.y, T.PLATE);
    s.events.push({ t: 'plateReset' });
    note(s, '발판이 다시 올라왔어요. 시간 안에 모두 밟아야 해요');
  }
}
/** 발판 남은 시간 (HUD) */
export const plateLeft = (s: RunState) => {
  let best = 0;
  for (const at of s.plateAt.values()) best = Math.max(best, at - s.t);
  return best;
};
function openGates(s: RunState, o: Obj) {
  for (const g of o.gates ?? []) {
    if (tileOf(s, g.x, g.y) === T.GATE) {
      setTile(s, g.x, g.y, T.FLOOR);
      s.events.push({ t: 'gate', x: g.x, y: g.y });
    }
  }
}
function lightBrazier(s: RunState, tx: number, ty: number) {
  if (tileOf(s, tx, ty) !== T.BRAZIER) return;
  setTile(s, tx, ty, T.BRAZIER_LIT);
  s.events.push({ t: 'fire', x: tx, y: ty });
  const o = s.map.objs.find((x) => x.kind === 'brazier' && x.x === tx && x.y === ty);
  if (!o) return;
  const all = s.map.objs.filter((x) => x.kind === 'brazier' && x.room === o.room);
  if (all.every((x) => tileOf(s, x.x, x.y) === T.BRAZIER_LIT)) openGates(s, o);
}
function lightBraziers(s: RunState, b: Box) {
  for (const t of boxTiles(b)) lightBrazier(s, t.x, t.y);
}
function lightBraziersCircle(s: RunState, x: number, y: number, r: number) {
  for (const o of s.map.objs) if (o.kind === 'brazier' && Math.hypot(o.x * TILE + 8 - x, o.y * TILE + 8 - y) <= r) lightBrazier(s, o.x, o.y);
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
      const tpl = room.tpl;
      const need = (id: string, have: string, none: string) => {
        if (s.data.equipped !== id) note(s, s.data.orbs[id] ? have : none);
      };
      if (room.kind === 'puzzle') {
        if (tpl.includes('rat')) need('rat', '쥐 구슬을 장착하면 풀 수 있을 것 같아요', '무언가 날려 보낼 힘이 있으면 좋겠어요');
        else if (tpl.includes('ox')) need('ox', '소 구슬을 장착하면 바위를 부술 수 있을 것 같아요', '바위를 부술 힘이 있으면 좋겠어요');
        else if (tpl.includes('fire')) need('dragon', '용 구슬을 장착하면 화로에 불을 붙일 수 있을 것 같아요', '화로에 불을 붙일 힘이 있으면 좋겠어요');
        else if (tpl.includes('whip')) need('snake', '뱀 구슬을 장착하면 말뚝을 감아 건널 수 있을 것 같아요', '말뚝을 감아 당길 힘이 있으면 좋겠어요');
        else if (tpl.includes('plates') && !s.solved.has(rid)) note(s, '발판이 있어요. 시간 안에 모두 밟아 보자');
      }
    }
    const alive = s.enemies.filter((e) => e.room === rid && e.alive && !e.pending);
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
    const left = s.enemies.filter((e) => e.room === r && e.alive);
    if (!left.length) {
      s.locked.delete(r);
      s.cleared.add(r);
      s.waveAt.delete(r);
      s.events.push({ t: 'unlock' });
      continue;
    }
    // 나와 있는 무리를 다 잡았다 → 잠깐 뒤 다음 무리
    if (left.every((e) => e.pending)) {
      const at = s.waveAt.get(r);
      if (at === undefined) s.waveAt.set(r, s.t + WAVE_GAP);
      else if (s.t >= at) {
        s.waveAt.delete(r);
        const w = Math.min(...left.map((e) => e.wave));
        const total = Math.max(...s.enemies.filter((e) => e.room === r).map((e) => e.wave)) + 1;
        for (const e of left) {
          if (e.wave !== w) continue;
          e.pending = false;
          e.active = true;
          e.wake = WAKE_TIME;
          fx(s, { kind: 'spawn', x: e.x, y: e.y, r: e.def.r + 4, dur: WAKE_TIME });
        }
        s.events.push({ t: 'wave', n: w + 1, total });
      }
    }
  }
}

// ---------- 적 ----------
/** 캐릭터가 맞는다. src = 때린 적 (원숭이 되받아치기·역류) */
export function hurtPlayer(s: RunState, raw: number, status?: EnemyDef['status'], src?: Enemy) {
  const p = s.p;
  if (p.inv > 0 || s.over || p.pull) return;
  // 현무 결계: 피해 무효
  if (p.barrier > 0) {
    p.inv = 0.2;
    return void s.events.push({ t: 'hurt', dmg: 0, giant: false });
  }
  // 원숭이 막기: 타이밍 맞으면 피해 없이 되받아친다
  if (p.parry > 0) {
    p.parried = true;
    p.inv = 0.3;
    s.events.push({ t: 'parry' });
    fx(s, { kind: 'parry', x: p.x, y: bodyY(s), r: 16, dur: 0.3 });
    if (src && hittable(src)) damageEnemy(s, src, patk(s) * (orbDef('monkey')?.basic.mul ?? 1.5), true, false);
    return;
  }
  let dmg = Math.max(1, Math.round(raw * (0.9 + s.rng.next() * 0.2) - p.stats.def / 2));
  // 원숭이: 막기를 놓친 빈틈에는 더 아프다
  if (p.gap > 0) dmg = Math.round(dmg * prm('monkey', 'gapMul', 1.5));
  // 돼지: 맞으면 쌓은 연타가 사라진다
  if (p.storm > 0 && p.stacks > 0) {
    p.stacks = 0;
    note(s, '맞아서 쌓은 연타가 흩어졌어요');
  }
  if (p.giant) {
    p.giant.hp -= dmg;
    s.events.push({ t: 'hurt', dmg, giant: true });
    if (p.giant.hp <= 0) p.giant = null;
    p.inv = 0.2;
    return;
  }
  // 현무: 물 보호막 (피해를 줄이고 먼저 받는다)
  if (p.shield) {
    dmg = Math.max(1, Math.round(dmg * (1 - prm('turtle', 'reduce', 0.2))));
    const take = Math.min(p.shield.hp, dmg);
    p.shield.hp -= take;
    dmg -= take;
    if (p.shield.hp <= 0) p.shield = null;
    if (dmg <= 0) {
      p.inv = 0.25;
      return void s.events.push({ t: 'hurt', dmg: 0, giant: false });
    }
  }
  // 원숭이 역류: 받은 피해를 되돌려 준다
  if (p.reflect > 0 && src && hittable(src)) damageEnemy(s, src, dmg * prm('monkey', 'reflectMul', 2), true, false, true);
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
    // 주작 불사조: 그 전투에서 한 번 되살아난다
    const fight = `${s.room}:${s.locked.size ? 'f' : 'n'}`;
    if (p.rebirth > 0 && p.rebirthUsed !== fight) {
      p.rebirthUsed = fight;
      p.rebirth = 0;
      p.hp = Math.round(maxHp(s) * prm('phoenix', 'rebirth', 0.4));
      p.inv = 2;
      fx(s, { kind: 'explode', x: p.x, y: bodyY(s), r: 40, dur: 0.6 });
      s.events.push({ t: 'rebirth' });
      return;
    }
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

/** 적에게 피해 → 실제로 준 피해 */
function damageEnemy(s: RunState, e: Enemy, raw: number, big: boolean, basic: boolean, ignoreDef = false): number {
  if (!hittable(e)) return 0;
  const dmg = Math.max(1, Math.round(raw * (0.92 + s.rng.next() * 0.16) - (ignoreDef ? 0 : e.def.def / 2)));
  e.hp -= dmg;
  e.hitFlash = 0.12;
  if (basic) e.basicHits++;
  else e.onlyBasic = false;
  s.events.push({ t: 'hit', x: e.x, y: e.y - e.def.r, dmg, big });
  // 밀려남 (보스·정예는 거의 안 밀린다)
  if (!e.def.boss) {
    const k = e.def.elite ? 1 : 3;
    const dx = e.x - s.p.x;
    const dy = e.y - bodyY(s);
    const d = Math.hypot(dx, dy) || 1;
    moveBox(s, e, (dx / d) * k, (dy / d) * k, e.def.r * 0.8, e.def.r * 0.8, e.def.fly ? 'fly' : 'e');
  }
  if (e.hp <= 0) killEnemy(s, e);
  return dmg;
}

function killEnemy(s: RunState, e: Enemy) {
  e.alive = false;
  e.state = 'dead';
  e.tele = null;
  s.stats.kills++;
  const normal = !e.def.boss && !e.def.elite;
  if (e.onlyBasic && normal && !e.summoned) s.stats.killHits.push(e.basicHits);
  // 일반 적은 한 마리 몫이 작다 (한 층에 적이 많다). 보스가 부른 졸개는 경험치·엽전이 없다
  const expMul = e.summoned ? 0 : normal ? KILL_EXP : 1;
  const coinMul = e.summoned ? 0 : normal ? KILL_COINS : 1;
  const exp = (e.def.exp / 100) * expNeed(e.level) * expMul * (s.replay ? GROWTH.replayRate : 1);
  const coins = Math.round(s.rng.int(e.def.coins[0], e.def.coins[1]) * zoneMul(s.map.floor) * coinMul);
  s.data.coins += coins;
  s.stats.coins += coins;
  s.events.push({ t: 'kill', id: e.id, x: e.x, y: e.y, def: e.def.id, coins, exp: Math.round(exp) });
  gainExp(s, exp);
  // 주작 구슬: 적을 쓰러뜨리면 체력 회복
  if (s.data.equipped === 'phoenix') heal(s, maxHp(s) * prm('phoenix', 'killHeal', 0.04));
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
    // 보스층은 보스를 쓰러뜨리면 층을 깬 것 (잠깐 뒤 — 연출)
    s.clearAt = s.t + 2.5;
    for (const o of s.enemies) if (o.alive && o.room === e.room) killEnemy(s, o);
  }
}

function enemyMove(s: RunState, e: Enemy, dx: number, dy: number, speed: number) {
  const d = Math.hypot(dx, dy);
  if (d < 0.01) return;
  const v = speed * (e.slowT > 0 ? 0.5 : 1) * STEP;
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
  // 상태: 화상 (계속 피해) · 둔화 · 빙결 · 기절
  if (e.burn > 0) {
    e.burn = Math.max(0, e.burn - STEP);
    e.hp -= e.burnDps * STEP;
    if (e.hp <= 0) return killEnemy(s, e);
  }
  if (e.slowT > 0) e.slowT = Math.max(0, e.slowT - STEP);
  if (e.freeze > 0 || e.stun > 0) {
    e.freeze = Math.max(0, e.freeze - STEP);
    e.stun = Math.max(0, e.stun - STEP);
    return;
  }
  // 이제 막 나온 무리: 잠깐 뒤 움직인다
  if (e.wake > 0) {
    e.wake -= STEP;
    return;
  }
  if (e.cd > 0) e.cd -= STEP * (e.slowT > 0 ? 0.6 : 1);
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
        hurtPlayer(s, e.atk, def.status, e);
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
        hurtPlayer(s, e.atk, def.status, e);
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
          const base = Math.atan2(dy, dx);
          const n = def.spread?.count ?? 1;
          for (let i = 0; i < n; i++) shoot(s, e, base + (i - (n - 1) / 2) * (def.spread?.angle ?? 0), def.atk);
          e.cd = def.cd;
        }
      } else if (dist < (def.range ?? 100) && e.cd <= 0) {
        e.state = 'windup';
        e.t = def.windup ?? 0.5;
        e.faceX = Math.sign(dx) || e.faceX;
      }
      if (touching && e.cd <= 0 && e.state !== 'windup') {
        hurtPlayer(s, e.atk * 0.5, undefined, e);
        e.cd = 1;
      }
      break;
    case 'hop':
      hopAi(s, e, dx, dy, dist);
      break;
    case 'melee':
    case 'elite':
      meleeAi(s, e, dx, dy, dist);
      break;
    case 'golem':
      golemAi(s, e, dx, dy, dist, rage);
      break;
    case 'imugi':
      imugiAi(s, e, dx, dy, dist, rage);
      break;
  }
}

function shoot(s: RunState, e: Enemy, ang: number, mulAtk: number, status = e.def.status) {
  const pr = e.def.proj!;
  s.projs.push({ id: s.nextId++, from: 'e', kind: pr.kind, x: e.x, y: e.y, vx: Math.cos(ang) * pr.speed, vy: Math.sin(ang) * pr.speed, r: pr.r, life: pr.life, dmg: e.atk * mulAtk, hit: [], status, src: e.id });
}

/** 두꺼비: 예고(분홍 원) 뒤 그 자리로 뛰어올라 내려찍는다 */
function hopAi(s: RunState, e: Enemy, dx: number, dy: number, dist: number) {
  const def = e.def;
  const hop = def.hop!;
  switch (e.state) {
    case 'hopWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        e.state = 'hop';
        e.t = hop.time;
        e.from = { x: e.x, y: e.y };
      }
      return;
    case 'hop': {
      e.t -= STEP;
      const k = 1 - Math.max(0, e.t) / hop.time;
      if (e.from && e.to) {
        const nx = e.from.x + (e.to.x - e.from.x) * k;
        const ny = e.from.y + (e.to.y - e.from.y) * k;
        moveBox(s, e, nx - e.x, ny - e.y, def.r * 0.8, def.r * 0.8, 'fly');
      }
      if (e.t <= 0) {
        if (e.tele && Math.hypot(s.p.x - e.tele.x, bodyY(s) - e.tele.y) < hop.radius + 5) hurtPlayer(s, e.atk, def.status, e);
        e.tele = null;
        e.state = 'strike';
        e.t = 0.45;
        e.cd = def.cd;
      }
      return;
    }
    case 'strike':
      if ((e.t -= STEP) <= 0) e.state = 'move';
      return;
  }
  if (dist < (def.range ?? 90) && e.cd <= 0) {
    e.state = 'hopWind';
    e.t = def.windup ?? 0.6;
    e.to = { x: s.p.x, y: bodyY(s) };
    e.faceX = Math.sign(dx) || e.faceX;
    e.tele = { kind: 'circle', x: e.to.x, y: e.to.y, r: hop.radius, dx: 0, dy: 0, len: 0, t: 0, total: e.t };
    return;
  }
  if (dist > 20) enemyMove(s, e, dx, dy, def.speed);
  if (dist < def.r + 6 && e.cd <= 0) {
    hurtPlayer(s, e.atk * 0.6, undefined, e);
    e.cd = 1;
  }
}

function meleeAi(s: RunState, e: Enemy, dx: number, dy: number, dist: number) {
  const def = e.def;
  const reach = def.reach ?? 18;
  if (e.dashCd > 0) e.dashCd -= STEP;
  if (e.ringCd > 0) e.ringCd -= STEP;
  switch (e.state) {
    case 'windup': {
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        // 내리치기: 바라보던 쪽 앞의 원
        const hx = e.x + e.dirX * reach * 0.6;
        const hy = e.y + e.dirY * reach * 0.6;
        if (Math.hypot(s.p.x - hx, s.p.y - BODY_UP - hy) < reach * 0.75 + 5) hurtPlayer(s, e.atk, def.status, e);
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
    case 'ringWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        const n = def.ring!.count;
        const off = s.rng.next() * Math.PI;
        for (let i = 0; i < n; i++) shoot(s, e, off + (i / n) * Math.PI * 2, def.ring!.mul);
        e.tele = null;
        e.state = 'strike';
        e.t = 0.4;
        e.ringCd = def.ring!.every;
      }
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
        hurtPlayer(s, e.atk * 1.2, undefined, e);
      }
      if ((e.t -= STEP) <= 0 || moved < 0.2) {
        e.state = 'move';
        e.dashCd = def.dash!.every;
        e.cd = 0.5;
      }
      return;
    }
  }
  // 정예: 둘레로 가시 (거리를 두면 자주)
  if (def.ring && e.ringCd <= 0 && dist < 140) {
    e.state = 'ringWind';
    e.t = def.ring.windup;
    e.tele = { kind: 'circle', x: e.x, y: e.y, r: 36, dx: 0, dy: 0, len: 0, t: 0, total: e.t };
    return;
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
        if (dist < def.slam!.radius + 4) hurtPlayer(s, e.atk * def.slam!.mul, undefined, e);
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
        hurtPlayer(s, e.atk * def.charge!.mul, undefined, e);
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
        if (dist < (def.reach ?? 26) + 6) hurtPlayer(s, e.atk, undefined, e);
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

/**
 * 이끼 이무기 (20층 보스): 물어뜯기(돌진) · 꼬리 휩쓸기(둘레) · 독 뱉기(부채꼴, 독) · 땅파기(땅속으로 숨어 발밑에서 솟구침).
 * 체력 절반이면 성나서 빨라지고 이끼 나방 둘을 부른다 (한 번).
 */
const IMUGI_CYCLE = ['bite', 'spit', 'sweep', 'burrow', 'spit', 'bite', 'sweep', 'burrow'] as const;
function imugiAi(s: RunState, e: Enemy, dx: number, dy: number, dist: number, rageMul: number) {
  const def = e.def;
  if (!e.rage && e.hp <= e.max * (def.rage ?? 0.5)) {
    e.rage = true;
    s.events.push({ t: 'boss', phase: 2 });
    if (def.summon) {
      for (let i = 0; i < def.summon.count; i++) {
        const a = (i / def.summon.count) * Math.PI * 2 + 0.5;
        const m = makeEnemy(s, def.summon.id, e.room, e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30, 0, e.level);
        m.active = true;
        m.summoned = true;
        m.wake = WAKE_TIME;
        s.enemies.push(m);
        fx(s, { kind: 'spawn', x: m.x, y: m.y, r: 9, dur: WAKE_TIME });
      }
    }
  }
  const d = dist || 1;
  switch (e.state) {
    case 'biteWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        e.state = 'bite';
        e.t = def.bite!.time;
        e.touched = false;
        e.tele = null;
      }
      return;
    case 'bite': {
      const moved = enemyMove(s, e, e.dirX, e.dirY, def.bite!.speed * (e.rage ? 1.15 : 1)) ?? 0;
      if (!e.touched && Math.hypot(s.p.x - e.x, bodyY(s) - e.y) < def.r + 6) {
        e.touched = true;
        hurtPlayer(s, e.atk * def.bite!.mul, def.status, e);
      }
      if ((e.t -= STEP) <= 0 || moved < 0.3) {
        e.state = 'stun';
        e.t = moved < 0.3 ? 1.0 : 0.4;
      }
      return;
    }
    case 'sweepWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        if (dist < def.sweep!.radius + 4) hurtPlayer(s, e.atk * def.sweep!.mul, undefined, e);
        e.tele = null;
        e.state = 'strike';
        e.t = 0.5;
      }
      return;
    case 'spitWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        const n = e.rage ? def.spit!.countRage : def.spit!.count;
        const base = Math.atan2(dy, dx);
        for (let i = 0; i < n; i++) shoot(s, e, base + (i - (n - 1) / 2) * def.spit!.spread, def.spit!.mul);
        e.tele = null;
        e.state = 'strike';
        e.t = 0.5;
      }
      return;
    case 'burrow':
      // 땅속: 캐릭터 쪽으로 파고든다 (맞지 않는다)
      enemyMove(s, e, dx, dy, 70);
      if ((e.t -= STEP) <= 0) {
        e.state = 'burrowWind';
        e.t = def.burrow!.windup * rageMul;
        e.to = { x: s.p.x, y: bodyY(s) };
        e.tele = { kind: 'circle', x: e.to.x, y: e.to.y, r: def.burrow!.radius, dx: 0, dy: 0, len: 0, t: 0, total: e.t };
      }
      return;
    case 'burrowWind':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        // 솟구친다: 예고한 자리로 (막혀 있으면 지금 자리에서)
        if (e.to && boxFree(s, e.to.x, e.to.y, def.r * 0.8, def.r * 0.8, 'e')) {
          e.x = e.to.x;
          e.y = e.to.y;
        }
        if (e.tele && Math.hypot(s.p.x - e.tele.x, bodyY(s) - e.tele.y) < def.burrow!.radius + 4) hurtPlayer(s, e.atk * def.burrow!.mul, undefined, e);
        e.hidden = false;
        e.tele = null;
        e.state = 'strike';
        e.t = 0.9;
        fx(s, { kind: 'dust', x: e.x, y: e.y, r: def.burrow!.radius, dur: 0.4 });
      }
      return;
    case 'stun':
    case 'strike':
      if ((e.t -= STEP) <= 0) {
        e.state = 'move';
        e.cd = (e.rage ? 1.2 : 1.8) + s.rng.next() * 0.6;
      }
      return;
    case 'windup':
      if (e.tele) e.tele.t += STEP;
      if ((e.t -= STEP) <= 0) {
        if (dist < (def.reach ?? 28) + 6) hurtPlayer(s, e.atk, def.status, e);
        e.tele = null;
        e.state = 'strike';
        e.t = 0.35;
      }
      return;
  }
  if (dist > (def.reach ?? 28)) enemyMove(s, e, dx, dy, def.speed * (e.rage ? 1.25 : 1));
  else e.faceX = Math.sign(dx) || e.faceX;
  if (e.cd > 0) {
    if (dist < (def.reach ?? 28) + 2 && e.cd < 1.2 && e.cd > 0.2) {
      e.state = 'windup';
      e.t = (def.windup ?? 0.6) * rageMul;
      e.tele = { kind: 'circle', x: e.x, y: e.y, r: (def.reach ?? 28) + 6, dx: 0, dy: 0, len: 0, t: 0, total: e.t };
      e.cd = 1.4;
    }
    return;
  }
  const move = IMUGI_CYCLE[e.pattern++ % IMUGI_CYCLE.length];
  e.dirX = dx / d;
  e.dirY = dy / d;
  e.faceX = Math.sign(dx) || e.faceX;
  if (move === 'bite') {
    e.state = 'biteWind';
    e.t = def.bite!.windup * rageMul;
    e.tele = { kind: 'line', x: e.x, y: e.y, r: def.r, dx: e.dirX, dy: e.dirY, len: def.bite!.speed * def.bite!.time, t: 0, total: e.t };
  } else if (move === 'sweep') {
    e.state = 'sweepWind';
    e.t = def.sweep!.windup * rageMul;
    e.tele = { kind: 'circle', x: e.x, y: e.y, r: def.sweep!.radius, dx: 0, dy: 0, len: 0, t: 0, total: e.t };
  } else if (move === 'spit') {
    e.state = 'spitWind';
    e.t = def.spit!.windup * rageMul;
    e.tele = { kind: 'line', x: e.x, y: e.y, r: 4, dx: e.dirX, dy: e.dirY, len: 60, t: 0, total: e.t };
  } else {
    e.state = 'burrow';
    e.t = def.burrow!.hide * rageMul;
    e.hidden = true;
    fx(s, { kind: 'dust', x: e.x, y: e.y, r: def.r + 6, dur: 0.4 });
  }
}

// ---------- 투사체 ----------
function updateProjs(s: RunState) {
  const p = s.p;
  const blades = p.blades > 0 ? prm('rooster', 'bladeR', 20) + 6 : 0;
  for (const pr of s.projs) {
    pr.life -= STEP;
    pr.x += pr.vx * STEP;
    pr.y += pr.vy * STEP;
    const tx = Math.floor(pr.x / TILE);
    const ty = Math.floor(pr.y / TILE);
    const t = tileOf(s, tx, ty);
    if (t === T.DOOR ? blockedFor(s, tx, ty, 'p') : !flyable(t)) {
      if (pr.from === 'p' && (t === T.SWITCH || t === T.VINE)) hitSwitch(s, tx, ty);
      else if (pr.from === 'p' && t === T.BRAZIER && pr.burn) lightBrazier(s, tx, ty);
      else if (pr.from === 'p' && t === T.GATE) note(s, '이 문은 장치를 풀어야 열려요');
      pr.life = 0;
      continue;
    }
    if (pr.from === 'p') {
      if (pr.tick) {
        pr.tickT = (pr.tickT ?? 0) - STEP;
        if (pr.tickT <= 0) {
          pr.tickT = pr.tick;
          pr.hit = [];
        }
      }
      for (const e of s.enemies) {
        if (!hittable(e) || pr.hit.includes(e.id)) continue;
        if (Math.hypot(e.x - pr.x, e.y - pr.y) < e.def.r + pr.r) {
          pr.hit.push(e.id);
          damageEnemy(s, e, pr.dmg, true, false);
          if (e.alive && pr.slow) slowEnemy(e, pr.slow.mul, pr.slow.dur);
          if (e.alive && pr.burn) burnEnemy(e, pr.burn.dur, pr.burn.dps);
          if (e.alive && pr.push) {
            const v = Math.hypot(pr.vx, pr.vy) || 1;
            pushEnemy(s, e, pr.vx / v, pr.vy / v, pr.push);
          }
          if (!pr.pierce) {
            pr.life = 0;
            break;
          }
        }
      }
    } else {
      const d = Math.hypot(p.x - pr.x, bodyY(s) - pr.y);
      // 닭 깃털 방벽: 도는 칼날이 투사체를 막는다
      if (blades && d < blades) {
        pr.life = 0;
        fx(s, { kind: 'spark', x: pr.x, y: pr.y, r: 4, dur: 0.2 });
        continue;
      }
      if (d < pr.r + 5) {
        // 원숭이 막기: 투사체를 되돌려 보낸다
        if (p.parry > 0) {
          p.parried = true;
          s.events.push({ t: 'parry' });
          pr.from = 'p';
          pr.vx = -pr.vx * 1.4;
          pr.vy = -pr.vy * 1.4;
          pr.dmg = patk(s) * (orbDef('monkey')?.basic.mul ?? 1.5);
          pr.life = 1.2;
          pr.hit = [];
          pr.status = undefined;
          fx(s, { kind: 'parry', x: p.x, y: bodyY(s), r: 16, dur: 0.3 });
          continue;
        }
        hurtPlayer(s, pr.dmg, pr.status, s.enemies.find((e) => e.id === pr.src));
        pr.life = 0;
      }
    }
  }
  s.projs = s.projs.filter((pr) => pr.life > 0);
}

function hitSwitch(s: RunState, tx: number, ty: number) {
  const o = s.map.objs.find((x) => x.kind === 'switch' && x.x === tx && x.y === ty);
  setTile(s, tx, ty, tileOf(s, tx, ty) === T.VINE ? T.WATER : T.SWITCH_ON);
  if (o) openGates(s, o);
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
