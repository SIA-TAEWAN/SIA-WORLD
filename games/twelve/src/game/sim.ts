/**
 * 전투 시뮬레이션 (PRD '전투와 조작'). 1/60초 고정 간격의 순수 모듈 — 화면(Phaser)·시계·DOM 을 모른다.
 * 무작위는 판 씨앗(seed) 하나에서만 나온다: 같은 씨앗 + 같은 입력 = 같은 결과.
 *
 * 성능 (요괴가 많은 맵): 요괴는 판을 만들 때 한 번만 만들고, 깨어난(awake) 요괴만 움직인다.
 * 날아가는 것(shots)은 꺼진 칸을 다시 쓴다. 화면은 events 를 읽어 숫자·효과를 그린 뒤 비운다.
 */
import type { Act, OnHit, Shape, ShotLook, ZoneLook } from '../data/acts';
import {
  AIM_HALF,
  EXIT_KILL_RATIO,
  HURT_INVULN,
  MAP_W,
  MP_REGEN,
  PLAYER_R,
  POTION_CD,
  POTION_HEAL,
  ROLL,
  SLOW_TILE_MUL,
  STEP,
  TILE,
  WAKE_DIST,
  damageOf,
  skillLevelMul,
} from '../data/balance';
import { BOSSES, type BossDef, type BossMove } from '../data/bosses';
import { ELITE, ENEMIES, type EnemyDef, type EnemyKind } from '../data/enemies';
import { playerStats, type Loadout, type PlayerStats } from '../data/growth';
import { heroOf, type HeroDef } from '../data/heroes';
import { T_SLOW, T_WALL, groupList, type MapDef } from '../data/maps';
import { mapScale, regionOf, type Mode } from '../data/regions';
import { WEAPONS, type SkillDef, type WeaponDef } from '../data/weapons';

export { STEP };

/** 한 간격의 입력. skill·unique·roll·potion 은 누른 순간에만 true (화면이 한 간격 뒤에 내린다) */
export interface Input {
  /** 이동 방향 (-1~1) */
  mx: number;
  my: number;
  /** 공격 버튼을 누르고 있는지 */
  attack: boolean;
  skill: [boolean, boolean];
  unique: boolean;
  roll: boolean;
  potion: [boolean, boolean];
}
export const noInput = (): Input => ({ mx: 0, my: 0, attack: false, skill: [false, false], unique: false, roll: false, potion: [false, false] });

export interface Player {
  x: number;
  y: number;
  /** 바라보는 방향 (단위 벡터). 멈추면 그대로 남는다 */
  fx: number;
  fy: number;
  hp: number;
  mp: number;
  moving: boolean;
  atkCd: number;
  skillCd: [number, number];
  uniqueCd: number;
  rollCd: number;
  /** 구르는 중 남은 시간 · 속도 */
  rollT: number;
  rvx: number;
  rvy: number;
  /** 돌진 스킬 중 */
  dashT: number;
  dash: { act: Extract<Act, { t: 'dash' }>; tag: number; power: number } | null;
  /** 무적 남은 시간 */
  invuln: number;
  potionCd: number;
  /** 맞은 표시 · 휘두르는 표시 (화면용 타이머) */
  hurt: number;
  swing: number;
  buff: { atk: number; atkT: number; speed: number; speedT: number; crit: number; critT: number; guard: number; guardT: number };
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  def: EnemyDef;
  /** 보스면 그 정의 */
  bossDef: BossDef | null;
  elite: boolean;
  /** 보스가 부른 부하 (처치 수·보상에 넣지 않는다) */
  summoned: boolean;
  group: number;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  atk: number;
  armor: number;
  speed: number;
  exp: number;
  coin: number;
  awake: boolean;
  dead: boolean;
  /** 공격 대기 */
  cd: number;
  /** 공격 예고 중 (움직이지 않는다) */
  busy: number;
  stun: number;
  slowT: number;
  slowMul: number;
  dotT: number;
  dotDps: number;
  dotAcc: number;
  /** 밀려나는 속도 */
  kx: number;
  ky: number;
  /** 왼쪽을 보는지 (화면용) */
  left: boolean;
  /** 맞은 표시 (화면용 타이머) */
  flash: number;
  /** 한 동작에 한 번만 맞게 하는 표시 */
  tag: number;
  /** 보스: 다음 공격 번호 · 부른 횟수. 정예: 휩쓸기 대기 */
  move: number;
  calls: number;
  ringCd: number;
}

export interface Shot {
  on: boolean;
  /** 요괴가 쏜 것 */
  foe: boolean;
  look: ShotLook | 'fire';
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 남은 거리 */
  left: number;
  /** 대원 것: 피해 배율 · 붙는 효과 / 요괴 것: 피해량 */
  mul: number;
  hit: OnHit | null;
  pierce: number;
  /** 이미 맞힌 요괴 */
  seen: number[];
}

export interface Zone {
  look: ZoneLook;
  x: number;
  y: number;
  r: number;
  left: number;
  total: number;
  tick: number;
  acc: number;
  mul: number;
  pull: number;
  hit: OnHit;
}

/** 요괴 공격 예고: 빨간 범위가 t 초 뒤에 터진다 */
export interface Warn {
  shape: 'circle' | 'line' | 'arc' | 'none';
  x: number;
  y: number;
  ang: number;
  r: number;
  len: number;
  w: number;
  half: number;
  /** 보이기 전 기다리는 시간 (이어 찍기). 끝나면 대원 자리로 옮겨 온다 */
  delay: number;
  t: number;
  total: number;
  dmg: number;
  /** 낸 요괴 (-1 = 없음) */
  src: number;
  /** 터진 뒤: 요괴가 그 자리로 돌진 / 불을 쏜다 */
  after: 'none' | 'dash' | 'shoot';
  /** 큰 공격 (진하게 그리고 소리로 알린다) */
  big: boolean;
}

export type SimEvent =
  | { e: 'dmg'; x: number; y: number; n: number; crit: boolean }
  | { e: 'hurt'; x: number; y: number; n: number }
  | { e: 'kill'; x: number; y: number; size: number; elite: boolean; boss: boolean }
  | { e: 'fx'; shape: Shape; x: number; y: number; ang: number }
  | { e: 'chain'; pts: number[] }
  | { e: 'heal'; hp: number; mp: number }
  | { e: 'boom'; x: number; y: number; r: number }
  | { e: 'sound'; name: string }
  | { e: 'chest'; coins: number }
  | { e: 'exit' }
  | { e: 'nope'; why: 'mp' | 'target' };

export interface RunOpts {
  seed?: number;
  /** 들고 들어가는 물약 [체력, 마력] */
  potions?: [number, number];
  /** 개발용 무적 (?god=1) */
  god?: boolean;
}

export interface RunState {
  map: MapDef;
  mode: Mode;
  /** 맵 권장 레벨 */
  level: number;
  loadout: Loadout;
  stats: PlayerStats;
  hero: HeroDef;
  weapon: WeaponDef;
  /** 타일: 0 바닥 · 1 벽 · 2 느려지는 땅 */
  grid: Uint8Array;
  cols: number;
  rows: number;
  /** 대원 칸까지의 걸음 수 (길 찾기). 대원이 칸을 옮길 때만 대원 둘레를 다시 센다. -1 = 못 간다·범위 밖 */
  dist: Int16Array;
  distCell: number;
  t: number;
  phase: 'play' | 'clear' | 'dead';
  seed: number;
  p: Player;
  enemies: Enemy[];
  shots: Shot[];
  zones: Zone[];
  warns: Warn[];
  /** 조금 뒤에 나갈 동작 */
  queue: { at: number; act: Act; power: number }[];
  events: SimEvent[];
  /** 셀 수 있는 요괴 수 (부하·보스 제외) · 잡은 수 */
  total: number;
  killed: number;
  kills: Partial<Record<EnemyKind, number>>;
  eliteKills: number;
  boss: Enemy | null;
  bossDead: boolean;
  exitOpen: boolean;
  chest: boolean;
  /** 이 판에서 얻은 경험치·엽전 (화면 표시용. 저장은 progress.ts / 서버가 다시 계산한다) */
  exp: number;
  coins: number;
  potions: [number, number];
  potionsUsed: number;
  god: boolean;
  tag: number;
  nextId: number;
  reward: number;
  /** 출구·상자 자리 (맵 좌표) */
  exitX: number;
  exitY: number;
  chestX: number;
  chestY: number;
}

// ---------- 도구 ----------

/** 판 씨앗에서 0~1 (mulberry32) */
export function rand(s: RunState): number {
  s.seed = (s.seed + 0x6d2b79f5) >>> 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const center = (c: number) => (c + 0.5) * TILE;

export function tileAt(s: RunState, x: number, y: number): number {
  const cx = Math.floor(x / TILE);
  const cy = Math.floor(y / TILE);
  if (cx < 0 || cy < 0 || cx >= s.cols || cy >= s.rows) return 1;
  return s.grid[cy * s.cols + cx];
}

/** 반지름 r 인 몸이 (x, y) 에 설 수 없는지 */
function blocked(s: RunState, x: number, y: number, r: number): boolean {
  return tileAt(s, x - r, y - r) === 1 || tileAt(s, x + r, y - r) === 1 || tileAt(s, x - r, y + r) === 1 || tileAt(s, x + r, y + r) === 1;
}

/** 벽에 막히면 그 축만 멈춘다 */
function move(s: RunState, o: { x: number; y: number }, dx: number, dy: number, r: number) {
  // 한 번에 벽 두께보다 많이 가지 않게 나눠서 간다
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE * 0.4)));
  const sx = dx / n;
  const sy = dy / n;
  for (let i = 0; i < n; i++) {
    if (sx && !blocked(s, o.x + sx, o.y, r)) o.x += sx;
    if (sy && !blocked(s, o.x, o.y + sy, r)) o.y += sy;
  }
}

/** 길 찾기 범위: 대원 위아래 이만큼의 줄 */
const FLOW_ROWS = 20;
const flowQueue = new Int32Array(MAP_W * (FLOW_ROWS * 2 + 1));

/** 대원 칸에서 퍼져 나가며 걸음 수를 센다 (대원이 칸을 옮겼을 때만) */
function updateFlow(s: RunState) {
  const pc = Math.floor(s.p.x / TILE);
  const pr = Math.floor(s.p.y / TILE);
  const cell = pr * s.cols + pc;
  if (cell === s.distCell || pc < 0 || pr < 0 || pc >= s.cols || pr >= s.rows) return;
  s.distCell = cell;
  const top = Math.max(0, pr - FLOW_ROWS);
  const bottom = Math.min(s.rows - 1, pr + FLOW_ROWS);
  s.dist.fill(-1);
  let head = 0;
  let tail = 0;
  s.dist[cell] = 0;
  flowQueue[tail++] = cell;
  while (head < tail) {
    const c = flowQueue[head++];
    const x = c % s.cols;
    const y = (c - x) / s.cols;
    const d = s.dist[c] + 1;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || nx >= s.cols || ny < top || ny > bottom) continue;
      const n = ny * s.cols + nx;
      if (s.grid[n] === 1 || s.dist[n] >= 0) continue;
      s.dist[n] = d;
      flowQueue[tail++] = n;
    }
  }
}

/** (x, y) 에서 대원까지 벽에 막히지 않고 곧장 갈 수 있는지 (몸 너비만큼 양옆도 본다) */
function clearLine(s: RunState, x: number, y: number, r: number): boolean {
  const dx = s.p.x - x;
  const dy = s.p.y - y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const ox = (-dy / d) * r * 0.8;
  const oy = (dx / d) * r * 0.8;
  const n = Math.ceil(d / (TILE * 0.45));
  for (let i = 1; i < n; i++) {
    const px = x + (dx * i) / n;
    const py = y + (dy * i) / n;
    if (tileAt(s, px + ox, py + oy) === 1 || tileAt(s, px - ox, py - oy) === 1) return false;
  }
  return true;
}

const chase = { x: 0, y: 0 };
/** 요괴가 대원에게 가려면 지금 어느 쪽으로 가야 하는지 → chase (단위 벡터). 곧장 갈 수 있으면 곧장, 아니면 걸음 수가 줄어드는 옆 칸으로 */
function chaseDir(s: RunState, e: Enemy, ux: number, uy: number) {
  chase.x = ux;
  chase.y = uy;
  if (clearLine(s, e.x, e.y, Math.min(e.r, TILE * 0.45))) return;
  const cx = Math.floor(e.x / TILE);
  const cy = Math.floor(e.y / TILE);
  if (cx < 0 || cy < 0 || cx >= s.cols || cy >= s.rows) return;
  let best = s.dist[cy * s.cols + cx];
  if (best < 0) return;
  let bx = cx;
  let by = cy;
  for (let k = 0; k < 4; k++) {
    const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
    const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
    if (nx < 0 || nx >= s.cols || ny < 0 || ny >= s.rows) continue;
    const d = s.dist[ny * s.cols + nx];
    if (d >= 0 && d < best) {
      best = d;
      bx = nx;
      by = ny;
    }
  }
  // 옆 칸 가운데를 향해 간다 (지금 칸의 가운데 줄에서 벗어나 있으면 모서리에 걸리지 않게 그쪽도 맞춘다)
  const tx = bx === cx ? center(cx) : center(bx);
  const ty = by === cy ? center(cy) : center(by);
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  chase.x = dx / d;
  chase.y = dy / d;
}

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};

/** (px, py) 가 (x, y) 에서 ang 쪽으로 낸 범위 안에 있는지. pad = 맞는 쪽 몸 반지름 */
function inShape(shape: Shape, x: number, y: number, ang: number, px: number, py: number, pad: number): boolean {
  const dx = px - x;
  const dy = py - y;
  if (shape.k === 'circle') return dx * dx + dy * dy <= (shape.r + pad) * (shape.r + pad);
  if (shape.k === 'arc') {
    const d2 = dx * dx + dy * dy;
    if (d2 > (shape.r + pad) * (shape.r + pad)) return false;
    // 바로 붙어 있으면 방향과 상관없이 맞는다
    if (d2 <= (pad + PLAYER_R) * (pad + PLAYER_R)) return true;
    return angDiff(Math.atan2(dy, dx), ang) <= shape.half;
  }
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const along = dx * c + dy * sn;
  const side = -dx * sn + dy * c;
  return along >= -pad && along <= shape.len + pad && Math.abs(side) <= shape.w / 2 + pad;
}

// ---------- 판 만들기 ----------

function newEnemy(s: RunState, def: EnemyDef, x: number, y: number, group: number, o: { elite?: boolean; summoned?: boolean; boss?: BossDef } = {}): Enemy {
  const sc = mapScale(s.map.region, s.map.no, s.mode);
  const b = o.boss;
  const hp = Math.round((b ? b.hp : def.hp * (o.elite ? ELITE.hp : 1)) * sc.hp);
  const e: Enemy = {
    id: s.nextId++,
    kind: def.kind,
    def,
    bossDef: b ?? null,
    elite: !!o.elite,
    summoned: !!o.summoned,
    group,
    x,
    y,
    r: b ? b.r : def.r * (o.elite ? ELITE.size : 1),
    hp,
    maxHp: hp,
    atk: (b ? b.atk : def.atk * (o.elite ? ELITE.atk : 1)) * sc.atk,
    armor: sc.def * (b ? 1 : 0.5),
    speed: b ? b.speed : def.speed,
    exp: o.summoned ? 0 : Math.round((b ? b.exp : def.exp * (o.elite ? ELITE.reward : 1)) * sc.reward),
    coin: o.summoned ? 0 : Math.round((b ? b.coin : def.coin * (o.elite ? ELITE.reward : 1)) * sc.reward),
    awake: !!o.summoned,
    dead: false,
    cd: 0.4 + rand(s) * 0.8,
    busy: 0,
    stun: 0,
    slowT: 0,
    slowMul: 1,
    dotT: 0,
    dotDps: 0,
    dotAcc: 0,
    kx: 0,
    ky: 0,
    left: false,
    flash: 0,
    tag: 0,
    move: 0,
    calls: 0,
    ringCd: ELITE.ringEvery * 0.6,
  };
  s.enemies.push(e);
  return e;
}

/** (cx, cy) 둘레의 빈 자리 (i 번째). 벽이면 가운데 */
function spotAround(s: RunState, cx: number, cy: number, i: number, n: number, r: number): [number, number] {
  if (i === 0 && n === 1) return [cx, cy];
  const ring = 46 + 30 * Math.floor(i / 6);
  const a = (i / Math.min(6, n)) * Math.PI * 2 + Math.floor(i / 6) * 0.5;
  const x = cx + Math.cos(a) * ring;
  const y = cy + Math.sin(a) * ring;
  return blocked(s, x, y, r) ? [cx, cy] : [x, y];
}

export function createRun(map: MapDef, mode: Mode, loadout: Loadout, opts: RunOpts = {}): RunState {
  const cols = MAP_W;
  const rows = map.rows.length;
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) grid[y * cols + x] = map.rows[y][x] === T_WALL ? 1 : map.rows[y][x] === T_SLOW ? 2 : 0;
  const sc = mapScale(map.region, map.no, mode);
  const stats = playerStats(loadout, map.region);
  const s: RunState = {
    map,
    mode,
    level: sc.level,
    loadout,
    stats,
    hero: heroOf(loadout.hero),
    weapon: WEAPONS[loadout.weapon],
    grid,
    cols,
    rows,
    dist: new Int16Array(cols * rows).fill(-1),
    distCell: -1,
    t: 0,
    phase: 'play',
    seed: (opts.seed ?? 1) >>> 0,
    p: {
      x: center(map.start[0]),
      y: center(map.start[1]),
      fx: 0,
      fy: -1,
      hp: stats.hp,
      mp: stats.mp,
      moving: false,
      atkCd: 0,
      skillCd: [0, 0],
      uniqueCd: 0,
      rollCd: 0,
      rollT: 0,
      rvx: 0,
      rvy: 0,
      dashT: 0,
      dash: null,
      invuln: 0,
      potionCd: 0,
      hurt: 0,
      swing: 0,
      buff: { atk: 1, atkT: 0, speed: 1, speedT: 0, crit: 0, critT: 0, guard: 1, guardT: 0 },
    },
    enemies: [],
    shots: [],
    zones: [],
    warns: [],
    queue: [],
    events: [],
    total: 0,
    killed: 0,
    kills: {},
    eliteKills: 0,
    boss: null,
    bossDead: false,
    exitOpen: false,
    chest: false,
    exp: 0,
    coins: 0,
    potions: opts.potions ? [opts.potions[0], opts.potions[1]] : [0, 0],
    potionsUsed: 0,
    god: !!opts.god,
    tag: 1,
    nextId: 1,
    reward: sc.reward,
    exitX: center(map.exit[0]),
    exitY: center(map.exit[1]),
    chestX: center(map.chest[0]),
    chestY: center(map.chest[1]),
  };
  map.groups.forEach((g, gi) => {
    const list = groupList(g, sc.count);
    const n = list.reduce((a, [, c]) => a + c, 0) + (g.elite ? 1 : 0);
    let i = 0;
    const cx = center(g.at[0]);
    const cy = center(g.at[1]);
    if (g.elite) {
      const def = ENEMIES[g.elite];
      const [x, y] = spotAround(s, cx, cy, i++, n, def.r * ELITE.size);
      newEnemy(s, def, x, y, gi, { elite: true });
    }
    for (const [k, c] of list) {
      const def = ENEMIES[k];
      for (let j = 0; j < c; j++) {
        const [x, y] = spotAround(s, cx, cy, i++, n, def.r);
        newEnemy(s, def, x, y, gi);
      }
    }
  });
  s.total = s.enemies.length;
  if (map.boss) {
    const def = BOSSES[regionOf(map.region).boss];
    s.boss = newEnemy(s, ENEMIES[def.summon.kind], center(map.boss[0]), center(map.boss[1]), -1, { boss: def });
    s.boss.cd = 1.5;
  }
  return s;
}

// ---------- 대원의 공격 ----------

const atkNow = (s: RunState) => s.stats.atk * (s.p.buff.atkT > 0 ? s.p.buff.atk : 1);
const critNow = (s: RunState) => s.stats.crit + (s.p.buff.critT > 0 ? s.p.buff.crit : 0);

function push(s: RunState, ev: SimEvent) {
  // 화면이 비우지 않아도(테스트) 끝없이 쌓이지 않게
  if (s.events.length < 400) s.events.push(ev);
}

function wakeGroup(s: RunState, group: number) {
  if (group < 0) return;
  for (const e of s.enemies) if (e.group === group && !e.dead) e.awake = true;
}

function killEnemy(s: RunState, e: Enemy) {
  e.dead = true;
  e.hp = 0;
  push(s, { e: 'kill', x: e.x, y: e.y, size: e.r, elite: e.elite, boss: !!e.bossDef });
  if (e.summoned) return;
  s.exp += e.exp;
  s.coins += e.coin;
  if (e.bossDef) {
    s.bossDead = true;
    // 보스가 쓰러지면 부하와 남은 예고도 사라진다
    for (const o of s.enemies) if (o.summoned && !o.dead) killEnemy(s, o);
    s.warns.length = 0;
    for (const sh of s.shots) if (sh.foe) sh.on = false;
  } else {
    s.killed++;
    if (e.elite) s.eliteKills++;
    else s.kills[e.kind] = (s.kills[e.kind] ?? 0) + 1;
  }
  const open = s.map.boss ? s.bossDead : s.killed >= Math.ceil(s.total * EXIT_KILL_RATIO);
  if (open && !s.exitOpen) {
    s.exitOpen = true;
    push(s, { e: 'exit' });
  }
}

/** 요괴에게 피해를 준다 (치명타는 여기서 굴린다) */
function hitEnemy(s: RunState, e: Enemy, mul: number, on: OnHit | null, fromX: number, fromY: number) {
  if (e.dead) return;
  const crit = rand(s) < critNow(s);
  const n = damageOf(atkNow(s), mul, e.armor, crit);
  e.hp -= n;
  e.flash = 0.12;
  if (!e.awake) {
    e.awake = true;
    wakeGroup(s, e.group);
  }
  push(s, { e: 'dmg', x: e.x, y: e.y - e.r, n, crit });
  if (on) {
    if (on.kb) {
      const dx = e.x - fromX;
      const dy = e.y - fromY;
      const d = Math.hypot(dx, dy) || 1;
      const k = on.kb * (e.bossDef ? 0.1 : e.elite ? 0.4 : 1) * 6;
      e.kx += (dx / d) * k;
      e.ky += (dy / d) * k;
    }
    if (on.stun && !e.bossDef) e.stun = Math.max(e.stun, on.stun * (e.elite ? 0.5 : 1));
    if (on.slow) {
      e.slowT = Math.max(e.slowT, on.slow.dur);
      e.slowMul = e.bossDef ? Math.max(0.8, on.slow.mul) : on.slow.mul;
    }
    if (on.dot) {
      e.dotT = Math.max(e.dotT, on.dot.dur);
      e.dotDps = Math.max(e.dotDps, atkNow(s) * on.dot.mul);
    }
  }
  if (e.hp <= 0) killEnemy(s, e);
}

/** 조준: 바라보는 쪽 ±AIM_HALF, range 안의 가장 가까운 요괴를 향해 돌아선다 → 각도 */
function aim(s: RunState, range: number): number {
  const p = s.p;
  const face = Math.atan2(p.fy, p.fx);
  let best: Enemy | null = null;
  let bd = Infinity;
  for (const e of s.enemies) {
    if (e.dead || !e.awake) continue;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy) - e.r;
    if (d > range || d >= bd) continue;
    // 움직이는 중에는 가는 쪽 요괴만, 서 있으면 둘레 어디든
    if (p.moving && d > PLAYER_R * 2 && angDiff(Math.atan2(dy, dx), face) > AIM_HALF) continue;
    best = e;
    bd = d;
  }
  if (!best) return face;
  const a = Math.atan2(best.y - p.y, best.x - p.x);
  p.fx = Math.cos(a);
  p.fy = Math.sin(a);
  return a;
}

function nearest(s: RunState, x: number, y: number, range: number, skipTag = 0): Enemy | null {
  let best: Enemy | null = null;
  let bd = range;
  for (const e of s.enemies) {
    if (e.dead || !e.awake || (skipTag && e.tag === skipTag)) continue;
    const d = Math.hypot(e.x - x, e.y - y) - e.r;
    if (d <= bd) {
      best = e;
      bd = d;
    }
  }
  return best;
}

function shoot(s: RunState, foe: boolean, look: Shot['look'], x: number, y: number, ang: number, speed: number, range: number, r: number, mul: number, pierce: number, hit: OnHit | null) {
  let sh = s.shots.find((o) => !o.on);
  if (!sh) {
    sh = { on: false, foe, look, x, y, vx: 0, vy: 0, r, left: 0, mul, hit, pierce, seen: [] };
    s.shots.push(sh);
  }
  sh.on = true;
  sh.foe = foe;
  sh.look = look;
  sh.x = x;
  sh.y = y;
  sh.vx = Math.cos(ang) * speed;
  sh.vy = Math.sin(ang) * speed;
  sh.r = r;
  sh.left = range;
  sh.mul = mul;
  sh.hit = hit;
  sh.pierce = pierce;
  sh.seen.length = 0;
}

/** 동작 조각 하나를 지금 실행한다. power = 스킬 레벨 배율 */
function runAct(s: RunState, act: Act, power: number) {
  const p = s.p;
  const ang = Math.atan2(p.fy, p.fx);
  switch (act.t) {
    case 'hit': {
      p.swing = 0.18;
      push(s, { e: 'fx', shape: act.shape, x: p.x, y: p.y, ang });
      for (const e of s.enemies) {
        // 잠든 요괴도 맞으면 깨어난다
        if (e.dead || Math.abs(e.x - p.x) > 450 || Math.abs(e.y - p.y) > 450) continue;
        if (inShape(act.shape, p.x, p.y, ang, e.x, e.y, e.r)) hitEnemy(s, e, act.mul * power, act, p.x, p.y);
      }
      break;
    }
    case 'shot': {
      p.swing = 0.14;
      for (let i = 0; i < act.n; i++) {
        const a = ang + (i - (act.n - 1) / 2) * act.spread;
        shoot(s, false, act.look, p.x + Math.cos(a) * 24, p.y + Math.sin(a) * 24, a, act.speed, act.range, act.radius, act.mul * power, act.pierce, act);
      }
      break;
    }
    case 'dash': {
      p.dashT = act.time;
      p.dash = { act, tag: ++s.tag, power };
      p.rvx = (p.fx * act.dist) / act.time;
      p.rvy = (p.fy * act.dist) / act.time;
      p.invuln = Math.max(p.invuln, act.time + 0.08);
      p.swing = act.time;
      break;
    }
    case 'zone': {
      let x = p.x + p.fx * act.ahead;
      let y = p.y + p.fy * act.ahead;
      if (act.aim) {
        const e = nearest(s, p.x, p.y, act.aim);
        if (e) {
          x = e.x;
          y = e.y;
        }
      }
      s.zones.push({ look: act.look, x, y, r: act.r, left: act.dur, total: act.dur, tick: act.tick, acc: act.tick, mul: act.mul * power, pull: act.pull ?? 0, hit: act });
      break;
    }
    case 'chain': {
      const tag = ++s.tag;
      const pts = [p.x, p.y];
      let e = nearest(s, p.x, p.y, act.range);
      let mul = act.mul * power;
      for (let i = 0; e && i < act.jumps; i++) {
        e.tag = tag;
        pts.push(e.x, e.y);
        const ex = e.x;
        const ey = e.y;
        hitEnemy(s, e, mul, act, p.x, p.y);
        mul *= act.falloff;
        e = nearest(s, ex, ey, act.jumpRange, tag);
      }
      push(s, { e: 'chain', pts });
      break;
    }
    case 'heal': {
      const hp = Math.min(s.stats.hp - p.hp, Math.round(s.stats.hp * (act.hp ?? 0)));
      const mp = Math.min(s.stats.mp - p.mp, Math.round(s.stats.mp * (act.mp ?? 0)));
      p.hp += hp;
      p.mp += mp;
      push(s, { e: 'heal', hp, mp });
      break;
    }
    case 'buff': {
      const b = p.buff;
      if (act.atk) (b.atk = act.atk), (b.atkT = act.dur);
      if (act.speed) (b.speed = act.speed), (b.speedT = act.dur);
      if (act.crit) (b.crit = act.crit), (b.critT = act.dur);
      if (act.guard) (b.guard = act.guard), (b.guardT = act.dur);
      push(s, { e: 'heal', hp: 0, mp: 0 });
      break;
    }
  }
}

/** 스킬(기본 공격 포함)을 쓴다 → 썼으면 true. 대기 시간은 부르는 쪽이 건다 */
function cast(s: RunState, def: SkillDef, basic: boolean): boolean {
  const p = s.p;
  let power = basic ? 1 : skillLevelMul(s.loadout.level);
  if (p.mp < def.mp) {
    // 기본 공격은 마력이 없어도 나가지만 약해진다 (부채)
    if (!basic) {
      push(s, { e: 'nope', why: 'mp' });
      return false;
    }
    power *= 0.6;
  } else if (def.acts.some((a) => a.t === 'chain') && !nearest(s, p.x, p.y, (def.acts.find((a) => a.t === 'chain') as Extract<Act, { t: 'chain' }>).range)) {
    push(s, { e: 'nope', why: 'target' });
    return false;
  } else {
    p.mp -= def.mp;
  }
  aim(s, basic || def === s.weapon.skills[0] || def === s.weapon.skills[1] ? s.weapon.aim : 300);
  push(s, { e: 'sound', name: def.sound });
  for (const act of def.acts) {
    if (act.at) s.queue.push({ at: s.t + act.at, act, power });
    else runAct(s, act, power);
  }
  return true;
}

// ---------- 대원이 맞는다 ----------

function hurtPlayer(s: RunState, raw: number) {
  const p = s.p;
  if (p.invuln > 0 || s.phase !== 'play') return;
  const n = Math.max(1, Math.round(raw * (p.buff.guardT > 0 ? p.buff.guard : 1) - s.stats.def));
  if (!s.god) p.hp -= n;
  p.invuln = HURT_INVULN;
  p.hurt = 0.25;
  push(s, { e: 'hurt', x: p.x, y: p.y - 30, n });
  if (p.hp <= 0) {
    p.hp = 0;
    s.phase = 'dead';
  }
}

function addWarn(s: RunState, w: Partial<Warn> & { shape: Warn['shape']; t: number; dmg: number; src: number }): Warn {
  const full: Warn = { x: 0, y: 0, ang: 0, r: 0, len: 0, w: 0, half: 0, delay: 0, total: w.t, after: 'none', big: false, ...w };
  s.warns.push(full);
  return full;
}

function stepWarns(s: RunState) {
  const p = s.p;
  for (let i = s.warns.length - 1; i >= 0; i--) {
    const w = s.warns[i];
    const src = w.src >= 0 ? s.enemies[w.src - 1] : null;
    // 낸 요괴가 쓰러지거나 기절하면 공격이 끊긴다
    if (src && (src.dead || src.stun > 0)) {
      s.warns.splice(i, 1);
      continue;
    }
    if (w.delay > 0) {
      w.delay -= STEP;
      if (w.delay <= 0) {
        w.x = p.x;
        w.y = p.y;
      }
      continue;
    }
    w.t -= STEP;
    if (w.t > 0) continue;
    s.warns.splice(i, 1);
    if (w.shape !== 'none') {
      const shape: Shape = w.shape === 'circle' ? { k: 'circle', r: w.r } : w.shape === 'arc' ? { k: 'arc', r: w.r, half: w.half } : { k: 'line', len: w.len, w: w.w };
      // 대원에게 너그럽게: 몸 가운데가 범위 안에 있어야 맞는다
      if (inShape(shape, w.x, w.y, w.ang, p.x, p.y, 0)) hurtPlayer(s, w.dmg);
      if (w.big) push(s, { e: 'boom', x: w.shape === 'line' ? w.x + (Math.cos(w.ang) * w.len) / 2 : w.x, y: w.shape === 'line' ? w.y + (Math.sin(w.ang) * w.len) / 2 : w.y, r: w.shape === 'line' ? w.w : w.r });
    }
    if (!src) continue;
    if (w.after === 'dash') move(s, src, Math.cos(w.ang) * (w.len - src.r), Math.sin(w.ang) * (w.len - src.r), src.r);
    else if (w.after === 'shoot') shoot(s, true, 'fire', src.x, src.y, Math.atan2(p.y - src.y, p.x - src.x), src.def.area, 620, 13, w.dmg, 0, null);
  }
}

// ---------- 요괴 ----------

function bossAct(s: RunState, e: Enemy, def: BossDef, dist: number, ang: number) {
  const p = s.p;
  // 체력이 내려가면 부하를 부른다
  if (e.calls < def.summonAt.length && e.hp / e.maxHp <= def.summonAt[e.calls]) {
    e.calls++;
    const kind = ENEMIES[def.summon.kind];
    for (let i = 0; i < def.summon.n; i++) {
      const [x, y] = spotAround(s, e.x, e.y, i, def.summon.n, kind.r);
      const m = newEnemy(s, kind, x + Math.cos(i * 2.1) * 90, y + Math.sin(i * 2.1) * 90, -1, { summoned: true });
      if (blocked(s, m.x, m.y, m.r)) (m.x = x), (m.y = y);
    }
    push(s, { e: 'sound', name: 'survBossWarn' });
  }
  if (e.cd > 0) {
    if (dist > 150) approach(s, e, Math.cos(ang), Math.sin(ang));
    return;
  }
  const moves: BossMove[] = s.mode === 'hard' ? [...def.moves, ...def.hardMoves] : def.moves;
  const m = moves[e.move++ % moves.length];
  const dmg = e.atk * m.mul;
  let busy = m.warn;
  if (m.t === 'slam') {
    const n = m.count ?? 1;
    for (let i = 0; i < n; i++) addWarn(s, { shape: 'circle', x: p.x, y: p.y, r: m.r, t: m.warn, delay: i * (m.gap ?? 0), dmg, src: e.id, big: true });
    busy += (n - 1) * (m.gap ?? 0);
  } else if (m.t === 'charge') {
    addWarn(s, { shape: 'line', x: e.x, y: e.y, ang, len: m.len, w: m.w, t: m.warn, dmg, src: e.id, after: 'dash', big: true });
  } else if (m.t === 'cone') {
    addWarn(s, { shape: 'arc', x: e.x, y: e.y, ang, r: m.r, half: m.half, t: m.warn, dmg, src: e.id, big: true });
  } else {
    addWarn(s, { shape: 'circle', x: e.x, y: e.y, r: m.r, t: m.warn, dmg, src: e.id, big: true });
  }
  push(s, { e: 'sound', name: 'survBossWarn' });
  e.busy = busy + 0.25;
  e.cd = def.gap;
}

/** 대원 쪽으로 (길을 찾아서) 간다 */
function approach(s: RunState, e: Enemy, ux: number, uy: number) {
  chaseDir(s, e, ux, uy);
  moveEnemy(s, e, chase.x, chase.y, 1);
}

function moveEnemy(s: RunState, e: Enemy, dx: number, dy: number, mul: number) {
  const v = e.speed * mul * (e.slowT > 0 ? e.slowMul : 1) * STEP;
  move(s, e, dx * v, dy * v, Math.min(e.r, TILE * 0.45));
  if (dx) e.left = dx < 0;
}

function stepEnemies(s: RunState) {
  const p = s.p;
  const list = s.enemies;
  updateFlow(s);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    if (!e.awake) {
      // 잠든 요괴: 대원이 가까이 오면 무리가 함께 깨어난다
      if (Math.abs(dy) < WAKE_DIST && dx * dx + dy * dy < WAKE_DIST * WAKE_DIST) {
        e.awake = true;
        wakeGroup(s, e.group);
      }
      continue;
    }
    if (e.flash > 0) e.flash -= STEP;
    if (e.slowT > 0) e.slowT -= STEP;
    if (e.dotT > 0) {
      e.dotT -= STEP;
      e.dotAcc += STEP;
      if (e.dotAcc >= 0.5) {
        e.dotAcc -= 0.5;
        const n = Math.max(1, Math.round(e.dotDps * 0.5));
        e.hp -= n;
        push(s, { e: 'dmg', x: e.x, y: e.y - e.r, n, crit: false });
        if (e.hp <= 0) {
          killEnemy(s, e);
          continue;
        }
      }
    }
    // 밀려남
    if (e.kx || e.ky) {
      move(s, e, e.kx * STEP, e.ky * STEP, Math.min(e.r, TILE * 0.45));
      e.kx *= 0.82;
      e.ky *= 0.82;
      if (Math.abs(e.kx) + Math.abs(e.ky) < 4) e.kx = e.ky = 0;
    }
    if (e.stun > 0) {
      e.stun -= STEP;
      continue;
    }
    if (e.cd > 0) e.cd -= STEP;
    if (e.busy > 0) {
      e.busy -= STEP;
      continue;
    }
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const ang = Math.atan2(dy, dx);
    e.left = dx < 0;
    if (e.bossDef) {
      bossAct(s, e, e.bossDef, dist, ang);
      continue;
    }
    const d = e.def;
    if (e.elite) {
      e.ringCd -= STEP;
      if (e.ringCd <= 0 && dist < ELITE.ringR) {
        e.ringCd = ELITE.ringEvery;
        addWarn(s, { shape: 'circle', x: e.x, y: e.y, r: ELITE.ringR, t: ELITE.ringWarn, dmg: e.atk * ELITE.ringMul, src: e.id, big: true });
        e.busy = ELITE.ringWarn + 0.2;
        continue;
      }
    }
    const reach = d.reach + (e.r - d.r);
    switch (d.ai) {
      case 'melee':
        if (dist <= reach) {
          if (e.cd <= 0) {
            addWarn(s, { shape: 'circle', x: e.x + ux * d.area * 0.5, y: e.y + uy * d.area * 0.5, r: d.area + (e.r - d.r), t: d.windup, dmg: e.atk, src: e.id });
            e.busy = d.windup + 0.1;
            e.cd = d.cd;
          }
        } else approach(s, e, ux, uy);
        break;
      case 'slam':
        if (dist <= reach) {
          if (e.cd <= 0) {
            addWarn(s, { shape: 'circle', x: p.x, y: p.y, r: d.area, t: d.windup, dmg: e.atk, src: e.id, big: true });
            e.busy = d.windup + 0.2;
            e.cd = d.cd;
          }
        } else approach(s, e, ux, uy);
        break;
      case 'dasher':
        if (dist <= reach && e.cd <= 0) {
          addWarn(s, { shape: 'line', x: e.x, y: e.y, ang, len: d.area, w: e.r * 2 + 12, t: d.windup, dmg: e.atk, src: e.id, after: 'dash', big: true });
          e.busy = d.windup + 0.25;
          e.cd = d.cd;
        } else if (dist > reach * 0.85) approach(s, e, ux, uy);
        // 가까우면 옆으로 돌며 틈을 본다
        else moveEnemy(s, e, -uy * (e.id % 2 ? 1 : -1), ux * (e.id % 2 ? 1 : -1), 0.6);
        break;
      case 'ranged':
        if (dist <= reach && e.cd <= 0) {
          addWarn(s, { shape: 'none', t: d.windup, dmg: e.atk, src: e.id, after: 'shoot' });
          e.busy = d.windup + 0.15;
          e.cd = d.cd;
        } else if (dist < reach * 0.5) moveEnemy(s, e, -ux, -uy, 0.8);
        else if (dist > reach * 0.85) approach(s, e, ux, uy);
        break;
    }
  }
  // 겹치지 않게 서로 밀어낸다 (깨어난 요괴끼리만)
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.dead || !a.awake) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.dead || !b.awake) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = (a.r + b.r) * 0.85;
      if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
      const d = Math.hypot(dx, dy);
      if (d >= min) continue;
      // 완전히 겹치면 번호로 방향을 정한다
      const nx = d > 0.01 ? dx / d : Math.cos(a.id + b.id);
      const ny = d > 0.01 ? dy / d : Math.sin(a.id + b.id);
      const k = (min - d) * 0.5;
      const wa = a.bossDef ? 0 : b.bossDef ? 2 : 1;
      const wb = b.bossDef ? 0 : a.bossDef ? 2 : 1;
      if (wa) move(s, a, -nx * k * wa, -ny * k * wa, Math.min(a.r, TILE * 0.45));
      if (wb) move(s, b, nx * k * wb, ny * k * wb, Math.min(b.r, TILE * 0.45));
    }
  }
}

// ---------- 날아가는 것 · 땅 범위 ----------

function stepShots(s: RunState) {
  const p = s.p;
  for (const sh of s.shots) {
    if (!sh.on) continue;
    const dx = sh.vx * STEP;
    const dy = sh.vy * STEP;
    sh.x += dx;
    sh.y += dy;
    sh.left -= Math.hypot(dx, dy);
    if (sh.left <= 0 || tileAt(s, sh.x, sh.y) === 1) {
      sh.on = false;
      continue;
    }
    if (sh.foe) {
      const d = Math.hypot(p.x - sh.x, p.y - sh.y);
      if (d <= sh.r + PLAYER_R * 0.7) {
        // 구르는 중(무적)에는 그냥 지나간다
        if (p.invuln <= 0) {
          hurtPlayer(s, sh.mul);
          sh.on = false;
        }
      }
      continue;
    }
    for (const e of s.enemies) {
      if (e.dead || sh.seen.includes(e.id)) continue;
      if (Math.abs(e.x - sh.x) > 200 || Math.abs(e.y - sh.y) > 200) continue;
      if (Math.hypot(e.x - sh.x, e.y - sh.y) > sh.r + e.r) continue;
      sh.seen.push(e.id);
      hitEnemy(s, e, sh.mul, sh.hit, sh.x - sh.vx, sh.y - sh.vy);
      if (sh.pierce-- <= 0) {
        sh.on = false;
        break;
      }
    }
  }
}

function stepZones(s: RunState) {
  for (let i = s.zones.length - 1; i >= 0; i--) {
    const z = s.zones[i];
    z.left -= STEP;
    z.acc += STEP;
    const tick = z.acc >= z.tick;
    if (tick) z.acc -= z.tick;
    if (tick || z.pull) {
      for (const e of s.enemies) {
        if (e.dead) continue;
        const dx = z.x - e.x;
        const dy = z.y - e.y;
        if (Math.abs(dx) > z.r + e.r || Math.abs(dy) > z.r + e.r) continue;
        const d = Math.hypot(dx, dy);
        if (d > z.r + e.r) continue;
        if (z.pull && !e.bossDef && d > 12) move(s, e, (dx / d) * z.pull * STEP, (dy / d) * z.pull * STEP, Math.min(e.r, TILE * 0.45));
        if (tick) hitEnemy(s, e, z.mul, z.hit, z.x, z.y);
      }
    }
    if (z.left <= 0) s.zones.splice(i, 1);
  }
}

// ---------- 한 간격 ----------

function stepPlayer(s: RunState, inp: Input) {
  const p = s.p;
  const b = p.buff;
  if (b.atkT > 0) b.atkT -= STEP;
  if (b.speedT > 0) b.speedT -= STEP;
  if (b.critT > 0) b.critT -= STEP;
  if (b.guardT > 0) b.guardT -= STEP;
  if (p.atkCd > 0) p.atkCd -= STEP;
  if (p.skillCd[0] > 0) p.skillCd[0] -= STEP;
  if (p.skillCd[1] > 0) p.skillCd[1] -= STEP;
  if (p.uniqueCd > 0) p.uniqueCd -= STEP;
  if (p.rollCd > 0) p.rollCd -= STEP;
  if (p.potionCd > 0) p.potionCd -= STEP;
  if (p.invuln > 0) p.invuln -= STEP;
  if (p.hurt > 0) p.hurt -= STEP;
  if (p.swing > 0) p.swing -= STEP;
  p.mp = Math.min(s.stats.mp, p.mp + s.stats.mp * MP_REGEN * STEP);

  let mx = inp.mx;
  let my = inp.my;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  p.moving = len > 0.15;

  // 물약 (구르는 중에도 먹을 수 있다)
  for (const k of [0, 1] as const) {
    if (!inp.potion[k] || p.potionCd > 0 || s.potions[k] <= 0) continue;
    const full = k === 0 ? p.hp >= s.stats.hp : p.mp >= s.stats.mp;
    if (full) continue;
    s.potions[k]--;
    s.potionsUsed++;
    p.potionCd = POTION_CD;
    runAct(s, k === 0 ? { t: 'heal', hp: POTION_HEAL.hp } : { t: 'heal', mp: POTION_HEAL.mp }, 1);
    push(s, { e: 'sound', name: 'tankHeal' });
  }

  // 돌진 스킬 중: 지나간 자리의 요괴를 벤다
  if (p.dashT > 0 && p.dash) {
    p.dashT -= STEP;
    move(s, p, p.rvx * STEP, p.rvy * STEP, PLAYER_R);
    const { act, tag, power } = p.dash;
    for (const e of s.enemies) {
      if (e.dead || e.tag === tag) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) > act.w / 2 + e.r) continue;
      e.tag = tag;
      hitEnemy(s, e, act.mul * power, act, p.x - p.fx * 40, p.y - p.fy * 40);
    }
    if (p.dashT <= 0) p.dash = null;
    return;
  }
  // 구르는 중
  if (p.rollT > 0) {
    p.rollT -= STEP;
    move(s, p, p.rvx * STEP, p.rvy * STEP, PLAYER_R);
    return;
  }
  if (inp.roll && p.rollCd <= 0) {
    const dx = p.moving ? mx / (len > 1 ? 1 : len) : p.fx;
    const dy = p.moving ? my / (len > 1 ? 1 : len) : p.fy;
    const v = ROLL.dist / ROLL.time;
    p.rollT = ROLL.time;
    p.rollCd = ROLL.cd;
    p.rvx = dx * v;
    p.rvy = dy * v;
    p.invuln = Math.max(p.invuln, ROLL.invuln);
    push(s, { e: 'sound', name: 'jump' });
    return;
  }

  if (p.moving) {
    const d = Math.hypot(mx, my);
    p.fx = mx / d;
    p.fy = my / d;
    const v = s.stats.speed * (b.speedT > 0 ? b.speed : 1) * (tileAt(s, p.x, p.y) === 2 ? SLOW_TILE_MUL : 1) * STEP;
    move(s, p, mx * v, my * v, PLAYER_R);
  }

  if (inp.unique && p.uniqueCd <= 0 && cast(s, s.hero.unique, false)) p.uniqueCd = s.hero.unique.cd;
  for (const k of [0, 1] as const) {
    if (inp.skill[k] && p.skillCd[k] <= 0 && cast(s, s.weapon.skills[k], false)) p.skillCd[k] = s.weapon.skills[k].cd;
  }
  if (inp.attack && p.atkCd <= 0 && p.dashT <= 0 && cast(s, s.weapon.basic, true)) p.atkCd = s.weapon.basic.cd;
}

export function step(s: RunState, inp: Input) {
  if (s.phase !== 'play') return;
  s.t += STEP;
  stepPlayer(s, inp);
  for (let i = s.queue.length - 1; i >= 0; i--) {
    if (s.queue[i].at > s.t) continue;
    const q = s.queue.splice(i, 1)[0];
    aim(s, s.weapon.aim);
    runAct(s, q.act, q.power);
  }
  stepShots(s);
  stepZones(s);
  stepEnemies(s);
  stepWarns(s);

  const p = s.p;
  if (!s.chest && Math.hypot(p.x - s.chestX, p.y - s.chestY) < 50) {
    s.chest = true;
    const coins = chestCoins(s.reward);
    s.coins += coins;
    push(s, { e: 'chest', coins });
  }
  if (s.phase === 'play' && s.exitOpen && Math.hypot(p.x - s.exitX, p.y - s.exitY) < 44) s.phase = 'clear';
}

/** 숨은 상자의 엽전 */
export const chestCoins = (reward: number) => Math.round(30 * reward);

/** 별 (PRD '맵 별 3개'): 1 = 시간 안에 · 2 = 한 번도 쓰러지지 않고 · 4 = 숨은 상자. deaths = 이 맵에서 이번 도전 동안 쓰러진 횟수 */
export const STAR_TIME = 1;
export const STAR_NO_DEATH = 2;
export const STAR_CHEST = 4;
export function starBits(cleared: boolean, time: number, par: number, deaths: number, chest: boolean): number {
  if (!cleared) return 0;
  return (time <= par ? STAR_TIME : 0) | (deaths === 0 ? STAR_NO_DEATH : 0) | (chest ? STAR_CHEST : 0);
}
export const starCount = (bits: number) => (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1);
