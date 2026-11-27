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
  CRIT_MUL,
  ENV,
  EXIT_KILL_RATIO,
  HURT_INVULN,
  MAP_W,
  MP_REGEN,
  NO_MP_MUL,
  PLAYER_R,
  POTION_CD,
  ROLL,
  SLOW_TILE_MUL,
  STEP,
  TILE,
  WAKE_DIST,
  damageOf,
  skillLevelMul,
} from '../data/balance';
import { BOSSES, type BossDef, type BossMove } from '../data/bosses';
import { FX, POTION, POTION_SIZES } from '../data/economy';
import { ELITE, ENEMIES, type EnemyDef, type EnemyKind } from '../data/enemies';
import { playerStats, type Loadout, type PlayerStats } from '../data/growth';
import { heroOf, type HeroDef } from '../data/heroes';
import { T_SLOW, T_WALL, bossIdOf, envOf, groupList, homeRegionOf, type MapDef } from '../data/maps';
import { mapScale, regionOf, type EnvId, type Mode } from '../data/regions';
import { towerScale } from '../data/tower';
import { WEAPONS, type SkillDef, type WeaponDef } from '../data/weapons';
import { bossDrop, copyCtx, eliteDrop, normalDrop, type Drop, type DropCtx } from './drops';

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
  /** 요괴의 꽃가루에 맞아 느려진 남은 시간 · 이동 배율 (8지형 가위 귀신) */
  slowT: number;
  slowMul: number;
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
  /** 보스: 지금 단계 (0 = 처음. 최종보스만 올라간다 — BossDef.phases) */
  phase: number;
  ringCd: number;
  /** 숨는 요괴(lurk): 지금 숨어 있는지 · 드러나 있는 남은 시간 */
  hidden: boolean;
  show: number;
  /** 불러낸 요괴(call)의 번호 (0 = 없음). 그 요괴가 쓰러지면 같이 사라진다 */
  owner: number;
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
  /** 요괴 것: 맞으면 느려진다 (이동 배율 · 시간) · 벽에 튕길 수 있는 남은 횟수 */
  slowMul: number;
  slowDur: number;
  bounce: number;
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
  /**
   * 터진 뒤: 요괴가 그 자리로 돌진 / 불을 쏜다 / 범위 가운데로 뛰어든다 / 맞은 대원을 끌어당긴다(aux = 거리) /
   * 독 웅덩이가 남는다(aux = 시간, aux2 = 피해) / 낸 요괴가 터져 사라진다 / 구슬을 사방으로 쏜다(aux = 수, aux2 = 속도) /
   * 줄을 따라 불길이 남는다(aux = 시간, aux2 = 피해, r = 불 반지름 — 'dash' 도 aux > 0 이면 불길을 남긴다) / 작은 요괴를 불러낸다
   */
  after: 'none' | 'dash' | 'shoot' | 'jump' | 'pull' | 'pool' | 'boom' | 'nova' | 'trail' | 'call';
  aux: number;
  aux2: number;
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
  /** 무언가 떨어졌다 (pick = 땅에 남는 것의 번호, -1 = 바로 주웠다) · 땅에 있던 것을 주웠다 */
  | { e: 'drop'; x: number; y: number; drop: Drop; pick: number }
  | { e: 'pick'; id: number; drop: Drop }
  | { e: 'exit' }
  /** 지형 환경: 골바람이 곧 분다 (dir -1 왼쪽 · 1 오른쪽) */
  | { e: 'env'; id: EnvId; dir: number }
  /** 보스가 다음 단계로 넘어갔다 (n = 몇 번째 단계인지 2 · 3) */
  | { e: 'phase'; n: number; text: string }
  | { e: 'nope'; why: 'mp' | 'target' };

export interface RunOpts {
  seed?: number;
  /** 들고 들어가는 물약 [체력, 마력] (크기를 나누지 않을 때: 모두 '소') */
  potions?: [number, number];
  /** 들고 들어가는 물약 [체력 소·중·대, 마력 소·중·대] (potions 대신) */
  stock?: number[][];
  /** 드랍 판정에 쓸 것 (없으면 아무것도 떨어지지 않는다). progress.ts 의 dropCtx */
  drops?: DropCtx;
  /** 개발용 무적 (?god=1) */
  god?: boolean;
  /** 끝없는 탑: 앞 층에서 이어 온 체력·마력 (없으면 가득) */
  carry?: { hp: number; mp: number };
}

/** 땅에 떨어진 것 (장비·강화석·열쇠). 가까이 가면 자동으로 줍는다 */
export interface Pickup {
  id: number;
  x: number;
  y: number;
  drop: Drop;
  got: boolean;
}
/** 요괴가 남긴 독 웅덩이: 서 있으면 0.5초마다 피해 */
export interface Pool {
  x: number;
  y: number;
  r: number;
  left: number;
  total: number;
  dmg: number;
  acc: number;
  /** 불길 (화면 색만 다르다) */
  fire?: boolean;
}
/** 독 웅덩이가 피해를 주는 간격 */
export const POOL_TICK = 0.5;
/** 자동으로 줍는 거리 */
export const PICK_DIST = 110;

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
  pools: Pool[];
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
  /** 남은 물약 [체력, 마력] (크기 합) · 크기별 남은 수 · 크기별 쓴 수 */
  potions: [number, number];
  stock: number[][];
  used: number[][];
  potionsUsed: number;
  /** 드랍 판정 상태 (없으면 드랍 없음) · 이 판에서 떨어진 것 전부 · 땅에 남은 것 */
  drops: DropCtx | null;
  loot: Drop[];
  picks: Pickup[];
  god: boolean;
  /**
   * 지형 환경 효과 (balance.ts 의 ENV). f = 받는 정도: 1 그대로 · 수호 방어구 0.5 · 막는 대원 0.
   * gust = 지금 부는 골바람 방향 (-1 왼쪽 · 1 오른쪽 · 0 없음), warn = 곧 불 방향 (예고 중일 때만),
   * acc = 늪에 서 있던 시간(독) · 불에 탄 시간(불길) · 졸음(0~1, 졸음 꽃가루), k = 마지막으로 쏟아진 화살 차례 · 남은 화상 횟수(불길),
   * still = 가만히 서 있던 시간(졸음 꽃가루), vx·vy = 미끄러지는 속도(미끄러운 마루, 한 간격에 가는 거리), blind = 지금 눈부신지(새벽빛)
   */
  env: { id: EnvId; f: number; gust: number; warn: number; acc: number; k: number; still: number; vx: number; vy: number; blind: boolean };
  /** 요괴 공격 배율 (환경 피해에 쓴다) */
  foeAtk: number;
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

/** 이 판의 요괴 배율: 맵은 권장 레벨, 끝없는 탑은 층 */
export const scaleOf = (map: MapDef, mode: Mode) => (map.tower ? towerScale(map.tower) : mapScale(map.region, map.no, mode));

function newEnemy(s: RunState, def: EnemyDef, x: number, y: number, group: number, o: { elite?: boolean; summoned?: boolean; boss?: BossDef; mini?: { hp: number; size: number; atk?: number }; owner?: number } = {}): Enemy {
  const sc = scaleOf(s.map, s.mode);
  const b = o.boss;
  const hp = Math.max(1, Math.round((b ? b.hp : def.hp * (o.elite ? ELITE.hp : 1) * (o.mini?.hp ?? 1)) * sc.hp));
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
    r: b ? b.r : def.r * (o.elite ? ELITE.size : 1) * (o.mini?.size ?? 1),
    hp,
    maxHp: hp,
    atk: (b ? b.atk : def.atk * (o.elite ? ELITE.atk : 1) * (o.mini?.atk ?? 1)) * sc.atk,
    armor: sc.def * (b ? 1 : 0.5),
    speed: b ? b.speed : def.speed,
    exp: o.summoned ? 0 : Math.round((b ? b.exp : def.exp * (o.elite ? ELITE.reward : 1)) * sc.exp),
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
    phase: 0,
    ringCd: ELITE.ringEvery * 0.6,
    hidden: !b && def.ai === 'lurk',
    show: 0,
    owner: o.owner ?? 0,
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
  const sc = scaleOf(map, mode);
  const stats = playerStats(loadout, homeRegionOf(map));
  const region = regionOf(map.region);
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
      hp: opts.carry ? Math.max(1, Math.min(stats.hp, opts.carry.hp)) : stats.hp,
      mp: opts.carry ? Math.max(0, Math.min(stats.mp, opts.carry.mp)) : stats.mp,
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
      slowT: 0,
      slowMul: 1,
    },
    enemies: [],
    shots: [],
    zones: [],
    warns: [],
    pools: [],
    queue: [],
    events: [],
    total: 0,
    killed: 0,
    kills: {},
    eliteKills: 0,
    boss: null,
    bossDead: false,
    exitOpen: false,
    // 끝없는 탑에는 숨은 상자가 없다 (이미 연 것으로 둔다)
    chest: !!map.tower,
    exp: 0,
    coins: 0,
    potions: [0, 0],
    stock: opts.stock ? opts.stock.map((r) => [...r]) : [0, 1].map((k) => [opts.potions?.[k] ?? 0, 0, 0]),
    used: [0, 1].map(() => Array<number>(POTION_SIZES).fill(0)),
    potionsUsed: 0,
    drops: opts.drops ? copyCtx(opts.drops) : null,
    loot: [],
    picks: [],
    god: !!opts.god,
    env: { id: envOf(map), f: loadout.hero === region.counter ? 0 : loadout.fx?.includes('ward') ? FX.ward.env : 1, gust: 0, warn: 0, acc: 0, k: 0, still: 0, vx: 0, vy: 0, blind: false },
    foeAtk: sc.atk,
    tag: 1,
    nextId: 1,
    reward: sc.reward,
    exitX: center(map.exit[0]),
    exitY: center(map.exit[1]),
    chestX: center(map.chest[0]),
    chestY: center(map.chest[1]),
  };
  s.potions = [sum(s.stock[0]), sum(s.stock[1])];
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
    const def = BOSSES[bossIdOf(map)];
    s.boss = newEnemy(s, ENEMIES[def.summon.kind], center(map.boss[0]), center(map.boss[1]), -1, { boss: def });
    s.boss.cd = 1.5;
  }
  return s;
}

// ---------- 대원의 공격 ----------

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const hasFx = (s: RunState, id: keyof typeof FX) => !!s.loadout.fx?.includes(id);
/** 스킬에 드는 마력 (레어 '마력 절약') */
export const mpCost = (s: RunState, def: SkillDef, basic = false) => (basic || !hasFx(s, 'thrift') ? def.mp : Math.round(def.mp * FX.thrift.mul));

/** 요괴가 쓰러진 자리에 떨어뜨린다. 물약은 바로 줍고(자동), 나머지는 땅에 남아 가까이 가면 줍는다 */
function dropAt(s: RunState, e: Enemy, drops: Drop[]) {
  drops.forEach((drop, i) => {
    s.loot.push(drop);
    if (drop.t === 'potion') return push(s, { e: 'drop', x: e.x, y: e.y, drop, pick: -1 });
    const a = (i / Math.max(1, drops.length)) * Math.PI * 2 + e.id;
    const far = drops.length > 1 ? 34 : 0;
    const pk: Pickup = { id: s.nextId++, x: e.x + Math.cos(a) * far, y: e.y + Math.sin(a) * far, drop, got: false };
    s.picks.push(pk);
    push(s, { e: 'drop', x: pk.x, y: pk.y, drop, pick: pk.id });
  });
}

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
  // 불러내는 요괴가 쓰러지면 불러낸 것도 사라진다
  if (e.def.call && !e.bossDef) for (const o of s.enemies) if (o.owner === e.id && !o.dead) killEnemy(s, o);
  // 분열: 작은 것 여럿으로 갈라진다 (작은 것은 다시 갈라지지 않고, 처치 수·보상에 넣지 않는다)
  const split = e.bossDef ? undefined : e.def.split;
  if (split) {
    for (let i = 0; i < split.n; i++) {
      const a = (i / split.n) * Math.PI * 2 + e.id;
      const m = newEnemy(s, e.def, e.x, e.y, -1, { summoned: true, mini: { hp: split.hp * (e.elite ? 2 : 1), size: split.size * (e.elite ? ELITE.size : 1) } });
      move(s, m, Math.cos(a) * 34, Math.sin(a) * 34, Math.min(m.r, TILE * 0.45));
      m.kx = Math.cos(a) * 260;
      m.ky = Math.sin(a) * 260;
      m.cd = 0.9;
    }
  }
  s.exp += e.exp;
  s.coins += e.coin;
  if (e.bossDef) {
    s.bossDead = true;
    if (s.drops) dropAt(s, e, bossDrop(s.drops));
    // 보스가 쓰러지면 부하와 남은 예고도 사라진다
    for (const o of s.enemies) if (o.summoned && !o.dead) killEnemy(s, o);
    s.warns.length = 0;
    s.pools.length = 0; // 남은 독 웅덩이·불길도 치운다 (보스를 잡고 출구로 가다 쓰러지지 않게)
    for (const sh of s.shots) if (sh.foe) sh.on = false;
  } else {
    s.killed++;
    if (e.elite) {
      s.eliteKills++;
      if (s.drops) dropAt(s, e, eliteDrop(s.drops, s.eliteKills));
    } else {
      s.kills[e.kind] = (s.kills[e.kind] ?? 0) + 1;
      if (s.drops) dropAt(s, e, normalDrop(s.drops, s.killed - s.eliteKills));
    }
  }
  const open = s.map.boss ? s.bossDead : s.killed >= Math.ceil(s.total * EXIT_KILL_RATIO);
  if (open && !s.exitOpen) {
    s.exitOpen = true;
    push(s, { e: 'exit' });
  }
}

/** 요괴에게 피해를 준다 (치명타는 여기서 굴린다) */
function hitEnemy(s: RunState, e: Enemy, mul: number, on: OnHit | null, fromX: number, fromY: number, again = false) {
  if (e.dead) return;
  const crit = rand(s) < critNow(s);
  let n = damageOf(atkNow(s), mul, e.armor, crit);
  // 레어 무기 효과 (economy.ts 의 FX)
  const fx = s.loadout.fx;
  if (fx?.length) {
    if (crit && hasFx(s, 'keen')) n = Math.round((n * FX.keen.mul) / CRIT_MUL);
    if (hasFx(s, 'leech')) s.p.hp = Math.min(s.stats.hp, s.p.hp + n * FX.leech.rate);
    if (hasFx(s, 'burn')) {
      e.dotT = Math.max(e.dotT, FX.burn.dur);
      e.dotDps = Math.max(e.dotDps, atkNow(s) * FX.burn.mul);
    }
    if (hasFx(s, 'ice')) {
      const ice = e.bossDef ? Math.max(0.8, FX.ice.mul) : FX.ice.mul;
      e.slowMul = e.slowT > 0 ? Math.min(e.slowMul, ice) : ice;
      e.slowT = Math.max(e.slowT, FX.ice.dur);
    }
  }
  e.hp -= n;
  e.flash = 0.12;
  // 숨은 요괴는 맞으면 잠깐 드러난다
  if (e.def.ai === 'lurk' && !e.bossDef) (e.show = Math.max(e.show, 1.5)), (e.hidden = false);
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
  else if (!again && hasFx(s, 'twin') && rand(s) < FX.twin.chance) hitEnemy(s, e, mul * FX.twin.mul, null, fromX, fromY, true);
}

/** 조준: 바라보는 쪽 ±AIM_HALF, range 안의 가장 가까운 요괴를 향해 돌아선다 → 각도 */
function aim(s: RunState, range: number): number {
  const p = s.p;
  const face = Math.atan2(p.fy, p.fx);
  let best: Enemy | null = null;
  let bd = Infinity;
  // 달그림자(4지형): 보이는 거리 밖의 요괴는 조준하지 못한다. 숨은 요괴도 마찬가지
  const sight = sightOf(s);
  for (const e of s.enemies) {
    if (e.dead || !e.awake || e.hidden) continue;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy) - e.r;
    if (d > range || d >= bd || d > sight) continue;
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
    if (e.dead || !e.awake || e.hidden || (skipTag && e.tag === skipTag)) continue;
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
    sh = { on: false, foe, look, x, y, vx: 0, vy: 0, r, left: 0, mul, hit, pierce, seen: [], slowMul: 1, slowDur: 0, bounce: 0 };
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
  sh.slowMul = 1;
  sh.slowDur = 0;
  sh.bounce = 0;
  return sh;
}

/** 동작 조각 하나를 지금 실행한다. power = 스킬 레벨 배율 */
function runAct(s: RunState, act: Act, power: number) {
  const p = s.p;
  const ang = Math.atan2(p.fy, p.fx);
  switch (act.t) {
    case 'hit': {
      let hits = 0;
      for (const e of s.enemies) {
        // 잠든 요괴도 맞으면 깨어난다
        if (e.dead || Math.abs(e.x - p.x) > 450 || Math.abs(e.y - p.y) > 450) continue;
        if (!inShape(act.shape, p.x, p.y, ang, e.x, e.y, e.r)) continue;
        hits++;
        hitEnemy(s, e, act.mul * power, act, p.x, p.y);
      }
      if (hits || !act.quiet) {
        p.swing = 0.18;
        push(s, { e: 'fx', shape: act.shape, x: p.x, y: p.y, ang });
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
  const mp = mpCost(s, def, basic);
  if (p.mp < mp) {
    // 기본 공격은 마력이 없어도 나가지만 약해진다 (부채)
    if (!basic) {
      push(s, { e: 'nope', why: 'mp' });
      return false;
    }
    power *= NO_MP_MUL;
  } else if (def.acts.some((a) => a.t === 'chain') && !nearest(s, p.x, p.y, (def.acts.find((a) => a.t === 'chain') as Extract<Act, { t: 'chain' }>).range)) {
    push(s, { e: 'nope', why: 'target' });
    return false;
  } else {
    p.mp -= mp;
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
  const n = Math.max(1, Math.round(raw * (p.buff.guardT > 0 ? p.buff.guard : 1) * (hasFx(s, 'ward') ? FX.ward.mul : 1) - s.stats.def));
  if (!s.god) p.hp -= n;
  p.invuln = HURT_INVULN;
  p.hurt = 0.25;
  push(s, { e: 'hurt', x: p.x, y: p.y - 30, n });
  if (p.hp <= 0) {
    p.hp = 0;
    s.phase = 'dead';
  }
}

/** 번호로 요괴 찾기 (번호는 떨어진 것과 같이 쓰므로 자리와 다를 수 있다) */
function enemyById(s: RunState, id: number): Enemy | null {
  const e = s.enemies[id - 1];
  if (e && e.id === id) return e;
  return s.enemies.find((o) => o.id === id) ?? null;
}

function addWarn(s: RunState, w: Partial<Warn> & { shape: Warn['shape']; t: number; dmg: number; src: number }): Warn {
  const full: Warn = { x: 0, y: 0, ang: 0, r: 0, len: 0, w: 0, half: 0, delay: 0, total: w.t, after: 'none', aux: 0, aux2: 0, big: false, ...w };
  s.warns.push(full);
  return full;
}

function stepWarns(s: RunState) {
  const p = s.p;
  for (let i = s.warns.length - 1; i >= 0; i--) {
    const w = s.warns[i];
    const src = w.src >= 0 ? enemyById(s, w.src) : null;
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
      const hit = inShape(shape, w.x, w.y, w.ang, p.x, p.y, 0);
      const open = p.invuln <= 0;
      if (hit && w.dmg > 0) hurtPlayer(s, w.dmg);
      // 끌어당기기: 맞았으면(구르는 중이 아니면) 낸 요괴 앞으로 끌려간다
      if (hit && open && w.after === 'pull' && src && s.phase === 'play') {
        const dx = src.x - p.x;
        const dy = src.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const go = Math.max(0, Math.min(w.aux, d - src.r - PLAYER_R - 12));
        move(s, p, (dx / d) * go, (dy / d) * go, PLAYER_R);
      }
      if (w.big) push(s, { e: 'boom', x: w.shape === 'line' ? w.x + (Math.cos(w.ang) * w.len) / 2 : w.x, y: w.shape === 'line' ? w.y + (Math.sin(w.ang) * w.len) / 2 : w.y, r: w.shape === 'line' ? w.w : w.r });
    }
    if (w.after === 'pool') s.pools.push({ x: w.x, y: w.y, r: w.r, left: w.aux, total: w.aux, dmg: w.aux2, acc: 0 });
    // 불길: 줄을 따라 불이 남는다 (화차의 돌진 · 강철이의 불숨)
    if (w.shape === 'line' && w.aux > 0 && (w.after === 'trail' || w.after === 'dash')) {
      const gap = w.r * 1.5;
      for (let d = w.r; d <= w.len - w.r * 0.5; d += gap) {
        const x = w.x + Math.cos(w.ang) * d;
        const y = w.y + Math.sin(w.ang) * d;
        if (tileAt(s, x, y) !== 1) s.pools.push({ x, y, r: w.r, left: w.aux, total: w.aux, dmg: w.aux2, acc: 0, fire: true });
      }
    }
    if (!src) continue;
    if (w.after === 'boom') {
      // 자폭: 터지면 사라진다 (정예는 남는다)
      if (!src.elite && !src.bossDef) killEnemy(s, src);
    } else if (w.after === 'nova') {
      for (let k = 0; k < w.aux; k++) shoot(s, true, 'fire', src.x, src.y, w.ang + (k / w.aux) * Math.PI * 2, w.aux2, 560, 14, w.dmg * 0.8, 0, null);
    } else if (w.after === 'dash') move(s, src, Math.cos(w.ang) * (w.len - src.r), Math.sin(w.ang) * (w.len - src.r), src.r);
    else if (w.after === 'jump') move(s, src, w.x - src.x, w.y - src.y, Math.min(src.r, TILE * 0.45));
    else if (w.after === 'shoot') {
      const d = src.def;
      const sh = shoot(s, true, 'fire', src.x, src.y, Math.atan2(p.y - src.y, p.x - src.x), d.area || 300, d.bounce ? 1300 : 620, 13, w.dmg, 0, null);
      if (d.slow) (sh.slowMul = d.slow.mul), (sh.slowDur = d.slow.dur);
      sh.bounce = d.bounce ?? 0;
    } else if (w.after === 'call' && src.def.call) {
      // 불러내기: 제 둘레에 작은 요괴 (처치 수·보상에 넣지 않는다)
      const c = src.def.call;
      const kind = ENEMIES[c.kind];
      for (let k = 0; k < c.n; k++) {
        const a = src.id + k * 2.4 + s.t;
        const m = newEnemy(s, kind, src.x, src.y, -1, { summoned: true, mini: { hp: c.hp, size: c.size, atk: c.atk }, owner: src.id });
        move(s, m, Math.cos(a) * 50, Math.sin(a) * 50, Math.min(m.r, TILE * 0.45));
        m.cd = 0.8;
      }
      push(s, { e: 'sound', name: 'survBossWarn' });
    }
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
  // 다음 단계 (최종보스): 공격 목록이 바뀌고 빨라진다. 넘어갈 때 제 둘레를 한 번 치고 숨을 고른다
  const next = def.phases?.[e.phase];
  if (next && e.hp / e.maxHp <= next.at) {
    e.phase++;
    e.move = 0;
    e.speed = next.speed;
    addWarn(s, { shape: 'circle', x: e.x, y: e.y, r: 250, t: 1.2, dmg: e.atk, src: e.id, big: true });
    push(s, { e: 'phase', n: e.phase + 1, text: next.say });
    push(s, { e: 'sound', name: 'survBossWarn' });
    e.busy = 1.45;
    e.cd = 0.6;
    return;
  }
  if (e.cd > 0) {
    if (dist > 150) approach(s, e, Math.cos(ang), Math.sin(ang));
    return;
  }
  const ph = e.phase > 0 ? def.phases?.[e.phase - 1] : undefined;
  const base = ph ? ph.moves : def.moves;
  const moves: BossMove[] = s.mode === 'hard' ? [...base, ...def.hardMoves] : base;
  const m = moves[e.move++ % moves.length];
  const dmg = e.atk * m.mul;
  let busy = m.warn;
  if (m.t === 'slam') {
    const n = m.count ?? 1;
    for (let i = 0; i < n; i++) addWarn(s, { shape: 'circle', x: p.x, y: p.y, r: m.r, t: m.warn, delay: i * (m.gap ?? 0), dmg, src: e.id, big: true });
    busy += (n - 1) * (m.gap ?? 0);
  } else if (m.t === 'charge') {
    addWarn(s, { shape: 'line', x: e.x, y: e.y, ang, len: m.len, w: m.w, t: m.warn, dmg, src: e.id, after: 'dash', big: true });
  } else if (m.t === 'barrage') {
    // 대원 자리에 하나, 나머지는 그 둘레에 흩어서 — 조금씩 늦게 터진다
    for (let i = 0; i < m.n; i++) {
      const a = rand(s) * Math.PI * 2;
      const d = i === 0 ? 0 : m.spread * (0.35 + 0.65 * rand(s));
      const t = m.warn + i * (m.gap ?? 0);
      addWarn(s, { shape: 'circle', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: m.r, t, dmg, src: e.id, big: true, ...(m.pool ? { after: 'pool' as const, aux: m.pool.dur, aux2: e.atk * m.pool.mul } : {}) });
    }
    busy += (m.n - 1) * (m.gap ?? 0);
  } else if (m.t === 'leap') {
    const n = m.count ?? 1;
    for (let i = 0; i < n; i++) addWarn(s, { shape: 'circle', x: p.x, y: p.y, r: m.r, t: m.warn, delay: i * (m.gap ?? 0), dmg, src: e.id, after: 'jump', big: true });
    busy += (n - 1) * (m.gap ?? 0);
  } else if (m.t === 'rake') {
    // 나란한 줄: 가운데 줄이 대원을 지난다 (짝수면 대원이 줄 사이에 선다)
    const px = -Math.sin(ang);
    const py = Math.cos(ang);
    for (let i = 0; i < m.n; i++) {
      const off = (i - (m.n - 1) / 2) * m.space;
      addWarn(s, { shape: 'line', x: e.x + px * off - Math.cos(ang) * 60, y: e.y + py * off - Math.sin(ang) * 60, ang, len: m.len, w: m.w, t: m.warn, dmg, src: e.id, big: true });
    }
  } else if (m.t === 'nova') {
    addWarn(s, { shape: 'circle', x: e.x, y: e.y, r: m.r, t: m.warn, ang: ang + (m.turn ?? 0), dmg, src: e.id, after: 'nova', aux: m.n, aux2: m.speed, big: true });
  } else if (m.t === 'march') {
    for (let i = 0; i < m.n; i++) {
      const d = e.r + m.r * 0.6 + i * m.step;
      addWarn(s, { shape: 'circle', x: e.x + Math.cos(ang) * d, y: e.y + Math.sin(ang) * d, r: m.r, t: m.warn + i * m.gap, dmg, src: e.id, big: true });
    }
    busy += (m.n - 1) * m.gap;
  } else if (m.t === 'spiral') {
    // 제 둘레를 친 뒤 구슬을 돌려 가며 쏜다 (arms 갈래, gap 초마다 turn 만큼 돈다)
    addWarn(s, { shape: 'circle', x: e.x, y: e.y, r: m.r, t: m.warn, dmg, src: e.id, big: true });
    for (let i = 0; i < m.n; i++) addWarn(s, { shape: 'none', t: m.warn + i * m.gap, ang: ang + i * m.turn, dmg, src: e.id, after: 'nova', aux: m.arms, aux2: m.speed });
    busy += (m.n - 1) * m.gap;
  } else if (m.t === 'wave') {
    // 물결: 대원 쪽으로 가로지르는 줄이 차례로 밀려 나간다 (줄 사이에 서거나 굴러서 넘는다)
    const px = -Math.sin(ang);
    const py = Math.cos(ang);
    for (let i = 0; i < m.n; i++) {
      const d = e.r + 50 + i * m.step;
      addWarn(s, { shape: 'line', x: e.x + Math.cos(ang) * d - (px * m.len) / 2, y: e.y + Math.sin(ang) * d - (py * m.len) / 2, ang: ang + Math.PI / 2, len: m.len, w: m.w, t: m.warn + i * m.gap, dmg, src: e.id, big: true });
    }
    busy += (m.n - 1) * m.gap;
  } else if (m.t === 'sweep') {
    // 낫 돌려 베기: 둘레를 n 조각으로 나눠 대원 쪽부터 차례로 벤다
    for (let i = 0; i < m.n; i++) {
      addWarn(s, { shape: 'arc', x: e.x, y: e.y, ang: ang + (m.dir ?? 1) * i * ((Math.PI * 2) / m.n), r: m.r, half: Math.PI / m.n, t: m.warn + i * m.gap, dmg, src: e.id, big: true });
    }
    busy += (m.n - 1) * m.gap;
  } else if (m.t === 'scorch') {
    // 불숨: 대원 쪽으로 n 줄기 (spread 만큼 벌려서), 지나간 자리에 불길이 남는다
    const n = m.n ?? 1;
    for (let i = 0; i < n; i++) {
      const a = ang + (i - (n - 1) / 2) * (m.spread ?? 0);
      addWarn(s, { shape: 'line', x: e.x, y: e.y, ang: a, len: m.len, w: m.w, r: m.w / 2, t: m.warn, dmg, src: e.id, after: 'trail', aux: m.pool.dur, aux2: e.atk * m.pool.mul, big: true });
    }
  } else if (m.t === 'cage') {
    // 심판: 대원 둘레를 원으로 에워싸고, 조금 뒤 가운데를 친다 (가운데서 기다렸다가 밖으로 구른다)
    for (let i = 0; i < m.n; i++) {
      const a = ang + (i / m.n) * Math.PI * 2;
      addWarn(s, { shape: 'circle', x: p.x + Math.cos(a) * m.d, y: p.y + Math.sin(a) * m.d, r: m.r, t: m.warn, dmg, src: e.id, big: true });
    }
    addWarn(s, { shape: 'circle', x: p.x, y: p.y, r: m.d - m.r * 0.5, t: m.warn + m.gap, dmg, src: e.id, big: true });
    busy += m.gap;
  } else if (m.t === 'clock') {
    // 열두 시: 둘레의 직선이 대원 쪽부터 차례로 친다 (도는 쪽을 따라 돌거나 굴러서 넘는다)
    for (let i = 0; i < m.n; i++) {
      addWarn(s, { shape: 'line', x: e.x, y: e.y, ang: ang + (m.dir ?? 1) * i * ((Math.PI * 2) / m.n), len: m.len, w: m.w, t: m.warn + i * m.gap, dmg, src: e.id, big: true });
    }
    busy += (m.n - 1) * m.gap;
  } else if (m.t === 'checker') {
    // 무너지는 봉인: 대원 둘레 바둑판의 한 색 칸이 먼저, 조금 뒤 나머지 칸이 터진다 (대원이 선 칸은 나중 색이다)
    for (let j = -m.span; j <= m.span; j++) {
      for (let i = -m.span; i <= m.span; i++) {
        const late = (i + j) % 2 === 0;
        addWarn(s, { shape: 'circle', x: p.x + i * m.cell, y: p.y + j * m.cell, r: m.r, t: m.warn + (late ? m.gap : 0), dmg, src: e.id, big: true });
      }
    }
    busy += m.gap;
  } else if (m.t === 'cross') {
    for (let i = 0; i < m.n; i++) addWarn(s, { shape: 'line', x: e.x, y: e.y, ang: ang + (m.turn ?? 0) + (i / m.n) * Math.PI * 2, len: m.len, w: m.w, t: m.warn, dmg, src: e.id, big: true });
  } else if (m.t === 'cone') {
    addWarn(s, { shape: 'arc', x: e.x, y: e.y, ang, r: m.r, half: m.half, t: m.warn, dmg, src: e.id, big: true });
  } else {
    addWarn(s, { shape: 'circle', x: e.x, y: e.y, r: m.r, t: m.warn, dmg, src: e.id, big: true });
  }
  push(s, { e: 'sound', name: 'survBossWarn' });
  e.busy = busy + 0.25;
  e.cd = ph ? ph.gap : def.gap;
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
      case 'leap':
        if (dist <= reach && dist > 70 && e.cd <= 0) {
          // 대원이 서 있는 자리로 뛰어든다 (예고가 끝나면 그 자리에 떨어진다)
          addWarn(s, { shape: 'circle', x: p.x, y: p.y, r: d.area + (e.r - d.r), t: d.windup, dmg: e.atk, src: e.id, after: 'jump', big: true });
          e.busy = d.windup + 0.3;
          e.cd = d.cd;
        } else if (dist > reach * 0.8) approach(s, e, ux, uy);
        // 틈을 보며 둘레를 돈다 (너무 붙으면 물러난다)
        else if (dist < 110) moveEnemy(s, e, -ux, -uy, 0.7);
        else moveEnemy(s, e, -uy * (e.id % 2 ? 1 : -1), ux * (e.id % 2 ? 1 : -1), 0.7);
        break;
      case 'lurk':
        // 숨어서 다가온다. 바로 옆에 오면 나타나서 치고, 한동안 드러나 있다가 다시 숨는다
        if (e.show > 0) e.show -= STEP;
        if (dist <= reach) {
          e.hidden = false;
          e.show = Math.max(e.show, 0.6);
          if (e.cd <= 0) {
            addWarn(s, { shape: 'circle', x: e.x + ux * d.area * 0.5, y: e.y + uy * d.area * 0.5, r: d.area + (e.r - d.r), t: d.windup, dmg: e.atk, src: e.id });
            e.busy = d.windup + 0.1;
            e.cd = d.cd;
            e.show = d.cd * 0.8;
          }
        } else {
          e.hidden = e.show <= 0;
          approach(s, e, ux, uy);
        }
        break;
      case 'pull':
        if (dist <= reach && e.cd <= 0 && clearLine(s, e.x, e.y, 10)) {
          addWarn(s, { shape: 'line', x: e.x, y: e.y, ang, len: d.area, w: 64, t: d.windup, dmg: e.atk * 0.7, src: e.id, after: 'pull', aux: d.pull ?? 200, big: true });
          e.busy = d.windup + 0.3;
          e.cd = d.cd;
        } else if (dist > reach * 0.8) approach(s, e, ux, uy);
        else if (dist <= 80 + (e.r - d.r) && e.cd <= d.cd - 1.2) {
          // 끌려온 대원을 문다
          addWarn(s, { shape: 'circle', x: e.x + ux * 40, y: e.y + uy * 40, r: 70 + (e.r - d.r), t: 0.5, dmg: e.atk, src: e.id });
          e.busy = 0.6;
          e.cd = Math.max(e.cd, 1.4);
        }
        break;
      case 'spit':
        if (dist <= reach && e.cd <= 0) {
          addWarn(s, { shape: 'circle', x: p.x, y: p.y, r: d.area, t: d.windup, dmg: e.atk, src: e.id, after: 'pool', aux: d.pool?.dur ?? 3, aux2: e.atk * (d.pool?.mul ?? 0.4), big: true });
          e.busy = d.windup + 0.2;
          e.cd = d.cd;
        } else if (dist < reach * 0.45) moveEnemy(s, e, -ux, -uy, 0.8);
        else if (dist > reach * 0.85) approach(s, e, ux, uy);
        break;
      case 'bomb':
        if (dist <= reach) {
          if (e.cd <= 0) {
            addWarn(s, { shape: 'circle', x: e.x, y: e.y, r: d.area + (e.r - d.r), t: d.windup, dmg: e.atk, src: e.id, after: 'boom', big: true });
            e.busy = d.windup + 0.2;
            e.cd = d.cd;
          }
        } else approach(s, e, ux, uy);
        break;
      case 'rage': {
        // 체력이 내려가면 날뛴다: 빨라지고, 자주 치고, 세게 친다
        const g = d.rage;
        const mad = !!g && e.hp <= e.maxHp * g.at;
        if (dist <= reach) {
          if (e.cd <= 0) {
            addWarn(s, { shape: 'circle', x: e.x + ux * d.area * 0.5, y: e.y + uy * d.area * 0.5, r: d.area + (e.r - d.r), t: d.windup, dmg: e.atk * (mad ? g.atk : 1), src: e.id });
            e.busy = d.windup + 0.1;
            e.cd = d.cd * (mad ? g.cd : 1);
          }
        } else {
          chaseDir(s, e, ux, uy);
          moveEnemy(s, e, chase.x, chase.y, mad ? g.speed : 1);
        }
        break;
      }
      case 'call': {
        // 거리를 두고 작은 요괴를 불러낸다 (한꺼번에 max 마리까지, 모두 times 번). 더 못 부르면 한기를 쏜다
        const c = d.call;
        if (dist <= reach && e.cd <= 0) {
          let mine = 0;
          for (const o of list) if (o.owner === e.id && !o.dead) mine++;
          if (c && mine + c.n <= c.max && e.calls < c.times) {
            e.calls++;
            addWarn(s, { shape: 'circle', x: e.x, y: e.y, r: 70, t: d.windup, dmg: 0, src: e.id, after: 'call' });
            e.busy = d.windup + 0.2;
            e.cd = d.cd;
          } else {
            addWarn(s, { shape: 'none', t: 0.5, dmg: e.atk, src: e.id, after: 'shoot' });
            e.busy = 0.65;
            e.cd = d.cd * 0.45;
          }
        } else if (dist < reach * 0.5) moveEnemy(s, e, -ux, -uy, 0.8);
        else if (dist > reach * 0.85) approach(s, e, ux, uy);
        break;
      }
      case 'blaze':
        if (dist <= reach && e.cd <= 0) {
          addWarn(s, { shape: 'line', x: e.x, y: e.y, ang, len: d.area, w: e.r * 2 + 12, r: d.trail?.r ?? 0, t: d.windup, dmg: e.atk, src: e.id, after: 'dash', aux: d.trail?.dur ?? 0, aux2: e.atk * (d.trail?.mul ?? 0), big: true });
          e.busy = d.windup + 0.25;
          e.cd = d.cd;
        } else if (dist > reach * 0.85) approach(s, e, ux, uy);
        else moveEnemy(s, e, -uy * (e.id % 2 ? 1 : -1), ux * (e.id % 2 ? 1 : -1), 0.6);
        break;
      case 'hex':
      case 'bounce':
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
    if (sh.left > 0 && sh.bounce > 0 && tileAt(s, sh.x, sh.y) === 1) {
      // 튕기는 탄: 부딪힌 벽의 방향에 따라 되튄다
      const fx = tileAt(s, sh.x - dx, sh.y) !== 1;
      const fy = tileAt(s, sh.x, sh.y - dy) !== 1;
      if (fx || !fy) sh.vx = -sh.vx;
      if (fy || !fx) sh.vy = -sh.vy;
      sh.x -= dx;
      sh.y -= dy;
      sh.bounce--;
    }
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
          // 꽃가루: 맞으면 한동안 느려진다
          if (sh.slowDur > 0) (p.slowT = sh.slowDur), (p.slowMul = sh.slowMul);
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

// ---------- 지형 환경 ----------

/** 느려지는 땅 위의 이동 배율: 물 0.6, 2지형 진흙탕은 더 느리다 (막는 대원은 물과 같다) */
export const slowTileMul = (s: RunState) => (s.env.id === 'mud' ? SLOW_TILE_MUL - (SLOW_TILE_MUL - ENV.mud.slow) * s.env.f : SLOW_TILE_MUL);

/** 달그림자(4지형)에서 요괴가 보이는 거리 (다른 지형 · 막는 대원은 끝없이) */
export const sightOf = (s: RunState) =>
  s.env.f <= 0 ? Infinity : s.env.id === 'dark' ? ENV.dark.see / s.env.f : s.env.id === 'glare' && s.env.blind ? ENV.glare.see / s.env.f : Infinity;
/** 대원의 이동 배율: 꽃가루에 맞아 느려짐 · 졸음 (8지형) */
export const playerSlow = (s: RunState) => (s.p.slowT > 0 ? s.p.slowMul : 1) * (s.env.id === 'sleep' ? 1 - (1 - ENV.sleep.slow) * s.env.acc * s.env.f : 1);

/** 환경이 주는 피해: 방어·무적과 상관없이 그대로 받는다 (독) */
function envHurt(s: RunState, n: number) {
  const p = s.p;
  if (s.phase !== 'play' || n <= 0) return;
  if (!s.god) p.hp -= n;
  p.hurt = 0.2;
  push(s, { e: 'hurt', x: p.x, y: p.y - 30, n });
  if (p.hp <= 0) {
    p.hp = 0;
    s.phase = 'dead';
  }
}

/** 0~1 (환경 효과용: 시간 차례와 번호만으로 정해진다) */
const envHash = (a: number, b: number) => {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/** 요괴가 남긴 독 웅덩이: 서 있으면 POOL_TICK 마다 피해 */
function stepPools(s: RunState) {
  const p = s.p;
  for (let i = s.pools.length - 1; i >= 0; i--) {
    const z = s.pools[i];
    z.left -= STEP;
    if (z.left <= 0) {
      s.pools.splice(i, 1);
      continue;
    }
    if (Math.hypot(p.x - z.x, p.y - z.y) > z.r) {
      z.acc = 0;
      continue;
    }
    z.acc += STEP;
    if (z.acc >= POOL_TICK) {
      z.acc -= POOL_TICK;
      hurtPlayer(s, z.dmg);
    }
  }
}

/**
 * 지형 환경. 무작위를 쓰지 않는다 (시간과 자리만으로 정해진다).
 * 골바람 (3지형): every 초마다 dur 초 동안, 좌우 번갈아. 예고는 warn 초 전
 */
function stepEnv(s: RunState) {
  const env = s.env;
  const p = s.p;
  if (env.id === 'water') {
    // 물길 (5지형): 물 위에서는 물살이 아래로 민다 (돌진 스킬 중에는 밀리지 않는다)
    if (env.f > 0 && p.dashT <= 0 && tileAt(s, p.x, p.y) === 2) move(s, p, 0, ENV.water.push * env.f * STEP, PLAYER_R);
    return;
  }
  if (env.id === 'poison') {
    // 독안개 (6지형): 늪 위에 서 있으면 tick 초마다 독 피해
    if (env.f > 0 && tileAt(s, p.x, p.y) === 2) {
      env.acc += STEP;
      if (env.acc >= ENV.poison.tick) {
        env.acc -= ENV.poison.tick;
        envHurt(s, Math.max(1, Math.round(s.stats.hp * ENV.poison.pct * env.f)));
      }
    }
    return;
  }
  if (env.id === 'arrow') {
    // 성벽 화살 (7지형): every 초마다 대원 자리에 하나, 그 둘레에 나머지
    const a = ENV.arrow;
    const k = Math.floor(s.t / a.every);
    if (k <= env.k) return;
    env.k = k;
    push(s, { e: 'env', id: 'arrow', dir: 0 });
    if (env.f <= 0) return;
    for (let i = 0; i < a.n; i++) {
      const ang = envHash(k, i) * Math.PI * 2;
      const d = i === 0 ? 0 : a.spread * (0.45 + 0.55 * envHash(i, k));
      addWarn(s, { shape: 'circle', x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d, r: a.r, t: a.warn + i * a.gap, dmg: a.dmg * s.foeAtk * env.f, src: -1, big: true });
    }
    return;
  }
  if (env.id === 'sleep') {
    // 졸음 꽃가루 (8지형): 가만히 서 있으면 졸음이 쌓여 발이 느려진다. 걸으면 깨고, 구르면 바로 깬다
    const z = ENV.sleep;
    if (p.rollT > 0 || p.dashT > 0) {
      env.still = 0;
      env.acc = 0;
    } else if (p.moving) {
      env.still = 0;
      env.acc = Math.max(0, env.acc - STEP / z.wake);
    } else {
      env.still += STEP;
      if (env.still >= z.after && env.f > 0) {
        if (env.acc === 0) push(s, { e: 'env', id: 'sleep', dir: 0 });
        env.acc = Math.min(1, env.acc + STEP / z.full);
      }
    }
    return;
  }
  if (env.id === 'slip') {
    // 미끄러운 마루 (9지형): 멈추면 가던 쪽으로 미끄러진다 (stepPlayer 가 걷는 속도를 적어 둔다)
    if (env.f <= 0 || p.moving || p.rollT > 0 || p.dashT > 0) return;
    if (Math.abs(env.vx) + Math.abs(env.vy) < 0.15) {
      env.vx = env.vy = 0;
      return;
    }
    move(s, p, env.vx, env.vy, PLAYER_R);
    env.vx *= ENV.slip.keep;
    env.vy *= ENV.slip.keep;
    return;
  }
  if (env.id === 'glare') {
    // 새벽빛 (10지형): every 초마다 dur 초 동안 눈이 부셔 먼 요괴가 안 보이고 조준이 안 된다. warn 초 전에 알린다
    const g = ENV.glare;
    const k = Math.floor(s.t / g.every);
    const ph = s.t - k * g.every;
    const warn = ph >= g.every - g.warn ? 1 : 0;
    if (warn && !env.warn) push(s, { e: 'env', id: 'glare', dir: 0 });
    env.warn = warn;
    env.blind = k >= 1 && ph < g.dur;
    return;
  }
  if (env.id === 'fire') {
    // 불길 (12지형): 불바닥을 밟으면 바로 데고, 벗어난 뒤에도 linger 번 더 덴다
    const f = ENV.fire;
    const on = env.f > 0 && tileAt(s, p.x, p.y) === 2;
    if (on) {
      if (env.k === 0) env.acc = f.tick - f.first;
      env.k = f.linger;
    }
    if (on || env.k > 0) {
      env.acc += STEP;
      if (env.acc >= f.tick) {
        env.acc -= f.tick;
        if (!on) env.k--;
        envHurt(s, Math.max(1, Math.round(s.stats.hp * f.pct * env.f)));
      }
    }
    return;
  }
  if (env.id !== 'wind') return;
  const w = ENV.wind;
  const k = Math.floor(s.t / w.every);
  const ph = s.t - k * w.every;
  const dirOf = (n: number) => (n % 2 ? 1 : -1);
  const warn = ph >= w.every - w.warn ? dirOf(k + 1) : 0;
  if (warn && !env.warn) push(s, { e: 'env', id: 'wind', dir: warn });
  env.warn = warn;
  env.gust = k >= 1 && ph < w.dur ? dirOf(k) : 0;
  // 돌진 스킬 중에는 밀리지 않는다
  if (env.gust && env.f > 0 && s.p.dashT <= 0) move(s, s.p, env.gust * w.push * env.f * STEP, 0, PLAYER_R);
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
  if (p.slowT > 0) p.slowT -= STEP;
  // 찬 강바람 (11지형): 마력이 느리게 찬다
  const regen = s.env.id === 'cold' ? 1 - (1 - ENV.cold.regen) * s.env.f : 1;
  p.mp = Math.min(s.stats.mp, p.mp + s.stats.mp * MP_REGEN * regen * STEP);

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
    const lack = k === 0 ? 1 - p.hp / s.stats.hp : 1 - p.mp / s.stats.mp;
    if (lack <= 0) continue;
    // 모자란 만큼을 채우는 가장 작은 물약, 없으면 가진 것 중 가장 큰 물약
    const boost = 1 + (s.loadout.bonus?.potion ?? 0) / 100;
    const have = [0, 1, 2].filter((z) => s.stock[k][z] > 0);
    const size = have.find((z) => POTION.heal[k][z] * boost >= lack) ?? have[have.length - 1];
    s.stock[k][size]--;
    s.used[k][size]++;
    s.potions[k]--;
    s.potionsUsed++;
    p.potionCd = POTION_CD;
    const heal = POTION.heal[k][size] * boost;
    runAct(s, k === 0 ? { t: 'heal', hp: heal } : { t: 'heal', mp: heal }, 1);
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
    // 진흙탕 위에서는 구르기가 짧다 (2지형 환경)
    const v = (ROLL.dist * (s.env.id === 'mud' && tileAt(s, p.x, p.y) === 2 ? 1 - (1 - ENV.mud.roll) * s.env.f : 1)) / ROLL.time;
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
    const v = s.stats.speed * (b.speedT > 0 ? b.speed : 1) * (tileAt(s, p.x, p.y) === 2 ? slowTileMul(s) : 1) * playerSlow(s) * STEP;
    move(s, p, mx * v, my * v, PLAYER_R);
    // 미끄러운 마루 (9지형): 멈추면 이 속도로 미끄러진다
    if (s.env.id === 'slip') (s.env.vx = mx * v * s.env.f), (s.env.vy = my * v * s.env.f);
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
  stepEnv(s);
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
  stepPools(s);

  const p = s.p;
  if (!s.chest && Math.hypot(p.x - s.chestX, p.y - s.chestY) < 50) {
    s.chest = true;
    const coins = chestCoins(s.reward);
    s.coins += coins;
    push(s, { e: 'chest', coins });
  }
  for (const pk of s.picks) {
    if (pk.got || Math.hypot(p.x - pk.x, p.y - pk.y) > PICK_DIST) continue;
    pk.got = true;
    push(s, { e: 'pick', id: pk.id, drop: pk.drop });
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
